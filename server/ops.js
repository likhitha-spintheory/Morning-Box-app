import { Router } from 'express';
import { db, json, parse, tx } from './db.js';
import { ApiError, bad, needsGlutenFreeHandling } from './rules.js';
import { requireUser } from './auth.js';
import { componentName } from '../src/domain/app.js';
import { EXCEPTION_KINDS } from '../src/domain/standards.js';

const OPS_KEY = process.env.OPS_KEY || 'dev-ops-key';
const DEV = process.env.NODE_ENV !== 'production';

/* ---------- Operations & bakery API (MB-OPS-001, MB-BKY-001) ---------- */
export const opsRouter = Router();
opsRouter.use((req, _res, next) => {
  if (req.get('x-ops-key') !== OPS_KEY) return next(new ApiError(401, 'unauthorised', 'Operations key required.'));
  next();
});

opsRouter.get('/bakeries', (_req, res) => res.json(db.prepare('SELECT * FROM bakeries WHERE active = 1 ORDER BY distance_km').all()));

function dayRows(date) {
  const personal = db.prepare(`SELECT d.*, o.user_id FROM order_days d JOIN orders o ON o.id = d.order_id WHERE d.date = ? AND d.cancelled = 0`).all(date)
    .map(d => {
      const cfg = parse(d.cfg); const inputs = parse(d.trace).inputs;
      return {
        kind: 'personal', id: d.id, orderId: d.order_id, window: d.window, boxes: 1, stage: d.stage,
        bakeryId: d.bakery_id, glutenFree: needsGlutenFreeHandling(inputs.dietary, inputs.allergies),
        production: [{ qty: 1, size: cfg.size, components: cfg.components.map(componentName), addons: cfg.addons, special: [...inputs.dietary, ...inputs.allergies] }],
        address: parse(d.address)
      };
    });
  const business = db.prepare(`SELECT * FROM business_days WHERE date = ? AND cancelled = 0`).all(date)
    .map(d => {
      const specials = parse(d.specials);
      return {
        kind: 'business', id: d.id, orderId: d.order_id, window: d.window, boxes: d.people, stage: d.stage,
        allocation: parse(d.allocation), glutenFree: specials.some(s => needsGlutenFreeHandling(s.dietary, s.allergies)),
        production: [...parse(d.lines).map(l => ({ qty: l.qty, size: l.size, recipeId: l.recipeId })),
          ...specials.map(s => ({ qty: s.qty, size: 'regular', recipeId: s.recipeId, special: [...s.dietary, ...s.allergies] }))],
        address: parse(d.delivery)
      };
    });
  return [...personal, ...business];
}

/** Production & delivery list for one morning. */
opsRouter.get('/days', (req, res) => {
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('date_invalid', 'Pass ?date=YYYY-MM-DD');
  res.json(dayRows(date));
});

/**
 * Allocation at cutoff (MB-B2B-001 §9, MB-DLV-001 §7):
 * filter by eligibility (gluten-free handling) and remaining capacity, then
 * proximity first. Business orders use Single Bakery First and expand to the
 * next nearest eligible bakery only when capacity requires it.
 */
opsRouter.post('/allocate', (req, res) => {
  const date = String(req.body.date || '');
  const bakeries = db.prepare('SELECT * FROM bakeries WHERE active = 1 ORDER BY distance_km').all();
  const left = Object.fromEntries(bakeries.map(b => [b.id, b.daily_capacity]));
  const result = tx(() => dayRows(date).sort((a, b) => b.boxes - a.boxes).map(row => {
    const eligible = bakeries.filter(b => !row.glutenFree || b.gluten_free_certified);
    const single = eligible.find(b => left[b.id] >= row.boxes);
    let parts;
    if (single) parts = [{ bakeryId: single.id, boxes: row.boxes }];
    else if (row.kind === 'business') {
      parts = []; let need = row.boxes;
      for (const b of eligible) { if (need <= 0) break; const take = Math.min(left[b.id], need); if (take > 0) { parts.push({ bakeryId: b.id, boxes: take }); need -= take; } }
      if (need > 0) parts = null;
    }
    if (!parts) {
      db.prepare('INSERT INTO exceptions (ref, kind, note) VALUES (?, ?, ?)').run(`${row.kind}:${row.id}`, 'Capacity Issue', `No eligible capacity on ${date}`);
      return { ...row, allocated: false };
    }
    parts.forEach(p => { left[p.bakeryId] -= p.boxes; });
    if (row.kind === 'personal') db.prepare('UPDATE order_days SET bakery_id = ? WHERE id = ?').run(parts[0].bakeryId, row.id);
    else db.prepare('UPDATE business_days SET allocation = ? WHERE id = ?').run(json(parts), row.id);
    return { ...row, allocated: true, parts };
  }));
  res.json({ date, allocations: result.map(r => ({ kind: r.kind, id: r.id, boxes: r.boxes, allocated: r.allocated, parts: r.parts || null })) });
});

/** Customer-facing stage: 0 Confirmed, 1 Being prepared, 2 Out for delivery, 3 Delivered. Forward only. */
function setStage(kind, id, stage, point) {
  const table = kind === 'business' ? 'business_days' : 'order_days';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new ApiError(404, 'not_found', 'Unknown delivery.');
  if (row.cancelled) throw bad('cancelled', 'This delivery was cancelled.');
  if (!Number.isInteger(stage) || stage < row.stage || stage > 3) throw bad('stage_invalid', 'Status can only move forward.');
  db.prepare(`UPDATE ${table} SET stage = ? WHERE id = ?`).run(stage, id);
  if (stage === 3 && kind !== 'business') {
    db.prepare(`UPDATE order_days SET delivered_at = datetime('now'), delivery_point = ? WHERE id = ?`).run(point || 'Reception', id);
  }
}
opsRouter.post('/days/:kind/:id/stage', (req, res) => {
  setStage(req.params.kind, Number(req.params.id), Number(req.body.stage), req.body.deliveryPoint);
  res.json({ ok: true });
});

opsRouter.get('/exceptions', (_req, res) => res.json(db.prepare('SELECT * FROM exceptions ORDER BY resolved, created_at DESC').all()));
opsRouter.post('/exceptions', (req, res) => {
  if (!EXCEPTION_KINDS.includes(req.body.kind)) throw bad('kind_invalid', `kind must be one of: ${EXCEPTION_KINDS.join(', ')}`);
  const r = db.prepare('INSERT INTO exceptions (ref, kind, note) VALUES (?, ?, ?)').run(String(req.body.ref || ''), req.body.kind, String(req.body.note || ''));
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
opsRouter.post('/exceptions/:id/resolve', (req, res) => {
  db.prepare('UPDATE exceptions SET resolved = 1 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------- Demo helper: lets a signed-in customer step their own delivery through the stages ---------- */
export const demoRouter = Router();
demoRouter.post('/advance', requireUser, (req, res) => {
  if (!DEV) throw new ApiError(404, 'not_found', 'Not found.');
  const { kind = 'personal', orderId, date } = req.body;
  const row = kind === 'business'
    ? db.prepare(`SELECT d.id, d.stage FROM business_days d JOIN business_orders o ON o.id = d.order_id WHERE o.id = ? AND o.user_id = ? AND d.date = ?`).get(orderId, req.userId, date)
    : db.prepare(`SELECT d.id, d.stage, d.bakery_id FROM order_days d JOIN orders o ON o.id = d.order_id WHERE o.id = ? AND o.user_id = ? AND d.date = ?`).get(orderId, req.userId, date);
  if (!row) throw new ApiError(404, 'not_found', 'Not found.');
  if (kind !== 'business' && !row.bakery_id) {
    const b = db.prepare('SELECT id FROM bakeries WHERE active = 1 ORDER BY distance_km LIMIT 1').get();
    db.prepare('UPDATE order_days SET bakery_id = ? WHERE id = ?').run(b.id, row.id);
  }
  setStage(kind, row.id, Math.min(3, row.stage + 1));
  res.json({ ok: true });
});
