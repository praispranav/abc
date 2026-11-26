// Multi-client front door: logins, accounts created by the owner, and one isolated bot process per client.
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

dotenv.config();

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const HUB_DIR = path.resolve(process.env.HUB_DATA_DIR || path.join(APP_DIR, 'hub-data'));
const DB_FILE = path.join(HUB_DIR, 'hub.json');
const PORT = Number(process.env.PORT) || 3789;
const BASE_PORT = Number(process.env.INSTANCE_BASE_PORT) || 4100;
const DOMAIN = (process.env.WEBHOOK_DOMAIN || '').replace(/\/+$/, '');
const API_ROOT = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
const SESSION_MS = 12 * 3600 * 1000;
const BOT_ROLES = ['Welcome & community bot', 'Video drops bot', 'Payment bot', 'Premium members bot'];

// ---------------- storage ----------------
fs.mkdirSync(path.join(HUB_DIR, 'clients'), { recursive: true });
const db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : { accounts: [], clients: [] };
function save() {
  fs.writeFileSync(`${DB_FILE}.tmp`, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(`${DB_FILE}.tmp`, DB_FILE);
}
const clientDir = (client) => path.join(HUB_DIR, 'clients', client.id);
const findClient = (id) => db.clients.find((c) => c.id === id);
const findAccount = (username) => db.accounts.find((a) => a.username === username);

// ---------------- passwords & sessions ----------------
const scrypt = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: scrypt(password, salt) };
}
function passwordMatches(account, password) {
  // Hash even for unknown users so response time does not reveal which usernames exist
  const hash = scrypt(password, account?.salt || 'missing');
  return !!account && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(account.hash));
}

const sessions = new Map(); // token -> { username, expires }
const failures = new Map(); // ip|username -> { count, until }

function readCookie(req, name) {
  const match = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}
function currentAccount(req) {
  const session = sessions.get(readCookie(req, 'sid'));
  if (!session || session.expires < Date.now()) return null;
  const account = findAccount(session.username);
  if (!account || account.disabled) return null;
  if (account.role === 'client' && !findClient(account.clientId)) return null;
  return account;
}
function endSessions(username, keepToken) {
  for (const [token, s] of sessions) if (s.username === username && token !== keepToken) sessions.delete(token);
}

// ---------------- bot processes ----------------
const instances = new Map(); // clientId -> { child, key, stopping }

function seedClientFolder(client, importExisting) {
  const dir = clientDir(client);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  if (importExisting) {
    for (const item of ['config.json', 'assets', 'data']) {
      const source = path.join(APP_DIR, item);
      if (fs.existsSync(source)) fs.cpSync(source, path.join(dir, item), { recursive: true });
    }
    return;
  }
  const plan = (id, name, price, durationHours) => ({ id, name, price, durationHours, linkedContent: 'all', contentTitle: 'All Content (Full VIP)' });
  const subscriptions = {
    enabled: true, currency: '₹', qrMode: 'dynamic_upi', upiId: '', merchantName: client.name, adminChatId: '', autoApprove: false, instructions: '',
    plans: [plan('plan_6h', '⚡ 6 Hours Pass', 11, 6), plan('plan_1w', '🌟 1 Week Pass', 99, 168), plan('plan_1m', '👑 1 Month Pass', 299, 720)]
  };
  // The bot process fills in every other section with its defaults on first start
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ subscriptions }, null, 2));
}

function startInstance(client) {
  const key = crypto.randomBytes(32).toString('hex');
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: process.env.NODE_ENV || 'production',
    TENANT_DIR: clientDir(client),
    HOST: '127.0.0.1',
    PORT: String(client.port),
    INTERNAL_KEY: key,
    SETADMIN_CODE: client.setupCode,
    BUSINESS_NAME: client.name,
    WEBHOOK_DOMAIN: DOMAIN,
    TERMS_URL: DOMAIN ? `${DOMAIN}/c/${client.id}/terms` : '',
    TELEGRAM_API_ROOT: process.env.TELEGRAM_API_ROOT || ''
  };
  BOT_ROLES.forEach((_, i) => {
    const bot = client.bots[i + 1];
    env[`TELEGRAM_BOT_TOKEN_${i + 1}`] = bot?.token || '';
    env[`BOT${i + 1}_USERNAME`] = bot?.username || `set_up_bot_${i + 1}`;
  });

  const child = spawn(process.execPath, [path.join(APP_DIR, 'index.js')], { cwd: clientDir(client), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const instance = { child, key, stopping: false, startedAt: Date.now() };
  instances.set(client.id, instance);
  const log = fs.createWriteStream(path.join(clientDir(client), 'bot.log'), { flags: 'w' });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on('exit', (code) => {
    log.end();
    if (instance.stopping || instances.get(client.id) !== instance) return;
    instances.delete(client.id);
    console.warn(`[Hub] ${client.name} stopped (code ${code}). Restarting in 10s.`);
    setTimeout(() => {
      if (!instances.has(client.id) && isEnabled(client)) startInstance(client);
    }, 10000);
  });
}

function stopInstance(clientId) {
  const instance = instances.get(clientId);
  if (!instance) return Promise.resolve();
  instance.stopping = true;
  instances.delete(clientId);
  return new Promise((resolve) => {
    const force = setTimeout(() => instance.child.kill('SIGKILL'), 5000);
    instance.child.once('exit', () => { clearTimeout(force); resolve(); });
    instance.child.kill('SIGTERM');
  });
}

// Restarts are queued per client so two quick saves never leave two pollers on one token
const queues = new Map();
function restartInstance(client) {
  const next = (queues.get(client.id) || Promise.resolve()).then(async () => {
    await stopInstance(client.id);
    if (isEnabled(client)) startInstance(client);
  });
  queues.set(client.id, next.catch((err) => console.error('[Hub] restart failed:', err.message)));
  return next;
}

const isEnabled = (client) => db.accounts.some((a) => a.clientId === client.id && !a.disabled);

// ---------------- proxy to a client's process ----------------
function proxy(req, res, client, targetPath = req.originalUrl) {
  const instance = instances.get(client.id);
  if (!instance) return res.status(503).send('Bots are not running. Try again in a few seconds.');
  const headers = { ...req.headers, 'x-internal-key': instance.key };
  delete headers.cookie;
  delete headers.authorization;
  const upstream = http.request({ host: '127.0.0.1', port: client.port, method: req.method, path: targetPath, headers }, (reply) => {
    const replyHeaders = { ...reply.headers };
    delete replyHeaders['set-cookie'];
    // Uploaded files must never run script on the dashboard's origin
    if (targetPath.toLowerCase().startsWith('/assets')) {
      replyHeaders['content-security-policy'] = 'sandbox';
      replyHeaders['x-content-type-options'] = 'nosniff';
    }
    res.writeHead(reply.statusCode, replyHeaders);
    reply.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.status(503).send('Bots are starting. Refresh in a few seconds.');
    else res.destroy();
  });
  req.pipe(upstream);
}

// ---------------- pages ----------------
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title, body, account) {
  const nav = account
    ? `<nav><span>${esc(account.username)}</span>${account.role === 'owner' ? '<a href="/owner">Clients</a>' : '<a href="/">Dashboard</a>'}<a href="/account">Account</a><form method="post" action="/logout"><button class="link">Log out</button></form></nav>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:#0b0f19;color:#e2e8f0;font:15px/1.5 system-ui,sans-serif}
main{max-width:720px;margin:0 auto}nav{display:flex;gap:16px;justify-content:flex-end;align-items:center;margin-bottom:16px;flex-wrap:wrap}nav form{margin:0}
a{color:#38bdf8}h1{font-size:1.35rem}h2{font-size:1.05rem;margin:0 0 12px}
section{background:#111a2e;border:1px solid #263352;border-radius:14px;padding:18px;margin-bottom:16px}
label{display:block;margin:10px 0 4px;color:#9aa7bd;font-size:.85rem}
input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#0b1220;color:inherit;font:inherit}
input[type=checkbox]{width:auto;margin-right:8px}
button{margin-top:12px;padding:9px 16px;border:0;border-radius:8px;background:#0284c7;color:#fff;font:inherit;cursor:pointer}
button.danger{background:#b91c1c}button.link{background:none;color:#f87171;padding:0;margin:0}
.msg{padding:10px 14px;border-radius:8px;background:#0c2d48;border:1px solid #0284c7;margin-bottom:16px}.err{background:#3b1219;border-color:#b91c1c}
.row{display:flex;gap:8px;flex-wrap:wrap}.row form{margin:0}code{background:#0b1220;padding:2px 6px;border-radius:5px}.muted{color:#9aa7bd;font-size:.85rem}
</style></head><body><main>${nav}<h1>${esc(title)}</h1>${body}</main></body></html>`;
}

const banner = (req) =>
  (req.query.ok ? `<div class="msg" role="status">${esc(req.query.ok)}</div>` : '') +
  (req.query.error ? `<div class="msg err" role="alert">${esc(req.query.error)}</div>` : '');
const back = (res, to, key, text) => res.redirect(303, `${to}?${key}=${encodeURIComponent(text)}`);

function botKeysForm(client, action) {
  const fields = BOT_ROLES.map((role, i) => {
    const bot = client.bots[i + 1];
    const state = bot ? `Connected: @${esc(bot.username)}. Leave blank to keep it.` : 'Not set';
    return `<label for="t${i + 1}">Bot ${i + 1}: ${role}</label><input id="t${i + 1}" name="token${i + 1}" type="password" autocomplete="off" placeholder="Token from @BotFather"><div class="muted">${state}</div>${bot ? `<label><input type="checkbox" name="remove${i + 1}" value="1">Disconnect bot ${i + 1}</label>` : ''}`;
  }).join('');
  return `<form method="post" action="${action}">${fields}<button>Save bot keys</button></form>`;
}

// Checks each token with Telegram, which also gives the bot's username for the cross-bot links
async function saveBotKeys(client, body) {
  const bots = { ...client.bots };
  for (let n = 1; n <= 4; n++) {
    if (body[`remove${n}`]) delete bots[n];
    const token = String(body[`token${n}`] || '').trim();
    if (!token) continue;
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) throw new Error(`Bot ${n}: that does not look like a bot token.`);
    let reply;
    try {
      reply = await (await fetch(`${API_ROOT}/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) })).json();
    } catch (_) {
      throw new Error(`Bot ${n}: could not reach Telegram. Try again.`);
    }
    if (!reply.ok || !reply.result?.username) throw new Error(`Bot ${n}: Telegram rejected this token.`);
    bots[n] = { token, username: reply.result.username };
  }
  // One token can only be polled by one process
  const botId = (bot) => bot.token.split(':')[0];
  const mine = Object.values(bots).map(botId);
  const others = db.clients.filter((c) => c.id !== client.id).flatMap((c) => Object.values(c.bots).map(botId));
  if (new Set(mine).size !== mine.length || mine.some((id) => others.includes(id))) {
    throw new Error('Each bot can be used only once, by one client.');
  }
  client.bots = bots;
  save();
  await restartInstance(client);
}

function validateCredentials(username, password) {
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) return 'Username: 3-32 characters, lowercase letters, numbers, . _ -';
  if (password.length < 10) return 'Password must be at least 10 characters.';
  return null;
}

// ---------------- app ----------------
const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

// Public: Telegram webhooks (verified by secret header inside the client process) and terms pages
app.use((req, res, next) => {
  const hook = req.path.match(/^\/webhook\/bot[1-4]_(\d+)$/);
  if (hook) {
    const client = db.clients.find((c) => Object.values(c.bots).some((b) => b.token.split(':')[0] === hook[1]));
    return client ? proxy(req, res, client) : res.sendStatus(404);
  }
  const terms = req.path.match(/^\/c\/([a-f0-9]+)\/(terms|api\/terms)$/);
  if (terms && req.method === 'GET') {
    const client = findClient(terms[1]);
    return client ? proxy(req, res, client, `/${terms[2]}`) : res.sendStatus(404);
  }
  next();
});

// Reject cross-site form posts (the session cookie is also SameSite=Strict)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!['GET', 'HEAD'].includes(req.method) && origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (_) {}
    if (host !== req.headers.host) return res.status(403).send('Cross-site request blocked');
  }
  next();
});

const form = express.urlencoded({ extended: false, limit: '20kb' });

app.get('/login', (req, res) => {
  if (currentAccount(req)) return res.redirect('/');
  res.send(page('Sign in', `${banner(req)}<section><form method="post" action="/login"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required><button>Sign in</button></form><p class="muted">Accounts are created by the administrator.</p></section>`));
});

app.post('/login', form, (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const key = `${req.ip}|${username}`;
  const failed = failures.get(key);
  if (failed && failed.count >= 5 && failed.until > Date.now()) return back(res, '/login', 'error', 'Too many attempts. Wait 15 minutes.');

  const account = findAccount(username);
  if (!passwordMatches(account, String(req.body?.password || '')) || account.disabled) {
    const count = failed && failed.until > Date.now() ? failed.count + 1 : 1;
    failures.set(key, { count, until: Date.now() + 15 * 60 * 1000 });
    return back(res, '/login', 'error', 'Wrong username or password.');
  }
  failures.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expires: Date.now() + SESSION_MS });
  res.cookie('sid', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_MS });
  res.redirect(303, account.role === 'owner' ? '/owner' : '/');
});

app.post('/logout', (req, res) => {
  sessions.delete(readCookie(req, 'sid'));
  res.clearCookie('sid');
  res.redirect(303, '/login');
});

// Everything below needs a login
app.use((req, res, next) => {
  req.account = currentAccount(req);
  if (req.account) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please sign in again.' });
  res.redirect('/login');
});

app.get('/account', (req, res) => {
  const { account } = req;
  let body = banner(req);
  const client = account.role === 'client' ? findClient(account.clientId) : null;
  if (client) {
    body += `<section><h2>Bot keys</h2>${botKeysForm(client, '/account/bots')}</section>`;
    body += `<section><h2>Get payment alerts</h2><p>After saving your payment bot key, send this to that bot from your own Telegram:</p><p><code>/setadmin ${esc(client.setupCode)}</code></p></section>`;
  }
  body += `<section><h2>Change password</h2><form method="post" action="/account/password"><label for="c">Current password</label><input id="c" name="current" type="password" autocomplete="current-password" required><label for="n">New password (10+ characters)</label><input id="n" name="password" type="password" autocomplete="new-password" minlength="10" required><button>Change password</button></form></section>`;
  res.send(page('Account', body, account));
});

app.post('/account/password', form, (req, res) => {
  const password = String(req.body?.password || '');
  if (!passwordMatches(req.account, String(req.body?.current || ''))) return back(res, '/account', 'error', 'Current password is wrong.');
  if (password.length < 10) return back(res, '/account', 'error', 'Password must be at least 10 characters.');
  Object.assign(req.account, passwordRecord(password));
  save();
  endSessions(req.account.username, readCookie(req, 'sid'));
  back(res, '/account', 'ok', 'Password changed.');
});

app.post('/account/bots', form, async (req, res) => {
  const client = req.account.role === 'client' && findClient(req.account.clientId);
  if (!client) return res.sendStatus(403);
  try {
    await saveBotKeys(client, req.body || {});
    back(res, '/account', 'ok', 'Bot keys saved. Bots are restarting.');
  } catch (err) {
    back(res, '/account', 'error', err.message);
  }
});

// ----- owner only -----
const ownerOnly = (req, res, next) => (req.account.role === 'owner' ? next() : res.sendStatus(403));

app.get('/owner', ownerOnly, (req, res) => {
  const cards = db.clients.map((c) => {
    const account = db.accounts.find((a) => a.clientId === c.id);
    const bots = Object.values(c.bots).map((b) => `@${esc(b.username)}`).join(', ') || 'no bots yet';
    const status = account.disabled ? 'Disabled' : instances.has(c.id) ? 'Running' : 'Stopped';
    const base = `/owner/clients/${c.id}`;
    return `<section><h2>${esc(c.name)}</h2><p class="muted">Login <code>${esc(account.username)}</code> · ${status} · ${bots}</p>
<details><summary>Bot keys</summary>${botKeysForm(c, `${base}/bots`)}</details>
<details><summary>Reset password</summary><form method="post" action="${base}/password"><label for="pw${c.id}">New password</label><input id="pw${c.id}" name="password" type="password" autocomplete="new-password" minlength="10" required><button>Reset password</button></form></details>
<div class="row"><form method="post" action="${base}/restart"><button>Restart bots</button></form><form method="post" action="${base}/toggle"><button class="${account.disabled ? '' : 'danger'}">${account.disabled ? 'Enable client' : 'Disable client'}</button></form></div></section>`;
  }).join('');
  const importOption = db.clients.length ? '' : '<label><input type="checkbox" name="importExisting" value="1">Copy my current settings, media and subscribers into this client</label>';
  const create = `<section><h2>New client</h2><form method="post" action="/owner/clients"><label for="name">Business name</label><input id="name" name="name" required maxlength="40"><label for="username">Login username</label><input id="username" name="username" autocomplete="off" required><label for="password">Password (10+ characters)</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required>${importOption}<button>Create client</button></form></section>`;
  res.send(page('Clients', banner(req) + create + cards, req.account));
});

app.post('/owner/clients', ownerOnly, form, async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const problem = !name ? 'Business name is required.' : validateCredentials(username, password) || (findAccount(username) ? 'That username is taken.' : null);
  if (problem) return back(res, '/owner', 'error', problem);

  const port = Math.max(BASE_PORT - 1, ...db.clients.map((c) => c.port)) + 1;
  const client = { id: crypto.randomBytes(6).toString('hex'), name, port, setupCode: crypto.randomBytes(8).toString('hex'), bots: {} };
  seedClientFolder(client, !db.clients.length && !!req.body.importExisting);
  db.clients.push(client);
  db.accounts.push({ username, role: 'client', clientId: client.id, ...passwordRecord(password) });
  save();
  await restartInstance(client);
  back(res, '/owner', 'ok', `Client "${name}" created.`);
});

app.post('/owner/clients/:id/:action', ownerOnly, form, async (req, res) => {
  const client = findClient(req.params.id);
  const account = client && db.accounts.find((a) => a.clientId === client.id);
  if (!account) return res.sendStatus(404);
  try {
    switch (req.params.action) {
      case 'bots':
        await saveBotKeys(client, req.body || {});
        break;
      case 'password': {
        const password = String(req.body?.password || '');
        if (password.length < 10) throw new Error('Password must be at least 10 characters.');
        Object.assign(account, passwordRecord(password));
        save();
        endSessions(account.username);
        break;
      }
      case 'toggle':
        account.disabled = !account.disabled;
        save();
        endSessions(account.username);
        await restartInstance(client);
        break;
      case 'restart':
        await restartInstance(client);
        break;
      default:
        return res.sendStatus(404);
    }
    back(res, '/owner', 'ok', `Saved for "${client.name}".`);
  } catch (err) {
    back(res, '/owner', 'error', err.message);
  }
});

// The client's own dashboard and APIs
app.use((req, res) => {
  if (req.account.role === 'owner') return res.redirect('/owner');
  if (req.path.toLowerCase() === '/admin.html') return res.redirect('/');
  proxy(req, res, findClient(req.account.clientId));
});

// ---------------- startup ----------------
if (!db.accounts.some((a) => a.role === 'owner')) {
  const password = (process.env.ADMIN_PASSWORD || '').trim();
  if (password.length < 10) {
    console.error('❌ First start: set ADMIN_PASSWORD (10+ characters) in .env. It becomes the password of the "admin" account.');
    process.exit(1);
  }
  db.accounts.push({ username: 'admin', role: 'owner', ...passwordRecord(password) });
  save();
  console.log('👑 Owner account "admin" created.');
}

const server = app.listen(PORT, (err) => {
  if (err) {
    console.error(`❌ Could not listen on port ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`🔐 Hub running on http://localhost:${PORT}`);
  db.clients.filter(isEnabled).forEach(startInstance);
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    await Promise.all([...instances.keys()].map(stopInstance));
    process.exit(0);
  });
}
