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
  process.env.TELEGRAM_BOT_TOKEN_2 ||
  ''
).trim();

const bot = new Telegraf(token);

// Pre-populate botInfo to eliminate internal getMe() calls and avoid 429 rate limits
bot.botInfo = {
  id: parseInt(token.split(':')[0], 10),
  is_bot: true,
  first_name: 'Avni Fanbase Demo',
  username: 'avnifanbbot',
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

function buildInlineKeyboard(buttons, extraRow = null) {
  const rows = [];
  if (buttons && Array.isArray(buttons)) {
    buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') {
          url = 'https://t.me/avnifanbbot';
        }
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        rows.push([Markup.button.url(b.text, url)]);
      });
  }
  if (extraRow && Array.isArray(extraRow) && extraRow.length > 0) {
    rows.push(extraRow);
  }
  return rows.length > 0 ? Markup.inlineKeyboard(rows) : null;
}

// ----------------------------------------------------
// BOT 2 USER LIMIT TRACKING (Normal vs Limited) & COUNTER
// ----------------------------------------------------
const bot2UserAccessCounts = new Map(); // userId -> count

function checkAndIncrementBot2UserLimit(ctx, message) {
  const cfg = getConfig();
  const limitCfg = cfg.bot2?.userLimit || { enabled: false, maxDrops: 3 };

  if (!limitCfg.enabled) return { allowed: true };

  const accessType = message.accessType || 'limited';
  if (accessType === 'normal') {
    return { allowed: true, isNormal: true };
  }

  const userId = ctx.from?.id ? String(ctx.from.id) : 'default';
  const currentCount = bot2UserAccessCounts.get(userId) || 0;
  const maxDrops = Number(limitCfg.maxDrops) || 3;

  if (currentCount >= maxDrops) {
    return {
      allowed: false,
      currentCount,
      maxDrops,
      limitCfg
    };
  }

  bot2UserAccessCounts.set(userId, currentCount + 1);
  console.log(`📊 [Bot 2] User ${userId} accessed limited content (${currentCount + 1}/${maxDrops})`);
  return {
    allowed: true,
    currentCount: currentCount + 1,
    maxDrops
  };
}

async function sendBot2LimitExceededMessage(ctx, limitCfg) {
  const cfg = getConfig();
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = cfg.bot2?.bot_name || 'Avni Fanbase Demo';
  const maxDrops = Number(limitCfg.maxDrops) || 3;

  let text = (limitCfg.limitReachedMessage || '🚫 *Daily Access Limit Reached!*\n\nHey {username}, you have unlocked all {limit} allowed content drops for today!\n\nUpgrade to VIP Access to unlock unlimited drops with zero limits.')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{limit}/g, maxDrops)
    .replace(/{max_drops}/g, maxDrops);

  const rows = [];
  if (limitCfg.buttons && Array.isArray(limitCfg.buttons)) {
    limitCfg.buttons
      .filter((b) => b.text && b.text.trim() !== '')
      .forEach((b) => {
        let url = (b.url || '').trim();
        if (!url || url === 'https://t.me/' || url === 'https://t.me') url = 'https://t.me/avniffanbasebot';
        if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
        rows.push([Markup.button.url(b.text, url)]);
      });
  }

  const inlineKeyboard = rows.length > 0 ? Markup.inlineKeyboard(rows) : undefined;
  try {
    await ctx.reply(text, { parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) });
  } catch (_) {
    await ctx.reply(text, inlineKeyboard);
  }
}

// Function executed on Bot 2 to deliver unlocked content from any Message List, Free, or Today
async function deliverRevealedDropOnBot2(ctx, dropId) {
  const cfg = getConfig();
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = cfg.bot2?.bot_name || 'Avni Fanbase Demo';

  let foundDrop = null;
  const lists = cfg.bot1?.messageLists || cfg.messageLists || [];
  for (const l of lists) {
    const d = (l.messages || []).find((m) => m.id === dropId);
    if (d) { foundDrop = d; break; }
  }

  if (!foundDrop && cfg.bot1?.free?.messages) {
    foundDrop = cfg.bot1.free.messages.find((m) => m.id === dropId);
  }
  if (!foundDrop && cfg.bot1?.today?.messages) {
    foundDrop = cfg.bot1.today.messages.find((m) => m.id === dropId);
  }

  // If dropId refers to an entire list (e.g. list_btn1, list_free, btn1) and list is large, randomize
  if (!foundDrop) {
    const matchedList = lists.find(
      (l) => l.id === dropId || l.id === `list_${dropId}` || l.title?.toLowerCase() === dropId.toLowerCase()
    );
    if (matchedList && matchedList.messages && matchedList.messages.length > 0) {
      const active = matchedList.messages.filter((m) => m.status !== 'archived');
      if (active.length > 0) {
        if (active.length > 2 || matchedList.deliveryMode === 'random') {
          foundDrop = active[Math.floor(Math.random() * active.length)];
        } else {
          foundDrop = active[0];
        }
      }
    }
  }

  if (!foundDrop && (dropId === 'free' || dropId === 'list_free') && cfg.bot1?.free?.messages) {
    const active = cfg.bot1.free.messages.filter((m) => m.status !== 'archived');
    if (active.length > 0) {
      foundDrop = active.length > 2 ? active[Math.floor(Math.random() * active.length)] : active[0];
    }
  }
  if (!foundDrop && (dropId === 'today' || dropId === 'list_today') && cfg.bot1?.today?.messages) {
    const active = cfg.bot1.today.messages.filter((m) => m.status !== 'archived');
    if (active.length > 0) {
      foundDrop = active.length > 2 ? active[Math.floor(Math.random() * active.length)] : active[0];
    }
  }

  if (!foundDrop) return null;

  if (foundDrop.status === 'archived') {
    await ctx.reply('🔒 This exclusive content drop has been archived and is no longer available.');
    return true;
  }

  // Check User Limit for Bot 2
  const limitCheck = checkAndIncrementBot2UserLimit(ctx, foundDrop);
  if (!limitCheck.allowed) {
    await sendBot2LimitExceededMessage(ctx, limitCheck.limitCfg);
    return true;
  }

  const revealed = foundDrop.revealedContent || {};
  const timerConfig = revealed.timer || { enabled: false, seconds: 60 };
  const isTemporary = revealed.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;

  let caption = (revealed.message || foundDrop.message || '🎬 *Here is your unlocked exclusive content!*')
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
      try {
        sentMessage = await ctx.replyWithVideo(
          { source: mediaPath },
          { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
        );
      } catch (vidErr) {
        console.warn('[deliverRevealedDropOnBot2] Video markdown failed, retrying plain text:', vidErr.message);
        sentMessage = await ctx.replyWithVideo({ source: mediaPath }, { caption, ...(inlineKeyboard ? inlineKeyboard : {}) });
      }
    } else if (mediaType === 'photo' && mediaPath && fs.existsSync(mediaPath)) {
      ensureTelegramImageSafe(mediaPath);
      try {
        sentMessage = await ctx.replyWithPhoto(
          { source: mediaPath },
          { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
        );
      } catch (photoErr) {
        console.warn('[deliverRevealedDropOnBot2] Photo markdown failed, retrying plain text caption:', photoErr.message);
        try {
          sentMessage = await ctx.replyWithPhoto(
            { source: mediaPath },
            { caption, ...(inlineKeyboard ? inlineKeyboard : {}) }
          );
        } catch (photoErr2) {
          console.error('[deliverRevealedDropOnBot2] replyWithPhoto failed, falling back to document:', photoErr2.message);
          sentMessage = await ctx.replyWithDocument(
            { source: mediaPath },
            { caption, ...(inlineKeyboard ? inlineKeyboard : {}) }
          );
        }
      }
    } else if (revealed.mediaUrl && mediaType === 'video') {
      try {
        sentMessage = await ctx.replyWithVideo(
          revealed.mediaUrl,
          { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
        );
      } catch (_) {
        sentMessage = await ctx.replyWithVideo(revealed.mediaUrl, { caption, ...(inlineKeyboard ? inlineKeyboard : {}) });
      }
    } else if (revealed.mediaUrl && mediaType === 'photo') {
      try {
        sentMessage = await ctx.replyWithPhoto(
          revealed.mediaUrl,
          { caption, parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
        );
      } catch (_) {
        sentMessage = await ctx.replyWithPhoto(revealed.mediaUrl, { caption, ...(inlineKeyboard ? inlineKeyboard : {}) });
      }
    } else {
      sentMessage = await ctx.reply(
        caption,
        { parse_mode: 'Markdown', ...(inlineKeyboard ? inlineKeyboard : {}) }
      );
    }
  } catch (err) {
    console.error('[deliverRevealedDropOnBot2] Error delivering revealed drop:', err.message);
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
        console.log(`🗑️ [Bot 2] Auto-deleted revealed content (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`[Bot 2] Could not delete revealed content ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  console.log(`🚀 [Bot 2] Delivered unlocked drop "${foundDrop.title || dropId}" to ${username}`);
  return true;
}

const userCursors = new Map();

async function sendTimedMessage(ctx, targetMsgId = null) {
  const cfg = getConfig();
  const bot2Config = cfg.bot2 || {};
  const allMessages = bot2Config.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  let chosen = null;

  if (targetMsgId) {
    chosen = allMessages.find((m) => m.id === targetMsgId);
    if (!chosen) return ctx.reply('❌ This video drop was not found.');
    if (chosen.status === 'archived') return ctx.reply('🔒 This video drop has been archived.');
  } else {
    if (activeMessages.length === 0) {
      return ctx.reply('📭 There are currently no active video drops.');
    }
    const userId = ctx.from?.id || 'default';
    const deliveryMode = bot2Config.deliveryMode || 'rotate';
    if (deliveryMode === 'random' || activeMessages.length > 2) {
      const randIdx = Math.floor(Math.random() * activeMessages.length);
      chosen = activeMessages[randIdx];
    } else {
      const lastCursor = userCursors.get(userId) ?? -1;
      const nextCursor = (lastCursor + 1) % activeMessages.length;
      userCursors.set(userId, nextCursor);
      chosen = activeMessages[nextCursor];
    }
  }

  // Check user limit for Bot 2
  const limitCheck = checkAndIncrementBot2UserLimit(ctx, chosen);
  if (!limitCheck.allowed) {
    await sendBot2LimitExceededMessage(ctx, limitCheck.limitCfg);
    return;
  }

  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'Friend';
  const botName = bot2Config.bot_name || 'Avni Fanbase Demo';
  const timerConfig = chosen.timer || bot2Config.defaultTimer || { enabled: true, seconds: 60 };
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;

  let caption = (chosen.message || '🎬 Exclusive Video Drop!\n\n⚠️ Self-destructs in {timer_text}!')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText)
    .replace(/{timer}/g, timerText);

  if (timerConfig.enabled && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    const warning = timerConfig.warningMessage.replace(/{timer_text}/g, timerText).replace(/{timer}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  let extraRow = null;
  if (activeMessages.length > 1) {
    extraRow = [Markup.button.callback('▶️ Next Video Drop', 'next_drop')];
  }
  const keyboard = buildInlineKeyboard(chosen.buttons, extraRow);

  let sentMessage = null;
  const videoPath = chosen.videoPath ? path.join(__dirname, chosen.videoPath) : null;

  if (videoPath && fs.existsSync(videoPath)) {
    try {
      sentMessage = await ctx.replyWithVideo({ source: videoPath }, { caption, parse_mode: 'Markdown', ...(keyboard ? keyboard : {}) });
    } catch (_) {
      try {
        sentMessage = await ctx.replyWithVideo({ source: videoPath }, { caption, ...(keyboard ? keyboard : {}) });
      } catch (err) {
        console.error('[Bot 2] Failed to send local video:', err.message);
      }
    }
  }

  if (!sentMessage && chosen.videoUrl && chosen.videoUrl.trim() !== '') {
    try {
      sentMessage = await ctx.replyWithVideo(chosen.videoUrl.trim(), { caption, parse_mode: 'Markdown', ...(keyboard ? keyboard : {}) });
    } catch (_) {
      try {
        sentMessage = await ctx.replyWithVideo(chosen.videoUrl.trim(), { caption, ...(keyboard ? keyboard : {}) });
      } catch (err) {
        console.error('[Bot 2] Failed to send video from URL:', err.message);
      }
    }
  }

  if (!sentMessage) {
    try {
      sentMessage = await ctx.reply(caption, { parse_mode: 'Markdown', ...(keyboard ? keyboard : {}) });
    } catch (_) {
      sentMessage = await ctx.reply(caption, keyboard ? keyboard : undefined);
    }
  }

  if (timerConfig.enabled && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ [Bot 2] Auto-deleted message ${messageId} after ${timerSeconds}s.`);
      } catch (_) {}
    }, timerSeconds * 1000);
  }
}

// Portable Free Drops Engine for Bot 2
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
      let url = (b.url || '').trim() || 'https://t.me/avnifanbbot';
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

  if (assigned !== 'all' && assigned !== 'bot2') {
    return ctx.reply('🎁 Free content drops are currently hosted on @avniffanbasebot! Please send /free there.');
  }

  const allMessages = freeConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');
  if (activeMessages.length === 0) {
    return ctx.reply('📭 There are currently no active free content drops. Please check back later!');
  }

  const deliveryMode = freeConfig.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'Friend';
  const botName = cfg.bot2?.bot_name || 'Avni Fanbase Demo';

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
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name || 'Friend';
  const botName = cfg.bot2?.bot_name || 'Avni Fanbase Demo';

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
      let url = (b.url || '').trim() || 'https://t.me/avnifanbbot';
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

// Commands
bot.start(async (ctx) => {
  const name = ctx.from?.first_name || 'there';
  try {
    await ctx.reply(`👋 Hello ${name}! Welcome to @avnifanbbot (Timed Video Drops) 🎬`);
  } catch (_) {}
  const payload = ctx.startPayload;
  if (payload && payload.trim() !== '') {
    await sendTimedMessage(ctx, payload.trim());
  } else {
    await sendTimedMessage(ctx);
  }
});

bot.command('video', async (ctx) => {
  await sendTimedMessage(ctx);
});

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

bot.command('list', async (ctx) => {
  const cfg = getConfig();
  const bot2Config = cfg.bot2 || {};
  const activeMessages = (bot2Config.messages || []).filter((m) => m.status === 'active');
  if (activeMessages.length === 0) return ctx.reply('📭 There are currently no active video drops.');

  let text = `🎬 *Active Video Drops (${activeMessages.length})*\n\nSelect a drop below to view with auto-delete timer:\n`;
  const buttons = activeMessages.map((m, idx) => {
    const tSec = m.timer?.seconds || 60;
    const tText = tSec >= 60 ? `${Math.round(tSec / 60)}m` : `${tSec}s`;
    return [Markup.button.callback(`▶️ ${idx + 1}. ${m.title || 'Drop'} (${tText})`, `view_drop_${m.id}`)];
  });
  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
});

bot.command('timer', async (ctx) => {
  const cfg = getConfig();
  const bot2Config = cfg.bot2 || {};
  const defTimer = bot2Config.defaultTimer || { seconds: 60 };
  const timerSeconds = Number(defTimer.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;
  await ctx.reply(`⏱️ *Current Auto-Delete Timer:* ${timerText}\nAll delivered video drops will vanish after this duration.`);
});

bot.command('help', async (ctx) => {
  const cfg = getConfig();
  const bot2Config = cfg.bot2 || {};
  const defTimer = bot2Config.defaultTimer || { seconds: 60 };
  const timerSeconds = Number(defTimer.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;
  const help = bot2Config.help || {};
  const text = (
    help.message ||
    '🤖 *Bot 2 (@avnifanbbot) Help & Information*\n\nAvailable commands:\n• /start - Receive video drop\n• /video - Get next video drop\n• /list - Browse all active drops\n• /timer - View timer\n• /help - Bot information\n\n⏱ Default Timer: {timer_text}'
  )
    .replace(/{timer_text}/g, timerText)
    .replace(/{timer}/g, timerText)
    .replace(/{bot_name}/g, bot2Config.bot_name || 'Avni Fanbase Demo');

  try {
    await ctx.replyWithMarkdown(text);
  } catch (_) {
    await ctx.reply(text);
  }
});

bot.action('next_drop', async (ctx) => {
  try { await ctx.answerCbQuery('Fetching next drop...'); } catch (_) {}
  await sendTimedMessage(ctx);
});

bot.action(/view_drop_(.+)/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const targetId = ctx.match[1];
  await sendTimedMessage(ctx, targetId);
});

bot.on('video', async (ctx) => {
  const cfg = getConfig();
  const bot2Config = cfg.bot2 || {};
  const defTimer = bot2Config.defaultTimer || { enabled: true, seconds: 60 };
  const timerSeconds = Number(defTimer.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;

  const videoFileId = ctx.message.video.file_id;
  const userCaption = ctx.message.caption ? `${ctx.message.caption}\n\n` : '';
  const caption = `${userCaption}⏳ *Self-Destruct Active*: This video will be automatically deleted in ${timerText}.`;

  try {
    const sent = await ctx.replyWithVideo(videoFileId, { caption, parse_mode: 'Markdown' });
    if (defTimer.enabled && timerSeconds > 0) {
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(sent.chat.id, sent.message_id);
          try { await ctx.telegram.deleteMessage(ctx.message.chat.id, ctx.message.message_id); } catch (_) {}
        } catch (_) {}
      }, timerSeconds * 1000);
    }
  } catch (err) {
    console.error('[Bot 2] Error echoing video:', err.message);
  }
});

bot.on('text', async (ctx) => {
  const text = (ctx.message.text || '').trim();
  const name = ctx.from?.first_name || 'there';

  if (text === '/start' || text.startsWith('/start ')) {
    try { await ctx.reply(`👋 Hello ${name}! Welcome to @avnifanbbot (Timed Video Drops) 🎬`); } catch (_) {}
    return await sendTimedMessage(ctx);
  }
  if (text === '/video' || text.startsWith('/video ')) return await sendTimedMessage(ctx);
  if (text === '/free' || text.startsWith('/free ')) return await executeFreeCommand(ctx);
  if (text === '/list') {
    const cfg = getConfig();
    const all = (cfg.bot2?.messages || []).filter((m) => m.status === 'active');
    if (all.length === 0) return await ctx.reply('📭 No active video drops available.');
    const keyboard = Markup.inlineKeyboard(
      all.map((m, idx) => [Markup.button.callback(`▶️ ${idx + 1}. ${m.title || 'Drop'}`, `view_drop_${m.id}`)])
    );
    return await ctx.reply('🎬 *Available Video Drops:*\nSelect a drop below to view:', { parse_mode: 'Markdown', ...keyboard });
  }
  if (text === '/timer') {
    const cfg = getConfig();
    const defTimer = cfg.bot2?.defaultTimer || { seconds: 60 };
    const timerSeconds = Number(defTimer.seconds) || 60;
    const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;
    return await ctx.reply(`⏱️ *Current Auto-Delete Timer:* ${timerText}\nAll delivered video drops will vanish after this duration.`);
  }
  if (text === '/help') {
    const cfg = getConfig();
    const help = cfg.bot2?.help || {};
    return await ctx.replyWithMarkdown(help.message || '🎬 Video Bot Help:\n• /start\n• /video\n• /list\n• /timer\n• /help');
  }
  if (text.startsWith('/')) {
    await ctx.reply('❓ Unknown command.\nAvailable commands are:\n• /start - Get video drop\n• /video - Get next video drop\n• /list - Browse drops\n• /timer - View timer\n• /help - Help & Info');
  } else {
    await ctx.reply(`🤖 Echo: "${text}"\n✅ @avnifanbbot is active! Delivering your video drop now...`);
    await sendTimedMessage(ctx);
  }
});

bot.catch((err) => {
  console.error('[Bot 2] Error:', err.message);
});

console.log('🤖 Starting Bot 2: @avnifanbbot standalone runner...');
bot.launch({ dropPendingUpdates: false }).catch((err) => {
  console.error('❌ Bot 2 failed to start:', err.message);
  process.exit(1);
});
console.log('✅ Bot 2 (@avnifanbbot) is live with long polling!');

bot.telegram.setMyCommands([
  { command: 'start', description: 'Receive timed video message (auto-deletes)' },
  { command: 'video', description: 'Get next video drop in rotation' },
  { command: 'list', description: 'View all active video drops' },
  { command: 'timer', description: 'View auto-delete timer' },
  { command: 'help', description: 'Bot information and commands' },
]).catch((err) => {
  console.warn('[Bot 2] Could not register commands:', err.message);
});

function shutdown(signal) {
  console.log(`\nStopping Bot 2 (${signal})...`);
  bot.stop(signal);
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
