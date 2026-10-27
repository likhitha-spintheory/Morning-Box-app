/* Thin client for the Morning Box API (/api, proxied to the Node server in dev).
   The session lives in an httpOnly cookie set by the server at sign-in, so no
   token is kept where page scripts can read it. A token saved by an earlier
   version of the app is still sent until that session ends. */
const KEY = 'morningbox.app.v1';
export const UNAUTHORISED_EVENT = 'morningbox:unauthorised';

let current;
/** Legacy bearer token (older app versions); null once signed in with the cookie session. */
export const setToken = t => { current = t || null; };
function token() {
  if (current !== undefined) return current;
  try { return JSON.parse(localStorage.getItem(KEY) || '{}').session?.token || null; } catch { return null; }
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || 'Something went wrong. Please try again.');
    this.status = status; this.code = body?.error; this.details = body?.details;
  }
}

export async function api(method, path, body) {
  let res;
  const t = token();
  try {
    res = await fetch(`./api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, { error: 'offline', message: 'Can’t reach Morning Box right now. Check your connection and try again.' });
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    /* An expired or revoked session signs the app out everywhere it is open. */
    if (res.status === 401 && !path.startsWith('/auth/')) {
      setToken(null);
      window.dispatchEvent(new Event(UNAUTHORISED_EVENT));
    }
    throw new ApiError(res.status, typeof data === 'object' ? data : null);
  }
  return data;
}

export const get = p => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);

/** Payment: when the server answers { checkout }, open the payment page; the app comes back to #/pay/<id>.
    Returns a promise that never settles, so the screen keeps showing "Processing…" while the page changes. */
export const goToPayment = checkout => { window.location.assign(checkout.url); return new Promise(() => {}); };
export const del = p => api('DELETE', p);
/** Fire-and-forget product analytics for the MVP KPIs (funnel, no-match). Never blocks the screen. */
export const track = (kind, data) => { api('POST', '/events', { kind, data }).catch(() => {}); };

/** A fresh key that makes a payment request safe to retry (double taps, flaky networks). */
export const newIdempotencyKey = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Download an authenticated HTML document (e.g. a business invoice).
    In the Android app the file is saved and the share sheet opens (save, email, print). */
export async function download(path, filename, type = 'text/html') {
  const raw = await api('GET', path);
  const html = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  if (window.Capacitor?.isNativePlatform?.()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const { uri } = await Filesystem.writeFile({ path: filename, data: html, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename.replace(/\.html$/, ''), url: uri, dialogTitle: 'Save or share' });
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Share a short text (WhatsApp, Messages…). Falls back to copying it when sharing isn't available. */
export async function shareText(text) {
  if (window.Capacitor?.isNativePlatform?.()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({ text, dialogTitle: 'Share' });
  } else if (navigator.share) await navigator.share({ text });
  else await navigator.clipboard?.writeText(text);
}

/** Clears one customer's data from this device before another customer's session is applied. */
export function resetPersonal(s) {
  s.profile = { eatingStyle: null, preferences: [], dietary: [], allergies: [], otherAllergies: '' };
  s.profileDone = false;
  s.plan = { dates: [], days: {} };
  s.delivery = { sameForAll: null, address: { building: '', unit: '', area: 'DIFC', handover: 'reception', notes: '' }, window: null, perDay: {} };
  s.orders = []; s.businessOrders = []; s.businessUser = null; s.savedPlans = [];
}

/** Who a signed-in account is, for noticing a switch of account on this device: its mobile, or its sign-in email when it has none. */
/** Sign-in methods the server can deliver codes for (from /api/config). Email is the default. */
export const signIn = { email: true, mobile: true };
export const applySignIn = m => { if (m && typeof m === 'object') Object.assign(signIn, { email: m.email !== false, mobile: m.mobile !== false }); };

export const ownerOf = user => user?.mobile || user?.loginEmail || '';

/** Applies a /auth/verify or /me payload to the store draft.
    The session marker holds no secret: the cookie carries the session. */
export function applySession(s, payload) {
  if (payload.token) { s.session = { active: true }; setToken(null); s.owner = ownerOf(payload.user); }
  s.user = payload.user;
  if (payload.profile && !s.profileDone) { s.profile = { otherAllergies: '', ...payload.profile }; s.profileDone = true; }
  if (payload.settings) s.settings = { ...s.settings, ...payload.settings };
  if (payload.address && !s.delivery.address.building) s.delivery.address = { ...s.delivery.address, ...payload.address };
  if (payload.defaultWindow && !s.delivery.window) s.delivery.window = payload.defaultWindow;
  if (payload.business) s.businessUser = { firstName: payload.user.firstName, mobile: payload.user.mobile, ...payload.business };
}
