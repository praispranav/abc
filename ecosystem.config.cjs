module.exports = {
  apps: [
    {
      name: 'telegram-bots',
      script: 'index.js',
      instances: 1, // Single instance is required for Telegram Bots
      exec_mode: 'fork', // Fork mode is mandatory (cluster mode causes Telegram polling/webhook conflicts)
      autorestart: true,
      watch: false, // Set to false so changes to config.json or data/ do not restart the bots
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true
    }
  ]
};
