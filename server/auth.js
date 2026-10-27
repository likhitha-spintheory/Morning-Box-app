import { Router } from 'express';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db, parse } from './db.js';
import { ApiError, bad, emailOk } from './rules.js';
import { TERMS_VERSION } from './company.js';
import { ACTIVE_AREAS } from '../src/domain/standards.js';
import { DEV } from './env.js';
import { mailConfigured, sendCodeEmail } from './mail.js';
import { whatsappConfigured, sendWhatsAppCode } from './whatsapp.js';
const OTP_TTL_MS = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;           // matches the 30 s resend timer in the app
const OTP_SENDS_PER_HOUR = 5;              // per mobile number or email
const OTP_ATTEMPTS_PER_CODE = 5;
const OTP_FAILURES_PER_HOUR = 10;          // per mobile number or email, across resends
export const SESSION_TTL_MS = 30 * 24 * HOUR;
export const SESSION_COOKIE = 'mb_session';

const hash = s => createHash('sha256').update(String(s)).digest('hex');
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const minutes = ms => Math.max(1, Math.ceil(ms / 60000));

/** The client a limit applies to: its IPv4 address, or its IPv6 /64 network (one
    device or household usually owns a whole /64, so per-address limits are easy to dodge). */
export function clientKey(req) {
  const ip = String(req.ip || '');
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${full.slice(0, 4).map(g => g || '0').join(':')}::/64`;
}

/** Small in-memory per-IP limiter for the public endpoints. */
const hits = new Map();
export function limitIp(req, key, max, windowMs = HOUR) {
  const id = `${key}:${clientKey(req)}`;
  const now = Date.now();
  const h = hits.get(id);
  if (!h || now - h.start > windowMs) { hits.set(id, { start: now, n: 1 }); return; }
  if (++h.n > max) throw new ApiError(429, 'rate_limited', `Too many attempts from this device. Try again in ${minutes(windowMs - (now - h.start))} minutes.`);
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.start > HOUR) hits.delete(k); }, HOUR).unref();

/** Staff codes (operations key and bakery access codes): after 20 wrong codes in an hour a device is blocked for the rest of it. */
const STAFF_FAILURES = 20;
export function checkStaffCode(req, kind, ok) {
  const id = `staff-${kind}:${clientKey(req)}`;
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
/** Normalises an email used to sign in (lower case, trimmed). */
export function normaliseEmail(e) {
  const v = String(e || '').trim().toLowerCase();
  if (!emailOk(v)) throw bad('email_invalid', 'Enter a valid email, e.g. name@company.com.');
  return v;
}

/** Who a sign-in code is for and how it is delivered: a mobile number (by WhatsApp) or an email address.
    `key` identifies its row in otp_codes. */
function codeTarget(body) {
  if (typeof body.email === 'string' && body.email.trim()) {
    const email = normaliseEmail(body.email);
    return { key: `email:${email}`, email, via: 'email', ready: mailConfigured, send: code => sendCodeEmail(email, code, OTP_TTL_MS / 60000),
      unavailable: () => new ApiError(503, 'email_unavailable', 'Email sign-in is not available right now. Use your mobile number instead.') };
  }
  const mobile = normaliseMobile(body.mobile);
  return { key: mobile, mobile, via: 'WhatsApp', ready: whatsappConfigured, send: code => sendWhatsAppCode(mobile, code),
    unavailable: () => new ApiError(503, 'whatsapp_unavailable', 'WhatsApp sign-in is not available right now. Use your email instead.') };
}

export const prettyMobile = m => (m.startsWith('+971') ? `+971 ${m.slice(4, 6)} ${m.slice(6, 9)} ${m.slice(9)}` : '');

/** First names are shown back to the customer and printed on labels: plain text only. */
export const cleanName = v => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>{}[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

export function userPayload(userId) {
  const u = db.prepare('SELECT id, mobile, first_name, email, login_email, terms_version, marketing_opt_in FROM users WHERE id = ?').get(userId);
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const a = db.prepare('SELECT * FROM addresses WHERE user_id = ?').get(userId);
  const b = db.prepare('SELECT company, email FROM business_accounts WHERE user_id = ?').get(userId);
  return {
    user: { firstName: u.first_name, mobile: prettyMobile(u.mobile), email: u.email || '', loginEmail: u.login_email || '' },
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
/* Sessions are stored by the SHA-256 of their token, so a copy of the database cannot be used to sign in.
   Rows written by earlier versions held the token itself (48 hex characters); they are converted once here. */
const tokenHash = t => hash(`session:${t}`);
for (const s of db.prepare('SELECT token FROM sessions WHERE length(token) <> 64').all()) {
  db.prepare('UPDATE sessions SET token = ? WHERE token = ?').run(tokenHash(s.token), s.token);
}
/** The signed-in user for a session token, or null (expired or unknown). */
export function sessionUserId(token) {
  if (!token) return null;
  const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(tokenHash(token));
  return s && (!s.expires_at || s.expires_at >= Date.now()) ? s.user_id : null;
}

export function requireUser(req, res, next) {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const fromCookie = !bearer;
  const token = bearer || cookieToken(req);
  const key = token ? tokenHash(token) : '';
  const s = token && db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(key);
  const now = Date.now();
  if (!s || (s.expires_at && s.expires_at < now)) {
    if (s) db.prepare('DELETE FROM sessions WHERE token = ?').run(key);
    if (fromCookie && token) clearSessionCookie(res);
    return next(new ApiError(401, 'unauthorised', 'Please sign in again.'));
  }
  /* Cookie-authenticated writes must be JSON requests from the app itself (blocks cross-site form posts). */
  if (fromCookie && req.method !== 'GET' && !req.is('application/json')) return next(new ApiError(403, 'forbidden', 'Request not allowed.'));
  if (!s.expires_at || s.expires_at - now < SESSION_TTL_MS - 24 * HOUR) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(now + SESSION_TTL_MS, key);
    if (fromCookie) setSessionCookie(res, token);
  }
  req.userId = s.user_id; req.token = token; req.sessionKey = key;
  next();
}

/** Issue a code for a number or email (its otp_codes key), enforcing resend spacing and hourly limits. Returns the code. */
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
    throw new ApiError(429, 'otp_limit', `Too many codes requested. Try again in ${minutes(HOUR - (now - row.window_start))} minutes.`);
  }
  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  db.prepare(`INSERT INTO otp_codes (mobile, code, expires_at, attempts, sends, window_start, last_sent, failures) VALUES (?, ?, ?, 0, ?, ?, ?, ?)
    ON CONFLICT(mobile) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0, sends = excluded.sends,
    window_start = excluded.window_start, last_sent = excluded.last_sent, failures = excluded.failures`)
    .run(mobile, hash(code), now + OTP_TTL_MS, sends + 1, fresh ? now : row.window_start, now, failures);
  return code;
}

/** Check a code without consuming it. Throws on any failure. `via` names where the code was sent. */
function checkCode(mobile, code, via = 'WhatsApp') {
  const now = Date.now();
  const row = db.prepare('SELECT * FROM otp_codes WHERE mobile = ?').get(mobile);
  if (!row || !row.code || row.expires_at < now) throw bad('otp_expired', 'That code has expired. Request a new one.');
  if (row.failures >= OTP_FAILURES_PER_HOUR && now - row.window_start <= HOUR) {
    throw new ApiError(429, 'otp_limit', `Too many attempts. Try again in ${minutes(HOUR - (now - row.window_start))} minutes.`);
  }
  if (row.attempts >= OTP_ATTEMPTS_PER_CODE) throw bad('otp_locked', 'Too many attempts. Request a new code.');
  if (!/^\d{6}$/.test(String(code ?? '')) || !sameHash(hash(code), row.code)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1, failures = failures + 1 WHERE mobile = ?').run(mobile);
    throw bad('otp_wrong', `That code doesn’t match. Check the ${via} and try again.`);
  }
}
const consumeCode = mobile => db.prepare("UPDATE otp_codes SET code = '', expires_at = 0 WHERE mobile = ?").run(mobile);

export const authRouter = Router();

/* MB-FLW-001 §7: Mobile Number + OTP + First Name, or Email + OTP + First Name.
   The body has `mobile` or `email`. The response is the same for new and registered
   numbers and addresses (no account enumeration). */
authRouter.post('/otp', (req, res, next) => {
  limitIp(req, 'otp', 60);   // generous: a whole office can share one IP
  const target = codeTarget(req.body);
  /* Fail before using up one of the hourly sends when the code can't be delivered. */
  if (!DEV && !target.ready()) throw target.unavailable();
  const code = issueCode(target.key);
  /* Development without the provider configured: the code is logged and returned so the demo works end to end. */
  if (DEV) console.log(`[otp] ${target.mobile || target.email} → ${code}`);
  if (DEV && !target.ready()) return res.json({ sent: true, devCode: code });
  target.send(code)
    .then(() => res.json({ sent: true, ...(DEV ? { devCode: code } : {}) }))
    .catch(e => {
      /* Not delivered: withdraw the code and let the customer retry straight away. */
      db.prepare("UPDATE otp_codes SET code = '', expires_at = 0, last_sent = NULL, sends = MAX(sends - 1, 0) WHERE mobile = ?").run(target.key);
      next(e);
    });
});

authRouter.post('/verify', (req, res) => {
  limitIp(req, 'verify', 120);
  const target = codeTarget(req.body);
  checkCode(target.key, req.body.code, target.via);
  let user = target.mobile
    ? db.prepare('SELECT id FROM users WHERE mobile = ?').get(target.mobile)
    : db.prepare('SELECT id FROM users WHERE login_email = ?').get(target.email);
  const firstName = cleanName(req.body.firstName);
  if (!user) {
    /* New number or email: the code stays valid so the app can ask for a first name and retry. */
    if (!firstName) throw bad('name_required', 'Enter your first name to create your account.');
    const r = target.mobile
      ? db.prepare('INSERT INTO users (mobile, first_name) VALUES (?, ?)').run(target.mobile, firstName)
      : db.prepare('INSERT INTO users (mobile, first_name, email, login_email) VALUES (?, ?, ?, ?)')
        .run(`none:${randomBytes(8).toString('hex')}`, firstName, target.email, target.email);
    user = { id: Number(r.lastInsertRowid) };
  }
  consumeCode(target.key);
  /* Signing in confirms the Terms and Privacy Policy shown on the sign-in screen (current version). */
  db.prepare("UPDATE users SET terms_version = ?, terms_accepted_at = datetime('now') WHERE id = ?").run(TERMS_VERSION, user.id);
  const token = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), user.id, Date.now() + SESSION_TTL_MS);
  setSessionCookie(res, token);
  res.json({ token, ...userPayload(user.id) });
});

authRouter.post('/logout', requireUser, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionKey);
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

/** Add or change the email the account signs in with: the address must be verified with its own code
    (request it with POST /auth/otp { email } first). Also fills the contact email when it is empty. */
authRouter.post('/change-email', requireUser, (req, res) => {
  limitIp(req, 'verify', 120);
  const email = normaliseEmail(req.body.email);
  const taken = db.prepare('SELECT id FROM users WHERE login_email = ?').get(email);
  if (taken && taken.id !== req.userId) throw bad('email_taken', 'That email already has a Morning Box account.');
  checkCode(`email:${email}`, req.body.code, 'email');
  consumeCode(`email:${email}`);
  db.prepare("UPDATE users SET login_email = ?, email = COALESCE(NULLIF(email, ''), ?) WHERE id = ?").run(email, email, req.userId);
  res.json(userPayload(req.userId));
});
