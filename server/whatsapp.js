/* WhatsApp messages through Meta's WhatsApp Cloud API (sign-in codes).
   Configured by WHATSAPP_TOKEN (a system-user access token), WHATSAPP_PHONE_NUMBER_ID (the sending
   number's ID in WhatsApp Manager) and WHATSAPP_TEMPLATE: an approved template in the
   "Authentication" category with a copy-code button (default name `morningbox_login`, language
   WHATSAPP_TEMPLATE_LANG, default `en`). */
import { ApiError } from './rules.js';

export const whatsappConfigured = (env = process.env) => !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

/** Send a sign-in code to a +971… mobile. Throws a 503 when not configured and a 502 when Meta refuses it. */
export async function sendWhatsAppCode(mobile, code) {
  if (!whatsappConfigured()) throw new ApiError(503, 'whatsapp_unavailable', 'WhatsApp sign-in is not available right now. Use your email instead.');
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: mobile.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE || 'morningbox_login',
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
      /* Authentication templates take the code twice: in the body and for the copy-code button. */
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }
      ]
    }
  };
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (e) {
    console.error('[whatsapp] request failed:', e.message);
    throw new ApiError(502, 'whatsapp_failed', 'We couldn’t send the WhatsApp message. Please try again, or use your email.');
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({})))?.error || {};
    console.error(`[whatsapp] Meta ${res.status} (${err.code}):`, String(err.message || '').slice(0, 300));
    throw new ApiError(502, 'whatsapp_failed', 'We couldn’t send the WhatsApp message. Please try again, or use your email.');
  }
}
