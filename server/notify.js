/* Customer notifications (MB-DLV-001 §5, MB-OPS-001 §8).
   This is an outbox only: rows are written here and an SMS / email / push
   provider consumes them (integration point). The app also lists them under
   GET /api/me/notifications. */
import { db } from './db.js';

export const NOTIFICATION_KINDS = ['confirmed', 'on_the_way', 'delivered', 'late', 'refund', 'issue_update'];

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
