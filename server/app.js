import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './rules.js';
import { db } from './db.js';
import { authRouter } from './auth.js';
import { personalRouter } from './personal.js';
import { businessRouter } from './business.js';
import { opsRouter, demoRouter } from './ops.js';
import { bakeryRouter } from './fulfilment.js';
import { paymentsRouter } from './payments.js';

import { PROD } from './env.js';
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "manifest-src 'self'", "worker-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"
].join('; ');
function securityHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  /* Behind a load balancer set TRUST_PROXY (e.g. 1) so rate limits see the real client IP. */
  if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  app.use(securityHeaders);
  /* The raw body is kept for verifying payment webhook signatures. */
  app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/payments/webhook')) req.rawBody = buf; } }));

  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_req, res) => {
    /* Used by the hosting platform / uptime monitor: fails when the database can't be read. */
    try { db.prepare('SELECT 1').get(); res.json({ ok: true, time: new Date().toString() }); }
    catch { res.status(503).json({ ok: false }); }
  });
  app.use('/api/auth', authRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api', personalRouter);
  app.use('/api/business', businessRouter);
  app.use('/api/ops', opsRouter);
  app.use('/api/bakery', bakeryRouter);
  app.use('/api/demo', demoRouter);
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'not_found', 'Not found.')));

  /* Serve the built web app in production (npm run build && npm start). */
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (existsSync(dist)) {
    /* Built files have content hashes in their names, so they can be cached for good; index.html is always
       re-checked so phones pick up a new release straight away. */
    const fresh = res => res.setHeader('Cache-Control', 'no-cache');
    app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y' }), (_req, res) => res.status(404).end());
    app.use(express.static(dist, { setHeaders: (res, file) => { if (file.endsWith('.html')) fresh(res); } }));
    app.get('*', (_req, res) => { fresh(res); res.sendFile(join(dist, 'index.html')); });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'That request is too large.' });
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  });
  return app;
}
