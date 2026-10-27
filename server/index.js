/* Secrets such as RESEND_API_KEY can live in a .env file beside package.json (git-ignored).
   Variables already set in the environment win over the file. */
import { existsSync } from 'node:fs';
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
// Cutoff (9:00 PM the previous day) and delivery windows are Dubai local time.
process.env.TZ = process.env.TZ || 'Asia/Dubai';
const { DEV, productionProblems } = await import('./env.js');
const problems = productionProblems();
if (problems.length) {
  console.error('[start] Refusing to start in production:\n - ' + problems.join('\n - ') + '\n(For local development run `npm run dev`.)');
  process.exit(1);
}
if (!DEV && !process.env.TRUST_PROXY) console.warn('[start] TRUST_PROXY is not set. Behind a reverse proxy or load balancer set it (e.g. TRUST_PROXY=1) so rate limits see each client\'s real IP.');
if (!DEV && !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)) console.warn('[start] RESEND_API_KEY / EMAIL_FROM are not set: sign-in by email is unavailable.');
if (!DEV && !(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)) console.warn('[start] WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set: sign-in by mobile (WhatsApp code) is unavailable.');
if (!DEV && !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) && !(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)) console.error('[start] No sign-in code delivery is configured: customers cannot sign in.');
const { createApp } = await import('./app.js');
const { queueDrinkReminders } = await import('./notify.js');
const { allocateAtCutoff, flagAtRisk } = await import('./ops.js');
const { reconcilePastMornings } = await import('./reconcile.js');
const { processRefunds, expireCheckouts } = await import('./payments.js');
const port = Number(process.env.PORT || 8787);
const server = createApp().listen(port, () => console.log(`Morning Box API on http://localhost:${port} (TZ ${process.env.TZ}, ${DEV ? 'development' : 'production'})`));
/* Requests that hang are closed instead of holding connections open. */
server.requestTimeout = 30_000;
server.headersTimeout = 20_000;

/* Every 10 minutes: drink reminders, final bakery allocation at the 9:00 PM cutoff,
   and the "at risk of being late" check before each delivery window ends. */
const tick = () => {
  try { queueDrinkReminders(); } catch (e) { console.error('[reminders]', e); }
  try { const r = allocateAtCutoff(); if (r) console.log(`[allocation] ${r.date}: ${r.allocations.length} deliveries`); } catch (e) { console.error('[allocation]', e); }
  try { flagAtRisk(); } catch (e) { console.error('[at-risk]', e); }
  /* MB-OPS-001 §9: mornings that are over are reconciled automatically; only mismatches reach the exception queue. */
  try { reconcilePastMornings(); } catch (e) { console.error('[reconcile]', e); }
  try { purgeOldData(); } catch (e) { console.error('[cleanup]', e); }
  /* Card refunds that failed are retried; abandoned payment pages are closed. */
  try { expireCheckouts(); } catch (e) { console.error('[checkouts]', e); }
  processRefunds().catch(e => console.error('[refunds]', e));
};
/* Retention: expired sessions, sign-in codes older than a day, product analytics older than 13 months. */
const { db: store } = await import('./db.js');
function purgeOldData() {
  store.prepare('DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?').run(Date.now());
  store.prepare('DELETE FROM otp_codes WHERE COALESCE(last_sent, window_start, 0) < ?').run(Date.now() - 24 * 60 * 60 * 1000);
  store.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-13 months')").run();
}
setInterval(tick, 10 * 60 * 1000).unref();
tick();

/* Graceful shutdown (deploys, restarts): stop taking requests, then close the database cleanly. */
const shutdown = signal => {
  console.log(`[stop] ${signal}: closing`);
  server.close(() => { try { store.close(); } catch { /* already closed */ } process.exit(0); });
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
