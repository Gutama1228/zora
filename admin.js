const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Import models
const User = mongoose.model('User', new mongoose.Schema({
  userId: Number,
  username: String,
  firstName: String,
  gender: String,
  age: Number,
  isPremium: Boolean,
  premiumUntil: Date,
  status: String,
  totalChats: Number,
  totalMessages: Number,
  nextCount: Number,
  reportsReceived: Number,
  isBanned: Boolean,
  createdAt: Date
}));

const Media = mongoose.model('Media', new mongoose.Schema({
  fileId: String,
  fileType: String,
  userId: Number,
  username: String,
  gender: String,
  caption: String,
  createdAt: Date
}));

const Report = mongoose.model('Report', new mongoose.Schema({
  reporterId: Number,
  reporterUsername: String,
  reportedUserId: Number,
  reportedUsername: String,
  reason: String,
  createdAt: Date
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.isAdmin) {
    next();
  } else {
    res.redirect('/admin/login');
  }
}

// Routes
app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) {
    return res.redirect('/admin/dashboard');
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Login - Anonymous Chat Bot</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .login-container {
          background: white;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          width: 100%;
          max-width: 400px;
        }
        h1 {
          text-align: center;
          color: #333;
          margin-bottom: 30px;
          font-size: 28px;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          color: #555;
          font-weight: 500;
        }
        input {
          width: 100%;
          padding: 12px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 16px;
          transition: border-color 0.3s;
        }
        input:focus {
          outline: none;
          border-color: #667eea;
        }
        button {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
        }
        .error {
          background: #fee;
          color: #c33;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 20px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h1>🔐 Admin Login</h1>
        ${req.query.error ? '<div class="error">Invalid credentials!</div>' : ''}
        <form method="POST" action="/admin/login">
          <div class="form-group">
            <label>Username</label>
            <input type="text" name="username" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" name="password" required>
          </div>
          <button type="submit">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/admin/dashboard');
  } else {
    res.redirect('/admin/login?error=1');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.get('/admin/dashboard', requireAuth, async (req, res) => {
  const totalUsers = await User.countDocuments();
  const premiumUsers = await User.countDocuments({ isPremium: true });
  const bannedUsers = await User.countDocuments({ isBanned: true });
  const onlineUsers = await User.countDocuments({ status: { $in: ['searching', 'chatting'] } });
  const totalMedia = await Media.countDocuments();
  const totalReports = await Report.countDocuments();
  
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const newUsersToday = await User.countDocuments({ createdAt: { $gte: todayStart } });
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Dashboard</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
          background: #f5f7fa;
        }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px 40px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header h1 { font-size: 24px; }
        .logout-btn {
          background: rgba(255,255,255,0.2);
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          text-decoration: none;
          font-weight: 500;
        }
        .container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }
        .stat-card {
          background: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          transition: transform 0.2s;
        }
        .stat-card:hover {
          transform: translateY(-4px);
        }
        .stat-card .icon {
          font-size: 40px;
          margin-bottom: 15px;
        }
        .stat-card .number {
          font-size: 36px;
          font-weight: bold;
          color: #333;
          margin-bottom: 8px;
        }
        .stat-card .label {
          color: #888;
          font-size: 14px;
        }
        .menu-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }
        .menu-card {
          background: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          text-align: center;
          text-decoration: none;
          color: #333;
          transition: all 0.3s;
        }
        .menu-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        }
        .menu-card .icon {
          font-size: 48px;
          margin-bottom: 15px;
        }
        .menu-card .title {
          font-size: 18px;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🎭 Anonymous Chat Bot - Admin Panel</h1>
        <a href="/admin/logout" class="logout-btn">Logout</a>
      </div>
      <div class="container">
        <h2 style="margin-bottom: 20px; color: #333;">📊 Statistics</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="icon">👥</div>
            <div class="number">${totalUsers}</div>
            <div class="label">Total Users</div>
          </div>
          <div class="stat-card">
            <div class="icon">💎</div>
            <div class="number">${premiumUsers}</div>
            <div class="label">Premium Users</div>
          </div>
          <div class="stat-card">
            <div class="icon">🟢</div>
            <div class="number">${onlineUsers}</div>
            <div class="label">Online Now</div>
          </div>
          <div class="stat-card">
            <div class="icon">📸</div>
            <div class="number">${totalMedia}</div>
            <div class="label">Media Files</div>
          </div>
          <div class="stat-card">
            <div class="icon">🚨</div>
            <div class="number">${totalReports}</div>
            <div class="label">Total Reports</div>
          </div>
          <div class="stat-card">
            <div class="icon">🚫</div>
            <div class="number">${bannedUsers}</div>
            <div class="label">Banned Users</div>
          </div>
          <div class="stat-card">
            <div class="icon">✨</div>
            <div class="number">${newUsersToday}</div>
            <div class="label">New Today</div>
          </div>
        </div>
        
        <h2 style="margin: 40px 0 20px; color: #333;">🛠️ Management</h2>
        <div class="menu-grid">
          <a href="/admin/users" class="menu-card">
            <div class="icon">👤</div>
            <div class="title">Manage Users</div>
          </a>
          <a href="/admin/premium" class="menu-card">
            <div class="icon">💎</div>
            <div class="title">Premium Users</div>
          </a>
          <a href="/admin/reports" class="menu-card">
            <div class="icon">🚨</div>
            <div class="title">View Reports</div>
          </a>
          <a href="/admin/media" class="menu-card">
            <div class="icon">📸</div>
            <div class="title">Media Files</div>
          </a>
          <a href="/admin/banned" class="menu-card">
            <div class="icon">🚫</div>
            <div class="title">Banned Users</div>
          </a>
          <a href="/admin/broadcast" class="menu-card">
            <div class="icon">📢</div>
            <div class="title">Broadcast</div>
          </a>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/admin/users', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const skip = (page - 1) * limit;
  
  const users = await User.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  const total = await User.countDocuments();
  const totalPages = Math.ceil(total / limit);
  
  const userRows = users.map(u => `
    <tr>
      <td>${u.userId}</td>
      <td>${u.username || 'N/A'}</td>
      <td>${u.firstName || 'N/A'}</td>
      <td>${u.gender || 'N/A'}</td>
      <td>${u.age || 'N/A'}</td>
      <td>${u.isPremium ? '💎 Yes' : '🆓 No'}</td>
      <td>${u.totalChats}</td>
      <td>${u.status}</td>
      <td>
        <button onclick="viewUser(${u.userId})" class="btn-small">View</button>
        ${!u.isPremium ? `<button onclick="makePremium(${u.userId})" class="btn-small btn-premium">Make Premium</button>` : ''}
        ${!u.isBanned ? `<button onclick="banUser(${u.userId})" class="btn-small btn-danger">Ban</button>` : `<button onclick="unbanUser(${u.userId})" class="btn-small btn-success">Unban</button>`}
      </td>
    </tr>
  `).join('');
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Manage Users</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f7fa; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px 40px; }
        .header a { color: white; text-decoration: none; margin-right: 20px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 40px 20px; }
        table { width: 100%; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        th, td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; color: #333; }
        .btn-small { padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-right: 5px; }
        .btn-premium { background: #ffd700; color: #333; }
        .btn-danger { background: #ff4444; color: white; }
        .btn-success { background: #00C851; color: white; }
        .pagination { margin-top: 20px; text-align: center; }
        .pagination a { padding: 10px 15px; margin: 0 5px; background: white; border-radius: 6px; text-decoration: none; color: #667eea; }
        .pagination a.active { background: #667eea; color: white; }
      </style>
    </head>
    <body>
      <div class="header">
        <a href="/admin/dashboard">← Back to Dashboard</a>
        <span>👤 Manage Users (${total} total)</span>
      </div>
      <div class="container">
        <table>
          <thead>
            <tr>
              <th>User ID</th>
              <th>Username</th>
              <th>Name</th>
              <th>Gender</th>
              <th>Age</th>
              <th>Premium</th>
              <th>Chats</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${userRows}
          </tbody>
        </table>
        <div class="pagination">
          ${page > 1 ? `<a href="?page=${page-1}">← Previous</a>` : ''}
          <a href="?page=${page}" class="active">${page}</a>
          ${page < totalPages ? `<a href="?page=${page+1}">Next →</a>` : ''}
        </div>
      </div>
      <script>
        function viewUser(userId) {
          window.location.href = '/admin/user/' + userId;
        }
        
        async function makePremium(userId) {
          if (!confirm('Make this user premium for 30 days?')) return;
          const res = await fetch('/admin/api/make-premium', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, days: 30 })
          });
          if (res.ok) {
            alert('User is now premium!');
            location.reload();
          }
        }
        
        async function banUser(userId) {
          if (!confirm('Ban this user?')) return;
          const res = await fetch('/admin/api/ban-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ban: true })
          });
          if (res.ok) {
            alert('User banned!');
            location.reload();
          }
        }
        
        async function unbanUser(userId) {
          if (!confirm('Unban this user?')) return;
          const res = await fetch('/admin/api/ban-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ban: false })
          });
          if (res.ok) {
            alert('User unbanned!');
            location.reload();
          }
        }
      </script>
    </body>
    </html>
  `);
});

// API endpoints
app.post('/admin/api/make-premium', requireAuth, async (req, res) => {
  const { userId, days } = req.body;
  
  const premiumUntil = new Date();
  premiumUntil.setDate(premiumUntil.getDate() + days);
  
  await User.findOneAndUpdate(
    { userId },
    { 
      isPremium: true,
      premiumUntil
    }
  );
  
  res.json({ success: true });
});

app.post('/admin/api/ban-user', requireAuth, async (req, res) => {
  const { userId, ban } = req.body;
  
  await User.findOneAndUpdate(
    { userId },
    { isBanned: ban }
  );
  
  res.json({ success: true });
});

app.get('/admin/reports', requireAuth, async (req, res) => {
  const reports = await Report.find().sort({ createdAt: -1 }).limit(50);
  
  const reportRows = reports.map(r => `
    <tr>
      <td>${r.reporterUsername || r.reporterId}</td>
      <td>${r.reportedUsername || r.reportedUserId}</td>
      <td>${r.reason}</td>
      <td>${new Date(r.createdAt).toLocaleString()}</td>
      <td>
        <button onclick="viewUser(${r.reportedUserId})" class="btn-small">View User</button>
        <button onclick="banUser(${r.reportedUserId})" class="btn-small btn-danger">Ban</button>
      </td>
    </tr>
  `).join('');
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>View Reports</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f7fa; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px 40px; }
        .header a { color: white; text-decoration: none; margin-right: 20px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 40px 20px; }
        table { width: 100%; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        th, td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; color: #333; }
        .btn-small { padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-right: 5px; }
        .btn-danger { background: #ff4444; color: white; }
      </style>
    </head>
    <body>
      <div class="header">
        <a href="/admin/dashboard">← Back to Dashboard</a>
        <span>🚨 Reports (${reports.length} recent)</span>
      </div>
      <div class="container">
        <table>
          <thead>
            <tr>
              <th>Reporter</th>
              <th>Reported User</th>
              <th>Reason</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${reportRows}
          </tbody>
        </table>
      </div>
      <script>
        function viewUser(userId) {
          window.location.href = '/admin/user/' + userId;
        }
        
        async function banUser(userId) {
          if (!confirm('Ban this user?')) return;
          const res = await fetch('/admin/api/ban-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ban: true })
          });
          if (res.ok) {
            alert('User banned!');
            location.reload();
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/admin/media', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const skip = (page - 1) * limit;
  
  const media = await Media.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  const total = await Media.countDocuments();
  
  const mediaRows = media.map(m => `
    <tr>
      <td>${m.fileType}</td>
      <td>${m.username || m.userId}</td>
      <td>${m.gender || 'N/A'}</td>
      <td>${m.caption || 'No caption'}</td>
      <td>${new Date(m.createdAt).toLocaleString()}</td>
    </tr>
  `).join('');
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Media Files</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f7fa; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px 40px; }
        .header a { color: white; text-decoration: none; margin-right: 20px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 40px 20px; }
        table { width: 100%; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        th, td { padding: 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; color: #333; }
        .pagination { margin-top: 20px; text-align: center; }
        .pagination a { padding: 10px 15px; margin: 0 5px; background: white; border-radius: 6px; text-decoration: none; color: #667eea; }
      </style>
    </head>
    <body>
      <div class="header">
        <a href="/admin/dashboard">← Back to Dashboard</a>
        <span>📸 Media Files (${total} total)</span>
      </div>
      <div class="container">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>User</th>
              <th>Gender</th>
              <th>Caption</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${mediaRows}
          </tbody>
        </table>
        <div class="pagination">
          ${page > 1 ? `<a href="?page=${page-1}">← Previous</a>` : ''}
          <a href="?page=${page}">${page}</a>
          ${total > page * limit ? `<a href="?page=${page+1}">Next →</a>` : ''}
        </div>
      </div>
    </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Admin panel running on http://localhost:${PORT}/admin/login`);
});
