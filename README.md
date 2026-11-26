# Multi-Bot Telegram Suite & Dashboard

A production-ready Node.js multi-bot suite powered by **Telegraf** and **Express**. Supports running in both **decoupled standalone mode** (independent web server and independent bots) or **unified all-in-one mode**.

---

## 🚀 Execution Commands

### 1. Run the Web Server Separately (Decoupled Dashboard)
Starts **only** the Express Web Server, Admin Portal, `/terms` WebApp page, and Configuration APIs on port `3789`:

```bash
npm run server
# or: npm run start:web
```
* **Dashboard URL**: `http://localhost:3789`
* **Terms & Policy**: `http://localhost:3789/terms`
* **Status**: `http://localhost:3789/api/status`
* **API Logs**: `http://localhost:3789/api/logs`

---

### 2. Run Everything (the supported mode)
Runs the dashboard and all 4 bots, including payments and approvals:

```bash
npm start
```

> `bot1.js`, `bot2.js`, `bot3.js` and `server.js` are older standalone scripts. They have **no payments, approvals or Bot 4**, and `bot3.js` still behaves as the old club bot. Do not run them alongside `npm start`.

---

## 🤖 The 4 Bots

| Bot | Role | Token variable |
|---|---|---|
| `@avniffanbasebot` | Welcome, free and today's drops | `TELEGRAM_BOT_TOKEN_1` |
| `@avnifanbbot` | Timed video drops, revealed content | `TELEGRAM_BOT_TOKEN_2` |
| `@avnifanbasepaybot` | Plans, payment QR, approval alerts | `TELEGRAM_BOT_TOKEN_3` |
| `@avnifanbaseprembot` | VIP members only | `TELEGRAM_BOT_TOKEN_4` |

Deep links to the payment bot: `?start=plans` and `?start=<plan id>` (for example `?start=plan_1m`).

---

## 💳 Payment Approval

**Setup (once)**
1. Set `ADMIN_PASSWORD` in `.env` and restart. It protects the dashboard, its APIs and payment screenshots.
2. In `@avnifanbasepaybot` send `/setadmin <password>` from your own Telegram account.
3. In Dashboard → Subscriptions, enter your real UPI ID and keep Auto-Approve off.

**Each payment**
1. The member picks a plan and gets a QR with the amount and an order ref filled in.
2. They send a screenshot or UTR straight into the chat.
3. You get one card with amount, order ref, UTR and screenshot. Check your bank app, then tap **Approve** or **Reject** (Telegram or Dashboard).
4. The member is messaged automatically. Renewing early adds time to what is left.

A screenshot can be faked, so always confirm the money arrived before approving.

---

## 🔐 Multi-Client Mode (selling to clients)

One server, one login page. Only you create accounts. Each client gets their own 4 bots, settings, media, subscribers and payments.

**First start**
1. In `.env` set `ADMIN_PASSWORD` (10+ characters). Optionally `PORT` and `WEBHOOK_DOMAIN`.
2. Stop any `npm start` that uses the same bot tokens, then run:
   ```bash
   npm run start:hub
   ```
3. Sign in as `admin` with that password. After the first start, change it on the Account page (editing `.env` no longer changes it).

**Adding a client**
1. Clients → New client: business name, username, password. On your first client you can tick "Copy my current settings" to move your existing setup in.
2. The client signs in, saves their 4 bot tokens under Account, sends the shown `/setadmin` code to their payment bot, and enters their UPI ID under Subscriptions.

You can also set a client's bot keys, reset their password, restart their bots or disable them. Disabling stops their bots and signs them out.

**Where things are:** everything lives in `hub-data/` (bot tokens are in `hub.json`, one folder per client with `config.json`, `data/`, `assets/`, `bot.log`). Back it up and keep it private.

**Limits:** serve it over HTTPS only. Each client is a separate Node process (budget roughly 100 MB of RAM each; internal ports start at 4100). All run as the same OS user. Restarting the hub signs everyone out.

---

## 🌐 Production Deployment (Nginx + PM2)

1. Point your domain (e.g. `avnibot1.praispranav.com`) to your server IP.
2. In `.env`:
   ```env
   PORT=3789
   WEBHOOK_DOMAIN=https://avnibot1.praispranav.com
   ```
3. Run with PM2:
   ```bash
   pm2 start hub.js --name "telegram-hub"     # multi-client
   # or, single install: pm2 start index.js --name "telegram-suite"
   ```
