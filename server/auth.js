import { Router } from 'express';
import { randomBytes, randomInt } from 'node:crypto';
import { db, parse } from './db.js';
import { ApiError, bad } from './rules.js';

const DEV = process.env.NODE_ENV !== 'production';
const OTP_TTL_MS = 10 * 60 * 1000;

/** Normalises a UAE mobile to +9715XXXXXXXX. */
export function normaliseMobile(m) {
  const d = String(m || '').replace(/\D/g, '').replace(/^00/, '').replace(/^971/, '').replace(/^0/, '');
  if (!/^5\d{8}$/.test(d)) throw bad('mobile_invalid', 'Enter a UAE mobile number, e.g. 50 123 4567.');
  return `+971${d}`;
}
export const prettyMobile = m => `+971 ${m.slice(4, 6)} ${m.slice(6, 9)} ${m.slice(9)}`;

export function userPayload(userId) {
  const u = db.prepare('SELECT id, mobile, first_name, email FROM users WHERE id = ?').get(userId);
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
  const a = db.prepare('SELECT * FROM addresses WHERE user_id = ?').get(userId);
  const b = db.prepare('SELECT company, email FROM business_accounts WHERE user_id = ?').get(userId);
  return {
    user: { firstName: u.first_name, mobile: prettyMobile(u.mobile), email: u.email || '' },
    profile: p?.eating_style ? {
      eatingStyle: p.eating_style, preferences: parse(p.preferences), dietary: parse(p.dietary), allergies: parse(p.allergies)
    } : null,
    settings: { coffeeReminder: p ? !!p.coffee_reminder : true },
    address: a ? { building: a.building || '', unit: a.unit || '', area: a.area || 'DIFC', handover: a.handover || 'reception', notes: a.notes || '' } : null,
    defaultWindow: a?.default_window || null,
    business: b ? { company: b.company, email: b.email } : null
  };
}

/** Requires `Authorization: Bearer <token>`. Sets req.userId. */
export function requireUser(req, _res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const s = token && db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!s) return next(new ApiError(401, 'unauthorised', 'Please sign in again.'));
  req.userId = s.user_id; req.token = token;
  next();
}

export const authRouter = Router();

/* MB-FLW-001 §7: Mobile Number + OTP + First Name. */
authRouter.post('/otp', (req, res) => {
  const mobile = normaliseMobile(req.body.mobile);
  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('INSERT INTO otp_codes (mobile, code, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(mobile) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0')
    .run(mobile, code, Date.now() + OTP_TTL_MS);
  // SMS provider integration point. In development the code is returned so the demo works end to end.
  if (DEV) console.log(`[otp] ${mobile} → ${code}`);
  const known = db.prepare('SELECT first_name FROM users WHERE mobile = ?').get(mobile);
  res.json({ sent: true, existingUser: !!known, ...(DEV ? { devCode: code } : {}) });
});

authRouter.post('/verify', (req, res) => {
  const mobile = normaliseMobile(req.body.mobile);
  const row = db.prepare('SELECT * FROM otp_codes WHERE mobile = ?').get(mobile);
  if (!row || row.expires_at < Date.now()) throw bad('otp_expired', 'That code has expired. Request a new one.');
  if (row.attempts >= 5) throw bad('otp_locked', 'Too many attempts. Request a new code.');
  if (String(req.body.code) !== row.code) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE mobile = ?').run(mobile);
    throw bad('otp_wrong', 'That code doesn’t match. Check the SMS and try again.');
  }
  db.prepare('DELETE FROM otp_codes WHERE mobile = ?').run(mobile);
  let user = db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile);
  const firstName = typeof req.body.firstName === 'string' ? req.body.firstName.trim().slice(0, 60) : '';
  if (!user) {
    if (!firstName) throw bad('name_required', 'Enter your first name.');
    user = { id: Number(db.prepare('INSERT INTO users (mobile, first_name) VALUES (?, ?)').run(mobile, firstName).lastInsertRowid) };
  } else if (firstName) {
    db.prepare('UPDATE users SET first_name = ? WHERE id = ?').run(firstName, user.id);
  }
  const token = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.json({ token, ...userPayload(user.id) });
});

authRouter.post('/logout', requireUser, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});
