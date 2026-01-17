const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const bot = new Telegraf(BOT_TOKEN);

// Schemas
const userSchema = new mongoose.Schema({
  userId: Number,
  username: String,
  firstName: String,
  status: { type: String, default: 'idle' },
  partnerId: Number,
  gender: String,
  age: Number,
  hasCompletedSetup: { type: Boolean, default: false },
  isPremium: { type: Boolean, default: false },
  premiumUntil: Date,
  filterGender: { type: String, default: 'all' },
  filterAgeMin: { type: Number, default: 18 },
  filterAgeMax: { type: Number, default: 99 },
  totalChats: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  nextCount: { type: Number, default: 0 },
  reportsReceived: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const mediaSchema = new mongoose.Schema({
  fileId: String,
  fileType: String,
  userId: Number,
  username: String,
  gender: String,
  partnerId: Number,
  caption: String,
  createdAt: { type: Date, default: Date.now }
});

const reportSchema = new mongoose.Schema({
  reporterId: Number,
  reportedUserId: Number,
  reason: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Media = mongoose.model('Media', mediaSchema);
const Report = mongoose.model('Report', reportSchema);

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// Helpers
async function getUser(userId) {
  return await User.findOne({ userId });
}

async function updateStatus(userId, status, partnerId = null) {
  await User.findOneAndUpdate({ userId }, { status, partnerId });
}

async function findPartner(userId) {
  const user = await getUser(userId);
  if (!user) return null;
  
  const query = { status: 'searching', userId: { $ne: userId }, isBanned: false };
  
  if (user.isPremium && user.filterGender !== 'all') {
    query.gender = user.filterGender;
  }
  
  if (user.isPremium && user.filterAgeMin && user.filterAgeMax) {
    query.age = { $gte: user.filterAgeMin, $lte: user.filterAgeMax };
  }
  
  return await User.findOne(query);
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

// Commands
bot.start(async (ctx) => {
  let user = await getUser(ctx.from.id);
  if (!user) {
    user = await User.create({
      userId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name
    });
  }
  
  if (!user.hasCompletedSetup) {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('Male', 'setup_male'), Markup.button.callback('Female', 'setup_female')]
    ]);
    return ctx.reply('Welcome! Select your gender:', kb);
  }
  
  const kb = Markup.keyboard([['Search'], ['Settings', 'Stats'], ['Premium', 'Help']]).resize();
  ctx.reply('Welcome back! Tap Search to find someone!', kb);
});

bot.action(/setup_(male|female)/, async (ctx) => {
  await User.findOneAndUpdate({ userId: ctx.from.id }, { gender: ctx.match[1] });
  await ctx.answerCbQuery();
  await ctx.editMessageText('Gender set! Now enter your age (18-99):');
});

bot.hears('Search', async (ctx) => {
  await handleSearch(ctx);
});

bot.command('search', async (ctx) => {
  await handleSearch(ctx);
});

async function handleSearch(ctx) {
  const userId = ctx.from.id;
  let user = await getUser(userId);
  
  if (!user) {
    user = await User.create({ userId, username: ctx.from.username, firstName: ctx.from.first_name });
  }
  
  if (!user.hasCompletedSetup) {
    return ctx.reply('Please complete setup first! Use /start');
  }
  
  if (user.isBanned) {
    return ctx.reply('Your account is banned.');
  }
  
  if (user.status === 'chatting') {
    return ctx.reply('You are already chatting! Use /stop first.');
  }
  
  if (user.status === 'searching') {
    return ctx.reply('Already searching...');
  }
  
  const partner = await findPartner(userId);
  
  if (partner) {
    await updateStatus(userId, 'chatting', partner.userId);
    await updateStatus(partner.userId, 'chatting', userId);
    await User.updateOne({ userId }, { $inc: { totalChats: 1 } });
    await User.updateOne({ userId: partner.userId }, { $inc: { totalChats: 1 } });
    
    ctx.reply('Stranger found! Start chatting now.');
    bot.telegram.sendMessage(partner.userId, 'Stranger found! Start chatting now.');
  } else {
    await updateStatus(userId, 'searching');
    ctx.reply('Looking for a stranger... Please wait.');
    setTimeout(() => tryAutoMatch(), 1000);
  }
}

async function tryAutoMatch() {
  const users = await User.find({ status: 'searching', isBanned: false }).limit(50);
  
  if (users.length < 2) return;
  
  for (let i = 0; i < users.length - 1; i += 2) {
    const u1 = users[i];
    const u2 = users[i + 1];
    
    if (u1.status !== 'searching' || u2.status !== 'searching') continue;
    
    let match = true;
    
    if (u1.isPremium && u1.filterGender !== 'all' && u1.filterGender !== u2.gender) match = false;
    if (u2.isPremium && u2.filterGender !== 'all' && u2.filterGender !== u1.gender) match = false;
    
    if (!match) continue;
    
    await updateStatus(u1.userId, 'chatting', u2.userId);
    await updateStatus(u2.userId, 'chatting', u1.userId);
    await User.updateOne({ userId: u1.userId }, { $inc: { totalChats: 1 } });
    await User.updateOne({ userId: u2.userId }, { $inc: { totalChats: 1 } });
    
    try {
      bot.telegram.sendMessage(u1.userId, 'Stranger found! Say hi!');
      bot.telegram.sendMessage(u2.userId, 'Stranger found! Say hi!');
    } catch (err) {
      console.error('Match notify error:', err);
    }
  }
}

bot.command('stop', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first!');
  
  if (user.status === 'idle') return ctx.reply('You are not in a chat.');
  if (user.status === 'searching') {
    await updateStatus(ctx.from.id, 'idle');
    return ctx.reply('Search cancelled.');
  }
  
  const partnerId = await endChat(ctx.from.id);
  if (partnerId) {
    ctx.reply('Chat ended.');
    bot.telegram.sendMessage(partnerId, 'Stranger disconnected.');
  }
});

bot.command('next', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user || user.status !== 'chatting') {
    return ctx.reply('You must be in a chat to use /next!');
  }
  
  if (!user.isPremium && user.nextCount >= 5) {
    return ctx.reply('Daily limit reached! Upgrade to premium for unlimited skips.');
  }
  
  const partnerId = await endChat(ctx.from.id);
  if (partnerId) {
    bot.telegram.sendMessage(partnerId, 'Stranger disconnected.');
  }
  
  await User.updateOne({ userId: ctx.from.id }, { $inc: { nextCount: 1 } });
  ctx.reply('Finding new stranger...');
  
  const partner = await findPartner(ctx.from.id);
  if (partner) {
    await updateStatus(ctx.from.id, 'chatting', partner.userId);
    await updateStatus(partner.userId, 'chatting', ctx.from.id);
    await User.updateOne({ userId: ctx.from.id }, { $inc: { totalChats: 1 } });
    await User.updateOne({ userId: partner.userId }, { $inc: { totalChats: 1 } });
    
    ctx.reply('New stranger found!');
    bot.telegram.sendMessage(partner.userId, 'Stranger found!');
  } else {
    await updateStatus(ctx.from.id, 'searching');
    ctx.reply('Searching...');
    tryAutoMatch();
  }
});

bot.hears('Stats', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first!');
  
  const total = await User.countDocuments();
  const online = await User.countDocuments({ status: { $in: ['searching', 'chatting'] } });
  
  const msg = 'Your Statistics\n\n' +
    'Account: ' + (user.isPremium ? 'Premium' : 'Free') + '\n' +
    'Total Chats: ' + user.totalChats + '\n' +
    'Messages: ' + user.totalMessages + '\n' +
    'Next Used: ' + user.nextCount + '/5 today\n\n' +
    'Global Stats\n' +
    'Total Users: ' + total + '\n' +
    'Online: ' + online;
  
  ctx.reply(msg);
});

bot.hears('Help', async (ctx) => {
  const msg = 'How to use:\n\n' +
    '1. Tap Search to find a stranger\n' +
    '2. Chat anonymously\n' +
    '3. Use /next for new partner\n' +
    '4. Use /stop to end chat\n\n' +
    'Commands:\n' +
    '/search - Find stranger\n' +
    '/next - Next stranger\n' +
    '/stop - End chat\n' +
    '/stats - Your stats\n' +
    '/premium - Get premium';
  
  ctx.reply(msg);
});

bot.hears('Premium', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (user && user.isPremium) {
    return ctx.reply('You have Premium! Active until: ' + new Date(user.premiumUntil).toLocaleDateString());
  }
  
  const msg = 'Upgrade to Premium\n\n' +
    'Premium Features:\n' +
    '- Gender Filter\n' +
    '- Age Filter\n' +
    '- Unlimited /next\n' +
    '- Priority Matching\n' +
    '- Ad-Free\n\n' +
    'Only $4.99/month';
  
  ctx.reply(msg);
});

bot.command('report', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('You must be in a chat to report!');
  }
  
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback('Rude/Toxic', 'report_toxic')],
    [Markup.button.callback('Inappropriate', 'report_nsfw')],
    [Markup.button.callback('Spam', 'report_spam')]
  ]);
  
  ctx.reply('Select reason:', kb);
});

bot.action(/report_(.+)/, async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user || !user.partnerId) {
    return ctx.answerCbQuery('Not in chat!');
  }
  
  await Report.create({
    reporterId: ctx.from.id,
    reportedUserId: user.partnerId,
    reason: ctx.match[1]
  });
  
  const partner = await User.findOneAndUpdate(
    { userId: user.partnerId },
    { $inc: { reportsReceived: 1 } },
    { new: true }
  );
  
  if (partner.reportsReceived >= 3) {
    await User.findOneAndUpdate({ userId: user.partnerId }, { isBanned: true });
  }
  
  await ctx.answerCbQuery('Report submitted!');
  await ctx.editMessageText('User reported. Thank you!');
});

// Messages
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  // Age setup
  if (!user || !user.hasCompletedSetup) {
    if (!user) return ctx.reply('Use /start first!');
    
    const age = parseInt(ctx.message.text);
    if (isNaN(age) || age < 18 || age > 99) {
      return ctx.reply('Please enter valid age (18-99)');
    }
    
    await User.findOneAndUpdate({ userId }, { age, hasCompletedSetup: true });
    const kb = Markup.keyboard([['Search'], ['Settings', 'Stats'], ['Premium', 'Help']]).resize();
    return ctx.reply('Setup complete! Tap Search to find strangers!', kb);
  }
  
  if (user.status === 'idle') return ctx.reply('Not in chat. Tap Search!');
  if (user.status === 'searching') return ctx.reply('Still searching...');
  
  if (user.status === 'chatting' && user.partnerId) {
    try {
      await bot.telegram.sendMessage(user.partnerId, ctx.message.text);
      await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
    } catch (err) {
      await endChat(userId);
      ctx.reply('Partner disconnected.');
    }
  }
});

bot.on('photo', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user || user.status !== 'chatting' || !user.partnerId) return;
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await Media.create({
      fileId: photo.file_id,
      fileType: 'photo',
      userId: ctx.from.id,
      username: user.username,
      gender: user.gender,
      partnerId: user.partnerId,
      caption: ctx.message.caption || ''
    });
    
    await bot.telegram.sendPhoto(user.partnerId, photo.file_id, { caption: ctx.message.caption || '' });
    await User.updateOne({ userId: ctx.from.id }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(ctx.from.id);
    ctx.reply('Partner disconnected.');
  }
});

bot.on('video', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user || user.status !== 'chatting' || !user.partnerId) return;
  
  try {
    await Media.create({
      fileId: ctx.message.video.file_id,
      fileType: 'video',
      userId: ctx.from.id,
      username: user.username,
      gender: user.gender,
      partnerId: user.partnerId,
      caption: ctx.message.caption || ''
    });
    
    await bot.telegram.sendVideo(user.partnerId, ctx.message.video.file_id, { caption: ctx.message.caption || '' });
    await User.updateOne({ userId: ctx.from.id }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(ctx.from.id);
  }
});

bot.on('sticker', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (!user || user.status !== 'chatting' || !user.partnerId) return;
  
  try {
    await bot.telegram.sendSticker(user.partnerId, ctx.message.sticker.file_id);
    await User.updateOne({ userId: ctx.from.id }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(ctx.from.id);
  }
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

bot.launch();
console.log('Bot started!');

// Auto-match
setInterval(() => {
  tryAutoMatch().catch(err => console.error('Auto-match error:', err));
}, 1000);

// Reset daily
setInterval(() => {
  User.updateMany({}, { nextCount: 0 }).catch(err => console.error('Reset error:', err));
}, 24 * 60 * 60 * 1000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
