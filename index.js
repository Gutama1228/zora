const { Telegraf } = require('telegraf');
const { Pool } = require('pg');

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

// Initialize bot and database
const bot = new Telegraf(BOT_TOKEN);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize database tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id BIGINT PRIMARY KEY,
        username TEXT,
        status TEXT DEFAULT 'idle',
        partner_id BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_status ON users(status);
    `);
    console.log('✅ Database initialized');
  } catch (err) {
    console.error('❌ Database init error:', err);
  } finally {
    client.release();
  }
}

// Helper functions
async function getUser(userId) {
  const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return result.rows[0];
}

async function createOrUpdateUser(userId, username) {
  await pool.query(`
    INSERT INTO users (user_id, username, status)
    VALUES ($1, $2, 'idle')
    ON CONFLICT (user_id) 
    DO UPDATE SET username = $2, updated_at = NOW()
  `, [userId, username]);
}

async function updateUserStatus(userId, status, partnerId = null) {
  await pool.query(
    'UPDATE users SET status = $1, partner_id = $2, updated_at = NOW() WHERE user_id = $3',
    [status, partnerId, userId]
  );
}

async function findWaitingUser(excludeUserId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE status = $1 AND user_id != $2 LIMIT 1',
    ['waiting', excludeUserId]
  );
  return result.rows[0];
}

async function disconnectPair(userId) {
  const user = await getUser(userId);
  if (user && user.partner_id) {
    const partnerId = user.partner_id;
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
  const user = await getUser(userId);
  
  if (!user) {
    await createOrUpdateUser(userId, ctx.from.username || ctx.from.first_name);
  }
  
  if (user && user.status === 'chatting') {
    return ctx.reply('❌ Kamu sedang chat! Gunakan /stop untuk mengakhiri.');
  }
  
  // Cari user yang sedang waiting
  const partner = await findWaitingUser(userId);
  
  if (partner) {
    // Pair dengan partner yang ditemukan
    await updateUserStatus(userId, 'chatting', partner.user_id);
    await updateUserStatus(partner.user_id, 'chatting', userId);
    
    await ctx.reply('✅ Partner ditemukan! Mulai chat sekarang.\n\n💡 Gunakan /stop untuk mengakhiri atau /next untuk partner baru.');
    await bot.telegram.sendMessage(
      partner.user_id,
      '✅ Partner ditemukan! Mulai chat sekarang.\n\n💡 Gunakan /stop untuk mengakhiri atau /next untuk partner baru.'
    );
  } else {
    // Masuk ke waiting list
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
  
  // Langsung cari partner baru
  const partner = await findWaitingUser(userId);
  
  if (partner) {
    await updateUserStatus(userId, 'chatting', partner.user_id);
    await updateUserStatus(partner.user_id, 'chatting', userId);
    
    await ctx.reply('✅ Partner baru ditemukan! Mulai chat sekarang.');
    await bot.telegram.sendMessage(partner.user_id, '✅ Partner ditemukan! Mulai chat sekarang.');
  } else {
    await updateUserStatus(userId, 'waiting');
    await ctx.reply('🔍 Mencari partner baru... Tunggu sebentar.');
  }
});

// Handle regular messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partner_id) {
    return ctx.reply('❌ Kamu belum terhubung dengan siapapun.\n\n💡 Gunakan /find untuk mencari partner chat.');
  }
  
  try {
    await bot.telegram.sendMessage(user.partner_id, `💬 Stranger: ${ctx.message.text}`);
  } catch (err) {
    await disconnectPair(userId);
    await ctx.reply('❌ Partner tidak tersedia. Gunakan /find untuk mencari partner baru.');
  }
});

// Handle photos
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  
  if (!user || user.status !== 'chatting' || !user.partner_id) {
    return ctx.reply('❌ Kamu belum terhubung dengan siapapun.');
  }
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption || '';
    await bot.telegram.sendPhoto(user.partner_id, photo.file_id, {
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
  
  if (!user || user.status !== 'chatting' || !user.partner_id) {
    return ctx.reply('❌ Kamu belum terhubung dengan siapapun.');
  }
  
  try {
    await bot.telegram.sendSticker(user.partner_id, ctx.message.sticker.file_id);
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
  await initDB();
  
  if (process.env.NODE_ENV === 'production') {
    // Webhook mode for production
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_URL;
    if (domain) {
      await bot.telegram.setWebhook(`https://${domain}/webhook`);
      console.log('✅ Webhook set to:', domain);
    }
  } else {
    // Polling mode for development
    bot.launch();
    console.log('✅ Bot started in polling mode');
  }
}

startBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Export for serverless
module.exports = bot;
