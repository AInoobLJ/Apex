// PM2 Ecosystem Configuration — Persistent Process Management
// Start:   pm2 start ecosystem.config.cjs
// Status:  pm2 status
// Logs:    pm2 logs
// Restart: pm2 restart all
// Stop:    pm2 stop all
// Monitor: pm2 monit
// Health:  curl http://localhost:3001/api/v1/system/health
// Ready:   curl http://localhost:3001/api/v1/system/ready

const path = require('path');
const ROOT = __dirname;
const BIN = path.join(ROOT, 'node_modules/.bin');

module.exports = {
  apps: [
    {
      name: 'apex-api',
      cwd: path.join(ROOT, 'apps/api'),
      script: path.join(BIN, 'tsx'),
      args: 'src/index.ts',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '512M',
      restart_delay: 5000,
      env: {
        NODE_ENV: 'development',
        PATH: `/opt/homebrew/bin:${BIN}:/usr/local/bin:${process.env.PATH}`,
      },
      out_file: path.join(ROOT, 'logs/api.log'),
      error_file: path.join(ROOT, 'logs/api-error.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'apex-worker',
      cwd: path.join(ROOT, 'apps/api'),
      script: path.join(BIN, 'tsx'),
      args: 'src/worker.ts',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '512M',
      restart_delay: 5000,
      env: {
        NODE_ENV: 'development',
        PATH: `/opt/homebrew/bin:${BIN}:/usr/local/bin:${process.env.PATH}`,
      },
      out_file: path.join(ROOT, 'logs/worker.log'),
      error_file: path.join(ROOT, 'logs/worker-error.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'apex-speed',
      cwd: path.join(ROOT, 'apps/api'),
      script: path.join(BIN, 'tsx'),
      args: 'src/speed-worker.ts',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '512M',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'development',
        BINANCE_WS_ENABLED: 'true',
        PATH: `/opt/homebrew/bin:${BIN}:/usr/local/bin:${process.env.PATH}`,
      },
      out_file: path.join(ROOT, 'logs/speed.log'),
      error_file: path.join(ROOT, 'logs/speed-error.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'apex-dashboard',
      cwd: path.join(ROOT, 'apps/dashboard'),
      script: path.join(BIN, 'vite'),
      args: '--host --port 5173',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'development',
        PATH: `/opt/homebrew/bin:${BIN}:/usr/local/bin:${process.env.PATH}`,
      },
      out_file: path.join(ROOT, 'logs/dashboard.log'),
      error_file: path.join(ROOT, 'logs/dashboard-error.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
