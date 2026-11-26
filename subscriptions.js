import fs from 'fs';
import path from 'path';
import { Markup } from 'telegraf';
import QRCode from 'qrcode';
import { IS_TENANT, ROOT, botUsername } from './tenant.js';

const SUBS_DATA_FILE = path.join(ROOT, 'data', 'subscriptions.json');

// Ensure data file exists
export function getSubscriptionsData() {
  try {
    if (!fs.existsSync(SUBS_DATA_FILE)) {
      const initial = { subscriptions: {}, pendingPayments: [], paymentHistory: [], savedContent: {} };
      fs.mkdirSync(path.dirname(SUBS_DATA_FILE), { recursive: true });
      fs.writeFileSync(SUBS_DATA_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(SUBS_DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.savedContent) parsed.savedContent = {};
    return parsed;
  } catch (err) {
    console.error('[Subscriptions] Error reading subscriptions data:', err.message);
    return { subscriptions: {}, pendingPayments: [], paymentHistory: [], savedContent: {} };
  }
}

// Bookmarks / Saved Content Management
export function getUserSavedContent(userId) {
  if (!userId) return [];
  const uid = String(userId);
  const data = getSubscriptionsData();
  data.savedContent = data.savedContent || {};
  return data.savedContent[uid] || [];
}

export function toggleUserSavedContent(userId, messageId, meta = {}) {
  if (!userId || !messageId) return { saved: false, count: 0 };
  const uid = String(userId);
  const data = getSubscriptionsData();
  data.savedContent = data.savedContent || {};
  const userList = data.savedContent[uid] || [];
  
  const existingIdx = userList.findIndex((item) => (typeof item === 'string' ? item === messageId : item.id === messageId));
  let saved = false;
  if (existingIdx >= 0) {
    userList.splice(existingIdx, 1);
    saved = false;
  } else {
    userList.unshift({
      id: messageId,
      title: meta.title || 'Saved Drop',
      savedAt: new Date().toISOString()
    });
    saved = true;
  }
  data.savedContent[uid] = userList;
  saveSubscriptionsData(data);
  return { saved, count: userList.length };
}

export function isUserContentSaved(userId, messageId) {
  if (!userId || !messageId) return false;
  const list = getUserSavedContent(userId);
  return list.some((item) => (typeof item === 'string' ? item === messageId : item.id === messageId));
}

// Expiration Reminders Helper
export function getExpiringSubscriptions(minutesBefore = 30) {
  const data = getSubscriptionsData();
  const now = Date.now();
  const windowMs = Number(minutesBefore) * 60 * 1000;
  const expiring = [];

  for (const [userId, sub] of Object.entries(data.subscriptions || {})) {
    if (!sub || !sub.expiresAt) continue;
    if (sub.expiresAt > now && sub.expiresAt <= now + windowMs && !sub.reminderSent) {
      expiring.push({
        userId,
        sub,
        timeLeftMs: sub.expiresAt - now,
        remainingText: formatRemainingTime(sub.expiresAt)
      });
    }
  }
  return expiring;
}

export function markReminderSent(userId) {
  const data = getSubscriptionsData();
  const uid = String(userId);
  if (data.subscriptions?.[uid]) {
    data.subscriptions[uid].reminderSent = true;
    saveSubscriptionsData(data);
  }
}

export function getNewlyExpiredSubscriptions() {
  const data = getSubscriptionsData();
  const now = Date.now();
  const expired = [];

  for (const [userId, sub] of Object.entries(data.subscriptions || {})) {
    if (!sub || !sub.expiresAt) continue;
    if (sub.expiresAt <= now && !sub.expiredSent) {
      expired.push({
        userId,
        sub
      });
    }
  }
  return expired;
}

export function markExpiredSent(userId) {
  const data = getSubscriptionsData();
  const uid = String(userId);
  if (data.subscriptions?.[uid]) {
    data.subscriptions[uid].expiredSent = true;
    saveSubscriptionsData(data);
  }
}

export function saveSubscriptionsData(data) {
  try {
    fs.mkdirSync(path.dirname(SUBS_DATA_FILE), { recursive: true });
    fs.writeFileSync(SUBS_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Subscriptions] Error saving subscriptions data:', err.message);
    return false;
  }
}

// Format duration helper (e.g. 6 hours -> "6 Hours", 24 hours -> "1 Day (24 Hours)")
export function formatDurationLabel(hours) {
  const h = Number(hours) || 1;
  if (h < 24) return `${h} Hour${h > 1 ? 's' : ''}`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  if (rem === 0) return `${days} Day${days > 1 ? 's' : ''}`;
  return `${days}d ${rem}h`;
}

// Format remaining time countdown (e.g. "5 hrs 42 mins" or "23 mins")
export function formatRemainingTime(expiresAt) {
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return 'Expired';
  const totalSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return `${days} day${days > 1 ? 's' : ''} ${remH} hr${remH > 1 ? 's' : ''}`;
  }
  if (hours > 0) return `${hours} hr${hours > 1 ? 's' : ''} ${minutes} min`;
  return `${minutes} min${minutes > 1 ? 's' : ''}`;
}

const CONFIG_FILE = path.join(ROOT, 'config.json');

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

// A plan may point at a bottom button's id, its contentType or its list id. Treat all as the same content.
function contentAliases(key, config) {
  const aliases = new Set([key]);
  const buttons = [
    ...(config.bot1?.welcome?.bottomButtons || []),
    ...(config.bot4?.welcome?.bottomButtons || [])
  ];
  for (const b of buttons) {
    const ids = [b.id, b.contentType, b.listId, b.type === 'today' ? 'today' : null].filter(Boolean);
    if (ids.includes(key)) ids.forEach((id) => aliases.add(id));
  }
  if (key === 'today' || key === 'bbtn_today') aliases.add('today').add('bbtn_today');
  return aliases;
}

export function planUnlocksContent(planKey, requiredKey, config = readConfigFile()) {
  if (!planKey || planKey === 'all') return true;
  return contentAliases(requiredKey, config).has(planKey);
}

export function planUnlocksBot4(plan) {
  const key = plan.linkedContent || 'all';
  return key === 'all' || key.startsWith('b4');
}

// Check if user has an active VIP subscription (optionally for a specific content type / bottom button)
export function checkUserVipSubscription(userId, requiredContentType = 'all') {
  if (!userId) return { active: false };
  const uid = String(userId);
  const data = getSubscriptionsData();
  const sub = data.subscriptions[uid];
  if (!sub) return { active: false };

  const now = Date.now();
  const isValid = (p) => p && p.expiresAt && p.expiresAt > now;

  // Collect all active passes
  const activePasses = [];
  if (sub.contentPasses && typeof sub.contentPasses === 'object') {
    Object.keys(sub.contentPasses).forEach((cKey) => {
      const p = sub.contentPasses[cKey];
      if (isValid(p)) {
        activePasses.push({
          linkedContent: cKey,
          planId: p.planId,
          planName: p.planName || 'Content Pass',
          contentTitle: p.contentTitle || cKey,
          startsAt: p.startsAt,
          expiresAt: p.expiresAt,
          remainingText: formatRemainingTime(p.expiresAt)
        });
      }
    });
  }

  // Backwards compatibility for records saved before per-content passes existed
  if (!Object.keys(sub.contentPasses || {}).length && isValid(sub)) {
    const topKey = sub.linkedContent || 'all';
    if (!activePasses.some((p) => p.linkedContent === topKey)) {
      activePasses.push({
        linkedContent: topKey,
        planId: sub.planId,
        planName: sub.planName || 'VIP Pass',
        contentTitle: sub.contentTitle || (topKey === 'all' ? 'All Content VIP' : topKey),
        startsAt: sub.startsAt,
        expiresAt: sub.expiresAt,
        remainingText: formatRemainingTime(sub.expiresAt)
      });
    }
  }

  if (activePasses.length === 0) {
    return { active: false };
  }

  // 1. Check if user has an All-Access pass ('all')
  const allAccessPass = activePasses.find((p) => p.linkedContent === 'all');
  if (allAccessPass) {
    return {
      active: true,
      isAllAccess: true,
      planId: allAccessPass.planId,
      planName: allAccessPass.planName,
      contentTitle: allAccessPass.contentTitle,
      startsAt: allAccessPass.startsAt,
      expiresAt: allAccessPass.expiresAt,
      remainingText: allAccessPass.remainingText,
      activePasses
    };
  }

  // If requiredContentType is 'all', but user doesn't have an All-Access pass:
  if (requiredContentType === 'all') {
    return {
      active: false,
      hasSpecificPass: true,
      activePasses
    };
  }

  // 2. Check if user has a pass matching requiredContentType
  const config = readConfigFile();
  const matchedPass = activePasses.find((p) => planUnlocksContent(p.linkedContent, requiredContentType, config));

  if (matchedPass) {
    return {
      active: true,
      isAllAccess: false,
      planId: matchedPass.planId,
      planName: matchedPass.planName,
      contentTitle: matchedPass.contentTitle,
      startsAt: matchedPass.startsAt,
      expiresAt: matchedPass.expiresAt,
      remainingText: matchedPass.remainingText,
      activePasses
    };
  }

  return {
    active: false,
    hasSpecificPass: activePasses.length > 0,
    activePasses
  };
}

const PAY_BOT_USERNAME = botUsername(3);
const CHECKOUT_TTL_MS = 60 * 60 * 1000;
const botRegistry = new Map(); // username -> Telegraf instance

// User state for an open checkout (QR shown, waiting for payment proof)
export const userPaymentStates = new Map(); // userId -> checkout

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function startCheckout(ctx, plan) {
  const checkout = {
    orderRef: `AV${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase(),
    planId: plan.id,
    planName: plan.name,
    price: plan.price,
    durationHours: plan.durationHours,
    linkedContent: plan.linkedContent || 'all',
    contentTitle: plan.contentTitle || 'All Content',
    sourceBot: ctx.botInfo?.username,
    timestamp: Date.now()
  };
  userPaymentStates.set(String(ctx.from.id), checkout);
  return checkout;
}

function getOpenCheckout(userId) {
  const checkout = userPaymentStates.get(userId);
  if (checkout && Date.now() - checkout.timestamp > CHECKOUT_TTL_MS) {
    userPaymentStates.delete(userId);
    return null;
  }
  return checkout || null;
}

// UPI QR with the exact amount and order reference, so the bank statement can be matched to the request.
async function buildPaymentQr(plan, subCfg, orderRef) {
  if (subCfg.qrMode === 'custom_image' && subCfg.customQrPath) {
    const customPath = path.isAbsolute(subCfg.customQrPath)
      ? subCfg.customQrPath
      : path.join(ROOT, subCfg.customQrPath);
    if (fs.existsSync(customPath)) return { source: customPath, prefilled: false };
  }

  const params = {
    pa: (subCfg.upiId || '').trim(),
    pn: (subCfg.merchantName || 'Avni FanBase VIP').trim(),
    am: String(plan.price),
    cu: 'INR',
    tn: orderRef
  };
  // A new client must never collect money on the sample UPI ID
  if (!params.pa || (IS_TENANT && params.pa === 'avnifanbase@upi')) return null;
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  try {
    const buffer = await QRCode.toBuffer(`upi://pay?${query}`, { width: 500, margin: 2 });
    return { source: buffer, prefilled: true };
  } catch (err) {
    console.warn('[Subscriptions] Could not generate UPI QR:', err.message);
    return null;
  }
}

// Display Plan Details, QR Code, and open a checkout that accepts proof straight away
export async function sendPlanQrAndInstructions(ctx, planId, getConfig, formatTelegramHtml) {
  const subCfg = getConfig().subscriptions || {};
  const plan = (subCfg.plans || []).find((p) => p.id === planId);
  const backButton = Markup.inlineKeyboard([[Markup.button.callback('« All Plans', 'open_vip_plans')]]);

  if (subCfg.enabled === false) {
    return ctx.reply('🔒 VIP Subscriptions are currently paused. Please check back later!');
  }
  // Never fall back to a different plan: the user would be charged the wrong amount.
  if (!plan) {
    return ctx.reply('❌ That plan is no longer available.', backButton);
  }

  const checkout = startCheckout(ctx, plan);
  const qr = await buildPaymentQr(plan, subCfg, checkout.orderRef);
  if (!qr) {
    userPaymentStates.delete(String(ctx.from.id));
    return ctx.reply('⚠️ Payments are not set up yet. Please contact support.');
  }

  const curr = subCfg.currency || '₹';
  const lines = [
    `👑 <b>${escapeHtml(plan.name)}</b>`,
    `🎯 Unlocks: <b>${escapeHtml(plan.contentTitle || 'All Content')}</b>`,
    `⏱ Duration: <b>${formatDurationLabel(plan.durationHours)}</b>`,
    '',
    `💵 Pay exactly <b>${escapeHtml(curr)}${escapeHtml(plan.price)}</b>`,
    `🔑 UPI ID: <code>${escapeHtml(subCfg.upiId || '')}</code>`,
    `🧾 Order ref: <code>${checkout.orderRef}</code>`,
    ''
  ];
  // Instructions saved in the dashboard replace the default steps
  if (subCfg.instructions) {
    lines.push(formatTelegramHtml(subCfg.instructions));
    lines.push('', '👇 Send the <b>screenshot</b> or <b>UTR number</b> right here.');
  } else {
    lines.push(
      qr.prefilled
        ? '1. Scan the QR with any UPI app (amount is filled in).'
        : '1. Scan the QR with any UPI app and type the amount above.',
      '2. Then send the <b>payment screenshot</b> or <b>12-digit UTR number</b> right here.'
    );
  }
  const caption = lines.join('\n');

  try {
    return await ctx.replyWithPhoto({ source: qr.source }, { caption, parse_mode: 'HTML', ...backButton });
  } catch (err) {
    console.warn('[Subscriptions] Rich QR caption rejected, retrying plain:', err.message);
    const plain = caption.replace(/<[^>]+>/g, '');
    return await ctx.replyWithPhoto({ source: qr.source }, { caption: plain.slice(0, 1024), ...backButton });
  }
}

// Setup Bot Handlers for Subscriptions
export function setupSubscriptionBotHandlers(bot, botLabel, getConfig, formatTelegramHtml) {
  if (bot.botInfo?.username) botRegistry.set(bot.botInfo.username, bot);

  // 1. /subscribe, /vip, /plans, /pay, /qr commands
  const handlePlansCommand = async (ctx) => {
    const payload = (ctx.startPayload || '').trim();
    if (payload.startsWith('plan_')) {
      return await sendPlanQrAndInstructions(ctx, payload, getConfig, formatTelegramHtml);
    }

    const config = getConfig();
    const subCfg = config.subscriptions || {};
    if (subCfg.enabled === false) {
      return ctx.reply('🔒 VIP Subscriptions are currently paused. Please check back later!');
    }

    const plans = subCfg.plans || [];
    if (plans.length === 0) {
      return ctx.reply('📭 No subscription plans configured at the moment.');
    }

    const curr = subCfg.currency || '₹';
    let text = `👑 *Avni FanBase VIP Subscription Plans*\n\n`;
    text += `Choose a content pass linked to your favorite drops, or get the **All-Access VIP** pass to unlock everything!\n\n`;

    const allAccess = plans.filter((p) => p.linkedContent === 'all' || !p.linkedContent);
    const contentSpecific = plans.filter((p) => p.linkedContent && p.linkedContent !== 'all');

    if (allAccess.length > 0) {
      text += `🌐 *ALL-ACCESS PASS (Unlocks All Content & VIP Bot 4):*\n`;
      allAccess.forEach((p) => {
        const dur = formatDurationLabel(p.durationHours);
        const badge = p.badge ? ` [${p.badge}]` : '';
        text += `• *${p.name}*${badge} — *${curr}${p.price}* (${dur})\n`;
        if (p.description) text += `  ${p.description}\n`;
      });
      text += `\n`;
    }

    if (contentSpecific.length > 0) {
      text += `📁 *CONTENT-SPECIFIC PASSES (Linked with Bottom Buttons):*\n`;
      contentSpecific.forEach((p) => {
        const dur = formatDurationLabel(p.durationHours);
        const badge = p.badge ? ` [${p.badge}]` : '';
        const target = p.contentTitle || p.linkedContent;
        text += `• *${p.name}*${badge} — *${curr}${p.price}* (${dur})\n`;
        text += `  🎯 *Unlocks:* ${target}\n`;
        if (p.description) text += `  ${p.description}\n`;
      });
      text += `\n`;
    }

    text += `👇 Select a plan below to view UPI QR Code & pay:`;

    const buttons = plans.map((p) => {
      const dur = formatDurationLabel(p.durationHours);
      const tag = p.contentTitle ? ` [${p.contentTitle}]` : '';
      return [Markup.button.callback(`${p.name} — ${curr}${p.price}${tag}`, `buy_plan_${p.id}`)];
    });

    // Also add "Check My Status" button
    buttons.push([Markup.button.callback('🔍 Check My Subscription Status', 'check_my_plan')]);

    const keyboard = Markup.inlineKeyboard(buttons);
    const htmlText = formatTelegramHtml(text);

    try {
      await ctx.reply(htmlText, { parse_mode: 'HTML', ...keyboard });
    } catch (_) {
      try {
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      } catch (_) {
        await ctx.reply(text, keyboard);
      }
    }
  };

  // Deep links from other bots: ?start=plan_<id>, ?start=plans, ?start=subscribe
  bot.start(async (ctx, next) => {
    const payload = (ctx.startPayload || '').trim();
    if (payload.startsWith('plan_')) {
      return sendPlanQrAndInstructions(ctx, payload, getConfig, formatTelegramHtml);
    }
    if (payload === 'plans' || payload === 'subscribe') return handlePlansCommand(ctx);
    return next();
  });

  bot.command('subscribe', handlePlansCommand);
  bot.command('vip', handlePlansCommand);
  bot.command('plans', handlePlansCommand);
  bot.command('pay', handlePlansCommand);
  bot.command('qr', handlePlansCommand);
  bot.action('open_vip_plans', async (ctx) => {
    try { await ctx.answerCbQuery('Opening VIP Plans...'); } catch (_) {}
    userPaymentStates.delete(String(ctx.from?.id));
    await handlePlansCommand(ctx);
  });

  // 2. /myplan command
  const handleMyPlanCommand = async (ctx) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const name = ctx.from?.first_name || 'Member';
    const vip = checkUserVipSubscription(userId);

    if (vip.active || (vip.activePasses && vip.activePasses.length > 0)) {
      let text = `👑 *VIP Status: ACTIVE*\n\nHello ${name}, you have active VIP subscription passes:\n\n`;
      
      const passes = vip.activePasses || [vip];
      passes.forEach((p, idx) => {
        const expiryDate = new Date(p.expiresAt).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });
        text += `*Pass #${idx + 1}: ${p.planName}*\n`;
        text += `• Unlocks: *${p.contentTitle || 'All Content'}*\n`;
        text += `• Valid Until: *${expiryDate}*\n`;
        text += `• Remaining: *${p.remainingText}*\n\n`;
      });

      text += `✨ Tap below to explore your unlocked drops! 🎬`;
      const currentCfg = typeof getConfig === 'function' ? getConfig() : readConfigFile();
      const buttons = [
        ...accessButtons(passes.some((p) => planUnlocksBot4(p)), currentCfg),
        [Markup.button.callback('🔄 Refresh Status', 'check_my_plan')]
      ];
      const keyboard = Markup.inlineKeyboard(buttons);
      const htmlText = formatTelegramHtml(text);
      try {
        return await ctx.reply(htmlText, { parse_mode: 'HTML', ...keyboard });
      } catch (_) {
        return await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      }
    } else {
      const text = `🔒 *VIP Status: INACTIVE*\n\nHey ${name}, you currently do not have an active VIP pass.\n\nSubscribe to a 6-Hour Today's Pass, Most Viewed Pass, or 1-Month All-Access Pass to unlock drops with zero limits!`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('💎 View Subscription Plans', 'open_vip_plans')]
      ]);
      const htmlText = formatTelegramHtml(text);
      try {
        return await ctx.reply(htmlText, { parse_mode: 'HTML', ...keyboard });
      } catch (_) {
        return await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      }
    }
  };

  bot.command('myplan', handleMyPlanCommand);
  bot.command('status', handleMyPlanCommand);
  bot.action('check_my_plan', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (_) {}
    await handleMyPlanCommand(ctx);
  });

  // 3. buy_plan_<planId> action: Sends Payment QR Code & Instructions
  bot.action(/^buy_plan_(.+)$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (_) {}
    await sendPlanQrAndInstructions(ctx, ctx.match[1], getConfig, formatTelegramHtml);
  });

  // 4. Buttons on older messages, and Bot 3's "which plan did you pay for?" prompt
  bot.action(/^submit_(?:utr|ss)_(.+)$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (_) {}
    const plan = (getConfig().subscriptions?.plans || []).find((p) => p.id === ctx.match[1]);
    if (!plan) return ctx.reply('❌ That plan is no longer available. Type /plans to restart.');
    const checkout = startCheckout(ctx, plan);
    const curr = getConfig().subscriptions?.currency || '₹';
    await ctx.reply(
      `📸 Send your payment screenshot or 12-digit UTR number here.\n\nPlan: ${plan.name} (${curr}${plan.price})\nOrder ref: ${checkout.orderRef}`
    );
  });

  // 5. Admin 1-Tap Approve / Reject
  bot.action(/^admin_(approve|reject)_(.+)$/, async (ctx) => {
    const [, action, paymentId] = ctx.match;
    if (!isAdmin(ctx, getConfig)) {
      return ctx.answerCbQuery('Only the VIP admin can do this.', { show_alert: true });
    }
    const adminName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Admin');
    try { await ctx.answerCbQuery(action === 'approve' ? 'Approving...' : 'Rejecting...'); } catch (_) {}

    const result = action === 'approve'
      ? await approveSubscriptionPayment(paymentId, adminName)
      : await rejectSubscriptionPayment(paymentId);

    try { await ctx.editMessageReplyMarkup(undefined); } catch (_) {}

    if (!result.success) return ctx.reply(`⚠️ ${result.error}`);
    const verdict = action === 'approve' ? '✅ Approved' : '❌ Rejected';
    const delivery = result.notified ? 'Member notified.' : '⚠️ Could not message the member.';
    await ctx.reply(`${verdict} ${result.payment.orderRef || paymentId} (${result.payment.username}) by ${adminName}. ${delivery}`);
  });

  // 6. /setadmin <ADMIN_PASSWORD>: Binds this Telegram account as VIP Admin
  bot.command('setadmin', async (ctx) => {
    const chatId = String(ctx.from.id);
    const password = (process.env.SETADMIN_CODE || process.env.ADMIN_PASSWORD || '').trim();
    const supplied = (ctx.message.text || '').split(/\s+/).slice(1).join(' ').trim();

    if (!isAdmin(ctx, getConfig) && !(password && supplied === password)) {
      return ctx.reply(
        `🔒 Your Telegram ID is ${chatId}.\n\nTo make it the VIP admin, either paste it into the dashboard (Subscriptions → Admin Chat ID), or send: /setadmin <setup code>`
      );
    }

    const config = readConfigFile();
    if (!config.subscriptions) config.subscriptions = {};
    config.subscriptions.adminChatId = chatId;
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      return ctx.reply(`⚠️ Could not save the admin ID: ${err.message}`);
    }
    // Remove the message that contains the password
    if (supplied) { try { await ctx.deleteMessage(); } catch (_) {} }

    return ctx.reply(
      `👑 You are now the VIP payment admin (ID ${chatId}).\n\nPayment alerts arrive from @${PAY_BOT_USERNAME}. Open it and press Start once so it can message you.`
    );
  });
}

function isAdmin(ctx, getConfig) {
  const adminId = String(getConfig().subscriptions?.adminChatId || '').trim();
  return !!adminId && [ctx.from?.id, ctx.chat?.id].some((id) => String(id) === adminId);
}

export function getFinalBotConfig(config = readConfigFile()) {
  const subCfg = config?.subscriptions || {};
  const b3Cfg = config?.bot3 || {};
  const fb = subCfg.finalBot || b3Cfg.finalBot || {};
  const bot4Username = config?.bot4?.username || 'avnifanbaseprembot';
  return {
    enabled: fb.enabled !== false,
    username: fb.username || bot4Username,
    url: fb.url || `https://t.me/${bot4Username}?start=vip`,
    buttonText: fb.buttonText || `👑 Access VIP Bot 4 (@${bot4Username})`,
    message: fb.message || '',
    shareBot1: fb.shareBot1 !== false,
    bot1ButtonText: fb.bot1ButtonText || '🎬 Open Bot 1 (@avniffanbasebot)',
    bot1Url: fb.bot1Url || 'https://t.me/avniffanbasebot'
  };
}

function accessButtons(includeBot4, config = readConfigFile()) {
  const fb = getFinalBotConfig(config);
  const rows = [];

  // Final Bot / Premium VIP Bot button
  if (includeBot4 && fb.enabled && fb.url) {
    let u = fb.url.trim();
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = `https://${u}`;
    rows.push([Markup.button.url(fb.buttonText || '👑 Access VIP Bot', u)]);
  }

  // Bot 1 Open button
  if (fb.shareBot1) {
    let b1Url = (fb.bot1Url || 'https://t.me/avniffanbasebot').trim();
    if (!b1Url.startsWith('http://') && !b1Url.startsWith('https://')) b1Url = `https://${b1Url}`;
    rows.push([Markup.button.url(fb.bot1ButtonText || '🎬 Open Bot 1 (@avniffanbasebot)', b1Url)]);
  }

  return rows;
}

// Try the bot the member paid in first, then the others, and stop at the first success.
async function notifyMember(payment, html, extra = {}) {
  const order = [payment.sourceBot, PAY_BOT_USERNAME, ...botRegistry.keys()];
  for (const username of new Set(order)) {
    const bot = botRegistry.get(username);
    if (!bot) continue;
    try {
      await bot.telegram.sendMessage(payment.userId, html, { parse_mode: 'HTML', ...extra });
      return true;
    } catch (_) {}
  }
  return false;
}

// One verification card for the admin, with everything needed to match the bank entry
async function notifyAdmin(payment, subCfg) {
  const adminChatId = subCfg.adminChatId;
  if (!adminChatId) {
    console.warn(`[Subscriptions] No Admin Chat ID set. Approve ${payment.orderRef} from the dashboard.`);
    return;
  }
  const curr = escapeHtml(subCfg.currency || '₹');
  const text = [
    `🚨 <b>Verify payment: ${curr}${escapeHtml(payment.price)}</b>`,
    '',
    `Member: ${escapeHtml(payment.username)} (<code>${escapeHtml(payment.userId)}</code>)`,
    `Plan: <b>${escapeHtml(payment.planName)}</b>`,
    `Unlocks: ${escapeHtml(payment.contentTitle)}`,
    `Order ref: <code>${escapeHtml(payment.orderRef)}</code>`,
    `UTR: <code>${escapeHtml(payment.txId)}</code>`,
    '',
    `Check your bank/UPI app for ${curr}${escapeHtml(payment.price)} before approving.`
  ].join('\n');
  const keyboard = Markup.inlineKeyboard([[
    Markup.button.callback('✅ Approve', `admin_approve_${payment.id}`),
    Markup.button.callback('❌ Reject', `admin_reject_${payment.id}`)
  ]]);
  const options = { parse_mode: 'HTML', ...keyboard };
  const screenshot = payment.screenshotPath ? path.join(ROOT, payment.screenshotPath) : null;

  for (const username of new Set([PAY_BOT_USERNAME, payment.sourceBot])) {
    const bot = botRegistry.get(username);
    if (!bot) continue;
    try {
      if (screenshot && fs.existsSync(screenshot)) {
        await bot.telegram.sendPhoto(adminChatId, { source: screenshot }, { caption: text, ...options });
      } else {
        await bot.telegram.sendMessage(adminChatId, text, options);
      }
      return;
    } catch (err) {
      console.warn(`[Subscriptions] Admin alert via @${username} failed:`, err.message);
    }
  }
}

// Shared path for UTR and screenshot proofs
async function submitPaymentProof(ctx, checkout, proof, getConfig) {
  const userId = String(ctx.from.id);
  userPaymentStates.delete(userId);

  const subCfg = getConfig().subscriptions || {};
  const data = getSubscriptionsData();
  const paymentEntry = {
    id: proof.id,
    userId,
    username: ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Member'),
    fullName: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
    orderRef: checkout.orderRef,
    sourceBot: checkout.sourceBot,
    planId: checkout.planId,
    planName: checkout.planName,
    price: checkout.price,
    durationHours: checkout.durationHours,
    linkedContent: checkout.linkedContent,
    contentTitle: checkout.contentTitle,
    txId: proof.txId || 'Screenshot Attached',
    screenshotPath: proof.screenshotPath || null,
    fileId: proof.fileId,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  data.pendingPayments.unshift(paymentEntry);
  if (!saveSubscriptionsData(data)) {
    await ctx.reply('⚠️ We could not save your request. Please send the proof again in a minute.');
    userPaymentStates.set(userId, checkout);
    return;
  }

  if (subCfg.autoApprove) {
    await approveSubscriptionPayment(paymentEntry.id, 'Auto-Approve Engine');
    return;
  }

  await ctx.reply(
    `⏳ <b>Payment proof received</b>\n\nOrder ref: <code>${paymentEntry.orderRef}</code>\nPlan: <b>${escapeHtml(paymentEntry.planName)}</b>\n\nAn admin is verifying it. You will get a message here as soon as it is approved.`,
    { parse_mode: 'HTML' }
  );
  await notifyAdmin(paymentEntry, subCfg);
}

const newPaymentId = () => `PAY_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// Process pending payment text submissions (UTR / TxID)
export async function handlePaymentTextSubmission(ctx, getConfig) {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  if (!userId) return false;

  const checkout = getOpenCheckout(userId);
  if (!checkout) return false;

  const text = (ctx.message?.text || '').trim();
  if (text.startsWith('/')) {
    userPaymentStates.delete(userId);
    return false;
  }

  const utr = text.replace(/[\s-]/g, '').toUpperCase();
  const digitCount = utr.replace(/\D/g, '').length;
  // Menu taps and chat messages are not a UTR: let the bot handle them normally.
  if (digitCount < 6) return false;
  if (!/^[A-Z0-9]{10,22}$/.test(utr) || digitCount < 8) {
    await ctx.reply('⚠️ That does not look like a UTR. Send the 12-digit number from your payment app, or a screenshot.');
    return true;
  }

  const data = getSubscriptionsData();
  const used = [...data.pendingPayments, ...data.paymentHistory]
    .some((p) => p.status !== 'rejected' && String(p.txId).toUpperCase() === utr);
  if (used) {
    await ctx.reply('⚠️ This UTR has already been submitted. Check /myplan, or send the UTR of your new payment.');
    return true;
  }

  await submitPaymentProof(ctx, checkout, { id: newPaymentId(), txId: utr }, getConfig);
  return true;
}

// Process pending payment screenshot submissions
export async function handlePaymentPhotoSubmission(ctx, getConfig) {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  if (!userId) return false;

  const checkout = getOpenCheckout(userId);
  const photos = ctx.message?.photo;
  if (!checkout || !photos || photos.length === 0) return false;

  // Claim the checkout before downloading so an album does not create several requests
  userPaymentStates.delete(userId);

  const id = newPaymentId();
  const fileId = photos[photos.length - 1].file_id;
  let screenshotPath = null;
  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(fileLink.href);
    if (!res.ok) throw new Error(`download failed with status ${res.status}`);
    const filename = `proof_${id}.jpg`;
    fs.writeFileSync(path.join(ROOT, 'assets', filename), Buffer.from(await res.arrayBuffer()));
    screenshotPath = path.posix.join('assets', filename);
  } catch (err) {
    console.warn('[Subscriptions] Could not download proof image:', err.message);
    userPaymentStates.set(userId, checkout);
    await ctx.reply('⚠️ We could not read that screenshot. Please send it again.');
    return true;
  }

  await submitPaymentProof(ctx, checkout, { id, screenshotPath, fileId }, getConfig);
  return true;
}

// Global Reusable Payment Approver
export async function approveSubscriptionPayment(paymentId, approverName = 'Admin Portal') {
  const data = getSubscriptionsData();
  const idx = data.pendingPayments.findIndex((p) => p.id === paymentId);
  if (idx === -1) return { success: false, error: 'Payment request not found or already processed' };

  const payment = data.pendingPayments[idx];
  data.pendingPayments.splice(idx, 1);

  const now = Date.now();
  const durationHours = Number(payment.durationHours) || 24;
  const linkedContent = payment.linkedContent || 'all';
  const contentTitle = payment.contentTitle || (linkedContent === 'all' ? 'All Content (Full VIP)' : 'Content Pass');

  const uSub = data.subscriptions[payment.userId] || {
    userId: payment.userId,
    username: payment.username,
    fullName: payment.fullName,
    contentPasses: {}
  };
  data.subscriptions[payment.userId] = uSub;
  if (!uSub.contentPasses) uSub.contentPasses = {};

  // Renewing early adds to the time already paid for
  const current = uSub.contentPasses[linkedContent];
  const startsAt = current?.expiresAt > now ? current.startsAt : now;
  const expiresAt = Math.max(current?.expiresAt || 0, now) + durationHours * 3600 * 1000;

  uSub.contentPasses[linkedContent] = {
    planId: payment.planId,
    planName: payment.planName,
    linkedContent,
    contentTitle,
    startsAt,
    expiresAt
  };

  if (linkedContent === 'all' || !uSub.expiresAt || expiresAt > uSub.expiresAt) {
    uSub.expiresAt = Math.max(uSub.expiresAt || 0, expiresAt);
    uSub.planId = payment.planId;
    uSub.planName = payment.planName;
    uSub.linkedContent = linkedContent;
    uSub.contentTitle = contentTitle;
    uSub.startsAt = startsAt;
  }
  Object.assign(uSub, {
    approvedAt: now,
    approvedBy: approverName,
    paymentId: payment.id,
    reminderSent: false,
    expiredSent: false
  });

  payment.status = 'approved';
  payment.approvedAt = new Date().toISOString();
  payment.approvedBy = approverName;
  data.paymentHistory.unshift(payment);
  if (!saveSubscriptionsData(data)) return { success: false, error: 'Could not save the subscription' };

  const config = readConfigFile();
  const fb = getFinalBotConfig(config);
  const expiryDate = new Date(expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  
  let html;
  if (fb.message && fb.message.trim()) {
    html = fb.message
      .replace(/{plan_name}/g, escapeHtml(payment.planName))
      .replace(/{content_title}/g, escapeHtml(contentTitle))
      .replace(/{duration}/g, formatDurationLabel(durationHours))
      .replace(/{expiry_date}/g, expiryDate)
      .replace(/{username}/g, escapeHtml(payment.username || 'VIP Member'))
      .replace(/{bot_name}/g, escapeHtml(fb.username || 'VIP Bot'));
  } else {
    html = [
      '🎉 <b>Payment approved. Your VIP access is active!</b>',
      '',
      `Plan: <b>${escapeHtml(payment.planName)}</b>`,
      `Unlocks: <b>${escapeHtml(contentTitle)}</b>`,
      `Added: <b>${formatDurationLabel(durationHours)}</b>`,
      `Valid until: <b>${expiryDate}</b>`
    ].join('\n');
  }

  const buttons = accessButtons(planUnlocksBot4(payment), config);
  const notified = await notifyMember(payment, html, Markup.inlineKeyboard(buttons));

  return { success: true, payment, expiresAt, notified };
}

// Global Reusable Payment Rejecter
export async function rejectSubscriptionPayment(paymentId, reason) {
  const data = getSubscriptionsData();
  const idx = data.pendingPayments.findIndex((p) => p.id === paymentId);
  if (idx === -1) return { success: false, error: 'Payment request not found or already processed' };

  const payment = data.pendingPayments[idx];
  data.pendingPayments.splice(idx, 1);

  payment.status = 'rejected';
  payment.rejectedAt = new Date().toISOString();
  payment.rejectReason = reason || 'Payment could not be verified on bank records';
  data.paymentHistory.unshift(payment);
  if (!saveSubscriptionsData(data)) return { success: false, error: 'Could not save the rejection' };

  const html = `❌ <b>Payment not verified</b>\n\nOrder ref: <code>${escapeHtml(payment.orderRef || payment.id)}</code>\nReason: ${escapeHtml(payment.rejectReason)}\n\nIf you did pay, contact support with this reference.`;
  const retry = Markup.inlineKeyboard([[Markup.button.callback('💎 Try Again', 'open_vip_plans')]]);
  const notified = await notifyMember(payment, html, retry);

  return { success: true, payment, notified };
}

// Setup Admin REST APIs for Subscriptions Management
export function setupSubscriptionApiRoutes(app, upload) {
  // 1. Get current subscriptions config
  app.get('/api/subscriptions/config', (req, res) => {
    try {
      const configPath = path.join(ROOT, 'config.json');
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      res.json(cfg.subscriptions || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Save subscriptions config & plans
  app.post('/api/subscriptions/config', (req, res) => {
    try {
      const configPath = path.join(ROOT, 'config.json');
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      cfg.subscriptions = req.body;
      if (req.body.finalBot) {
        if (!cfg.bot3) cfg.bot3 = {};
        cfg.bot3.finalBot = req.body.finalBot;
      }
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
      res.json({ success: true, message: 'Subscription configuration saved' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Upload custom payment QR code
  app.post('/api/subscriptions/upload-qr', upload.single('qr_image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No QR code image uploaded' });
    const relativePath = path.posix.join('assets', req.file.filename);
    res.json({ success: true, path: relativePath });
  });

  // 4. Get pending payments queue
  app.get('/api/subscriptions/pending', (req, res) => {
    try {
      const data = getSubscriptionsData();
      res.json(data.pendingPayments || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Approve pending payment
  app.post('/api/subscriptions/approve', async (req, res) => {
    try {
      const { paymentId } = req.body;
      if (!paymentId) return res.status(400).json({ error: 'paymentId required' });
      const result = await approveSubscriptionPayment(paymentId, 'Admin Portal');
      if (!result.success) return res.status(404).json({ error: result.error });
      res.json({ success: true, message: `Approved subscription for ${result.payment.username}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Reject pending payment
  app.post('/api/subscriptions/reject', async (req, res) => {
    try {
      const { paymentId, reason } = req.body;
      if (!paymentId) return res.status(400).json({ error: 'paymentId required' });
      const result = await rejectSubscriptionPayment(paymentId, reason);
      if (!result.success) return res.status(404).json({ error: result.error });
      res.json({ success: true, message: 'Payment rejected' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Get active subscribers
  app.get('/api/subscriptions/active', (req, res) => {
    try {
      const data = getSubscriptionsData();
      const list = [];
      const now = Date.now();

      for (const [uid, sub] of Object.entries(data.subscriptions)) {
        if (sub.expiresAt > now) {
          list.push({
            ...sub,
            remainingText: formatRemainingTime(sub.expiresAt),
            isActive: true
          });
        }
      }
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Revoke subscription
  app.post('/api/subscriptions/revoke', (req, res) => {
    try {
      const { userId } = req.body;
      const data = getSubscriptionsData();
      if (data.subscriptions[userId]) {
        delete data.subscriptions[userId];
        saveSubscriptionsData(data);
        res.json({ success: true, message: `Subscription revoked for user ${userId}` });
      } else {
        res.status(404).json({ error: 'Subscription not found' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Extend subscription (+X hours)
  app.post('/api/subscriptions/extend', (req, res) => {
    try {
      const { userId, hours = 24 } = req.body;
      const data = getSubscriptionsData();
      const sub = data.subscriptions[userId];
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });

      const addMs = Number(hours) * 3600 * 1000;
      if (!Number.isFinite(addMs) || addMs <= 0) return res.status(400).json({ error: 'hours must be a positive number' });
      const now = Date.now();
      const passes = Object.values(sub.contentPasses || {});
      const live = passes.filter((p) => p.expiresAt > now);
      // Extend what is active; if everything lapsed, revive the main pass
      (live.length ? live : passes.filter((p) => p.linkedContent === (sub.linkedContent || 'all')))
        .forEach((p) => { p.expiresAt = Math.max(p.expiresAt, now) + addMs; });
      sub.expiresAt = Math.max(sub.expiresAt || 0, now) + addMs;
      sub.reminderSent = false;
      sub.expiredSent = false;
      saveSubscriptionsData(data);
      res.json({ success: true, message: `Extended by ${hours} hours`, newExpiry: sub.expiresAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// Display Content-Specific Locked Paywall with deep-links to Payment Bot
export async function sendContentLockedPaywall(ctx, btn, contentType, getConfig, formatTelegramHtml) {
  const config = getConfig();
  const subCfg = config.subscriptions || {};
  const plans = subCfg.plans || [];
  const curr = subCfg.currency || '₹';
  const username = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'Friend');
  const contentTitle = btn.contentTitle || btn.text || 'Exclusive Content';

  // Find plans that unlock this specific content or All-Access plans
  const specificPlans = plans.filter((p) => p.linkedContent && p.linkedContent !== 'all' && planUnlocksContent(p.linkedContent, contentType, config));
  const allAccessPlans = plans.filter((p) => p.linkedContent === 'all' || !p.linkedContent);

  const eligiblePlans = (specificPlans.length > 0 || allAccessPlans.length > 0)
    ? [...specificPlans, ...allAccessPlans]
    : plans;

  let text = `🔒 *VIP Subscription Required: ${contentTitle}*\n\n`;
  text += `Hey ${username}! Content drops under *${contentTitle}* are exclusively reserved for active VIP members.\n\n`;
  text += `👇 *Choose a plan below to unlock instant access:*\n\n`;

  eligiblePlans.forEach((p, idx) => {
    const dur = formatDurationLabel(p.durationHours);
    const badge = p.badge ? ` [${p.badge}]` : '';
    const unlocks = (p.linkedContent || 'all') === 'all' ? '🌐 All Content & VIP Bot 4' : `🎯 ${p.contentTitle || contentTitle}`;
    text += `*${idx + 1}. ${p.name}*${badge}\n`;
    text += `• Price: *${curr}${p.price}* (${dur})\n`;
    text += `• Access: *${unlocks}*\n\n`;
  });

  text += `Tap a plan button below to open instant UPI checkout:`;

  const keyboardButtons = [];
  eligiblePlans.forEach((p) => {
    const dur = formatDurationLabel(p.durationHours);
    const label = `💳 ${p.name} — ${curr}${p.price} (${dur})`;
    keyboardButtons.push([
      Markup.button.url(label, `https://t.me/avnifanbasepaybot?start=plan_${p.id}`)
    ]);
  });

  keyboardButtons.push([
    Markup.button.url('✨ View All VIP Plans (@avnifanbasepaybot)', 'https://t.me/avnifanbasepaybot?start=plans')
  ]);

  const inlineKeyboard = Markup.inlineKeyboard(keyboardButtons);
  const htmlText = formatTelegramHtml(text);

  try {
    return await ctx.reply(htmlText, { parse_mode: 'HTML', ...inlineKeyboard });
  } catch (_) {
    return await ctx.reply(text, { parse_mode: 'Markdown', ...inlineKeyboard });
  }
}
