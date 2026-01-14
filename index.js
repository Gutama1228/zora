const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// MongoDB Schema
const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  username: String,
  status: { type: String, default: 'idle' }, // idle, waiting, chatting
  partnerId: { type: Number, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// Helper functions
async function getUser(userId) {
  return await User.findOne({ userId });
}

async function createOrUpdateUser(userId, username) {
  await User.findOneAndUpdate(
    { userId },
    { 
      userId,
      username,
      status: 'idle',
      updatedAt: Date.now()
    },
    { upsert: true, new: true }
  );
}

async function updateUserStatus(userId, status, partnerId = null) {
  await User.findOneAndUpdate(
    { userId },
    { status, partnerId, updatedAt: Date.now() }
  );
}

async function findWaitingUser(excludeUserId) {
  return await User.findOne({
    status: 'waiting',
    userId: { $ne: excludeUserId }
  });
}

async function disconnectPair(userId) {
  const user = await getUser(userId);
  if (user && user.partnerId) {
    const partnerId = user.partnerId;
    await updateUserStatus(userId, 'idle');
    await updateUserStatus(partnerId, 'idle');
    return partnerId;
  }
  return null;
}

// Bot commands
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  
  await createOrUpdateUser(userId, username);
  
  await ctx.reply(
    '👋 Selamat datang di Anonymous Chat Bot!\n\n' +
    '🎭 Chat dengan stranger secara anonim\n\n' +
    'Perintah:\n' +
    '/find - Cari partner chat\n' +
    '/stop - Hentikan chat\n' +
    '/next - Cari partner baru\n\n' +
    '⚠️ Gunakan dengan bijak dan hormati pengguna lain!'
  );
});

bot.command('find', async (ctx) => {
  const userId = ctx.from.id;
  let user = await getUser(userId);
  
  if (!user) {
    await createOrUpdateUser(userId, ctx.from.username || ctx.from.first_name);
    user = await getUser(userId);
  }
  
  if (user.status === 'chatting') {
    return ctx.reply('❌ Kamu sedang chat! Gunakan /stop untuk mengakhiri.');
  }
  
  const partner = await findWaitingUser(userId);
  
  if (partner) {
    await updateUserStatus(userId, 'chatting', partner.userId);
    await updateUserStatus(partner.userId, 'chatting', userId);
    
    await ctx.reply('✅ Partner ditemukan! Mulai chat sekarang.\n\n💡 Gunakan /stop untuk mengakhiri atau /next untuk partner baru.');
    await bot.telegram.sendMessage(
      partner.userId,
      '✅ Partner ditemukan! Mulai chat sekarang.\n\n💡 Gunakan /stop untuk mengakhiri atau /next untuk partner baru.'
    );
  } else {
    await updateUserStatus(userId, 'waiting');
    await ctx.reply('🔍 Mencari partner... Tunggu sebentar.\n\n💡 Kamu akan otomatis terhubung saat ada partner tersedia.');
  }
});

bot.command('stop', async (ctx) => {
  const userId = ctx.from.id;
  const partnerId = await disconnectPair(userId);
  
  if (partnerId) {
    await ctx.reply('👋 Chat diakhiri. Gunakan /find untuk mencari partner baru.');
    await bot.telegram.sendMessage(partnerId, '👋 Partner telah mengakhiri chat. Gunakan /find untuk mencari partner baru.');
  } else {
    await updateUserStatus(userId, 'idle');
    await ctx.reply('✅ Status direset. Gunakan /find untuk mencari partner.');
  }
});

bot.command('next', async (ctx) => {
  const userId = ctx.from.id;
  const partnerId = await disconnectPair(userId);
  
  if (partnerId) {
    await bot.telegram.sendMessage(partnerId, '👋 Partner telah pindah ke chat lain. Gunakan /find untuk mencari partner baru.');
  }
  
  const partner = await findWaitingUser(userId);
  
  if (partner) {
    await updateUserStatus(userId, 'chatting', partner.userId);
    await updateUserStatus(partner.userId, 'chatting', userId);
    
    await ctx.reply('✅ Partner baru ditemukan! Mulai chat sekarang.');
    await bot.telegram.sendMessage(partner.userId, '✅ Partner ditemukan! Mulai chat sekarang.');
  } else {
    await updateUserStatus(userId, 'waiting');
    await ctx.reply('🔍 Mencari partner baru... Tunggu sebentar.');
  }
});

// Handle regular messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ Kamu belum terhubung dengan siapapun.\n\n💡 Gunakan /find untuk mencari partner chat.');
  }
  
  try {
    await bot.telegram.sendMessage(user.partnerId, `💬 Stranger: ${ctx.message.text}`);
  } catch (err) {
    await disconnectPair(userId);
    await ctx.reply('❌ Partner tidak tersedia. Gunakan /find untuk mencari partner baru.');
  }
});

// Handle photos
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ Kamu belum terhubung dengan siapapun.');
  }
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || '';
    await bot.telegram.sendPhoto(user.partnerId, photo.file_id, {
      caption: `📷 Stranger: ${caption}`
    });
  } catch (err) {
    await disconnectPair(userId);
    await ctx.reply('❌ Partner tidak tersedia. Gunakan /find untuk mencari partner baru.');
  }
});

// Handle stickers
bot.on('sticker', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ Kamu belum terhubung dengan siapapun.');
  }
  
  try {
    await bot.telegram.sendSticker(user.partnerId, ctx.message.sticker.file_id);
  } catch (err) {
    await disconnectPair(userId);
    await ctx.reply('❌ Partner tidak tersedia. Gunakan /find untuk mencari partner baru.');
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  ctx.reply('⚠️ Terjadi error. Silakan coba lagi.');
});

// Start bot
async function startBot() {
  await connectDB();
  bot.launch();
  console.log('✅ Bot started successfully!');
}

startBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
