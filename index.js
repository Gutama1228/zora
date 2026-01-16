const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

const bot = new Telegraf(BOT_TOKEN);

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  status: { type: String, default: 'idle' },
  partnerId: { type: Number, default: null },
  
  // Profile
  gender: String, // male, female
  age: Number,
  location: String,
  hasCompletedSetup: { type: Boolean, default: false },
  
  // Premium
  isPremium: { type: Boolean, default: false },
  premiumUntil: Date,
  
  // Premium Filters (only for premium users)
  filterGender: { type: String, default: 'all' }, // all, male, female
  filterAgeMin: { type: Number, default: 18 },
  filterAgeMax: { type: Number, default: 99 },
  
  // Stats
  totalChats: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  nextCount: { type: Number, default: 0 }, // Track /next usage
  reportsReceived: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const mediaSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  fileType: { type: String, required: true },
  userId: { type: Number, required: true },
  username: String,
  gender: String,
  partnerId: Number,
  partnerUsername: String,
  caption: String,
  createdAt: { type: Date, default: Date.now }
});

const reportSchema = new mongoose.Schema({
  reporterId: { type: Number, required: true },
  reporterUsername: String,
  reportedUserId: { type: Number, required: true },
  reportedUsername: String,
  reason: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Media = mongoose.model('Media', mediaSchema);
const Report = mongoose.model('Report', reportSchema);

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB error:', err);
    process.exit(1);
  }
}

// Helper functions
async function getUser(userId) {
  return await User.findOne({ userId });
}

async function getOrCreateUser(userId, username, firstName) {
  let user = await getUser(userId);
  if (!user) {
    user = await User.create({ userId, username, firstName });
  }
  return user;
}

async function updateStatus(userId, status, partnerId = null) {
  await User.findOneAndUpdate(
    { userId },
    { status, partnerId, updatedAt: Date.now() }
  );
}

async function findPartner(userId) {
  const user = await getUser(userId);
  if (!user) return null;
  
  const query = {
    status: 'searching',
    userId: { $ne: userId },
    isBanned: false
  };
  
  // Apply premium filters if user is premium
  if (user.isPremium && user.filterGender !== 'all') {
    query.gender = user.filterGender;
  }
  
  if (user.isPremium && user.filterAgeMin && user.filterAgeMax) {
    query.age = {
      $gte: user.filterAgeMin,
      $lte: user.filterAgeMax
    };
  }
  
  return await User.findOne(query);
}

async function tryAutoMatch() {
  const searchingUsers = await User.find({ 
    status: 'searching',
    isBanned: false 
  }).limit(50);
  
  if (searchingUsers.length < 2) return;
  
  for (let i = 0; i < searchingUsers.length - 1; i += 2) {
    const user1 = searchingUsers[i];
    const user2 = searchingUsers[i + 1];
    
    if (user1.status === 'searching' && user2.status === 'searching') {
      // Check if they match each other's filters
      let match = true;
      
      // Check user1's filters
      if (user1.isPremium && user1.filterGender !== 'all' && user1.filterGender !== user2.gender) {
        match = false;
      }
      if (user1.isPremium && user2.age && (user2.age < user1.filterAgeMin || user2.age > user1.filterAgeMax)) {
        match = false;
      }
      
      // Check user2's filters
      if (user2.isPremium && user2.filterGender !== 'all' && user2.filterGender !== user1.gender) {
        match = false;
      }
      if (user2.isPremium && user1.age && (user1.age < user2.filterAgeMin || user1.age > user2.filterAgeMax)) {
        match = false;
      }
      
      if (!match) continue;
      
      await updateStatus(user1.userId, 'chatting', user2.userId);
      await updateStatus(user2.userId, 'chatting', user1.userId);
      
      await User.updateOne({ userId: user1.userId }, { $inc: { totalChats: 1 } });
      await User.updateOne({ userId: user2.userId }, { $inc: { totalChats: 1 } });
      
      try {
        await bot.telegram.sendMessage(
          user1.userId,
          '✅ *Stranger found!*\n\nYou are now chatting with a stranger.\nSay hi!\n\n💡 /next - Find new partner\n💡 /stop - End chat',
          { parse_mode: 'Markdown' }
        );
        
        await bot.telegram.sendMessage(
          user2.userId,
          '✅ *Stranger found!*\n\nYou are now chatting with a stranger.\nSay hi!\n\n💡 /next - Find new partner\n💡 /stop - End chat',
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error('Error notifying matched users:', err);
      }
    }
  }
}

async function endChat(userId) {
  const user = await getUser(userId);
  if (user && user.partnerId) {
    const partnerId = user.partnerId;
    await updateStatus(userId, 'idle');
    await updateStatus(partnerId, 'idle');
    return partnerId;
  }
  await updateStatus(userId, 'idle');
  return null;
}

async function saveMedia(fileId, fileType, userId, partnerId, caption = '') {
  const user = await getUser(userId);
  const partner = await getUser(partnerId);
  
  await Media.create({
    fileId,
    fileType,
    userId,
    username: user.username,
    gender: user.gender,
    partnerId,
    partnerUsername: partner?.username,
    caption
  });
}

// Commands
bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  
  if (!user.hasCompletedSetup) {
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('👨 Male', 'setup_male'),
        Markup.button.callback('👩 Female', 'setup_female')
      ]
    ]);
    
    return ctx.reply(
      '*Welcome to Anonymous Chat!* 🎭\n\n' +
      'Chat anonymously with random strangers.\n\n' +
      'First, select your gender:',
      { parse_mode: 'Markdown', ...keyboard }
    );
  }
  
  const keyboard = Markup.keyboard([
    ['🔍 Search'],
    ['⚙️ Settings', '📊 Stats'],
    ['💎 Premium', '❓ Help']
  ]).resize();
  
  await ctx.reply(
    '*Welcome back!* 👋\n\n' +
    '🎭 Chat anonymously with strangers\n\n' +
    '🔍 Tap *Search* to find someone!',
    { parse_mode: 'Markdown', ...keyboard }
  );
});

// Setup callbacks
bot.action(/setup_(male|female)/, async (ctx) => {
  const gender = ctx.match[1];
  
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    '👍 *Gender set!*\n\nNow, enter your age (18-99):',
    { parse_mode: 'Markdown' }
  );
  
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { gender, updatedAt: Date.now() }
  );
  
  // Store state for next message
  ctx.session = { awaitingAge: true };
});

bot.hears('🔍 Search', async (ctx) => {
  await handleSearch(ctx);
});

bot.command('search', async (ctx) => {
  await handleSearch(ctx);
});

async function handleSearch(ctx) {
  const userId = ctx.from.id;
  const user = await getOrCreateUser(userId, ctx.from.username, ctx.from.first_name);
  
  if (!user.hasCompletedSetup) {
    return ctx.reply('⚠️ Please complete setup first!\n\nUse /start to begin.');
  }
  
  if (user.isBanned) {
    return ctx.reply('🚫 Your account is banned.\n\nContact support if this is a mistake.');
  }
  
  if (user.status === 'chatting') {
    return ctx.reply('❌ You are already chatting!\n\nUse /stop to end chat first.');
  }
  
  if (user.status === 'searching') {
    return ctx.reply('🔍 Already searching...\n\nPlease wait.');
  }
  
  const partner = await findPartner(userId);
  
  if (partner) {
    await updateStatus(userId, 'chatting', partner.userId);
    await updateStatus(partner.userId, 'chatting', userId);
    
    await User.updateOne({ userId }, { $inc: { totalChats: 1 } });
    await User.updateOne({ userId: partner.userId }, { $inc: { totalChats: 1 } });
    
    await ctx.reply(
      '✅ *Stranger found!*\n\nYou are now chatting with a stranger.\nSay hi!\n\n💡 /next - Find new partner\n💡 /stop - End chat',
      { parse_mode: 'Markdown' }
    );
    
    await bot.telegram.sendMessage(
      partner.userId,
      '✅ *Stranger found!*\n\nYou are now chatting with a stranger.\nSay hi!\n\n💡 /next - Find new partner\n💡 /stop - End chat',
      { parse_mode: 'Markdown' }
    );
  } else {
    await updateStatus(userId, 'searching');
    
    await ctx.reply(
      '🔍 *Looking for a stranger...*\n\nPlease wait, we\'ll notify you when someone is found.',
      { parse_mode: 'Markdown' }
    );
    
    await tryAutoMatch();
    setTimeout(async () => await tryAutoMatch(), 1000);
  }
}

bot.hears('❓ Help', async (ctx) => {
  await ctx.reply(
    '*How to use:* 📖\n\n' +
    '1️⃣ Tap *Search* to find a stranger\n' +
    '2️⃣ Chat anonymously\n' +
    '3️⃣ Use /next to find someone new\n' +
    '4️⃣ Use /stop to end chat\n\n' +
    '*Commands:*\n' +
    '/search - Find stranger\n' +
    '/next - Next stranger\n' +
    '/stop - End chat\n' +
    '/report - Report user\n' +
    '/stats - Your stats\n' +
    '/premium - Get premium',
    { parse_mode: 'Markdown' }
  );
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user) return ctx.reply('Use /start first!');
  
  if (user.status === 'idle') {
    return ctx.reply('❌ You are not in a chat.');
  }
  
  if (user.status === 'searching') {
    await updateStatus(userId, 'idle');
    return ctx.reply('✅ Search cancelled.');
  }
  
  const partnerId = await endChat(userId);
  
  if (partnerId) {
    await ctx.reply('👋 *Chat ended*\n\nTap Search to find someone new!', { parse_mode: 'Markdown' });
    await bot.telegram.sendMessage(partnerId, '👋 *Stranger has disconnected*', { parse_mode: 'Markdown' });
  }
}

bot.command('next', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting') {
    return ctx.reply('❌ You must be in a chat to use /next!');
  }
  
  // Check premium limit (free users: 5 per day)
  if (!user.isPremium && user.nextCount >= 5) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💎 Get Premium', 'show_premium')]
    ]);
    
    return ctx.reply(
      '⚠️ *Daily /next limit reached!*\n\n' +
      'Free users: 5 skips per day\n' +
      'Premium users: Unlimited skips\n\n' +
      'Upgrade to premium for unlimited /next!',
      { parse_mode: 'Markdown', ...keyboard }
    );
  }
  
  const partnerId = await endChat(userId);
  
  if (partnerId) {
    await bot.telegram.sendMessage(
      partnerId,
      '👋 *Stranger has disconnected*',
      { parse_mode: 'Markdown' }
    );
  }
  
  await User.updateOne({ userId }, { $inc: { nextCount: 1 } });
  
  await ctx.reply('🔄 Finding new stranger...');
  
  const newPartner = await findPartner(userId);
  
  if (newPartner) {
    await updateStatus(userId, 'chatting', newPartner.userId);
    await updateStatus(newPartner.userId, 'chatting', userId);
    
    await User.updateOne({ userId }, { $inc: { totalChats: 1 } });
    await User.updateOne({ userId: newPartner.userId }, { $inc: { totalChats: 1 } });
    
    await ctx.reply(
      '✅ *New stranger found!*\n\nSay hi!',
      { parse_mode: 'Markdown' }
    );
    
    await bot.telegram.sendMessage(
      newPartner.userId,
      '✅ *Stranger found!*\n\nSay hi!',
      { parse_mode: 'Markdown' }
    );
  } else {
    await updateStatus(userId, 'searching');
    await ctx.reply('🔍 Searching...');
    await tryAutoMatch();
  }
});

bot.hears('📊 Stats', async (ctx) => {
  await showStats(ctx);
});

bot.command('stats', async (ctx) => {
  await showStats(ctx);
});

async function showStats(ctx) {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first!');
  
  const totalUsers = await User.countDocuments();
  const onlineUsers = await User.countDocuments({ status: { $in: ['searching', 'chatting'] } });
  const totalMedia = await Media.countDocuments({ userId: ctx.from.id });
  
  const premiumBadge = user.isPremium ? '💎' : '🆓';
  
  await ctx.reply(
    `📊 *Your Statistics*\n\n` +
    `${premiumBadge} Account: ${user.isPremium ? 'Premium' : 'Free'}\n` +
    `${user.gender === 'male' ? '👨' : '👩'} Gender: ${user.gender}\n` +
    `🎂 Age: ${user.age || 'Not set'}\n` +
    `💬 Total Chats: ${user.totalChats}\n` +
    `✉️ Messages: ${user.totalMessages}\n` +
    `📸 Media Sent: ${totalMedia}\n` +
    `⏭️ Next Used: ${user.nextCount}/5 today\n\n` +
    `📈 *Global Stats*\n` +
    `👥 Total Users: ${totalUsers}\n` +
    `🟢 Online: ${onlineUsers}`,
    { parse_mode: 'Markdown' }
  );
}

bot.hears('💎 Premium', async (ctx) => {
  await showPremium(ctx);
});

bot.command('premium', async (ctx) => {
  await showPremium(ctx);
});

bot.action('show_premium', async (ctx) => {
  await ctx.answerCbQuery();
  await showPremium(ctx);
});

async function showPremium(ctx) {
  const user = await getUser(ctx.from.id);
  
  if (user?.isPremium) {
    const until = new Date(user.premiumUntil);
    return ctx.reply(
      '💎 *You have Premium!*\n\n' +
      `Active until: ${until.toLocaleDateString()}\n\n` +
      '*Your Premium Benefits:*\n' +
      '✅ Gender filter\n' +
      '✅ Age filter\n' +
      '✅ Unlimited /next\n' +
      '✅ Priority matching\n' +
      '✅ No ads',
      { parse_mode: 'Markdown' }
    );
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💳 Buy Premium - $4.99/month', 'buy_premium')],
    [Markup.button.callback('⚙️ View Features', 'premium_features')]
  ]);
  
  await ctx.reply(
    '💎 *Upgrade to Premium*\n\n' +
    '*Premium Features:*\n' +
    '🎯 Gender Filter - Chat with specific gender\n' +
    '🎂 Age Filter - Choose age range\n' +
    '⏭️ Unlimited /next - Skip without limits\n' +
    '⚡ Priority Matching - Get matched faster\n' +
    '🚫 Ad-Free Experience\n\n' +
    '💰 Only $4.99/month',
    { parse_mode: 'Markdown', ...keyboard }
  );
}

bot.action('premium_features', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    '💎 *Premium Features Explained*\n\n' +
    '*🎯 Gender Filter*\n' +
    'Only match with Male or Female\n\n' +
    '*🎂 Age Filter*\n' +
    'Set age range (18-25, 26-35, etc)\n\n' +
    '*⏭️ Unlimited Next*\n' +
    'Skip as many times as you want\n\n' +
    '*⚡ Priority Matching*\n' +
    'Get matched 3x faster\n\n' +
    '*🚫 No Ads*\n' +
    'Clean experience\n\n' +
    '💰 Price: $4.99/month',
    { parse_mode: 'Markdown' }
  );
});

bot.action('buy_premium', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '💳 *Payment Methods*\n\n' +
    'Contact admin to purchase premium:\n' +
    '@your_admin_username\n\n' +
    'Payment via:\n' +
    '• PayPal\n' +
    '• Crypto\n' +
    '• Bank Transfer',
    { parse_mode: 'Markdown' }
  );
});

bot.hears('⚙️ Settings', async (ctx) => {
  const user = await getUser(ctx.from.id);
  
  if (!user?.isPremium) {
    return ctx.reply(
      '⚠️ *Settings are Premium-only*\n\n' +
      'Upgrade to Premium to access:\n' +
      '• Gender filter\n' +
      '• Age filter\n' +
      '• And more!\n\n' +
      'Use /premium to upgrade',
      { parse_mode: 'Markdown' }
    );
  }
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('👨 Male', 'filter_male'),
      Markup.button.callback('👩 Female', 'filter_female'),
      Markup.button.callback('🌐 All', 'filter_all')
    ],
    [Markup.button.callback('🎂 Age Range', 'filter_age')]
  ]);
  
  await ctx.reply(
    '⚙️ *Premium Settings*\n\n' +
    `Current filter: ${user.filterGender}\n` +
    `Age range: ${user.filterAgeMin}-${user.filterAgeMax}\n\n` +
    'Select your preferences:',
    { parse_mode: 'Markdown', ...keyboard }
  );
});

bot.action(/filter_(male|female|all)/, async (ctx) => {
  const filter = ctx.match[1];
  
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { filterGender: filter }
  );
  
  await ctx.answerCbQuery(`✅ Filter set to: ${filter}`);
});

bot.command('report', async (ctx) => {
  const user = await getUser(ctx.from.id);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You must be in a chat to report!');
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('😡 Rude/Toxic', 'report_toxic')],
    [Markup.button.callback('🔞 Inappropriate', 'report_nsfw')],
    [Markup.button.callback('📢 Spam', 'report_spam')],
    [Markup.button.callback('👶 Underage', 'report_underage')]
  ]);
  
  await ctx.reply(
    '🚨 *Report User*\n\nSelect reason:',
    { parse_mode: 'Markdown', ...keyboard }
  );
});

bot.action(/report_(.+)/, async (ctx) => {
  const reason = ctx.match[1];
  const user = await getUser(ctx.from.id);
  
  if (!user || !user.partnerId) {
    return ctx.answerCbQuery('❌ Not in chat!');
  }
  
  const partner = await getUser(user.partnerId);
  
  await Report.create({
    reporterId: ctx.from.id,
    reporterUsername: ctx.from.username,
    reportedUserId: user.partnerId,
    reportedUsername: partner?.username,
    reason
  });
  
  const updatedPartner = await User.findOneAndUpdate(
    { userId: user.partnerId },
    { $inc: { reportsReceived: 1 } },
    { new: true }
  );
  
  if (updatedPartner.reportsReceived >= 3) {
    await User.findOneAndUpdate({ userId: user.partnerId }, { isBanned: true });
    try {
      await bot.telegram.sendMessage(
        user.partnerId,
        '🚫 *Account Banned*\n\nYour account has been banned due to reports.',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {}
  }
  
  await ctx.answerCbQuery('✅ Report submitted!');
  await ctx.editMessageText('✅ User reported. Thank you!');
});

// Handle text messages
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  // Handle age setup
  if (ctx.session?.awaitingAge) {
    const age = parseInt(ctx.message.text);
    
    if (isNaN(age) || age < 18 || age > 99) {
      return ctx.reply('⚠️ Please enter a valid age (18-99)');
    }
    
    await User.findOneAndUpdate(
      { userId },
      { age, hasCompletedSetup: true }
    );
    
    ctx.session = {};
    
    const keyboard = Markup.keyboard([
      ['🔍 Search'],
      ['⚙️ Settings', '📊 Stats'],
      ['💎 Premium', '❓ Help']
    ]).resize();
    
    return ctx.reply(
      '✅ *Setup complete!*\n\nTap Search to find strangers!',
      { parse_mode: 'Markdown', ...keyboard }
    );
  }
  
  if (!user || !user.hasCompletedSetup) {
    return ctx.reply('Use /start first!');
  }
  
  if (user.status === 'idle') {
    return ctx.reply('❌ Not in chat.\n\nTap Search to find someone!');
  }
  
  if (user.status === 'searching') {
    return ctx.reply('🔍 Still searching...');
  }
  
  if (user.status === 'chatting' && user.partnerId) {
    try {
      await bot.telegram.sendMessage(user.partnerId, ctx.message.text);
      await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
    } catch (err) {
      await endChat(userId);
      await ctx.reply('❌ Stranger disconnected.');
    }
  }
});

// Media handlers
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ Not in chat!');
  }
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || '';
    
    await saveMedia(photo.file_id, 'photo', userId, user.partnerId, caption);
    await bot.telegram.sendPhoto(user.partnerId, photo.file_id, { caption });
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Stranger disconnected.');
  }
});

bot.on('video', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) return;
  
  try {
    const caption = ctx.message.caption || '';
    await saveMedia(ctx.message.video.file_id, 'video', userId, user.partnerId, caption);
    await bot.telegram.sendVideo(user.partnerId, ctx.message.video.file_id, { caption });
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
  }
});

bot.on('voice', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) return;
  
  try {
    await bot.telegram.sendVoice(user.partnerId, ctx.message.voice.file_id);
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
  }
});

bot.on('sticker', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) return;
  
  try {
    await bot.telegram.sendSticker(user.partnerId, ctx.message.sticker.file_id);
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
  }
});

bot.on('animation', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) return;
  
  try {
    await bot.telegram.sendAnimation(user.partnerId, ctx.message.animation.file_id);
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
  }
});

bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
});

async function startBot() {
  await connectDB();
  bot.launch();
  console.log('✅ Bot started!');
  
  // Reset daily next count every 24 hours
  setInterval(async () => {
    await User.updateMany({}, { nextCount: 0 });
    console.log('✅ Daily /next count reset');
  }, 24 * 60 * 60 * 1000);
  
  // Auto-match interval - check every 1 second
  setInterval(async () => {
    try {
      await tryAutoMatch();
    } catch (err) {
      console.error('Auto-match error:', err);
    }
  }, 1000);
}

startBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));