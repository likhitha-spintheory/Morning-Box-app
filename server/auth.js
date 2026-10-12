import { Router } from 'express';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db, parse } from './db.js';
import { ApiError, bad } from './rules.js';
import { TERMS_VERSION } from './company.js';
import { ACTIVE_AREAS } from '../src/domain/standards.js';

const DEV = process.env.NODE_ENV !== 'production';
const OTP_TTL_MS = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;           // matches the 30 s resend timer in the app
const OTP_SENDS_PER_HOUR = 5;              // per mobile number
const OTP_ATTEMPTS_PER_CODE = 5;
const OTP_FAILURES_PER_HOUR = 10;          // per mobile number, across resends
export const SESSION_TTL_MS = 30 * 24 * HOUR;
export const SESSION_COOKIE = 'mb_session';

const hash = s => createHash('sha256').update(String(s)).digest('hex');
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const minutes = ms => Math.max(1, Math.ceil(ms / 60000));

/** Small in-memory per-IP limiter for the public auth endpoints. */
const hits = new Map();
function limitIp(req, key, max, windowMs = HOUR) {
  const id = `${key}:${req.ip}`;
  const now = Date.now();
  const h = hits.get(id);
  if (!h || now - h.start > windowMs) { hits.set(id, { start: now, n: 1 }); return; }
  if (++h.n > max) throw new ApiError(429, 'rate_limited', `Too many attempts from this device. Try again in ${minutes(windowMs - (now - h.start))} minutes.`);
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.start > HOUR) hits.delete(k); }, HOUR).unref();

/** Staff codes (operations key, bakery and courier access codes): after 20 wrong codes in an hour a device is blocked for the rest of it. */
const STAFF_FAILURES = 20;
export function checkStaffCode(req, kind, ok) {
  const id = `staff-${kind}:${req.ip}`;
  const now = Date.now();
  let h = hits.get(id);
  if (h && now - h.start > HOUR) { hits.delete(id); h = null; }
  if (h && h.n >= STAFF_FAILURES) throw new ApiError(429, 'rate_limited', `Too many wrong codes from this device. Try again in ${minutes(HOUR - (now - h.start))} minutes.`);
  if (!ok) { if (h) h.n++; else hits.set(id, { start: now, n: 1 }); }
}

/** Normalises a UAE mobile to +9715XXXXXXXX. */
export function normaliseMobile(m) {
  const d = String(m || '').replace(/\D/g, '').replace(/^00/, '').replace(/^971/, '').replace(/^0/, '');
  if (!/^5\d{8}$/.test(d)) throw bad('mobile_invalid', 'Enter a UAE mobile number, e.g. 50 123 4567.');
  return `+971${d}`;
}
export const prettyMobile = m => (m.startsWith('+971') ? `+971 ${m.slice(4, 6)} ${m.slice(6, 9)} ${m.slice(9)}` : '');

/** First names are shown back to the customer and printed on labels: plain text only. */
export const cleanName = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>{}[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

export function userPayload(userId) {
  const u = db.prepare('SELECT id, mobile, first_name, email, terms_version, marketing_opt_in FROM users WHERE id = ?').get(userId);
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const a = db.prepare('SELECT * FROM addresses WHERE user_id = ?').get(userId);
  const b = db.prepare('SELECT company, email FROM business_accounts WHERE user_id = ?').get(userId);
  return {
    user: { firstName: u.first_name, mobile: prettyMobile(u.mobile), email: u.email || '' },
    profile: p?.eating_style ? {
      eatingStyle: p.eating_style, preferences: parse(p.preferences), dietary: parse(p.dietary), allergies: parse(p.allergies),
      otherAllergies: p.other_allergies || ''
    } : null,
    settings: { coffeeReminder: p ? !!p.coffee_reminder : true, offers: !!u.marketing_opt_in },
    termsAccepted: u.terms_version === TERMS_VERSION,
    address: a ? { building: a.building || '', unit: a.unit || '', area: a.area || ACTIVE_AREAS[0], handover: a.handover || 'reception', notes: a.notes || '' } : null,
    defaultWindow: a?.default_window || null,
    business: b ? { company: b.company, email: b.email } : null
  };
}

function cookieToken(req) {
  const raw = req.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  return '';
}
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: !DEV, path: '/', maxAge: SESSION_TTL_MS });
}
const clearSessionCookie = res => res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: !DEV, path: '/' });

/**
 * Requires a session: the httpOnly cookie set at sign-in (web app) or
 * `Authorization: Bearer <token>` (API clients). Sessions expire after 30 days
 * without use. Sets req.userId.
 */
export function requireUser(req, res, next) {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const fromCookie = !bearer;
  const token = bearer || cookieToken(req);
  const s = token && db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token);
  const now = Date.now();
  if (!s || (s.expires_at && s.expires_at < now)) {
    if (s) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    if (fromCookie && token) clearSessionCookie(res);
    return next(new ApiError(401, 'unauthorised', 'Please sign in again.'));
  }
  /* Cookie-authenticated writes must be JSON requests from the app itself (blocks cross-site form posts). */
  if (fromCookie && req.method !== 'GET' && !req.is('application/json')) return next(new ApiError(403, 'forbidden', 'Request not allowed.'));
  if (!s.expires_at || s.expires_at - now < SESSION_TTL_MS - 24 * HOUR) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(now + SESSION_TTL_MS, token);
    if (fromCookie) setSessionCookie(res, token);
  }
  req.userId = s.user_id; req.token = token;
  next();
}

/** Issue a code for a number, enforcing resend spacing and hourly limits. Returns the code. */
function issueCode(mobile) {
  const now = Date.now();
  const row = db.prepare('SELECT * FROM otp_codes WHERE mobile = ?').get(mobile);
  const fresh = !row || !row.window_start || now - row.window_start > HOUR;
  const sends = fresh ? 0 : row.sends;
  const failures = fresh ? 0 : row.failures;
  if (row?.last_sent && now - row.last_sent < OTP_RESEND_MS) {
    throw new ApiError(429, 'otp_wait', `Please wait ${Math.ceil((OTP_RESEND_MS - (now - row.last_sent)) / 1000)} seconds before requesting another code.`);
  }
  if (sends >= OTP_SENDS_PER_HOUR || failures >= OTP_FAILURES_PER_HOUR) {
    throw new ApiError(429, 'otp_limit', `Too many codes requested for this number. Try again in ${minutes(HOUR - (now - row.window_start))} minutes.`);
  }
  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  db.prepare(`INSERT INTO otp_codes (mobile, code, expires_at, attempts, sends, window_start, last_sent, failures) VALUES (?, ?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(mobile) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0, sends = excluded.sends,
    window_start = excluded.window_start, last_sent = excluded.last_sent, failures = excluded.failures`)
    .run(mobile, hash(code), now + OTP_TTL_MS, sends + 1, fresh ? now : row.window_start, now, failures);
  return code;
}

/** Check a code without consuming it. Throws on any failure. */
function checkCode(mobile, code) {
  const now = Date.now();
  const row = db.prepare('SELECT * FROM otp_codes WHERE mobile = ?').get(mobile);
  if (!row || !row.code || row.expires_at < now) throw bad('otp_expired', 'That code has expired. Request a new one.');
  if (row.failures >= OTP_FAILURES_PER_HOUR && now - row.window_start <= HOUR) {
    throw new ApiError(429, 'otp_limit', `Too many attempts. Try again in ${minutes(HOUR - (now - row.window_start))} minutes.`);
  }
  if (row.attempts >= OTP_ATTEMPTS_PER_CODE) throw bad('otp_locked', 'Too many attempts. Request a new code.');
  if (!/^\d{6}$/.test(String(code ?? '')) || !sameHash(hash(code), row.code)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1, failures = failures + 1 WHERE mobile = ?').run(mobile);
    throw bad('otp_wrong', 'That code doesn’t match. Check the SMS and try again.');
  }
}
const consumeCode = mobile => db.prepare("UPDATE otp_codes SET code = '', expires_at = 0 WHERE mobile = ?").run(mobile);

export const authRouter = Router();

/* MB-FLW-001 §7: Mobile Number + OTP + First Name.
   The response is the same for new and registered numbers (no account enumeration). */
authRouter.post('/otp', (req, res) => {
  limitIp(req, 'otp', 60);   // generous: a whole office can share one IP
  const mobile = normaliseMobile(req.body.mobile);
  const code = issueCode(mobile);
  // SMS provider integration point. In development the code is returned so the demo works end to end.
  if (DEV) console.log(`[otp] ${mobile} → ${code}`);
  res.json({ sent: true, ...(DEV ? { devCode: code } : {}) });
});

authRouter.post('/verify', (req, res) => {
  limitIp(req, 'verify', 120);
  const mobile = normaliseMobile(req.body.mobile);
  checkCode(mobile, req.body.code);
  let user = db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile);
  const firstName = cleanName(req.body.firstName);
  if (!user) {
    /* New number: the code stays valid so the app can ask for a first name and retry. */
    if (!firstName) throw bad('name_required', 'Enter your first name to create your account.');
    user = { id: Number(db.prepare('INSERT INTO users (mobile, first_name) VALUES (?, ?)').run(mobile, firstName).lastInsertRowid) };
  }
  consumeCode(mobile);
  /* Signing in confirms the Terms and Privacy Policy shown on the sign-in screen (current version). */
  db.prepare("UPDATE users SET terms_version = ?, terms_accepted_at = datetime('now') WHERE id = ?").run(TERMS_VERSION, user.id);
  const token = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, Date.now() + SESSION_TTL_MS);
  setSessionCookie(res, token);
  res.json({ token, ...userPayload(user.id) });
});

authRouter.post('/logout', requireUser, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Sign out on every device (e.g. after losing a phone). */
authRouter.post('/logout-all', requireUser, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.userId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** Change the account's mobile number: the new number must be verified with its own code
    (request it with POST /auth/otp first). */
authRouter.post('/change-mobile', requireUser, (req, res) => {
  limitIp(req, 'verify', 120);
  const mobile = normaliseMobile(req.body.mobile);
  const taken = db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile);
  if (taken && taken.id !== req.userId) throw bad('mobile_taken', 'That number already has a Morning Box account.');
  checkCode(mobile, req.body.code);
  consumeCode(mobile);
  db.prepare('UPDATE users SET mobile = ? WHERE id = ?').run(mobile, req.userId);
  res.json(userPayload(req.userId));
});
