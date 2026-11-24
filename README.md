# Multi-Bot Telegram Server & Web Configuration Portal

A unified Node.js and Telegraf server running multiple Telegram bots side-by-side with a web-based administration dashboard.

---

## 🤖 The Bots

### 1. Bot 1: `@Avniffanbasebot` (Community & Welcome Hub)
- **Token:** Configured in `TELEGRAM_BOT_TOKEN_1`
- **Commands:**
  - `/start` - Displays greeting, welcome banner image, and channel buttons
  - `/free` - Delivers free channel link and promotional updates
  - `/help` - Help message and community guidance
  - Interactive *Terms & Policy* modal popup

### 2. Bot 2: `@avnifanbbot` (Timed Video / Auto-Delete Bot)
- **Username:** `t.me/avnifanbbot`
- **Token:** Configured in `TELEGRAM_BOT_TOKEN_2` (`9202863846:AAHgjTadO-qhllGFg_0bmPoLXO9NV70e3Mc`)
- **Concept & Features:**
  - **Auto-Delete Timer (Self-Destruct):** Default timer deletes the delivered video and message automatically after a set period (e.g., 1 minute, 2 minutes, or custom duration).
  - **Media Delivery:** Supports local video uploads (MP4, MOV, WebM up to 100MB) or external direct URLs / Telegram `file_id`s.
  - **Commands:**
    - `/start` - Delivers the configured video and message with the countdown timer
    - `/video` - Requests the timed video message
    - `/help` - Displays bot information, command guide, and current timer duration
  - **Interactive Echo Mode:** Users or admins forwarding/sending a video directly to the bot will receive it protected with the auto-destruct timer.

---

## 🌐 Unified Configuration Portal

Both bots are configured on the **same portal**:
- Access via browser: `http://localhost:3000` (or `https://your-domain.com/admin`)
- **Features:**
  - Tab navigation switching seamlessly between **Bot 1** and **Bot 2**.
  - **Bot 1 Tab:** Edit welcome message, upload header banner, manage buttons, configure `/free` and `/help`, update Terms & Policy.
  - **Bot 2 Tab:** Upload video files (up to 100MB), set video URLs, customize captions, choose timer preset (30s, 1min, 2min, 5min, Custom), customize warning message, and configure `/help`.
  - **Live Telegram Mockup Preview:** Real-time visual feedback on both bots with instant simulated phone preview.
  - One-click **Save All Configuration Changes** syncing to `config.json`.

---

## 🚀 Getting Started

### 1. Environment Setup
Create or verify your `.env` file:
```env
# Bot 1
TELEGRAM_BOT_TOKEN_1=9051597768:AAEsG3DJE8tYTrF3Kk8jSqpR5hRx5yhUDaE

# Bot 2
TELEGRAM_BOT_TOKEN_2=9202863846:AAHgjTadO-qhllGFg_0bmPoLXO9NV70e3Mc

PORT=3000

# Optional: Set domain for Webhook mode in production
# Leave blank for local development (defaults to long polling)
WEBHOOK_DOMAIN=
```

### 2. Start the Server
```bash
npm install
npm start
# Or for auto-reload during development:
npm run dev
```

Visit `http://localhost:3000` to open the configuration dashboard.

---

## 🔒 Production & Webhook Setup

When running behind Nginx:
- Map both webhooks through Nginx:
  - Bot 1: `/webhook/bot1_<token1_id>`
  - Bot 2: `/webhook/bot2_<token2_id>`
- Nginx automatically forwards all requests to `http://127.0.0.1:3000`.
- See `nginx.conf.example` for the full configuration.
