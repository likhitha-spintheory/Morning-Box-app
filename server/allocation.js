/* ============================================================
   Bakery allocation — MB-OPS-001 §2, MB-B2B-001 §9, MB-DLV-001 §7–8
   Product Capability → Dietary/Allergy Capability → Capacity → nearest.
   - Capacity is reserved when the customer orders: an order (or edit) is only
     accepted when the whole morning, including it, can still be allocated.
   - Provisional allocation runs as orders come in; Final Allocation runs at the
     9:00 PM cutoff. Orders a bakery has started are never moved.
   - Business: Single Bakery First; when no single bakery can take the order,
     it is split by line — Special Breakfasts go to bakeries able to make them.
   ============================================================ */
import { db, json, parse, tx } from './db.js';
import { bakeriesFor, bakeryCovers, bakeryMakes, danishFlavours, needsFor, needsGlutenFreeHandling, raiseException, bad, prettyDate } from './rules.js';
import { recipeById } from '../src/domain/recipes.js';
import { cutoffFor } from '../src/domain/standards.js';

const LOCKED = ['In Preparation', 'Ready', 'Handed Over', 'Delayed', 'Unable to Fulfil'];

/** Production units of one delivery: what must be made, and by a bakery able to make it. */
export function personalUnits(cfg, inputs) {
  return [{ entry: 0, qty: 1, special: !!(inputs.dietary.length + inputs.allergies.length), needs: needsFor(inputs.dietary, inputs.allergies),
    glutenFree: needsGlutenFreeHandling(inputs.dietary, inputs.allergies), items: [...cfg.components, ...(cfg.addons || []).map(a => a.item)],
    flavours: [...(cfg.addons || []).filter(a => a.flavour).map(a => a.flavour), ...(cfg.danishFlavour ? [cfg.danishFlavour] : [])] }];
}
export function businessUnits(lines, specials) {
  return [
    ...lines.map((l, i) => ({ entry: i, qty: l.qty, special: false, needs: [], glutenFree: false, items: recipeById[l.recipeId]?.components || [], flavours: [] })),
    ...specials.map((s, i) => ({ entry: lines.length + i, qty: s.qty, special: true, needs: needsFor(s.dietary, s.allergies), glutenFree: needsGlutenFreeHandling(s.dietary, s.allergies),
      items: s.components || recipeById[s.recipeId]?.components || [], flavours: [] }))
  ];
}
const canMake = (b, u) => bakeryCovers(b, u.needs) && (!u.glutenFree || b.gluten_free_certified) && bakeryMakes(b, u.items) && u.flavours.every(f => danishFlavours(b).includes(f));

function dayDemand(date) {
  const personal = db.prepare(`SELECT d.*, o.payment_status FROM order_days d JOIN orders o ON o.id = d.order_id WHERE d.date = ? AND d.cancelled = 0`).all(date).map(d => ({
    kind: 'personal', id: d.id, ref: `personal:${d.id}`, boxes: 1, units: personalUnits(parse(d.cfg), parse(d.trace).inputs),
    current: d.bakery_id ? [{ bakeryId: d.bakery_id, boxes: 1, items: [{ entry: 0, qty: 1 }] }] : null,
    locked: LOCKED.includes(d.bakery_state) || d.stage >= 1, hold: !!d.safety_hold, paid: !/failed|refunded/.test(d.payment_status || '')
  }));
  const business = db.prepare(`SELECT d.*, o.payment_status FROM business_days d JOIN business_orders o ON o.id = d.order_id WHERE d.date = ? AND d.cancelled = 0`).all(date).map(d => {
    const alloc = parse(d.allocation);
    return {
      kind: 'business', id: d.id, ref: `business:${d.id}`, boxes: d.people, units: businessUnits(parse(d.lines), parse(d.specials)),
      current: Array.isArray(alloc) && alloc.length ? alloc : null,
      locked: LOCKED.includes(d.bakery_state) || d.stage >= 1, hold: false, paid: !/failed|refunded/.test(d.payment_status || '')
    };
  });
  return [...personal, ...business];
}

/** Allocate one delivery to one bakery, or split a business order by line. Mutates `left`. */
function place(row, bakeries, left) {
  const single = bakeries.find(b => left[b.id] >= row.boxes && row.units.every(u => canMake(b, u)));
  if (single) {
    left[single.id] -= row.boxes;
    return [{ bakeryId: single.id, boxes: row.boxes, items: row.units.map(u => ({ entry: u.entry, qty: u.qty })) }];
  }
  if (row.kind !== 'business') return null;
  const parts = {};
  const trial = { ...left };
  /* Most constrained first: Special Breakfasts, then general lines. */
  const units = [...row.units].sort((a, b) => b.special - a.special || bakeries.filter(x => canMake(x, a)).length - bakeries.filter(x => canMake(x, b)).length);
  for (const u of units) {
    let need = u.qty;
    for (const b of bakeries) {
      if (need <= 0) break;
      if (!canMake(b, u) || trial[b.id] <= 0) continue;
      const take = Math.min(trial[b.id], need);
      const p = (parts[b.id] ||= { bakeryId: b.id, boxes: 0, items: [] });
      p.boxes += take; p.items.push({ entry: u.entry, qty: take });
      trial[b.id] -= take; need -= take;
    }
    if (need > 0) return null;
  }
  Object.assign(left, trial);
  return Object.values(parts);
}

/**
 * Plan a date's allocation without writing it. `extra` are deliveries not yet saved
 * (an order being placed). `keep` keeps every still-valid allocation (after Final Allocation).
 */
export function planAllocation(date, { extra = [], keep = false, exclude = [] } = {}) {
  const bakeries = bakeriesFor(date);
  const byId = Object.fromEntries(bakeries.map(b => [b.id, b]));
  const left = Object.fromEntries(bakeries.map(b => [b.id, b.capacity]));
  const rows = [...dayDemand(date).filter(r => !exclude.includes(r.ref)), ...extra];
  const valid = r => r.current && r.current.every(p => byId[p.bakeryId] && p.items.every(it => { const u = r.units.find(x => x.entry === it.entry); return !u || canMake(byId[p.bakeryId], u); }));
  const result = new Map();
  /* Started orders stay where they are and use up that bakery's capacity. */
  for (const r of rows) {
    if (r.locked || (keep && valid(r))) {
      (r.current || []).forEach(p => { if (p.bakeryId in left) left[p.bakeryId] -= p.boxes; });
      result.set(r.ref, { row: r, parts: r.current, kept: true });
    }
  }
  const open = rows.filter(r => !result.has(r.ref));
  const options = r => bakeries.filter(b => r.units.every(u => canMake(b, u))).length;
  /* Orders already accepted keep their reservation; a new order only fits in what is left. Then most constrained first. */
  const isNew = r => (r.ref.startsWith('new:') ? 1 : 0);
  open.sort((a, b) => isNew(a) - isNew(b) || options(a) - options(b) || b.boxes - a.boxes || a.ref.localeCompare(b.ref));
  for (const r of open) {
    if (r.hold || !r.paid) { result.set(r.ref, { row: r, parts: null, skipped: r.hold ? 'Safety hold' : 'Payment not confirmed' }); continue; }
    result.set(r.ref, { row: r, parts: place(r, bakeries, left) });
  }
  return { bakeries, left, result: [...result.values()] };
}

/** Capacity reservation at order / edit time (DLV §8): throws when the morning could no longer be allocated. */
export function assertAllocatable(date, extra, { exclude = [] } = {}) {
  const rows = extra.map((e, i) => ({ ...e, ref: `new:${i}`, current: null, locked: false, hold: false, paid: true }));
  /* An edit plans the new version of the delivery in place of its current one. */
  const plan = planAllocation(date, { extra: rows, exclude });
  const failed = plan.result.filter(r => rows.some(x => x.ref === r.row.ref) && !r.parts);
  if (failed.length) throw bad('capacity_full', `Our partner bakeries are fully booked for ${prettyDate(date)}. Please choose another morning.`, { date });
}

/** Re-run the provisional allocation after an order changes (before the cutoff only). */
export function reallocateProvisional(dates) {
  for (const date of new Set(dates)) {
    if (cutoffFor(date) <= new Date()) continue;
    try { allocate(date, { final: false }); } catch (e) { console.error('[allocation]', e); }
  }
}
export const isFinal = date => !!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(`final:${date}`);

/** Write an allocation. Provisional before the cutoff; Final at the cutoff (or after it). */
export function allocate(date, { final = cutoffFor(date) <= new Date() } = {}) {
  const already = parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(`final:${date}`)?.value ?? null);
  const plan = planAllocation(date, { keep: !!already });
  const before = plan.result.map(r => ({ ref: r.row.ref, bakeries: (r.row.current || []).map(p => p.bakeryId).sort().join(',') }));
  tx(() => {
    for (const { row, parts, kept, skipped } of plan.result) {
      if (kept) continue;
      if (!parts) {
        raiseException({ ref: row.ref, kind: skipped ? (skipped === 'Safety hold' ? 'Dietary/Allergy Issue' : 'Payment Issue') : 'Capacity Issue',
          note: skipped ? `${skipped}: not allocated for ${date}` : `No eligible bakery capacity on ${date}`, owner: 'Operations', action: skipped ? 'Resolve before production' : 'Contact the customer; reallocate or refund' });
        continue;
      }
      if (row.kind === 'personal') db.prepare('UPDATE order_days SET bakery_id = ? WHERE id = ?').run(parts[0].bakeryId, row.id);
      else db.prepare('UPDATE business_days SET allocation = ? WHERE id = ?').run(json(parts), row.id);
    }
    /* A bakery whose plan changed must confirm it again (MB-OPS-001 §4). */
    const changed = new Set();
    for (const r of plan.result) {
      const now = (r.parts || []).map(p => p.bakeryId).sort().join(',');
      const was = before.find(b => b.ref === r.row.ref).bakeries;
      if (now !== was) [...now.split(','), ...was.split(',')].filter(Boolean).forEach(id => changed.add(Number(id)));
    }
    for (const id of changed) db.prepare(`UPDATE bakery_plans SET status = 'Changed — confirm again', updated_at = datetime('now') WHERE bakery_id = ? AND date = ? AND status = 'Confirmed'`).run(id, date);
    const failed = plan.result.filter(r => !r.parts).length;
    const key = final ? `final:${date}` : `provisional:${date}`;
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
      .run(key, json({ at: new Date().toISOString(), failed }));
  });
  return { date, final, allocations: plan.result.map(r => ({ kind: r.row.kind, id: r.row.id, boxes: r.row.boxes, allocated: !!r.parts, parts: r.parts || null, skipped: r.skipped || null })) };
}
