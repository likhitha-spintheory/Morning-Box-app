/* Admin → Discounts: launch discounts and promotional codes (Launch Discount Requirements v1.0 §05).
   Everything here applies to new orders straight away, with no code change. */
import { useEffect, useState } from 'react';

const Field = ({ label, children, hint }) => <div className="field" style={{ gap: 6, justifyContent: 'flex-end' }}><label>{label}</label>{children}{hint && <span className="xs">{hint}</span>}</div>;
const pct = v => Math.round(v * 1000) / 10;
const Check = ({ checked, onChange, children }) => (
  <label className="row" style={{ gap: 8, justifyContent: 'flex-start', minHeight: 36 }}><input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} /><span>{children}</span></label>
);

function Tiers({ tiers, unit, onChange }) {
  const set = (i, k, v) => onChange(tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  return (
    <div className="stack gap-8">
      {tiers.map((t, i) => (
        <div key={i} className="row" style={{ gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <span className="xs">From</span>
          <input className="input" style={{ width: 72 }} inputMode="numeric" aria-label={`Minimum ${unit}`} value={t.min} onChange={e => set(i, 'min', e.target.value)} />
          <span className="xs">{unit}:</span>
          <input className="input" style={{ width: 64 }} inputMode="decimal" aria-label="Discount percent" value={t.pctText ?? pct(t.pct)} onChange={e => set(i, 'pctText', e.target.value)} />
          <span className="xs">% off</span>
          <button type="button" className="btn-text" onClick={() => onChange(tiers.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      {tiers.length < 8 && <button type="button" className="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...tiers, { min: '', pct: 0, pctText: '' }])}>Add a tier</button>}
    </div>
  );
}
const cleanTiers = tiers => tiers.map(t => ({ min: Number(t.min), pct: (t.pctText !== undefined ? Number(t.pctText) : pct(t.pct)) / 100 }));

const EMPTY = { code: '', type: 'percent', valueText: '10', personal: true, business: true, customers: 'all', validFrom: '', validTo: '', maxUses: '', maxPerCustomer: '1', minOrder: '', maxDiscount: '', combinable: false, note: '', active: true };
const promoText = p => (p.type === 'percent' ? `${pct(p.value)}%${p.maxDiscount ? ` (max AED ${p.maxDiscount})` : ''}` : `AED ${p.value}`);
const WHO = { all: 'All customers', new: 'New customers (first order)', existing: 'Returning customers' };

function PromoForm({ initial, editing, busy, onSave, onCancel }) {
  const [f, setF] = useState(initial);
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => onSave({
    code: f.code, type: f.type, value: f.type === 'percent' ? Number(f.valueText) / 100 : Number(f.valueText),
    personal: f.personal, business: f.business, customers: f.customers, validFrom: f.validFrom, validTo: f.validTo,
    maxUses: f.maxUses, maxPerCustomer: f.maxPerCustomer, minOrder: f.minOrder, maxDiscount: f.type === 'percent' ? f.maxDiscount : '',
    combinable: f.combinable, note: f.note, active: f.active
  });
  return (
    <div className="stack gap-12">
      <div className="grid-2">
        <Field label="Code"><input className="input" style={{ textTransform: 'uppercase' }} value={f.code} disabled={editing} maxLength={24} onChange={e => up('code', e.target.value)} placeholder="e.g. LAUNCH10" /></Field>
        <Field label="Type"><select className="input" value={f.type} onChange={e => up('type', e.target.value)}><option value="percent">Percentage</option><option value="fixed">Fixed AED</option></select></Field>
        <Field label={f.type === 'percent' ? 'Discount (%)' : 'Discount (AED)'}><input className="input" inputMode="decimal" value={f.valueText} onChange={e => up('valueText', e.target.value)} /></Field>
        <Field label="Customers"><select className="input" value={f.customers} onChange={e => up('customers', e.target.value)}>{Object.entries(WHO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Valid from (optional)"><input className="input" type="date" value={f.validFrom} onChange={e => up('validFrom', e.target.value)} /></Field>
        <Field label="Valid until (optional)"><input className="input" type="date" value={f.validTo} onChange={e => up('validTo', e.target.value)} /></Field>
        <Field label="Total uses (optional)"><input className="input" inputMode="numeric" value={f.maxUses ?? ''} onChange={e => up('maxUses', e.target.value)} placeholder="No limit" /></Field>
        <Field label="Uses per customer"><input className="input" inputMode="numeric" value={f.maxPerCustomer} onChange={e => up('maxPerCustomer', e.target.value)} /></Field>
        <Field label="Minimum order, AED (optional)"><input className="input" inputMode="decimal" value={f.minOrder ?? ''} onChange={e => up('minOrder', e.target.value)} placeholder="None" /></Field>
        {f.type === 'percent' && <Field label="Maximum discount, AED (optional)"><input className="input" inputMode="decimal" value={f.maxDiscount ?? ''} onChange={e => up('maxDiscount', e.target.value)} placeholder="No cap" /></Field>}
      </div>
      <div className="row" style={{ gap: 20, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <Check checked={f.personal} onChange={v => up('personal', v)}>Personal orders</Check>
        <Check checked={f.business} onChange={v => up('business', v)}>Group &amp; Business orders</Check>
      </div>
      <Check checked={f.combinable} onChange={v => up('combinable', v)}>Can be combined with automatic discounts</Check>
      <span className="xs">{f.combinable
        ? 'Applies after the automatic discount (first order, multi-day or volume): a percentage of what is left, or a fixed amount from the first day on.'
        : 'The order gets either the automatic discounts or this code, whichever saves the customer more.'}</span>
      <Field label="Internal note (optional)"><input className="input" maxLength={200} value={f.note} onChange={e => up('note', e.target.value)} placeholder="e.g. Instagram launch campaign" /></Field>
      <div className="row" style={{ gap: 12, justifyContent: 'flex-start' }}>
        <button type="button" className="btn" style={{ width: 'auto', padding: '0 24px' }} disabled={busy} onClick={save}>{editing ? 'Save code' : 'Create code'}</button>
        {onCancel && <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

export function Discounts({ data, act, busy }) {
  const [d, setD] = useState(() => structuredClone(data.discounts));
  useEffect(() => setD(structuredClone(data.discounts)), [data]);
  const [form, setForm] = useState(null);   // null | { initial, editing }
  const up = (group, k, v) => setD(x => ({ ...x, [group]: { ...x[group], [k]: v } }));
  const save = () => act('PUT', '/admin/discounts', {
    firstOrder: { ...d.firstOrder, pct: Number(d.firstOrder.pctText ?? pct(d.firstOrder.pct)) / 100 },
    multiDay: { ...d.multiDay, tiers: cleanTiers(d.multiDay.tiers) },
    volume: { ...d.volume, tiers: cleanTiers(d.volume.tiers) }
  });
  const savePromo = async body => {
    const ok = form.editing ? await act('PUT', `/admin/promos/${encodeURIComponent(body.code)}`, body) : await act('POST', '/admin/promos', body);
    if (ok) setForm(null);
  };
  const edit = p => setForm({ editing: true, initial: { ...EMPTY, ...p, valueText: String(p.type === 'percent' ? pct(p.value) : p.value), maxUses: p.maxUses ?? '', minOrder: p.minOrder ?? '', maxDiscount: p.maxDiscount ?? '', maxPerCustomer: String(p.maxPerCustomer) } });
  return (
    <section className="stack gap-16">
      <div className="note"><span>Each delivery day gets only the <b>highest</b> automatic discount it qualifies for; percentages are never added together. Discounts apply to breakfast charges only (delivery is not discounted). Changes apply to new orders straight away; orders already placed keep their discounts.</span></div>

      <div className="card stack gap-12" style={{ padding: 18 }}>
        <div className="row"><h2 className="h3">First-order discount</h2><Check checked={d.firstOrder.enabled} onChange={v => up('firstOrder', 'enabled', v)}>On</Check></div>
        <span className="xs">On the first scheduled delivery day of a customer’s first order, once per customer, applied automatically. A customer whose first order is fully cancelled gets it back.</span>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
          <input className="input" style={{ width: 72 }} inputMode="decimal" aria-label="First-order discount percent" value={d.firstOrder.pctText ?? pct(d.firstOrder.pct)} onChange={e => up('firstOrder', 'pctText', e.target.value)} /><span className="xs">% off</span>
        </div>
        <div className="row" style={{ gap: 20, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <Check checked={d.firstOrder.personal} onChange={v => up('firstOrder', 'personal', v)}>Personal</Check>
          <Check checked={d.firstOrder.business} onChange={v => up('firstOrder', 'business', v)}>Group &amp; Business</Check>
        </div>
      </div>

      <div className="card stack gap-12" style={{ padding: 18 }}>
        <div className="row"><h2 className="h3">Multi-day discount</h2><Check checked={d.multiDay.enabled} onChange={v => up('multiDay', 'enabled', v)}>On</Check></div>
        <span className="xs">By the number of delivery days in the order (not the calendar span), applied automatically to every day.</span>
        <Tiers tiers={d.multiDay.tiers} unit="days" onChange={t => up('multiDay', 'tiers', t)} />
        <div className="row" style={{ gap: 20, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          <Check checked={d.multiDay.personal} onChange={v => up('multiDay', 'personal', v)}>Personal</Check>
          <Check checked={d.multiDay.business} onChange={v => up('multiDay', 'business', v)}>Group &amp; Business</Check>
        </div>
      </div>

      <div className="card stack gap-12" style={{ padding: 18 }}>
        <div className="row"><h2 className="h3">Business volume discount</h2><Check checked={d.volume.enabled} onChange={v => up('volume', 'enabled', v)}>On</Check></div>
        <span className="xs">Group &amp; Business only, by the number of breakfasts on each delivery day.</span>
        <Tiers tiers={d.volume.tiers} unit="breakfasts" onChange={t => up('volume', 'tiers', t)} />
      </div>

      <div className="row" style={{ gap: 12, justifyContent: 'flex-start' }}>
        <button type="button" className="btn" style={{ width: 'auto', padding: '0 28px', whiteSpace: 'nowrap' }} disabled={busy} onClick={save}>Save discounts</button>
        <button type="button" className="btn-text" disabled={busy} onClick={() => window.confirm('Reset the automatic discounts to the launch defaults? Promo codes are not affected.') && act('POST', '/admin/discounts/reset')}>Reset to launch defaults</button>
      </div>

      <div className="card stack gap-12" style={{ padding: 18 }}>
        <div className="row"><h2 className="h3">Promo codes</h2>{!form && <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px' }} onClick={() => setForm({ editing: false, initial: { ...EMPTY } })}>New code</button>}</div>
        <span className="xs">Customers enter a code at review. Each code has its own amount, customers, dates, limits and combination rule. A code that has been used can be switched off but not deleted.</span>
        {form && <PromoForm key={form.initial.code || 'new'} initial={form.initial} editing={form.editing} busy={busy} onSave={savePromo} onCancel={() => setForm(null)} />}
        {data.promos.length === 0 ? <p className="help" style={{ margin: 0 }}>No promo codes yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ops-table">
              <thead><tr><th>Code</th><th>Discount</th><th>For</th><th>Valid</th><th>Used</th><th>Saved</th><th>Status</th><th /></tr></thead>
              <tbody>{data.promos.map(p => (
                <tr key={p.code} className={p.active ? '' : 'muted'}>
                  <td><b>{p.code}</b>{p.note && <><br /><span className="xs">{p.note}</span></>}</td>
                  <td>{promoText(p)}<br /><span className="xs">{p.combinable ? 'Combinable' : 'Not combinable'}{p.minOrder ? `, min AED ${p.minOrder}` : ''}</span></td>
                  <td>{[p.personal && 'Personal', p.business && 'Business'].filter(Boolean).join(' + ')}<br /><span className="xs">{WHO[p.customers]}</span></td>
                  <td className="xs">{p.validFrom || p.validTo ? `${p.validFrom || '…'} to ${p.validTo || '…'}` : 'Always'}</td>
                  <td>{p.uses}{p.maxUses ? ` / ${p.maxUses}` : ''}<br /><span className="xs">{p.maxPerCustomer} per customer</span></td>
                  <td>AED {Math.round(p.saved)}</td>
                  <td>{p.active ? 'On' : 'Off'}</td>
                  <td>
                    <span className="row" style={{ gap: 12, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                      <button type="button" className="btn-text" disabled={busy} onClick={() => edit(p)}>Edit</button>
                      <button type="button" className="btn-text" disabled={busy} onClick={() => act('PUT', `/admin/promos/${encodeURIComponent(p.code)}`, { ...p, active: !p.active })}>{p.active ? 'Switch off' : 'Switch on'}</button>
                      {p.uses === 0 && p.saved === 0 && <button type="button" className="btn-text" disabled={busy} onClick={() => window.confirm(`Delete ${p.code}?`) && act('DELETE', `/admin/promos/${encodeURIComponent(p.code)}`)}>Delete</button>}
                    </span>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
