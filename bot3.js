import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

const token = (
  process.env.TELEGRAM_BOT_TOKEN_3 ||
  ''
).trim();

const bot = new Telegraf(token);

// Pre-populate botInfo to eliminate internal getMe() calls and avoid 429 rate limits
bot.botInfo = {
  id: parseInt(token.split(':')[0], 10),
  is_bot: true,
  first_name: 'Anisha Club',
  username: 'anishaclubbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

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

function buildInlineKeyboard(buttons) {
  const rows = [];
  if (buttons && Array.isArray(buttons)) {
    buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') {
          url = 'https://t.me/anishaclubbot';
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        rows.push([Markup.button.url(b.text, url)]);
      });
  }
  return rows.length > 0 ? Markup.inlineKeyboard(rows) : null;
}

function formatMessage(template, ctx) {
  const cfg = getConfig();
  const botName = cfg.bot3?.bot_name || 'Anisha Club';
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'VIP Member';
  return template.replace(/{username}/g, username).replace(/{bot_name}/g, botName);
}

// Commands
bot.start(async (ctx) => {
  const cfg = getConfig();
  const welcome = cfg.bot3?.welcome || {
    message: '👋 Welcome to Anisha Club Exclusive, {username}!\n\nAccess our private drops and updates below.',
    buttons: [
      { id: 'b3_btn_1', text: '🔥 Join VIP Club', type: 'url', url: 'https://t.me/anishaclubbot' },
      { id: 'b3_btn_2', text: '📢 Announcements Channel', type: 'url', url: 'https://t.me/anishaclubbot' }
    ]
  };
  const text = formatMessage(welcome.message, ctx);
  const keyboard = buildInlineKeyboard(welcome.buttons);
  await ctx.reply(text, keyboard ? keyboard : undefined);
});

// Portable Free Drops Engine for Bot 3
const freeUserCursors = new Map();

function formatFreeTimerText(seconds) {
  const sec = Number(seconds) || 0;
  if (sec <= 0) return 'off';
  if (sec >= 3600) return `${Math.round(sec / 3600)} hr`;
  if (sec >= 60) return `${Math.round(sec / 60)} min`;
  return `${sec} sec`;
}

async function sendSingleFreePreview(ctx, msg, username, botName, showNextBtn = false) {
  const preview = msg.preview || {};
  const timerConfig = preview.timer || { enabled: false, seconds: 60 };
  const isTemporary = preview.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatFreeTimerText(timerSeconds);

  let caption = (preview.message || msg.message || '🎁 *Free Content Drop*')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    caption = `${caption}\n\n${timerConfig.warningMessage.replace(/{timer_text}/g, timerText)}`;
  }

  const rows = [
    [Markup.button.callback(msg.viewButtonText || '👁️ View Content', `reveal_free_${msg.id}`)]
  ];
  if (showNextBtn) {
    rows.push([Markup.button.callback('▶️ Next Free Content', 'next_free_drop')]);
  }
  if (preview.buttons && Array.isArray(preview.buttons)) {
    preview.buttons.filter((b) => b.text && b.text.trim() !== '').forEach((b) => {
      let url = (b.url || '').trim() || 'https://t.me/anishaclubbot';
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
      rows.push([Markup.button.url(b.text, url)]);
    });
  }

  const inlineKeyboard = Markup.inlineKeyboard(rows);
  let sentMessage = null;
  const mediaPath = preview.mediaPath ? path.join(__dirname, preview.mediaPath) : null;
  const mediaType = preview.mediaType || 'none';

  try {
    if (mediaType === 'video' && mediaPath && fs.existsSync(mediaPath)) {
      sentMessage = await ctx.replyWithVideo({ source: mediaPath }, { caption, parse_mode: 'Markdown', ...inlineKeyboard });
    } else if (mediaType === 'photo' && mediaPath && fs.existsSync(mediaPath)) {
      sentMessage = await ctx.replyWithPhoto({ source: mediaPath }, { caption, parse_mode: 'Markdown', ...inlineKeyboard });
    } else {
      sentMessage = await ctx.reply(caption, { parse_mode: 'Markdown', ...inlineKeyboard });
    }
  } catch (_) {
    try { sentMessage = await ctx.reply(caption, inlineKeyboard); } catch (_) { sentMessage = await ctx.reply(caption); }
  }

  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try { await ctx.telegram.deleteMessage(chatId, messageId); } catch (_) {}
    }, timerSeconds * 1000);
  }
}

async function executeFreeCommand(ctx) {
  const cfg = getConfig();
  const freeConfig = cfg.bot1?.free || cfg.free || {};
  const assigned = freeConfig.assignedBot || 'bot1';

  if (assigned !== 'all' && assigned !== 'bot3') {
    return ctx.reply('🎁 Free content drops are currently hosted on @avniffanbasebot! Please send /free there.');
  }

  const allMessages = freeConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');
  if (activeMessages.length === 0) {
    return ctx.reply('📭 There are currently no active free content drops. Please check back later!');
  }

  const deliveryMode = freeConfig.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'VIP Member';
  const botName = cfg.bot3?.bot_name || 'Anisha Club';

  if (deliveryMode === 'all_in_one') {
    for (const msg of activeMessages) {
      await sendSingleFreePreview(ctx, msg, username, botName, false);
    }
  } else {
    const userId = ctx.from?.id || 'default';
    const lastCursor = freeUserCursors.get(userId) ?? -1;
    const nextCursor = (lastCursor + 1) % activeMessages.length;
    freeUserCursors.set(userId, nextCursor);
    const chosen = activeMessages[nextCursor];
    const showNextBtn = activeMessages.length > 1;
    await sendSingleFreePreview(ctx, chosen, username, botName, showNextBtn);
  }
}

async function handleRevealFreeAction(ctx, matchId) {
  try { await ctx.answerCbQuery('🔓 Unlocking content...'); } catch (_) {}
  const cfg = getConfig();
  const freeConfig = cfg.bot1?.free || cfg.free || {};
  const allMessages = freeConfig.messages || [];
  const msg = allMessages.find((m) => m.id === matchId);

  if (!msg || msg.status === 'archived') {
    return ctx.reply('❌ This content drop is no longer available.');
  }

  const revealed = msg.revealedContent || {};
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'VIP Member';
  const botName = cfg.bot3?.bot_name || 'Anisha Club';

  const timerConfig = revealed.timer || { enabled: false, seconds: 60 };
  const isTemporary = revealed.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatFreeTimerText(timerSeconds);

  let caption = (revealed.message || msg.message || '🔥 *Here is your unlocked exclusive content!*')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    caption += '\n\n' + timerConfig.warningMessage.replace(/{timer_text}/g, timerText);
  }

  const rows = [];
  if (revealed.buttons && Array.isArray(revealed.buttons)) {
    revealed.buttons.filter((b) => b.text && b.text.trim() !== '').forEach((b) => {
      let url = (b.url || '').trim() || 'https://t.me/anishaclubbot';
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
      rows.push([Markup.button.url(b.text, url)]);
    });
  }

  const inlineKeyboard = rows.length > 0 ? Markup.inlineKeyboard(rows) : undefined;
  let sentMessage = null;
  const mediaPath = revealed.mediaPath ? path.join(__dirname, revealed.mediaPath) : null;
  const mediaType = revealed.mediaType || 'none';

  try {
    if (mediaType === 'video' && mediaPath && fs.existsSync(mediaPath)) {
      sentMessage = await ctx.replyWithVideo({ source: mediaPath }, { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) });
    } else if (mediaType === 'photo' && mediaPath && fs.existsSync(mediaPath)) {
      sentMessage = await ctx.replyWithPhoto({ source: mediaPath }, { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) });
    } else {
      sentMessage = await ctx.reply(caption, { parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) });
    }
  } catch (_) {
    try { sentMessage = await ctx.reply(caption, inlineKeyboard); } catch (_) { sentMessage = await ctx.reply(caption); }
  }

  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try { await ctx.telegram.deleteMessage(chatId, messageId); } catch (_) {}
    }, timerSeconds * 1000);
  }
}

bot.command('free', async (ctx) => {
  await executeFreeCommand(ctx);
});

bot.action(/^reveal_free_(.+)$/, async (ctx) => {
  await handleRevealFreeAction(ctx, ctx.match[1]);
});

bot.action('next_free_drop', async (ctx) => {
  try { await ctx.answerCbQuery('Fetching next free drop...'); } catch (_) {}
  await executeFreeCommand(ctx);
});

bot.command('club', async (ctx) => {
  const cfg = getConfig();
  const club = cfg.bot3?.club || {};
  const text = club.message || '💎 *Anisha Club VIP Access*\n\nExclusive drops and sets are shared here daily.\n\nMake sure notifications are turned ON!';
  try {
    await ctx.replyWithMarkdown(text);
  } catch (_) {
    await ctx.reply(text);
  }
});

bot.command('exclusive', async (ctx) => {
  const cfg = getConfig();
  const excl = cfg.bot3?.exclusive || {};
  const text = excl.message || '✨ *Latest Exclusive Drop*\n\nCheck back daily for fresh drops and updates.';
  try {
    await ctx.replyWithMarkdown(text);
  } catch (_) {
    await ctx.reply(text);
  }
});

bot.command('help', async (ctx) => {
  const cfg = getConfig();
  const help = cfg.bot3?.help || {};
  const text =
    help.message ||
    '🤖 *Bot 3 (@anishaclubbot) VIP Commands:*\n\n• /start - Welcome & Club Access\n• /club - VIP Club details & perks\n• /exclusive - View latest exclusive drops\n• /help - Help & Support';
  try {
    await ctx.replyWithMarkdown(text);
  } catch (_) {
    await ctx.reply(text);
  }
});

bot.on('text', async (ctx) => {
  const text = (ctx.message.text || '').trim();
  const name = ctx.from?.first_name || 'Member';

  if (text === '/start' || text.startsWith('/start ')) {
    const cfg = getConfig();
    const welcome = cfg.bot3?.welcome || { message: '👋 Welcome to Anisha Club Exclusive, {username}!' };
    return await ctx.reply(formatMessage(welcome.message, ctx), buildInlineKeyboard(welcome.buttons) || undefined);
  }
  if (text === '/club') {
    const cfg = getConfig();
    const club = cfg.bot3?.club || {};
    return await ctx.replyWithMarkdown(club.message || '💎 VIP Club Details');
  }
  if (text === '/exclusive') {
    const cfg = getConfig();
    const excl = cfg.bot3?.exclusive || {};
    return await ctx.replyWithMarkdown(excl.message || '✨ Exclusive Drop');
  }
  if (text === '/free' || text.startsWith('/free ')) {
    return await executeFreeCommand(ctx);
  }
  if (text === '/help') {
    const cfg = getConfig();
    const help = cfg.bot3?.help || {};
    return await ctx.replyWithMarkdown(help.message || '🤖 Commands: /start, /club, /exclusive, /help');
  }
  if (text.startsWith('/')) {
    await ctx.reply('❓ Unknown VIP command.\nAvailable commands are:\n• /start - Welcome & Access\n• /club - Club Details\n• /exclusive - Latest Drops\n• /help - VIP Help');
  } else {
    // Instant echo response confirming connectivity
    await ctx.reply(`👋 Hello ${name}! Echo: "${text}"\n✅ @anishaclubbot is online! Type /club or /exclusive for VIP content.`);
  }
});

bot.catch((err) => {
  console.error('[Bot 3] Error:', err.message);
});

console.log('🤖 Starting Bot 3: @anishaclubbot standalone runner...');
bot.launch({ dropPendingUpdates: false }).catch((err) => {
  console.error('❌ Bot 3 failed to start:', err.message);
  process.exit(1);
});
console.log('✅ Bot 3 (@anishaclubbot) is live with long polling!');

bot.telegram.setMyCommands([
  { command: 'start', description: 'Welcome & VIP club access' },
  { command: 'club', description: 'VIP Club details & perks' },
  { command: 'exclusive', description: 'View latest exclusive drops' },
  { command: 'help', description: 'VIP commands and support' },
]).catch((err) => {
  console.warn('[Bot 3] Could not register commands:', err.message);
});

function shutdown(signal) {
  console.log(`\nStopping Bot 3 (${signal})...`);
  bot.stop(signal);
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
