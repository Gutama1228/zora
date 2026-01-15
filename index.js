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
  
  // Profile data
  gender: { type: String, default: null }, // male, female, other
  country: { type: String, default: null },
  bio: { type: String, default: null },
  
  // Preferences
  preferredGender: { type: String, default: 'any' }, // male, female, other, any
  preferredCountry: { type: String, default: 'any' },
  
  // Statistics
  totalChats: { type: Number, default: 0 },
  totalMessages: { type: Number, default: 0 },
  reportsReceived: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const reportSchema = new mongoose.Schema({
  reporterId: { type: Number, required: true },
  reportedUserId: { type: Number, required: true },
  reason: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Report = mongoose.model('Report', reportSchema);

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

async function createOrUpdateUser(userId, username, firstName) {
  return await User.findOneAndUpdate(
    { userId },
    { 
      userId,
      username,
      firstName,
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

async function findWaitingUser(userId, preferences) {
  const user = await getUser(userId);
  
  const query = {
    status: 'waiting',
    userId: { $ne: userId },
    isBanned: false
  };
  
  // Apply gender filter
  if (preferences.preferredGender && preferences.preferredGender !== 'any') {
    query.gender = preferences.preferredGender;
  }
  
  // Apply country filter
  if (preferences.preferredCountry && preferences.preferredCountry !== 'any') {
    query.country = preferences.preferredCountry;
  }
  
  // Also check if the potential partner's preferences match current user
  const potentialPartners = await User.find(query);
  
  for (const partner of potentialPartners) {
    const genderMatch = partner.preferredGender === 'any' || partner.preferredGender === user.gender || !user.gender;
    const countryMatch = partner.preferredCountry === 'any' || partner.preferredCountry === user.country || !user.country;
    
    if (genderMatch && countryMatch) {
      return partner;
    }
  }
  
  return null;
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

async function incrementStats(userId, field) {
  const update = { updatedAt: Date.now() };
  update[field] = 1;
  await User.findOneAndUpdate({ userId }, { $inc: update });
}

// Bot commands
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  
  const user = await createOrUpdateUser(userId, username, firstName);
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⚙️ Setup Profile', 'setup_profile')],
    [Markup.button.callback('🔍 Cari Partner', 'find_partner')],
    [Markup.button.callback('📊 Statistik', 'show_stats')]
  ]);
  
  await ctx.reply(
    `👋 Selamat datang di *Zora Anonymous Chat Bot!*\n\n` +
    `🎭 Chat dengan stranger secara anonim\n\n` +
    `*Fitur Baru:*\n` +
    `👤 Filter berdasarkan gender\n` +
    `🌍 Filter berdasarkan negara\n` +
    `📊 Lihat statistik chat\n` +
    `🔔 Report system\n\n` +
    `*Perintah:*\n` +
    `/profile - Setup profile Anda\n` +
    `/find - Cari partner chat\n` +
    `/stop - Hentikan chat\n` +
    `/next - Cari partner baru\n` +
    `/stats - Lihat statistik\n` +
    `/report - Report partner\n\n` +
    `⚠️ Gunakan dengan bijak dan hormati pengguna lain!`,
    { parse_mode: 'Markdown', ...keyboard }
  );
});

bot.command('profile', async (ctx) => {
  await showProfileSetup(ctx);
});

async function showProfileSetup(ctx) {
  const user = await getUser(ctx.from.id);
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('👨 Pria', 'gender_male'),
      Markup.button.callback('👩 Wanita', 'gender_female'),
      Markup.button.callback('🌈 Lainnya', 'gender_other')
    ],
    [Markup.button.callback('🌍 Set Negara', 'set_country')],
    [Markup.button.callback('🎯 Set Preferensi', 'set_preferences')],
    [Markup.button.callback('📝 Set Bio', 'set_bio')]
  ]);
  
  const profileText = 
    `*📋 Profile Anda:*\n\n` +
    `👤 Gender: ${user.gender || 'Belum diset'}\n` +
    `🌍 Negara: ${user.country || 'Belum diset'}\n` +
    `📝 Bio: ${user.bio || 'Belum diset'}\n\n` +
    `*🎯 Preferensi Partner:*\n` +
    `Gender: ${user.preferredGender || 'any'}\n` +
    `Negara: ${user.preferredCountry || 'any'}`;
  
  await ctx.reply(profileText, { parse_mode: 'Markdown', ...keyboard });
}

// Gender selection
bot.action(/gender_(.+)/, async (ctx) => {
  const gender = ctx.match[1];
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { gender, updatedAt: Date.now() }
  );
  
  await ctx.answerCbQuery('✅ Gender berhasil diupdate!');
  await showProfileSetup(ctx);
});

// Country setup
bot.action('set_country', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '🌍 *Set Negara Anda*\n\n' +
    'Ketik nama negara Anda, contoh:\n' +
    '`Indonesia`\n' +
    '`Malaysia`\n' +
    '`Singapore`',
    { parse_mode: 'Markdown' }
  );
  
  ctx.session = { awaitingCountry: true };
});

// Preferences setup
bot.action('set_preferences', async (ctx) => {
  await ctx.answerCbQuery();
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('👨 Cari Pria', 'pref_gender_male')],
    [Markup.button.callback('👩 Cari Wanita', 'pref_gender_female')],
    [Markup.button.callback('🌈 Cari Semua', 'pref_gender_any')],
    [Markup.button.callback('🌍 Set Negara Preferensi', 'pref_country')]
  ]);
  
  await ctx.reply(
    '🎯 *Set Preferensi Partner*\n\n' +
    'Pilih gender partner yang Anda cari:',
    { parse_mode: 'Markdown', ...keyboard }
  );
});

bot.action(/pref_gender_(.+)/, async (ctx) => {
  const preferredGender = ctx.match[1];
  await User.findOneAndUpdate(
    { userId: ctx.from.id },
    { preferredGender, updatedAt: Date.now() }
  );
  
  const genderText = {
    male: 'Pria',
    female: 'Wanita',
    any: 'Semua Gender'
  };
  
  await ctx.answerCbQuery(`✅ Preferensi diset ke: ${genderText[preferredGender]}`);
  await showProfileSetup(ctx);
});

bot.action('pref_country', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '🌍 *Set Negara Preferensi*\n\n' +
    'Ketik negara partner yang Anda cari, atau ketik `any` untuk semua negara.\n\n' +
    'Contoh: `Indonesia` atau `any`',
    { parse_mode: 'Markdown' }
  );
  
  ctx.session = { awaitingPrefCountry: true };
});

// Bio setup
bot.action('set_bio', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '📝 *Set Bio Anda*\n\n' +
    'Ketik bio Anda (maksimal 150 karakter).\n' +
    'Bio ini TIDAK akan dilihat partner!',
    { parse_mode: 'Markdown' }
  );
  
  ctx.session = { awaitingBio: true };
});

// Find partner
bot.command('find', async (ctx) => {
  await handleFindPartner(ctx);
});

bot.action('find_partner', async (ctx) => {
  await ctx.answerCbQuery();
  await handleFindPartner(ctx);
});

async function handleFindPartner(ctx) {
  const userId = ctx.from.id;
  let user = await getUser(userId);
  
  if (!user) {
    await createOrUpdateUser(userId, ctx.from.username, ctx.from.first_name);
    user = await getUser(userId);
  }
  
  if (user.isBanned) {
    return ctx.reply('❌ Anda telah dibanned karena terlalu banyak laporan.');
  }
  
  if (user.status === 'chatting') {
    return ctx.reply('❌ Anda sedang chat! Gunakan /stop untuk mengakhiri.');
  }
  
  const partner = await findWaitingUser(userId, user);
  
  if (partner) {
    await updateUserStatus(userId, 'chatting', partner.userId);
    await updateUserStatus(partner.userId, 'chatting', userId);
    
    await incrementStats(userId, 'totalChats');
    await incrementStats(partner.userId, 'totalChats');
    
    await ctx.reply('✅ Partner ditemukan! Mulai chat sekarang.\n\n💡 /stop - mengakhiri | /next - partner baru | /report - laporkan');
    await bot.telegram.sendMessage(partner.userId, '✅ Partner ditemukan! Mulai chat sekarang.\n\n💡 /stop - mengakhiri | /next - partner baru | /report - laporkan');
  } else {
    await updateUserStatus(userId, 'waiting');
    
    const prefText = [];
    if (user.preferredGender !== 'any') prefText.push(`Gender: ${user.preferredGender}`);
    if (user.preferredCountry !== 'any') prefText.push(`Negara: ${user.preferredCountry}`);
    
    const filterInfo = prefText.length > 0 ? `\n\n🎯 Filter aktif: ${prefText.join(', ')}` : '';
    
    await ctx.reply(`🔍 Mencari partner... Tunggu sebentar.${filterInfo}\n\n💡 Anda akan otomatis terhubung saat ada partner tersedia.`);
  }
}

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
  
  await handleFindPartner(ctx);
});

// Statistics
bot.command('stats', async (ctx) => {
  await showStats(ctx);
});

bot.action('show_stats', async (ctx) => {
  await ctx.answerCbQuery();
  await showStats(ctx);
});

async function showStats(ctx) {
  const user = await getUser(ctx.from.id);
  
  if (!user) {
    return ctx.reply('❌ Gunakan /start terlebih dahulu!');
  }
  
  const totalUsers = await User.countDocuments();
  const activeUsers = await User.countDocuments({ status: { $in: ['waiting', 'chatting'] } });
  
  const statsText = 
    `📊 *Statistik Anda:*\n\n` +
    `💬 Total Chat: ${user.totalChats}\n` +
    `✉️ Total Pesan: ${user.totalMessages}\n` +
    `⚠️ Laporan Diterima: ${user.reportsReceived}\n\n` +
    `📈 *Statistik Global:*\n` +
    `👥 Total Users: ${totalUsers}\n` +
    `🟢 Sedang Online: ${activeUsers}`;
  
  await ctx.reply(statsText, { parse_mode: 'Markdown' });
}

// Report system
bot.command('report', async (ctx) => {
  const user = await getUser(ctx.from.id);
  
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ Anda harus sedang chat untuk melaporkan partner!');
  }
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('😡 Kasar/Toxic', 'report_toxic')],
    [Markup.button.callback('🔞 Konten Dewasa', 'report_nsfw')],
    [Markup.button.callback('📢 Spam', 'report_spam')],
    [Markup.button.callback('🚫 Lainnya', 'report_other')]
  ]);
  
  await ctx.reply(
    '🔔 *Report Partner*\n\n' +
    'Pilih alasan report:',
    { parse_mode: 'Markdown', ...keyboard }
  );
});

bot.action(/report_(.+)/, async (ctx) => {
  const reason = ctx.match[1];
  const user = await getUser(ctx.from.id);
  
  if (!user || !user.partnerId) {
    return ctx.answerCbQuery('❌ Anda tidak sedang chat!');
  }
  
  const report = new Report({
    reporterId: ctx.from.id,
    reportedUserId: user.partnerId,
    reason
  });
  
  await report.save();
  
  const reportedUser = await User.findOneAndUpdate(
    { userId: user.partnerId },
    { $inc: { reportsReceived: 1 } },
    { new: true }
  );
  
  // Auto-ban if too many reports
  if (reportedUser.reportsReceived >= 5) {
    await User.findOneAndUpdate(
      { userId: user.partnerId },
      { isBanned: true }
    );
    await bot.telegram.sendMessage(
      user.partnerId,
      '⛔ Akun Anda telah dibanned karena terlalu banyak laporan. Hubungi admin jika ini kesalahan.'
    );
  }
  
  await ctx.answerCbQuery('✅ Laporan berhasil dikirim!');
  await ctx.reply('✅ Partner telah dilaporkan. Terima kasih atas laporannya!');
});

// Handle text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  // Handle profile setup inputs
  if (ctx.session?.awaitingCountry) {
    await User.findOneAndUpdate({ userId }, { country: ctx.message.text, updatedAt: Date.now() });
    ctx.session = {};
    await ctx.reply('✅ Negara berhasil diset!');
    return showProfileSetup(ctx);
  }
  
  if (ctx.session?.awaitingPrefCountry) {
    await User.findOneAndUpdate({ userId }, { preferredCountry: ctx.message.text, updatedAt: Date.now() });
    ctx.session = {};
    await ctx.reply('✅ Preferensi negara berhasil diset!');
    return showProfileSetup(ctx);
  }
  
  if (ctx.session?.awaitingBio) {
    const bio = ctx.message.text.substring(0, 150);
    await User.findOneAndUpdate({ userId }, { bio, updatedAt: Date.now() });
    ctx.session = {};
    await ctx.reply('✅ Bio berhasil diset!');
    return showProfileSetup(ctx);
  }
  
  // Handle chat messages
  if (!user || user.status !== 'chatting' || !user.partnerId) {
    return ctx.reply('❌ Anda belum terhubung dengan siapapun.\n\n💡 Gunakan /find untuk mencari partner chat.');
  }
  
  try {
    await bot.telegram.sendMessage(user.partnerId, `💬 Stranger: ${ctx.message.text}`);
    await incrementStats(userId, 'totalMessages');
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
    return ctx.reply('❌ Anda belum terhubung dengan siapapun.');
  }
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || '';
    await bot.telegram.sendPhoto(user.partnerId, photo.file_id, {
      caption: `📷 Stranger: ${caption}`
    });
    await incrementStats(userId, 'totalMessages');
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
    return ctx.reply('❌ Anda belum terhubung dengan siapapun.');
  }
  
  try {
    await bot.telegram.sendSticker(user.partnerId, ctx.message.sticker.file_id);
    await incrementStats(userId, 'totalMessages');
  } catch (err) {
    await disconnectPair(userId);
    await ctx.reply('❌ Partner tidak tersedia. Gunakan /find untuk mencari partner baru.');
  }
});

bot.catch((err, ctx) => {
  console.error('❌ Bot error:', err);
  ctx.reply('⚠️ Terjadi error. Silakan coba lagi.');
});

async function startBot() {
  await connectDB();
  bot.launch();
  console.log('✅ Bot started successfully!');
}

startBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
