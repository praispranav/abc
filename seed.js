import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🌱 Starting Production Database & Config Seeding...\n');

// 1. Ensure directories exist
const dataDir = path.join(__dirname, 'data');
const assetsDir = path.join(__dirname, 'assets');
const logsDir = path.join(__dirname, 'logs');

[dataDir, assetsDir, logsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${path.relative(__dirname, dir)}/`);
  }
});

// 2. Seed Subscriptions Database (data/subscriptions.json)
const subDbPath = path.join(dataDir, 'subscriptions.json');
const subBackupPath = path.join(dataDir, 'subscriptions.backup.json');

let existingSubs = null;
if (fs.existsSync(subDbPath)) {
  try {
    existingSubs = JSON.parse(fs.readFileSync(subDbPath, 'utf8'));
  } catch (_) {}
}

const initialSubs = existingSubs || {
  subscriptions: {},
  pendingPayments: [],
  paymentHistory: [],
  savedContent: {}
};

// Ensure all schema keys exist
if (!initialSubs.subscriptions) initialSubs.subscriptions = {};
if (!initialSubs.pendingPayments) initialSubs.pendingPayments = [];
if (!initialSubs.paymentHistory) initialSubs.paymentHistory = [];
if (!initialSubs.savedContent) initialSubs.savedContent = {};

fs.writeFileSync(subDbPath, JSON.stringify(initialSubs, null, 2), 'utf8');
fs.writeFileSync(subBackupPath, JSON.stringify(initialSubs, null, 2), 'utf8');
console.log(`✅ Seeded Subscriptions DB: data/subscriptions.json (${Object.keys(initialSubs.subscriptions).length} subscribers, ${initialSubs.pendingPayments.length} pending, ${initialSubs.paymentHistory.length} history)`);

// 3. Seed Main Configuration Database (config.json)
const configPath = path.join(__dirname, 'config.json');
let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (_) {}
}

// Bot 1 Defaults
if (!config.bot1) config.bot1 = {};
config.bot1.bot_name = config.bot1.bot_name || 'Avni FanBase';

// Bot 1 Welcome
if (!config.bot1.welcome) config.bot1.welcome = {};
config.bot1.welcome.enabled = true;
config.bot1.welcome.useImage = true;
config.bot1.welcome.imagePath = config.bot1.welcome.imagePath || 'assets/welcome.jpg';
config.bot1.welcome.message = config.bot1.welcome.message || [
  'NICE TO MEET YOU <a href="tg://user?id={user_id}">{name}</a>\n',
  '<blockquote><b>DID YOU JOIN??</b></blockquote>',
  '✧ The {bot_name} Alerts Channel And Send A Join Request To The Backup Channel??\n',
  '<blockquote>If Not, Send It Now, As All Upcoming Fresh Content And Announcements Will Be Shared There</blockquote>\n',
  '<a href="{terms_url}">«Terms & Policy»</a>\n',
  '<b>WELCOME TO {bot_name_upper} BOT</b>'
].join('\n');

config.bot1.welcome.buttons = [
  { id: 'btn_1', text: '📢 Alerts Channel', type: 'url', url: 'https://t.me/avniffanbasebot' },
  { id: 'btn_2', text: '🔒 Backup Channel', type: 'url', url: 'https://t.me/+Gn_BIdByihZhZmI1' },
  { id: 'btn_3', text: '≼ Terms & Policy ≽', type: 'terms', url: '' }
];

config.bot1.welcome.bottomButtons = [
  { id: 'bbtn_today', text: "✨ Today's Content", type: 'today', fullWidth: true },
  { id: 'bbtn_1', text: '🔥 Most Viewed', type: 'list', listId: 'list_1795573154998', fullWidth: false },
  { id: 'bbtn_2', text: '⭐ Button 2', type: 'list', listId: 'list_btn2', fullWidth: false, accessType: 'locked', planId: 'plan_1w' }
];

// Backup Channel Gate
if (!config.bot1.backupChannel) config.bot1.backupChannel = {};
config.bot1.backupChannel.enabled = true;
config.bot1.backupChannel.channelId = config.bot1.backupChannel.channelId || '@Avniffanbasebot';
config.bot1.backupChannel.handle = config.bot1.backupChannel.handle || '@Avniffanbasebot';
config.bot1.backupChannel.channelTitle = config.bot1.backupChannel.channelTitle || 'Avni FanBase Backup';
config.bot1.backupChannel.inviteLink = config.bot1.backupChannel.inviteLink || 'https://t.me/+Gn_BIdByihZhZmI1';
config.bot1.backupChannel.restrictedMessage = config.bot1.backupChannel.restrictedMessage || [
  '⛔ <b>ACCESS RESTRICTED!</b>\n',
  'Hey {username}! You must be an active member of our official <b>Backup Channel</b> to use this bot and access content drops.\n',
  '⚠️ <i>If you leave the backup channel, your bot access is immediately restricted!</i>\n',
  '👇 Please join our backup channel below, then tap <b>"🔄 Verify Membership"</b> to continue:'
].join('\n');

// Seed Today Drops
if (!config.bot1.today) config.bot1.today = {};
if (!config.bot1.today.messages || config.bot1.today.messages.length === 0) {
  config.bot1.today.messages = [
    {
      id: 'today_msg_1',
      title: 'Wah',
      episode: 25406,
      views: '1M',
      description: '@Avniffanbasebot',
      status: 'active',
      viewButtonText: '👁️ View Content',
      preview: {
        message: '━━━━━━━ ༄ᶦᶰᵈ᭄{bot_name}࿐ ━━━━━━━\n:- Description : {description}\n\n{title}\n:- episode : {episode} <::> {views}\n━━━━━━━ ༄ᶦᶰᵈ᭄BOTLink࿐ ━━━━━━━\n<blockquote>{bot_link}</blockquote>',
        mediaType: 'none',
        mediaPath: '',
        type: 'permanent',
        timer: { enabled: false, seconds: 60 }
      },
      revealedContent: {
        message: '━━━━━━━ ༄ᶦᶰᵈ᭄{bot_name}࿐ ━━━━━━━\n:- Description : {description}\n\n{title}\n:- episode : {episode} <::> {views}\n━━━━━━━ ༄ᶦᶰᵈ᭄Exclusive Video࿐ ━━━━━━━\n<blockquote>🎬 Unlocked Video Drop</blockquote>',
        mediaType: 'none',
        mediaPath: '',
        type: 'temporary',
        timer: { enabled: true, seconds: 120 }
      }
    },
    {
      id: 'today_msg_2',
      title: 'Summer Special Premiere',
      episode: 25407,
      views: '850K',
      description: '@Avniffanbasebot',
      status: 'active',
      viewButtonText: '👁️ View Content',
      preview: {
        message: '━━━━━━━ ༄ᶦᶰᵈ᭄{bot_name}࿐ ━━━━━━━\n:- Description : {description}\n\n{title}\n:- episode : {episode} <::> {views}\n━━━━━━━ ༄ᶦᶰᵈ᭄BOTLink࿐ ━━━━━━━\n<blockquote>{bot_link}</blockquote>',
        mediaType: 'none',
        mediaPath: '',
        type: 'permanent',
        timer: { enabled: false, seconds: 60 }
      },
      revealedContent: {
        message: '━━━━━━━ ༄ᶦᶰᵈ᭄{bot_name}࿐ ━━━━━━━\n:- Description : {description}\n\n{title}\n:- episode : {episode} <::> {views}\n━━━━━━━ ༄ᶦᶰᵈ᭄Exclusive Video࿐ ━━━━━━━\n<blockquote>🎬 Unlocked Video Drop</blockquote>',
        mediaType: 'none',
        mediaPath: '',
        type: 'temporary',
        timer: { enabled: true, seconds: 120 }
      }
    }
  ];
}

// Seed Free Drops
if (!config.bot1.free) config.bot1.free = {};
if (!config.bot1.free.messages || config.bot1.free.messages.length === 0) {
  config.bot1.free.messages = [
    {
      id: 'free_msg_1',
      title: 'Exclusive Community Teaser',
      episode: 25408,
      views: '1.2M',
      description: '@Avniffanbasebot',
      status: 'active',
      viewButtonText: '👁️ View Content',
      preview: {
        message: '━━━━━━━ ༄ᶦᶰᵈ᭄{bot_name}࿐ ━━━━━━━\n:- Description : {description}\n\n{title}\n:- episode : {episode} <::> {views}\n━━━━━━━ ༄ᶦᶰᵈ᭄BOTLink࿐ ━━━━━━━\n<blockquote>{bot_link}</blockquote>',
        mediaType: 'none',
        mediaPath: '',
        type: 'permanent',
        timer: { enabled: false, seconds: 60 }
      },
      revealedContent: {
        message: '━━━━━━━ ༄ᶦᶰᵈ᭄{bot_name}࿐ ━━━━━━━\n:- Description : {description}\n\n{title}\n:- episode : {episode} <::> {views}\n━━━━━━━ ༄ᶦᶰᵈ᭄Exclusive Video࿐ ━━━━━━━\n<blockquote>🎬 Unlocked Video Drop</blockquote>',
        mediaType: 'none',
        mediaPath: '',
        type: 'temporary',
        timer: { enabled: true, seconds: 120 }
      }
    }
  ];
}

// Bot 2 Defaults
if (!config.bot2) config.bot2 = {};
config.bot2.bot_name = config.bot2.bot_name || 'Avni Fanbase Demo';
config.bot2.deliveryMode = 'rotate';
config.bot2.defaultTimer = {
  enabled: true,
  seconds: 60,
  preset: '1min',
  warningMessage: '⏳ *Auto-Delete Warning*: This video will be deleted in {timer_text}!'
};

// Subscriptions & Plans
if (!config.subscriptions) config.subscriptions = {};
config.subscriptions.enabled = true;
config.subscriptions.currency = '₹';
config.subscriptions.merchantName = 'Avni FanBase VIP';
config.subscriptions.upiId = config.subscriptions.upiId || 'avnifanbase@upi';
config.subscriptions.adminChatId = '5459778091';
config.subscriptions.onExpireAutoDeleteSeconds = 21600; // 6 hours

config.subscriptions.plans = [
  {
    id: 'plan_6h',
    name: '⚡ 6 Hours Flash VIP',
    price: 11,
    durationHours: 6,
    badge: 'Popular',
    description: 'Instant 6-hour unlimited access to all exclusive content drops.'
  },
  {
    id: 'plan_1w',
    name: '🌟 1 Week Full VIP',
    price: 99,
    durationHours: 168,
    badge: 'HOT',
    description: '7-day full access pass for all active drops with zero limits.'
  },
  {
    id: 'plan_1m',
    name: '👑 1 Month VIP Pass',
    price: 299,
    durationHours: 720,
    badge: 'VIP Club',
    description: 'Full 30-day VIP pass with unlimited streaming & downloads.'
  }
];

// FinalBot Settings (Premium Service Confirmation)
config.subscriptions.finalBot = {
  enabled: true,
  username: 'avniffanbasebot',
  url: 'https://t.me/avniffanbasebot',
  buttonText: '👑 Access Premium Service (@avniffanbasebot)',
  message: [
    '🎉 <b>Payment Approved! Your VIP Access is Active</b> 👑\n',
    'Hello <b>{username}</b>! Your payment for <b>{plan_name}</b> has been verified and approved.\n',
    '✨ <b>Unlocked:</b> {content_title}',
    '⏳ <b>Duration:</b> {duration}',
    '📅 <b>Valid Until:</b> {expiry_date}\n',
    '🚀 <b>You can now access the Premium VIP service!</b>',
    'All exclusive content drops and VIP features are now unlocked for your account.\n',
    '👇 <b>Tap below to access your Premium Service:</b>'
  ].join('\n'),
  shareBot1: true,
  bot1ButtonText: '✨ Open Main Bot',
  bot1Url: 'https://t.me/avniffanbasebot'
};

// Alert Bot Settings
if (!config.alertBot) config.alertBot = {};
config.alertBot.enabled = true;
config.alertBot.token = '9014426568:AAEw5AxpLqYf5k7myF0CdrKlYJfAf6ue4vs';
config.alertBot.username = 'botalertsafmbot';
config.alertBot.adminChatId = '5459778091';
config.alertBot.authorizedPhones = ['6203902842', '6232172355'];
config.alertBot.authorizedAdmins = [
  {
    userId: '5459778091',
    chatId: '5459778091',
    phone: '6203902842',
    name: 'Pranav Kumar',
    role: 'Super Admin',
    verifiedAt: new Date().toISOString()
  }
];
config.alertBot.notifications = {
  userJoins: true,
  purchaseAttempts: true,
  paymentProofs: true,
  paymentApprovals: true,
  paymentRejections: true,
  expirations: true
};

// Write Config
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log('✅ Seeded Main Config: config.json');
console.log('   • Bot 1: Welcome message, Backup Channel, Bottom buttons, Today & Free drops');
console.log('   • Bot 2: Demo Bot with auto-timer and Save Video');
console.log('   • Plans: 3 VIP Passes (₹11, ₹99, ₹299)');
console.log('   • Alert Bot: 1-Tap approvals with photo delivery to Admin ID 5459778091\n');

console.log('🎉 Database & config seeding completed successfully!\n');
