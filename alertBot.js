import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { ROOT, IS_TENANT, botUsername } from './tenant.js';
import {
  approveSubscriptionPayment,
  rejectSubscriptionPayment,
  getSubscriptionsData,
  formatDurationLabel,
  escapeHtml
} from './subscriptions.js';

let bot5Instance = null;
let currentGetConfig = null;
let currentSaveConfig = null;

export function normalizePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

export function isUserAuthorized(userId, config) {
  if (!userId) return false;
  const alertCfg = config?.alertBot || {};
  const admins = alertCfg.authorizedAdmins || [];
  if (admins.some((a) => String(a.userId) === String(userId) || String(a.chatId) === String(userId))) {
    return true;
  }
  if (alertCfg.adminChatId && String(alertCfg.adminChatId) === String(userId)) {
    return true;
  }
  if (config?.subscriptions?.adminChatId && String(config.subscriptions.adminChatId) === String(userId)) {
    return true;
  }
  return false;
}

export function isPhoneAuthorized(rawPhone, config) {
  if (!rawPhone) return false;
  const alertCfg = config?.alertBot || {};
  const allowed = (alertCfg.authorizedPhones || []).map(normalizePhoneNumber);
  const norm = normalizePhoneNumber(rawPhone);
  return allowed.includes(norm);
}

export function getAlertBotInstance() {
  return bot5Instance;
}

// ====================================================
// INITIALIZE BOT 5 (@botalertsafmbot)
// ====================================================
export function initAlertBot({
  token,
  telegrafOptions = {},
  getConfig,
  saveConfig,
  app,
  webhookDomain,
  secretPath,
  webhookSecret
}) {
  currentGetConfig = getConfig;
  currentSaveConfig = saveConfig;

  if (!token || token.trim() === '') {
    console.log('⏸️ Bot 5 (Alert Bot) skipped: No token provided.');
    return null;
  }

  const bot = new Telegraf(token, telegrafOptions);
  bot5Instance = bot;

  bot.botInfo = {
    id: parseInt(token.split(':')[0], 10),
    is_bot: true,
    first_name: 'Bot Alerts',
    username: 'botalertsafmbot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false
  };

  // Mount Webhook route on Express if webhookDomain is present
  if (webhookDomain && webhookDomain.trim() !== '' && app && secretPath) {
    app.use(bot.webhookCallback(secretPath, { secretToken: webhookSecret(token) }));
  }

  // ----------------------------------------------------
  // AUTHENTICATION & SPAM FILTER MIDDLEWARE
  // Strict rule: Only authorized numbers can access. Rest spam no reply.
  // ----------------------------------------------------
  bot.use(async (ctx, next) => {
    // 1. Handle Contact Message (Admin phone verification)
    if (ctx.message?.contact) {
      return handleContactVerification(ctx);
    }

    const userId = String(ctx.from?.id || '');
    const config = currentGetConfig ? currentGetConfig() : {};
    const authorized = isUserAuthorized(userId, config);

    if (!authorized) {
      // If unauthorized user typed /start, provide the phone verification button
      if (ctx.message?.text?.startsWith('/start')) {
        return handleUnverifiedStart(ctx);
      }

      // STRICT USER RULE: "Rest spam no reply."
      // Complete silence for any other messages, commands, or callbacks!
      return;
    }

    return next();
  });

  // ----------------------------------------------------
  // ADMIN COMMANDS & HANDLERS
  // ----------------------------------------------------
  bot.start(async (ctx) => {
    const config = currentGetConfig ? currentGetConfig() : {};
    const adminObj = (config.alertBot?.authorizedAdmins || []).find(
      (a) => String(a.userId) === String(ctx.from.id) || String(a.chatId) === String(ctx.from.id)
    );
    const adminName = adminObj?.name || ctx.from.first_name || 'Admin';
    const adminPhone = adminObj?.phone ? `📱 <code>${escapeHtml(adminObj.phone)}</code>\n` : '';

    const text = [
      `🛡️ <b>Admin Alert & Control Bot</b> (@botalertsafmbot)`,
      ``,
      `Hello <b>${escapeHtml(adminName)}</b>! You are verified as an authorized administrator.`,
      adminPhone ? adminPhone : '',
      `<b>⚡ Live Controls:</b>`,
      `• /pending - View pending payments awaiting verification`,
      `• /active - View currently active VIP members`,
      `• /stats - System revenue & membership overview`,
      `• /test - Send a test alert to verify delivery`,
      ``,
      `<i>You will automatically receive instant alerts with 1-click Approve/Reject buttons when users submit payment proofs.</i>`
    ].filter(Boolean).join('\n');

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⏳ Pending Payments', 'cmd_pending'), Markup.button.callback('👑 Active VIPs', 'cmd_active')],
      [Markup.button.callback('📊 System Stats', 'cmd_stats'), Markup.button.callback('🔔 Test Alert', 'cmd_test')]
    ]);

    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  });

  bot.command('pending', async (ctx) => {
    await sendPendingPaymentsList(ctx);
  });
  bot.action('cmd_pending', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (_) {}
    await sendPendingPaymentsList(ctx);
  });

  bot.command('active', async (ctx) => {
    await sendActiveVipsList(ctx);
  });
  bot.action('cmd_active', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (_) {}
    await sendActiveVipsList(ctx);
  });

  bot.command('stats', async (ctx) => {
    await sendSystemStats(ctx);
  });
  bot.action('cmd_stats', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (_) {}
    await sendSystemStats(ctx);
  });

  bot.command('test', async (ctx) => {
    await ctx.reply('🔔 <b>Test Alert Received!</b>\n\nYour alert bot connection is fully functional and ready to deliver real-time notifications.', { parse_mode: 'HTML' });
  });
  bot.action('cmd_test', async (ctx) => {
    try { await ctx.answerCbQuery('Delivering test alert...'); } catch (_) {}
    await ctx.reply('🔔 <b>Test Alert Received!</b>\n\nYour alert bot connection is fully functional and ready to deliver real-time notifications.', { parse_mode: 'HTML' });
  });

  // ----------------------------------------------------
  // 1-TAP INLINE APPROVE / REJECT CALLBACKS
  // ----------------------------------------------------
  bot.action(/^alert_(approve|reject)_(.+)$/, async (ctx) => {
    const [, action, paymentId] = ctx.match;
    const config = currentGetConfig ? currentGetConfig() : {};
    if (!isUserAuthorized(ctx.from?.id, config)) {
      return ctx.answerCbQuery('🔒 Unauthorized admin.', { show_alert: true });
    }

    const adminName = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || 'Admin');
    try { await ctx.answerCbQuery(action === 'approve' ? 'Approving payment...' : 'Rejecting payment...'); } catch (_) {}

    if (action === 'approve') {
      const result = await approveSubscriptionPayment(paymentId, `Admin (${adminName})`);
      if (!result.success) {
        return ctx.reply(`⚠️ Could not approve: ${result.error}`);
      }

      const p = result.payment;
      const expiry = new Date(result.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      const text = [
        `✅ <b>PAYMENT APPROVED</b>`,
        ``,
        `🔖 Order Ref: <code>${escapeHtml(p.orderRef)}</code>`,
        `📦 Plan: <b>${escapeHtml(p.planName)}</b> (₹${escapeHtml(p.price)})`,
        `👤 Member: <b>${escapeHtml(p.fullName || p.username)}</b> ${p.username ? `(@${escapeHtml(p.username)})` : ''}`,
        `🆔 User ID: <code>${escapeHtml(p.userId)}</code>`,
        `📅 Valid Until: <b>${expiry}</b>`,
        `👑 Approved By: <b>${escapeHtml(adminName)}</b>`,
        `⏱️ Time: ${new Date().toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`,
        ``,
        `🎉 <i>VIP pass activated and member has been notified!</i>`
      ].join('\n');

      try {
        if (ctx.callbackQuery.message.caption) {
          await ctx.editMessageCaption(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
        } else {
          await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
        }
      } catch (err) {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    } else {
      const result = await rejectSubscriptionPayment(paymentId, `Rejected by ${adminName} via Alert Bot`);
      if (!result.success) {
        return ctx.reply(`⚠️ Could not reject: ${result.error}`);
      }

      const p = result.payment;
      const text = [
        `❌ <b>PAYMENT REJECTED</b>`,
        ``,
        `🔖 Order Ref: <code>${escapeHtml(p.orderRef)}</code>`,
        `📦 Plan: <b>${escapeHtml(p.planName)}</b> (₹${escapeHtml(p.price)})`,
        `👤 Member: <b>${escapeHtml(p.fullName || p.username)}</b> ${p.username ? `(@${escapeHtml(p.username)})` : ''}`,
        `🆔 User ID: <code>${escapeHtml(p.userId)}</code>`,
        `👑 Rejected By: <b>${escapeHtml(adminName)}</b>`,
        `⏱️ Time: ${new Date().toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`
      ].join('\n');

      try {
        if (ctx.callbackQuery.message.caption) {
          await ctx.editMessageCaption(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
        } else {
          await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
        }
      } catch (err) {
        await ctx.reply(text, { parse_mode: 'HTML' });
      }
    }
  });

  return bot;
}

// ----------------------------------------------------
// CONTACT VERIFICATION LOGIC
// ----------------------------------------------------
async function handleContactVerification(ctx) {
  const contact = ctx.message.contact;
  const senderId = String(ctx.from?.id);
  const contactUserId = contact.user_id ? String(contact.user_id) : null;

  // Security: contact must belong to sender
  if (contactUserId && contactUserId !== senderId) {
    return; // Ignore foreign contact
  }

  const rawPhone = contact.phone_number || '';
  const config = currentGetConfig ? currentGetConfig() : {};

  if (!isPhoneAuthorized(rawPhone, config)) {
    // Unauthorized number: Strict rule "Rest spam no reply."
    return;
  }

  // Valid Admin Phone Number!
  if (!config.alertBot) config.alertBot = {};
  if (!config.alertBot.authorizedAdmins) config.alertBot.authorizedAdmins = [];

  const existingIdx = config.alertBot.authorizedAdmins.findIndex(
    (a) => String(a.userId) === senderId || String(a.chatId) === senderId
  );

  const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';
  const adminObj = {
    userId: senderId,
    chatId: String(ctx.chat.id),
    phone: rawPhone,
    name: adminName,
    username: ctx.from.username ? `@${ctx.from.username}` : '',
    verifiedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    config.alertBot.authorizedAdmins[existingIdx] = adminObj;
  } else {
    config.alertBot.authorizedAdmins.push(adminObj);
  }

  if (currentSaveConfig) currentSaveConfig(config);

  await ctx.reply(
    `✅ <b>Admin Verification Successful!</b>\n\nWelcome <b>${escapeHtml(adminName)}</b>!\nYour phone number <code>${escapeHtml(rawPhone)}</code> is verified.\n\nYou have full admin access. You will receive real-time notifications for user joins, purchase checkouts, and payment verification requests with 1-click Approve/Reject buttons.\n\nType /start or /pending anytime to manage VIP requests.`,
    {
      parse_mode: 'HTML',
      ...Markup.removeKeyboard()
    }
  );
}

// Unverified /start handler
async function handleUnverifiedStart(ctx) {
  await ctx.reply(
    `🔒 <b>Admin Access Restricted</b>\n\nThis bot is strictly reserved for authorized administrators.\nTap the button below to verify your phone number:`,
    {
      parse_mode: 'HTML',
      ...Markup.keyboard([[Markup.button.contactRequest('📱 Verify Admin Access (Share Phone Number)')]])
        .resize()
        .oneTime()
    }
  );
}

// ----------------------------------------------------
// SEND PENDING PAYMENTS LIST WITH APPROVE/REJECT BUTTONS
// ----------------------------------------------------
async function sendPendingPaymentsList(ctx) {
  const data = getSubscriptionsData();
  const pending = data.pendingPayments || [];

  if (pending.length === 0) {
    return ctx.reply('✅ <b>No Pending Payments!</b>\n\nAll submitted payment proofs have been verified and processed.', { parse_mode: 'HTML' });
  }

  await ctx.reply(`📋 <b>Pending Payment Requests (${pending.length}):</b>`, { parse_mode: 'HTML' });

  for (const p of pending) {
    const text = [
      `🚨 <b>Pending Payment Verification</b>`,
      ``,
      `🔖 Order Ref: <code>${escapeHtml(p.orderRef)}</code>`,
      `📦 Plan: <b>${escapeHtml(p.planName)}</b> (₹${escapeHtml(p.price)})`,
      `⏳ Duration: <b>${p.durationHours} hours</b>`,
      `🔓 Unlocks: <b>${escapeHtml(p.contentTitle)}</b>`,
      `👤 Member: <b>${escapeHtml(p.fullName || p.username)}</b> ${p.username ? `(@${escapeHtml(p.username)})` : ''}`,
      `🆔 User ID: <code>${escapeHtml(p.userId)}</code>`,
      `💳 UTR / Tx ID: <code>${escapeHtml(p.txId)}</code>`,
      `⏱️ Submitted: ${new Date(p.createdAt).toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve Payment', `alert_approve_${p.id}`),
        Markup.button.callback('❌ Reject Payment', `alert_reject_${p.id}`)
      ]
    ]);

    const screenshot = p.screenshotPath ? path.join(ROOT, p.screenshotPath) : null;
    if (screenshot && fs.existsSync(screenshot)) {
      try {
        await ctx.replyWithPhoto({ source: screenshot }, { caption: text, parse_mode: 'HTML', ...keyboard });
        continue;
      } catch (_) {}
    }

    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

// ----------------------------------------------------
// ACTIVE VIPS LIST
// ----------------------------------------------------
async function sendActiveVipsList(ctx) {
  const data = getSubscriptionsData();
  const subs = Object.values(data.subscriptions || {});
  const now = Date.now();
  const active = subs.filter((s) => (s.expiresAt || 0) > now);

  if (active.length === 0) {
    return ctx.reply('ℹ️ No active VIP members at the moment.', { parse_mode: 'HTML' });
  }

  const lines = [
    `👑 <b>Active VIP Subscriptions (${active.length}):</b>`,
    ``
  ];

  active.slice(0, 20).forEach((s, idx) => {
    const expiry = new Date(s.expiresAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
    lines.push(
      `${idx + 1}. <b>${escapeHtml(s.fullName || s.username || 'User')}</b> ${s.username ? `(@${escapeHtml(s.username)})` : ''}\n` +
      `   • Plan: ${escapeHtml(s.planName || 'VIP')} | Valid until: ${expiry}`
    );
  });

  if (active.length > 20) {
    lines.push(``, `<i>...and ${active.length - 20} more active members.</i>`);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

// ----------------------------------------------------
// SYSTEM STATS
// ----------------------------------------------------
async function sendSystemStats(ctx) {
  const data = getSubscriptionsData();
  const subs = Object.values(data.subscriptions || {});
  const now = Date.now();
  const activeCount = subs.filter((s) => (s.expiresAt || 0) > now).length;
  const pendingCount = (data.pendingPayments || []).length;
  const history = data.paymentHistory || [];
  const approvedCount = history.filter((p) => p.status === 'approved').length;
  const totalRevenue = history
    .filter((p) => p.status === 'approved')
    .reduce((sum, p) => sum + (Number(p.price) || 0), 0);

  const text = [
    `📊 <b>VIP System Statistics:</b>`,
    ``,
    `👑 <b>Active VIP Passes:</b> ${activeCount}`,
    `⏳ <b>Pending Verifications:</b> ${pendingCount}`,
    `✅ <b>Total Approved Payments:</b> ${approvedCount}`,
    `💰 <b>Total Revenue:</b> ₹${totalRevenue.toLocaleString()}`,
    ``,
    `🛡️ <b>Alert Bot:</b> @botalertsafmbot (Online & Protecting)`
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'HTML' });
}

// ====================================================
// CORE DISPATCHER: SEND REAL-TIME ADMIN ALERT
// ====================================================
export async function sendAdminAlert(eventType, payload, extra = {}) {
  const config = currentGetConfig ? currentGetConfig() : {};
  const alertCfg = config?.alertBot || {};

  if (alertCfg.enabled === false) return;
  if (!bot5Instance) return;

  const notifSettings = alertCfg.notifications || {};
  // Check if this specific event notification is enabled
  const eventKeyMap = {
    user_join: 'userJoins',
    purchase_attempt: 'purchaseAttempts',
    payment_proof: 'paymentProofs',
    payment_approved: 'paymentApprovals',
    payment_rejected: 'paymentRejections',
    subscription_expiring: 'expiryAlerts',
    subscription_expired: 'expiryAlerts'
  };

  const configKey = eventKeyMap[eventType] || eventType;
  if (notifSettings[configKey] === false) return;

  const admins = alertCfg.authorizedAdmins || [];
  const adminChatIds = [...new Set([
    ...admins.map((a) => a.chatId || a.userId).filter(Boolean),
    alertCfg.adminChatId,
    config?.subscriptions?.adminChatId
  ].map(String).filter(Boolean))];

  if (adminChatIds.length === 0) return;

  let text = '';
  let keyboard = null;
  let screenshotPath = null;

  const curr = config?.subscriptions?.currency || '₹';

  switch (eventType) {
    case 'user_join': {
      const u = payload.user || {};
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username || 'User';
      text = [
        `👤 <b>New User Join Alert</b>`,
        ``,
        `🤖 Bot: <b>${escapeHtml(payload.botLabel || 'Telegram Bot')}</b>`,
        `👤 User: <b>${escapeHtml(fullName)}</b> ${u.username ? `(@${escapeHtml(u.username)})` : ''}`,
        `🆔 User ID: <code>${escapeHtml(u.id)}</code>`,
        `⏱️ Time: ${new Date().toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`
      ].join('\n');
      break;
    }

    case 'purchase_attempt': {
      const u = payload.user || {};
      const fullName = payload.fullName || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username || payload.username || 'User';
      const uname = payload.username || u.username || '';
      const uid = payload.userId || u.id || '';
      const planName = payload.planName || payload.plan?.name || 'VIP Plan';
      const price = payload.price || payload.plan?.price || 0;
      const durationHours = payload.durationHours || payload.plan?.durationHours || 0;

      text = [
        `🛒 <b>VIP Purchase Attempt Started</b>`,
        ``,
        `👤 User: <b>${escapeHtml(fullName)}</b> ${uname ? `(@${escapeHtml(uname)})` : ''}`,
        `🆔 User ID: <code>${escapeHtml(uid)}</code>`,
        `📦 Plan: <b>${escapeHtml(planName)}</b> (${curr}${escapeHtml(price)})`,
        `⏳ Duration: <b>${formatDurationLabel(durationHours)}</b>`,
        `🔖 Order Ref: <code>${escapeHtml(payload.orderRef || 'N/A')}</code>`,
        `🤖 Source: @${escapeHtml(payload.sourceBot || 'avnifanbasepaybot')}`,
        `⏱️ Time: ${new Date().toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`
      ].join('\n');
      break;
    }

    case 'payment_proof': {
      text = [
        `🚨 <b>New Payment Verification Request</b>`,
        ``,
        `🔖 <b>Order Ref:</b> <code>${escapeHtml(payload.orderRef)}</code>`,
        `📦 <b>Plan:</b> <b>${escapeHtml(payload.planName)}</b> (${curr}${escapeHtml(payload.price)})`,
        `⏳ <b>Duration:</b> <b>${formatDurationLabel(payload.durationHours)}</b>`,
        `🔓 <b>Unlocks:</b> <b>${escapeHtml(payload.contentTitle)}</b>`,
        `👤 <b>Member:</b> <b>${escapeHtml(payload.fullName || payload.username)}</b> ${payload.username ? `(@${escapeHtml(payload.username)})` : ''}`,
        `🆔 <b>User ID:</b> <code>${escapeHtml(payload.userId)}</code>`,
        `💳 <b>UTR / Tx ID:</b> <code>${escapeHtml(payload.txId)}</code>`,
        `🤖 <b>Source Bot:</b> @${escapeHtml(payload.sourceBot || 'avniffanbasebot')}`,
        `⏱️ <b>Time:</b> ${new Date(payload.createdAt || Date.now()).toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`,
        ``,
        `<i>👇 Check your UPI app for ${curr}${escapeHtml(payload.price)} and tap Approve or Reject below:</i>`
      ].join('\n');

      keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Approve Payment', `alert_approve_${payload.id}`),
          Markup.button.callback('❌ Reject Payment', `alert_reject_${payload.id}`)
        ]
      ]);

      if (payload.screenshotPath) {
        screenshotPath = path.join(ROOT, payload.screenshotPath);
      }
      break;
    }

    case 'payment_approved': {
      const p = payload.payment || {};
      text = [
        `🎉 <b>VIP Account Activated!</b>`,
        ``,
        `👤 Member: <b>${escapeHtml(p.fullName || p.username || 'Member')}</b> ${p.username ? `(@${escapeHtml(p.username)})` : ''}`,
        `🆔 User ID: <code>${escapeHtml(p.userId)}</code>`,
        `📦 Plan: <b>${escapeHtml(p.planName)}</b> (${curr}${escapeHtml(p.price)})`,
        `⏳ Duration: <b>${formatDurationLabel(p.durationHours)}</b>`,
        `📅 Valid Until: <b>${new Date(payload.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</b>`,
        `👑 Approved By: <b>${escapeHtml(payload.approvedBy || 'Admin')}</b>`,
        `⏱️ Time: ${new Date().toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`
      ].join('\n');
      break;
    }

    case 'payment_rejected': {
      const p = payload.payment || {};
      text = [
        `❌ <b>Payment Request Rejected</b>`,
        ``,
        `👤 Member: <b>${escapeHtml(p.fullName || p.username || 'Member')}</b> ${p.username ? `(@${escapeHtml(p.username)})` : ''}`,
        `🆔 User ID: <code>${escapeHtml(p.userId)}</code>`,
        `📦 Plan: <b>${escapeHtml(p.planName)}</b> (${curr}${escapeHtml(p.price)})`,
        `🔖 Order Ref: <code>${escapeHtml(p.orderRef)}</code>`,
        `📝 Reason: <i>${escapeHtml(payload.reason || 'Verification Failed')}</i>`,
        `⏱️ Time: ${new Date().toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' })}`
      ].join('\n');
      break;
    }

    default:
      text = `🔔 <b>Alert:</b> ${escapeHtml(JSON.stringify(payload))}`;
  }

  const options = { parse_mode: 'HTML', ...(keyboard || {}) };

  for (const chatId of adminChatIds) {
    try {
      if (screenshotPath && fs.existsSync(screenshotPath)) {
        await bot5Instance.telegram.sendPhoto(chatId, { source: screenshotPath }, { caption: text, ...options });
      } else {
        await bot5Instance.telegram.sendMessage(chatId, text, options);
      }
    } catch (err) {
      console.warn(`[AlertBot] Could not deliver alert to admin ${chatId}:`, err.message);
    }
  }
}

// ====================================================
// REST API ROUTES FOR PORTAL MANAGEMENT
// ====================================================
export function setupAlertBotApiRoutes(app, getConfig, saveConfig) {
  // Get Alert Bot Config
  app.get('/api/alertbot/config', (req, res) => {
    const cfg = getConfig();
    res.json(cfg.alertBot || {});
  });

  // Save Alert Bot Config
  app.post('/api/alertbot/config', (req, res) => {
    const cfg = getConfig();
    const update = req.body || {};
    cfg.alertBot = {
      ...cfg.alertBot,
      ...update
    };
    saveConfig(cfg);
    res.json({ success: true, alertBot: cfg.alertBot });
  });

  // Manually Add Admin User ID
  app.post('/api/alertbot/add-admin', (req, res) => {
    const { userId, phone, name } = req.body;
    if (!userId) return res.status(400).json({ success: false, error: 'Telegram User ID is required' });

    const cfg = getConfig();
    if (!cfg.alertBot) cfg.alertBot = {};
    if (!cfg.alertBot.authorizedAdmins) cfg.alertBot.authorizedAdmins = [];

    const existingIdx = cfg.alertBot.authorizedAdmins.findIndex((a) => String(a.userId) === String(userId));
    const adminObj = {
      userId: String(userId),
      chatId: String(userId),
      phone: phone || '',
      name: name || 'Admin',
      role: 'Admin',
      verifiedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      cfg.alertBot.authorizedAdmins[existingIdx] = adminObj;
    } else {
      cfg.alertBot.authorizedAdmins.push(adminObj);
    }

    saveConfig(cfg);
    res.json({ success: true, admin: adminObj, authorizedAdmins: cfg.alertBot.authorizedAdmins });
  });

  // Remove Admin User ID
  app.post('/api/alertbot/remove-admin', (req, res) => {
    const { userId } = req.body;
    const cfg = getConfig();
    if (!cfg.alertBot || !cfg.alertBot.authorizedAdmins) {
      return res.json({ success: true });
    }

    cfg.alertBot.authorizedAdmins = cfg.alertBot.authorizedAdmins.filter(
      (a) => String(a.userId) !== String(userId) && String(a.chatId) !== String(userId)
    );
    saveConfig(cfg);
    res.json({ success: true, authorizedAdmins: cfg.alertBot.authorizedAdmins });
  });

  // Test Alert Dispatcher
  app.post('/api/alertbot/test', async (req, res) => {
    try {
      await sendAdminAlert('user_join', {
        botLabel: 'Admin Test Console',
        user: { id: 'TEST_ADMIN', first_name: 'Test Alert Verification', username: 'alertbot' }
      });
      res.json({ success: true, message: 'Test alert dispatched to all authorized admins' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
