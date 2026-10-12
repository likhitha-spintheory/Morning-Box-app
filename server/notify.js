/* Customer notifications (MB-DLV-001 §5, MB-OPS-001 §8).
   This is an outbox only: rows are written here and an SMS / email / push
   provider consumes them (integration point). The app also lists them under
   GET /api/me/notifications. */
import { db } from './db.js';
import { dubaiHour, dubaiTodayIso, addDaysIso } from '../src/domain/standards.js';

export const NOTIFICATION_KINDS = ['confirmed', 'on_the_way', 'delivered', 'late', 'refund', 'issue_update', 'reminder', 'safety_review', 'cancelled', 'support_reply', 'changed'];

/** Queue a customer notification. Unknown users or kinds are ignored rather than failing the operation. */
export function notify(userId, ref, kind, message) {
  if (!userId || !NOTIFICATION_KINDS.includes(kind)) return null;
  const r = db.prepare('INSERT INTO notifications (user_id, ref, kind, message) VALUES (?, ?, ?, ?)')
    .run(userId, ref == null ? null : String(ref), kind, String(message || '').slice(0, 500));
  return Number(r.lastInsertRowid);
}

export function listNotifications(userId, limit = 50) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(userId, limit)
    .map(n => ({ id: n.id, ref: n.ref, kind: n.kind, message: n.message, createdAt: n.created_at, read: !!n.read_at, readAt: n.read_at }));
}

/** Mark the given ids (or all when ids is empty) as read. */
export function markRead(userId, ids = []) {
  if (Array.isArray(ids) && ids.length) {
    const st = db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id = ? AND read_at IS NULL");
    ids.forEach(id => st.run(userId, Number(id)));
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(userId);
  }
}

/** True when this user already has a notification of this kind for this ref. */
export const alreadyNotified = (userId, ref, kind) =>
  !!db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND ref = ? AND kind = ?').get(userId, String(ref), kind);

/**
 * Drink reminder (MB-FLW-001 confirmation screen): the evening before a
 * delivery, customers who kept the reminder on get one nudge per morning.
 * Runs from the server's scheduler (server/index.js); safe to call repeatedly.
 */
export const REMINDER_HOUR = 19;
export function queueDrinkReminders(now = new Date()) {
  if (dubaiHour(now) < REMINDER_HOUR) return 0;
  const tomorrow = addDaysIso(dubaiTodayIso(now), 1);
  const rows = db.prepare(`SELECT DISTINCT o.user_id, d.order_id, d.date FROM order_days d JOIN orders o ON o.id = d.order_id
    LEFT JOIN profiles p ON p.user_id = o.user_id
    WHERE d.date = ? AND d.cancelled = 0 AND COALESCE(p.coffee_reminder, 1) = 1`).all(tomorrow);
  let n = 0;
  for (const r of rows) {
    const ref = `${r.order_id}:${r.date}`;
    if (alreadyNotified(r.user_id, ref, 'reminder')) continue;
    notify(r.user_id, ref, 'reminder', 'Your Morning Box arrives tomorrow. Coffee or fresh juice? Have your drink ready.');
    n++;
  }
  return n;
}
