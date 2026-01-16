const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

const bot = new Telegraf(BOT_TOKEN);

// Session storage
const userSessions = {};

// MongoDB Schemas
const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  status: { type: String, default: 'idle' }, // idle, searching, chatting
  partnerId: { type: Number, default: null },
  
  // Profile
  gender: String, // male, female, other
  hasCompletedSetup: { type: Boolean, default: false },
  
  // Stats
  totalChats: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  reportsReceived: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  
  // Premium features
  isPremium: { type: Boolean, default: false },
  premiumUntil: Date,
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const mediaSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  fileType: { type: String, required: true }, // photo, video
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
  chatContext: String,
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
    user = await User.create({
      userId,
      username,
      firstName
    });
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
  return await User.findOne({
    status: 'searching',
    userId: { $ne: userId },
    isBanned: false
  });
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
  
  // Check if user has completed setup
  if (!user.hasCompletedSetup) {
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('👨 Male', 'gender_male'),
        Markup.button.callback('👩 Female', 'gender_female')
      ],
      [Markup.button.callback('🌈 Other', 'gender_other')]
    ]);
    
    return ctx.reply(
      '🎭 *Welcome to Anonymous Chat!*\n\n' +
      'Before you start, please select your gender:\n\n' +
      '_(This helps us provide better matching for premium users)_',
      { parse_mode: 'Markdown', ...keyboard }
    );
  }
  
  // User already setup
  await ctx.reply(
    '🎭 *Welcome back to Anonymous Chat!*\n\n' +
    'Chat with random strangers anonymously.\n\n' +
    '*Commands:*\n' +
    '/search - Find a chat partner\n' +
    '/stop - End current chat\n' +
    '/next - Skip to next partner\n' +
    '/help - Show help\n\n' +
    'Start chatting now with /search',
    { parse_mode: 'Markdown' }
  );
});

// Gender selection callback
bot.action(/gender_(.+)/, async (ctx) => {
  const gender = ctx.match[1];
  
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { 
      gender, 
      hasCompletedSetup: true,
      updatedAt: Date.now()
    }
  );
  
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    '✅ *Profile completed!*\n\n' +
    'You can now start chatting anonymously.\n\n' +
    '*Commands:*\n' +
    '/search - Find a chat partner\n' +
    '/stop - End current chat\n' +
    '/next - Skip to next partner\n' +
    '/help - Show help\n\n' +
    'Start chatting now with /search',
    { parse_mode: 'Markdown' }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '📖 *How to use:*\n\n' +
    '1️⃣ Use /search to find a random partner\n' +
    '2️⃣ Start chatting when connected\n' +
    '3️⃣ Use /next to skip to another person\n' +
    '4️⃣ Use /stop to end the chat\n\n' +
    '*Available Commands:*\n' +
    '/search - Find a partner\n' +
    '/stop - End chat\n' +
    '/next - Next partner\n' +
    '/report - Report current partner\n' +
    '/stats - Your statistics\n' +
    '/help - Show this help\n\n' +
    '⚠️ Be respectful to others!',
    { parse_mode: 'Markdown' }
  );
});

bot.command('search', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getOrCreateUser(userId, ctx.from.username, ctx.from.first_name);
  
  // Check if setup completed
  if (!user.hasCompletedSetup) {
    return ctx.reply('⚠️ Please complete your profile first by using /start');
  }
  
  // Check if banned
  if (user.isBanned) {
    return ctx.reply('🚫 Your account has been banned due to multiple reports.\n\nContact support if you believe this is a mistake.');
  }
  
  if (user.status === 'chatting') {
    return ctx.reply('❌ You are already in a chat! Use /stop to end it first.');
  }
  
  if (user.status === 'searching') {
    return ctx.reply('🔍 Already searching... Please wait.');
  }
  
  // Try to find a partner
  const partner = await findPartner(userId);
  
  if (partner) {
    // Match found!
    await updateStatus(userId, 'chatting', partner.userId);
    await updateStatus(partner.userId, 'chatting', userId);
    
    // Update stats
    await User.updateOne({ userId }, { $inc: { totalChats: 1 } });
    await User.updateOne({ userId: partner.userId }, { $inc: { totalChats: 1 } });
    
    await ctx.reply(
      '✅ *Chat partner found!*\n\n' +
      'You can now start chatting.\n' +
      'Send any message to talk!\n\n' +
      '💡 /next - Skip partner\n' +
      '💡 /stop - End chat\n' +
      '💡 /report - Report partner',
      { parse_mode: 'Markdown' }
    );
    
    await bot.telegram.sendMessage(
      partner.userId,
      '✅ *Chat partner found!*\n\n' +
      'You can now start chatting.\n' +
      'Send any message to talk!\n\n' +
      '💡 /next - Skip partner\n' +
      '💡 /stop - End chat\n' +
      '💡 /report - Report partner',
      { parse_mode: 'Markdown' }
    );
  } else {
    // No partner available, start searching
    await updateStatus(userId, 'searching');
    
    await ctx.reply(
      '🔍 *Searching for a partner...*\n\n' +
      'Please wait. You will be notified when someone is found.\n\n' +
      '💡 /stop to cancel search',
      { parse_mode: 'Markdown' }
    );
  }
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user) {
    return ctx.reply('Use /search to start chatting!');
  }
  
  if (user.status === 'idle') {
    return ctx.reply('❌ You are not in a chat or searching.');
  }
  
  if (user.status === 'searching') {
    await updateStatus(userId, 'idle');
    return ctx.reply('✅ Search cancelled. Use /search to try again.');
  }
  
  // End chat
  const partnerId = await endChat(userId);
  
  if (partnerId) {
    await ctx.reply(
      '👋 *Chat ended*\n\n' +
      'Use /search to find another partner!',
      { parse_mode: 'Markdown' }
    );
    
    await bot.telegram.sendMessage(
      partnerId,
      '👋 *Partner left the chat*\n\n' +
      'Use /search to find another partner!',
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply('✅ Chat ended. Use /search to start again.');
  }
});

bot.command('next', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting') {
    return ctx.reply('❌ You need to be in a chat to use /next!\n\nUse /search to start.');
  }
  
  const partnerId = await endChat(userId);
  
  if (partnerId) {
    await bot.telegram.sendMessage(
      partnerId,
      '👋 *Partner skipped to another chat*\n\n' +
      'Use /search to find a new partner!',
      { parse_mode: 'Markdown' }
    );
  }
  
  // Immediately search for new partner
  await ctx.reply('🔄 Searching for a new partner...');
  
  const newPartner = await findPartner(userId);
  
  if (newPartner) {
    await updateStatus(userId, 'chatting', newPartner.userId);
    await updateStatus(newPartner.userId, 'chatting', userId);
    
    await User.updateOne({ userId }, { $inc: { totalChats: 1 } });
    await User.updateOne({ userId: newPartner.userId }, { $inc: { totalChats: 1 } });
    
    await ctx.reply(
      '✅ *New chat partner found!*\n\n' +
      'Start chatting now!\n\n' +
      '💡 /next - Skip\n' +
      '💡 /stop - End chat',
      { parse_mode: 'Markdown' }
    );
    
    await bot.telegram.sendMessage(
      newPartner.userId,
      '✅ *Chat partner found!*\n\n' +
      'Start chatting now!\n\n' +
      '💡 /next - Skip\n' +
      '💡 /stop - End chat',
      { parse_mode: 'Markdown' }
    );
  } else {
    await updateStatus(userId, 'searching');
    await ctx.reply(
      '🔍 *Searching for a partner...*\n\n' +
      'Please wait.',
      { parse_mode: 'Markdown' }
    );
  }
});

bot.command('stats', async (ctx) => {
  const user = await getUser(ctx.from.id);
  
  if (!user) {
    return ctx.reply('Use /start first!');
  }
  
  const totalUsers = await User.countDocuments();
  const onlineUsers = await User.countDocuments({ 
    status: { $in: ['searching', 'chatting'] } 
  });
  const totalMedia = await Media.countDocuments({ userId: ctx.from.id });
  
  const genderEmoji = {
    male: '👨',
    female: '👩',
    other: '🌈'
  };
  
  await ctx.reply(
    '📊 *Your Statistics*\n\n' +
    genderEmoji[user.gender] + ' Gender: ' + (user.gender || 'Not set') + '\n' +
    '💬 Total Chats: ' + user.totalChats + '\n' +
    '✉️ Messages Sent: ' + user.totalMessages + '\n' +
    '📸 Media Shared: ' + totalMedia + '\n' +
    '⚠️ Reports Received: ' + user.reportsReceived + '\n' +
    '⭐ Premium: ' + (user.isPremium ? 'Yes' : 'No') + '\n\n' +
    '📈 *Global Stats*\n' +
    '👥 Total Users: ' + totalUsers + '\n' +
    '🟢 Online Now: ' + onlineUsers,
    { parse_mode: 'Markdown' }
  );
});

// Report system
bot.command('report', async (ctx) => {
  const user = await getUser(ctx.from.id);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You must be in an active chat to report!\n\nUse /search to start chatting.');
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('😡 Rude/Toxic', 'report_toxic')],
    [Markup.button.callback('🔞 Inappropriate Content', 'report_nsfw')],
    [Markup.button.callback('📢 Spam', 'report_spam')],
    [Markup.button.callback('👶 Underage User', 'report_underage')],
    [Markup.button.callback('🚫 Other', 'report_other')]
  ]);
  
  await ctx.reply(
    '🔔 *Report Partner*\n\n' +
    'Please select the reason for reporting:',
    { parse_mode: 'Markdown', ...keyboard }
  );
});

// Report callback handlers
bot.action(/report_(.+)/, async (ctx) => {
  const reason = ctx.match[1];
  const user = await getUser(ctx.from.id);
  
  if (!user || !user.partnerId) {
    return ctx.answerCbQuery('❌ You are not in a chat anymore!');
  }
  
  const partner = await getUser(user.partnerId);
  
  const reasonText = {
    toxic: 'Rude/Toxic Behavior',
    nsfw: 'Inappropriate Content',
    spam: 'Spam',
    underage: 'Underage User',
    other: 'Other Violation'
  };
  
  // Save report
  await Report.create({
    reporterId: ctx.from.id,
    reporterUsername: ctx.from.username,
    reportedUserId: user.partnerId,
    reportedUsername: partner?.username,
    reason: reasonText[reason],
    chatContext: 'Active chat session'
  });
  
  // Increment reports received
  const updatedPartner = await User.findOneAndUpdate(
    { userId: user.partnerId },
    { $inc: { reportsReceived: 1 } },
    { new: true }
  );
  
  // Auto-ban after 3 reports
  if (updatedPartner.reportsReceived >= 3 && !updatedPartner.isBanned) {
    await User.findOneAndUpdate(
      { userId: user.partnerId },
      { isBanned: true }
    );
    
    try {
      await bot.telegram.sendMessage(
        user.partnerId,
        '🚫 *Account Banned*\n\n' +
        'Your account has been banned due to multiple reports.\n\n' +
        'If you believe this is a mistake, please contact support.',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Failed to notify banned user:', err);
    }
  }
  
  await ctx.answerCbQuery('✅ Report submitted successfully!');
  await ctx.editMessageText(
    '✅ *Report Submitted*\n\n' +
    'Thank you for your report. Our team will review it.\n\n' +
    'The partner has been reported for: ' + reasonText[reason] + '\n\n' +
    'You can continue chatting or use /stop to end the chat.',
    { parse_mode: 'Markdown' }
  );
});

// Handle messages
bot.on('text', async (ctx) => {
  // Ignore commands
  if (ctx.message.text.startsWith('/')) return;
  
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user) {
    return ctx.reply('Use /start to begin!');
  }
  
  if (!user.hasCompletedSetup) {
    return ctx.reply('⚠️ Please complete your profile first by using /start');
  }
  
  if (user.status === 'idle') {
    return ctx.reply('❌ You are not in a chat.\n\nUse /search to find a partner!');
  }
  
  if (user.status === 'searching') {
    return ctx.reply('🔍 Still searching for a partner... Please wait.');
  }
  
  if (user.status === 'chatting' && user.partnerId) {
    try {
      // Send message WITHOUT "Stranger:" prefix - like normal chat
      await bot.telegram.sendMessage(
        user.partnerId,
        ctx.message.text
      );
      
      await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
    } catch (err) {
      await endChat(userId);
      await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
    }
  }
});

// Handle photos
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You need to be in a chat to send photos!');
  }
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || '';
    
    // Save to database
    await saveMedia(photo.file_id, 'photo', userId, user.partnerId, caption);
    
    await bot.telegram.sendPhoto(
      user.partnerId,
      photo.file_id,
      { caption }
    );
    
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
  }
});

// Handle videos
bot.on('video', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You need to be in a chat to send videos!');
  }
  
  try {
    const caption = ctx.message.caption || '';
    
    // Save to database
    await saveMedia(ctx.message.video.file_id, 'video', userId, user.partnerId, caption);
    
    await bot.telegram.sendVideo(
      user.partnerId,
      ctx.message.video.file_id,
      { caption }
    );
    
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
  }
});

// Handle voice messages
bot.on('voice', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You need to be in a chat to send voice messages!');
  }
  
  try {
    await bot.telegram.sendVoice(user.partnerId, ctx.message.voice.file_id);
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
  }
});

// Handle stickers
bot.on('sticker', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You need to be in a chat to send stickers!');
  }
  
  try {
    await bot.telegram.sendSticker(user.partnerId, ctx.message.sticker.file_id);
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
  }
});

// Handle animations/GIFs
bot.on('animation', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You need to be in a chat to send GIFs!');
  }
  
  try {
    await bot.telegram.sendAnimation(user.partnerId, ctx.message.animation.file_id);
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
  }
});

// Handle documents
bot.on('document', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You need to be in a chat to send files!');
  }
  
  try {
    const caption = ctx.message.caption || '';
    await bot.telegram.sendDocument(
      user.partnerId, 
      ctx.message.document.file_id,
      { caption }
    );
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
  }
});

// Handle audio
bot.on('audio', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ You need to be in a chat to send audio!');
  }
  
  try {
    await bot.telegram.sendAudio(user.partnerId, ctx.message.audio.file_id);
    await User.updateOne({ userId }, { $inc: { totalMessages: 1 } });
  } catch (err) {
    await endChat(userId);
    await ctx.reply('❌ Partner disconnected.\n\nUse /search to find a new partner!');
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  ctx.reply('⚠️ An error occurred. Please try again.');
});

// Start bot
async function startBot() {
  await connectDB();
  bot.launch();
  console.log('✅ Bot started successfully!');
}

startBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));