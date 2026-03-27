// PM2 Ecosystem Configuration — Persistent Process Management
// Start:   pm2 start ecosystem.config.cjs
// Status:  pm2 status
// Logs:    pm2 logs
// Restart: pm2 restart all
// Stop:    pm2 stop all
// Monitor: pm2 monit

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
      name: 'apex-dashboard',
      cwd: path.join(ROOT, 'apps/dashboard'),
      script: path.join(BIN, 'vite'),
      args: '--host --port 5173',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
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
