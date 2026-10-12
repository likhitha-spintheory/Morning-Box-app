import { useCallback, useEffect, useState } from 'react';
import { Screen, TopBar, Icon } from '../components/ui.jsx';
import { dubaiTodayIso } from '../domain/standards.js';

/* Courier View (MB-OPS-001 §6–7; MB-DLV-001 §4–6, §10).
   Each courier signs in with its own access code and sees only the deliveries on
   its route, with only what pickup and handover need: Order ID, window, box and
   special-box counts, ready-by, bakery pickup point, drop-off, handover preference
   and (business) the contact person. No prices, allergen detail or customer email.
   Pickup counts must match before anything is dispatched; handover is delivery. */
const KEY = 'morningbox.courier';
const big = { minHeight: 56, fontSize: 17 };

const at = s => (s ? new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' }).toUpperCase() : '');
function badge(d) {
  if (d.stage >= 3) return ['Delivered', 'done'];
  if (d.deliveryState === 'Failed') return ['Failed — re-attempt or call Morning Box', 'off'];
  if (d.deliveryState === 'Out for Delivery') return ['Out for delivery', 'ok'];
  if (d.deliveryState === 'Picked Up') return ['Picked up', 'ok'];
  if (d.deliveryState === 'Not Fulfilled') return ['Cancelled by Morning Box', 'off'];
  if (d.hold) return ['On hold — do not collect', 'off'];
  if (d.pickups.some(p => p.state === 'Ready' || p.state === 'Handed Over')) return ['Ready for pickup', 'prep'];
  return [`At the bakery · ${d.bakeryState || 'not started'}`, 'done'];
}

export default function Courier() {
  const [code, setCode] = useState(() => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [draft, setDraft] = useState('');
  const [me, setMe] = useState(null);
  const [date, setDate] = useState(() => dubaiTodayIso());
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = k => { try { sessionStorage.setItem(KEY, k); } catch { /* tab only */ } setCode(k); };

  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`./api/courier${path}`, { method, headers: { 'content-type': 'application/json', 'x-courier-code': code }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.message || 'Request failed'), { status: res.status });
    return data;
  }, [code]);
  const load = useCallback(async () => {
    if (!code) return;
    setError('');
    try {
      setMe(await call('GET', '/me'));
      setList((await call('GET', `/deliveries?date=${date}`)).deliveries);
    } catch (e) { setError(e.message); if (e.status === 401) save(''); }
  }, [code, date, call]);
  useEffect(() => { load(); }, [load]);
  const act = async (path, body) => {
    setBusy(true); setError('');
    try { await call('POST', path, body); await load(); return true; } catch (e) { setError(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }); await load(); return false; } finally { setBusy(false); }
  };

  if (!code) {
    return (
      <Screen>
        <TopBar back="/" close={null}><span className="topbar-title">Courier</span></TopBar>
        <main className="screen-main" style={{ paddingTop: 24, gap: 18 }}>
          <h1 className="h-display" style={{ fontSize: 34 }}>Courier sign-in</h1>
          <p className="help">Use the access code Morning Box gave you for your route.</p>
          <div className="field"><label htmlFor="cr-c">Access code</label>
            <input id="cr-c" className="input" inputMode="numeric" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 8))} onKeyDown={e => e.key === 'Enter' && draft.length === 8 && save(draft)} /></div>
          <button type="button" className="btn" disabled={draft.length < 8} onClick={() => save(draft)}>Open my route</button>
        </main>
      </Screen>
    );
  }

  const windows = [...new Set((list || []).map(d => d.window))];
  const left = (list || []).filter(d => d.stage < 3).length;
  return (
    <Screen>
      <TopBar close={null}><span className="topbar-title">{me ? `Route ${me.routeId}` : 'Courier'}</span></TopBar>
      <main className="screen-main tight" style={{ paddingTop: 8 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="strong">{me?.name || ''}</span>
          <button type="button" className="btn-text" onClick={() => save('')}>Sign out</button>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <input className="input" type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label="Date" style={{ flex: 1, minHeight: 48 }} />
          <button type="button" className="btn-secondary" style={{ width: 'auto', minHeight: 48 }} disabled={busy} onClick={load}>Refresh</button>
        </div>
        {error && <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
        {!list ? <p className="help">Loading…</p> : !list.length ? <p className="help">No deliveries on your route for this date.</p> : <>
          <span className="xs">{list.length} deliveries · {left ? `${left} to go` : 'all delivered'}</span>
          {windows.map(w => (
            <section key={w} className="stack gap-12">
              <h2 className="h3" style={{ marginTop: 8 }}>{list.find(d => d.window === w).windowLabel}</h2>
              {list.filter(d => d.window === w).map(d => <Delivery key={`${d.kind}/${d.id}`} d={d} me={me} busy={busy} act={act} />)}
            </section>
          ))}
        </>}
      </main>
    </Screen>
  );
}

function Delivery({ d, me, busy, act }) {
  const path = `/days/${d.kind}/${d.id}`;
  const [count, setCount] = useState({});
  const [point, setPoint] = useState('');
  const [fail, setFail] = useState({ open: false, reason: '', note: '' });
  const [label, cls] = badge(d);
  const points = me?.points?.[d.kind] || [];
  const done = d.stage >= 3;
  const toCollect = !d.deliveryState && !done;
  return (
    <article className={`card stack gap-10${d.specialBoxes || d.hold ? ' warn' : ''}`} style={{ padding: 16 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <b style={{ fontSize: 20 }}>{d.ref}</b>
        <span className={`status ${cls}`}>{label}</span>
      </div>
      <span style={{ fontSize: 17 }}><b>{d.boxes} box{d.boxes === 1 ? '' : 'es'}</b>{d.specialBoxes ? <b> · {d.specialBoxes} SPECIAL</b> : <span className="xs"> · no special boxes</span>} · ready by {d.readyBy}</span>
      {d.hold && toCollect && <div className="banner-warn" role="status"><span><b>On hold.</b> Don’t collect this order until Morning Box clears it.</span></div>}

      {/* Pickup at each bakery: count boxes and special boxes; they must match (OPS §6–7). */}
      {d.pickups.map(p => {
        const c = count[p.bakeryId] || { boxes: '', special: '' };
        const set = (k, v) => setCount(x => ({ ...x, [p.bakeryId]: { ...c, [k]: v.replace(/\D/g, '').slice(0, 3) } }));
        const canPick = toCollect && !p.pickedUp && (p.state === 'Ready' || p.state === 'Handed Over') && !d.hold;
        return (
          <div key={p.bakeryId} className="stack gap-6" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
            <span><span className="xs">PICK UP</span><br /><b>{p.bakery}</b>{p.pickupPoint ? ` · ${p.pickupPoint}` : ''}</span>
            <span className="xs">Ready by {p.readyBy} · {p.boxes} box{p.boxes === 1 ? '' : 'es'}{p.specialBoxes ? ` (${p.specialBoxes} special)` : ''} · {p.pickedUp ? 'picked up ✓' : p.state === 'Handed Over' ? 'handed over by the bakery' : p.state || 'not started'}</span>
            {canPick && <>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" style={{ flex: 1, minHeight: 52 }} inputMode="numeric" placeholder="Boxes" aria-label={`Boxes counted at ${p.bakery}`} value={c.boxes} onChange={e => set('boxes', e.target.value)} />
                <input className="input" style={{ flex: 1, minHeight: 52 }} inputMode="numeric" placeholder="Special" aria-label={`Special boxes counted at ${p.bakery}`} value={c.special} onChange={e => set('special', e.target.value)} />
              </div>
              <button type="button" className="btn" style={big} disabled={busy || c.boxes === '' || c.special === ''} onClick={() => act(`${path}/pickup`, { bakeryId: p.bakeryId, boxes: Number(c.boxes), specialBoxes: Number(c.special) })}>Confirm pickup</button>
              <span className="xs">Count the boxes and the boxes marked special. Don’t open them. If the count doesn’t match, don’t leave — Morning Box will sort it out.</span>
            </>}
          </div>
        );
      })}

      <div className="stack gap-6" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
        <span className="xs">DROP OFF</span>
        <span>{d.dropOff.company ? <><b>{d.dropOff.company}</b><br /></> : null}<b>{d.dropOff.building}</b>{d.dropOff.place ? `, ${d.dropOff.place}` : ''}</span>
        <span className="xs">Handover: <b>{d.handover}</b></span>
        {d.contact && <span className="xs">Contact: <b>{d.contact.name}</b>{d.contact.mobile ? <> · <a href={`tel:${d.contact.mobile}`}>{d.contact.mobile}</a></> : null}</span>}
        {d.dropOff.notes && <span className="xs">Note: {d.dropOff.notes}</span>}
      </div>

      {d.attempts.length > 0 && <span className="xs">Attempts: {d.attempts.map(a => `${a.reason} (${at(a.at)})`).join('; ')}</span>}
      {['Picked Up', 'Failed'].includes(d.deliveryState) && !done && (
        <button type="button" className="btn" style={big} disabled={busy} onClick={() => act(`${path}/out`)}>{d.deliveryState === 'Failed' ? 'Re-attempt delivery' : 'Out for delivery'}</button>
      )}
      {d.deliveryState === 'Out for Delivery' && !done && (
        <div className="stack gap-8">
          <span className="strong">Handed over to:</span>
          <div className="stack gap-8">
            {points.map(p => (
              <button key={p.point} type="button" className="btn-secondary" aria-pressed={point === p.point} style={{ ...big, justifyContent: 'space-between', ...(point === p.point ? { borderColor: 'var(--espresso)', borderWidth: 2.5 } : {}) }} onClick={() => setPoint(p.point)}>
                <span>{p.label}{p.point === 'your door' && d.handover === 'Door' ? ' (asked)' : ''}</span><small>{p.recipientType}</small>
              </button>
            ))}
          </div>
          <button type="button" className="btn" style={big} disabled={busy || !point} onClick={() => act(`${path}/delivered`, { deliveryPoint: point })}>{point ? `Delivered — ${points.find(p => p.point === point)?.label}` : 'Choose where you handed it over'}</button>
          {!fail.open ? <button type="button" className="btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => setFail(x => ({ ...x, open: true }))}>Couldn’t deliver?</button> : (
            <div className="stack gap-8">
              <select className="input" style={{ minHeight: 52 }} aria-label="Why delivery failed" value={fail.reason} onChange={e => setFail(x => ({ ...x, reason: e.target.value }))}>
                <option value="">Why couldn’t you deliver?</option>{(me?.failureReasons || []).map(r => <option key={r}>{r}</option>)}</select>
              <input className="input" style={{ minHeight: 52 }} placeholder="What happened (optional)" aria-label="Note" value={fail.note} onChange={e => setFail(x => ({ ...x, note: e.target.value }))} />
              <button type="button" className="btn-secondary" style={big} disabled={busy || !fail.reason} onClick={() => act(`${path}/failed`, { reason: fail.reason, note: fail.note.trim() }).then(ok => ok && setFail({ open: false, reason: '', note: '' }))}>Record failed delivery</button>
              <span className="xs">Morning Box will contact the customer. Don’t leave the boxes unattended.</span>
            </div>
          )}
        </div>
      )}
      {done && d.delivered && <div className="banner-ok" role="status"><Icon name="check" size={18} stroke={2} /><span>Delivered to {points.find(p => p.point === d.delivered.point)?.label || d.delivered.point} · {d.delivered.recipientType} · {at(d.delivered.at)}{d.delivered.late ? ' · after the window' : ''}</span></div>}
    </article>
  );
}
