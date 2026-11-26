import { adminAuth, warnIfUnprotected } from './auth.js';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

function ensureTelegramImageSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      execSync(`sips -Z 2048 "${filePath}"`, { stdio: 'ignore' });
    }
  } catch (_) {}
}


const PORT = process.env.PORT || 3789;
const app = express();

// ====================================================
// 1. CONFIGURATION READ & WRITE HELPERS
// ====================================================
function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading config.json:', err.message);
  }
  return {};
}

function saveConfig(data) {
  if (data.bot1) {
    data.bot_name = data.bot1.bot_name;
    data.welcome = data.bot1.welcome;
    data.today = data.bot1.today;
    data.free = data.bot1.free;
    data.messageLists = data.bot1.messageLists;
    data.help = data.bot1.help;
    data.terms = data.bot1.terms;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ====================================================
// 2. INBOUND TRAFFIC LOGGER & API TRACKER
// ====================================================
const MAX_LOGS = 100;
const apiCallLogs = [];
const apiHitCounts = {
  outbound: {},
  inbound: {}
};

function recordApiCall(entry) {
  apiCallLogs.unshift(entry);
  if (apiCallLogs.length > MAX_LOGS) apiCallLogs.pop();

  if (entry.direction === 'inbound') {
    const key = `${entry.method} ${entry.path.split('?')[0]}`;
    apiHitCounts.inbound[key] = (apiHitCounts.inbound[key] || 0) + 1;
  }
}

app.use((req, res, next) => {
  const start = Date.now();
  const timeStr = new Date().toLocaleTimeString();
  res.on('finish', () => {
    const url = req.originalUrl || req.url;
    if (!url.startsWith('/assets') && !url.endsWith('.ico') && !url.endsWith('.css') && !url.endsWith('.js')) {
      const duration = Date.now() - start;
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      console.log(`📥 [HTTP INBOUND ${timeStr}] ${req.method} ${url} | Status: ${res.statusCode} (${duration}ms) | IP: ${clientIp}`);
      recordApiCall({
        time: timeStr,
        direction: 'inbound',
        method: req.method,
        path: url,
        status: res.statusCode,
        ip: clientIp,
        duration: `${duration}ms`
      });
    }
  });
  next();
});

// Middleware for parsing JSON and serving static assets
app.use(adminAuth);
warnIfUnprotected();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Multer storage for media uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, 'assets');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const prefix = file.fieldname === 'video' ? 'video' : file.fieldname === 'free_image' ? 'free' : (file.fieldname === 'today_media' || file.fieldname === 'today_image' ? 'today' : 'welcome');
    const ext = path.extname(file.originalname);
    cb(null, `${prefix}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ====================================================
// 3. WEB PAGES & DASHBOARD ROUTES
// ====================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// ====================================================
// 4. REST APIS FOR DASHBOARD & CONFIGURATION
// ====================================================

// API: Terms & Policy
app.get('/api/terms', (req, res) => {
  const config = getConfig();
  const terms = config.bot1?.terms || {};
  res.json({
    title: terms.title || 'Terms & Policy',
    content: terms.content || '',
    windowMode: terms.windowMode || 'dialog',
    buttonText: terms.buttonText || '≼ Terms & Policy ≽',
    lastUpdated: terms.lastUpdated || new Date().toISOString().slice(0, 10)
  });
});

// API: Config Get & Save
app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

app.post('/api/config', (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ success: true, message: 'Configuration saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload Media
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath });
});

app.post('/api/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath, originalName: req.file.originalname });
});

app.post('/api/upload-free-image', upload.single('free_image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath, originalName: req.file.originalname });
});

app.post('/api/upload-free-media', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  const isVideo = req.file.mimetype.startsWith('video') || /\.(mp4|mov|avi|mkv|webm)$/i.test(req.file.originalname);
  if (!isVideo && req.file.path) {
    ensureTelegramImageSafe(req.file.path);
  }
  res.json({
    success: true,
    path: relativePath,
    mediaType: isVideo ? 'video' : 'photo',
    originalName: req.file.originalname
  });
});

// API: Bot 1 Free Messages Management
app.post('/api/bot1/toggle-free-status', (req, res) => {
  const { id, status } = req.body;
  if (!id) return res.status(400).json({ error: 'Message ID is required' });

  const config = getConfig();
  const messages = config.bot1?.free?.messages || [];
  const target = messages.find((m) => m.id === id);
  if (!target) return res.status(404).json({ error: 'Free message not found' });

  target.status = status || (target.status === 'active' ? 'archived' : 'active');
  saveConfig(config);
  res.json({ success: true, status: target.status, message: target });
});

app.post('/api/bot1/duplicate-free-message', (req, res) => {
  const { id } = req.body;
  const config = getConfig();
  const messages = config.bot1?.free?.messages || [];
  const source = messages.find((m) => m.id === id);
  if (!source) return res.status(404).json({ error: 'Source free message not found' });

  const newId = `free_msg_${Date.now()}`;
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = newId;
  copy.title = `${source.title || 'Free Drop'} (Copy)`;
  copy.status = 'active';
  copy.createdAt = new Date().toISOString();

  messages.unshift(copy);
  saveConfig(config);
  res.json({ success: true, message: copy });
});

app.post('/api/bot1/delete-free-message', (req, res) => {
  const { id } = req.body;
  const config = getConfig();
  if (!config.bot1?.free?.messages) return res.status(404).json({ error: 'No free messages found' });

  const initialLen = config.bot1.free.messages.length;
  config.bot1.free.messages = config.bot1.free.messages.filter((m) => m.id !== id);

  if (config.bot1.free.messages.length === initialLen) {
    return res.status(404).json({ error: 'Message not found' });
  }

  saveConfig(config);
  res.json({ success: true });
});

// API: Upload custom media for Today Drops Preview / Revealed Content
app.post('/api/upload-today-media', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  const isVideo = req.file.mimetype.startsWith('video') || /\.(mp4|mov|avi|mkv|webm)$/i.test(req.file.originalname);
  res.json({
    success: true,
    path: relativePath,
    mediaType: isVideo ? 'video' : 'photo',
    originalName: req.file.originalname
  });
});

// API: Bot 1 Today Messages Management
app.post('/api/bot1/toggle-today-status', (req, res) => {
  const { id, status } = req.body;
  if (!id) return res.status(400).json({ error: 'Message ID is required' });

  const config = getConfig();
  const messages = config.bot1?.today?.messages || [];
  const target = messages.find((m) => m.id === id);
  if (!target) return res.status(404).json({ error: 'Today message not found' });

  target.status = status || (target.status === 'active' ? 'archived' : 'active');
  saveConfig(config);
  res.json({ success: true, status: target.status, message: target });
});

app.post('/api/bot1/duplicate-today-message', (req, res) => {
  const { id } = req.body;
  const config = getConfig();
  const messages = config.bot1?.today?.messages || [];
  const source = messages.find((m) => m.id === id);
  if (!source) return res.status(404).json({ error: 'Source today message not found' });

  const newId = `today_msg_${Date.now()}`;
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = newId;
  copy.title = `${source.title || "Today's Drop"} (Copy)`;
  copy.status = 'active';
  copy.createdAt = new Date().toISOString();

  messages.unshift(copy);
  saveConfig(config);
  res.json({ success: true, message: copy });
});

app.post('/api/bot1/delete-today-message', (req, res) => {
  const { id } = req.body;
  const config = getConfig();
  if (!config.bot1?.today?.messages) return res.status(404).json({ error: 'No today messages found' });

  const initialLen = config.bot1.today.messages.length;
  config.bot1.today.messages = config.bot1.today.messages.filter((m) => m.id !== id);

  if (config.bot1.today.messages.length === initialLen) {
    return res.status(404).json({ error: 'Message not found' });
  }

  saveConfig(config);
  res.json({ success: true });
});

// API: Message Lists & Bottom Buttons Management
app.get('/api/bot1/message-lists', (req, res) => {
  const config = getConfig();
  res.json({
    lists: config.bot1?.messageLists || config.messageLists || [],
    bottomButtons: config.bot1?.welcome?.bottomButtons || []
  });
});

app.post('/api/bot1/create-message-list', (req, res) => {
  const { title, command, deliveryMode, targetBot } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const config = getConfig();
  if (!config.bot1.messageLists) config.bot1.messageLists = [];

  const listId = 'list_' + Date.now();
  const newList = {
    id: listId,
    title: title.trim(),
    command: (command || '').replace(/^\//, '').trim() || `list_${config.bot1.messageLists.length + 1}`,
    deliveryMode: deliveryMode || 'all_in_one',
    targetBot: targetBot || 'bot2',
    messages: []
  };

  config.bot1.messageLists.push(newList);
  saveConfig(config);
  res.json({ success: true, list: newList });
});

app.post('/api/bot1/update-message-list', (req, res) => {
  const { id, title, command, deliveryMode, targetBot } = req.body;
  if (!id) return res.status(400).json({ error: 'List ID is required' });

  const config = getConfig();
  const lists = config.bot1?.messageLists || [];
  const list = lists.find((l) => l.id === id);
  if (!list) return res.status(404).json({ error: 'List not found' });

  if (title) list.title = title.trim();
  if (command !== undefined) list.command = command.replace(/^\//, '').trim();
  if (deliveryMode) list.deliveryMode = deliveryMode;
  if (targetBot) list.targetBot = targetBot;

  saveConfig(config);
  res.json({ success: true, list });
});

app.post('/api/bot1/delete-message-list', (req, res) => {
  const { id } = req.body;
  const config = getConfig();
  if (!config.bot1?.messageLists) return res.status(404).json({ error: 'No lists found' });

  config.bot1.messageLists = config.bot1.messageLists.filter((l) => l.id !== id);
  saveConfig(config);
  res.json({ success: true });
});

app.post('/api/bot1/save-bottom-buttons', (req, res) => {
  const { bottomButtons } = req.body;
  if (!Array.isArray(bottomButtons)) return res.status(400).json({ error: 'bottomButtons must be an array' });

  const config = getConfig();
  if (!config.bot1.welcome) config.bot1.welcome = {};
  config.bot1.welcome.bottomButtons = bottomButtons;

  saveConfig(config);
  res.json({ success: true, bottomButtons });
});

app.post('/api/bot2/reset-limits', (req, res) => {
  console.log('🔄 All Bot 2 user limits reset via server.js API');
  res.json({ success: true, message: 'All user limit counters reset' });
});

// API: Bot 2 Messages Management
app.post('/api/bot2/toggle-status', (req, res) => {
  const { id, status } = req.body;
  if (!id) return res.status(400).json({ error: 'Message ID is required' });

  const config = getConfig();
  const messages = config.bot2?.messages || [];
  const target = messages.find((m) => m.id === id);
  if (!target) return res.status(404).json({ error: 'Message not found' });

  target.status = status || (target.status === 'active' ? 'archived' : 'active');
  saveConfig(config);
  res.json({ success: true, status: target.status, message: target });
});

app.post('/api/bot2/duplicate-message', (req, res) => {
  const { id } = req.body;
  const config = getConfig();
  const messages = config.bot2?.messages || [];
  const source = messages.find((m) => m.id === id);
  if (!source) return res.status(404).json({ error: 'Message not found' });

  const newId = `msg_${Date.now()}`;
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = newId;
  copy.title = `${source.title || 'Message'} (Copy)`;
  copy.status = 'active';
  copy.createdAt = new Date().toISOString();

  messages.unshift(copy);
  saveConfig(config);
  res.json({ success: true, message: copy });
});

app.post('/api/bot2/delete-message', (req, res) => {
  const { id } = req.body;
  const config = getConfig();
  if (!config.bot2?.messages) return res.status(404).json({ error: 'No messages found' });

  const initialLen = config.bot2.messages.length;
  config.bot2.messages = config.bot2.messages.filter((m) => m.id !== id);

  if (config.bot2.messages.length === initialLen) {
    return res.status(404).json({ error: 'Message not found' });
  }

  saveConfig(config);
  res.json({ success: true });
});

// API: Live Status & Traffic Logs
app.get('/api/status', (req, res) => {
  res.json({
    webServer: { status: 'running', port: PORT },
    bot1: { username: 'avniffanbasebot' },
    bot2: { username: 'avnifanbbot' },
    bot3: { username: 'anishaclubbot' }
  });
});

app.get('/api/logs', (req, res) => {
  res.json({
    counts: apiHitCounts,
    recent: apiCallLogs.slice(0, 50)
  });
});

// ====================================================
// 5. START STANDALONE WEB SERVER
// ====================================================
const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🌐 Dedicated Web Server & Admin Dashboard is LIVE!`);
  console.log(`   • Portal Dashboard : http://localhost:${PORT}`);
  console.log(`   • Terms & Policy   : http://localhost:${PORT}/terms`);
  console.log(`   • Status Check     : http://localhost:${PORT}/api/status`);
  console.log(`   • API Logs         : http://localhost:${PORT}/api/logs`);
  console.log(`======================================================\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${PORT} is already in use by another process!`);
    console.error(`   Stop the existing process on port ${PORT} before starting server.js.\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    process.exit(1);
  }
});

function shutdown(signal) {
  console.log(`\nStopping Web Server (${signal})...`);
  server.close(() => {
    process.exit(0);
  });
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
