import { Fragment, useEffect, useState } from 'react';

/* Admin for the Morning Box team: partner bakeries (MB-BKY-001), prices
   (MB-BOX-001 §8, MB-B2B-001 §7) and company / support details. */

const CAP_LABEL = { glutenFree: 'Gluten-free', nutFree: 'Tree-nut-free', peanutFree: 'Peanut-free', dairyFree: 'Dairy-free', eggFree: 'Egg-free', vegan: 'Vegan', sesameFree: 'Sesame-free', soyFree: 'Soy-free' };
const STATUS_CLASS = { Active: 'ok', 'Under Review': 'prep', Suspended: 'off' };
const small = { width: 'auto', padding: '0 16px', minHeight: 40 };
const Field = ({ label, children }) => <div className="field" style={{ gap: 6 }}><label>{label}</label>{children}</div>;

/* ---------- Bakeries ---------- */
export function Bakeries({ items, call, act, busy }) {
  const [catalog, setCatalog] = useState(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { call('GET', '/admin/catalog').then(setCatalog).catch(() => {}); }, [call]);
  if (!catalog) return <p className="help">Loading…</p>;
  return (
    <section className="stack gap-16">
      <div className="row"><span className="strong">{items.filter(b => b.status === 'Active').length} active of {items.length} partner bakeries</span>
        <button type="button" className="btn-secondary" style={small} onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : 'Add a bakery'}</button></div>
      <p className="help" style={{ margin: 0 }}>Only <b>Active</b> bakeries receive orders. Allocation goes to the nearest eligible bakery that can make every item, meets the allergy needs and has capacity left (MB-BKY-001).</p>
      {adding && <BakeryForm catalog={catalog} busy={busy} onSave={v => act('POST', '/admin/bakeries', v).then(ok => ok && setAdding(false))} />}
      {items.map(b => <Bakery key={b.id} b={b} catalog={catalog} call={call} act={act} busy={busy} />)}
    </section>
  );
}

function Bakery({ b, catalog, call, act, busy }) {
  const [mode, setMode] = useState(null);   // edit | status | condition
  const [status, setStatus] = useState({ status: b.status, note: '', verification: '' });
  const [sample, setSample] = useState({ product: '', result: catalog.sampleResults[0], note: '' });
  const [cond, setCond] = useState({ date: '', kind: catalog.conditions[0], item: '', capacity: '', need: 'glutenFree', note: '' });
  const [code, setCode] = useState('');
  const perf = b.performance;
  const approved = b.products ? `${b.products.length} approved products` : 'All Morning Box products';
  const issueCode = async () => { try { setCode((await call('POST', `/admin/bakeries/${b.id}/access-code`)).code); } catch { /* shown by act */ } };
  return (
    <article className={`card stack gap-10${b.status === 'Suspended' ? ' warn' : ''}`} style={{ padding: 18 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="row" style={{ gap: 10 }}><b style={{ fontSize: 18 }}>{b.name}</b><span className={`status ${STATUS_CLASS[b.status]}`}>{b.status}</span></span>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {[['edit', 'Edit'], ['status', 'Change status'], ['samples', 'Samples'], ['condition', 'Report a condition']].map(([m, label]) =>
            <button key={m} type="button" className="btn-text" onClick={() => setMode(mode === m ? null : m)}>{mode === m ? 'Close' : label}</button>)}
          <button type="button" className="btn-text" disabled={busy} onClick={issueCode}>{b.hasAccessCode ? 'New access code' : 'Create access code'}</button>
        </span>
      </div>
      {b.statusNote && <span className="help">{b.statusNote}</span>}
      {b.openSafety > 0 && <div className="banner-warn" role="status"><span><b>{b.openSafety} open safety incident{b.openSafety > 1 ? 's' : ''}</b> linked to this bakery — consider Under Review (MB-BKY-001 §10).</span></div>}
      <span className="xs">Licence {b.licenceNo || '— not recorded'}{b.licenceExpiry ? ` (expires ${b.licenceExpiry})` : ''} · {b.bakesOwnBread ? 'bakes its own bread in-house' : 'own bread NOT confirmed'} · ready {b.readyLeadMinutes} min before each window</span>
      <span className="xs">{b.area} · {b.distanceKm} km · capacity {b.effectiveCapacity ?? b.dailyCapacity}{b.effectiveCapacity != null ? ` (stated ${b.dailyCapacity})` : ''} boxes/day · {b.upcomingBoxes} upcoming · {approved}{b.danishFlavours.length ? ` · Danish: ${b.danishFlavours.join(', ')}` : ''}</span>
      <span className="xs">Can handle: {Object.entries(b.capabilities).filter(([, v]) => v).map(([k]) => CAP_LABEL[k]).join(', ') || 'no special requirements'}{b.glutenFreeCertified ? ' · gluten-free certified' : ''}</span>
      {(b.contactName || b.contactPhone) && <span className="xs">Contact: {b.contactName} {b.contactPhone}</span>}
      <span className="xs">So far: {perf.mornings} mornings · {perf.onTime} on time · {perf.late} late · {perf.unableToFulfil} not fulfilled · Loved it {perf.loved} / Not for me {perf.notForMe}</span>
      {code && <div className="note"><span>Bakery View access code for {b.name}: <b style={{ fontSize: 18, letterSpacing: '.1em' }}>{code}</b> — share it with the bakery now; it isn’t shown again. They sign in at <b>#/bakery</b>.</span></div>}
      {b.conditions.length > 0 && (
        <table className="ops-table"><tbody>{b.conditions.map(c => (
          <tr key={c.id} className="warn"><td>{c.date}</td><td>{c.kind}{c.itemName ? ` — ${c.itemName}` : ''}{c.capacity != null ? ` — ${c.capacity} boxes` : ''}{c.need ? ` — ${CAP_LABEL[c.need]}` : ''}{c.note ? ` · ${c.note}` : ''}</td>
            <td><button type="button" className="btn-text" disabled={busy} onClick={() => act('DELETE', `/admin/conditions/${c.id}`)}>Clear</button></td></tr>
        ))}</tbody></table>
      )}
      {mode === 'edit' && <BakeryForm b={b} catalog={catalog} busy={busy} onSave={v => act('PUT', `/admin/bakeries/${b.id}`, v).then(ok => ok && setMode(null))} />}
      {mode === 'status' && (
        <div className="stack gap-8">
          <div className="row" style={{ gap: 8, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            {catalog.statuses.map(s => <button key={s} type="button" className={`status ${status.status === s ? STATUS_CLASS[s] : 'done'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => setStatus(x => ({ ...x, status: s }))}>{s}</button>)}
          </div>
          <input className="input" placeholder={status.status === 'Active' ? 'Note (optional)' : 'Issue and corrective action (required)'} value={status.note} onChange={e => setStatus(x => ({ ...x, note: e.target.value }))} />
          {status.status === 'Active' && b.status !== 'Active' && <input className="input" placeholder="Verification — how the corrective action was checked" value={status.verification} onChange={e => setStatus(x => ({ ...x, verification: e.target.value }))} />}
          <button type="button" className="btn-secondary" style={{ ...small, alignSelf: 'flex-start' }} disabled={busy} onClick={() => act('POST', `/admin/bakeries/${b.id}/status`, status).then(ok => ok && setMode(null))}>Save status</button>
          <span className="xs">Suspended or Under Review bakeries stop receiving new allocations. Re-run allocation for dates already allocated to them.</span>
        </div>
      )}
      {mode === 'samples' && (
        <div className="stack gap-8">
          <span className="xs">Onboarding sample production: taste, portion, appearance, packaging, delivery suitability. Approval can be per product (MB-BKY-001 §8).</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <select className="input" style={{ width: 240 }} aria-label="Product" value={sample.product} onChange={e => setSample(x => ({ ...x, product: e.target.value }))}><option value="">Product…</option>{catalog.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            <select className="input" style={{ width: 200 }} aria-label="Result" value={sample.result} onChange={e => setSample(x => ({ ...x, result: e.target.value }))}>{catalog.sampleResults.map(r => <option key={r}>{r}</option>)}</select>
            <input className="input" style={{ width: 240 }} placeholder="Notes" aria-label="Notes" value={sample.note} onChange={e => setSample(x => ({ ...x, note: e.target.value }))} />
            <button type="button" className="btn-secondary" style={small} disabled={busy || !sample.product} onClick={() => act('POST', `/admin/bakeries/${b.id}/samples`, sample).then(ok => ok && setSample(x => ({ ...x, product: '', note: '' })))}>Record</button>
          </div>
          {b.samples.map(x => <span key={x.id} className="xs">{x.created_at.slice(0, 10)} · {x.productName}: <b>{x.result}</b>{x.note ? ` — ${x.note}` : ''}</span>)}
        </div>
      )}
      {mode === 'condition' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <input className="input" type="date" style={{ width: 170 }} aria-label="Date" value={cond.date} onChange={e => setCond(x => ({ ...x, date: e.target.value }))} />
          <select className="input" style={{ width: 260 }} aria-label="Condition" value={cond.kind} onChange={e => setCond(x => ({ ...x, kind: e.target.value }))}>{catalog.conditions.map(k => <option key={k}>{k}</option>)}</select>
          {cond.kind === 'Item Unavailable' && <select className="input" style={{ width: 240 }} aria-label="Item" value={cond.item} onChange={e => setCond(x => ({ ...x, item: e.target.value }))}><option value="">Choose item</option>{catalog.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}
          {cond.kind === 'Reduced Capacity' && <input className="input" style={{ width: 120 }} inputMode="numeric" placeholder="Boxes" aria-label="Reduced capacity" value={cond.capacity} onChange={e => setCond(x => ({ ...x, capacity: e.target.value }))} />}
          {cond.kind === 'Special Requirement Unavailable' && <select className="input" style={{ width: 200 }} aria-label="Requirement" value={cond.need} onChange={e => setCond(x => ({ ...x, need: e.target.value }))}>{catalog.capabilities.map(k => <option key={k} value={k}>{CAP_LABEL[k]}</option>)}</select>}
          <input className="input" style={{ width: 220 }} placeholder="Note" aria-label="Note" value={cond.note} onChange={e => setCond(x => ({ ...x, note: e.target.value }))} />
          <button type="button" className="btn-secondary" style={small} disabled={busy || !cond.date} onClick={() => act('POST', `/admin/bakeries/${b.id}/conditions`, { ...cond, capacity: Number(cond.capacity) }).then(ok => ok && setMode(null))}>Add</button>
        </div>
      )}
      {b.log.length > 0 && <details><summary className="xs" style={{ cursor: 'pointer' }}>History</summary>{b.log.map((l, i) => <div key={i} className="xs">{l.created_at} · {l.message}</div>)}</details>}
    </article>
  );
}

function BakeryForm({ b, catalog, busy, onSave }) {
  const [v, setV] = useState(() => ({
    name: b?.name || '', area: b?.area || 'DIFC', distanceKm: b?.distanceKm ?? '', dailyCapacity: b?.dailyCapacity ?? '', effectiveCapacity: b?.effectiveCapacity ?? '',
    glutenFreeCertified: !!b?.glutenFreeCertified, capabilities: b?.capabilities || {}, allProducts: !b?.products, products: b?.products || [],
    danishFlavours: b?.danishFlavours || [], contactName: b?.contactName || '', contactPhone: b?.contactPhone || '',
    licenceNo: b?.licenceNo || '', licenceExpiry: b?.licenceExpiry || '', bakesOwnBread: !!b?.bakesOwnBread, readyLeadMinutes: b?.readyLeadMinutes ?? 30, payoutPct: b?.payoutPct ?? 60
  }));
  const set = k => e => setV(x => ({ ...x, [k]: e.target.value }));
  const toggle = (k, id) => setV(x => ({ ...x, [k]: x[k].includes(id) ? x[k].filter(y => y !== id) : [...x[k], id] }));
  const categories = [...new Set(catalog.items.map(i => i.category))];
  const save = () => onSave({
    ...v, distanceKm: Number(v.distanceKm), dailyCapacity: Number(v.dailyCapacity), readyLeadMinutes: Number(v.readyLeadMinutes), payoutPct: Number(v.payoutPct), licenceExpiry: v.licenceExpiry || null, effectiveCapacity: v.effectiveCapacity === '' ? null : Number(v.effectiveCapacity),
    products: v.allProducts ? null : v.products
  });
  return (
    <div className="stack gap-12" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
      <div className="grid-2">
        <Field label="Name"><input className="input" value={v.name} onChange={set('name')} /></Field>
        <Field label="Area"><input className="input" value={v.area} onChange={set('area')} /></Field>
        <Field label="Distance to DIFC (km)"><input className="input" inputMode="decimal" value={v.distanceKm} onChange={set('distanceKm')} /></Field>
        <Field label="Stated daily capacity (boxes)"><input className="input" inputMode="numeric" value={v.dailyCapacity} onChange={set('dailyCapacity')} /></Field>
        <Field label="Effective capacity we allocate (optional)"><input className="input" inputMode="numeric" placeholder="Same as stated" value={v.effectiveCapacity} onChange={set('effectiveCapacity')} /></Field>
        <Field label="Contact name"><input className="input" value={v.contactName} onChange={set('contactName')} /></Field>
        <Field label="Contact phone"><input className="input" value={v.contactPhone} onChange={set('contactPhone')} /></Field>
        <Field label="Food business licence no."><input className="input" value={v.licenceNo} onChange={set('licenceNo')} /></Field>
        <Field label="Licence expiry"><input className="input" type="date" value={v.licenceExpiry} onChange={set('licenceExpiry')} /></Field>
        <Field label="Ready-by: minutes before each window"><input className="input" inputMode="numeric" value={v.readyLeadMinutes} onChange={set('readyLeadMinutes')} /></Field>
        <Field label="Bakery payout (% of breakfast price)"><input className="input" inputMode="decimal" value={v.payoutPct} onChange={set('payoutPct')} /></Field>
      </div>
      <label className="row" style={{ gap: 8, justifyContent: 'flex-start' }}><input type="checkbox" checked={v.bakesOwnBread} onChange={e => setV(x => ({ ...x, bakesOwnBread: e.target.checked }))} /> Bakes its own bread in-house (required, MB-BKY-001 §1)</label>
      <span className="label">Allergy & dietary capability (from the audit)</span>
      <div className="chips">
        {catalog.capabilities.map(k => <button key={k} type="button" className={`chip${v.capabilities[k] ? ' on' : ''}`} aria-pressed={!!v.capabilities[k]} onClick={() => setV(x => ({ ...x, capabilities: { ...x.capabilities, [k]: !x.capabilities[k] } }))}>{CAP_LABEL[k]}</button>)}
        <button type="button" className={`chip${v.glutenFreeCertified ? ' on' : ''}`} aria-pressed={v.glutenFreeCertified} onClick={() => setV(x => ({ ...x, glutenFreeCertified: !x.glutenFreeCertified }))}>Gluten-free certified</button>
      </div>
      <span className="label">Fruit Danish variants it makes</span>
      <div className="chips">{catalog.danishFlavours.map(f => <button key={f} type="button" className={`chip${v.danishFlavours.includes(f) ? ' on' : ''}`} aria-pressed={v.danishFlavours.includes(f)} onClick={() => toggle('danishFlavours', f)}>{f}</button>)}</div>
      <label className="row" style={{ gap: 8, justifyContent: 'flex-start' }}><input type="checkbox" checked={v.allProducts} onChange={e => setV(x => ({ ...x, allProducts: e.target.checked }))} /> Approved for every Morning Box product</label>
      {!v.allProducts && categories.map(cat => (
        <div key={cat} className="stack gap-6"><span className="xs">{cat}</span>
          <div className="chips">{catalog.items.filter(i => i.category === cat).map(i => <button key={i.id} type="button" className={`chip${v.products.includes(i.id) ? ' on' : ''}`} aria-pressed={v.products.includes(i.id)} onClick={() => toggle('products', i.id)}>{i.name}</button>)}</div></div>
      ))}
      <button type="button" className="btn" style={{ alignSelf: 'flex-start', width: 'auto', padding: '0 28px' }} disabled={busy || !v.name.trim()} onClick={save}>{b ? 'Save bakery' : 'Add bakery (starts Under Review)'}</button>
    </div>
  );
}

/* ---------- Pricing ---------- */
export function Pricing({ data, act, busy }) {
  const [p, setP] = useState(() => structuredClone(data.pricing));
  useEffect(() => setP(structuredClone(data.pricing)), [data]);
  const num = (path, v) => setP(x => { const n = structuredClone(x); let o = n; path.slice(0, -1).forEach(k => { o = o[k]; }); o[path.at(-1)] = v === '' ? '' : Number(v); return n; });
  const box = (path, value, label, hint) => (
    <Field label={label}><input className="input" inputMode="decimal" value={value} onChange={e => num(path, e.target.value)} />{hint && <span className="xs">{hint}</span>}</Field>
  );
  const save = () => act('PUT', '/admin/pricing', { ...p, volumeDiscount: p.volumeDiscount.map(t => ({ min: Number(t.min), pct: Number(t.pct) })) });
  const regular = Object.values(p.priceLevels);
  return (
    <section className="stack gap-16">
      <div className="card stack gap-12" style={{ padding: 18 }}>
        <h2 className="h3">Breakfast price levels (Regular size, AED incl. VAT)</h2>
        <span className="xs">Customers only see one price per breakfast — these levels are internal (MB-BOX-001 §8). Swaps never change the price.</span>
        <div className="grid-2">{Object.keys(p.priceLevels).map(k => (
          <div key={k} className="stack gap-6">{box(['priceLevels', k], p.priceLevels[k], `Level ${k.slice(1)}`)}
            <details><summary className="xs" style={{ cursor: 'pointer' }}>{data.levels[k]?.length || 0} breakfasts</summary><span className="xs">{(data.levels[k] || []).join(' · ')}</span></details></div>
        ))}</div>
      </div>
      <div className="card stack gap-12" style={{ padding: 18 }}>
        <h2 className="h3">Size</h2>
        <div className="grid-2">
          {box(['sizeAdjustment', 'light'], p.sizeAdjustment.light, 'Light (vs Regular)', `e.g. −7 → Light from AED ${Math.min(...regular) + (Number(p.sizeAdjustment.light) || 0)}`)}
          {box(['sizeAdjustment', 'large'], p.sizeAdjustment.large, 'Large (vs Regular)', `e.g. +11 → Large from AED ${Math.min(...regular) + (Number(p.sizeAdjustment.large) || 0)}`)}
        </div>
      </div>
      <div className="card stack gap-12" style={{ padding: 18 }}>
        <h2 className="h3">Add-ons (AED each)</h2>
        <div className="grid-2">
          {box(['addons', 'bread', 'half'], p.addons.bread.half, 'Bread — half loaf')}
          {box(['addons', 'bread', 'whole'], p.addons.bread.whole, 'Bread — whole loaf')}
          {Object.keys(p.addons.pastry).map(k => <Fragment key={k}>{box(['addons', 'pastry', k], p.addons.pastry[k], k)}</Fragment>)}
        </div>
      </div>
      <div className="card stack gap-12" style={{ padding: 18 }}>
        <h2 className="h3">Business volume discount</h2>
        {p.volumeDiscount.map((t, i) => (
          <div key={i} className="row" style={{ gap: 10, justifyContent: 'flex-start' }}>
            <span className="xs">From</span><input className="input" style={{ width: 90 }} inputMode="numeric" aria-label="Minimum boxes" value={t.min} onChange={e => setP(x => ({ ...x, volumeDiscount: x.volumeDiscount.map((y, k) => (k === i ? { ...y, min: e.target.value } : y)) }))} />
            <span className="xs">boxes:</span><input className="input" style={{ width: 90 }} inputMode="decimal" aria-label="Discount percent" value={Math.round(t.pct * 1000) / 10} onChange={e => setP(x => ({ ...x, volumeDiscount: x.volumeDiscount.map((y, k) => (k === i ? { ...y, pct: Number(e.target.value) / 100 } : y)) }))} /><span className="xs">% off</span>
            <button type="button" className="btn-text" onClick={() => setP(x => ({ ...x, volumeDiscount: x.volumeDiscount.filter((_, k) => k !== i) }))}>Remove</button>
          </div>
        ))}
        {p.volumeDiscount.length < 6 && <button type="button" className="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => setP(x => ({ ...x, volumeDiscount: [...x.volumeDiscount, { min: 100, pct: 0.12 }] }))}>Add a tier</button>}
      </div>
      <label className="card row" style={{ gap: 10, justifyContent: 'flex-start', padding: 18 }}>
        <input type="checkbox" checked={p.indicative} onChange={e => setP(x => ({ ...x, indicative: e.target.checked }))} />
        <span><b>Prices are indicative</b><br /><span className="xs">While on, customers see “Prices are indicative during our pilot”. Turn off once the client has approved the final prices.</span></span>
      </label>
      <div className="row" style={{ gap: 12, justifyContent: 'flex-start' }}>
        <button type="button" className="btn" style={{ width: 'auto', padding: '0 28px' }} disabled={busy} onClick={save}>Save prices</button>
        <button type="button" className="btn-text" disabled={busy} onClick={() => act('POST', '/admin/pricing/reset')}>Reset to defaults</button>
      </div>
      <span className="xs">New prices apply to new orders and edits right away. Orders already paid keep their price.</span>
      {data.history.length > 0 && <details><summary className="xs" style={{ cursor: 'pointer' }}>Change history</summary>{data.history.map((h, i) => <div key={i} className="xs">{h.at} · levels {Object.values(h.pricing.priceLevels).join('/')} · Light {h.pricing.sizeAdjustment.light} · Large +{h.pricing.sizeAdjustment.large}</div>)}</details>}
    </section>
  );
}
/* ---------- Company & support details ---------- */
export function Company({ data, act, busy, call }) {
  const [v, setV] = useState(() => structuredClone(data));
  const [lib, setLib] = useState(null);
  const [cap, setCap] = useState(null);
  const [cost, setCost] = useState('0');
  useEffect(() => { call('GET', '/admin/library').then(setLib).catch(() => {}); call('GET', '/admin/delivery').then(d => { setCap(d.capacity); setCost(String(d.costPerDelivery)); }).catch(() => {}); }, [call]);
  const set = (group, k) => e => setV(x => ({ ...x, [group]: { ...x[group], [k]: e.target.value } }));
  return (
    <section className="card stack gap-12" style={{ padding: 18 }}>
      <h2 className="h3">On receipts, invoices and the legal pages</h2>
      <div className="grid-2">
        <Field label="Legal company name"><input className="input" value={v.company.name} onChange={set('company', 'name')} /></Field>
        <Field label="TRN (15 digits)"><input className="input" inputMode="numeric" value={v.company.trn} onChange={set('company', 'trn')} /></Field>
      </div>
      <Field label="Registered address"><input className="input" value={v.company.address} onChange={set('company', 'address')} /></Field>
      <h2 className="h3">Customer support (shown in Help)</h2>
      <div className="grid-2">
        <Field label="Email"><input className="input" value={v.support.email} onChange={set('support', 'email')} /></Field>
        <Field label="Phone"><input className="input" value={v.support.phone} onChange={set('support', 'phone')} /></Field>
        <Field label="WhatsApp number"><input className="input" inputMode="tel" value={v.support.whatsapp} onChange={set('support', 'whatsapp')} /></Field>
        <Field label="Hours"><input className="input" value={v.support.hours} onChange={set('support', 'hours')} /></Field>
      </div>
      <button type="button" className="btn" style={{ width: 'auto', padding: '0 28px', alignSelf: 'flex-start' }} disabled={busy} onClick={() => act('PUT', '/admin/company', v)}>Save details</button>
      {cap && <>
        <h2 className="h3">Delivery capacity per window (boxes)</h2>
        <span className="xs">How many boxes the couriers can deliver in each window. When a window is full it can’t be chosen (MB-DLV-001 §8).</span>
        <div className="grid-2">{[['w1', '7:30 – 8:30 AM'], ['w2', '8:30 – 9:30 AM'], ['w3', '9:30 – 10:30 AM']].map(([w, label]) => (
          <Field key={w} label={label}><input className="input" inputMode="numeric" value={cap[w]} onChange={e => setCap(c => ({ ...c, [w]: e.target.value }))} /></Field>
        ))}
          <Field label="Delivery cost per delivery (AED, for the margin report)"><input className="input" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} /></Field></div>
        <button type="button" className="btn-secondary" style={{ ...small, alignSelf: 'flex-start' }} disabled={busy} onClick={() => act('PUT', '/admin/delivery', { capacity: Object.fromEntries(Object.entries(cap).map(([k, v]) => [k, Number(v)])), costPerDelivery: Number(cost) })}>Save delivery settings</button>
      </>}
      {lib && <>
        <h2 className="h3">Menu: SAMPLE items</h2>
        <span className="xs">These test items have no approved ingredient &amp; allergen record yet (MB-PRO-001 §15.1): {lib.items.join(', ')}. Without them, some vegan and gluten-free profiles get no match.</span>
        <label className="row" style={{ gap: 10, justifyContent: 'flex-start' }}>
          <input type="checkbox" checked={lib.samples} disabled={busy} onChange={e => { const samples = e.target.checked; act('PUT', '/admin/library', { samples }).then(ok => ok && setLib(l => ({ ...l, samples }))); }} />
          Offer SAMPLE items to customers (keep off in production until the client approves them)
        </label>
      </>}
    </section>
  );
}
