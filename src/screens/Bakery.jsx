import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../components/ui.jsx';
import { StaffSignIn, StaffTiles, Stepper } from './StaffUi.jsx';
import { addDaysIso, dubaiTodayIso } from '../domain/standards.js';
import { ProductionPlan, LabelGrid } from './OpsLive.jsx';

/* Bakery View (Master Plan §8; MB-OPS-001 §3–5; MB-BKY-001 §6–7).
   Each partner bakery signs in with its own access code and sees only what is
   allocated to it: the production plan, packing list and labels. It confirms the
   plan or reports an issue, moves orders through In Preparation → Ready, then
   delivers them itself: counts the boxes out, marks them delivered (or failed /
   running late). It sees the drop-off point, never the customer's name or email. */
const KEY = 'morningbox.bakery';
const CONDITIONS = ['Item Unavailable', 'Reduced Capacity', 'Special Requirement Unavailable', 'Temporarily Unavailable'];
const small = { width: 'auto', padding: '0 14px', minHeight: 40 };
const VIEWS = [['plan', 'Production plan', 'doc'], ['orders', 'Orders', 'box'], ['labels', 'Labels', 'bookmark'], ['conditions', 'Availability', 'cal']];
const STEPS = ['Confirmed', 'In Preparation', 'Ready', 'Out for Delivery', 'Delivered'];
const stepOf = o => (o.stage >= 3 ? 4 : o.state === 'Handed Over' ? 3 : Math.max(0, STEPS.indexOf(o.state)));
const dayTitle = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export default function Bakery() {
  const [code, setCode] = useState(() => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [draft, setDraft] = useState(() => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [me, setMe] = useState(null);
  const [date, setDate] = useState(() => addDaysIso(dubaiTodayIso(), 1));
  const [plan, setPlan] = useState(null);
  const [labels, setLabels] = useState(null);
  const [view, setView] = useState('plan');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const save = k => { try { sessionStorage.setItem(KEY, k); } catch { /* tab only */ } setCode(k); };

  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`./api/bakery${path}`, { method, headers: { 'content-type': 'application/json', 'x-bakery-code': code }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.message || 'Request failed'), { status: res.status });
    return data;
  }, [code]);
  const load = useCallback(async () => {
    if (!code) return;
    setError('');
    try {
      const [bakery, production, labelData] = await Promise.all([
        call('GET', '/me'),
        call('GET', `/plan?date=${date}`),
        call('GET', `/labels?date=${date}`)
      ]);
      setMe(bakery);
      setPlan(production);
      setLabels(labelData.labels);
    } catch (e) {
      setError(e.message);
      if (e.status === 401) { save(''); setMe(null); }
    }
  }, [code, date, call]);
  useEffect(() => {
    if (!code) { setOpening(false); return; }
    let active = true;
    setOpening(true);
    load().finally(() => { if (active) setOpening(false); });
    return () => { active = false; };
  }, [load, attempt]);
  const act = async (method, path, body) => {
    setBusy(true); setError('');
    try { await call(method, path, body); await load(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };

  if (!me) {
    return (
      <StaffSignIn icon="croissant" eyebrow="Partner bakery" title="Bakery sign-in" help="Use the access code Morning Box gave your bakery.">
          <form className="stack gap-12" onSubmit={e => { e.preventDefault(); if (draft.length >= 8) { setOpening(true); save(draft); setAttempt(n => n + 1); } }}>
            <div className="field"><label htmlFor="bk-c">Access code</label>
              <input id="bk-c" className="input" inputMode="numeric" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 12))} /></div>
            <button type="submit" className="btn" disabled={draft.length < 8 || opening}>{opening ? 'Opening your production plan…' : 'Open my production plan'}</button>
          </form>
          {error && <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
      </StaffSignIn>
    );
  }

  const delivered = plan ? plan.packing.filter(o => o.stage >= 3).length : 0;
  const current = VIEWS.find(v => v[0] === view);
  return (
    <div className="ops-shell">
      <aside className="ops-side no-print">
        <div className="ops-brand">
          <span className="ops-brand-mark"><Icon name="croissant" size={22} stroke={1.6} /></span>
          <span className="stack" style={{ gap: 2, minWidth: 0 }}><strong className="serif" style={{ fontSize: 20 }}>{me?.name || 'Partner bakery'}</strong><span className="ops-brand-sub">Partner bakery</span></span>
        </div>
        <nav className="ops-nav" aria-label="Bakery sections">
          <div className="ops-nav-group">
            <span className="ops-nav-label">Your mornings</span>
            {VIEWS.map(([id, label, icon]) => (
              <button key={id} type="button" aria-current={view === id ? 'page' : undefined} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
                <Icon name={icon} size={18} stroke={1.6} /><span>{label}</span>
              </button>
            ))}
          </div>
        </nav>
        <button type="button" className="ops-signout" onClick={() => save('')}><Icon name="logout" size={18} stroke={1.6} /><span>Sign out</span></button>
      </aside>

      <div className="ops">
      <header className="ops-head no-print">
        <span className="stack" style={{ gap: 2 }}>
          <span className="eyebrow">{dayTitle(date)}</span>
          <h1 className="serif ops-title">{current?.[1]}</h1>
        </span>
        <input className="input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Date" style={{ width: 170, minHeight: 44 }} />
      </header>
      {error && <div className="banner-err no-print" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
      {plan && view !== 'labels' && (
        <div className="no-print">
          <StaffTiles items={[
            ['box', 'Orders', plan.packing.length],
            ['croissant', 'Boxes to make', plan.boxes],
            ['shieldAlert', 'Special boxes', plan.special || 0, plan.special ? 'warn' : ''],
            ['check', 'Delivered', `${delivered} / ${plan.packing.length}`, plan.packing.length && delivered === plan.packing.length ? 'ok' : ''],
            ['doc', 'Plan', plan.status?.status || (plan.packing.length ? 'To confirm' : '—'), plan.status?.status === 'Confirmed' ? 'ok' : plan.packing.length ? 'warn' : '']
          ]} />
        </div>
      )}
      {!plan ? <p className="help">Loading…</p> : <>
        {view === 'plan' && (
          <ProductionPlan plan={plan} date={date}>
            <PlanConfirm plan={plan} date={date} issues={me?.planIssues || []} busy={busy} act={act} />
          </ProductionPlan>
        )}
        {view === 'orders' && <Orders plan={plan} date={date} busy={busy} act={act} checks={me?.qcChecks || {}} reasons={me?.planIssues || []} points={me?.points || {}} failures={me?.failureReasons || []} />}
        {view === 'labels' && (labels?.length ? <>
          <div className="row no-print"><span className="strong">{labels.length} labels · {date}</span><button type="button" className="btn-secondary" style={small} onClick={() => window.print()}>Print</button></div>
          <LabelGrid labels={labels} />
        </> : <p className="help">No labels for this date.</p>)}
        {view === 'conditions' && <Availability plan={plan} items={me?.items || []} date={date} busy={busy} act={act} />}
      </>}
      </div>
    </div>
  );
}

/** Confirm the production plan or report an issue (MB-OPS-001 §4). */
function PlanConfirm({ plan, date, issues, busy, act }) {
  const [issue, setIssue] = useState({ reason: '', note: '' });
  if (!plan.packing.length) return <p className="help no-print">Nothing allocated to you for this date yet. Final allocation happens at 9:00 PM the evening before.</p>;
  return (
    <div className="stack gap-8 no-print">
      {plan.status?.status === 'Confirmed'
        ? <div className="banner-ok" role="status"><Icon name="check" size={18} stroke={2} /><span>You confirmed this plan.</span></div>
        : <button type="button" className="btn" style={{ width: 'auto', padding: '0 24px', alignSelf: 'flex-start' }} disabled={busy} onClick={() => act('POST', '/plan/confirm', { date })}>Confirm production plan</button>}
      {plan.status?.status === 'Issue Reported' && <span className="xs">Issue reported: {plan.status.reason}{plan.status.note ? ` — ${plan.status.note}` : ''}. Morning Box will contact you.</span>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        <select className="input" style={{ width: 260 }} aria-label="Issue" value={issue.reason} onChange={e => setIssue(x => ({ ...x, reason: e.target.value }))}><option value="">Report an issue…</option>{issues.map(k => <option key={k}>{k}</option>)}</select>
        <input className="input" style={{ width: 260 }} placeholder="Details" aria-label="Details" value={issue.note} onChange={e => setIssue(x => ({ ...x, note: e.target.value }))} />
        <button type="button" className="btn-secondary" style={small} disabled={busy || !issue.reason} onClick={() => act('POST', '/plan/issue', { date, ...issue })}>Send</button>
      </div>
      <span className="xs">Don’t change an order yourself after confirming — report it and Morning Box decides what happens.</span>
    </div>
  );
}

/** Per order: In Preparation → Ready (after QC, packing, labels) → Out for delivery → Delivered; delay, unable to fulfil, failed. */
function Orders({ plan, date, busy, act, checks, reasons, points, failures }) {
  const [delay, setDelay] = useState({});
  const [reason, setReason] = useState({});
  const [qc, setQc] = useState({});
  const [count, setCount] = useState({});
  const [eta, setEta] = useState({});
  const [fail, setFail] = useState({});
  const allChecked = k => Object.keys(checks).every(c => qc[k]?.[c]);
  /* Orders waiting on a safety check are never started (MB-BKY-001 §3). */
  const pending = plan.packing.filter(o => (!o.state || o.state === 'Confirmed') && !o.safetyHold && !o.safetyCheck);
  return (
    <section className="stack gap-12">
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}><span className="strong">{plan.packing.length} orders · {plan.boxes} boxes</span>
        {pending.length > 0 && <button type="button" className="btn-secondary" style={small} disabled={busy} onClick={() => act('POST', '/plan/start', { date })}>Start preparing all ({pending.length})</button>}</div>
      {plan.packing.map(o => {
        const k = `${o.kind}/${o.id}`;
        const path = `/days/${k}/state`;
        const gone = o.state === 'Handed Over';
        const done = o.stage >= 3;
        const d = o.dropOff || {};
        const blocked = o.safetyHold || o.safetyCheck;
        const c = count[k] || { boxes: '', special: '' };
        return (
          <article key={k} className={`staff-card${blocked ? ' risk' : o.lines.some(l => l.special.length) ? ' special' : ''}`}>
            <div className="staff-card-head">
              <span className="stack" style={{ gap: 2 }}><b className="staff-ref">{o.ref}{o.shared ? ` · your part: ${o.shared}` : ''}</b><span className="xs">Ready by <b>{o.readyBy}</b> · {o.window}</span></span>
              <span className={`status ${blocked || ['Delayed', 'Unable to Fulfil'].includes(o.state) || o.deliveryState === 'Failed' ? 'off' : o.state === 'Ready' || gone ? 'ok' : o.state === 'In Preparation' ? 'prep' : 'done'}`}>{done ? 'Delivered' : o.deliveryState === 'Failed' ? 'Delivery failed' : gone ? (o.deliveryState ? 'Out for delivery' : 'Your part is out') : o.state || 'Not started'}</span>
            </div>
            <Stepper steps={STEPS} current={stepOf(o)} bad={['Delayed', 'Unable to Fulfil'].includes(o.state) || o.deliveryState === 'Failed'} />
            {o.safetyHold && <div className="banner-err" role="alert"><Icon name="shieldAlert" size={18} stroke={2} /><b>SAFETY HOLD — do not prepare until Morning Box confirms.</b></div>}
            {!o.safetyHold && o.safetyCheck && <div className="banner-err" role="alert"><Icon name="shieldAlert" size={18} stroke={2} /><b>ALLERGY CHECK PENDING — Morning Box is confirming the customer’s allergy note. Do not prepare until it is cleared.</b></div>}
            <div className="staff-lines">
              {o.lines.map((l, i) => <span key={i}><b>{l.qty}× {l.box}</b> · {l.size}{l.special.length ? <b className="staff-special"> · {l.special.join(', ').toUpperCase()}</b> : null}{l.addons.length ? ` + ${l.addons.join(', ')}` : ''}<br /><small>{l.components.join(', ')}</small></span>)}
            </div>
            {o.otherAllergies && !o.lines.some(l => l.special.some(w => w.startsWith('Also avoid'))) && <b className="staff-special">Also avoid: {o.otherAllergies}</b>}
            {/* The bakery delivers: where it goes and how it is handed over (MB-DLV-001 §4, §10). */}
            <span className="xs"><b>Deliver to:</b> {[d.company, d.building, d.place].filter(Boolean).join(', ')} · {d.handover}{d.contact?.name ? ` · ${d.contact.name}${d.contact.mobile ? ` (${d.contact.mobile})` : ''}` : ''}{d.notes ? ` · ${d.notes}` : ''}</span>
            {o.lateNote && !done && <span className="xs">Customer told: arriving around {o.lateNote}</span>}
            {done && <span className="xs">Delivered to {o.delivered?.point}{o.delivered?.late ? ' · after the window' : ''}.</span>}
            {gone && !o.deliveryState && <span className="xs">Your part is out — waiting for the other bakery on this order to send theirs.</span>}
            {gone && !done && o.deliveryState === 'Failed' && (
              <div className="row staff-actions" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                <button type="button" className="btn-secondary" style={small} disabled={busy} onClick={() => act('POST', `/days/${k}/out`)}>Re-attempt delivery</button>
              </div>
            )}
            {gone && !done && o.deliveryState === 'Out for Delivery' && (
              <div className="row staff-actions" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                <b style={{ fontSize: 14 }}>Delivered to:</b>
                {(points[o.kind] || []).filter(p => p !== 'your door' || o.dropOff?.handover === 'Door').map(p => <button key={p} type="button" className="btn-secondary" style={small} disabled={busy} onClick={() => act('POST', `/days/${k}/delivered`, { deliveryPoint: p })}>{p[0].toUpperCase() + p.slice(1)}</button>)}
                <select className="input" style={{ width: 230, minHeight: 40 }} aria-label="Why delivery failed" value={fail[k] || ''} onChange={e => setFail(x => ({ ...x, [k]: e.target.value }))}><option value="">Couldn’t deliver — why?</option>{failures.map(x => <option key={x}>{x}</option>)}</select>
                <button type="button" className="btn-text" disabled={busy || !fail[k]} onClick={() => act('POST', `/days/${k}/failed`, { reason: fail[k] })}>Delivery failed</button>
              </div>
            )}
            {gone && !done && (
              <div className="row staff-actions" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                <input className="input" style={{ width: 110, minHeight: 40 }} placeholder="9:20 AM" aria-label="New arrival time" value={eta[k] || ''} onChange={e => setEta(x => ({ ...x, [k]: e.target.value }))} />
                <button type="button" className="btn-text" disabled={busy || !eta[k]?.trim()} onClick={() => act('POST', `/days/${k}/late`, { eta: eta[k].trim() })}>Running late — tell the customer</button>
              </div>
            )}
            {!gone && (
              <div className="row staff-actions" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                {o.state !== 'In Preparation' && o.state !== 'Ready' && <button type="button" className="btn-text" disabled={busy || blocked} onClick={() => act('POST', path, { state: 'In Preparation' })}>In preparation</button>}
                {o.state !== 'Ready' && <>
                  {/* Final check before Ready (MB-BKY-001 §4). */}
                  <span className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>{Object.entries(checks).map(([id, label]) => (
                    <label key={id} className="row xs" style={{ gap: 6 }}><input type="checkbox" checked={!!qc[k]?.[id]} onChange={e => setQc(x => ({ ...x, [k]: { ...(x[k] || {}), [id]: e.target.checked } }))} />{label}</label>
                  ))}</span>
                  <button type="button" className="btn-secondary" style={small} disabled={busy || blocked || !allChecked(k)} onClick={() => act('POST', path, { state: 'Ready', qc: qc[k] })}>Ready</button>
                </>}
                {o.state === 'Ready' && <>
                  <b style={{ fontSize: 14 }}>Out for delivery — count:</b>
                  <input className="input" style={{ width: 80, minHeight: 40 }} inputMode="numeric" placeholder="Boxes" aria-label="Boxes" value={c.boxes} onChange={e => setCount(x => ({ ...x, [k]: { ...c, boxes: e.target.value } }))} />
                  <input className="input" style={{ width: 90, minHeight: 40 }} inputMode="numeric" placeholder="Special" aria-label="Special boxes" value={c.special} onChange={e => setCount(x => ({ ...x, [k]: { ...c, special: e.target.value } }))} />
                  <button type="button" className="btn-secondary" style={small} disabled={busy || blocked || c.boxes === '' || c.special === ''} onClick={() => act('POST', `/days/${k}/handover`, { boxes: Number(c.boxes), specialBoxes: Number(c.special) })}>Out for delivery</button>
                </>}
                <input className="input" style={{ width: 90, minHeight: 40 }} inputMode="numeric" placeholder="Min" aria-label="Delay in minutes" value={delay[k] || ''} onChange={e => setDelay(x => ({ ...x, [k]: e.target.value }))} />
                <button type="button" className="btn-text" disabled={busy || !delay[k]} onClick={() => act('POST', path, { state: 'Delayed', delayMinutes: Number(delay[k]) })}>Report delay</button>
                <select className="input" style={{ width: 230, minHeight: 40 }} aria-label="Why it can’t be made" value={reason[k] || ''} onChange={e => setReason(x => ({ ...x, [k]: e.target.value }))}><option value="">Unable to fulfil — why?</option>{reasons.map(x => <option key={x}>{x}</option>)}</select>
                <button type="button" className="btn-text" disabled={busy || !reason[k]} onClick={() => act('POST', path, { state: 'Unable to Fulfil', reason: reason[k] })}>Report</button>
              </div>
            )}
          </article>
        );
      })}
      {!plan.packing.length && <p className="help">No orders for this date.</p>}
    </section>
  );
}

/** Temporary conditions before allocation: unavailable items, reduced capacity… (MB-BKY-001 §6). */
function Availability({ plan, items, date, busy, act }) {
  const [v, setV] = useState({ kind: CONDITIONS[0], item: '', capacity: '', need: 'glutenFree', note: '' });
  const name = id => items.find(i => i.id === id)?.name || id;
  return (
    <section className="staff-card">
      <h2 className="h3">Tell Morning Box about {date}</h2>
      <span className="xs">Report it before 9:00 PM the evening before so orders can go to another bakery.</span>
      {plan.conditions.map(c => <span key={c.id} className="xs">• {c.kind}{c.item ? ` — ${name(c.item)}` : ''}{c.capacity != null ? ` — ${c.capacity} boxes` : ''}{c.need ? ` — ${c.need}` : ''}{c.note ? ` · ${c.note}` : ''}</span>)}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
        <select className="input" style={{ width: 260 }} aria-label="Condition" value={v.kind} onChange={e => setV(x => ({ ...x, kind: e.target.value }))}>{CONDITIONS.map(k => <option key={k}>{k}</option>)}</select>
        {v.kind === 'Item Unavailable' && <select className="input" style={{ width: 240 }} aria-label="Item" value={v.item} onChange={e => setV(x => ({ ...x, item: e.target.value }))}><option value="">Choose item</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}
        {v.kind === 'Reduced Capacity' && <input className="input" style={{ width: 120 }} inputMode="numeric" placeholder="Boxes" aria-label="Boxes you can make" value={v.capacity} onChange={e => setV(x => ({ ...x, capacity: e.target.value }))} />}
        {v.kind === 'Special Requirement Unavailable' && <select className="input" style={{ width: 200 }} aria-label="Requirement" value={v.need} onChange={e => setV(x => ({ ...x, need: e.target.value }))}>{['glutenFree', 'nutFree', 'peanutFree', 'dairyFree', 'eggFree', 'vegan', 'sesameFree', 'soyFree'].map(k => <option key={k}>{k}</option>)}</select>}
        <input className="input" style={{ width: 220 }} placeholder="Note" aria-label="Note" value={v.note} onChange={e => setV(x => ({ ...x, note: e.target.value }))} />
        <button type="button" className="btn-secondary" style={small} disabled={busy} onClick={() => act('POST', '/conditions', { ...v, date, capacity: Number(v.capacity) })}>Send</button>
      </div>
    </section>
  );
}
