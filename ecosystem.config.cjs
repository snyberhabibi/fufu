module.exports = {
  apps: [
    {
      name: 'fufu',
      script: 'src/bot.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production'
      },
      // Restart settings
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      // Logging
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      // Performance
      instances: 1,
      exec_mode: 'fork'
    }
  ]
};
