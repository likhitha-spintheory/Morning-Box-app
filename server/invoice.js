/* Who is who on a customer's food invoice (client feedback FLW-044, Terms of Service §7):
     Supplier / Seller   the registered Partner Bakery that prepared the breakfast (legal name, address, TRN)
     Platform            Morning Box
     Platform Operator   Studio Nest L.L.C-FZ (MB_LEGAL_NAME), which collects payment as the bakery's commercial agent
     Billed To           the customer or purchasing company
   The bakery is assigned automatically and becomes final at the 9:00 PM cutoff; until then the seller line says so.
   The document is titled "Tax Invoice" only when every seller on it has a TRN recorded in Admin → Bakeries. */
import { db } from './db.js';
import { SUPPLIER } from './company.js';
import { isFinal } from './allocation.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parse = v => { try { return JSON.parse(v); } catch { return null; } };

function sellerRow(id) {
  const b = db.prepare('SELECT id, name, legal_name, trn, legal_address FROM bakeries WHERE id = ?').get(id);
  return b && { id: b.id, name: b.legal_name || b.name, trn: (b.trn || '').replace(/\D/g, ''), address: b.legal_address || '' };
}

/** The final sellers of one delivery day: personal days have bakery_id; business days an allocation of parts. */
export function sellersOfDay(day) {
  if (!isFinal(day.date)) return [];
  const ids = day.bakery_id ? [day.bakery_id] : (parse(day.allocation) || []).map(p => p.bakeryId);
  return [...new Set(ids)].map(sellerRow).filter(Boolean);
}

/** Header blocks and title for an invoice covering `days` (raw DB rows), and a per-day seller label. */
export function invoiceParties(days) {
  const active = days.filter(d => !d.cancelled);
  const perDay = new Map(days.map(d => [d.date, sellersOfDay(d)]));
  const all = [...new Map(active.flatMap(d => perDay.get(d.date)).map(s => [s.id, s])).values()];
  const pending = active.some(d => !perDay.get(d.date).length);
  const sellerHtml = !all.length
    ? 'Partner Bakery assigned by Morning Box. It is named here once assigned (by 9:00 PM the evening before delivery).'
    : all.length === 1 && !pending
      ? `${esc(all[0].name)}${all[0].address ? `<br>${esc(all[0].address)}` : ''}${all[0].trn ? `<br>TRN ${esc(all[0].trn)}` : ''}`
      : `The Partner Bakery shown for each date:${all.map(s => `<br>${esc(s.name)}${s.address ? `, ${esc(s.address)}` : ''}${s.trn ? ` · TRN ${esc(s.trn)}` : ''}`).join('')}${pending ? '<br>Dates without a bakery yet: assigned by 9:00 PM the evening before.' : ''}`;
  const taxReady = all.length > 0 && !pending && all.every(s => s.trn);
  return {
    taxReady,
    sellerOf: date => (perDay.get(date) || []).map(s => s.name).join(', ') || 'To be assigned',
    multiple: all.length > 1 || (all.length > 0 && pending),
    html: `<p><b>Supplier / Seller:</b> ${sellerHtml}</p>
<p><b>Platform:</b> Morning Box<br><b>Platform Operator:</b> ${esc(SUPPLIER.name)}, ${esc(SUPPLIER.address)}${SUPPLIER.trn ? `<br>TRN ${esc(SUPPLIER.trn)}` : ''}<br><small>Payment collected by the Platform Operator as commercial agent of the seller.</small></p>`
  };
}
