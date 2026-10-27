/* Transactional email through Resend (https://resend.com). Configured by
   RESEND_API_KEY and EMAIL_FROM, e.g. `Morning Box <login@send.morningbox.ae>`;
   the sender must be on a domain verified in Resend. */
import { ApiError } from './rules.js';

const RESEND_URL = 'https://api.resend.com/emails';

export const mailConfigured = (env = process.env) => !!(env.RESEND_API_KEY && env.EMAIL_FROM);

/** Send one email. Throws a 503 when email is not configured and a 502 when Resend refuses it. */
export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) throw new ApiError(503, 'email_unavailable', 'Email sign-in is not available right now. Use your mobile number instead.');
  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (e) {
    console.error('[mail] request failed:', e.message);
    throw new ApiError(502, 'email_failed', 'We couldn’t send the email. Please try again.');
  }
  if (!res.ok) {
    console.error(`[mail] Resend ${res.status}:`, (await res.text().catch(() => '')).slice(0, 300));
    throw new ApiError(502, 'email_failed', 'We couldn’t send the email. Please try again.');
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appLink = path => (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, '')}/#${path}` : '');

/** Fire-and-forget email: skipped when email isn't configured or there's no address; a failure never affects the order. */
function sendQuietly(to, subject, lines, linkPath) {
  if (!to || !mailConfigured()) return;
  const link = appLink(linkPath);
  sendMail({
    to, subject,
    text: [...lines, ...(link ? ['', link] : [])].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2b2118">${lines.map(l => `<p>${esc(l)}</p>`).join('')}${link ? `<p><a href="${esc(link)}">Open in Morning Box</a></p>` : ''}</div>`
  }).catch(() => { /* logged in sendMail */ });
}

/** Order confirmation (MB-FLW-001 §9: email for the confirmation is optional at checkout). */
export function sendOrderEmail(order) {
  sendQuietly(order.email, `Your Morning Box order ${order.id} is confirmed`, [
    `Thank you — order ${order.id} is confirmed and paid (AED ${order.total}).`,
    'You can change or cancel each morning in the app until 9:00 PM the evening before.'
  ], `/orders`);
}

/** Business Breakfast confirmation (MB-B2B-001 §8: Order → Pay Online → Confirmation + Invoice). */
export function sendBusinessOrderEmail(order) {
  sendQuietly(order.email, `Business Breakfast order ${order.id} is confirmed`, [
    `Thank you — Business Breakfast order ${order.id} for ${order.company} is confirmed and paid (AED ${order.total}).`,
    'Your invoice is available on the order in the app. You can change headcount, boxes or cancel each day until 9:00 PM the evening before.'
  ], `/business/orders/${order.id}`);
}

/** The sign-in code email. */
export function sendCodeEmail(to, code, ttlMinutes) {
  return sendMail({
    to,
    subject: `${code} is your Morning Box code`,
    text: `Your Morning Box sign-in code is ${code}.\n\nIt expires in ${ttlMinutes} minutes. If you didn’t ask for it, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;color:#2b2118">
<p>Your Morning Box sign-in code:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
<p>It expires in ${ttlMinutes} minutes. If you didn’t ask for it, you can ignore this email.</p></div>`
  });
}
