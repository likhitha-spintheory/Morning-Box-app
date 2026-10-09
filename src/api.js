/* Thin client for the Morning Box API (/api, proxied to the Node server in dev). */
const KEY = 'morningbox.app.v1';

let current;
/** Set immediately on sign-in / sign-out so requests don't wait for persistence. */
export const setToken = t => { current = t; };
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
  try {
    res = await fetch(`./api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, { error: 'offline', message: 'Can’t reach Morning Box right now. Check your connection and try again.' });
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === 'object' ? data : null);
  return data;
}

export const get = p => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);

/** Download an authenticated HTML document (e.g. a business invoice). */
export async function download(path, filename) {
  const html = await api('GET', path);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Applies a /auth/verify or /me payload to the store draft. */
export function applySession(s, payload) {
  if (payload.token) { s.session = { token: payload.token }; setToken(payload.token); }
  s.user = payload.user;
  if (payload.profile && !s.profileDone) { s.profile = payload.profile; s.profileDone = true; }
  if (payload.settings) s.settings = { ...s.settings, ...payload.settings };
  if (payload.address && !s.delivery.address.building) s.delivery.address = { ...s.delivery.address, ...payload.address };
  if (payload.defaultWindow && !s.delivery.window) s.delivery.window = payload.defaultWindow;
  if (payload.business) s.businessUser = { firstName: payload.user.firstName, mobile: payload.user.mobile, ...payload.business };
}
