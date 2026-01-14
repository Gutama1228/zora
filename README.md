# 🎭 Anonymous Chat Bot - Telegram

Bot Telegram untuk chatting anonim dengan stranger secara random.

## 🚀 Cara Deploy ke Railway

### Step 1: Persiapan Project

1. **Buat folder project baru di komputer Anda:**
   ```bash
   mkdir telegram-anon-bot
   cd telegram-anon-bot
   ```

2. **Buat file-file berikut:**
   - `index.js` - Kode utama bot (copy dari artifact)
   - `package.json` - Dependencies (copy dari artifact)
   - `.env.example` - Template environment variables

3. **Install dependencies (opsional untuk testing lokal):**
   ```bash
   npm install
   ```

### Step 2: Setup Railway

1. **Login ke Railway:**
   - Buka [railway.app](https://railway.app)
   - Login dengan GitHub

2. **Buat Project Baru:**
   - Klik "New Project"
   - Pilih "Deploy from GitHub repo"
   - Atau pilih "Empty Project" jika mau upload manual

3. **Add PostgreSQL Database:**
   - Di dashboard Railway, klik "+ New"
   - Pilih "Database" → "PostgreSQL"
   - Railway akan otomatis menyediakan DATABASE_URL

### Step 3: Deploy Bot

**Opsi A: Deploy dari GitHub (Recommended)**

1. **Upload code ke GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/username/repo-name.git
   git push -u origin main
   ```

2. **Connect ke Railway:**
   - Klik "+ New" → "GitHub Repo"
   - Pilih repository Anda
   - Railway akan auto-deploy

**Opsi B: Deploy Manual**

1. **Install Railway CLI:**
   ```bash
   npm i -g @railway/cli
   ```

2. **Login dan deploy:**
   ```bash
   railway login
   railway init
   railway up
   ```

### Step 4: Set Environment Variables

Di Railway dashboard:

1. Klik project Anda
2. Pilih tab "Variables"
3. Tambahkan:
   ```
   BOT_TOKEN = your_bot_token_from_botfather
   NODE_ENV = production
   ```
   
   **Note:** `DATABASE_URL` sudah otomatis tersedia dari PostgreSQL service

### Step 5: Verifikasi

1. Check logs di Railway dashboard
2. Harus muncul: `✅ Database initialized` dan `✅ Webhook set to: ...`
3. Test bot di Telegram dengan command `/start`

## 📱 Command Bot

- `/start` - Mulai bot dan lihat instruksi
- `/find` - Cari partner chat random
- `/stop` - Hentikan chat saat ini
- `/next` - Skip partner dan cari yang baru

## 🛠️ Testing Lokal (Opsional)

1. **Setup database lokal (PostgreSQL):**
   ```bash
   # Install PostgreSQL
   # Buat database baru
   createdb telegram_bot
   ```

2. **Buat file `.env`:**
   ```
   BOT_TOKEN=your_bot_token
   DATABASE_URL=postgresql://localhost/telegram_bot
   NODE_ENV=development
   ```

3. **Jalankan bot:**
   ```bash
   npm start
   ```

## 🔧 Troubleshooting

**Bot tidak merespon:**
- Pastikan BOT_TOKEN benar
- Check logs di Railway dashboard
- Pastikan DATABASE_URL terkoneksi

**Database error:**
- Pastikan PostgreSQL service sudah running di Railway
- Check apakah DATABASE_URL sudah tersedia di environment variables

**Webhook error:**
- Railway akan otomatis provide domain
- Jika error, restart deployment

## 📊 Database Schema

```sql
users
- user_id (BIGINT, PRIMARY KEY)
- username (TEXT)
- status (TEXT) - 'idle', 'waiting', 'chatting'
- partner_id (BIGINT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

## 🎯 Fitur

✅ Random matching dengan stranger  
✅ Kirim teks, foto, dan stiker  
✅ Skip ke partner baru  
✅ Auto-disconnect saat partner offline  
✅ Database persistent  
✅ Scalable architecture  

## ⚠️ Catatan Penting

- Railway free tier: $5 credit/bulan
- Bot akan sleep jika tidak ada traffic (Railway feature)
- Untuk production serius, pertimbangkan upgrade plan
- Pastikan comply dengan Telegram ToS

## 📝 License

MIT License - Gunakan dengan bebas!

---

**Butuh bantuan?** Contact developer atau buka issue di GitHub.
