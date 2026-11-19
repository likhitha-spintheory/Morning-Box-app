/* Consent records (legal pack 04, Part B): every choice is kept with its version, date and time. */
import { db } from './db.js';
import { CONSENT_VERSION } from '../src/legal/documents.js';

export const CONSENT_KINDS = ['terms', 'health', 'marketing', 'cookies'];

/** Record one consent choice. `value` is a short string such as 'granted', 'withdrawn' or 'analytics:on'. */
export function logConsent(userId, kind, value, version = CONSENT_VERSION) {
  db.prepare('INSERT INTO consent_log (user_id, kind, value, version) VALUES (?, ?, ?, ?)').run(userId ?? null, kind, String(value).slice(0, 40), version);
}

/** Marketing opt-in or opt-out (B2), with the time of the choice. */
export function setMarketing(userId, on) {
  db.prepare("UPDATE users SET marketing_opt_in = ?, marketing_opt_in_at = datetime('now') WHERE id = ?").run(on ? 1 : 0, userId);
  logConsent(userId, 'marketing', on ? 'granted' : 'withdrawn');
}
