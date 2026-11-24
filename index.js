import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Helper to read and write config
function getConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading config.json, falling back to defaults:', err);
    return {};
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ----------------------------------------------------
// 1. EXPRESS WEB SERVER & DASHBOARD
// ----------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Multer storage for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, 'assets');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `welcome_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

// Admin Dashboard Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Terms & Policy Web Page
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// API: Get current config
app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

// API: Save updated config
app.post('/api/config', (req, res) => {
  try {
    saveConfig(req.body);
    res.json({ success: true, message: 'Configuration saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload custom header image
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath });
});

app.listen(PORT, () => {
  console.log(`🌐 Configuration Dashboard running at http://localhost:${PORT}`);
  console.log(`📜 Terms & Policy page viewable at http://localhost:${PORT}/terms`);
});

// ----------------------------------------------------
// 2. TELEGRAF TELEGRAM BOT
// ----------------------------------------------------
const token = process.env.TELEGRAM_BOT_TOKEN || '9051597768:AAEsG3DJE8tYTrF3Kk8jSqpR5hRx5yhUDaE';

const bot = new Telegraf(token.trim());

// Helper to format text with username & bot name
function formatMessage(template, ctx) {
  const config = getConfig();
  const botName = config.bot_name || 'Avniffanbasebot';
  const username = ctx.from?.username
    ? `@${ctx.from.username}`
    : ctx.from?.first_name || 'Friend';

  return template
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName);
}

// Build inline buttons from config
function buildInlineKeyboard(buttons) {
  if (!buttons || !Array.isArray(buttons) || buttons.length === 0) {
    return null;
  }

  const rows = buttons
    .filter((b) => b.text && b.text.trim() !== '')
    .map((b) => {
      if (b.type === 'terms') {
        return [Markup.button.callback(b.text, 'view_terms')];
      }
      return [Markup.button.url(b.text, b.url || 'https://t.me/')];
    });

  return Markup.inlineKeyboard(rows);
}

// Send Welcome Message
async function sendWelcome(ctx) {
  const config = getConfig();
  const welcome = config.welcome || {};
  const caption = formatMessage(
    welcome.message ||
      'NICE TO MEET YOU {username}\n\nDID YOU JOIN??\n✧ The {bot_name} Alerts Channel...',
    ctx
  );
  const keyboard = buildInlineKeyboard(welcome.buttons);

  const imagePath = welcome.imagePath
    ? path.join(__dirname, welcome.imagePath)
    : path.join(__dirname, 'assets', 'welcome.jpg');

  if (welcome.useImage && fs.existsSync(imagePath)) {
    try {
      await ctx.replyWithPhoto(
        { source: imagePath },
        {
          caption,
          ...(keyboard ? keyboard : {}),
        }
      );
      return;
    } catch (err) {
      console.error('Error sending photo, falling back to text:', err.message);
    }
  }

  // Fallback to text message
  await ctx.reply(caption, keyboard ? keyboard : undefined);
}

// /start command (Triggered on join / start)
bot.start(async (ctx) => {
  await sendWelcome(ctx);
});

// Command 1: /free
bot.command('free', async (ctx) => {
  const config = getConfig();
  const free = config.free || {};
  const text = free.message || '🎁 Welcome to Free Content!';
  const keyboard = buildInlineKeyboard(free.buttons);

  await ctx.reply(text, keyboard ? keyboard : undefined);
});

// Command 2: /help
bot.command('help', async (ctx) => {
  const config = getConfig();
  const help = config.help || {};
  const text =
    help.message ||
    '🤖 *Bot Help & Support*\n\nAvailable commands:\n• /free - Access free content & community links\n• /help - View this help guide';

  await ctx.replyWithMarkdown(text);
});

// Terms & Policy Callback Action
bot.action('view_terms', async (ctx) => {
  await ctx.answerCbQuery();
  const config = getConfig();
  const terms = config.terms || {};
  const text = `📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`;

  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Back', 'back_to_main')],
    ])
  );
});

// Back action
bot.action('back_to_main', async (ctx) => {
  await ctx.answerCbQuery();
  await sendWelcome(ctx);
});

// Handle new members joining a group
bot.on('new_chat_members', async (ctx) => {
  await sendWelcome(ctx);
});

// Fallback for other commands to guide user to /help and /free
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply(
      '❓ Unknown command.\nAvailable commands are:\n• /free\n• /help'
    );
  }
});

// Register bot menu commands in Telegram with auto-retry
async function initBot() {
  let connected = false;
  while (!connected) {
    try {
      const me = await bot.telegram.getMe();
      console.log(`🤖 Connected to Telegram as @${me.username} (${me.first_name})`);

      // Only 2 commands as requested
      await bot.telegram.setMyCommands([
        { command: 'free', description: 'Access free content and channels' },
        { command: 'help', description: 'Bot commands and support' },
      ]);
      console.log('✅ Registered commands with Telegram: /free and /help');

      // bot.launch() starts polling in the background (polling loop runs indefinitely)
      bot.launch({
        dropPendingUpdates: true
      }).catch((err) => {
        console.error('Polling error:', err);
      });

      console.log(`🚀 @${me.username} is now live and listening!`);
      connected = true;
    } catch (err) {
      const retryMatch = err.message && err.message.match(/retry after (\d+)/i);
      const waitSec = retryMatch ? parseInt(retryMatch[1], 10) + 1 : 5;
      console.log(`⏳ Telegram rate-limited (429). Retrying in ${waitSec}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
    }
  }
}

initBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
