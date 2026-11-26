import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

function formatTelegramHtml(text) {
  if (!text) return '';
  let out = text;
  // Spoilers: ||text|| -> <tg-spoiler>text</tg-spoiler>
  out = out.replace(/\|\|([\s\S]+?)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
  // Bold: **text** or *text* -> <b>text</b>
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/\*([^\*\n]+?)\*/g, '<b>$1</b>');
  // Strikethrough: ~text~ -> <s>text</s>
  out = out.replace(/~([\s\S]+?)~/g, '<s>$1</s>');
  // Italic: _text_ -> <i>text</i>
  out = out.replace(/_([^\_\r\n]+?)_/g, '<i>$1</i>');
  // Code block: ```code``` -> <pre>code</pre>
  out = out.replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]+?)```/g, '<pre>$1</pre>');
  // Inline code: `text` -> <code>text</code>
  out = out.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  // Hyperlinks: [text](url) -> <a href="url">text</a>
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2">$1</a>');
  // Blockquotes: > line -> <blockquote>line</blockquote>
  out = out.replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  return out;
}


function ensureTelegramImageSafe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      execSync(`sips -Z 2048 "${filePath}"`, { stdio: 'ignore' });
    }
  } catch (_) {}
}


const token = (
  process.env.TELEGRAM_BOT_TOKEN_1 ||
  process.env.TELEGRAM_BOT_TOKEN ||
  ''
).trim();

const bot = new Telegraf(token);

// Pre-populate botInfo to eliminate internal getMe() calls and avoid 429 rate limits
bot.botInfo = {
  id: parseInt(token.split(':')[0], 10),
  is_bot: true,
  first_name: 'Avni FanBaseTM',
  username: 'avniffanbasebot',
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

function createTermsButton(text, windowMode) {
  const domain = (process.env.WEBHOOK_DOMAIN || '').replace(/\/+$/, '');
  if (windowMode === 'webapp' && domain) {
    return Markup.button.webApp(text, `${domain}/terms`);
  }
  return Markup.button.callback(text, 'view_terms');
}

function buildInlineKeyboard(buttons, extraRow = null, forceTerms = false, includeBottomButtons = false) {
  const rows = [];
  const cfg = getConfig();
  const termsConfig = cfg.bot1?.terms || {};
  const windowMode = termsConfig.windowMode || 'dialog';
  const termsButtonText = termsConfig.buttonText || '≼ Terms & Policy ≽';

  let hasTerms = false;

  if (buttons && Array.isArray(buttons) && buttons.length > 0) {
    buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        if (b.type === 'terms') {
          hasTerms = true;
          rows.push([createTermsButton(b.text || termsButtonText, windowMode)]);
        } else if (b.type === 'today' || b.url === 'view_today') {
          rows.push([Markup.button.callback(b.text || "✨ Today's Content", 'view_today')]);
        } else if (b.type === 'free' || b.url === 'view_free') {
          rows.push([Markup.button.callback(b.text || "🎁 Free Content", 'view_free')]);
        } else if (b.type === 'list') {
          rows.push([Markup.button.callback(b.text || "📂 Content", `open_list_${b.listId || 'list_free'}`)]);
        } else if (b.type === 'callback') {
          rows.push([Markup.button.callback(b.text, b.url || 'action')]);
        } else {
          let url = (b.url || '').trim();
          if (!url || url === 'https://t.me/' || url === 'https://t.me') {
            url = 'https://t.me/avniffanbasebot';
          }
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = `https://${url}`;
          }
          rows.push([Markup.button.url(b.text, url)]);
        }
      });
  }

  // Configurable Bottom Buttons
  if (includeBottomButtons) {
    const bottomButtons = cfg.bot1?.welcome?.bottomButtons || [];
    if (Array.isArray(bottomButtons) && bottomButtons.length > 0) {
      bottomButtons
        .filter((b) => b.text && b.text.trim() !== '')
        .forEach((b) => {
          if (b.type === 'url' && b.url) {
            let url = b.url.trim();
            if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
            rows.push([Markup.button.url(b.text, url)]);
          } else {
            rows.push([Markup.button.callback(b.text, `open_list_${b.listId || 'list_btn1'}`)]);
          }
        });
    }
  }

  // Terms and Policy is ALWAYS intact at the end of the first message
  if (forceTerms && !hasTerms) {
    rows.push([createTermsButton(termsButtonText, windowMode)]);
  }

  if (extraRow && Array.isArray(extraRow) && extraRow.length > 0) {
    rows.push(extraRow);
  }

  return rows.length > 0 ? Markup.inlineKeyboard(rows) : null;
}

function formatMessage(template, ctx) {
  const cfg = getConfig();
  const botName = cfg.bot1?.bot_name || 'Avni FanBase';
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'Friend';
  return template.replace(/{username}/g, username).replace(/{bot_name}/g, botName);
}

// Welcome Message: Terms & Policy is always intact at the end

// Native Telegram Sticky Reply Keyboard (Pinned at the bottom of the user's screen)
function buildStickyReplyKeyboard() {
  const config = getConfig();
  const bottomButtons = config.bot1?.welcome?.bottomButtons || [
    { text: "✨ Today's Content", type: 'today', fullWidth: true },
    { text: 'Button 1', type: 'list', listId: 'list_btn1', fullWidth: false },
    { text: 'Button 2', type: 'list', listId: 'list_btn2', fullWidth: false },
    { text: 'Button 3', type: 'list', listId: 'list_btn3', fullWidth: false }
  ];

  const rows = [];
  let currentRow = [];

  for (const btn of bottomButtons) {
    const text = (btn.text || '').trim();
    if (!text) continue;

    if (btn.fullWidth) {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      rows.push([text]);
    } else {
      currentRow.push(text);
      if (currentRow.length >= 3) {
        rows.push(currentRow);
        currentRow = [];
      }
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    rows.push(["✨ Today's Content"]);
    rows.push(['Button 1', 'Button 2', 'Button 3']);
  }

  // Telegram persistent reply keyboard: is_persistent = true keeps it stuck to the bottom!
  return Markup.keyboard(rows).resize().persistent();
}

async function sendWelcome(ctx) {
  const cfg = getConfig();
  const welcome = cfg.bot1?.welcome || {};
  let caption = formatMessage(
    welcome.message ||
      'NICE TO MEET YOU {username}\n\nDID YOU JOIN??\n✧ The {bot_name} Alerts Channel And Send A Join Request To The Backup Channel??',
    ctx
  );

  if (!caption.includes('Terms & Policy') && !caption.includes('terms') && !caption.includes('Terms')) {
    caption = `${caption}\n\n≼Terms & Policy≽`;
  }

  // forceTerms: true guarantees Terms is always the final button
  const keyboard = buildInlineKeyboard(welcome.buttons, null, true, false);
  const imagePath = welcome.imagePath
    ? path.join(__dirname, welcome.imagePath)
    : path.join(__dirname, 'assets', 'welcome.jpg');

  let sent = false;
  if (welcome.useImage && fs.existsSync(imagePath)) {
    try {
      await ctx.replyWithPhoto({ source: imagePath }, { caption, ...(keyboard ? keyboard : {}) });
      sent = true;
      try {
        const stickyKb = buildStickyReplyKeyboard();
        await ctx.reply('👇 Tap a button below for instant content drops:', stickyKb);
      } catch (_) {}
      return;
    } catch (err) {
      console.warn('[Bot 1] Photo send failed, trying plain text fallback:', err.message);
    }
  }

  if (!sent) {
    try {
      await ctx.reply(caption, keyboard ? keyboard : undefined);
      try {
        const stickyKb = buildStickyReplyKeyboard();
        await ctx.reply('👇 Tap a button below for instant content drops:', stickyKb);
      } catch (_) {}
    } catch (err) {
      await ctx.reply(caption);
    }
  }
}

// ====================================================
// MULTI-MESSAGE DELIVERY FOR /today WITH PREVIEW & REVEAL
// ====================================================
const todayUserCursors = new Map();

function formatTodayTimerText(seconds) {
  const sec = Number(seconds) || 0;
  if (sec <= 0) return 'off';
  if (sec >= 3600) return `${Math.round(sec / 3600)} hr`;
  if (sec >= 60) return `${Math.round(sec / 60)} min`;
  return `${sec} sec`;
}

async function sendSingleTodayPreview(ctx, msg, username, botName, showNextBtn = false) {
  const preview = msg.preview || {};
  const timerConfig = preview.timer || { enabled: false, seconds: 60 };
  const isTemporary = preview.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatTodayTimerText(timerSeconds);

  let caption = (preview.message || msg.message || "✨ *Today's Content Drop*")
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    const warning = timerConfig.warningMessage.replace(/{timer_text}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  const viewButtonText = msg.viewButtonText || '👁️ View Content';
  const rows = [
    [Markup.button.callback(viewButtonText, `reveal_today_${msg.id}`)]
  ];

  if (showNextBtn) {
    rows.push([Markup.button.callback("▶️ Next Today's Drop", 'next_today_drop')]);
  }

  if (preview.buttons && Array.isArray(preview.buttons)) {
    preview.buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') url = 'https://t.me/avniffanbasebot';
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
    } else if (preview.mediaUrl && mediaType === 'video') {
      sentMessage = await ctx.replyWithVideo(preview.mediaUrl, { caption, parse_mode: 'Markdown', ...inlineKeyboard });
    } else if (preview.mediaUrl && mediaType === 'photo') {
      sentMessage = await ctx.replyWithPhoto(preview.mediaUrl, { caption, parse_mode: 'Markdown', ...inlineKeyboard });
    } else {
      sentMessage = await ctx.reply(caption, { parse_mode: 'Markdown', ...inlineKeyboard });
    }
  } catch (err) {
    try {
      sentMessage = await ctx.reply(caption, inlineKeyboard);
    } catch (_) {
      sentMessage = await ctx.reply(caption);
    }
  }

  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ [Bot 1] Auto-deleted temporary today preview (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`[Bot 1] Could not delete today preview ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

async function sendTodayMessage(ctx) {
  const cfg = getConfig();
  const todayConfig = cfg.bot1?.today || cfg.today || {};
  const allMessages = todayConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  if (activeMessages.length === 0) {
    return ctx.reply("📭 There are currently no active drops for today. Please check back later!");
  }

  const deliveryMode = todayConfig.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = cfg.bot1?.bot_name || 'Avni FanBase';

  if (deliveryMode === 'all_in_one') {
    for (const msg of activeMessages) {
      await sendSingleTodayPreview(ctx, msg, username, botName, false);
    }
  } else {
    const userId = ctx.from?.id || 'default';
    const lastCursor = todayUserCursors.get(userId) ?? -1;
    const nextCursor = (lastCursor + 1) % activeMessages.length;
    todayUserCursors.set(userId, nextCursor);
    const chosen = activeMessages[nextCursor];
    const showNextBtn = activeMessages.length > 1;
    await sendSingleTodayPreview(ctx, chosen, username, botName, showNextBtn);
  }
}

async function handleRevealTodayAction(ctx, matchId) {
  try {
    await ctx.answerCbQuery("🔓 Unlocking today's content...");
  } catch (_) {}

  const cfg = getConfig();
  const todayConfig = cfg.bot1?.today || cfg.today || {};
  const allMessages = todayConfig.messages || [];
  const msg = allMessages.find((m) => m.id === matchId);

  if (!msg) return ctx.reply('❌ This content drop was not found.');
  if (msg.status === 'archived') return ctx.reply('🔒 This content drop has been archived.');

  const revealed = msg.revealedContent || {};
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = cfg.bot1?.bot_name || 'Avni FanBase';

  const timerConfig = revealed.timer || { enabled: false, seconds: 60 };
  const isTemporary = revealed.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatTodayTimerText(timerSeconds);

  let caption = (revealed.message || msg.message || "🎬 *Here is today's unlocked exclusive content!*")
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    const warning = timerConfig.warningMessage.replace(/{timer_text}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  const rows = [];
  if (revealed.buttons && Array.isArray(revealed.buttons)) {
    revealed.buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') url = 'https://t.me/avniffanbasebot';
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
    } else if (revealed.mediaUrl && mediaType === 'video') {
      sentMessage = await ctx.replyWithVideo(revealed.mediaUrl, { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) });
    } else if (revealed.mediaUrl && mediaType === 'photo') {
      sentMessage = await ctx.replyWithPhoto(revealed.mediaUrl, { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) });
    } else {
      sentMessage = await ctx.reply(caption, { parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) });
    }
  } catch (err) {
    try {
      sentMessage = await ctx.reply(caption, inlineKeyboard);
    } catch (_) {
      sentMessage = await ctx.reply(caption);
    }
  }

  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ [Bot 1] Auto-deleted revealed today content (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`[Bot 1] Could not delete revealed content ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

// ----------------------------------------------------
// MESSAGE LISTS & CROSS-BOT DEEP LINKING ENGINE (Bot 1 -> Bot 2)
// ----------------------------------------------------
const listUserCursors = new Map();

function getTargetBotUsername(targetBotKey = 'bot2') {
  const map = {
    bot1: 'avniffanbasebot',
    bot2: 'avnifanbbot',
    bot3: 'anishaclubbot'
  };
  return map[targetBotKey] || 'avnifanbbot';
}

async function sendSingleListPreview(ctx, msg, list, username, botName, showNextBtn = false) {
  const preview = msg.preview || {};
  const timerConfig = preview.timer || { enabled: false, seconds: 60 };
  const isTemporary = preview.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatTodayTimerText(timerSeconds);

  let caption = (preview.message || msg.message || '✨ *Exclusive Content Drop*')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    const warning = timerConfig.warningMessage.replace(/{timer_text}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  // Mandatory Cross-Bot Deep Linking:
  // "View Content" redirects to Bot 2 @avnifanbbot with ?start=<msg.id>
  const viewButtonText = msg.viewButtonText || '👁️ View Content';
  const targetUsername = getTargetBotUsername(list.targetBot || 'bot2');
  const deepLinkUrl = `https://t.me/${targetUsername}?start=${msg.id}`;

  const rows = [
    [Markup.button.url(viewButtonText, deepLinkUrl)]
  ];

  if (showNextBtn) {
    rows.push([Markup.button.callback('▶️ Next Drop', `next_list_drop_${list.id}`)]);
  }

  if (preview.buttons && Array.isArray(preview.buttons)) {
    preview.buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') url = 'https://t.me/avniffanbasebot';
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
    } else if (preview.mediaUrl && mediaType === 'video') {
      sentMessage = await ctx.replyWithVideo(preview.mediaUrl, { caption, parse_mode: 'Markdown', ...inlineKeyboard });
    } else if (preview.mediaUrl && mediaType === 'photo') {
      sentMessage = await ctx.replyWithPhoto(preview.mediaUrl, { caption, parse_mode: 'Markdown', ...inlineKeyboard });
    } else {
      sentMessage = await ctx.reply(caption, { parse_mode: 'Markdown', ...inlineKeyboard });
    }
  } catch (err) {
    try {
      sentMessage = await ctx.reply(caption, inlineKeyboard);
    } catch (_) {
      sentMessage = await ctx.reply(caption);
    }
  }

  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ [Bot 1] Auto-deleted preview (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`[Bot 1] Could not delete preview ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

async function executeMessageList(ctx, listId) {
  const cfg = getConfig();
  const lists = cfg.bot1?.messageLists || cfg.messageLists || [];
  let list = lists.find((l) => l.id === listId);

  if (!list && listId === 'list_free') {
    list = {
      id: 'list_free',
      title: 'Free Content Drops',
      deliveryMode: cfg.bot1?.free?.deliveryMode || 'all_in_one',
      targetBot: 'bot2',
      messages: cfg.bot1?.free?.messages || []
    };
  }

  if (!list) return ctx.reply('📭 Message list not found.');

  const allMessages = list.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');
  if (activeMessages.length === 0) return ctx.reply(`📭 No active drops available in "${list.title}".`);

  const deliveryMode = list.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = cfg.bot1?.bot_name || 'Avni FanBase';

  if (deliveryMode === 'all_in_one') {
    for (const msg of activeMessages) {
      await sendSingleListPreview(ctx, msg, list, username, botName, false);
    }
  } else {
    const userId = ctx.from?.id || 'default';
    const cursorKey = `${userId}_${list.id}`;
    const lastCursor = listUserCursors.get(cursorKey) ?? -1;
    const nextCursor = (lastCursor + 1) % activeMessages.length;
    listUserCursors.set(cursorKey, nextCursor);
    const chosen = activeMessages[nextCursor];
    const showNextBtn = activeMessages.length > 1;
    await sendSingleListPreview(ctx, chosen, list, username, botName, showNextBtn);
  }
}

async function handleNextListDropAction(ctx, listId) {
  try { await ctx.answerCbQuery('Fetching next drop...'); } catch (_) {}
  const cfg = getConfig();
  const lists = cfg.bot1?.messageLists || cfg.messageLists || [];
  const list = lists.find((l) => l.id === listId);
  if (!list) return ctx.reply('📭 Message list not found.');

  const allMessages = list.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');
  if (activeMessages.length === 0) return ctx.reply('📭 No active drops available.');

  const userId = ctx.from?.id || 'default';
  const cursorKey = `${userId}_${list.id}`;
  const lastCursor = listUserCursors.get(cursorKey) ?? 0;
  const nextCursor = (lastCursor + 1) % activeMessages.length;
  listUserCursors.set(cursorKey, nextCursor);
  const chosen = activeMessages[nextCursor];
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = cfg.bot1?.bot_name || 'Avni FanBase';
  const showNextBtn = activeMessages.length > 1;
  await sendSingleListPreview(ctx, chosen, list, username, botName, showNextBtn);
}

// Multi-message delivery for /free with temporary/permanent support & individual buttons
const bot1FreeCursors = new Map();

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
    const warning = timerConfig.warningMessage.replace(/{timer_text}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  // Row 1: Unique View Content button that reveals the hidden content for this drop
  const viewButtonText = msg.viewButtonText || '👁️ View Content';
  const rows = [
    [Markup.button.callback(viewButtonText, `reveal_free_${msg.id}`)]
  ];

  // If in Mode 2 (sequential) and there are multiple active drops, add Next Free Content button
  if (showNextBtn) {
    rows.push([Markup.button.callback('▶️ Next Free Content', 'next_free_drop')]);
  }

  // Any custom buttons configured for this preview
  if (preview.buttons && Array.isArray(preview.buttons)) {
    preview.buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') {
          url = 'https://t.me/avniffanbasebot';
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        rows.push([Markup.button.url(b.text, url)]);
      });
  }

  const inlineKeyboard = Markup.inlineKeyboard(rows);
  let sentMessage = null;
  const mediaPath = preview.mediaPath ? path.join(__dirname, preview.mediaPath) : null;
  const mediaType = preview.mediaType || 'none';

  try {
    if (mediaType === 'video' && mediaPath && fs.existsSync(mediaPath)) {
      try {
        sentMessage = await ctx.replyWithVideo(
          { source: mediaPath },
          { caption, parse_mode: 'Markdown', ...inlineKeyboard }
        );
      } catch (vidErr) {
        console.warn('[sendSingleListPreview] Video markdown failed, retrying plain text:', vidErr.message);
        sentMessage = await ctx.replyWithVideo({ source: mediaPath }, { caption, ...inlineKeyboard });
      }
    } else if (mediaType === 'photo' && mediaPath && fs.existsSync(mediaPath)) {
      ensureTelegramImageSafe(mediaPath);
      try {
        sentMessage = await ctx.replyWithPhoto(
          { source: mediaPath },
          { caption, parse_mode: 'Markdown', ...inlineKeyboard }
        );
      } catch (photoErr) {
        console.warn('[sendSingleListPreview] Photo markdown failed, retrying plain text caption:', photoErr.message);
        try {
          sentMessage = await ctx.replyWithPhoto(
            { source: mediaPath },
            { caption, ...inlineKeyboard }
          );
        } catch (photoErr2) {
          console.error('[sendSingleListPreview] replyWithPhoto failed, falling back to document:', photoErr2.message);
          sentMessage = await ctx.replyWithDocument(
            { source: mediaPath },
            { caption, ...inlineKeyboard }
          );
        }
      }
    } else if (preview.mediaUrl && mediaType === 'video') {
      try {
        sentMessage = await ctx.replyWithVideo(
          preview.mediaUrl,
          { caption, parse_mode: 'Markdown', ...inlineKeyboard }
        );
      } catch (_) {
        sentMessage = await ctx.replyWithVideo(preview.mediaUrl, { caption, ...inlineKeyboard });
      }
    } else if (preview.mediaUrl && mediaType === 'photo') {
      try {
        sentMessage = await ctx.replyWithPhoto(
          preview.mediaUrl,
          { caption, parse_mode: 'Markdown', ...inlineKeyboard }
        );
      } catch (_) {
        sentMessage = await ctx.replyWithPhoto(preview.mediaUrl, { caption, ...inlineKeyboard });
      }
    } else {
      sentMessage = await ctx.reply(caption, { parse_mode: 'Markdown', ...inlineKeyboard });
    }
  } catch (err) {
    console.error('[sendSingleListPreview] Error sending preview message:', err.message);
    try {
      sentMessage = await ctx.reply(caption, inlineKeyboard);
    } catch (_) {
      sentMessage = await ctx.reply(caption);
    }
  }

  // Auto-Destruct Timer for Preview
  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ [Bot 1] Auto-deleted temporary free preview (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`[Bot 1] Could not delete free preview ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

async function sendFreeMessage(ctx) {
  const cfg = getConfig();
  const freeConfig = cfg.bot1?.free || cfg.free || {};
  const allMessages = freeConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  if (activeMessages.length === 0) {
    return ctx.reply('📭 There are currently no active free content drops. Please check back later!');
  }

  const deliveryMode = freeConfig.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'Friend';
  const botName = cfg.bot1?.bot_name || 'Avni FanBase';

  if (deliveryMode === 'all_in_one') {
    // Mode 1: Send all active messages in one go
    for (const msg of activeMessages) {
      await sendSingleFreePreview(ctx, msg, username, botName, false);
    }
  } else {
    // Mode 2: Sequential (one by one)
    const userId = ctx.from?.id || 'default';
    const lastCursor = bot1FreeCursors.get(userId) ?? -1;
    const nextCursor = (lastCursor + 1) % activeMessages.length;
    bot1FreeCursors.set(userId, nextCursor);
    const chosen = activeMessages[nextCursor];
    const showNextBtn = activeMessages.length > 1;
    await sendSingleFreePreview(ctx, chosen, username, botName, showNextBtn);
  }
}

async function handleRevealFreeAction(ctx, matchId) {
  try {
    await ctx.answerCbQuery('🔓 Unlocking content...');
  } catch (_) {}

  const cfg = getConfig();
  const freeConfig = cfg.bot1?.free || cfg.free || {};
  const allMessages = freeConfig.messages || [];
  const msg = allMessages.find((m) => m.id === matchId);

  if (!msg) {
    return ctx.reply('❌ This content drop was not found.');
  }
  if (msg.status === 'archived') {
    return ctx.reply('🔒 This content drop has been archived.');
  }

  const revealed = msg.revealedContent || {};
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = cfg.bot1?.bot_name || 'Avni FanBase';

  const timerConfig = revealed.timer || { enabled: false, seconds: 60 };
  const isTemporary = revealed.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatFreeTimerText(timerSeconds);

  let caption = (revealed.message || msg.message || '🔥 *Here is your unlocked exclusive content!*')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    const warning = timerConfig.warningMessage.replace(/{timer_text}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  const rows = [];
  if (revealed.buttons && Array.isArray(revealed.buttons)) {
    revealed.buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') {
          url = 'https://t.me/avniffanbasebot';
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        rows.push([Markup.button.url(b.text, url)]);
      });
  }

  const inlineKeyboard = rows.length > 0 ? Markup.inlineKeyboard(rows) : undefined;
  let sentMessage = null;
  const mediaPath = revealed.mediaPath ? path.join(__dirname, revealed.mediaPath) : null;
  const mediaType = revealed.mediaType || 'none';

  try {
    if (mediaType === 'video' && mediaPath && fs.existsSync(mediaPath)) {
      sentMessage = await ctx.replyWithVideo(
        { source: mediaPath },
        { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
      );
    } else if (mediaType === 'photo' && mediaPath && fs.existsSync(mediaPath)) {
      sentMessage = await ctx.replyWithPhoto(
        { source: mediaPath },
        { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
      );
    } else if (revealed.mediaUrl && mediaType === 'video') {
      sentMessage = await ctx.replyWithVideo(
        revealed.mediaUrl,
        { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
      );
    } else if (revealed.mediaUrl && mediaType === 'photo') {
      sentMessage = await ctx.replyWithPhoto(
        revealed.mediaUrl,
        { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
      );
    } else {
      sentMessage = await ctx.reply(
        caption,
        { parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
      );
    }
  } catch (err) {
    try {
      sentMessage = await ctx.reply(caption, inlineKeyboard);
    } catch (_) {
      sentMessage = await ctx.reply(caption);
    }
  }

  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ [Bot 1] Auto-deleted revealed content (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`[Bot 1] Could not delete revealed message ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

// Commands
bot.start(async (ctx) => {
  await sendWelcome(ctx);
});

bot.command('today', async (ctx) => {
  await sendTodayMessage(ctx);
});

bot.command('todayscontent', async (ctx) => {
  await sendTodayMessage(ctx);
});

bot.action('view_today', async (ctx) => {
  try { await ctx.answerCbQuery("Opening Today's Content..."); } catch (_) {}
  await sendTodayMessage(ctx);
});

bot.action(/^reveal_today_(.+)$/, async (ctx) => {
  await handleRevealTodayAction(ctx, ctx.match[1]);
});

bot.action('next_today_drop', async (ctx) => {
  try { await ctx.answerCbQuery("Fetching next drop for today..."); } catch (_) {}
  await sendTodayMessage(ctx);
});

bot.command('free', async (ctx) => {
  await sendFreeMessage(ctx);
});

bot.action(/^reveal_free_(.+)$/, async (ctx) => {
  await handleRevealFreeAction(ctx, ctx.match[1]);
});

bot.action('next_free_drop', async (ctx) => {
  try { await ctx.answerCbQuery('Fetching next free drop...'); } catch (_) {}
  await sendFreeMessage(ctx);
});

// Dynamic Message List Actions
bot.action(/^open_list_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  await executeMessageList(ctx, ctx.match[1]);
});

bot.action(/^next_list_drop_(.+)$/, async (ctx) => {
  await handleNextListDropAction(ctx, ctx.match[1]);
});

bot.command('btn1', async (ctx) => {
  await executeMessageList(ctx, 'list_btn1');
});
bot.command('btn2', async (ctx) => {
  await executeMessageList(ctx, 'list_btn2');
});
bot.command('btn3', async (ctx) => {
  await executeMessageList(ctx, 'list_btn3');
});

// Terms Command: Clear Back to Main button
bot.command('terms', async (ctx) => {
  const cfg = getConfig();
  const terms = cfg.bot1?.terms || {};
  const text = `📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`;
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (_) {
    await ctx.reply(terms.content || 'Terms & Policy');
  }
});

bot.command('help', async (ctx) => {
  const cfg = getConfig();
  const help = cfg.bot1?.help || {};
  const text =
    help.message ||
    '🤖 *Bot 1 (@avniffanbasebot) Help & Support*\n\nAvailable commands:\n• /start - Welcome message\n• /free - Access free content & community drops\n• /terms - View Terms & Policy\n• /help - View this guide';
  try {
    await ctx.replyWithMarkdown(text);
  } catch (_) {
    await ctx.reply(text);
  }
});

// Terms Action: Native Dialog Box or In-Chat (No "Back to Main" button)
bot.action('view_terms', async (ctx) => {
  const cfg = getConfig();
  const terms = cfg.bot1?.terms || {};
  const windowMode = terms.windowMode || 'dialog';
  const title = terms.title || 'Terms & Policy';
  const content = terms.content || 'Welcome to our community.\n\nAll content shared is strictly for community members.';

  if (windowMode === 'dialog') {
    try {
      await ctx.answerCbQuery(`📜 ${title}\n\n${content}`, { show_alert: true });
    } catch (_) {
      try { await ctx.answerCbQuery(); } catch (_) {}
      await ctx.reply(`📜 *${title}*\n\n${content}`);
    }
  } else {
    try { await ctx.answerCbQuery(); } catch (_) {}
    try {
      await ctx.reply(`📜 *${title}*\n\n${content}`);
    } catch (_) {
      await ctx.reply(content);
    }
  }
});

bot.on('text', async (ctx) => {
  const text = (ctx.message.text || '').trim();
  const name = ctx.from?.first_name || 'Friend';
  if (text === '/start' || text.startsWith('/start ')) return await sendWelcome(ctx);

  // Handle Sticky Bottom Keyboard Buttons (Today's Content, Button 1, Button 2, Button 3, and custom buttons)
  const cfg = getConfig();
  const bottomButtons = cfg.bot1?.welcome?.bottomButtons || [];
  const matchedBtn = bottomButtons.find(
    (b) => b.text && b.text.trim().toLowerCase() === text.toLowerCase()
  );
  if (matchedBtn) {
    if (matchedBtn.type === 'today' || matchedBtn.text.toLowerCase().includes('today')) {
      return await sendTodayMessage(ctx);
    }
    if (matchedBtn.type === 'free' || matchedBtn.text.toLowerCase().includes('free')) {
      return await sendFreeMessage(ctx);
    }
    if (matchedBtn.type === 'url' && matchedBtn.url) {
      let u = matchedBtn.url.trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
      return await ctx.reply(`🔗 Tap below to visit:`, Markup.inlineKeyboard([
        [Markup.button.url(matchedBtn.text || 'Open Link', u)]
      ]));
    }
    if (matchedBtn.type === 'terms') {
      const terms = cfg.bot1?.terms || {};
      return await ctx.reply(`📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`);
    }
    const listId = matchedBtn.listId || 'list_btn1';
    return await executeMessageList(ctx, listId);
  }

  if (
    text.toLowerCase() === "✨ today's content".toLowerCase() ||
    text.toLowerCase() === "today's content".toLowerCase() ||
    text.toLowerCase() === "todays content".toLowerCase() ||
    text === '/today' ||
    text.startsWith('/today ') ||
    text === '/todayscontent' ||
    text.startsWith('/todayscontent ')
  ) {
    return await sendTodayMessage(ctx);
  }

  if (text.toLowerCase() === 'button 1' || text === '/btn1') return await executeMessageList(ctx, 'list_btn1');
  if (text.toLowerCase() === 'button 2' || text === '/btn2') return await executeMessageList(ctx, 'list_btn2');
  if (text.toLowerCase() === 'button 3' || text === '/btn3') return await executeMessageList(ctx, 'list_btn3');
  if (text === '/today' || text.startsWith('/today ') || text === '/todayscontent' || text.startsWith('/todayscontent ')) return await sendTodayMessage(ctx);
  if (text === '/free' || text.startsWith('/free ')) return await sendFreeMessage(ctx);
  if (text === '/terms') {
    const cfg = getConfig();
    const terms = cfg.bot1?.terms || {};
    return await ctx.reply(`📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`);
  }
  if (text === '/help') {
    const cfg = getConfig();
    const help = cfg.bot1?.help || {};
    return await ctx.replyWithMarkdown(help.message || '🤖 Bot Help:\n• /start\n• /free\n• /terms\n• /help');
  }
  if (text.startsWith('/')) {
    await ctx.reply('❓ Unknown command.\nAvailable commands are:\n• /start - Welcome greeting\n• /free - Free content drops\n• /terms - Community guidelines\n• /help - Bot support');
  } else {
    await ctx.reply(`👋 Hello ${name}! Type /start or /free to explore our community!`);
  }
});

bot.catch((err) => {
  console.error('[Bot 1] Error:', err.message);
});

// Launch polling
console.log('🤖 Starting Bot 1: @avniffanbasebot standalone runner...');
bot.launch({ dropPendingUpdates: false }).catch((err) => {
  console.error('❌ Bot 1 failed to start:', err.message);
  process.exit(1);
});
console.log('✅ Bot 1 (@avniffanbasebot) is live with long polling!');

bot.telegram.setMyCommands([
  { command: 'start', description: 'Welcome greeting & community links' },
  { command: 'today', description: "View Today's fresh content drop" },
  { command: 'free', description: 'Access free content and channels' },
  { command: 'terms', description: 'View Terms & Policy' },
  { command: 'help', description: 'Bot commands and support' },
]).catch((err) => {
  console.warn('[Bot 1] Could not register commands:', err.message);
});

function shutdown(signal) {
  console.log(`\nStopping Bot 1 (${signal})...`);
  bot.stop(signal);
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
