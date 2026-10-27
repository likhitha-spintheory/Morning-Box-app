import { Fragment, useState } from 'react';
import { windowLabel } from '../domain/app.js';

/* Live morning operations (MB-OPS-001 §1–8): allocation and bakery plans the night
   before, then each delivery from preparation to handover. Normal orders flow;
   the dashboard surfaces what needs attention. */

const HEALTH_CLASS = { 'On Track': 'ok', 'Attention Required': 'prep', Late: 'off', Failed: 'off', Delivered: 'done', 'Delivered late': 'done', Completed: 'done' };
const STAGE = ['Confirmed', 'Being prepared', 'Out for delivery', 'Delivered'];
const bakeryOf = (r, names) => (r.kind === 'personal' ? (r.bakeryId ? names[r.bakeryId] || `#${r.bakeryId}` : '—') : (r.allocation || []).map(p => `${names[p.bakeryId] || `#${p.bakeryId}`} ×${p.boxes}`).join(', ') || '—');
const small = { width: 'auto', padding: '0 14px', minHeight: 36, fontSize: 14 };

export function Live({ data, meta, busy, act, call }) {
  const [filter, setFilter] = useState('attention');
  const [open, setOpen] = useState(null);
  const names = Object.fromEntries(data.plans.map(p => [p.bakeryId, p.bakery]));
  const rows = filter === 'all' ? data.rows : data.rows.filter(r => !['On Track', 'Delivered', 'Completed'].includes(r.health));
  const boxes = data.rows.reduce((t, r) => t + r.boxes, 0);
  return (
    <section className="stack gap-16">
      <div className="card stack gap-12" style={{ padding: 18 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="strong">{data.rows.length} deliveries · {boxes} boxes</span>
          <span className="row" style={{ gap: 10 }}>
            <span className="xs">{data.allocated ? `${data.allocated.final ? 'Final' : 'Provisional'} allocation ${new Date(data.allocated.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}${data.allocated.failed ? ` · ${data.allocated.failed} not allocated` : ''}${data.allocated.final ? '' : ' · final runs at 9:00 PM the evening before'}` : 'Final allocation runs automatically at 9:00 PM the evening before'}</span>
            <button type="button" className="btn-secondary" style={small} disabled={busy || !data.rows.length} onClick={() => act('POST', '/allocate', { date: data.date })}>{data.allocated?.final ? 'Re-run allocation' : 'Allocate now'}</button>
          </span>
        </div>
        <table className="ops-table">
          <thead><tr><th>Bakery</th><th>Booked / capacity</th><th>Production plan</th><th /></tr></thead>
          <tbody>{data.plans.map(p => (
            <tr key={p.bakeryId} className={p.booked && p.plan?.status !== 'Confirmed' ? 'warn' : ''}>
              <td>{p.bakery}</td><td>{p.booked} / {p.capacity}{p.windowCapacity ? <><br /><small>{Object.entries(p.windowCapacity).map(([w, n]) => `${windowLabel(w)}: ${p.bookedByWindow?.[w] ?? 0} / ${n}`).join(' · ')}</small></> : null}</td>
              <td>{p.plan ? `${p.plan.status}${p.plan.reason ? ` — ${p.plan.reason}` : ''}` : p.booked ? 'Waiting for the bakery to confirm' : '—'}</td>
              <td>{p.booked > 0 && p.plan?.status !== 'Confirmed' && <small>Only the bakery can confirm (Bakery View). Chase the bakery or reallocate.</small>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
        {Object.entries(data.counts).map(([k, n]) => <span key={k} className={`status ${HEALTH_CLASS[k] || 'done'}`}>{k} · {n}</span>)}
        <span style={{ flex: 1 }} />
        <div className="ops-tabs" role="tablist">
          {[['attention', 'Needs attention'], ['all', 'All']].map(([id, label]) => <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
      </div>

      <table className="ops-table">
        <thead><tr><th>Order</th><th>Window</th><th>Where</th><th>Boxes</th><th>Bakery</th><th>Progress</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(r => {
          const key = `${r.kind}${r.id}`;
          return (
            <Fragment key={key}>
              <tr className={['Late', 'Failed', 'Attention Required'].includes(r.health) || r.safetyHold || r.safetyCheck ? 'warn' : ''}>
                <td>{r.orderId}{r.kind === 'business' ? ' (business)' : ''}{r.safetyHold ? ' · SAFETY HOLD' : ''}{r.safetyCheck ? ' · ALLERGY CHECK OPEN' : ''}{r.needs?.length ? <><br /><small>Needs: {r.needs.join(', ')}</small></> : null}</td>
                <td>{windowLabel(r.window)}<br /><small>Ready by {r.readyBy}</small></td>
                <td>{r.address.building}, {r.address.unit || r.address.office}</td>
                <td>{r.boxes}{r.specialBoxes ? <><br /><small>{r.specialBoxes} special</small></> : null}</td>
                <td>{bakeryOf(r, names)}</td>
                <td><small>Bakery: {r.bakeryState || '—'}{r.delayMinutes ? ` (+${r.delayMinutes} min)` : ''}<br />Delivery: {r.deliveryState || '—'}<br />Customer sees: {STAGE[r.stage]}{r.lateNote ? ` · around ${r.lateNote}` : ''}</small></td>
                <td><span className={`status ${HEALTH_CLASS[r.health] || 'done'}`}>{r.health}</span></td>
                <td><button type="button" className="btn-text" onClick={() => setOpen(open === key ? null : key)}>{open === key ? 'Close' : 'Actions'}</button></td>
              </tr>
              {open === key && <tr><td colSpan={8}><Actions r={r} meta={meta} busy={busy} act={act} call={call} names={names} /></td></tr>}
            </Fragment>
          );
        })}</tbody>
      </table>
      {!rows.length && <p className="help">{data.rows.length ? 'Everything is on track.' : 'No deliveries on this date.'}</p>}
    </section>
  );
}

/** The proof-of-delivery photo, loaded on request (MB-DLV-001 §10). */
function DeliveryPhoto({ r, call }) {
  const [src, setSrc] = useState('');
  const [err, setErr] = useState('');
  if (src) return <img src={src} alt="Proof of delivery" style={{ maxWidth: 320, borderRadius: 12 }} />;
  return <span className="row" style={{ gap: 8, justifyContent: 'flex-start' }}><button type="button" className="btn-text" onClick={() => call('GET', `/days/${r.kind}/${r.id}/delivery-photo`).then(x => setSrc(x.photo)).catch(e => setErr(e.message))}>View delivery photo</button>{err && <span className="xs">{err}</span>}</span>;
}

/** The next steps for one delivery, in order: bakery → dispatch → delivery; plus late, failed and remedies.
    The partner bakery delivers its own orders; ops can record any step on its behalf. */
function Actions({ r, meta, busy, act, call, names = {} }) {
  const path = `/days/${r.kind}/${r.id}`;
  const parts = r.kind === 'business' && r.allocation?.length > 1
    ? r.allocation.map(p => ({ bakeryId: p.bakeryId, boxes: p.boxes, special: (p.items || []).filter(it => r.production[it.entry]?.special?.length).reduce((t, it) => t + it.qty, 0) }))
    : [{ bakeryId: undefined, boxes: r.boxes, special: r.specialBoxes }];
  const [f, setF] = useState({ delay: '', reason: meta.planIssues[0], eta: '', fail: meta.failureReasons[0], remedy: meta.remedies[1], amount: '', why: '',
    /* OPS §6: the boxes are physically counted at dispatch — the fields start empty, never pre-filled with the expected numbers. */
    counts: Object.fromEntries(parts.map(p => [p.bakeryId ?? 'one', { boxes: '', special: '' }])), qc: {}, failPart: '' });
  /* Final quality check before Ready (MB-BKY-001 §4): each check is ticked, never a blanket pass. */
  const split = parts.length > 1 && parts[0].bakeryId !== undefined;
  const qcChecks = meta.qcChecks || {};
  const qcDone = Object.keys(qcChecks).every(c => f.qc[c]);
  const blocked = r.safetyHold || r.safetyCheck;
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const done = r.stage >= 3;
  const leftBakery = ['Handed Over'].includes(r.bakeryState) || r.stage >= 2;
  const input = { minHeight: 36, width: 140 };
  return (
    <div className="stack gap-12" style={{ padding: '6px 0' }}>
      {r.attempts?.length > 0 && <span className="xs">Attempts: {r.attempts.map(a => `${a.reason} (${a.created_at})`).join('; ')}</span>}
      {done && r.hasDeliveryPhoto && call && <DeliveryPhoto r={r} call={call} />}
      {blocked && <div className="banner-warn" role="status"><span><b>{r.safetyHold ? 'Safety hold' : 'Open allergy / dietary check'}</b> — resolve it in Exceptions before the bakery prepares or hands this over (MB-BKY-001 §3).</span></div>}
      {r.handover && <span className="xs">Dispatched by the bakery: {r.handover.boxes} boxes ({r.handover.special_boxes} special){r.handover.picked_up_at ? ` · ${r.handover.picked_up_at}` : ''}</span>}
      {!leftBakery && !done && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <b style={{ fontSize: 14 }}>Bakery:</b>
          <button type="button" className="btn-text" disabled={busy || blocked} onClick={() => act('POST', `${path}/bakery-state`, { state: 'In Preparation' })}>In preparation</button>
          <input className="input" style={{ ...input, width: 90 }} placeholder="Minutes" inputMode="numeric" aria-label="Delay in minutes" value={f.delay} onChange={set('delay')} />
          <button type="button" className="btn-text" disabled={busy || !f.delay} onClick={() => act('POST', `${path}/bakery-state`, { state: 'Delayed', delayMinutes: Number(f.delay) })}>Report delay</button>
          <select className="input" style={{ ...input, width: 230 }} aria-label="Why it can’t be fulfilled" value={f.reason} onChange={set('reason')}>{meta.planIssues.map(x => <option key={x}>{x}</option>)}</select>
          {/* A split order: only the chosen bakery's part fails and moves (MB-OPS-001 §4). */}
          {split && <select className="input" style={{ ...input, width: 200 }} aria-label="Which bakery’s part can’t be fulfilled" value={f.failPart} onChange={set('failPart')}>
            <option value="">Which bakery’s part?</option>
            {parts.map(p => <option key={p.bakeryId} value={p.bakeryId}>{names[p.bakeryId] || `#${p.bakeryId}`} ×{p.boxes}</option>)}</select>}
          <button type="button" className="btn-text" disabled={busy || (split && !f.failPart)} onClick={() => act('POST', `${path}/bakery-state`, { state: 'Unable to Fulfil', reason: f.reason, ...(split ? { bakeryId: Number(f.failPart) } : {}) })}>Can’t fulfil</button>
          <button type="button" className="btn-text" disabled={busy} onClick={() => act('POST', `${path}/reallocate`)}>Reallocate to next bakery</button>
        </div>
      )}
      {!leftBakery && !done && r.bakeryState !== 'Ready' && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <b style={{ fontSize: 14 }}>Final check:</b>
          {Object.entries(qcChecks).map(([id, label]) => (
            <label key={id} className="row xs" style={{ gap: 6 }}><input type="checkbox" checked={!!f.qc[id]} onChange={e => setF(x => ({ ...x, qc: { ...x.qc, [id]: e.target.checked } }))} />{label}</label>
          ))}
          <button type="button" className="btn-secondary" style={small} disabled={busy || blocked || !qcDone} onClick={() => act('POST', `${path}/bakery-state`, { state: 'Ready', qc: f.qc })}>Mark Ready</button>
        </div>
      )}
      {['Ready', 'In Preparation', 'Delayed'].includes(r.bakeryState) && !r.deliveryState && parts.map(p => {
        const k = p.bakeryId ?? 'one';
        const st = p.bakeryId ? r.partStates?.[p.bakeryId]?.state : r.bakeryState;
        if (st !== 'Ready') return p.bakeryId ? <span key={k} className="xs">Bakery #{p.bakeryId}: {st || 'not started'}{st === 'Handed Over' ? ' ✓' : ''}</span> : null;
        const c = f.counts[k];
        const setC = (field, v) => setF(x => ({ ...x, counts: { ...x.counts, [k]: { ...x.counts[k], [field]: v } } }));
        return (
          <div key={k} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <b style={{ fontSize: 14 }}>Out for delivery{p.bakeryId ? ` from bakery #${p.bakeryId}` : ''} — count the boxes:</b>
            <input className="input" style={{ ...input, width: 80 }} inputMode="numeric" aria-label="Boxes counted" value={c.boxes} onChange={e => setC('boxes', e.target.value)} />
            <span className="xs">boxes, of which special</span>
            <input className="input" style={{ ...input, width: 80 }} inputMode="numeric" aria-label="Special boxes counted" value={c.special} onChange={e => setC('special', e.target.value)} />
            <button type="button" className="btn-secondary" style={small} disabled={busy || blocked || c.boxes === '' || c.special === ''} onClick={() => act('POST', `${path}/handover`, { bakeryId: p.bakeryId, boxes: Number(c.boxes), specialBoxes: Number(c.special) })}>Out for delivery</button>
          </div>
        );
      })}
      {['Picked Up', 'Failed'].includes(r.deliveryState) && !done && (
        <button type="button" className="btn-secondary" style={{ ...small, alignSelf: 'flex-start' }} disabled={busy} onClick={() => act('POST', `${path}/out`)}>{r.deliveryState === 'Failed' ? 'Re-attempt delivery' : 'Out for delivery'}</button>
      )}
      {r.deliveryState === 'Out for Delivery' && !done && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <b style={{ fontSize: 14 }}>Handed over to:</b>
          {meta.points[r.kind].map(p => <button key={p} type="button" className="btn-text" disabled={busy} onClick={() => act('POST', `${path}/delivered`, { deliveryPoint: p })}>{p[0].toUpperCase() + p.slice(1)}{p === 'your door' && r.address.handover === 'door' ? ' (asked)' : ''}</button>)}
          <span style={{ width: 16 }} />
          <select className="input" style={{ ...input, width: 220 }} aria-label="Why delivery failed" value={f.fail} onChange={set('fail')}>{meta.failureReasons.map(x => <option key={x}>{x}</option>)}</select>
          <button type="button" className="btn-text" disabled={busy} onClick={() => act('POST', `${path}/failed`, { reason: f.fail })}>Delivery failed</button>
        </div>
      )}
      {!done && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <b style={{ fontSize: 14 }}>Running late — new time:</b>
          <input className="input" style={{ ...input, width: 110 }} placeholder="9:20 AM" aria-label="New time" value={f.eta} onChange={set('eta')} />
          <button type="button" className="btn-text" disabled={busy || !f.eta.trim()} onClick={() => act('POST', `${path}/late`, { eta: f.eta.trim() })}>Tell the customer</button>
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        <b style={{ fontSize: 14 }}>Service recovery:</b>
        <select className="input" style={{ ...input, width: 190 }} aria-label="Remedy" value={f.remedy} onChange={set('remedy')}>{meta.remedies.map(x => <option key={x}>{x}</option>)}</select>
        {['Credit', 'Partial Refund'].includes(f.remedy) && <input className="input" style={{ ...input, width: 100 }} inputMode="decimal" placeholder="AED" aria-label="Amount" value={f.amount} onChange={set('amount')} />}
        <input className="input" style={{ ...input, width: 240 }} placeholder="Reason (shown to the customer)" aria-label="Reason" value={f.why} onChange={set('why')} />
        <button type="button" className="btn-text" disabled={busy || !f.why.trim()} onClick={() => act('POST', `${path}/remedy`, { type: f.remedy, amount: Number(f.amount), reason: f.why.trim() })}>Apply</button>
      </div>
    </div>
  );
}

export function Prep({ data }) {
  return (
    <section className="stack gap-16">
      <div className="row no-print"><span className="strong">Production plans · {data.date}</span><button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px' }} onClick={() => window.print()}>Print</button></div>
      {data.bakeries.map(b => <ProductionPlan key={b.bakeryId ?? 'none'} plan={b} date={data.date} />)}
      {!data.bakeries.length && <p className="help">Nothing to prepare on this date.</p>}
    </section>
  );
}

/** Production view (aggregated) and packing view (per order) — MB-OPS-001 §3. Also used by the Bakery View. */
export function ProductionPlan({ plan, date, children }) {
  /* Preparation standards (MB-PRO-001 §1, §4): each item once, from the plan or its production lines. */
  const standards = [...new Map([...(plan.standards || []), ...plan.production.flatMap(p => p.standards || [])].map(s => [s.item, s])).values()];
  return (
    <div className="card stack gap-12 print-block" style={{ padding: 18 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 className="h3">{plan.bakery} <span className="xs">· {date}</span></h2>
        <span className="xs">{plan.boxes} boxes{plan.special ? ` · ${plan.special} special` : ''}{plan.readyBy ? ` · first ready by ${plan.readyBy}` : ''}{plan.status?.status ? ` · plan ${plan.status.status.toLowerCase()}` : ''}</span>
      </div>
      {children}
      <span className="eyebrow grey">Production</span>
      <table className="ops-table">
        <thead><tr><th>Qty</th><th>Ready by</th><th>Breakfast · size</th><th>Make</th></tr></thead>
        <tbody>{plan.production.map((p, i) => (
          <tr key={i} className={p.special.length ? 'warn' : ''}>
            <td><b>{p.qty}×</b></td><td>{p.readyBy}</td><td>{p.box} · {p.size}{p.format ? <><br /><small>{p.format}</small></> : null}{p.special.length ? <><br /><b>SPECIAL: {p.special.join(', ')}</b></> : null}</td>
            <td>{p.components.join(', ')}{p.swaps.length ? <><br /><small>Swaps: {p.swaps.join('; ')}</small></> : null}{p.substitutions.length ? <><br /><small>Substitutions: {p.substitutions.join('; ')}</small></> : null}</td>
          </tr>
        ))}</tbody>
      </table>
      {standards.length > 0 && <>
        <span className="eyebrow grey">Preparation standards</span>
        <ul className="xs" style={{ margin: 0, paddingLeft: 18 }}>{standards.map(s => <li key={s.item}><b>{s.item}</b>: {s.note}</li>)}</ul>
      </>}
      {plan.addons.length > 0 && <>
        <span className="eyebrow grey">Add-ons (packed separately)</span>
        <table className="ops-table"><tbody>{plan.addons.map(a => <tr key={a.item}><td style={{ width: 60 }}><b>{a.qty}×</b></td><td>{a.item}</td></tr>)}</tbody></table>
      </>}
      <span className="eyebrow grey">Packing — per order</span>
      <table className="ops-table">
        <thead><tr><th>Order</th><th>Ready by</th><th>Box</th><th>Pack</th></tr></thead>
        <tbody>{plan.packing.map(o => (
          <tr key={`${o.kind}${o.id}`} className={o.safetyHold || o.safetyCheck || o.lines.some(l => l.special.length) ? 'warn' : ''}>
            <td>{o.ref}<br /><small>{[o.name, o.window, o.shared].filter(Boolean).join(' · ')}</small>{o.safetyHold ? <><br /><b>SAFETY HOLD — do not prepare</b></> : o.safetyCheck ? <><br /><b>ALLERGY CHECK OPEN — do not prepare</b></> : null}</td>
            <td>{o.readyBy}</td>
            <td>{o.lines.map((l, i) => <div key={i}>{l.qty}× {l.box} · {l.size}{l.special.length ? <b> · {l.special.join(', ').toUpperCase()}</b> : null}{l.addons.length ? <><br /><small>+ {l.addons.join(', ')}</small></> : null}</div>)}{o.otherAllergies && !o.lines.some(l => l.special.some(w => w.startsWith('Also avoid'))) ? <b>Also avoid: {o.otherAllergies}</b> : null}</td>
            <td><small>{[...new Set(o.lines.flatMap(l => l.packing))].join(' ')}</small></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function Labels({ data }) {
  return (
    <section className="stack gap-16">
      <div className="row no-print"><span className="strong">{data.labels.length} labels · {data.date}</span><button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px' }} onClick={() => window.print()}>Print</button></div>
      <LabelGrid labels={data.labels} />
    </section>
  );
}
export function LabelGrid({ labels }) {
  return (
    <div className="labels">
      {labels.map((l, i) => (
        <div key={i} className={`box-label${l.warnings?.length ? ' allergen' : ''}`}>
          <span className="eyebrow" style={{ fontSize: 11 }}>Morning Box</span>
          <b style={{ fontSize: 18 }}>{l.name || l.ref}</b>
          {l.place && <span>{l.place}</span>}
          <span>{l.window}{l.handover ? ` · ${l.handover}` : ''}</span>
          <span><b>{l.size}</b> · {l.box}</span>
          {l.addons?.length > 0 && <span>+ {l.addons.join(', ')}</span>}
          {l.warnings?.length > 0 && <b>⚠ {l.warnings.join(', ').toUpperCase()}</b>}
          {l.safetyHold && <b>SAFETY HOLD</b>}
          {!l.safetyHold && l.safetyCheck && <b>ALLERGY CHECK PENDING</b>}
          <small>{l.ref} · ready by {l.readyBy}</small>
        </div>
      ))}
    </div>
  );
}
