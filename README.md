# 🎭 Anonymous Chat Bot - Complete System

Full-featured anonymous chat bot like @chatbot with premium features and admin panel.

## 🚀 Features

### User Features:
- ✅ Anonymous random chat
- ✅ Gender & age filter (Premium)
- ✅ Unlimited /next for premium
- ✅ Media support (photos, videos, voice, stickers, GIFs)
- ✅ Report system
- ✅ Statistics tracking

### Admin Panel Features:
- 📊 Dashboard with statistics
- 👤 User management
- 💎 Premium management
- 🚨 Report viewing
- 📸 Media monitoring
- 🚫 Ban/unban users
- 📢 Broadcast messages (coming soon)

## 📦 Installation

### 1. Clone & Install
```bash
git clone <your-repo>
cd telegram-anon-bot
npm install
```

### 2. Environment Variables

Create `.env` file:
```env
# Bot Configuration
BOT_TOKEN=your_bot_token_here
MONGODB_URI=your_mongodb_uri_here

# Admin Panel
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_this_password
PORT=3000
```

### 3. Run Bot
```bash
npm start
```

### 4. Run Admin Panel (separate terminal)
```bash
npm run admin
```

## 🌐 Deploy to Railway

### Method 1: One Service (Bot + Admin)

1. **Create `Procfile`:**
```
web: node admin.js
worker: node index.js
```

2. **Railway Settings:**
- Add both processes
- Set environment variables
- Deploy

### Method 2: Two Services (Recommended)

**Service 1 - Bot:**
- Deploy `index.js`
- No need for PORT variable

**Service 2 - Admin Panel:**
- Deploy `admin.js`  
- Set PORT variable
- Railway will provide public URL

## 🔐 Admin Panel Access

After deployment:
- URL: `https://your-railway-url.railway.app/admin/login`
- Username: From `ADMIN_USERNAME` env
- Password: From `ADMIN_PASSWORD` env

**Default credentials (CHANGE THESE!):**
- Username: `admin`
- Password: `admin123`

## 📊 Admin Panel Features

### Dashboard
- Total users, premium users, online users
- Media files count
- Reports count
- New users today

### User Management
- View all users
- Search users
- Make user premium
- Ban/unban users
- View user details

### Premium Management
- Grant premium access (30 days)
- View premium users
- Extend premium period

### Reports
- View all reports
- Ban reported users
- Report analytics

### Media Monitoring
- View all shared media
- Filter by type/user/gender
- Track media usage

## 💎 Making Users Premium

### Via Admin Panel:
1. Go to "Manage Users"
2. Find user
3. Click "Make Premium"
4. Choose duration (30 days default)

### Via Database:
```javascript
db.users.updateOne(
  { userId: 123456789 },
  {
    $set: {
      isPremium: true,
      premiumUntil: new Date('2026-02-16')
    }
  }
)
```

## 🎯 Bot Commands

### User Commands:
- `/start` - Start bot & setup
- `/search` or 🔍 Search - Find stranger
- `/next` - Skip to next (5/day free, unlimited premium)
- `/stop` - End chat
- `/report` - Report user
- `/stats` or 📊 Stats - View statistics
- `/premium` or 💎 Premium - View premium info
- `/help` or ❓ Help - Show help
- `⚙️ Settings` - Premium settings (Premium only)

## 🔧 Configuration

### Free User Limits:
- `/next`: 5 times per day
- No gender filter
- No age filter
- Regular matching speed

### Premium Benefits:
- Unlimited `/next`
- Gender filter
- Age filter
- Priority matching
- Ad-free

## 📊 Database Structure

### Users Collection:
```javascript
{
  userId: Number,
  username: String,
  gender: String,
  age: Number,
  isPremium: Boolean,
  premiumUntil: Date,
  filterGender: String,
  filterAgeMin: Number,
  filterAgeMax: Number,
  totalChats: Number,
  nextCount: Number, // resets daily
  isBanned: Boolean
}
```

### Media Collection:
```javascript
{
  fileId: String,
  fileType: String, // photo/video
  userId: Number,
  username: String,
  gender: String,
  caption: String,
  createdAt: Date
}
```

### Reports Collection:
```javascript
{
  reporterId: Number,
  reportedUserId: Number,
  reason: String,
  createdAt: Date
}
```

## 🔒 Security

### Admin Panel:
- Session-based authentication
- Secure password hashing (ready for bcrypt)
- Protected routes
- HTTPS recommended for production

### Bot:
- Auto-ban after 3 reports
- Media tracking
- User verification
- Report system

## 📈 Monitoring

### Admin Dashboard shows:
- Total users
- Premium users
- Online users
- Media shared
- Total reports
- Banned users
- New users today

## 🐛 Troubleshooting

### Bot not responding:
- Check `BOT_TOKEN` in env
- Check MongoDB connection
- Check Railway logs

### Admin panel not accessible:
- Check PORT variable
- Check if service is running
- Check environment variables

### Users can't find partners:
- Check auto-match interval (1 second)
- Check if users are banned
- Check MongoDB connection

## 🚀 Performance

- Auto-match every 1 second
- Daily /next reset at midnight
- Efficient database queries
- Scalable architecture

## 📝 License

MIT License - Feel free to use!

## 💬 Support

For issues or questions:
- Check logs in Railway
- Review environment variables
- Contact developer

---

**Built with ❤️ for the community**
