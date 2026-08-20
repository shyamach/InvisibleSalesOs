/**
 * ecosystem.config.cjs — PM2 process config for the backend gateway.
 *
 * .cjs, not .js — package.json has "type": "module", and PM2 needs to load
 * this as CommonJS (module.exports) regardless; .cjs forces that.
 *
 * Phase E, item E0 (crash containment). PM2 already manages this process in
 * practice today (see HOW_TO_TEST.md's port-conflict note on `pm2 list`
 * and the `sales-os` process name), but until now that setup was ad-hoc —
 * started manually with whatever flags were typed at the time, not committed
 * anywhere, and not reproducible from a fresh checkout. This file makes it
 * real: `pm2 start ecosystem.config.cjs`.
 *
 * server.js's own process.on('uncaughtException'/'unhandledRejection', ...)
 * guards (see the "Crash containment" comment block near the top of that
 * file) are the first line of defense — they log-and-continue instead of
 * letting the process die. PM2's autorestart here is the second line, for
 * failure modes those guards can't catch (e.g. the process being killed
 * externally, or a truly fatal native-module crash in whatsapp-web.js's
 * Puppeteer/Chrome subprocess).
 */
module.exports = {
  apps: [
    {
      name: 'sales-os',
      script: 'server.js',
      cwd: __dirname,
      // Single instance — server.js holds in-memory state (WhatsApp client,
      // the digest scheduler's lastSentWeek dedup, sweeper intervals) that
      // does not support running under PM2 cluster mode.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // Caps restart storms (e.g. a bad deploy that crashes on every boot)
      // instead of PM2 endlessly respawning a process that will never
      // recover — after this many restarts within min_uptime, PM2 stops
      // trying and leaves it down for a human to look at.
      max_restarts: 10,
      min_uptime: '30s',
      // Small backoff before each restart — avoids hammering a transient
      // failure (e.g. Supabase briefly unreachable at boot) in a tight loop.
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
