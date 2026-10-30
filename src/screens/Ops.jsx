import { useCallback, useEffect, useState } from 'react';
import { Screen, TopBar, Icon } from '../components/ui.jsx';
import { addDaysIso, dubaiTodayIso } from '../domain/standards.js';
import { Live, Prep, Labels } from './OpsLive.jsx';
import { Bakeries, Pricing, Company, Products } from './OpsAdmin.jsx';
import { MenuRules } from './OpsMenu.jsx';
import { Dashboard } from './OpsDashboard.jsx';

/* Operations & admin console for the Morning Box team: live deliveries, production
   plans, labels, exceptions, support, feedback, reports, closed days, and Admin
   (partner bakeries, prices, company details).
   Protected by the server's OPS_KEY (kept for this browser tab only). */
const KEY = 'morningbox.ops';
/* Sections, grouped for the side navigation: [id, label, icon]. */
const GROUPS = [
  ['Overview', [['home', 'Dashboard', 'home']]],
  ['Today', [['days', 'Live', 'clock'], ['prep', 'Production', 'bread'], ['labels', 'Labels', 'doc']]],
  ['Service', [['exceptions', 'Exceptions', 'alert'], ['support', 'Support', 'help'], ['feedback', 'Feedback', 'heart']]],
  ['Insights', [['report', 'Reports', 'bookmark'], ['closed', 'Closed days', 'cal']]],
  ['Admin', [['bakeries', 'Bakeries', 'building'], ['menu', 'Menu rules', 'bowl'], ['products', 'Products & allergens', 'shieldAlert'], ['pricing', 'Prices', 'card'], ['company', 'Company', 'brief']]]
];
const TABS = GROUPS.flatMap(([group, items]) => items.map(([id, label, icon]) => ({ id, label, icon, group })));

function useOps() {
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } });
  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`./api/ops${path}`, { method, headers: { 'content-type': 'application/json', 'x-ops-key': key }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.message || 'Request failed'), { status: res.status });
    return data;
  }, [key]);
  const save = k => { try { sessionStorage.setItem(KEY, k); } catch { /* tab only */ } setKey(k); };
  return { key, save, call };
}

export default function Ops() {
  const { key, save, call } = useOps();
  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState('home');
  const [date, setDate] = useState(() => addDaysIso(dubaiTodayIso(), 1));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState(() => ({ from: addDaysIso(dubaiTodayIso(), -14), to: addDaysIso(dubaiTodayIso(), 14) }));

  const load = useCallback(async () => {
    if (!key) return;
    setError(''); setData(null);
    const path = { home: `/dashboard?date=${date}`, days: `/dashboard?date=${date}`, prep: `/prep?date=${date}`, labels: `/labels?date=${date}`, support: '/support', feedback: '/feedback', exceptions: '/exceptions', closed: '/closed-dates',
      report: `/report?from=${range.from}&to=${range.to}`, bakeries: '/admin/bakeries', menu: '/admin/menu', products: '/admin/products', pricing: '/admin/pricing', company: '/admin/company' }[tab];
    try { const value = await call('GET', path); setData({ key: `${tab}|${date}|${range.from}|${range.to}`, value }); } catch (e) { setError(e.message); if (e.status === 401) save(''); }
  }, [key, tab, date, range, call]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  /* Run an action, reload the tab; resolves true when it worked (errors show in the banner). */
  const act = async (method, path, body) => {
    setBusy(true); setError('');
    try { await call(method, path, body); await load(); return true; } catch (e) { setError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; } finally { setBusy(false); }
  };
  const [meta, setMeta] = useState(null);
  useEffect(() => { if (key) call('GET', '/meta').then(setMeta).catch(() => {}); }, [key, call]);

  if (!key) {
    return (
      <Screen>
        <TopBar back="/" close={null}><span className="topbar-title">Operations</span></TopBar>
        <main className="screen-main" style={{ paddingTop: 24, gap: 18 }}>
          <h1 className="h-display" style={{ fontSize: 34 }}>Team sign-in</h1>
          <div className="field"><label htmlFor="ops-k">Operations key</label>
            <input id="ops-k" className="input" type="password" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && draft && save(draft)} /></div>
          <button type="button" className="btn" disabled={!draft} onClick={() => save(draft)}>Open console</button>
        </main>
      </Screen>
    );
  }

  const dated = ['home', 'days', 'prep', 'labels'].includes(tab);
  /* Only show data loaded for the current tab and date. */
  const view = data?.key === `${tab}|${date}|${range.from}|${range.to}` ? data.value : null;
  const current = TABS.find(t => t.id === tab);
  return (
    <div className="ops-shell">
      <aside className="ops-side no-print">
        <div className="ops-brand">
          <span className="ops-brand-mark"><Icon name="sunny" size={22} stroke={1.6} /></span>
          <span className="stack" style={{ gap: 2 }}><strong className="serif" style={{ fontSize: 20 }}>Morning Box</strong><span className="ops-brand-sub">Operations</span></span>
        </div>
        <nav className="ops-nav" aria-label="Console sections">
          {GROUPS.map(([group, items]) => (
            <div key={group} className="ops-nav-group">
              <span className="ops-nav-label">{group}</span>
              {items.map(([id, label, icon]) => (
                <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                  <Icon name={icon} size={18} stroke={1.6} /><span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" className="ops-signout" onClick={() => save('')}><Icon name="logout" size={18} stroke={1.6} /><span>Sign out</span></button>
      </aside>

      <div className="ops">
        <header className="ops-head no-print">
          <span className="stack" style={{ gap: 2 }}>
            <span className="eyebrow">{current?.group}</span>
            <h1 className="serif ops-title">{current?.label}</h1>
          </span>
          <span className="row" style={{ gap: 10 }}>
            {dated && <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" style={{ width: 170, minHeight: 44 }} />}
            {tab === 'report' && <>
              <input className="input" type="date" value={range.from} max={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} aria-label="From" style={{ width: 170, minHeight: 44 }} />
              <input className="input" type="date" value={range.to} min={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} aria-label="To" style={{ width: 170, minHeight: 44 }} />
            </>}
          </span>
        </header>
        {error && <div className="banner-err no-print" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
        {!view && !error && <p className="help">Loading…</p>}
        {view && tab === 'home' && <Dashboard data={view} call={call} open={setTab} />}
        {view && meta && tab === 'days' && <Live data={view} meta={meta} busy={busy} act={act} call={call} />}
        {view && tab === 'prep' && <Prep data={view} />}
        {view && tab === 'labels' && <Labels data={view} />}
        {view && tab === 'support' && <Support items={view} busy={busy} act={act} />}
        {view && tab === 'feedback' && <Feedback data={view} />}
        {view && tab === 'exceptions' && <Exceptions items={view} busy={busy} act={act} call={call} />}
        {view && tab === 'closed' && <Closed items={view} busy={busy} act={act} />}
        {view && tab === 'report' && <Report data={view} />}
        {view && tab === 'bakeries' && <Bakeries items={view} call={call} act={act} busy={busy} />}
        {view && tab === 'menu' && <MenuRules data={view} act={act} busy={busy} call={call} />}
        {view && tab === 'products' && <Products data={view} />}
        {view && tab === 'pricing' && <Pricing data={view} act={act} busy={busy} />}
        {view && tab === 'company' && <Company data={view} act={act} busy={busy} call={call} />}
      </div>
    </div>
  );
}

function Support({ items, busy, act }) {
  const [replies, setReplies] = useState({});
  return (
    <section className="stack gap-12">
      {items.map(s => (
        <article key={s.id} className="card stack gap-8" style={{ padding: 18 }}>
          <div className="row"><span className="strong">{s.customer} · {s.mobile} · {s.topic}{s.orderRef ? ` · ${s.orderRef}` : ''}</span><span className={`status ${s.status === 'open' ? 'prep' : 'ok'}`}>{s.status}</span></div>
          <span className="help">{s.message}</span>
          <span className="xs">{s.createdAt} UTC</span>
          {s.reply && <div className="note"><span><b>Replied:</b> {s.reply}</span></div>}
          {s.status !== 'closed' && (
            <div className="stack gap-8">
              <textarea className="input" rows={2} placeholder="Reply to the customer" value={replies[s.id] || ''} onChange={e => setReplies(r => ({ ...r, [s.id]: e.target.value }))} style={{ paddingTop: 10 }} />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="btn-text" disabled={busy} onClick={() => act('POST', `/support/${s.id}/close`)}>Close</button>
                <button type="button" className="btn" style={{ width: 'auto', padding: '0 22px' }} disabled={busy || !replies[s.id]?.trim()} onClick={() => act('POST', `/support/${s.id}/reply`, { reply: replies[s.id] })}>Send reply</button>
              </div>
            </div>
          )}
        </article>
      ))}
      {!items.length && <p className="help">No support messages.</p>}
    </section>
  );
}

function Feedback({ data }) {
  const count = v => data.items.filter(i => i.value === v).length;
  return (
    <section className="stack gap-12">
      <div className="grid-2">
        <div className="card stack gap-4"><span className="xs">Loved it</span><span className="serif" style={{ fontSize: 34 }}>{count('Loved it')}</span></div>
        <div className="card stack gap-4"><span className="xs">Not for me</span><span className="serif" style={{ fontSize: 34 }}>{count('Not for me')}</span></div>
      </div>
      <table className="ops-table">
        <thead><tr><th>Date</th><th>Customer</th><th>Breakfast</th><th>Feedback</th><th>Reason</th></tr></thead>
        <tbody>{data.items.map(i => (
          <tr key={i.orderId + i.date} className={i.value === 'Not for me' ? 'warn' : ''}>
            <td>{i.date}</td><td>{i.customer}</td><td>{i.box}</td><td>{i.value}</td><td>{i.reasons.join(', ')}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

const CATEGORY_CLASS = { Safety: 'off', Bakery: 'prep', Courier: 'prep' /* older exceptions */, Payment: 'prep', 'Customer/Location': 'done' };
/* MB-OPS-001 §8: Safety first; every exception has an Owner, Action and Resolution. */
function Exceptions({ items, busy, act, call }) {
  const [kinds, setKinds] = useState([]);
  const [show, setShow] = useState('open');
  const [form, setForm] = useState({ ref: '', kind: '', note: '', owner: '', action: '' });
  useEffect(() => { call('GET', '/exceptions/kinds').then(setKinds).catch(() => {}); }, [call]);
  const open = items.filter(x => !x.resolved);
  const list = show === 'open' ? open : items;
  return (
    <section className="stack gap-12">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="strong">{open.length} open · {open.filter(x => x.category === 'Safety').length} safety</span>
        <div className="ops-tabs">{[['open', 'Open'], ['all', 'All']].map(([id, label]) => <button key={id} className={show === id ? 'on' : ''} onClick={() => setShow(id)}>{label}</button>)}</div>
      </div>
      <details className="card" style={{ padding: 16 }}>
        <summary className="strong" style={{ cursor: 'pointer' }}>Log an exception</summary>
        <div className="stack gap-8" style={{ marginTop: 12 }}>
          <div className="grid-2">
            <select className="input" aria-label="Type" value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}><option value="">Type…</option>{kinds.map(k => <option key={k}>{k}</option>)}</select>
            <input className="input" placeholder="Order or reference" value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} />
            <input className="input" placeholder="Owner" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
            <input className="input" placeholder="Action" value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} />
          </div>
          <input className="input" placeholder="What happened" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px', alignSelf: 'flex-start' }} disabled={busy || !form.kind} onClick={() => act('POST', '/exceptions', form).then(ok => ok && setForm({ ref: '', kind: '', note: '', owner: '', action: '' }))}>Log it</button>
        </div>
      </details>
      {list.slice(0, 150).map(x => <ExceptionCard key={x.id} x={x} busy={busy} act={act} call={call} />)}
      {!list.length && <p className="help">No open exceptions.</p>}
    </section>
  );
}
/** The customer's photo from a problem report, loaded on request. */
function ExceptionPhoto({ id, call }) {
  const [src, setSrc] = useState('');
  const [err, setErr] = useState('');
  if (src) return <img src={src} alt="Photo from the customer" style={{ maxWidth: 320, borderRadius: 12 }} />;
  return <span className="row" style={{ gap: 8, justifyContent: 'flex-start' }}><button type="button" className="btn-text" onClick={() => call('GET', `/exceptions/${id}/photo`).then(r => setSrc(r.photo)).catch(e => setErr(e.message))}>View customer’s photo</button>{err && <span className="xs">{err}</span>}</span>;
}

function ExceptionCard({ x, busy, act, call }) {
  const [v, setV] = useState({ owner: x.owner || '', action: x.action || '', cause: x.cause || '', responsibleParty: x.responsible_party || '', resolution: '' });
  const set = k => e => setV(f => ({ ...f, [k]: e.target.value }));
  return (
    <article className={`card stack gap-8${!x.resolved && x.priority <= 1 ? ' warn' : ''}`} style={{ padding: 16, opacity: x.resolved ? 0.65 : 1 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="row" style={{ gap: 8 }}><span className={`status ${CATEGORY_CLASS[x.category] || 'done'}`}>P{x.priority} · {x.category || '—'}</span><span className="strong">{x.kind}</span></span>
        <span className="xs">{x.ref} · {x.created_at}</span>
      </div>
      <span className="help">{x.note}</span>
      {!!x.has_photo && <ExceptionPhoto id={x.id} call={call} />}
      {x.resolved ? <span className="xs">Resolved {x.resolved_at} by {x.owner || '—'}: {x.resolution}{x.cause ? ` · Cause: ${x.cause}` : ''}</span> : (
        <>
          <div className="grid-2">
            <input className="input" placeholder="Owner" aria-label="Owner" value={v.owner} onChange={set('owner')} />
            <input className="input" placeholder="Action" aria-label="Action" value={v.action} onChange={set('action')} />
            <input className="input" placeholder="Cause" aria-label="Cause" value={v.cause} onChange={set('cause')} />
            <input className="input" placeholder="Responsible party" aria-label="Responsible party" value={v.responsibleParty} onChange={set('responsibleParty')} />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-text" disabled={busy} onClick={() => act('PATCH', `/exceptions/${x.id}`, { owner: v.owner, action: v.action, cause: v.cause, responsibleParty: v.responsibleParty })}>Save</button>
            <span className="row" style={{ gap: 8, flex: 1, minWidth: 260 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Resolution: what was done" aria-label="Resolution" value={v.resolution} onChange={set('resolution')} />
              <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 16px' }} disabled={busy || !v.resolution.trim() || !v.owner.trim() || !v.action.trim()} title="Owner, action and resolution are all required (MB-OPS-001 §8)" onClick={() => act('POST', `/exceptions/${x.id}/resolve`, { resolution: v.resolution, owner: v.owner, action: v.action })}>Resolve</button>
            </span>
          </div>
        </>
      )}
    </article>
  );
}

function Closed({ items, busy, act }) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  return (
    <section className="stack gap-12">
      <div className="card stack gap-12" style={{ padding: 18 }}>
        <span className="strong">Close a day (public holiday, closure)</span>
        <div className="grid-2">
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" />
          <input className="input" placeholder="Reason, e.g. National Day" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason" />
        </div>
        <button type="button" className="btn" disabled={busy || !date} onClick={() => act('POST', '/closed-dates', { date, reason })}>Close this day</button>
        <span className="xs">Customers can’t order closed days. Orders already booked for that day are not cancelled automatically. Check Deliveries.</span>
      </div>
      {items.map(c => (
        <div key={c.date} className="card row" style={{ padding: 16 }}>
          <span><b>{c.date}</b> · {c.reason}</span>
          <button type="button" className="btn-text" disabled={busy} onClick={() => act('DELETE', `/closed-dates/${c.date}`)}>Reopen</button>
        </div>
      ))}
    </section>
  );
}

const CSV_COLUMNS = [['date', 'Date'], ['boxes', 'Boxes'], ['personalMornings', 'Personal mornings'], ['businessOrders', 'Business orders'], ['businessBoxes', 'Business boxes'],
  ['personalRevenue', 'Personal revenue AED'], ['businessRevenue', 'Business revenue AED'], ['businessDiscounts', 'Business discounts AED'], ['revenue', 'Revenue AED (incl. VAT)'],
  ['cancelled', 'Cancelled'], ['refundedOrders', 'Refunded orders'], ['refunds', 'Refunds AED'], ['credits', 'Credits AED'], ['delivered', 'Delivered'], ['onTime', 'On time'], ['late', 'Late'], ['failed', 'Failed'],
  ['exceptions', 'Exceptions'], ['safety', 'Safety'], ['bakeryIssues', 'Bakery issues'], ['customerIssues', 'Customer/location issues'],
  ['loved', 'Loved it'], ['notForMe', 'Not for me']];

/* Daily operational snapshot (MB-OPS-001 §9, §11), partner performance and KPIs (Master Plan §15). */
function Report({ data }) {
  const t = data.totals;
  const vat = n => n - n / (1 + data.vatRate);
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const exportCsv = () => {
    const cell = v => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [CSV_COLUMNS.map(c => c[1]), ...data.days.map(d => CSV_COLUMNS.map(c => d[c[0]]))].map(r => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `morning-box-report-${data.from}-to-${data.to}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const Tile = ({ label, value }) => <div className="card stack gap-4"><span className="xs">{label}</span><span className="serif" style={{ fontSize: 30 }}>{value}</span></div>;
  const k = data.kpis;
  return (
    <section className="stack gap-12">
      <div className="row no-print"><span className="strong">{data.from} to {data.to}</span>
        <span className="row" style={{ gap: 10 }}>
          <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px' }} disabled={!data.days.length} onClick={exportCsv}>Export CSV</button>
          <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '0 18px' }} onClick={() => window.print()}>Print</button>
        </span></div>
      <div className="grid-2">
        <Tile label="Revenue (incl. VAT)" value={`AED ${t.revenue.toLocaleString('en-GB')}`} />
        <Tile label="Boxes booked" value={t.boxes} />
        <Tile label="On time" value={`${pct(t.onTime, t.delivered)} of ${t.delivered}`} />
        <Tile label="Late / failed" value={`${t.late} / ${t.failed}`} />
        <Tile label="Exceptions (safety)" value={`${t.exceptions} (${t.safety})`} />
        <Tile label="Loved it / Not for me" value={`${t.loved} / ${t.notForMe}`} />
      </div>
      <p className="help" style={{ margin: 0 }}>Personal AED {t.personalRevenue} · Business AED {t.businessRevenue} ({t.businessBoxes} boxes, {t.businessOrders} orders) · VAT included AED {vat(t.revenue).toFixed(2)} · Cancelled {t.cancelled} · Refunds AED {t.refunds} ({t.refundedOrders ?? 0} orders) · Credits AED {t.credits} · {t.customers} customers</p>
      <h2 className="h3">Daily snapshot</h2>
      <table className="ops-table">
        <thead><tr><th>Date</th><th>Boxes</th><th>Revenue</th><th>Delivered</th><th>On time</th><th>Late</th><th>Failed</th><th>Refunds</th><th>Exceptions</th><th>Feedback</th></tr></thead>
        <tbody>{data.days.map(d => (
          <tr key={d.date} className={d.failed || d.safety ? 'warn' : ''}><td>{d.date}</td><td>{d.boxes}{d.businessBoxes ? <small> ({d.businessBoxes} business)</small> : null}</td><td>{d.revenue}</td>
            <td>{d.delivered}</td><td>{d.onTime}</td><td>{d.late}</td><td>{d.failed}</td><td>{d.refunds}{d.refundedOrders ? <small> ({d.refundedOrders} order{d.refundedOrders > 1 ? 's' : ''})</small> : null}{d.credits ? <small> + {d.credits} credit</small> : null}</td>
            <td>{d.exceptions ? <small>{d.exceptions}: {[['Safety', d.safety], ['Bakery', d.bakeryIssues], ['Customer', d.customerIssues]].filter(x => x[1]).map(x => `${x[0]} ${x[1]}`).join(', ')}</small> : 0}</td>
            <td>{d.loved || d.notForMe ? `${d.loved} / ${d.notForMe}` : '—'}</td></tr>
        ))}</tbody>
      </table>
      {!data.days.length && <p className="help">No orders in this period.</p>}
      <h2 className="h3">Finance</h2>
      <div className="grid-2">
        <Tile label="Customer payments" value={`AED ${data.finance.payments}`} />
        <Tile label="Refunds" value={`AED ${data.finance.refunds}`} />
        <Tile label="Bakery payable" value={`AED ${data.finance.bakeryPayable}`} />
        <Tile label="Delivery cost" value={`AED ${data.finance.deliveryCost}`} />
        <Tile label="Morning Box margin" value={`AED ${data.finance.margin}`} />
        <Tile label="Completed (proof of delivery)" value={data.completed} />
      </div>
      <h2 className="h3">Partner bakeries</h2>
      <table className="ops-table">
        <thead><tr><th>Bakery</th><th>Mornings / boxes</th><th>Delivered</th><th>Ready on time</th><th>Delayed</th><th>Not fulfilled</th><th>Plans confirmed</th><th>Accuracy / quality issues</th><th>Loved it / Not for me</th></tr></thead>
        <tbody>{data.partners.map(p => <tr key={p.id} className={p.unable || p.accuracyIssues ? 'warn' : ''}><td>{p.name}</td><td>{p.mornings} / {p.boxes}</td><td>{p.delivered}</td><td>{p.readyOnTime != null ? `${p.readyOnTime}%` : '—'}</td><td>{p.delayed}</td><td>{p.unable}</td><td>{p.planConfirmation != null ? `${p.planConfirmation}% of ${p.plans}` : '—'}</td><td>{p.accuracyIssues} / {p.qualityIssues}</td><td>{p.loved} / {p.notForMe}</td></tr>)}</tbody>
      </table>
      <h2 className="h3">Reconciliation</h2>
      {data.reconciliation.length ? (
        <table className="ops-table"><thead><tr><th>Order</th><th>Mismatch</th></tr></thead>
          <tbody>{data.reconciliation.map((r, i) => <tr key={i} className="warn"><td>{r.ref}{r.kind === 'business' ? ' (business)' : ''}</td><td>{r.issue}</td></tr>)}</tbody></table>
      ) : <p className="help" style={{ margin: 0 }}>All past orders reconcile: order, bakery handover and delivery records match.</p>}
      <h2 className="h3">Recommendations</h2>
      <div className="grid-2">
        <Tile label="Your Morning Box chosen" value={k.yourMorningBoxAccepted != null ? `${k.yourMorningBoxAccepted}%` : '—'} />
        <Tile label="Another option chosen" value={k.anotherOptionChosen != null ? `${k.anotherOptionChosen}%` : '—'} />
        <Tile label="Mornings with a swap" value={k.swapRate != null ? `${k.swapRate}%` : '—'} />
        <Tile label="Mornings with add-ons" value={k.addonRate != null ? `${k.addonRate}%` : '—'} />
        <Tile label="No safe match" value={k.noMatchRate != null ? `${k.noMatchRate}%` : '—'} />
        <Tile label="Size mix" value={k.sizeMix.map(x => `${x.size[0].toUpperCase()}${x.pct}%`).join(' ') || '—'} />
      </div>
      <div className="grid-2">
        <Tile label="Active / repeat customers" value={`${k.activeCustomers} / ${k.repeatCustomers}`} />
        <Tile label="Ordered in 2+ weeks" value={k.repeatWeekCustomers} />
        <Tile label="Mornings per active customer" value={k.morningsPerActiveCustomer ?? '—'} />
        <Tile label="Average order value · personal / business" value={`${k.averageOrderValue != null ? `AED ${k.averageOrderValue}` : '—'} / ${k.averageOrderValueBusiness != null ? `AED ${k.averageOrderValueBusiness}` : '—'}`} />
        <Tile label="Repeat breakfast (same box twice+)" value={k.repeatBreakfast != null ? `${k.repeatBreakfast}%` : '—'} />
        <Tile label="Exception rate (per delivery)" value={k.exceptionRate != null ? `${k.exceptionRate}%` : '—'} />
        <Tile label="Business: inquiries · people/order · repeat" value={`${k.businessInquiries} · ${k.peoplePerBusinessOrder ?? '—'} · ${k.repeatBusinessCustomers}`} />
        <Tile label="Proof of delivery complete" value={k.podCompletion != null ? `${k.podCompletion}%` : '—'} />
      </div>
      <p className="help" style={{ margin: 0 }}>On time by window: {k.onTimeByWindow.map(w => `${w.window.toUpperCase()} ${w.onTime != null ? `${w.onTime}%` : '—'} (${w.delivered})`).join(' · ')}</p>
      <table className="ops-table">
        <thead><tr><th>Funnel</th>{k.funnel.map(f => <th key={f.step}>{f.step.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody><tr><td>Count</td>{k.funnel.map(f => <td key={f.step}>{f.count}</td>)}</tr></tbody>
      </table>
    </section>
  );
}
