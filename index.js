import { Telegraf, Markup } from 'telegraf';
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import {
  checkUserVipSubscription,
  sendContentLockedPaywall,
  setupSubscriptionBotHandlers,
  sendPlanQrAndInstructions,
  handlePaymentTextSubmission,
  handlePaymentPhotoSubmission,
  setupSubscriptionApiRoutes,
  getUserSavedContent,
  toggleUserSavedContent,
  isUserContentSaved,
  getExpiringSubscriptions,
  markReminderSent,
  getNewlyExpiredSubscriptions,
  markExpiredSent,
  formatDurationLabel,
  formatRemainingTime,
  planUnlocksBot4,
  getFinalBotConfig,
  escapeHtml
} from './subscriptions.js';
import { adminAuth, warnIfUnprotected } from './auth.js';
import crypto from 'crypto';
import { IS_TENANT, ROOT, botUsername, brandText, brandDeep, unbrandDeep, findUnsafePath } from './tenant.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(ROOT, 'config.json');

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
      execFileSync('sips', ['-Z', '2048', filePath], { stdio: 'ignore' });
    }
  } catch (_) {}
}

async function sendSafeTelegramMessage(ctx, { caption = '', text = '', mediaType = 'none', mediaPath = null, mediaUrl = null, extra = {} }) {
  const content = caption || text || '';
  const htmlContent = formatTelegramHtml(content);

  // 1. Photo from Local File
  if (mediaType === 'photo' && mediaPath && fs.existsSync(mediaPath)) {
    ensureTelegramImageSafe(mediaPath);
    try {
      return await ctx.replyWithPhoto({ source: mediaPath }, { caption: htmlContent, parse_mode: 'HTML', ...(extra || {}) });
    } catch (_) {
      try {
        return await ctx.replyWithPhoto({ source: mediaPath }, { caption: content, parse_mode: 'Markdown', ...(extra || {}) });
      } catch (_) {
        try {
          return await ctx.replyWithPhoto({ source: mediaPath }, { caption: content, ...(extra || {}) });
        } catch (_) {
          return await ctx.replyWithDocument({ source: mediaPath }, { caption: content, ...(extra || {}) });
        }
      }
    }
  }

  // 2. Photo from URL
  if (mediaType === 'photo' && mediaUrl && mediaUrl.trim() !== '') {
    try {
      return await ctx.replyWithPhoto(mediaUrl, { caption: htmlContent, parse_mode: 'HTML', ...(extra || {}) });
    } catch (_) {
      try {
        return await ctx.replyWithPhoto(mediaUrl, { caption: content, parse_mode: 'Markdown', ...(extra || {}) });
      } catch (_) {
        return await ctx.replyWithPhoto(mediaUrl, { caption: content, ...(extra || {}) });
      }
    }
  }

  // 3. Video from Local File
  if (mediaType === 'video' && mediaPath && fs.existsSync(mediaPath)) {
    try {
      return await ctx.replyWithVideo({ source: mediaPath }, { caption: htmlContent, parse_mode: 'HTML', ...(extra || {}) });
    } catch (_) {
      try {
        return await ctx.replyWithVideo({ source: mediaPath }, { caption: content, parse_mode: 'Markdown', ...(extra || {}) });
      } catch (_) {
        return await ctx.replyWithVideo({ source: mediaPath }, { caption: content, ...(extra || {}) });
      }
    }
  }

  // 4. Video from URL
  if (mediaType === 'video' && mediaUrl && mediaUrl.trim() !== '') {
    try {
      return await ctx.replyWithVideo(mediaUrl, { caption: htmlContent, parse_mode: 'HTML', ...(extra || {}) });
    } catch (_) {
      try {
        return await ctx.replyWithVideo(mediaUrl, { caption: content, parse_mode: 'Markdown', ...(extra || {}) });
      } catch (_) {
        return await ctx.replyWithVideo(mediaUrl, { caption: content, ...(extra || {}) });
      }
    }
  }

  // 5. Text Message
  try {
    return await ctx.reply(htmlContent, { parse_mode: 'HTML', ...(extra || {}) });
  } catch (_) {
    try {
      return await ctx.reply(content, { parse_mode: 'Markdown', ...(extra || {}) });
    } catch (_) {
      return await ctx.reply(content, extra || {});
    }
  }
}


// Default fallback configuration for all 3 bots
const DEFAULT_CONFIG = {
  bot1: {
    bot_name: 'Avni FanBase',
    welcome: {
      useImage: true,
      imagePath: 'assets/welcome.jpg',
      message: 'NICE TO MEET YOU {username}\n\nDID YOU JOIN??\n✧ The {bot_name} Alerts Channel And Send A Join Request To The Backup Channel??\nIf Not, Send It Now, As All Upcoming Fresh Content And Announcements Will Be Shared There\n≼Terms & Policy≽',
      buttons: [
        { id: 'btn_1', text: '📢 Alerts Channel', type: 'url', url: 'https://t.me/avniffanbasebot' },
        { id: 'btn_2', text: '🔒 Backup Channel', type: 'url', url: 'https://t.me/avniffanbasebot' },
        { id: 'btn_3', text: '≼ Terms & Policy ≽', type: 'terms', url: '' }
      ],
      bottomButtons: [
        { id: 'bbtn_today', text: "✨ Today's Content", type: 'today', fullWidth: true },
        { id: 'bbtn_1', text: 'Button 1', type: 'list', listId: 'list_btn1', fullWidth: false },
        { id: 'bbtn_2', text: 'Button 2', type: 'list', listId: 'list_btn2', fullWidth: false },
        { id: 'bbtn_3', text: 'Button 3', type: 'list', listId: 'list_btn3', fullWidth: false }
      ]
    },
    today: {
      deliveryMode: 'all_in_one',
      assignedBot: 'bot1',
      messages: [
        {
          id: 'today_msg_1',
          title: "Drop #1 - Today's Featured Release",
          status: 'active',
          viewButtonText: '👁️ View Content',
          preview: {
            message: "✨ *Today's Exclusive Drop*\n\nHey {username}! Here is today's fresh content drop. Tap below to unlock full access!",
            mediaType: 'none',
            mediaPath: '',
            mediaUrl: '',
            type: 'permanent',
            timer: {
              enabled: false,
              seconds: 60,
              preset: '1min',
              warningMessage: ''
            },
            buttons: []
          },
          revealedContent: {
            message: "🎬 *Today's Unlocked Content*\n\nEnjoy today's exclusive release, {username}!\nNew fresh content is posted daily. Check back tomorrow for the next drop!",
            mediaType: 'none',
            mediaPath: '',
            mediaUrl: '',
            type: 'permanent',
            timer: {
              enabled: false,
              seconds: 60,
              preset: '1min',
              warningMessage: ''
            },
            buttons: []
          },
          createdAt: new Date().toISOString()
        }
      ]
    },
    free: {
      deliveryMode: 'all_in_one',
      assignedBot: 'bot1',
      messages: [
        {
          id: 'free_msg_1',
          title: 'Drop #1 - Official Community Access',
          status: 'active',
          viewButtonText: '👁️ View Content',
          preview: {
            message: '🎁 *Free Drop #1 - Community Channels*\n\nWelcome {username}! Click below to view the exclusive free content and access links.',
            mediaType: 'none',
            mediaPath: '',
            mediaUrl: '',
            type: 'permanent',
            timer: {
              enabled: false,
              seconds: 60,
              preset: '1min',
              warningMessage: ''
            },
            buttons: []
          },
          revealedContent: {
            message: '🔥 *Unlocked Content #1*\n\nHere is your full unlocked access, {username}!\nMake sure to join our official backup channel for all fresh announcements.',
            mediaType: 'none',
            mediaPath: '',
            mediaUrl: '',
            type: 'permanent',
            timer: {
              enabled: false,
              seconds: 60,
              preset: '1min',
              warningMessage: ''
            },
            buttons: []
          },
          createdAt: new Date().toISOString()
        }
      ]
    },
    help: {
      message: '🤖 *Bot 1 (@avniffanbasebot) Help & Support*\n\nAvailable commands:\n• /start - Welcome greeting & community links\n• /free - Access free content & community drops\n• /terms - View Terms & Policy\n• /help - View this help guide\n\nNeed support? Check the announcements in our alert channel.'
    },
    terms: {
      title: 'Terms & Policy',
      windowMode: 'dialog',
      buttonText: '≼ Terms & Policy ≽',
      content: 'Welcome to our community.\n\n1. Community Guidelines:\nAll content shared is strictly for community members. Distribution, re-uploading, or piracy is strictly prohibited.\n\n2. Privacy:\nWe respect your privacy. No personal identifiable data beyond your basic Telegram interaction info is stored.\n\n3. Compliance:\nBy joining and accessing our channels, you confirm you meet the age and legal requirements of your local jurisdiction.\n\nFor queries or concerns, contact our bot administrator.',
      lastUpdated: new Date().toISOString().slice(0, 10)
    }
  },
  bot2: {
    bot_name: 'Avni Fanbase Demo',
    deliveryMode: 'rotate',
    defaultTimer: {
      enabled: true,
      seconds: 60,
      preset: '1min',
      warningMessage: '⏳ *Auto-Delete Warning*: This video will be deleted in {timer_text}!'
    },
    messages: [
      {
        id: 'msg_1',
        title: 'Drop #1 - Featured Video',
        status: 'active',
        type: 'temporary',
        videoPath: '',
        videoUrl: '',
        message: '🎬 Hello {username}!\n\nHere is your requested video message #1.\n\n⚠️ *ATTENTION*: This video message will self-destruct in {timer_text}! Please watch or save it before time runs out.',
        timer: {
          enabled: true,
          seconds: 60,
          preset: '1min',
          warningMessage: '⏳ *Auto-Delete Warning*: This video will be deleted in {timer_text}!'
        },
        buttons: [
          { id: 'b2_btn_1', text: '📢 Alerts & Updates Channel', type: 'url', url: 'https://t.me/avnifanbbot' }
        ],
        createdAt: new Date().toISOString()
      }
    ],
    help: {
      message: '🤖 *Bot 2 (@avnifanbbot) Help & Information*\n\nWelcome to @avnifanbbot!\nThis bot delivers special video messages with an automatic self-destruction timer.\n\n📌 *Available Commands:*\n• /start - Receive video message with auto-delete timer\n• /video - Fetch next video message\n• /list - View all active drops\n• /timer - Check current self-destruct timer\n• /help - Show this information\n\n⏱ *Default Timer:* {timer_text}'
    }
  },
  bot3: {
    bot_name: 'Avni FanBase Pay',
    welcome: {
      message: '💳 *Welcome to Avni FanBase Payment Gateway, {username}!* 👑\n\nChoose a VIP subscription plan below to unlock unrestricted drops, full-speed streaming, and our private Premium VIP Bot (@avnifanbaseprembot).\n\n👇 Select your plan to view the instant payment QR code:',
      buttons: [
        { id: 'b3_btn_1', text: '👑 Access Premium Bot (@avnifanbaseprembot)', type: 'url', url: 'https://t.me/avnifanbaseprembot' },
        { id: 'b3_btn_2', text: '💬 VIP Support', type: 'url', url: IS_TENANT ? 'https://t.me/' : 'https://t.me/+Gn_BIdByihZhZmI1' }
      ]
    },
    finalBot: {
      enabled: true,
      username: 'avnifanbaseprembot',
      url: 'https://t.me/avnifanbaseprembot?start=vip',
      buttonText: '👑 Access VIP Bot 4 (@avnifanbaseprembot)',
      message: '🎉 <b>Payment approved. Your VIP access is active!</b>\n\nPlan: <b>{plan_name}</b>\nUnlocks: <b>{content_title}</b>\nAdded: <b>{duration}</b>\nValid until: <b>{expiry_date}</b>\n\n👇 Tap below to launch your exclusive VIP Premium Bot:',
      shareBot1: true,
      bot1ButtonText: '🎬 Open Bot 1 (@avniffanbasebot)',
      bot1Url: 'https://t.me/avniffanbasebot'
    },
    help: {
      message: '🤖 *Payment Bot (@avnifanbasepaybot) Commands:*\n\n• /start - Welcome & Subscription Plans\n• /plans - Browse VIP Plans\n• /myplan - Check your active VIP status\n• /help - Payment & verification help'
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

    // Normalize bot1
    if (!data.bot1) data.bot1 = DEFAULT_CONFIG.bot1;
    if (!data.bot1.welcome) data.bot1.welcome = DEFAULT_CONFIG.bot1.welcome;
    if (!data.bot1.terms) data.bot1.terms = DEFAULT_CONFIG.bot1.terms;
    if (!data.bot1.help) data.bot1.help = DEFAULT_CONFIG.bot1.help;

    // Normalize bot1.welcome.bottomButtons
    if (!data.bot1.welcome.bottomButtons || !Array.isArray(data.bot1.welcome.bottomButtons)) {
      data.bot1.welcome.bottomButtons = [
        { id: 'bbtn_1', text: '🔥 Button 1', type: 'list', listId: 'list_btn1' },
        { id: 'bbtn_2', text: '⭐ Button 2', type: 'list', listId: 'list_btn2' },
        { id: 'bbtn_3', text: '💎 Button 3', type: 'list', listId: 'list_btn3' }
      ];
    }

    // Normalize bot1.messageLists
    if (!data.bot1.messageLists || !Array.isArray(data.bot1.messageLists)) {
      data.bot1.messageLists = [
        {
          id: 'list_free',
          title: '🎁 /free Community Drops',
          command: 'free',
          deliveryMode: data.bot1.free?.deliveryMode || 'all_in_one',
          targetBot: 'bot2',
          messages: data.bot1.free?.messages || []
        },
        {
          id: 'list_btn1',
          title: '🔥 Button 1 Drops',
          command: 'btn1',
          deliveryMode: 'all_in_one',
          targetBot: 'bot2',
          messages: []
        },
        {
          id: 'list_btn2',
          title: '⭐ Button 2 Drops',
          command: 'btn2',
          deliveryMode: 'all_in_one',
          targetBot: 'bot2',
          messages: []
        },
        {
          id: 'list_btn3',
          title: '💎 Button 3 Drops',
          command: 'btn3',
          deliveryMode: 'all_in_one',
          targetBot: 'bot2',
          messages: []
        }
      ];
    } else {
      // Ensure list_free is in messageLists and synced with bot1.free
      let freeList = data.bot1.messageLists.find(l => l.id === 'list_free');
      if (!freeList) {
        freeList = {
          id: 'list_free',
          title: '🎁 /free Community Drops',
          command: 'free',
          deliveryMode: data.bot1.free?.deliveryMode || 'all_in_one',
          targetBot: 'bot2',
          messages: data.bot1.free?.messages || []
        };
        data.bot1.messageLists.unshift(freeList);
      }
    }
    data.messageLists = data.bot1.messageLists;

    // Normalize bot1.today to support multiple messages, delivery modes & preview / revealedContent
    if (!data.bot1.today) {
      data.bot1.today = DEFAULT_CONFIG.bot1.today;
    } else {
      if (!data.bot1.today.deliveryMode) data.bot1.today.deliveryMode = 'all_in_one';
      if (!data.bot1.today.assignedBot) data.bot1.today.assignedBot = 'bot1';
      if (!Array.isArray(data.bot1.today.messages)) data.bot1.today.messages = [];
      data.bot1.today.messages = data.bot1.today.messages.map((m, idx) => {
        const isTemp = m.type === 'temporary' || m.timer?.enabled;
        const preview = m.preview || {
          message: m.message || "✨ Today's Content Drop",
          mediaType: m.mediaType || 'none',
          mediaPath: m.mediaPath || '',
          mediaUrl: m.mediaUrl || '',
          type: isTemp ? 'temporary' : 'permanent',
          timer: m.timer || { enabled: false, seconds: 60, preset: '1min', warningMessage: '' },
          buttons: m.previewButtons || []
        };
        const revealedContent = m.revealedContent || {
          message: m.revealedMessage || m.message || "🎬 Here is today's unlocked content!",
          mediaType: m.revealedMediaType || 'none',
          mediaPath: m.revealedMediaPath || '',
          mediaUrl: m.revealedMediaUrl || '',
          type: isTemp ? 'temporary' : 'permanent',
          timer: m.revealedTimer || m.timer || { enabled: false, seconds: 60, preset: '1min', warningMessage: '' },
          buttons: m.buttons || []
        };
        return {
          id: m.id || `today_msg_${idx + 1}`,
          title: m.title || `Drop #${idx + 1} - Today's Content`,
          status: m.status || 'active',
          viewButtonText: m.viewButtonText || '👁️ View Content',
          preview,
          revealedContent,
          createdAt: m.createdAt || new Date().toISOString()
        };
      });
    }
    data.today = data.bot1.today;

    // Normalize bot1.free to support multiple messages, delivery modes & preview / revealedContent
    if (!data.bot1.free) {
      data.bot1.free = DEFAULT_CONFIG.bot1.free;
    } else {
      if (!data.bot1.free.deliveryMode) data.bot1.free.deliveryMode = 'all_in_one';
      if (!data.bot1.free.assignedBot) data.bot1.free.assignedBot = 'bot1';
      if (!Array.isArray(data.bot1.free.messages)) data.bot1.free.messages = [];
      data.bot1.free.messages = data.bot1.free.messages.map((m, idx) => {
        const isTemp = m.type === 'temporary' || m.timer?.enabled;
        const preview = m.preview || {
          message: m.message || '🎁 Free Content Drop',
          mediaType: m.mediaType || (m.useImage ? 'photo' : 'none'),
          mediaPath: m.mediaPath || m.imagePath || '',
          mediaUrl: m.mediaUrl || '',
          type: isTemp ? 'temporary' : 'permanent',
          timer: m.timer || { enabled: false, seconds: 60, preset: '1min', warningMessage: '' },
          buttons: m.previewButtons || []
        };
        const revealedContent = m.revealedContent || {
          message: m.revealedMessage || m.message || '🔥 Here is your unlocked content!',
          mediaType: m.revealedMediaType || 'none',
          mediaPath: m.revealedMediaPath || '',
          mediaUrl: m.revealedMediaUrl || '',
          type: isTemp ? 'temporary' : 'permanent',
          timer: m.revealedTimer || m.timer || { enabled: false, seconds: 60, preset: '1min', warningMessage: '' },
          buttons: m.buttons || []
        };
        return {
          id: m.id || `free_msg_${idx + 1}`,
          title: m.title || `Drop #${idx + 1} - Free Content`,
          status: m.status || 'active',
          viewButtonText: m.viewButtonText || '👁️ View Content',
          preview,
          revealedContent,
          createdAt: m.createdAt || new Date().toISOString()
        };
      });
    }

    // Normalize bot2
    if (!data.bot2) data.bot2 = DEFAULT_CONFIG.bot2;
    if (!data.bot2.messages || !Array.isArray(data.bot2.messages) || data.bot2.messages.length === 0) {
      data.bot2.messages = DEFAULT_CONFIG.bot2.messages;
    }

    // Normalize bot3 & subscriptions.finalBot
    if (!data.bot3) data.bot3 = DEFAULT_CONFIG.bot3;
    if (!data.subscriptions) data.subscriptions = {};
    if (!data.bot3.finalBot && data.subscriptions.finalBot) data.bot3.finalBot = data.subscriptions.finalBot;
    if (!data.subscriptions.finalBot && data.bot3.finalBot) data.subscriptions.finalBot = data.bot3.finalBot;
    if (!data.subscriptions.finalBot) data.subscriptions.finalBot = DEFAULT_CONFIG.bot3.finalBot;
    if (!data.bot3.finalBot) data.bot3.finalBot = data.subscriptions.finalBot;

    return data;
  } catch (err) {
    console.error('Error reading config.json, falling back to defaults:', err);
    return DEFAULT_CONFIG;
  }
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
  // Synchronize finalBot between subscriptions and bot3
  if (data.subscriptions?.finalBot) {
    if (!data.bot3) data.bot3 = {};
    data.bot3.finalBot = data.subscriptions.finalBot;
  } else if (data.bot3?.finalBot) {
    if (!data.subscriptions) data.subscriptions = {};
    data.subscriptions.finalBot = data.bot3.finalBot;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ----------------------------------------------------
// 1. EXPRESS WEB SERVER & MULTI-BOT DASHBOARD
// ----------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3789;

// API CALL TRACKER & LOGGER
const MAX_LOGS = 100;
const apiCallLogs = [];
const apiHitCounts = {
  outbound: {},
  inbound: {}
};

function recordApiCall(entry) {
  apiCallLogs.unshift(entry);
  if (apiCallLogs.length > MAX_LOGS) apiCallLogs.pop();

  if (entry.direction === 'outbound') {
    const key = `${entry.bot || 'Bot'} -> ${entry.method}`;
    apiHitCounts.outbound[key] = (apiHitCounts.outbound[key] || 0) + 1;
  } else {
    const key = `${entry.method} ${entry.path.split('?')[0]}`;
    apiHitCounts.inbound[key] = (apiHitCounts.inbound[key] || 0) + 1;
  }
}

function attachTelegramApiLogger(botInstance, botLabel) {
  const originalCallApi = botInstance.telegram.callApi.bind(botInstance.telegram);
  botInstance.telegram.callApi = async function (method, data, options) {
    const start = Date.now();
    const timeStr = new Date().toLocaleTimeString();
    try {
      const result = await originalCallApi(method, data, options);
      const duration = Date.now() - start;
      console.log(`📡 [TG API OUTBOUND ${timeStr}] [${botLabel}] Method: ${method} | 200 OK (${duration}ms)`);
      recordApiCall({
        time: timeStr,
        direction: 'outbound',
        bot: botLabel,
        method,
        status: 200,
        duration: `${duration}ms`
      });
      return result;
    } catch (err) {
      // Auto-fallback to native fetch on ECONNRESET / network drop
      if (err.code === 'ECONNRESET' || (err.message && err.message.includes('ECONNRESET'))) {
        try {
          const token = botInstance.telegram.token;
          const url = `https://api.telegram.org/bot${token}/${method}`;
          const fetchRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {})
          });
          const json = await fetchRes.json();
          if (json && json.ok) {
            const duration = Date.now() - start;
            console.log(`📡 [TG API OUTBOUND ${timeStr}] [${botLabel}] Method: ${method} | 200 OK via fetch fallback (${duration}ms)`);
            recordApiCall({
              time: timeStr,
              direction: 'outbound',
              bot: botLabel,
              method,
              status: 200,
              duration: `${duration}ms`
            });
            return json.result;
          }
        } catch (_) {}
      }
      const duration = Date.now() - start;
      const status = err.response?.error_code || err.code || 429;
      console.error(`🚨 [TG API OUTBOUND ${timeStr}] [${botLabel}] Method: ${method} | Status: ${status} | Error: ${err.message} (${duration}ms)`);
      recordApiCall({
        time: timeStr,
        direction: 'outbound',
        bot: botLabel,
        method,
        status,
        error: err.message,
        duration: `${duration}ms`
      });
      throw err;
    }
  };
}

function getTelegramRetryAfterSeconds(err) {
  const retryAfter = Number(err.parameters?.retry_after);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;

  const messageRetryAfter = Number(err.message?.match(/retry after (\d+)/i)?.[1]);
  return Number.isFinite(messageRetryAfter) && messageRetryAfter > 0 ? messageRetryAfter : null;
}

async function callTelegramOnce(label, operation) {
  try {
    return await operation();
  } catch (err) {
    const retryAfter = getTelegramRetryAfterSeconds(err);
    if (err.response?.error_code === 429 || retryAfter) {
      const waitMessage = retryAfter ? `Telegram says wait ${retryAfter}s before trying again` : 'Telegram rate-limited the request';
      err.message = `${err.message} (${label}: ${waitMessage}; no automatic retry)`;
    }
    throw err;
  }
}

// Inbound Request Logger Middleware
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

// ====================================================
// BOT INSTANTIATION & LOGGER ATTACHMENT
// ====================================================
const token1 = (process.env.TELEGRAM_BOT_TOKEN_1 || '').trim();
const token2 = (process.env.TELEGRAM_BOT_TOKEN_2 || '').trim();
const token3 = (process.env.TELEGRAM_BOT_TOKEN_3 || '').trim();
const token4 = (process.env.TELEGRAM_BOT_TOKEN_4 || '').trim();

const bot1Enabled = !!token1 && process.env.BOT1_ENABLED?.toLowerCase() !== 'false';
const bot2Enabled = !!token2 && process.env.BOT2_ENABLED?.toLowerCase() !== 'false';
const bot3Enabled = !!token3 && process.env.BOT3_ENABLED?.toLowerCase() !== 'false';
const bot4Enabled = !!token4 && process.env.BOT4_ENABLED?.toLowerCase() !== 'false';

const telegrafOptions = process.env.TELEGRAM_API_ROOT
  ? { telegram: { apiRoot: process.env.TELEGRAM_API_ROOT } }
  : {};

// Bot 1: @avniffanbasebot
const bot1 = new Telegraf(token1, telegrafOptions);
attachTelegramApiLogger(bot1, 'Bot 1: Avniffanbasebot');
bot1.botInfo = {
  id: parseInt(token1.split(':')[0], 10),
  is_bot: true,
  first_name: 'Avni FanBaseTM',
  username: botUsername(1),
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

// Bot 2: @avnifanbbot
const bot2 = new Telegraf(token2, telegrafOptions);
attachTelegramApiLogger(bot2, 'Bot 2: avnifanbbot');
bot2.botInfo = {
  id: parseInt(token2.split(':')[0], 10),
  is_bot: true,
  first_name: 'Avni Fanbase Demo',
  username: botUsername(2),
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

// Bot 3: @avnifanbasepaybot (Payment Confirmation & VIP Checkout Bot)
const bot3 = new Telegraf(token3, telegrafOptions);
attachTelegramApiLogger(bot3, 'Bot 3: avnifanbasepaybot');
bot3.botInfo = {
  id: parseInt(token3.split(':')[0], 10),
  is_bot: true,
  first_name: 'Avni FanBase Pay',
  username: botUsername(3),
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

// Bot 4: @avnifanbaseprembot
const bot4 = new Telegraf(token4, telegrafOptions);
attachTelegramApiLogger(bot4, 'Bot 4: avnifanbaseprembot');
bot4.botInfo = {
  id: parseInt(token4.split(':')[0], 10),
  is_bot: true,
  first_name: 'Avni FanBase Premium',
  username: botUsername(4),
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

// Setup Subscription & QR Payment Bot Handlers
setupSubscriptionBotHandlers(bot1, 'Bot 1: Avniffanbasebot', getConfig, formatTelegramHtml);
setupSubscriptionBotHandlers(bot2, 'Bot 2: avnifanbbot', getConfig, formatTelegramHtml);
setupSubscriptionBotHandlers(bot3, 'Bot 3: avnifanbasepaybot', getConfig, formatTelegramHtml);
setupSubscriptionBotHandlers(bot4, 'Bot 4: avnifanbaseprembot', getConfig, formatTelegramHtml);

// ====================================================
// MOUNT WEBHOOK HANDLERS IMMEDIATELY (if configured)
// ====================================================
const webhookDomain = process.env.WEBHOOK_DOMAIN;
const webhookSecret = (token) => crypto.createHash('sha256').update(`webhook:${token}`).digest('hex');
const secretPath1 = `/webhook/bot1_${token1.split(':')[0]}`;
const secretPath2 = `/webhook/bot2_${token2.split(':')[0]}`;
const secretPath3 = `/webhook/bot3_${token3.split(':')[0]}`;
const secretPath4 = `/webhook/bot4_${token4.split(':')[0]}`;

if (webhookDomain && webhookDomain.trim() !== '') {
  if (bot1Enabled) app.use(bot1.webhookCallback(secretPath1, { secretToken: webhookSecret(token1) }));
  if (bot2Enabled) app.use(bot2.webhookCallback(secretPath2, { secretToken: webhookSecret(token2) }));
  if (bot3Enabled) app.use(bot3.webhookCallback(secretPath3, { secretToken: webhookSecret(token3) }));
  if (bot4Enabled) app.use(bot4.webhookCallback(secretPath4, { secretToken: webhookSecret(token4) }));
  console.log(`🌐 Webhook routes mounted on Express immediately:`);
  if (bot1Enabled) console.log(`   • Bot 1: ${secretPath1}`);
  if (bot2Enabled) console.log(`   • Bot 2: ${secretPath2}`);
  if (bot3Enabled) console.log(`   • Bot 3: ${secretPath3}`);
  if (bot4Enabled) console.log(`   • Bot 4: ${secretPath4}`);
}

app.use(adminAuth);
warnIfUnprotected();
app.use(express.json({ limit: '50mb' }));
if (IS_TENANT) {
  app.use((req, res, next) => {
    const field = findUnsafePath(req.body);
    if (field) return res.status(400).json({ error: `Invalid file path in "${field}"` });
    if (req.body) req.body = unbrandDeep(req.body);
    const json = res.json.bind(res);
    res.json = (body) => json(brandDeep(JSON.parse(JSON.stringify(body ?? null))));
    next();
  });
}
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(ROOT, 'assets')));

// Multer storage for image & video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(ROOT, 'assets');
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const prefix = file.fieldname === 'video' ? 'video' : file.fieldname === 'free_image' ? 'free' : (file.fieldname === 'today_media' || file.fieldname === 'today_image' ? 'today' : 'welcome');
    const rawExt = path.extname(file.originalname).toLowerCase();
    const ext = /^\.[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : '';
    cb(null, `${prefix}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// Admin Dashboard Routes
function sendDashboard(req, res) {
  const file = path.join(__dirname, 'public', 'admin.html');
  if (!IS_TENANT) return res.sendFile(file);
  const accountBar = '<div style="position:fixed;right:12px;bottom:76px;z-index:9999;display:flex;gap:8px;background:#0b1220;border:1px solid #334155;border-radius:10px;padding:8px 12px;font-size:13px;">'
    + '<a href="/account" style="color:#38bdf8;">Account &amp; bot keys</a>'
    + '<form method="post" action="/logout" style="margin:0;"><button style="background:none;border:0;color:#f87171;cursor:pointer;font-size:13px;padding:0;">Log out</button></form></div>';
  const html = brandText(fs.readFileSync(file, 'utf8')).replaceAll('avnifanbase@upi', '')
    // Placeholder instead of this install's private invite links
    .replace(/https:\/\/t\.me\/\+(TxsqlGdFOvk2MzNl|Gn_BIdByihZhZmI1)/g, 'https://t.me/');
  res.type('html').send(html.replace(/<\/body>(?![\s\S]*<\/body>)/, () => `${accountBar}</body>`));
}

app.get('/', sendDashboard);
app.get('/admin', sendDashboard);

// Terms & Policy Web Page
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// Dedicated API: Terms & Policy endpoint
app.get('/api/terms', (req, res) => {
  const config = getConfig();
  const terms = config.bot1?.terms || DEFAULT_CONFIG.bot1.terms;
  res.json({
    title: terms.title || 'Terms & Policy',
    content: terms.content || '',
    windowMode: terms.windowMode || 'dialog',
    buttonText: terms.buttonText || '≼ Terms & Policy ≽',
    lastUpdated: terms.lastUpdated || new Date().toISOString().slice(0, 10)
  });
});

// API: Explicit Webhook Registration endpoint
app.post('/api/register-webhook', async (req, res) => {
  const webhookDomain = process.env.WEBHOOK_DOMAIN;
  if (!webhookDomain || webhookDomain.trim() === '') {
    return res.status(400).json({ error: 'WEBHOOK_DOMAIN is not configured in .env' });
  }

  const cleanDomain = webhookDomain.replace(/\/+$/, '');
  const results = {};

  if (bot1Enabled) {
    try {
      await callTelegramOnce('Manual Bot 1 setWebhook', () =>
        bot1.telegram.setWebhook(`${cleanDomain}${secretPath1}`, { secret_token: webhookSecret(token1) })
      );
      results.bot1 = { success: true, url: `${cleanDomain}${secretPath1}` };
    } catch (err) {
      results.bot1 = { success: false, error: err.message };
    }
  }

  if (bot2Enabled) {
    try {
      await callTelegramOnce('Manual Bot 2 setWebhook', () =>
        bot2.telegram.setWebhook(`${cleanDomain}${secretPath2}`, { secret_token: webhookSecret(token2) })
      );
      results.bot2 = { success: true, url: `${cleanDomain}${secretPath2}` };
    } catch (err) {
      results.bot2 = { success: false, error: err.message };
    }
  }

  if (bot3Enabled) {
    try {
      await callTelegramOnce('Manual Bot 3 setWebhook', () =>
        bot3.telegram.setWebhook(`${cleanDomain}${secretPath3}`, { secret_token: webhookSecret(token3) })
      );
      results.bot3 = { success: true, url: `${cleanDomain}${secretPath3}` };
    } catch (err) {
      results.bot3 = { success: false, error: err.message };
    }
  }

  if (bot4Enabled) {
    try {
      await callTelegramOnce('Manual Bot 4 setWebhook', () =>
        bot4.telegram.setWebhook(`${cleanDomain}${secretPath4}`, { secret_token: webhookSecret(token4) })
      );
      results.bot4 = { success: true, url: `${cleanDomain}${secretPath4}` };
    } catch (err) {
      results.bot4 = { success: false, error: err.message };
    }
  }

  res.json(results);
});

// Setup Subscription & Payments Management REST APIs
setupSubscriptionApiRoutes(app, upload);

// API: Get current config
app.get('/api/config', (req, res) => {
  res.json(getConfig());
});

// API: Live API Call Tracker & Traffic Stats
app.get('/api/logs', (req, res) => {
  res.json({
    counts: apiHitCounts,
    recent: apiCallLogs.slice(0, 50)
  });
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

// API: Upload custom image
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath });
});

// API: Upload custom video for Bot 2
app.post('/api/upload-video', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath, originalName: req.file.originalname });
});

// API: Upload custom image for Bot 1 Free Message
app.post('/api/upload-free-image', upload.single('free_image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath, originalName: req.file.originalname });
});

// API: Upload custom media (image or video) for Free Drops Preview / Revealed Content
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

// API: Message Lists Management
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
  if (!id) return res.status(400).json({ error: 'List ID is required' });

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

// API: Bot 2 User Limits Management
app.post('/api/bot2/reset-limits', (req, res) => {
  bot2UserAccessCounts.clear();
  console.log('🔄 All Bot 2 user limit counters have been reset to 0.');
  res.json({ success: true, message: 'All user limit counters reset' });
});

app.get('/api/bot2/limit-stats', (req, res) => {
  const config = getConfig();
  res.json({
    userLimit: config.bot2?.userLimit || { enabled: false, maxDrops: 3 },
    trackedUsers: bot2UserAccessCounts.size
  });
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

// ====================================================
// BOT 4 (PREMIUM) REST API ROUTES
// ====================================================

// API: Get Bot 4 config
app.get('/api/bot4/config', (req, res) => {
  const cfg = getConfig();
  res.json(cfg.bot4 || {});
});

// API: Save Bot 4 config
app.post('/api/bot4/config', (req, res) => {
  try {
    const cfg = getConfig();
    if (!cfg.bot4) cfg.bot4 = {};
    const { bot_name, welcome, expiryReminder, dropBatchLimit, nonSubscriberGate } = req.body;
    if (bot_name !== undefined) cfg.bot4.bot_name = bot_name;
    if (welcome !== undefined) cfg.bot4.welcome = { ...(cfg.bot4.welcome || {}), ...welcome };
    if (expiryReminder !== undefined) cfg.bot4.expiryReminder = { ...(cfg.bot4.expiryReminder || {}), ...expiryReminder };
    if (dropBatchLimit !== undefined) cfg.bot4.dropBatchLimit = Math.max(1, parseInt(dropBatchLimit, 10) || 5);
    if (nonSubscriberGate !== undefined) cfg.bot4.nonSubscriberGate = { ...(cfg.bot4.nonSubscriberGate || {}), ...nonSubscriberGate };
    saveConfig(cfg);
    res.json({ success: true, bot4: cfg.bot4 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save Bot 4 sticky bottom buttons
app.post('/api/bot4/save-bottom-buttons', (req, res) => {
  const { bottomButtons } = req.body;
  if (!Array.isArray(bottomButtons)) return res.status(400).json({ error: 'bottomButtons must be an array' });
  const cfg = getConfig();
  if (!cfg.bot4) cfg.bot4 = {};
  if (!cfg.bot4.welcome) cfg.bot4.welcome = {};
  cfg.bot4.welcome.bottomButtons = bottomButtons;
  saveConfig(cfg);
  res.json({ success: true, bottomButtons });
});

// API: Upload Bot 4 Media (Images, Videos)
app.post('/api/upload-bot4-media', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media file provided' });
  const relativePath = path.posix.join('assets', req.file.filename);
  res.json({ success: true, path: relativePath });
});

// API: Get Bot 4 Drops
app.get('/api/bot4/drops', (req, res) => {
  const cfg = getConfig();
  res.json(cfg.bot4?.messages || []);
});

// API: Save / Update Bot 4 Drop
app.post('/api/bot4/drops', (req, res) => {
  try {
    const cfg = getConfig();
    if (!cfg.bot4) cfg.bot4 = {};
    if (!Array.isArray(cfg.bot4.messages)) cfg.bot4.messages = [];
    const dropData = req.body;
    if (!dropData.id) dropData.id = 'prem_drop_' + Date.now();
    const idx = cfg.bot4.messages.findIndex((m) => m.id === dropData.id);
    if (idx >= 0) {
      cfg.bot4.messages[idx] = { ...cfg.bot4.messages[idx], ...dropData };
    } else {
      cfg.bot4.messages.unshift(dropData);
    }
    saveConfig(cfg);
    res.json({ success: true, drop: dropData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Toggle Bot 4 Drop Status
app.post('/api/bot4/toggle-drop-status', (req, res) => {
  const { id } = req.body;
  const cfg = getConfig();
  if (!cfg.bot4?.messages) return res.status(404).json({ error: 'No messages found' });
  const msg = cfg.bot4.messages.find((m) => m.id === id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  msg.status = msg.status === 'inactive' ? 'active' : 'inactive';
  saveConfig(cfg);
  res.json({ success: true, status: msg.status });
});

// API: Duplicate Bot 4 Drop
app.post('/api/bot4/duplicate-drop', (req, res) => {
  const { id } = req.body;
  const cfg = getConfig();
  if (!cfg.bot4?.messages) return res.status(404).json({ error: 'No messages found' });
  const msg = cfg.bot4.messages.find((m) => m.id === id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const clone = JSON.parse(JSON.stringify(msg));
  clone.id = 'prem_drop_' + Date.now();
  clone.title = `${clone.title} (Copy)`;
  clone.createdAt = new Date().toISOString();
  cfg.bot4.messages.unshift(clone);
  saveConfig(cfg);
  res.json({ success: true, drop: clone });
});

// API: Delete Bot 4 Drop
app.post('/api/bot4/delete-drop', (req, res) => {
  const { id } = req.body;
  const cfg = getConfig();
  if (!cfg.bot4?.messages) return res.status(404).json({ error: 'No messages found' });
  const initialLen = cfg.bot4.messages.length;
  cfg.bot4.messages = cfg.bot4.messages.filter((m) => m.id !== id);
  if (cfg.bot4.messages.length === initialLen) return res.status(404).json({ error: 'Message not found' });
  saveConfig(cfg);
  res.json({ success: true });
});

// API: Bot status endpoint
let botStatus = {
  bot1: { connected: false, username: 'avniffanbasebot', disabled: !bot1Enabled },
  bot2: { connected: false, username: 'avnifanbbot', disabled: !bot2Enabled },
  bot3: { connected: false, username: 'avnifanbasepaybot', disabled: !bot3Enabled },
  bot4: { connected: false, username: 'avnifanbaseprembot', disabled: !bot4Enabled },
};

app.get('/api/status', (req, res) => {
  res.json(botStatus);
});

const server = app.listen(PORT, process.env.HOST || undefined, () => {
  console.log(`🌐 Multi-Bot Configuration Dashboard running at http://localhost:${PORT}`);
  console.log(`📜 Terms & Policy page viewable at http://localhost:${PORT}/terms`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ ERROR: Port ${PORT} is already in use by another process!`);
    console.error(`   Stop the existing server process using port ${PORT}, then start this app once.\n`);
    process.exitCode = 1;
  } else {
    console.error('Server error:', err.message);
    process.exitCode = 1;
  }
});

// ----------------------------------------------------
// 2. HELPER UTILITIES
// ----------------------------------------------------
function createTermsButton(text, windowMode) {
  const domain = (process.env.WEBHOOK_DOMAIN || '').replace(/\/+$/, '');
  const termsUrl = process.env.TERMS_URL || (domain && `${domain}/terms`);
  if (windowMode === 'webapp' && termsUrl) {
    return Markup.button.webApp(text, termsUrl);
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

  // 1. Regular/Top Buttons
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

  // 2. Configurable Bottom Buttons (Button 1, Button 2, Button 3, and more)
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
            // Default: opens linked Message List
            rows.push([Markup.button.callback(b.text, `open_list_${b.listId || 'list_btn1'}`)]);
          }
        });
    }
  }

  // 3. User requirement: Terms and Policy is ALWAYS intact at the end of the first message
  if (forceTerms && !hasTerms) {
    rows.push([createTermsButton(termsButtonText, windowMode)]);
  }

  if (extraRow && Array.isArray(extraRow) && extraRow.length > 0) {
    rows.push(extraRow);
  }

  return rows.length > 0 ? Markup.inlineKeyboard(rows) : null;
}

// ----------------------------------------------------
// 3. BOT 1: @Avniffanbasebot (Community & Welcome Bot)
// ----------------------------------------------------
function formatBot1Message(template, ctx) {
  const config = getConfig();
  const botName = config.bot1?.bot_name || 'Avni FanBase';
  const username = ctx.from?.username
    ? `@${ctx.from.username}`
    : ctx.from?.first_name || 'Friend';

  return template
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName);
}

// Welcome Message: Terms & Policy is ALWAYS intact at the end of the message

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

async function sendBot1Welcome(ctx) {
  try {
    const config = getConfig();
    const welcome = config.bot1?.welcome || {};

    if (welcome.enabled === false) {
      try {
        const stickyKb = buildStickyReplyKeyboard();
        await ctx.reply('👇 Tap a button below for instant content drops:', stickyKb);
      } catch (_) {}
      return;
    }

    const isTemporary = welcome.type === 'temporary' || welcome.timer?.enabled;
    const timerSeconds = Number(welcome.timer?.seconds) || 120;
    const timerText = formatFreeTimerText(timerSeconds);

    let caption = formatBot1Message(
      welcome.message ||
        'NICE TO MEET YOU {username}\n\nDID YOU JOIN??\n✧ The {bot_name} Alerts Channel And Send A Join Request To The Backup Channel??',
      ctx
    ).replace(/{timer_text}/g, timerText);

    if (isTemporary && welcome.timer?.warningMessage && !caption.includes(welcome.timer.warningMessage)) {
      const warning = welcome.timer.warningMessage.replace(/{timer_text}/g, timerText);
      caption = `${caption}\n\n${warning}`;
    }

    // Guarantee Terms keyword is in message body text as well
    if (!caption.includes('Terms & Policy') && !caption.includes('terms') && !caption.includes('Terms')) {
      caption = `${caption}\n\n≼Terms & Policy≽`;
    }

    // forceTerms: true guarantees Terms & Policy button is ALWAYS intact as the final row of inline buttons
    const keyboard = buildInlineKeyboard(welcome.buttons, null, true, false);

    const imagePath = welcome.imagePath
      ? path.join(ROOT, welcome.imagePath)
      : path.join(ROOT, 'assets', 'welcome.jpg');
    const useImage = welcome.useImage && fs.existsSync(imagePath);

    let sentMessage = await sendSafeTelegramMessage(ctx, {
      caption,
      mediaType: useImage ? 'photo' : 'none',
      mediaPath: useImage ? imagePath : null,
      extra: keyboard ? keyboard : {}
    });

    // Always dock the sticky bottom reply keyboard permanently
    try {
      const stickyKb = buildStickyReplyKeyboard();
      await ctx.reply('👇 Tap a button below for instant content drops:', stickyKb);
    } catch (_) {}

    // Auto-Delete Timer if configured as Temporary!
    if (isTemporary && timerSeconds > 0 && sentMessage) {
      const chatId = sentMessage.chat.id;
      const messageId = sentMessage.message_id;
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, messageId);
          console.log(`🗑️ [Bot 1] Auto-deleted temporary welcome message (${messageId}) after ${timerSeconds}s.`);
        } catch (delErr) {
          console.warn(`[Bot 1] Could not delete welcome message ${messageId}:`, delErr.message);
        }
      }, timerSeconds * 1000);
    }
  } catch (outerErr) {
    console.error('[Bot 1] Fatal error in sendBot1Welcome:', outerErr.message);
  }
}

// ----------------------------------------------------
// MESSAGE LISTS & CROSS-BOT DEEP LINKING ENGINE (Bot 1 -> Bot 2)
// ----------------------------------------------------
const listUserCursors = new Map();

function getTargetBotUsername(targetBotKey = 'bot2') {
  const map = {
    bot1: 'avniffanbasebot',
    bot2: 'avnifanbbot',
    bot3: 'avnifanbasepaybot',
    bot4: 'avnifanbaseprembot'
  };
  return map[targetBotKey] || 'avnifanbbot';
}

async function sendSingleListPreview(ctx, msg, list, username, botName, showNextBtn = false) {
  const preview = msg.preview || {};
  const timerConfig = preview.timer || { enabled: false, seconds: 60 };
  const isTemporary = preview.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatFreeTimerText(timerSeconds);

  let caption = (preview.message || msg.message || '✨ *Exclusive Content Drop*')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    const warning = timerConfig.warningMessage.replace(/{timer_text}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  // Mandatory Cross-Bot Deep Linking:
  // "View Content" redirects to Target Bot (Default: Bot 2 @avnifanbbot) with payload = msg.id
  const viewButtonText = msg.viewButtonText || '👁️ View Content';
  const targetUsername = getTargetBotUsername(list.targetBot || 'bot2');
  const deepLinkUrl = `https://t.me/${targetUsername}?start=${msg.id}`;

  const rows = [
    [Markup.button.url(viewButtonText, deepLinkUrl)]
  ];

  // If in Mode 2 (sequential) and there are multiple active drops, add Next Drop button
  if (showNextBtn) {
    rows.push([Markup.button.callback('▶️ Next Drop', `next_list_drop_${list.id}`)]);
  }

  // Any custom buttons configured for this preview
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
  const mediaPath = preview.mediaPath ? path.join(ROOT, preview.mediaPath) : null;
  const mediaType = preview.mediaType || 'none';

  sentMessage = await sendSafeTelegramMessage(ctx, {
    caption,
    mediaType,
    mediaPath,
    mediaUrl: preview.mediaUrl,
    extra: inlineKeyboard
  });

  // Auto-Destruct Timer for Preview
  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ Auto-deleted temporary preview (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`Could not delete preview ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

// Send ONLY ONE clean membership banner after drops (never on every single drop message)
async function sendSingleMembershipBanner(ctx, title = 'VIP Membership') {
  const config = getConfig();
  const subCfg = config.subscriptions || {};
  if (subCfg.enabled === false) return;

  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const accessCheck = checkUserVipSubscription(userId, 'all');
  if (accessCheck.active) return; // User already holds active VIP pass

  const curr = subCfg.currency || '₹';
  const plans = subCfg.plans || [];
  const minPrice = plans.length > 0 ? Math.min(...plans.map((p) => Number(p.price) || 999)) : 11;
  const priceTag = minPrice < 999 ? ` (from ${curr}${minPrice})` : '';

  const text = `👑 *Want unlimited content with zero limits?*\n\nUpgrade to our **VIP Membership** to unlock unrestricted streaming, full drop libraries, and direct access to our exclusive **Premium Bot** without auto-delete!`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url(`💎 View VIP Membership Plans${priceTag}`, 'https://t.me/avnifanbasepaybot?start=plans')]
  ]);

  try {
    await ctx.reply(formatTelegramHtml(text), { parse_mode: 'HTML', ...keyboard });
  } catch (_) {
    try {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (_) {}
  }
}

async function executeMessageList(ctx, listId, botKey = 'bot1') {
  const config = getConfig();

  // Check if this list / bottom button requires a paid subscription pass!
  const matchingBtn = (config.bot1?.welcome?.bottomButtons || []).find(
    (b) => b.listId === listId || b.id === listId
  );
  const accessType = matchingBtn?.accessType || 'free';
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const contentType = matchingBtn?.contentType || matchingBtn?.id || listId;
  const accessCheck = checkUserVipSubscription(userId, contentType);

  // 1. COMPLETELY LOCKED MODE: non-subscribed users get ONLY the paywall message upfront (0 drops)
  if ((accessType === 'locked' || accessType === 'paid') && !accessCheck.active) {
    return await sendContentLockedPaywall(ctx, matchingBtn || { text: 'Exclusive Content' }, contentType, getConfig, formatTelegramHtml);
  }

  const lists = config.bot1?.messageLists || config.messageLists || [];
  let list = lists.find((l) => l.id === listId);

  // Fallback for list_free
  if (!list && listId === 'list_free') {
    list = {
      id: 'list_free',
      title: 'Free Content Drops',
      deliveryMode: config.bot1?.free?.deliveryMode || 'all_in_one',
      targetBot: 'bot2',
      messages: config.bot1?.free?.messages || []
    };
  }

  if (!list) {
    return ctx.reply('📭 This message list is currently not available.');
  }

  const allMessages = list.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  if (activeMessages.length === 0) {
    return ctx.reply(`📭 There are currently no active drops in "${list.title || 'this category'}". Please check back soon!`);
  }

  const deliveryMode = list.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config[botKey]?.bot_name || 'Bot';

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

  // Show ONLY ONE membership message for this drop session (never on every single drop message):
  if ((accessType === 'drops_then_paywall' || accessType === 'teaser') && !accessCheck.active) {
    await sendContentLockedPaywall(ctx, matchingBtn || { text: list.title }, contentType, getConfig, formatTelegramHtml);
  } else if (!accessCheck.active) {
    await sendSingleMembershipBanner(ctx, list.title);
  }
}

async function handleNextListDropAction(ctx, listId, botKey = 'bot1') {
  try { await ctx.answerCbQuery('Fetching next drop...'); } catch (_) {}
  const config = getConfig();
  const lists = config.bot1?.messageLists || config.messageLists || [];
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
  const botName = config[botKey]?.bot_name || 'Bot';
  const showNextBtn = activeMessages.length > 1;
  await sendSingleListPreview(ctx, chosen, list, username, botName, showNextBtn);
}

// ----------------------------------------------------
// BOT 2 USER LIMIT TRACKING (Normal vs Limited) & COUNTER
// ----------------------------------------------------
const bot2UserAccessCounts = new Map(); // userId -> accessCount

function checkAndIncrementBot2UserLimit(ctx, message) {
  const config = getConfig();
  const limitCfg = config.bot2?.userLimit || { enabled: false, maxDrops: 3 };

  // If tracking is disabled, allow
  if (!limitCfg.enabled) return { allowed: true };

  // Normal messages are UNLIMITED and do not count against quota!
  const accessType = message.accessType || 'limited';
  if (accessType === 'normal') {
    return { allowed: true, isNormal: true };
  }

  // Limited message: check user limit
  const userId = ctx.from?.id ? String(ctx.from.id) : 'default';

  // 👑 VIP Subscription check: Active VIP subscribers bypass all daily limits!
  const vip = checkUserVipSubscription(userId);
  if (vip.active) {
    console.log(`👑 [Bot 2] User ${userId} is an Active VIP (${vip.planName}). Limit bypassed!`);
    return { allowed: true, isVip: true, vip };
  }

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
  const config = getConfig();
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config.bot2?.bot_name || 'Avni Fanbase Demo';
  const maxDrops = Number(limitCfg.maxDrops) || 3;

  let text = (limitCfg.limitReachedMessage || '🚫 *Daily Access Limit Reached!*\n\nHey {username}, you have unlocked all {limit} allowed content drops for today!\n\nUpgrade to VIP Access to unlock unlimited drops with zero limits.')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{limit}/g, maxDrops)
    .replace(/{max_drops}/g, maxDrops);

  const rows = [];
  rows.push([Markup.button.url('💎 Upgrade to VIP (Unlimited Drops)', 'https://t.me/avnifanbasepaybot?start=plans')]);
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
  await sendSafeTelegramMessage(ctx, {
    text,
    extra: inlineKeyboard ? inlineKeyboard : {}
  });
}

// Function executed on Bot 2 to deliver unlocked content from any Message List, Free, or Today
async function deliverRevealedDropOnBot2(ctx, dropId) {
  const config = getConfig();
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config.bot2?.bot_name || 'Avni Fanbase Demo';

  let foundDrop = null;
  const lists = config.bot1?.messageLists || config.messageLists || [];
  for (const l of lists) {
    const d = (l.messages || []).find((m) => m.id === dropId);
    if (d) { foundDrop = d; break; }
  }

  if (!foundDrop && config.bot1?.free?.messages) {
    foundDrop = config.bot1.free.messages.find((m) => m.id === dropId);
  }
  if (!foundDrop && config.bot1?.today?.messages) {
    foundDrop = config.bot1.today.messages.find((m) => m.id === dropId);
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

  if (!foundDrop && (dropId === 'free' || dropId === 'list_free') && config.bot1?.free?.messages) {
    const active = config.bot1.free.messages.filter((m) => m.status !== 'archived');
    if (active.length > 0) {
      foundDrop = active.length > 2 ? active[Math.floor(Math.random() * active.length)] : active[0];
    }
  }
  if (!foundDrop && (dropId === 'today' || dropId === 'list_today') && config.bot1?.today?.messages) {
    const active = config.bot1.today.messages.filter((m) => m.status !== 'archived');
    if (active.length > 0) {
      foundDrop = active.length > 2 ? active[Math.floor(Math.random() * active.length)] : active[0];
    }
  }

  if (!foundDrop) return null;

  if (foundDrop.status === 'archived') {
    await ctx.reply('🔒 This exclusive content drop has been archived and is no longer available.');
    return true;
  }

  // Check Bot 2 User Limit for limited drops
  const limitCheck = checkAndIncrementBot2UserLimit(ctx, foundDrop);
  if (!limitCheck.allowed) {
    await sendBot2LimitExceededMessage(ctx, limitCheck.limitCfg);
    return true;
  }

  const revealed = foundDrop.revealedContent || {};
  const timerConfig = revealed.timer || { enabled: false, seconds: 60 };
  const isTemporary = revealed.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = formatFreeTimerText(timerSeconds);

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
  const mediaPath = revealed.mediaPath ? path.join(ROOT, revealed.mediaPath) : null;
  const mediaType = revealed.mediaType || 'none';

  sentMessage = await sendSafeTelegramMessage(ctx, {
    caption,
    mediaType,
    mediaPath,
    mediaUrl: revealed.mediaUrl,
    extra: inlineKeyboard ? inlineKeyboard : {}
  });

  // Auto-Destruct Timer on Bot 2!
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

// ----------------------------------------------------
// MULTI-BOT /today ENGINE & HIDDEN REVEALED CONTENT
// ----------------------------------------------------
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

  // Row 1: Unique View Content button that reveals the hidden content for this drop
  const viewButtonText = msg.viewButtonText || '👁️ View Content';
  const rows = [
    [Markup.button.callback(viewButtonText, `reveal_today_${msg.id}`)]
  ];

  // If in Mode 2 (sequential) and there are multiple active drops, add Next Today Drop button
  if (showNextBtn) {
    rows.push([Markup.button.callback("▶️ Next Today's Drop", 'next_today_drop')]);
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
  const mediaPath = preview.mediaPath ? path.join(ROOT, preview.mediaPath) : null;
  const mediaType = preview.mediaType || 'none';

  sentMessage = await sendSafeTelegramMessage(ctx, {
    caption,
    mediaType,
    mediaPath,
    mediaUrl: preview.mediaUrl,
    extra: inlineKeyboard
  });

  // Auto-Destruct Timer for Preview
  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ Auto-deleted temporary today preview (${messageId}) in chat ${chatId} after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`Could not delete today preview ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

async function executeTodayCommand(ctx, botKey = 'bot1') {
  const config = getConfig();

  // Check access mode: 'free', 'drops_then_paywall', or 'locked' / 'paid'
  const todayBtn = (config.bot1?.welcome?.bottomButtons || []).find(
    (b) => b.type === 'today' || b.id === 'bbtn_today'
  );
  const accessType = todayBtn?.accessType || 'free';
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const contentType = todayBtn?.contentType || 'today';
  const accessCheck = checkUserVipSubscription(userId, contentType);

  // 1. COMPLETELY LOCKED MODE: non-subscribed users get ONLY the paywall message upfront (0 drops)
  if ((accessType === 'locked' || accessType === 'paid') && !accessCheck.active) {
    return await sendContentLockedPaywall(ctx, todayBtn || { text: "✨ Today's Content" }, contentType, getConfig, formatTelegramHtml);
  }

  const todayConfig = config.bot1?.today || config.today || {};
  const assigned = todayConfig.assignedBot || 'bot1';

  // Portability: If /today is assigned to a specific bot and not this bot, direct user
  if (assigned !== 'all' && assigned !== botKey) {
    const botUsernames = {
      bot1: '@avniffanbasebot',
      bot2: '@avnifanbbot',
      bot3: '@avnifanbasepaybot',
      bot4: '@avnifanbaseprembot'
    };
    const target = botUsernames[assigned] || 'our main bot';
    return ctx.reply(`✨ Today's content drops are currently hosted on ${target}! Please head over there and send /today.`);
  }

  const allMessages = todayConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  if (activeMessages.length === 0) {
    return ctx.reply("📭 There are currently no active drops for today. Please check back later!");
  }

  const deliveryMode = todayConfig.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config[botKey]?.bot_name || 'Bot';

  if (deliveryMode === 'all_in_one') {
    // Mode 1: Send all active messages in one go, each with its unique View Content button
    for (const msg of activeMessages) {
      await sendSingleTodayPreview(ctx, msg, username, botName, false);
    }
  } else {
    // Mode 2: Sequential (send one by one, cycles on "Next Today's Drop")
    const userId = ctx.from?.id || 'default';
    const lastCursor = todayUserCursors.get(userId) ?? -1;
    const nextCursor = (lastCursor + 1) % activeMessages.length;
    todayUserCursors.set(userId, nextCursor);
    const chosen = activeMessages[nextCursor];
    const showNextBtn = activeMessages.length > 1;
    await sendSingleTodayPreview(ctx, chosen, username, botName, showNextBtn);
  }

  // Show ONLY ONE membership message for this drop session (never on every single drop message):
  if ((accessType === 'drops_then_paywall' || accessType === 'teaser') && !accessCheck.active) {
    await sendContentLockedPaywall(ctx, todayBtn || { text: "✨ Today's Content" }, contentType, getConfig, formatTelegramHtml);
  } else if (!accessCheck.active) {
    await sendSingleMembershipBanner(ctx, "✨ Today's Content");
  }
}

async function handleRevealTodayAction(ctx, matchId) {
  try {
    await ctx.answerCbQuery("🔓 Unlocking today's content...");
  } catch (_) {}

  const config = getConfig();
  const todayConfig = config.bot1?.today || config.today || {};
  const allMessages = todayConfig.messages || [];
  const msg = allMessages.find((m) => m.id === matchId);

  if (!msg) {
    return ctx.reply('❌ This content drop was not found.');
  }
  if (msg.status === 'archived') {
    return ctx.reply('🔒 This content drop has been archived.');
  }

  const revealed = msg.revealedContent || {};
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config.bot1?.bot_name || 'Avni FanBase';

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

  // Build unique custom buttons attached to this revealed content
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
  const mediaPath = revealed.mediaPath ? path.join(ROOT, revealed.mediaPath) : null;
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

  // Auto-Destruct Timer for Revealed Content
  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ Auto-deleted revealed today content (${messageId}) in chat ${chatId} after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`Could not delete revealed today content ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

async function handleNextTodayDropAction(ctx, botKey = 'bot1') {
  try {
    await ctx.answerCbQuery("Fetching next drop for today...");
  } catch (_) {}

  const config = getConfig();
  const todayConfig = config.bot1?.today || config.today || {};
  const allMessages = todayConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  if (activeMessages.length === 0) {
    return ctx.reply('📭 No active drops available for today.');
  }

  const userId = ctx.from?.id || 'default';
  const lastCursor = todayUserCursors.get(userId) ?? 0;
  const nextCursor = (lastCursor + 1) % activeMessages.length;
  todayUserCursors.set(userId, nextCursor);
  const chosen = activeMessages[nextCursor];
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config[botKey]?.bot_name || 'Bot';
  const showNextBtn = activeMessages.length > 1;
  await sendSingleTodayPreview(ctx, chosen, username, botName, showNextBtn);
}

// ----------------------------------------------------
// MULTI-BOT /free ENGINE & HIDDEN REVEALED CONTENT
// ----------------------------------------------------
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
  const mediaPath = preview.mediaPath ? path.join(ROOT, preview.mediaPath) : null;
  const mediaType = preview.mediaType || 'none';

  sentMessage = await sendSafeTelegramMessage(ctx, {
    caption,
    mediaType,
    mediaPath,
    mediaUrl: preview.mediaUrl,
    extra: inlineKeyboard
  });

  // Auto-Destruct Timer for Preview
  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ Auto-deleted temporary free preview (${messageId}) in chat ${chatId} after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`Could not delete free preview ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

async function executeFreeCommand(ctx, botKey = 'bot1') {
  return await executeMessageList(ctx, 'list_free', botKey);
  const config = getConfig();
  const freeConfig = config.bot1?.free || config.free || {};
  const assigned = freeConfig.assignedBot || 'bot1';

  // Portability: If /free is assigned to a specific bot and not this bot, direct user
  if (assigned !== 'all' && assigned !== botKey) {
    const botUsernames = {
      bot1: '@avniffanbasebot',
      bot2: '@avnifanbbot',
      bot3: '@avnifanbasepaybot',
      bot4: '@avnifanbaseprembot'
    };
    const target = botUsernames[assigned] || 'our main bot';
    return ctx.reply(`🎁 Free content drops are currently hosted on ${target}! Please head over there and send /free.`);
  }

  const allMessages = freeConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  if (activeMessages.length === 0) {
    return ctx.reply('📭 There are currently no active free content drops. Please check back later!');
  }

  const deliveryMode = freeConfig.deliveryMode || 'all_in_one';
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config[botKey]?.bot_name || 'Bot';

  if (deliveryMode === 'all_in_one') {
    // Mode 1: Send all active messages in one go, each with its unique View Content button
    for (const msg of activeMessages) {
      await sendSingleFreePreview(ctx, msg, username, botName, false);
    }
  } else {
    // Mode 2: Sequential (send one by one, cycles on "Next Free Content")
    const userId = ctx.from?.id || 'default';
    const lastCursor = freeUserCursors.get(userId) ?? -1;
    const nextCursor = (lastCursor + 1) % activeMessages.length;
    freeUserCursors.set(userId, nextCursor);
    const chosen = activeMessages[nextCursor];
    const showNextBtn = activeMessages.length > 1;
    await sendSingleFreePreview(ctx, chosen, username, botName, showNextBtn);
  }

  // Show ONLY ONE membership message for this free drop session:
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const accessCheck = checkUserVipSubscription(userId, 'free');
  if (!accessCheck.active) {
    await sendSingleMembershipBanner(ctx, 'Free Content Drops');
  }
}

async function handleRevealFreeAction(ctx, matchId) {
  try {
    await ctx.answerCbQuery('🔓 Unlocking content...');
  } catch (_) {}

  const config = getConfig();
  const freeConfig = config.bot1?.free || config.free || {};
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
  const botName = config.bot1?.bot_name || 'Avni FanBase';

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

  // Build unique custom buttons attached to this revealed content
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
  const mediaPath = revealed.mediaPath ? path.join(ROOT, revealed.mediaPath) : null;
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

  // Auto-Destruct Timer for Revealed Content
  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;
    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(`🗑️ Auto-deleted revealed content (${messageId}) after ${timerSeconds}s.`);
      } catch (delErr) {
        console.warn(`Could not delete revealed message ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }

  return sentMessage;
}

async function handleNextFreeDropAction(ctx, botKey = 'bot1') {
  try {
    await ctx.answerCbQuery('Fetching next free drop...');
  } catch (_) {}
  const config = getConfig();
  const freeConfig = config.bot1?.free || config.free || {};
  const allMessages = freeConfig.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');
  if (activeMessages.length === 0) {
    return ctx.reply('📭 There are currently no active free content drops.');
  }
  const userId = ctx.from?.id || 'default';
  const lastCursor = freeUserCursors.get(userId) ?? -1;
  const nextCursor = (lastCursor + 1) % activeMessages.length;
  freeUserCursors.set(userId, nextCursor);
  const chosen = activeMessages[nextCursor];
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const botName = config[botKey]?.bot_name || 'Bot';
  const showNextBtn = activeMessages.length > 1;
  await sendSingleFreePreview(ctx, chosen, username, botName, showNextBtn);
}

// Bot 1 Commands
bot1.start(async (ctx) => {
  await sendBot1Welcome(ctx);
});

bot1.command('today', async (ctx) => {
  await executeTodayCommand(ctx, 'bot1');
});

bot1.command('todayscontent', async (ctx) => {
  await executeTodayCommand(ctx, 'bot1');
});

bot1.command('todays_content', async (ctx) => {
  await executeTodayCommand(ctx, 'bot1');
});

bot1.action('view_today', async (ctx) => {
  try { await ctx.answerCbQuery("Opening Today's Content..."); } catch (_) {}
  await executeTodayCommand(ctx, 'bot1');
});

bot1.action('view_free', async (ctx) => {
  try { await ctx.answerCbQuery("Opening Free Content..."); } catch (_) {}
  await executeFreeCommand(ctx, 'bot1');
});

// Dynamic Message List Actions
bot1.action(/^open_list_(.+)$/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  await executeMessageList(ctx, ctx.match[1], 'bot1');
});

bot1.action(/^next_list_drop_(.+)$/, async (ctx) => {
  await handleNextListDropAction(ctx, ctx.match[1], 'bot1');
});

bot1.command('btn1', async (ctx) => {
  await executeMessageList(ctx, 'list_btn1', 'bot1');
});
bot1.command('btn2', async (ctx) => {
  await executeMessageList(ctx, 'list_btn2', 'bot1');
});
bot1.command('btn3', async (ctx) => {
  await executeMessageList(ctx, 'list_btn3', 'bot1');
});

bot1.action(/^reveal_today_(.+)$/, async (ctx) => {
  await handleRevealTodayAction(ctx, ctx.match[1]);
});

bot1.action('next_today_drop', async (ctx) => {
  await handleNextTodayDropAction(ctx, 'bot1');
});

bot1.command('free', async (ctx) => {
  await executeFreeCommand(ctx, 'bot1');
});

bot1.action(/^reveal_free_(.+)$/, async (ctx) => {
  await handleRevealFreeAction(ctx, ctx.match[1]);
});

bot1.action('next_free_drop', async (ctx) => {
  await handleNextFreeDropAction(ctx, 'bot1');
});

// Terms Command & Action (Cleaned: No "Back to Main" button)
bot1.command('terms', async (ctx) => {
  const config = getConfig();
  const terms = config.bot1?.terms || {};
  const text = `📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`;
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (_) {
    await ctx.reply(terms.content || 'Terms & Policy');
  }
});

bot1.command('help', async (ctx) => {
  const config = getConfig();
  const help = config.bot1?.help || {};
  const text = help.message || '🤖 *Bot 1 Help & Support*\n\nAvailable commands:\n• /start - Welcome message\n• /free - Access free content\n• /terms - View Terms & Policy\n• /help - View this guide';
  try {
    await ctx.replyWithMarkdown(text);
  } catch (err) {
    await ctx.reply(text);
  }
});

// Terms Action: Native Dialog Popup Modal (Guaranteed <= 200 chars so it ALWAYS pops up as modal dialog)
async function handleTermsAction(ctx) {
  const config = getConfig();
  const terms = config.bot1?.terms || {};
  const windowMode = terms.windowMode || 'dialog';
  const title = terms.title || 'Terms & Policy';
  const content = terms.content || 'Welcome to our community.\n\nAll content shared is strictly for community members.';

  if (windowMode === 'dialog') {
    let alertText = (terms.dialogText || '').trim();
    if (!alertText) {
      alertText = `📜 ${title}\n\n${content}`.trim();
    }
    // Telegram answerCbQuery strictly requires text <= 200 characters!
    if (alertText.length > 200) {
      alertText = alertText.slice(0, 196) + '...';
    }
    try {
      await ctx.answerCbQuery(alertText, { show_alert: true });
    } catch (err) {
      console.warn('Warning answering terms callback query:', err.message);
      try {
        await ctx.answerCbQuery(`📜 ${title}\n\nAll content is for community members. Distribution/piracy is prohibited. Details: /terms`, { show_alert: true });
      } catch (_) {
        await ctx.answerCbQuery();
      }
    }
  } else {
    try { await ctx.answerCbQuery(); } catch (_) {}
    try {
      await ctx.reply(`📜 *${title}*\n\n${content}`);
    } catch (err) {
      await ctx.reply(content);
    }
  }
}

bot1.action('view_terms', handleTermsAction);
bot2.action('view_terms', handleTermsAction);
bot3.action('view_terms', handleTermsAction);

bot1.on('new_chat_members', async (ctx) => {
  await sendBot1Welcome(ctx);
});

bot1.on('photo', async (ctx) => {
  const handled = await handlePaymentPhotoSubmission(ctx, getConfig, formatTelegramHtml);
  if (handled) return;
});

bot1.on('text', async (ctx) => {
  const handled = await handlePaymentTextSubmission(ctx, getConfig, formatTelegramHtml);
  if (handled) return;

  const text = (ctx.message.text || '').trim();
  if (text === '/start' || text.startsWith('/start ')) {
    return await sendBot1Welcome(ctx);
  }

  // Handle Sticky Bottom Keyboard Buttons (Today's Content, Button 1, Button 2, Button 3, and custom buttons)
  const config = getConfig();
  const bottomButtons = config.bot1?.welcome?.bottomButtons || [];
  const matchedBtn = bottomButtons.find(
    (b) => b.text && b.text.trim().toLowerCase() === text.toLowerCase()
  );
  if (matchedBtn) {
    if (matchedBtn.type === 'today' || matchedBtn.text.toLowerCase().includes('today')) {
      return await executeTodayCommand(ctx, 'bot1');
    }
    if (matchedBtn.type === 'free' || matchedBtn.text.toLowerCase().includes('free')) {
      return await executeFreeCommand(ctx, 'bot1');
    }
    if (matchedBtn.type === 'url' && matchedBtn.url) {
      let u = matchedBtn.url.trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
      return await ctx.reply(`🔗 Tap below to visit:`, Markup.inlineKeyboard([
        [Markup.button.url(matchedBtn.text || 'Open Link', u)]
      ]));
    }
    if (matchedBtn.type === 'terms') {
      const terms = config.bot1?.terms || {};
      return await ctx.reply(`📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`);
    }
    const listId = matchedBtn.listId || 'list_btn1';
    return await executeMessageList(ctx, listId, 'bot1');
  }

  if (
    text.toLowerCase() === "✨ today's content".toLowerCase() ||
    text.toLowerCase() === "today's content".toLowerCase() ||
    text.toLowerCase() === "todays content".toLowerCase() ||
    text === '/today' ||
    text.startsWith('/today ') ||
    text === '/todayscontent' ||
    text.startsWith('/todayscontent ') ||
    text === '/todays_content'
  ) {
    return await executeTodayCommand(ctx, 'bot1');
  }

  if (text.toLowerCase() === 'button 1' || text === '/btn1') {
    return await executeMessageList(ctx, 'list_btn1', 'bot1');
  }
  if (text.toLowerCase() === 'button 2' || text === '/btn2') {
    return await executeMessageList(ctx, 'list_btn2', 'bot1');
  }
  if (text.toLowerCase() === 'button 3' || text === '/btn3') {
    return await executeMessageList(ctx, 'list_btn3', 'bot1');
  }
  if (text === '/today' || text.startsWith('/today ') || text === '/todayscontent' || text.startsWith('/todayscontent ') || text === '/todays_content') {
    return await executeTodayCommand(ctx, 'bot1');
  }
  if (text === '/free' || text.startsWith('/free ')) {
    return await executeFreeCommand(ctx, 'bot1');
  }
  if (text === '/terms') {
    const config = getConfig();
    const terms = config.bot1?.terms || {};
    return await ctx.reply(`📜 *${terms.title || 'Terms & Policy'}*\n\n${terms.content || ''}`);
  }
  if (text === '/help') {
    const config = getConfig();
    const help = config.bot1?.help || {};
    return await ctx.replyWithMarkdown(help.message || '🤖 Bot Help:\n• /start\n• /free\n• /terms\n• /help');
  }
  if (text.startsWith('/')) {
    await ctx.reply('❓ Unknown command.\nAvailable commands are:\n• /start - Welcome greeting\n• /free - Free content links\n• /terms - Community guidelines\n• /help - Bot support');
  } else {
    const name = ctx.from?.first_name || 'Friend';
    await ctx.reply(`👋 Hello ${name}! Type /start or /free to explore our community!`);
  }
});

// ----------------------------------------------------
// 4. BOT 2: @avnifanbbot (Timed Video & Multi-Message Bot)
// ----------------------------------------------------
const userCursors = new Map();

async function sendBot2TimedMessage(ctx, targetMsgId = null) {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
  const allMessages = bot2Config.messages || [];
  const activeMessages = allMessages.filter((m) => m.status === 'active');

  let chosen = null;

  if (targetMsgId) {
    chosen = allMessages.find((m) => m.id === targetMsgId);
    if (!chosen) {
      return ctx.reply('❌ This video drop was not found.');
    }
    if (chosen.status === 'archived') {
      return ctx.reply('🔒 This video drop has been archived and is no longer available.');
    }
  } else {
    if (activeMessages.length === 0) {
      return ctx.reply('📭 There are currently no active video drops. Please check back later or join our alerts channel!');
    }

    const userId = ctx.from?.id || 'default';
    const deliveryMode = bot2Config.deliveryMode || 'rotate';

    // If delivery mode is random or list is large (> 2), use randomized selection
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

  const username = ctx.from?.username
    ? `@${ctx.from.username}`
    : ctx.from?.first_name || 'Friend';
  const botName = bot2Config.bot_name || 'Avni Fanbase Demo';

  const timerConfig = chosen.timer || bot2Config.defaultTimer || { enabled: true, seconds: 60 };
  const isTemporary = chosen.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;

  let caption = (chosen.message || '🎬 Exclusive Video Drop!\n\n⚠️ Self-destructs in {timer_text}!')
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName)
    .replace(/{timer_text}/g, timerText)
    .replace(/{timer}/g, timerText);

  if (isTemporary && timerConfig.warningMessage && !caption.includes(timerConfig.warningMessage)) {
    const warning = timerConfig.warningMessage
      .replace(/{timer_text}/g, timerText)
      .replace(/{timer}/g, timerText);
    caption = `${caption}\n\n${warning}`;
  }

  let extraRow = null;
  if (activeMessages.length > 1) {
    extraRow = [Markup.button.callback('▶️ Next Video Drop', 'next_drop')];
  }
  const keyboard = buildInlineKeyboard(chosen.buttons, extraRow);

  const videoPath = chosen.videoPath ? path.join(ROOT, chosen.videoPath) : null;
  const isVideo = Boolean((videoPath && fs.existsSync(videoPath)) || (chosen.videoUrl && chosen.videoUrl.trim() !== ''));

  let sentMessage = await sendSafeTelegramMessage(ctx, {
    caption,
    mediaType: isVideo ? 'video' : 'none',
    mediaPath: videoPath,
    mediaUrl: chosen.videoUrl ? chosen.videoUrl.trim() : null,
    extra: keyboard ? keyboard : {}
  });

  // 4. Auto-Delete Timer for Temporary Messages
  if (isTemporary && timerSeconds > 0 && sentMessage) {
    const chatId = sentMessage.chat.id;
    const messageId = sentMessage.message_id;

    setTimeout(async () => {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        console.log(
          `🗑️ [Bot 2] Auto-deleted "${chosen.title || 'video'}" (msgId: ${messageId}) in chat ${chatId} after ${timerSeconds}s.`
        );
      } catch (delErr) {
        console.warn(`[Bot 2] Could not delete message ${messageId}:`, delErr.message);
      }
    }, timerSeconds * 1000);
  }
}

// Bot 2 Commands (CONFIGURABLE WELCOME GREETING)
bot2.start(async (ctx) => {
  const name = ctx.from?.first_name || 'there';
  const username = ctx.from?.username ? `@${ctx.from.username}` : name;
  const config = getConfig();
  const botName = config.bot2?.bot_name || 'Avni Fanbase Drops';
  const payload = ctx.startPayload;
  const b2Welcome = config.bot2?.welcome || {};

  // Configurable Welcome Greeting on Bot 2:
  if (b2Welcome.enabled !== false) {
    const isTemporary = b2Welcome.type === 'temporary' || b2Welcome.timer?.enabled;
    const timerSeconds = Number(b2Welcome.timer?.seconds) || 120;
    const timerText = formatFreeTimerText(timerSeconds);

    let caption = (b2Welcome.message || '👋 *Welcome to {bot_name}, {username}!* 🎬\n\nAll exclusive content drops and unlocked releases from our main bot are delivered here below.')
      .replace(/{username}/g, username)
      .replace(/{bot_name}/g, botName)
      .replace(/{timer_text}/g, timerText);

    if (isTemporary && b2Welcome.timer?.warningMessage && !caption.includes(b2Welcome.timer.warningMessage)) {
      const warning = b2Welcome.timer.warningMessage.replace(/{timer_text}/g, timerText);
      caption = `${caption}\n\n${warning}`;
    }

    const rows = [];
    if (b2Welcome.buttons && Array.isArray(b2Welcome.buttons)) {
      b2Welcome.buttons
        .filter((b) => b.text && b.text.trim() !== '')
        .forEach((b) => {
          let url = (b.url || '').trim();
          if (!url || url === 'https://t.me/' || url === 'https://t.me') url = 'https://t.me/avniffanbasebot';
          if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
          rows.push([Markup.button.url(b.text, url)]);
        });
    }
    const inlineKeyboard = rows.length > 0 ? Markup.inlineKeyboard(rows) : undefined;
    const mediaPath = b2Welcome.mediaPath ? path.join(ROOT, b2Welcome.mediaPath) : null;
    const mediaType = b2Welcome.mediaType || 'none';

    let sentWelMsg = await sendSafeTelegramMessage(ctx, {
      caption,
      mediaType,
      mediaPath,
      mediaUrl: b2Welcome.mediaUrl,
      extra: inlineKeyboard ? inlineKeyboard : {}
    });

    if (isTemporary && timerSeconds > 0 && sentWelMsg) {
      const chatId = sentWelMsg.chat.id;
      const messageId = sentWelMsg.message_id;
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(chatId, messageId);
          console.log(`🗑️ [Bot 2] Auto-deleted temporary welcome greeting (${messageId}) after ${timerSeconds}s.`);
        } catch (delErr) {
          console.warn(`[Bot 2] Could not delete welcome greeting ${messageId}:`, delErr.message);
        }
      }, timerSeconds * 1000);
    }
  }

  if (payload && payload.trim() !== '') {
    // 1. Check if this is a cross-bot revealed content request (from Bot 1 /free or Button 1)
    const delivered = await deliverRevealedDropOnBot2(ctx, payload.trim());
    if (delivered) return;

    // 2. Native Bot 2 timed drop
    await sendBot2TimedMessage(ctx, payload.trim());
  } else {
    await sendBot2TimedMessage(ctx);
  }
});

bot2.command('video', async (ctx) => {
  await sendBot2TimedMessage(ctx);
});

bot2.command('list', async (ctx) => {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
  const activeMessages = (bot2Config.messages || []).filter((m) => m.status === 'active');

  if (activeMessages.length === 0) {
    return ctx.reply('📭 There are currently no active video drops.');
  }

  let text = `🎬 *Active Video Drops (${activeMessages.length})*\n\nSelect a drop below to view:\n`;
  const buttons = activeMessages.map((m, idx) => {
    const tSec = m.timer?.seconds || 60;
    const isTemp = m.type === 'temporary' || m.timer?.enabled;
    const tText = isTemp ? (tSec >= 60 ? `${Math.round(tSec / 60)}m` : `${tSec}s`) : 'Permanent';
    return [Markup.button.callback(`▶️ ${idx + 1}. ${m.title || 'Drop'} (${tText})`, `view_drop_${m.id}`)];
  });

  await ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
});

bot2.command('timer', async (ctx) => {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
  const defTimer = bot2Config.defaultTimer || { seconds: 60 };
  const timerSeconds = Number(defTimer.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;
  await ctx.reply(`⏱️ *Default Auto-Delete Timer:* ${timerText}\nTemporary video drops will vanish after this duration.`);
});

bot2.command('today', async (ctx) => {
  await executeTodayCommand(ctx, 'bot2');
});

bot2.action('view_today', async (ctx) => {
  try { await ctx.answerCbQuery("Opening Today's Content..."); } catch (_) {}
  await executeTodayCommand(ctx, 'bot2');
});

bot2.action(/^reveal_today_(.+)$/, async (ctx) => {
  await handleRevealTodayAction(ctx, ctx.match[1]);
});

bot2.action('next_today_drop', async (ctx) => {
  await handleNextTodayDropAction(ctx, 'bot2');
});

bot2.command('free', async (ctx) => {
  await executeFreeCommand(ctx, 'bot2');
});

bot2.action(/^reveal_free_(.+)$/, async (ctx) => {
  await handleRevealFreeAction(ctx, ctx.match[1]);
});

bot2.action('next_free_drop', async (ctx) => {
  await handleNextFreeDropAction(ctx, 'bot2');
});

bot2.command('help', async (ctx) => {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
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
  } catch (err) {
    await ctx.reply(text);
  }
});

bot2.action('next_drop', async (ctx) => {
  try { await ctx.answerCbQuery('Fetching next drop...'); } catch (_) {}
  await sendBot2TimedMessage(ctx);
});

bot2.action(/view_drop_(.+)/, async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  const targetId = ctx.match[1];
  await sendBot2TimedMessage(ctx, targetId);
});

bot2.on('video', async (ctx) => {
  const config = getConfig();
  const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
  const defTimer = bot2Config.defaultTimer || { enabled: true, seconds: 60 };
  const timerSeconds = Number(defTimer.seconds) || 60;
  const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;

  const videoFileId = ctx.message.video.file_id;
  const userCaption = ctx.message.caption ? `${ctx.message.caption}\n\n` : '';
  const caption = `${userCaption}⏳ *Self-Destruct Active*: This video will be automatically deleted in ${timerText}.`;

  try {
    const sent = await ctx.replyWithVideo(videoFileId, {
      caption,
      parse_mode: 'Markdown'
    });

    if (defTimer.enabled && timerSeconds > 0) {
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

bot2.on('photo', async (ctx) => {
  const handled = await handlePaymentPhotoSubmission(ctx, getConfig, formatTelegramHtml);
  if (handled) return;
});

bot2.on('text', async (ctx) => {
  const handled = await handlePaymentTextSubmission(ctx, getConfig, formatTelegramHtml);
  if (handled) return;

  const text = (ctx.message.text || '').trim();
  const name = ctx.from?.first_name || 'there';

  if (text === '/start' || text.startsWith('/start ')) {
    try {
      await ctx.reply(`👋 Hello ${name}! Welcome to @avnifanbbot (Timed Video Drops) 🎬`);
    } catch (_) {}
    return await sendBot2TimedMessage(ctx);
  }
  if (text === '/video' || text.startsWith('/video ')) {
    return await sendBot2TimedMessage(ctx);
  }
  if (text === '/today' || text.startsWith('/today ') || text === '/todayscontent' || text.startsWith('/todayscontent ') || text === '/todays_content') {
    return await executeTodayCommand(ctx, 'bot2');
  }
  if (text === '/free' || text.startsWith('/free ')) {
    return await executeFreeCommand(ctx, 'bot2');
  }
  if (text === '/list') {
    const config = getConfig();
    const all = config.bot2?.messages || [];
    const active = all.filter((m) => m.status === 'active');
    if (active.length === 0) {
      return await ctx.reply('📭 No active video drops available right now. Check back soon!');
    }
    const keyboard = Markup.inlineKeyboard(
      active.map((m, idx) => [Markup.button.callback(`▶️ ${idx + 1}. ${m.title || 'Video Drop'}`, `view_drop_${m.id}`)])
    );
    return await ctx.reply('🎬 *Available Video Drops:*\nSelect a drop below to view:', {
      parse_mode: 'Markdown',
      ...keyboard
    });
  }
  if (text === '/timer') {
    const config = getConfig();
    const bot2Config = config.bot2 || DEFAULT_CONFIG.bot2;
    const defTimer = bot2Config.defaultTimer || { seconds: 60 };
    const timerSeconds = Number(defTimer.seconds) || 60;
    const timerText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;
    return await ctx.reply(`⏱️ *Current Auto-Delete Timer:* ${timerText}\nTemporary video drops will vanish after this duration.`);
  }
  if (text === '/help') {
    const config = getConfig();
    const help = config.bot2?.help || {};
    return await ctx.replyWithMarkdown(help.message || '🎬 *Video Bot Help*\n\nAvailable commands:\n• /start - Get timed video\n• /video - Get next video drop\n• /list - Browse active drops\n• /timer - View timer\n• /help - Help');
  }
  if (text.startsWith('/')) {
    await ctx.reply(
      '❓ Unknown command.\nAvailable commands are:\n• /start - Get video drop\n• /video - Get next video drop\n• /list - Browse active drops\n• /timer - View timer\n• /help - Help & Information'
    );
  } else {
    await ctx.reply(`🤖 Echo: "${text}"\n✅ @avnifanbbot is active! Delivering your video drop now...`);
    await sendBot2TimedMessage(ctx);
  }
});

// ----------------------------------------------------
// 5. BOT 3: @avnifanbasepaybot (Payment Confirmation & VIP Checkout Bot)
// ----------------------------------------------------
bot3.start(async (ctx) => {
  const payload = (ctx.startPayload || '').trim();

  // If payload points directly to a plan (e.g. /start plan_6h, /start plan_1w, /start plan_1m):
  if (payload.startsWith('plan_')) {
    return await sendPlanQrAndInstructions(ctx, payload, getConfig, formatTelegramHtml);
  }

  // Otherwise, display the welcome & plan selection menu
  const config = getConfig();
  const subCfg = config.subscriptions || {};
  const fb = getFinalBotConfig(config);
  const finalBotHandle = fb.username ? (fb.username.startsWith('@') ? fb.username : `@${fb.username}`) : 'our exclusive VIP Bot';
  const plans = subCfg.plans || [];
  const curr = subCfg.currency || '₹';
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');

  let text = `💳 *Welcome to Avni FanBase Payment Gateway, ${username}!* 👑\n\n`;
  text += `Upgrade to our **VIP Pass** to get unlimited drops, zero daily limits, and access to our exclusive **Premium Bot (${finalBotHandle})**.\n\n`;
  text += `💎 *Available VIP Subscription Plans:*\n\n`;

  plans.forEach((p, idx) => {
    const dur = formatDurationLabel(p.durationHours);
    const badge = p.badge ? ` [${p.badge}]` : '';
    text += `*${idx + 1}. ${p.name}*${badge}\n`;
    text += `• Price: *${curr}${p.price}*\n`;
    text += `• Duration: *${dur}*\n`;
    if (p.description) text += `• ${p.description}\n`;
    text += `\n`;
  });

  text += `👇 Tap a plan below to view your instant UPI QR code & pay:`;

  const buttons = plans.map((p) => {
    const dur = formatDurationLabel(p.durationHours);
    return [Markup.button.callback(`${p.name} — ${curr}${p.price} (${dur})`, `buy_plan_${p.id}`)];
  });
  buttons.push([Markup.button.callback('🔍 Check My Subscription Status', 'check_my_plan')]);

  const keyboard = Markup.inlineKeyboard(buttons);
  try {
    await ctx.reply(formatTelegramHtml(text), { parse_mode: 'HTML', ...keyboard });
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  }
});

bot3.command('help', async (ctx) => {
  const config = getConfig();
  const fb = getFinalBotConfig(config);
  const finalBotHandle = fb.username ? (fb.username.startsWith('@') ? fb.username : `@${fb.username}`) : 'VIP Premium Bot';
  const text = `🤖 *Payment Bot (@avnifanbasepaybot) Help & Guide*

Available Commands:
• /start - Welcome & Subscription Plans
• /plans - Select a VIP plan & view QR Code
• /myplan - Check your active VIP subscription status
• /help - Support and payment instructions

📋 *How to Subscribe:*
1. Type /plans and tap your preferred plan.
2. Scan the dynamic UPI QR Code using Google Pay, PhonePe, Paytm, or BHIM.
3. Pay the exact amount.
4. Reply directly in this chat with your **12-digit UPI UTR number** or **upload your payment screenshot**.
5. Once verified, you will immediately receive your **VIP access link (${finalBotHandle})** right here!`;

  await ctx.reply(formatTelegramHtml(text), { parse_mode: 'HTML' });
});

bot3.on('photo', async (ctx) => {
  const handled = await handlePaymentPhotoSubmission(ctx, getConfig, formatTelegramHtml);
  if (!handled) {
    await ctx.reply('📸 Payment screenshot received! Please ensure you have selected a plan first via /plans.');
  }
});

bot3.on('text', async (ctx) => {
  const text = (ctx.message?.text || '').trim();
  if (text.startsWith('/')) return; // handled by Telegraf command handlers

  const handled = await handlePaymentTextSubmission(ctx, getConfig, formatTelegramHtml);
  if (!handled) {
    const isUtr = /^\d{10,14}$/.test(text.replace(/\s+/g, ''));
    if (isUtr) {
      const config = getConfig();
      const plans = config.subscriptions?.plans || [];
      const buttons = plans.map((p) => [
        Markup.button.callback(`Apply UTR to: ${p.name} (${config.subscriptions?.currency || '₹'}${p.price})`, `submit_utr_${p.id}`)
      ]);
      return await ctx.reply(
        `🔍 *UTR Number Detected:* \`${text}\`\n\nWhich subscription plan did you pay for? Please tap below to confirm:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
    }

    await ctx.reply(
      `👋 Hello! Need to activate your VIP pass?\n\n• Type /plans to browse plans and get your payment QR code.\n• Type /myplan to check your subscription status.\n• Type /help for assistance.`
    );
  }
});

// ====================================================
// BOT 4: @avnifanbaseprembot (PREMIUM VIP BOT) ENGINE
// ====================================================

function buildBot4StickyKeyboard(config = getConfig()) {
  const bottomButtons = config.bot4?.welcome?.bottomButtons || [
    { text: '🔥 Premium Drops', type: 'drops', fullWidth: true },
    { text: '⭐ Saved Contents', type: 'saved', fullWidth: false },
    { text: '💎 My Subscription', type: 'myplan', fullWidth: false },
    { text: '👑 Renew / Extend Pass', type: 'renew', fullWidth: false },
    { text: '❓ Support & Help', type: 'help', fullWidth: false }
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
      if (currentRow.length >= 2) {
        rows.push(currentRow);
        currentRow = [];
      }
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    rows.push(['🔥 Premium Drops']);
    rows.push(['⭐ Saved Contents', '💎 My Subscription']);
    rows.push(['👑 Renew / Extend Pass', '❓ Support & Help']);
  }

  return Markup.keyboard(rows).resize().persistent();
}

// Check if user has active VIP access for Bot 4 (All-Access or Bot 4 specific pass)
function isBot4Subscriber(ctx) {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const allAccessCheck = checkUserVipSubscription(userId, 'all');
  if (allAccessCheck.active) return allAccessCheck;
  const b4Check = checkUserVipSubscription(userId, 'b4_drops');
  if (b4Check.active) return b4Check;
  const customCheck = checkUserVipSubscription(userId, 'b4_bbtn_drops');
  if (customCheck.active) return customCheck;
  return { active: false };
}

// Buttons built from the configured plans that really unlock Bot 4
function bot4PlanOffer(cfg) {
  const curr = cfg.subscriptions?.currency || '₹';
  const plans = (cfg.subscriptions?.plans || []).filter(planUnlocksBot4);
  const lines = plans.map(
    (p) => `• <b>${escapeHtml(p.name)}</b> — ${escapeHtml(curr)}${escapeHtml(p.price)} (${formatDurationLabel(p.durationHours)})`
  );
  const rows = plans.map((p) => [
    Markup.button.url(`${p.name} — ${curr}${p.price}`, `https://t.me/avnifanbasepaybot?start=${p.id}`)
  ]);
  rows.push([Markup.button.url('💳 Open Payment Bot (@avnifanbasepaybot)', 'https://t.me/avnifanbasepaybot?start=plans')]);
  rows.push([Markup.button.callback('🔄 I Already Paid / Check Status', 'b4_check_vip')]);
  return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(rows) };
}

// Non-subscriber gatekeeper response
async function sendBot4GatedMessage(ctx) {
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Member');
  const offer = bot4PlanOffer(getConfig());

  const text = `🔒 <b>VIP Access Restricted</b>

Hello ${escapeHtml(username)}!
This bot is reserved for <b>VIP members</b>: full drops, no daily limits and saved bookmarks.

💎 <b>Choose a pass:</b>
${offer.text}

👇 Tap a plan to get its payment QR in @avnifanbasepaybot.`;

  return await ctx.reply(text, { parse_mode: 'HTML', ...offer.keyboard });
}

// Welcome message for verified VIP subscriber
async function sendBot4Welcome(ctx) {
  const config = getConfig();
  const b4Cfg = config.bot4 || {};
  const welcome = b4Cfg.welcome || {};
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'VIP Member');
  const botName = b4Cfg.bot_name || 'Avni FanBase Premium';

  let text = (welcome.message || "👑 *Welcome to Avni FanBase Premium VIP, {username}!*\n\nYou have exclusive VIP access. Enjoy uninterrupted drops, full-speed streaming, and saved content bookmarks.\n\n👇 Use the menu below or browse fresh drops directly!")
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, botName);

  const inlineRows = [];
  if (Array.isArray(welcome.buttons) && welcome.buttons.length > 0) {
    welcome.buttons.forEach((b) => {
      if (!b.text) return;
      let u = (b.url || '').trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
      inlineRows.push([Markup.button.url(b.text, u)]);
    });
  }

  inlineRows.push([
    Markup.button.callback('🔥 Browse Premium Drops', 'b4_browse_drops'),
    Markup.button.callback('⭐ My Saved Content', 'b4_show_saved')
  ]);

  const inlineKeyboard = Markup.inlineKeyboard(inlineRows);
  const bottomKeyboard = buildBot4StickyKeyboard(config);

  if (welcome.useImage && welcome.imagePath && fs.existsSync(welcome.imagePath)) {
    try {
      await ctx.replyWithPhoto({ source: welcome.imagePath }, {
        caption: formatTelegramHtml(text),
        parse_mode: 'HTML',
        ...inlineKeyboard
      });
      await ctx.reply('👇 VIP Control Menu:', bottomKeyboard);
      return;
    } catch (_) {}
  }

  try {
    await ctx.reply(formatTelegramHtml(text), { parse_mode: 'HTML', ...inlineKeyboard });
    await ctx.reply('👇 VIP Control Menu:', bottomKeyboard);
  } catch (_) {
    await ctx.reply(text, { parse_mode: 'Markdown', ...inlineKeyboard });
    await ctx.reply('👇 VIP Control Menu:', bottomKeyboard);
  }
}

// Batch drop deliverer with configurable limit (safe for 10,000+ messages library)
async function sendBot4DropsBatch(ctx, page = 0) {
  const vip = isBot4Subscriber(ctx);
  if (!vip.active) return await sendBot4GatedMessage(ctx);

  const cfg = getConfig();
  const b4Cfg = cfg.bot4 || {};
  const allMessages = b4Cfg.messages || [];
  const activeMessages = allMessages.filter((m) => m.status !== 'inactive');

  if (activeMessages.length === 0) {
    return await ctx.reply('📭 No premium drops available right now. Please check back later!');
  }

  const limit = Math.max(1, Number(b4Cfg.dropBatchLimit) || 5);
  const totalPages = Math.ceil(activeMessages.length / limit);
  const currentPage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const startIdx = currentPage * limit;
  const currentBatch = activeMessages.slice(startIdx, startIdx + limit);
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'VIP Member');

  await ctx.reply(`🔥 *Exclusive VIP Vault* (Showing ${startIdx + 1}–${startIdx + currentBatch.length} of ${activeMessages.length} drops):`, { parse_mode: 'Markdown' });

  for (const msg of currentBatch) {
    const preview = msg.preview || {};
    const timerConfig = preview.timer || { enabled: false, seconds: 60 };
    const isTemporary = preview.type === 'temporary' || timerConfig.enabled;
    const timerSeconds = Number(timerConfig.seconds) || 60;

    let content = (preview.message || `💎 *${msg.title}*\n\nTap below to unlock full exclusive content!`)
      .replace(/{username}/g, username)
      .replace(/{bot_name}/g, b4Cfg.bot_name || 'Avni FanBase Premium');

    if (isTemporary && timerSeconds > 0) {
      const durText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;
      content += `\n\n⏱️ *Auto-Destruct Notice:* This preview vanishes in ${durText}!`;
    }

    const isSaved = isUserContentSaved(userId, msg.id);
    const viewButtonText = msg.viewButtonText || '👁️ View Premium Content';
    const saveButtonText = isSaved ? '✅ Saved' : '⭐ Save Content';

    const buttons = [
      [Markup.button.callback(viewButtonText, `b4_rev_${msg.id}`)],
      [Markup.button.callback(saveButtonText, `b4_save_${msg.id}`)]
    ];

    if (Array.isArray(preview.buttons)) {
      preview.buttons.forEach((b) => {
        if (!b.text) return;
        let u = (b.url || '').trim();
        if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
        buttons.push([Markup.button.url(b.text, u)]);
      });
    }

    const inlineKeyboard = Markup.inlineKeyboard(buttons);

    const sent = await sendSafeTelegramMessage(ctx, {
      text: content,
      caption: content,
      mediaType: preview.mediaType || 'none',
      mediaPath: preview.mediaPath || null,
      mediaUrl: preview.mediaUrl || null,
      extra: inlineKeyboard
    });

    if (isTemporary && timerSeconds > 0 && sent) {
      setTimeout(async () => {
        try { await ctx.telegram.deleteMessage(sent.chat.id, sent.message_id); } catch (_) {}
      }, timerSeconds * 1000);
    }
  }

  // Navigation pagination keyboard
  const navRow = [];
  if (currentPage > 0) {
    navRow.push(Markup.button.callback('⬅️ Previous', `b4_page_${currentPage - 1}`));
  }
  if (currentPage < totalPages - 1) {
    navRow.push(Markup.button.callback(`Next Page ➡️ (${activeMessages.length - (startIdx + currentBatch.length)} left)`, `b4_page_${currentPage + 1}`));
  }

  if (navRow.length > 0) {
    await ctx.reply(`📑 *Page ${currentPage + 1} of ${totalPages}*`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([navRow])
    });
  }
}

// Reveal full content for a drop
async function sendBot4DropContent(ctx, dropId) {
  const vip = isBot4Subscriber(ctx);
  if (!vip.active) return await sendBot4GatedMessage(ctx);

  const cfg = getConfig();
  const messages = cfg.bot4?.messages || [];
  const drop = messages.find((m) => m.id === dropId);

  if (!drop) {
    try { await ctx.answerCbQuery('Content could not be found.'); } catch (_) {}
    return await ctx.reply('❌ This release is no longer active.');
  }

  try { await ctx.answerCbQuery('Unlocking premium content...'); } catch (_) {}

  const revealed = drop.revealedContent || {};
  const timerConfig = revealed.timer || { enabled: false, seconds: 60 };
  const isTemporary = revealed.type === 'temporary' || timerConfig.enabled;
  const timerSeconds = Number(timerConfig.seconds) || 60;
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'VIP Member');

  let content = (revealed.message || `🎬 *${drop.title}*\n\nHere is your full unlocked exclusive content, {username}!`)
    .replace(/{username}/g, username)
    .replace(/{bot_name}/g, cfg.bot4?.bot_name || 'Avni FanBase Premium');

  if (isTemporary && timerSeconds > 0) {
    const durText = timerSeconds >= 60 ? `${Math.round(timerSeconds / 60)} min` : `${timerSeconds} sec`;
    content += `\n\n⏱️ *Auto-Destruct Notice:* This message will automatically self-destruct in ${durText}!`;
  }

  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const isSaved = isUserContentSaved(userId, drop.id);
  const buttons = [
    [Markup.button.callback(isSaved ? '✅ Saved in Bookmarks' : '⭐ Save Content', `b4_save_${drop.id}`)]
  ];

  if (Array.isArray(revealed.buttons)) {
    revealed.buttons.forEach((b) => {
      if (!b.text) return;
      let u = (b.url || '').trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
      buttons.push([Markup.button.url(b.text, u)]);
    });
  }

  const inlineKeyboard = Markup.inlineKeyboard(buttons);

  const sent = await sendSafeTelegramMessage(ctx, {
    text: content,
    caption: content,
    mediaType: revealed.mediaType || 'none',
    mediaPath: revealed.mediaPath || null,
    mediaUrl: revealed.mediaUrl || null,
    extra: inlineKeyboard
  });

  if (isTemporary && timerSeconds > 0 && sent) {
    setTimeout(async () => {
      try { await ctx.telegram.deleteMessage(sent.chat.id, sent.message_id); } catch (_) {}
    }, timerSeconds * 1000);
  }
}

// Toggle Save / Bookmark
async function handleBot4SaveAction(ctx, dropId) {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  if (!userId) return;

  const cfg = getConfig();
  const messages = cfg.bot4?.messages || [];
  const drop = messages.find((m) => m.id === dropId) || { id: dropId, title: 'Exclusive Drop' };

  const { saved, count } = toggleUserSavedContent(userId, dropId, { title: drop.title });

  if (saved) {
    try {
      await ctx.answerCbQuery(`⭐ Saved to your Saved Contents! (${count} total)`, { show_alert: true });
    } catch (_) {}
  } else {
    try {
      await ctx.answerCbQuery(`Removed from your Saved Contents. (${count} remaining)`, { show_alert: true });
    } catch (_) {}
  }
}

// Show Saved Contents library for the user
async function sendBot4SavedContent(ctx, page = 0) {
  const vip = isBot4Subscriber(ctx);
  if (!vip.active) return await sendBot4GatedMessage(ctx);

  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const savedList = getUserSavedContent(userId);

  if (!savedList || savedList.length === 0) {
    const emptyMsg = `⭐ *Your Saved Content Vault is Empty*\n\nYou haven't bookmarked any drops yet!\n\nWhen browsing drops via *🔥 Premium Drops*, simply tap the *'⭐ Save Content'* button on any drop to save it here for instant retrieval.`;
    return await ctx.reply(formatTelegramHtml(emptyMsg), { parse_mode: 'HTML' });
  }

  const limit = 5;
  const totalPages = Math.ceil(savedList.length / limit);
  const currentPage = Math.max(0, Math.min(Number(page) || 0, totalPages - 1));
  const startIdx = currentPage * limit;
  const currentBatch = savedList.slice(startIdx, startIdx + limit);

  let text = `⭐ *Your Saved Content Bookmarks* (${savedList.length} total releases):\n\n`;

  const inlineButtons = [];

  currentBatch.forEach((item, idx) => {
    const dropId = typeof item === 'string' ? item : item.id;
    const title = typeof item === 'object' && item.title ? item.title : `Saved Drop #${startIdx + idx + 1}`;
    text += `${startIdx + idx + 1}. *${title}*\n`;
    inlineButtons.push([
      Markup.button.callback(`👁️ View #${startIdx + idx + 1}: ${title.slice(0, 20)}`, `b4_rev_${dropId}`),
      Markup.button.callback(`❌ Remove`, `b4_unsave_${dropId}`)
    ]);
  });

  const navRow = [];
  if (currentPage > 0) {
    navRow.push(Markup.button.callback('⬅️ Previous', `b4_saved_page_${currentPage - 1}`));
  }
  if (currentPage < totalPages - 1) {
    navRow.push(Markup.button.callback('Next Page ➡️', `b4_saved_page_${currentPage + 1}`));
  }
  if (navRow.length > 0) inlineButtons.push(navRow);

  const keyboard = Markup.inlineKeyboard(inlineButtons);
  await ctx.reply(formatTelegramHtml(text), { parse_mode: 'HTML', ...keyboard });
}

// My Subscription status on Bot 4
async function sendBot4MyPlan(ctx) {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const name = ctx.from?.first_name || 'Member';
  const vip = checkUserVipSubscription(userId);

  if (vip.active) {
    const expiryDate = new Date(vip.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    const text = `👑 *VIP Status: ACTIVE*\n\nHello ${name}, your VIP Access is fully active!\n\n• Plan: *${vip.planName}*\n• Valid Until: *${expiryDate}*\n• Time Remaining: *${vip.remainingText}*\n\n✨ All features are unlocked. Enjoy unlimited drops!`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.url('👑 Extend / Renew Plan', 'https://t.me/avnifanbasepaybot?start=plans')],
      [Markup.button.callback('🔄 Refresh Status', 'b4_check_vip')]
    ]);
    return await ctx.reply(formatTelegramHtml(text), { parse_mode: 'HTML', ...keyboard });
  } else {
    return await sendBot4GatedMessage(ctx);
  }
}

// Renew / Extend VIP
async function sendBot4Renew(ctx) {
  const offer = bot4PlanOffer(getConfig());
  const text = `👑 <b>Renew or Extend Your VIP Pass</b>

Time you buy now is added on top of what you have left.

${offer.text}

👇 Tap a plan to pay in @avnifanbasepaybot.`;

  await ctx.reply(text, { parse_mode: 'HTML', ...offer.keyboard });
}

// Help & Support for Bot 4
async function sendBot4Help(ctx) {
  const text = `👑 *Avni FanBase Premium VIP Support*\n\nAvailable commands:\n• /start - VIP Welcome & main menu\n• /drops - Browse latest exclusive drops\n• /saved - Access your saved content library\n• /myplan - Check your subscription duration & remaining time\n• /renew - Extend or renew your VIP access pass\n• /help - Display this help message\n\nNeed assistance? Contact our team in the official alerts channel.`;
  await ctx.reply(formatTelegramHtml(text), { parse_mode: 'HTML' });
}

// Expiry Reminder Periodic Background Worker
let expiryReminderTimer = null;
function startExpiryReminderScheduler() {
  if (expiryReminderTimer) clearInterval(expiryReminderTimer);

  expiryReminderTimer = setInterval(async () => {
    try {
      const cfg = getConfig();
      const expCfg = cfg.bot4?.expiryReminder || {};
      if (expCfg.enabled === false) return;

      const minutesBefore = Number(expCfg.notifyMinutesBefore) || 30;

      // 1. Pre-expiry reminders (e.g. 30 minutes before)
      const expiring = getExpiringSubscriptions(minutesBefore);
      for (const item of expiring) {
        const { userId, sub, remainingText } = item;
        markReminderSent(userId);

        const username = sub.username || 'VIP Member';
        const expiryTime = new Date(sub.expiresAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const planName = sub.planName || 'VIP Pass';

        const template = expCfg.reminderMessage || "⚠️ *VIP Subscription Reminder*\n\nHey {username}! Your VIP pass will expire in *{time_left}* (at {expiry_time}).\n\nRenew your plan now to avoid losing access to premium drops!";
        const reminderText = template
          .replace(/{username}/g, username)
          .replace(/{time_left}/g, remainingText)
          .replace(/{expiry_time}/g, expiryTime)
          .replace(/{plan_name}/g, planName);

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.url('👑 Renew VIP Pass Now', 'https://t.me/avnifanbasepaybot?start=plans')]
        ]);

        try {
          const sent = await bot4.telegram.sendMessage(userId, formatTelegramHtml(reminderText), {
            parse_mode: 'HTML',
            ...keyboard
          });

          const autoDeleteSec = Number(expCfg.reminderAutoDeleteSeconds) || 0;
          if (autoDeleteSec > 0 && sent) {
            setTimeout(async () => {
              try { await bot4.telegram.deleteMessage(userId, sent.message_id); } catch (_) {}
            }, autoDeleteSec * 1000);
          }
        } catch (sendErr) {
          try {
            await bot1.telegram.sendMessage(userId, formatTelegramHtml(reminderText), {
              parse_mode: 'HTML',
              ...keyboard
            });
          } catch (_) {}
        }
      }

      // 2. On-expire notices
      const expired = getNewlyExpiredSubscriptions();
      for (const item of expired) {
        const { userId, sub } = item;
        markExpiredSent(userId);

        const username = sub.username || 'VIP Member';
        const planName = sub.planName || 'VIP Pass';
        const template = expCfg.onExpireMessage || "🔒 *VIP Subscription Expired*\n\nHey {username}, your VIP Access pass has just expired!\n\nUpgrade or renew your subscription to continue enjoying exclusive drops.";
        const expireText = template
          .replace(/{username}/g, username)
          .replace(/{plan_name}/g, planName);

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.url('💎 Renew VIP Pass', 'https://t.me/avnifanbasepaybot?start=plans')]
        ]);

        try {
          const sent = await bot4.telegram.sendMessage(userId, formatTelegramHtml(expireText), {
            parse_mode: 'HTML',
            ...keyboard
          });

          const autoDeleteSec = Number(expCfg.onExpireAutoDeleteSeconds) || 0;
          if (autoDeleteSec > 0 && sent) {
            setTimeout(async () => {
              try { await bot4.telegram.deleteMessage(userId, sent.message_id); } catch (_) {}
            }, autoDeleteSec * 1000);
          }
        } catch (sendErr) {
          try {
            await bot1.telegram.sendMessage(userId, formatTelegramHtml(expireText), {
              parse_mode: 'HTML',
              ...keyboard
            });
          } catch (_) {}
        }
      }
    } catch (schedErr) {
      console.warn('[Expiry Reminder Scheduler] Error:', schedErr.message);
    }
  }, 30 * 1000); // Check every 30 seconds
}

// Bot 4 Commands & Actions
bot4.start(async (ctx) => {
  const vip = isBot4Subscriber(ctx);
  if (!vip.active) return await sendBot4GatedMessage(ctx);
  return await sendBot4Welcome(ctx);
});

bot4.command('drops', async (ctx) => {
  await sendBot4DropsBatch(ctx, 0);
});

bot4.command('saved', async (ctx) => {
  await sendBot4SavedContent(ctx, 0);
});

bot4.command('myplan', async (ctx) => {
  await sendBot4MyPlan(ctx);
});

bot4.command('renew', async (ctx) => {
  await sendBot4Renew(ctx);
});

bot4.command('help', async (ctx) => {
  await sendBot4Help(ctx);
});

// Bot 4 Actions
bot4.action(/^b4_page_(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10);
  try { await ctx.answerCbQuery(); } catch (_) {}
  await sendBot4DropsBatch(ctx, page);
});

bot4.action(/^b4_saved_page_(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10);
  try { await ctx.answerCbQuery(); } catch (_) {}
  await sendBot4SavedContent(ctx, page);
});

bot4.action(/^b4_rev_(.+)$/, async (ctx) => {
  await sendBot4DropContent(ctx, ctx.match[1]);
});

bot4.action(/^b4_save_(.+)$/, async (ctx) => {
  await handleBot4SaveAction(ctx, ctx.match[1]);
});

bot4.action(/^b4_unsave_(.+)$/, async (ctx) => {
  const dropId = ctx.match[1];
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  toggleUserSavedContent(userId, dropId);
  try { await ctx.answerCbQuery('Removed from saved.'); } catch (_) {}
  await sendBot4SavedContent(ctx, 0);
});

bot4.action('b4_check_vip', async (ctx) => {
  const vip = isBot4Subscriber(ctx);
  if (vip.active) {
    try { await ctx.answerCbQuery('VIP Verified! Welcome! 🎉'); } catch (_) {}
    return await sendBot4Welcome(ctx);
  } else {
    try { await ctx.answerCbQuery('Subscription still inactive. Please complete payment.', { show_alert: true }); } catch (_) {}
    return await sendBot4GatedMessage(ctx);
  }
});

bot4.action('b4_browse_drops', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  await sendBot4DropsBatch(ctx, 0);
});

bot4.action('b4_show_saved', async (ctx) => {
  try { await ctx.answerCbQuery(); } catch (_) {}
  await sendBot4SavedContent(ctx, 0);
});

// Photo / Payment Screenshot on Bot 4
bot4.on('photo', async (ctx) => {
  const handled = await handlePaymentPhotoSubmission(ctx, getConfig, formatTelegramHtml);
  if (handled) return;
  await ctx.reply('📸 Photo received. Use the buttons below to navigate:', buildBot4StickyKeyboard());
});

// Text & Bottom Button Router on Bot 4
bot4.on('text', async (ctx) => {
  const handled = await handlePaymentTextSubmission(ctx, getConfig, formatTelegramHtml);
  if (handled) return;

  const text = (ctx.message.text || '').trim();
  const lower = text.toLowerCase();

  if (text === '/start' || text.startsWith('/start ')) {
    const vip = isBot4Subscriber(ctx);
    if (!vip.active) return await sendBot4GatedMessage(ctx);
    return await sendBot4Welcome(ctx);
  }

  // Check Sticky Bottom Buttons
  const cfg = getConfig();
  const bottomButtons = cfg.bot4?.welcome?.bottomButtons || [];
  const matchedBtn = bottomButtons.find((b) => b.text && b.text.trim().toLowerCase() === lower);

  if (matchedBtn) {
    if (matchedBtn.type === 'drops' || lower.includes('drop')) {
      return await sendBot4DropsBatch(ctx, 0);
    }
    if (matchedBtn.type === 'saved' || lower.includes('saved')) {
      return await sendBot4SavedContent(ctx, 0);
    }
    if (matchedBtn.type === 'myplan' || lower.includes('plan') || lower.includes('subscri')) {
      return await sendBot4MyPlan(ctx);
    }
    if (matchedBtn.type === 'renew' || lower.includes('renew')) {
      return await sendBot4Renew(ctx);
    }
    if (matchedBtn.type === 'help' || lower.includes('help') || lower.includes('support')) {
      return await sendBot4Help(ctx);
    }
    if (matchedBtn.type === 'url' && matchedBtn.url) {
      let u = matchedBtn.url.trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
      return await ctx.reply(`🔗 Tap below:`, Markup.inlineKeyboard([[Markup.button.url(matchedBtn.text, u)]]));
    }
  }

  // Fallback keyword routing
  if (lower.includes('drop') || text === '/drops') {
    return await sendBot4DropsBatch(ctx, 0);
  }
  if (lower.includes('saved') || text === '/saved') {
    return await sendBot4SavedContent(ctx, 0);
  }
  if (lower.includes('plan') || lower.includes('status') || text === '/myplan') {
    return await sendBot4MyPlan(ctx);
  }
  if (lower.includes('renew') || text === '/renew') {
    return await sendBot4Renew(ctx);
  }
  if (lower.includes('help') || text === '/help') {
    return await sendBot4Help(ctx);
  }

  // Default fallback for Bot 4
  const vip = isBot4Subscriber(ctx);
  if (!vip.active) {
    return await sendBot4GatedMessage(ctx);
  } else {
    await ctx.reply(`👋 Hello VIP Member! Use the menu below to browse drops and saved bookmarks:`, buildBot4StickyKeyboard());
  }
});

// ----------------------------------------------------
// 6. BOT INITIALIZATION & RETRY MANAGER
// ----------------------------------------------------
async function connectBot(botInstance, name, commands, statusKey, secretPath) {
  botStatus[statusKey] = { connected: false, starting: true };
  const webhookDomain = process.env.WEBHOOK_DOMAIN;

  if (webhookDomain && webhookDomain.trim() !== '') {
    const cleanDomain = webhookDomain.replace(/\/+$/, '');
    const targetWebhook = `${cleanDomain}${secretPath}`;
    const cfg = getConfig();
    if (!cfg._webhooks) cfg._webhooks = {};
    if (!cfg._commandsSet) cfg._commandsSet = {};

    let setupError = null;

    // "#s1" forces one re-registration so Telegram starts sending the secret header
    if (cfg._webhooks[statusKey] !== `${targetWebhook}#s1`) {
      try {
        await callTelegramOnce(`${name} setWebhook`, () =>
          botInstance.telegram.setWebhook(targetWebhook, { secret_token: webhookSecret(botInstance.telegram.token) })
        );
        console.log(`🚀 [${name}] Webhook registered with Telegram: ${targetWebhook}`);
        cfg._webhooks[statusKey] = `${targetWebhook}#s1`;
        saveConfig(cfg);
      } catch (whErr) {
        setupError = whErr.message;
        console.warn(`⚠️ [${name}] Could not register webhook: ${whErr.message}`);
      }
    } else {
      console.log(`✅ [${name}] Webhook already set to ${targetWebhook}. Skipping API call.`);
    }

    if (!setupError && !cfg._commandsSet[statusKey] && commands && commands.length > 0) {
      try {
        await callTelegramOnce(`${name} setMyCommands`, () =>
          botInstance.telegram.setMyCommands(commands)
        );
        console.log(`✅ [${name}] Registered commands: ${commands.map((c) => `/${c.command}`).join(', ')}`);
        cfg._commandsSet[statusKey] = true;
        saveConfig(cfg);
      } catch (cmdErr) {
        setupError = cmdErr.message;
        console.warn(`[${name}] Notice setting commands: ${cmdErr.message}`);
      }
    }

    botStatus[statusKey] = setupError
      ? { connected: true, warning: setupError }
      : { connected: true };
    return;
  }

  // Long Polling Mode with auto-retry
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const launchPromise = botInstance.launch({ dropPendingUpdates: false });
      await new Promise((resolve, reject) => {
        let startupSettled = false;
        launchPromise.then(
          () => {
            if (!startupSettled) {
              startupSettled = true;
              resolve();
            }
          },
          (err) => {
            if (!startupSettled) {
              startupSettled = true;
              reject(err);
              return;
            }
            console.error(`❌ [${name}] Polling stopped: ${err.message}`);
            botStatus[statusKey] = { connected: false, error: err.message };
          }
        );
        const waitForPollingStart = () => {
          if (botInstance.polling && !startupSettled) {
            startupSettled = true;
            resolve();
            return;
          }
          setTimeout(waitForPollingStart, 10);
        };
        waitForPollingStart();
      });
      const me = botInstance.botInfo;
      botStatus[statusKey] = { connected: true, username: me?.username, firstName: me?.first_name };
      console.log(`🚀 [${name}] is live with long polling!`);

      if (commands && commands.length > 0) {
        callTelegramOnce(`${name} setMyCommands`, () =>
          botInstance.telegram.setMyCommands(commands)
        ).catch((err) => {
          console.warn(`⚠️ [${name}] Could not register commands: ${err.message}`);
        });
      }
      return;
    } catch (err) {
      console.warn(`⚠️ [${name}] Launch attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 6) {
        const retryWait = (getTelegramRetryAfterSeconds(err) || 3) * 1000;
        await new Promise((r) => setTimeout(r, retryWait));
      } else {
        console.error(`❌ [${name}] Startup failed after 6 attempts: ${err.message}`);
        botStatus[statusKey] = { connected: false, error: err.message };
      }
    }
  }
}

async function initBots() {
  const sPath1 = `/webhook/bot1_${token1.split(':')[0]}`;
  const sPath2 = `/webhook/bot2_${token2.split(':')[0]}`;
  const sPath3 = `/webhook/bot3_${token3.split(':')[0]}`;
  const sPath4 = `/webhook/bot4_${token4.split(':')[0]}`;

  // Bot 1
  if (bot1Enabled) {
    await connectBot(
      bot1,
      'Bot 1: Avniffanbasebot',
      [
        { command: 'start', description: 'Welcome greeting & community links' },
        { command: 'today', description: "View Today's fresh content drop" },
        { command: 'free', description: 'Access free content and channels' },
        { command: 'terms', description: 'View Terms & Policy' },
        { command: 'help', description: 'Bot commands and support' },
      ],
      'bot1',
      sPath1
    );
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    botStatus.bot1 = { connected: false, username: 'avniffanbasebot', disabled: true };
    console.log('⏸️ Bot 1 startup skipped (BOT1_ENABLED=false).');
  }

  // Bot 2
  if (bot2Enabled) {
    await connectBot(
      bot2,
      'Bot 2: avnifanbbot',
      [
        { command: 'start', description: 'Receive video drop (auto-deletes)' },
        { command: 'video', description: 'Get next video drop' },
        { command: 'list', description: 'View all active video drops' },
        { command: 'timer', description: 'View auto-delete timer' },
        { command: 'help', description: 'Bot information and commands' },
      ],
      'bot2',
      sPath2
    );
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    botStatus.bot2 = { connected: false, username: 'avnifanbbot', disabled: true };
    console.log('⏸️ Bot 2 startup skipped (BOT2_ENABLED=false).');
  }

  // Bot 3: Payment & VIP Checkout Bot (@avnifanbasepaybot)
  if (bot3Enabled) {
    await connectBot(
      bot3,
      'Bot 3: avnifanbasepaybot (Payment)',
      [
        { command: 'start', description: 'Welcome & VIP Subscription Plans' },
        { command: 'plans', description: 'View VIP Plans & Payment QR Code' },
        { command: 'myplan', description: 'Check your active VIP pass status' },
        { command: 'help', description: 'Payment instructions & support' },
      ],
      'bot3',
      sPath3
    );
    await new Promise((r) => setTimeout(r, 2000));
  } else {
    botStatus.bot3 = { connected: false, username: 'avnifanbasepaybot', disabled: true };
    console.log('⏸️ Bot 3 startup skipped (BOT3_ENABLED=false).');
  }

  // Bot 4: Premium Subscribed Members Bot
  if (bot4Enabled) {
    await connectBot(
      bot4,
      'Bot 4: avnifanbaseprembot',
      [
        { command: 'start', description: 'VIP Premium Welcome & Portal' },
        { command: 'drops', description: 'Browse Exclusive VIP Drops' },
        { command: 'saved', description: 'View Your Saved Content' },
        { command: 'myplan', description: 'Check VIP Subscription Status' },
        { command: 'renew', description: 'Renew or Extend VIP Pass' },
        { command: 'help', description: 'VIP Support & Help' },
      ],
      'bot4',
      sPath4
    );
  } else {
    botStatus.bot4 = { connected: false, username: 'avnifanbaseprembot', disabled: true };
    console.log('⏸️ Bot 4 startup skipped (BOT4_ENABLED=false).');
  }

  // Start background expiration reminder monitor
  startExpiryReminderScheduler();
}

initBots().catch((err) => {
  console.error('❌ Bot initialization failed:', err);
  process.exitCode = 1;
  stopBots('startup failure');
});

// Graceful shutdown
function stopBots(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  if (expiryReminderTimer) clearInterval(expiryReminderTimer);

  for (const bot of [bot1, bot2, bot3, bot4]) {
    if (bot.polling || bot.webhookServer) {
      try {
        bot.stop(signal);
      } catch (err) {
        console.warn(`Could not stop bot cleanly: ${err.message}`);
      }
    }
  }

  server.close(() => {
    process.exit(process.exitCode ?? 0);
  });
}

let isShuttingDown = false;
process.once('SIGINT', () => stopBots('SIGINT'));
process.once('SIGTERM', () => stopBots('SIGTERM'));
