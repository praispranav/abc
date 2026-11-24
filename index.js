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

// Default fallback configuration
const DEFAULT_CONFIG = {
  bot1: {
    bot_name: 'Avniffanbasebot',
    welcome: {
      useImage: true,
      imagePath: 'assets/welcome.jpg',
      message: 'NICE TO MEET YOU {username}\n\nDID YOU JOIN??\n✧ The {bot_name} Alerts Channel And Send A Join Request To The Backup Channel??\nIf Not, Send It Now, As All Upcoming Fresh Content And Announcements Will Be Shared There\n≼Terms & Policy≽',
      buttons: [
        { id: 'btn_1', text: '📢 Alerts Channel', type: 'url', url: 'https://t.me/' },
        { id: 'btn_2', text: '🔒 Backup Channel', type: 'url', url: 'https://t.me/' },
        { id: 'btn_3', text: '≼ Terms & Policy ≽', type: 'terms', url: '' }
      ]
    },
    free: {
      useImage: false,
      imagePath: '',
      message: '🎁 Welcome to Free Content!\n\nMake sure to stay joined in our channels for all upcoming fresh releases and updates.',
      buttons: [
        { id: 'btn_free_1', text: '🔥 Free Channel Link', type: 'url', url: 'https://t.me/' }
      ]
    },
    help: {
      message: '🤖 *Bot Help & Support*\n\nAvailable commands:\n• /free - Access free content & community links\n• /help - View this help guide\n\nNeed support? Check the announcements in our alert channel.'
    },
    terms: {
      title: 'Terms & Policy',
      content: 'Welcome to our community.\n\n1. Community Guidelines:\nAll content shared is strictly for community members. Distribution, re-uploading, or piracy is strictly prohibited.\n\n2. Privacy:\nWe respect your privacy. No personal identifiable data beyond your basic Telegram interaction info is stored.\n\n3. Compliance:\nBy joining and accessing our channels, you confirm you meet the age and legal requirements of your local jurisdiction.\n\nFor queries or concerns, contact our bot administrator.'
    }
  },
  bot2: {
    bot_name: 'avnifanbbot',
    video: {
      videoPath: '',
      videoUrl: '',
      message: '🎬 Hello {username}!\n\nHere is your requested video message.\n\n⚠️ *ATTENTION*: This video message will self-destruct in {timer_text}! Please watch or save it before time runs out.',
      buttons: [
        { id: 'b2_btn_1', text: '📢 Alerts & Updates Channel', type: 'url', url: 'https://t.me/' }
      ]
    },
    timer: {
      enabled: true,
      seconds: 60,
      preset: '1min',
      warningMessage: '⏳ *Auto-Delete Warning*: This video will be deleted in {timer_text}!'
    },
    help: {
      message: '🤖 *avnifanbbot Help & Information*\n\nWelcome to @avnifanbbot!\nThis bot delivers special video messages with an automatic self-destruction timer.\n\n📌 *Available Commands:*\n• /start - Receive the video message with auto-delete timer\n• /video - Fetch the video message\n• /help - Show this information\n\n⏱ *Default Timer:* {timer_text}\nMessages will be permanently deleted once the timer runs out.'
    }
  }
};

// Helper to read and write config with backward compatibility
function getConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const data = JSON.parse(raw);

    // Normalize bot1 if older config structure is present
    if (!data.bot1) {
      data.bot1 = {
        bot_name: data.bot_name || DEFAULT_CONFIG.bot1.bot_name,
        welcome: data.welcome || DEFAULT_CONFIG.bot1.welcome,
        free: data.free || DEFAULT_CONFIG.bot1.free,
        help: data.help || DEFAULT_CONFIG.bot1.help,
        terms: data.terms || DEFAULT_CONFIG.bot1.terms,
      };
    }

    // Normalize bot2 if missing
    if (!data.bot2) {
      data.bot2 = DEFAULT_CONFIG.bot2;
    }

    // Keep legacy top-level keys synchronized
    data.bot_name = data.bot1.bot_name;
    data.welcome = data.bot1.welcome;
    data.free = data.bot1.free;
    data.help = data.bot1.help;
    data.terms = data.bot1.terms;

    return data;
  } catch (err) {
    console.error('Error reading config.json, falling back to defaults:', err);
    return DEFAULT_CONFIG;
  }
}

function saveConfig(data) {
  // Ensure top-level legacy keys match bot1
  if (data.bot1) {
    data.bot_name = data.bot1.bot_name;
    data.welcome = data.bot1.welcome;
    data.free = data.bot1.free;
    data.help = data.bot1.help;
    data.terms = data.bot1.terms;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ----------------------------------------------------
// 1. EXPRESS WEB SERVER & MULTI-BOT DASHBOARD
// ----------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Multer storage for image & video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, 'assets');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const prefix = file.fieldname === 'video' ? 'video' : 'welcome';
    const ext = path.extname(file.originalname);
    cb(null, `${prefix}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for media
});

// Admin Dashboard Routes
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
    res.json({ success: true, message: 'Configuration saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload custom image (e.g. for Bot 1 welcome)
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath });
});

// API: Upload custom video (e.g. for Bot 2 timed video)
app.post('/api/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath });
});

// API: Bot status endpoint
let botStatus = {
  bot1: { connected: false, username: null },
  bot2: { connected: false, username: null },
};

app.get('/api/status', (req, res) => {
  res.json(botStatus);
});

app.listen(PORT, () => {
  console.log(`🌐 Multi-Bot Configuration Dashboard running at http://localhost:${PORT}`);
  console.log(`📜 Terms & Policy page viewable at http://localhost:${PORT}/terms`);
});

// ----------------------------------------------------
// 2. HELPER UTILITIES
// ----------------------------------------------------
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

  return rows.length > 0 ? Markup.inlineKeyboard(rows) : null;
}

// ----------------------------------------------------
// 3. BOT 1: @Avniffanbasebot (Community & Welcome Bot)
// ----------------------------------------------------
const token1 =
  process.env.TELEGRAM_BOT_TOKEN_1 ||
  process.env.TELEGRAM_BOT_TOKEN ||
  '9051597768:AAEsG3DJE8tYTrF3Kk8jSqpR5hRx5yhUDaE';

const bot1 = new Telegraf(token1.trim());

function formatBot1Message(template, ctx) {
  const config = getConfig();
  const botName = config.bot1?.bot_name || config.bot_name || 'Avniffanbasebot';
  const username = ctx.from?.username
    ? `@${ctx.from.username}`
    : ctx.from?.first_name || 'Friend';

  return template
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName);
}

async function sendBot1Welcome(ctx) {
  const config = getConfig();
  const welcome = config.bot1?.welcome || config.welcome || {};
  const caption = formatBot1Message(
    welcome.message ||
      'NICE TO MEET YOU {username}\n\nDID YOU JOIN??\n✧ The {bot_name} Alerts Channel And Send A Join Request To The Backup Channel??',
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
      console.error('[Bot 1] Error sending photo, falling back to text:', err.message);
    }
  }

  await ctx.reply(caption, keyboard ? keyboard : undefined);
}

bot1.start(async (ctx) => {
  await sendBot1Welcome(ctx);
});

bot1.command('free', async (ctx) => {
  const config = getConfig();
  const free = config.bot1?.free || config.free || {};
  const text = free.message || '🎁 Welcome to Free Content!';
  const keyboard = buildInlineKeyboard(free.buttons);

  await ctx.reply(text, keyboard ? keyboard : undefined);
});

bot1.command('help', async (ctx) => {
  const config = getConfig();
  const help = config.bot1?.help || config.help || {};
  const text =
    help.message ||
    '🤖 *Bot Help & Support*\n\nAvailable commands:\n• /free - Access free content & community links\n• /help - View this help guide';

  try {
    await ctx.replyWithMarkdown(text);
  } catch (err) {
    await ctx.reply(text);
  }
});

bot1.action('view_terms', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (_) {}
  const config = getConfig();
  const terms = config.bot1?.terms || config.terms || {};
  const text = `📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`;

  try {
    await ctx.reply(
      text,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'back_to_main')]])
    );
  } catch (err) {
    await ctx.reply(terms.content || 'Terms & Policy');
  }
});

bot1.action('back_to_main', async (ctx) => {
  try {
    await ctx.answerCbQuery();
  } catch (_) {}
  await sendBot1Welcome(ctx);
});

bot1.on('new_chat_members', async (ctx) => {
  await sendBot1Welcome(ctx);
});

bot1.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply('❓ Unknown command.\nAvailable commands are:\n• /free\n• /help');
  }
});

// ----------------------------------------------------
// 4. BOT 2: @avnifanbbot (Timed Video Message Bot)
// ----------------------------------------------------
const token2 =
  process.env.TELEGRAM_BOT_TOKEN_2 ||
  '9202863846:AAHgjTadO-qhllGFg_0bmPoLXO9NV70e3Mc';

const bot2 = new Telegraf(token2.trim());

// Helper to send video with auto-delete timer
async function sendBot2TimedVideo(ctx) {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
  const videoConfig = bot2Config.video || {};
  const timerConfig = bot2Config.timer || { enabled: true, seconds: 60 };

  const username = ctx.from?.username
    ? `@${ctx.from.username}`
    : ctx.from?.first_name || 'Friend';
  const botName = bot2Config.bot_name || 'avnifanbbot';

  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText =
    timerSeconds >= 60
      ? `${Math.round(timerSeconds / 60)} min`
      : `${timerSeconds} sec`;

  let caption = (
    videoConfig.message ||
    '🎬 Hello {username}!\n\nHere is your requested video message.\n\n⚠️ *ATTENTION*: This video message will self-destruct in {timer_text}!'
  )
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText)
    .replace(/{timer}/g, timerText);

  // Append warning notice if enabled and not already present
  if (
    timerConfig.enabled &&
    timerConfig.warningMessage &&
    !caption.includes(timerConfig.warningMessage)
  ) {
    const warning = timerConfig.warningMessage
      .replace(/{timer_text}/g, timerText)
      .replace(/{timer}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  const keyboard = buildInlineKeyboard(videoConfig.buttons);

  let sentMessage = null;
  const videoPath = videoConfig.videoPath
    ? path.join(__dirname, videoConfig.videoPath)
    : null;

  // 1. Try sending local uploaded video file
  if (videoPath && fs.existsSync(videoPath)) {
    try {
      sentMessage = await ctx.replyWithVideo(
        { source: videoPath },
        {
          caption,
          parse_mode: 'Markdown',
          ...(keyboard ? keyboard : {}),
        }
      );
    } catch (err) {
      console.warn('[Bot 2] Failed with markdown formatting, retrying plain text:', err.message);
      try {
        sentMessage = await ctx.replyWithVideo(
          { source: videoPath },
          {
            caption,
            ...(keyboard ? keyboard : {}),
          }
        );
      } catch (err2) {
        console.error('[Bot 2] Failed to send local video:', err2.message);
      }
    }
  }

  // 2. Try sending video via URL or Telegram File ID
  if (!sentMessage && videoConfig.videoUrl && videoConfig.videoUrl.trim() !== '') {
    try {
      sentMessage = await ctx.replyWithVideo(videoConfig.videoUrl.trim(), {
        caption,
        parse_mode: 'Markdown',
        ...(keyboard ? keyboard : {}),
      });
    } catch (err) {
      try {
        sentMessage = await ctx.replyWithVideo(videoConfig.videoUrl.trim(), {
          caption,
          ...(keyboard ? keyboard : {}),
        });
      } catch (err2) {
        console.error('[Bot 2] Failed to send video from URL/File ID:', err2.message);
      }
    }
  }

  // 3. Fallback: Send caption as text message if no video source is configured or sending failed
  if (!sentMessage) {
    try {
      sentMessage = await ctx.reply(caption, {
        parse_mode: 'Markdown',
        ...(keyboard ? keyboard : {}),
      });
    } catch (err) {
      sentMessage = await ctx.reply(caption, keyboard ? keyboard : undefined);
    }
  }

  // 4. Auto-Delete Timer
  if (timerConfig.enabled && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;

    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(
          `🗑️ [Bot 2: @avnifanbbot] Message ${messageId} deleted in chat ${chatId} after ${timerSeconds}s timer.`
        );
      } catch (delErr) {
        console.warn(`[Bot 2] Could not delete message ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }
}

// Bot 2 Commands
bot2.start(async (ctx) => {
  await sendBot2TimedVideo(ctx);
});

bot2.command('video', async (ctx) => {
  await sendBot2TimedVideo(ctx);
});

// Bot 2 Help Command
bot2.command('help', async (ctx) => {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
  const timerConfig = bot2Config.timer || { enabled: true, seconds: 60 };
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText =
    timerSeconds >= 60
      ? `${Math.round(timerSeconds / 60)} min`
      : `${timerSeconds} sec`;

  const help = bot2Config.help || {};
  const text = (
    help.message ||
    '🤖 *avnifanbbot Help & Information*\n\nAvailable commands:\n• /start - Receive timed video message\n• /video - Get timed video message\n• /help - Bot information\n\n⏱ Default Timer: {timer_text}'
  )
    .replace(/{timer_text}/g, timerText)
    .replace(/{timer}/g, timerText)
    .replace(/{bot_name}/g, bot2Config.bot_name || 'avnifanbbot');

  try {
    await ctx.replyWithMarkdown(text);
  } catch (err) {
    await ctx.reply(text);
  }
});

// Support user or admin sending/forwarding a video to Bot 2
bot2.on('video', async (ctx) => {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
  const timerConfig = bot2Config.timer || { enabled: true, seconds: 60 };
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText =
    timerSeconds >= 60
      ? `${Math.round(timerSeconds / 60)} min`
      : `${timerSeconds} sec`;

  const videoFileId = ctx.message.video.file_id;
  const userCaption = ctx.message.caption ? `${ctx.message.caption}\n\n` : '';
  const caption = `${userCaption}⏳ *Self-Destruct Active*: This video will be automatically deleted in ${timerText}.`;

  try {
    const sent = await ctx.replyWithVideo(videoFileId, {
      caption,
      parse_mode: 'Markdown',
    });

    if (timerConfig.enabled && timerSeconds > 0) {
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(sent.chat.id, sent.message_id);
          try {
            await ctx.telegram.deleteMessage(ctx.message.chat.id, ctx.message.message_id);
          } catch (_) {}
          console.log(`🗑️ [Bot 2] User submitted video deleted after ${timerSeconds}s.`);
        } catch (e) {
          console.warn('[Bot 2] Error auto-deleting video:', e.message);
        }
      }, timerSeconds * 1000);
    }
  } catch (err) {
    console.error('[Bot 2] Error echoing video:', err.message);
  }
});

// Bot 2 Text Handler / Fallback
bot2.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply(
      '❓ Unknown command.\nAvailable commands are:\n• /start - Get timed video\n• /video - Get timed video\n• /help - Help & Information'
    );
  } else {
    // Deliver timed video on generic text trigger
    await sendBot2TimedVideo(ctx);
  }
});

// ----------------------------------------------------
// 5. BOT INITIALIZATION & RETRY MANAGER
// ----------------------------------------------------
async function connectBot(botInstance, name, commands, statusKey, delayStartMs = 0) {
  if (delayStartMs > 0) {
    console.log(`⏱️ [${name}] Staggering startup by ${delayStartMs / 1000}s to prevent IP flood...`);
    await new Promise((resolve) => setTimeout(resolve, delayStartMs));
  }

  let connected = false;
  let attempts = 0;

  while (!connected) {
    attempts++;
    try {
      const me = await botInstance.telegram.getMe();
      console.log(`🤖 Connected [${name}] to Telegram as @${me.username} (${me.first_name})`);
      botStatus[statusKey] = { connected: true, username: me.username, firstName: me.first_name };

      if (commands && commands.length > 0) {
        await botInstance.telegram.setMyCommands(commands);
        console.log(`✅ [${name}] Registered commands with Telegram: ${commands.map(c => `/${c.command}`).join(', ')}`);
      }

      const webhookDomain = process.env.WEBHOOK_DOMAIN;
      if (webhookDomain && webhookDomain.trim() !== '') {
        const cleanDomain = webhookDomain.replace(/\/+$/, '');
        const secretPath = `/webhook/${statusKey}_${botInstance.token.split(':')[0]}`;

        app.use(botInstance.webhookCallback(secretPath));
        await botInstance.telegram.setWebhook(`${cleanDomain}${secretPath}`);
        console.log(`🚀 [${name}] Webhook registered: ${cleanDomain}${secretPath}`);
      } else {
        await botInstance.telegram.deleteWebhook({ drop_pending_updates: true });
        botInstance.launch({ dropPendingUpdates: true }).catch((err) => {
          console.error(`[${name}] Polling error:`, err.message);
        });
        console.log(`🚀 [${name}] @${me.username} is now live with long polling!`);
      }

      connected = true;
    } catch (err) {
      const retryMatch = err.message && err.message.match(/retry after (\d+)/i);
      // Add a generous safety buffer of at least 15 seconds plus jitter to prevent Telegram clock drift
      const baseSec = retryMatch ? parseInt(retryMatch[1], 10) : 30;
      const jitter = Math.floor(Math.random() * 5);
      const waitSec = baseSec + 15 + jitter;

      console.log(`⏳ [${name}] Rate-limited by Telegram (429). Pausing for ${waitSec}s to allow flood lock to clear...`);
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
    }
  }
}

async function initBots() {
  // Connect Bot 1 first
  await connectBot(
    bot1,
    'Bot 1: Avniffanbasebot',
    [
      { command: 'free', description: 'Access free content and channels' },
      { command: 'help', description: 'Bot commands and support' },
    ],
    'bot1',
    0
  );

  // Once Bot 1 connects, connect Bot 2 with a 3-second gap
  await connectBot(
    bot2,
    'Bot 2: avnifanbbot',
    [
      { command: 'start', description: 'Receive timed video message' },
      { command: 'video', description: 'Get timed video message' },
      { command: 'help', description: 'Bot information and help' },
    ],
    'bot2',
    3000
  );
}

initBots();

// Graceful stop
process.once('SIGINT', () => {
  bot1.stop('SIGINT');
  bot2.stop('SIGINT');
});
process.once('SIGTERM', () => {
  bot1.stop('SIGTERM');
  bot2.stop('SIGTERM');
});
