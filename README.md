# Telegram Bot (Node.js)

Built using **Node.js** and **Telegraf**.

## Features & Commands

- `/start` - Greeting and list of commands
- `/help` - Command reference
- `/info` - Inspect User ID, Chat ID, and names
- `/echo <message>` - Echo back text
- `/roll` - Roll a 6-sided dice

---

## Local Setup

1. **Set your token in `.env`:**
   ```env
   TELEGRAM_BOT_TOKEN=your_token_from_botfather
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run the bot:**
   ```bash
   npm start
   # Or for auto-reload during development:
   npm run dev
   ```

---

## Remote Server (SSH) Setup

### 1. Connect to your VPS/Server via SSH
```bash
ssh user@your_server_ip
# If using a specific key:
ssh -i ~/.ssh/id_rsa user@your_server_ip
```

### 2. Code directly on server using VS Code Remote - SSH
1. Install the **Remote - SSH** extension in VS Code.
2. Press `F1` (or `Cmd + Shift + P`) -> `Remote-SSH: Connect to Host...`.
3. Enter `user@your_server_ip`.
4. Open the remote bot folder directly in VS Code to edit code in real-time.

### 3. Keep bot running 24/7 on the server using PM2
```bash
npm install -g pm2
pm2 start index.js --name "telegram-bot"
pm2 save
pm2 startup
```
