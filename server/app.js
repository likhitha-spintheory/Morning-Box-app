import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './rules.js';
import { authRouter } from './auth.js';
import { personalRouter } from './personal.js';
import { businessRouter } from './business.js';
import { opsRouter, demoRouter } from './ops.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toString() }));
  app.use('/api/auth', authRouter);
  app.use('/api', personalRouter);
  app.use('/api/business', businessRouter);
  app.use('/api/ops', opsRouter);
  app.use('/api/demo', demoRouter);
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'not_found', 'Not found.')));

  /* Serve the built web app in production (npm run build && npm start). */
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  });
  return app;
}
