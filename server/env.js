/* Runtime mode. Development behaviour (sign-in codes returned in the response, the
   'dev-ops-key' ops key, the demo endpoint, non-Secure cookies) is opt-in: it is only on
   when NODE_ENV is 'development' or 'test'. Anything else — including NODE_ENV not set —
   runs as production, so a forgotten setting fails closed. */
const mode = String(process.env.NODE_ENV || '').toLowerCase();
export const DEV = mode === 'development' || mode === 'test';
export const PROD = !DEV;

/** Production start-up checks: refuse to run with settings that would expose the service. */
export function productionProblems(env = process.env) {
  if (DEV) return [];
  const problems = [];
  const key = env.OPS_KEY || '';
  if (!key || key === 'dev-ops-key' || key.length < 24) problems.push('OPS_KEY must be set to a random secret of at least 24 characters (e.g. `openssl rand -hex 24`).');
  /* Real orders must be paid: Stripe, or an explicit PAYMENTS_DEMO=1 for a demo server (server/payments.js). */
  if (env.STRIPE_SECRET_KEY) {
    if (!env.STRIPE_WEBHOOK_SECRET) problems.push('STRIPE_WEBHOOK_SECRET must be set (Stripe → Developers → Webhooks, endpoint /api/payments/webhook).');
    if (!env.APP_URL) problems.push('APP_URL must be set to the public address customers use (e.g. https://morningbox.ae) so payments can return to the app.');
  } else if (env.PAYMENTS_DEMO !== '1') {
    problems.push('STRIPE_SECRET_KEY must be set so orders are paid (or PAYMENTS_DEMO=1 for a demo server that takes no payments).');
  }
  return problems;
}
