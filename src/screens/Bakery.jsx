import { useCallback, useEffect, useState } from 'react';
import { Screen, TopBar, Icon } from '../components/ui.jsx';
import { addDaysIso, dubaiTodayIso } from '../domain/standards.js';
import { ProductionPlan, LabelGrid } from './OpsLive.jsx';

/* Bakery View (Master Plan §8; MB-OPS-001 §3–5; MB-BKY-001 §6–7).
   Each partner bakery signs in with its own access code and sees only what is
   allocated to it: the production plan, packing list and labels. It confirms the
   plan or reports an issue, moves orders through In Preparation → Ready, reports
   delays and temporary conditions. Customer contact details are not shared. */
const KEY = 'morningbox.bakery';
const CONDITIONS = ['Item Unavailable', 'Reduced Capacity', 'Special Requirement Unavailable', 'Temporarily Unavailable'];
const small = { width: 'auto', padding: '0 14px', minHeight: 40 };

export default function Bakery() {
  const [code, setCode] = useState(() => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [draft, setDraft] = useState('');
  const [me, setMe] = useState(null);
  const [date, setDate] = useState(() => addDaysIso(dubaiTodayIso(), 1));
  const [plan, setPlan] = useState(null);
  const [labels, setLabels] = useState(null);
  const [view, setView] = useState('plan');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
      setMe(await call('GET', '/me'));
      setPlan(await call('GET', `/plan?date=${date}`));
      setLabels((await call('GET', `/labels?date=${date}`)).labels);
    } catch (e) { setError(e.message); if (e.status === 401) save(''); }
  }, [code, date, call]);
  useEffect(() => { load(); }, [load]);
  const act = async (method, path, body) => {
    setBusy(true); setError('');
    try { await call(method, path, body); await load(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };

  if (!code) {
    return (
      <Screen>
        <TopBar back="/" close={null}><span className="topbar-title">Partner bakery</span></TopBar>
        <main className="screen-main" style={{ paddingTop: 24, gap: 18 }}>
          <h1 className="h-display" style={{ fontSize: 34 }}>Bakery sign-in</h1>
          <p className="help">Use the access code Morning Box gave your bakery.</p>
          <div className="field"><label htmlFor="bk-c">Access code</label>
            <input id="bk-c" className="input" inputMode="numeric" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={e => e.key === 'Enter' && draft && save(draft)} /></div>
          <button type="button" className="btn" disabled={draft.length < 8} onClick={() => save(draft)}>Open my production plan</button>
        </main>
      </Screen>
    );
  }

  return (
    <div className="ops">
      <header className="ops-head no-print">
        <strong className="serif" style={{ fontSize: 24 }}>{me?.name || 'Partner bakery'} · Morning Box</strong>
        <span className="row" style={{ gap: 10 }}>
          <input className="input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Date" style={{ width: 170, minHeight: 44 }} />
          <button type="button" className="btn-text" onClick={() => save('')}>Sign out</button>
        </span>
      </header>
      <nav className="ops-tabs no-print" role="tablist">
        {[['plan', 'Production plan'], ['orders', 'Orders'], ['labels', 'Labels'], ['conditions', 'Availability']].map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>)}
      </nav>
      {error && <div className="banner-err no-print" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
      {!plan ? <p className="help">Loading…</p> : <>
        {view === 'plan' && (
          <ProductionPlan plan={plan} date={date}>
            <PlanConfirm plan={plan} date={date} issues={me?.planIssues || []} busy={busy} act={act} />
          </ProductionPlan>
        )}
        {view === 'orders' && <Orders plan={plan} date={date} busy={busy} act={act} checks={me?.qcChecks || {}} reasons={me?.planIssues || []} />}
        {view === 'labels' && (labels?.length ? <>
          <div className="row no-print"><span className="strong">{labels.length} labels · {date}</span><button type="button" className="btn-secondary" style={small} onClick={() => window.print()}>Print</button></div>
          <LabelGrid labels={labels} />
        </> : <p className="help">No labels for this date.</p>)}
        {view === 'conditions' && <Availability plan={plan} items={me?.items || []} date={date} busy={busy} act={act} />}
      </>}
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

/** Per order: In Preparation → Ready (after QC, packing, labels), Report delay, Unable to fulfil. */
function Orders({ plan, date, busy, act, checks, reasons }) {
  const [delay, setDelay] = useState({});
  const [reason, setReason] = useState({});
  const [qc, setQc] = useState({});
  const [count, setCount] = useState({});
  const allChecked = k => Object.keys(checks).every(c => qc[k]?.[c]);
  const pending = plan.packing.filter(o => !o.state || o.state === 'Confirmed');
  return (
    <section className="stack gap-12">
      <div className="row"><span className="strong">{plan.packing.length} orders · {plan.boxes} boxes</span>
        {pending.length > 0 && <button type="button" className="btn-secondary" style={small} disabled={busy} onClick={() => act('POST', '/plan/start', { date })}>Start preparing all ({pending.length})</button>}</div>
      {plan.packing.map(o => {
        const k = `${o.kind}/${o.id}`;
        const path = `/days/${k}/state`;
        const gone = o.state === 'Handed Over';
        const c = count[k] || { boxes: '', special: '' };
        return (
          <article key={k} className={`card stack gap-8${o.safetyHold || o.lines.some(l => l.special.length) ? ' warn' : ''}`} style={{ padding: 16 }}>
            <div className="row" style={{ flexWrap: 'wrap' }}><b>{o.ref}{o.shared ? ` · your part: ${o.shared}` : ''}</b><span className="xs">Ready by {o.readyBy} · {o.window} · {o.state || 'Not started'}</span></div>
            {o.safetyHold && <b>SAFETY HOLD — do not prepare until Morning Box confirms.</b>}
            {o.lines.map((l, i) => <span key={i}>{l.qty}× {l.box} · {l.size}{l.special.length ? <b> · {l.special.join(', ').toUpperCase()}</b> : null}{l.addons.length ? ` + ${l.addons.join(', ')}` : ''}<br /><small>{l.components.join(', ')}</small></span>)}
            {o.otherAllergies && <b>Also avoid: {o.otherAllergies}</b>}
            {!gone && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                {o.state !== 'In Preparation' && o.state !== 'Ready' && <button type="button" className="btn-text" disabled={busy} onClick={() => act('POST', path, { state: 'In Preparation' })}>In preparation</button>}
                {o.state !== 'Ready' && <>
                  {/* Final check before Ready (MB-BKY-001 §4). */}
                  <span className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>{Object.entries(checks).map(([id, label]) => (
                    <label key={id} className="row xs" style={{ gap: 6 }}><input type="checkbox" checked={!!qc[k]?.[id]} onChange={e => setQc(x => ({ ...x, [k]: { ...(x[k] || {}), [id]: e.target.checked } }))} />{label}</label>
                  ))}</span>
                  <button type="button" className="btn-secondary" style={small} disabled={busy || !allChecked(k)} onClick={() => act('POST', path, { state: 'Ready', qc: qc[k] })}>Ready</button>
                </>}
                {o.state === 'Ready' && <>
                  <b style={{ fontSize: 14 }}>Hand over to courier{o.routeId ? ` (${o.routeId})` : ''} — count:</b>
                  <input className="input" style={{ width: 80, minHeight: 40 }} inputMode="numeric" placeholder="Boxes" aria-label="Boxes" value={c.boxes} onChange={e => setCount(x => ({ ...x, [k]: { ...c, boxes: e.target.value } }))} />
                  <input className="input" style={{ width: 90, minHeight: 40 }} inputMode="numeric" placeholder="Special" aria-label="Special boxes" value={c.special} onChange={e => setCount(x => ({ ...x, [k]: { ...c, special: e.target.value } }))} />
                  <button type="button" className="btn-secondary" style={small} disabled={busy || c.boxes === '' || c.special === ''} onClick={() => act('POST', `/days/${k}/handover`, { boxes: Number(c.boxes), specialBoxes: Number(c.special) })}>Handed over</button>
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
    <section className="card stack gap-12" style={{ padding: 18 }}>
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
