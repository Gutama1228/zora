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
  status: { type: String, default: 'idle' }, // idle, searching, chatting
  partnerId: { type: Number, default: null },
  
  // Stats
  totalChats: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  
  // Premium features (for future)
  isPremium: { type: Boolean, default: false },
  gender: String,
  age: Number,
  country: String,
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

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
    userId: { $ne: userId }
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

// Commands
bot.start(async (ctx) => {
  await getOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  
  await ctx.reply(
    '🎭 *Welcome to Anonymous Chat!*\n\n' +
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
    '/stats - Your statistics\n' +
    '/help - Show this help\n\n' +
    '⚠️ Be respectful to others!',
    { parse_mode: 'Markdown' }
  );
});

bot.command('search', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getOrCreateUser(userId, ctx.from.username, ctx.from.first_name);
  
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
      '💡 /stop - End chat',
      { parse_mode: 'Markdown' }
    );
    
    await bot.telegram.sendMessage(
      partner.userId,
      '✅ *Chat partner found!*\n\n' +
      'You can now start chatting.\n' +
      'Send any message to talk!\n\n' +
      '💡 /next - Skip partner\n' +
      '💡 /stop - End chat',
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
  
  await ctx.reply(
    '📊 *Your Statistics*\n\n' +
    '💬 Total Chats: ' + user.totalChats + '\n' +
    '✉️ Messages Sent: ' + user.totalMessages + '\n\n' +
    '📈 *Global Stats*\n' +
    '👥 Total Users: ' + totalUsers + '\n' +
    '🟢 Online Now: ' + onlineUsers,
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
  
  if (user.status === 'idle') {
    return ctx.reply('❌ You are not in a chat.\n\nUse /search to find a partner!');
  }
  
  if (user.status === 'searching') {
    return ctx.reply('🔍 Still searching for a partner... Please wait.');
  }
  
  if (user.status === 'chatting' && user.partnerId) {
    try {
      await bot.telegram.sendMessage(
        user.partnerId,
        '💬 *Stranger:* ' + ctx.message.text,
        { parse_mode: 'Markdown' }
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
    const caption = ctx.message.caption 
      ? '📷 *Stranger:* ' + ctx.message.caption
      : '📷 *Stranger sent a photo*';
    
    await bot.telegram.sendPhoto(
      user.partnerId,
      photo.file_id,
      { caption, parse_mode: 'Markdown' }
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
    const caption = ctx.message.caption 
      ? '🎥 *Stranger:* ' + ctx.message.caption
      : '🎥 *Stranger sent a video*';
    
    await bot.telegram.sendVideo(
      user.partnerId,
      ctx.message.video.file_id,
      { caption, parse_mode: 'Markdown' }
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