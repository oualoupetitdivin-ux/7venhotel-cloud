// ═══════════════════════════════════════════════════════════════════════
// 7venHotel Cloud — Configuration PM2
// Usage: pm2 start ecosystem.config.js
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  apps: [
    // ── Backend API (Fastify) ─────────────────────────────────────────
    {
      name:        '7venhotel-api',
      script:      './backend/src/server.js',
      cwd:         '/home/claude/public_html/ocs7venHotel',
      instances:   2, // Activer le mode cluster
      exec_mode:   'cluster',
      watch:       false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV:  'production',
        PORT:      3001,
      },
      log_file:        './logs/api/pm2.log',
      error_file:      './logs/error/api-error.log',
      out_file:        './logs/api/api-out.log',
      time:            true,
      restart_delay:   3000,
      max_restarts:    10,
    },

    // ── Frontend Next.js ──────────────────────────────────────────────
    {
      name:        '7venhotel-frontend',
      script:      'npm',
      args:        'start',
      cwd:         '/home/claude/public_html/ocs7venHotel/frontend',
      instances:   1,
      watch:       false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV:  'production',
        PORT:      3000,
      },
      log_file:    '../logs/api/frontend-pm2.log',
      error_file:  '../logs/error/frontend-error.log',
      out_file:    '../logs/api/frontend-out.log',
      time:        true,
      restart_delay: 5000,
    },
  ],
}
