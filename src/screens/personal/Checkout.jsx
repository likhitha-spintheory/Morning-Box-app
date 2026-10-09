import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, applySession, setToken } from '../../api.js';
import { Screen, TopBar, Footer, Icon, Chip, Switch, Logo, PhoneField, Go, IconButton } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import {
  DELIVERY_WINDOWS, dateInfo, dayPrice, boxName, sizeLabel, windowLabel, canChooseSize, componentName, shortPlace
} from '../../domain/app.js';

const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
const ErrorBanner = ({ children }) => children
  ? <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{children}</div> : null;
const prettyMobile = d => `+971 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
const extrasShort = addons => addons.map(a => `+${a.qty} ${componentName(a.item)}${a.unit ? ` (${a.unit} loaf)` : a.qty > 1 ? 's' : ''}`).join(' · ');

/* ---------- Create account / sign in (style-1 P14 + P15) ---------- */
export function SignIn() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/today';
  const [name, setName] = useState(state.user?.firstName || '');
  const [mobile, setMobile] = useState(state.user?.mobile?.replace(/^\+971\s?/, '') || '');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');
  const [wait, setWait] = useState(0);
  const [existing, setExisting] = useState(false);
  const refs = useRef([]);
  const digits = mobile.replace(/\D/g, '').replace(/^(00)?971/, '').replace(/^0/, '');
  const mobileOk = /^5\d{8}$/.test(digits);
  const nameOk = name.trim().length > 0;
  const planned = state.plan.dates.filter(d => state.plan.days[d]?.saved);
  const total = planned.reduce((t, d) => t + dayPrice(state.plan.days[d].cfg, state.profile).total, 0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const typeDigit = (i, v) => {
    const d = v.replace(/\D/g, '');
    if (d.length > 1) { // pasted or auto-filled code
      const all = d.slice(0, 6).split('');
      setCode(c => c.map((_, k) => all[k] || ''));
      refs.current[Math.min(all.length, 5)]?.focus();
      return;
    }
    setCode(c => { const n = c.slice(); n[i] = d; return n; });
    if (d && i < 5) refs.current[i + 1]?.focus();
  };
  const send = async () => {
    setTouched(true); setError('');
    if (!mobileOk) return;
    setBusy(true);
    try {
      const r = await post('/auth/otp', { mobile: digits });
      setDevCode(r.devCode || ''); setExisting(!!r.existingUser); setSent(true); setWait(30); setCode(['', '', '', '', '', '']);
      setTimeout(() => refs.current[0]?.focus(), 50);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const needName = !existing;
  const verify = async () => {
    if (needName && !nameOk) { setTouched(true); setError('Enter your first name to create your account.'); return; }
    setBusy(true); setError('');
    try {
      const r = await post('/auth/verify', { mobile: digits, code: code.join(''), firstName: needName ? name.trim() : undefined });
      setToken(r.token);
      /* MB-FLW-001 §6–7: the plan built before sign-in must never be rebuilt. It was made
         with the profile on this device, so that profile becomes the saved one. */
      const keepLocal = state.profileDone && (planned.length > 0 || !r.profile);
      if (keepLocal && JSON.stringify(r.profile) !== JSON.stringify(state.profile)) {
        await put('/me/profile', state.profile).catch(() => {});
        r.profile = state.profile;
      }
      set(s => applySession(s, r));
      const orders = await get('/orders').catch(() => null);
      if (orders) set(s => { s.orders = orders; });
      nav(next, { replace: true });
    } catch (e) {
      setError(e.message); setBusy(false);
      if (e.code === 'otp_wrong') { setCode(['', '', '', '', '', '']); refs.current[0]?.focus(); }
    }
  };

  if (sent) {
    return (
      <Screen>
        <header className="topbar"><IconButton icon="back" label="Back" onClick={() => { setSent(false); setError(''); }} /><span style={{ flex: 1 }} /></header>
        <main className="screen-main" style={{ paddingTop: 20, gap: 22 }}>
          <div className="stack gap-8">
            <span className="eyebrow">Verify</span>
            <h1 className="h-display" style={{ fontSize: 38 }}>Enter the code</h1>
            <p className="help" style={{ fontSize: 17 }}>Sent to {prettyMobile(digits)} · <button type="button" className="link" style={{ padding: 0, fontWeight: 400, color: 'var(--text-3)' }} onClick={() => setSent(false)}>Change</button></p>
          </div>
          <div className="otp" role="group" aria-label="6-digit code">
            {code.map((c, i) => (
              <input key={i} ref={el => (refs.current[i] = el)} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={i === 0 ? 6 : 1}
                aria-label={`Digit ${i + 1}`} value={c} onChange={e => typeDigit(i, e.target.value)}
                onKeyDown={e => { if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus(); }} />
            ))}
          </div>
          <div className="row">
            <span className="help" style={{ fontSize: 16 }}>Didn’t get it?</span>
            {wait > 0
              ? <span className="strong" style={{ fontSize: 16 }}>Resend in 0:{String(wait).padStart(2, '0')}</span>
              : <button type="button" className="link" onClick={send} disabled={busy}>Resend code</button>}
          </div>
          <div className="note" style={{ alignItems: 'center' }}><Icon name="phone" size={22} stroke={1.6} style={{ flex: 'none' }} />Code auto-fills from SMS on supported phones.</div>
          {needName && (
            <div className="field">
              <label htmlFor="fn2">Your first name</label>
              <input id="fn2" className={`input${touched && !nameOk ? ' invalid' : ''}`} value={name} autoComplete="given-name" onChange={e => setName(e.target.value)} />
              <span className="help" style={{ fontSize: 15 }}>New to Morning Box — this is all we need to create your account.</span>
            </div>
          )}
          {existing && <span className="hint" style={{ fontSize: 15 }}><Icon name="check" size={18} stroke={1.8} />Welcome back — your saved profile and orders are kept.</span>}
          {devCode && <span className="demo-note">Development build — your code is <b>{devCode}</b>. In production it arrives by SMS.</span>}
          <ErrorBanner>{error}</ErrorBanner>
        </main>
        <Footer><button className="btn" disabled={busy || code.join('').length < 6} onClick={verify}>{busy ? 'Checking…' : 'Verify & continue'}</button></Footer>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar back={-1} close={null}><span style={{ flex: 1 }} /></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 20 }}>
        <Logo width={150} />
        <div className="stack gap-10">
          <h1 className="h-display" style={{ fontSize: 40 }}>{planned.length ? 'Almost there.' : 'Welcome back.'}</h1>
          <p className="help" style={{ fontSize: 17 }}>
            {planned.length
              ? `Create your account so we can deliver your ${planned.length === 1 ? 'morning' : `${planned.length} mornings`}. Your plan stays exactly as you built it.`
              : 'Sign in with your mobile number to see your mornings and orders.'}
          </p>
        </div>
        <div className="field">
          <label htmlFor="fn">First name <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(new customers)</span></label>
          <input id="fn" className="input" value={name} autoComplete="given-name" onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mb">Mobile number</label>
          <PhoneField id="mb" value={mobile} onChange={setMobile} invalid={touched && !mobileOk} describedBy="mb-h" />
          {touched && !mobileOk
            ? <span id="mb-h" className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Enter a UAE mobile number, e.g. 50 123 4567</span>
            : <span id="mb-h" className="help" style={{ fontSize: 15.5 }}>We’ll send a 6-digit code by SMS. No password needed.</span>}
        </div>
        {planned.length > 0 && (
          <div className="panel row" style={{ flexDirection: 'row', padding: '16px 20px', borderRadius: 999 }}>
            <span style={{ fontSize: 16 }}><b>Your plan:</b> {planned.length} morning{planned.length > 1 ? 's' : ''} · AED {total}</span>
            <Icon name="check" size={20} stroke={1.8} />
          </div>
        )}
        <ErrorBanner>{error}</ErrorBanner>
      </main>
      <Footer>
        <button className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send code'}</button>
        <p className="help center" style={{ margin: 0, fontSize: 15 }}>By continuing you agree to the Terms &amp; Privacy Policy.</p>
      </Footer>
    </Screen>
  );
}

/* ---------- Where & when? (style-1 P16) ---------- */
const WINDOW_ICON = { w1: 'sunrise', w2: 'sunny', w3: 'sunny' };
export function Delivery() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const [touched, setTouched] = useState(false);
  const plan = state.plan;
  const dates = plan.dates.filter(d => plan.days[d]?.saved);
  const [editing, setEditing] = useState(() => !state.delivery.address.building);
  /* MB-DLV-001 §8: a window closes when production or delivery capacity is exhausted. */
  const [avail, setAvail] = useState({});
  const key = dates.join(',');
  useEffect(() => { if (key) get(`/availability?dates=${key}`).then(setAvail).catch(() => {}); }, [key]);
  if (!state.session) return <Navigate to="/sign-in?next=/checkout/delivery" replace />;
  if (!dates.length) return <Navigate to="/plan/dates" replace />;

  const isFull = (iso, w) => (avail[iso]?.[w] ? !avail[iso][w].available : false);
  const addrFor = iso => (dl.sameForAll || dates.length === 1 ? dl.address : (dl.perDay[iso]?.address || dl.address));
  const setDayAddr = (iso, k, v) => upd(d => { const cur = d.perDay[iso]?.address || structuredClone(d.address); d.perDay[iso] = { ...(d.perDay[iso] || {}), address: { ...cur, [k]: v } }; });
  const remaining = (iso, w) => avail[iso]?.[w]?.remaining;
  const dl = state.delivery;
  const a = dl.address;
  const upd = fn => set(s => fn(s.delivery));
  const sameForAll = dl.sameForAll || dates.length === 1;
  const windowFor = iso => (sameForAll ? dl.window : dl.perDay[iso]?.window);
  const addrOk = (sameForAll ? [a] : dates.map(addrFor)).every(x => x.building.trim() && x.unit.trim());
  const windowsOk = dates.every(iso => windowFor(iso) && !isFull(iso, windowFor(iso)));

  const WindowCards = ({ iso }) => (
    <div className="stack gap-12" role="radiogroup" aria-label={`Delivery window${iso ? ` for ${dateInfo(iso).label}` : ''}`}>
      {DELIVERY_WINDOWS.map(w => {
        const fullOn = iso ? (isFull(iso, w.id) ? iso : null) : dates.find(d => isFull(d, w.id));
        const on = iso ? dl.perDay[iso]?.window === w.id : dl.window === w.id;
        const left = Math.min(...(iso ? [iso] : dates).map(d => remaining(d, w.id) ?? 999));
        const sub = fullOn ? `Full for ${dateInfo(fullOn).wd}, ${dateInfo(fullOn).day} ${dateInfo(fullOn).mon}` : left <= 10 ? 'Filling fast · few slots left' : 'Available';
        return (
          <button key={w.id} type="button" className={`win${on ? ' on' : ''}`} role="radio" aria-checked={on} disabled={!!fullOn}
            onClick={() => upd(d => { if (iso) d.perDay[iso] = { ...(d.perDay[iso] || {}), window: w.id }; else d.window = w.id; })}>
            <span className="ico" style={on ? { background: 'var(--gold-soft)' } : undefined}><Icon name={WINDOW_ICON[w.id]} size={24} stroke={1.6} /></span>
            <span className="stack" style={{ flex: 1 }}><span style={{ fontSize: 19, fontWeight: 600 }}>{w.label.replace('–', '–')}</span><span className="help" style={{ fontSize: 15.5 }}>{sub}</span></span>
            {fullOn ? <span className="tag" style={{ marginLeft: 'auto' }}>Full</span> : <span className="dot">{on && <Icon name="check" size={15} stroke={2.2} />}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Delivery</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 20 }}>
        <div className="stack gap-8">
          <h1 className="h-display" style={{ fontSize: 40 }}>Where &amp; when?</h1>
          <p className="help">Set it once. Change it only when your morning changes.</p>
        </div>
        {dates.length > 1 && (
          <div className="panel row" style={{ flexDirection: 'row', padding: '18px 20px' }}>
            <span className="stack"><span className="strong" style={{ fontSize: 17 }}>Same delivery for all {dates.length} mornings?</span>
              <span className="help" style={{ fontSize: 15 }}>{dates.map(d => `${dateInfo(d).wd} ${dateInfo(d).day}`).join(' · ')} {dateInfo(dates[dates.length - 1]).mon}</span></span>
            <Switch checked={dl.sameForAll} label="Use the same delivery for all mornings" onChange={v => upd(d => { d.sameForAll = v; })} />
          </div>
        )}

        {!sameForAll ? null : !editing && addrOk ? (
          <div className="card row" style={{ padding: '20px 22px', gap: 16 }}>
            <Icon name="pin" size={24} stroke={1.6} />
            <span className="stack" style={{ flex: 1 }}><span className="strong" style={{ fontSize: 18 }}>{a.building}</span>
              <span className="help" style={{ fontSize: 16 }}>{a.unit} · {a.area} · {a.handover === 'door' ? 'Hand to me at the door' : 'Hand to reception'}</span></span>
            <button type="button" className="link" onClick={() => setEditing(true)}>Change</button>
          </div>
        ) : (
          <section className="card stack gap-14" style={{ padding: 20, gap: 14 }}>
            <div className="field"><label htmlFor="b">Building / Tower</label>
              <input id="b" className={`input${touched && !a.building.trim() ? ' invalid' : ''}`} placeholder="e.g. Gate Village, Building 3" value={a.building} onChange={e => upd(d => { d.address.building = e.target.value; })} /></div>
            <div className="grid-2">
              <div className="field"><label htmlFor="u">Office / Floor</label>
                <input id="u" className={`input${touched && !a.unit.trim() ? ' invalid' : ''}`} placeholder="Office 402" value={a.unit} onChange={e => upd(d => { d.address.unit = e.target.value; })} /></div>
              <div className="field"><label htmlFor="ar">Area</label><input id="ar" className="input" value={a.area} readOnly /></div>
            </div>
            <div className="stack gap-8">
              <span className="label">Hand over at</span>
              <div className="chips">
                <Chip on={a.handover === 'reception'} onClick={() => upd(d => { d.address.handover = 'reception'; })}>Reception</Chip>
                <Chip on={a.handover === 'door'} onClick={() => upd(d => { d.address.handover = 'door'; })}>My door</Chip>
              </div>
            </div>
            <div className="field"><label htmlFor="n">Delivery notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
              <input id="n" className="input" placeholder="e.g. Leave with the concierge" value={a.notes} onChange={e => upd(d => { d.address.notes = e.target.value; })} /></div>
            {touched && !addrOk && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Add your building and office or floor</span>}
            {addrOk && <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Use this address</button>}
          </section>
        )}

        {!sameForAll && dates.map(iso => {
          const x = addrFor(iso);
          return (
            <section key={`a${iso}`} className="card stack gap-12" style={{ padding: 18 }} aria-label={`Address for ${dateInfo(iso).long}`}>
              <span className="strong">{dateInfo(iso).long}</span>
              <div className="field"><label htmlFor={`b-${iso}`}>Building / Tower</label>
                <input id={`b-${iso}`} className={`input${touched && !x.building.trim() ? ' invalid' : ''}`} value={x.building} onChange={e => setDayAddr(iso, 'building', e.target.value)} /></div>
              <div className="field"><label htmlFor={`u-${iso}`}>Office / Floor</label>
                <input id={`u-${iso}`} className={`input${touched && !x.unit.trim() ? ' invalid' : ''}`} value={x.unit} onChange={e => setDayAddr(iso, 'unit', e.target.value)} /></div>
              <div className="chips">
                <Chip on={x.handover === 'reception'} onClick={() => setDayAddr(iso, 'handover', 'reception')}>Reception</Chip>
                <Chip on={x.handover === 'door'} onClick={() => setDayAddr(iso, 'handover', 'door')}>My door</Chip>
              </div>
            </section>
          );
        })}
        <div className="row" style={{ marginTop: 4 }}><h2 className="h3" style={{ fontSize: 20 }}>Delivery window</h2><span className="live"><i />Live availability</span></div>
        {sameForAll
          ? <WindowCards />
          : dates.map(iso => (<section key={iso} className="stack gap-10"><span className="strong">{dateInfo(iso).long}</span><WindowCards iso={iso} /></section>))}

        {touched && !windowsOk && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Choose an available delivery window{sameForAll ? '' : ' for each morning'}</span>}
        <p className="help" style={{ fontSize: 15.5, margin: 0 }}>We promise a window, not an exact minute — you can follow every step in your order.</p>
      </main>
      <Footer><button className="btn" onClick={() => { setTouched(true); if (addrOk && windowsOk) nav('/checkout/review'); else if (!addrOk) setEditing(true); }}><Go>Review my order</Go></button></Footer>
    </Screen>
  );
}

/* ---------- Review your mornings (style-1 P17) ---------- */
export function ReviewPay() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const [method, setMethod] = useState('apple');
  const [email, setEmail] = useState(state.user?.email || '');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const plan = state.plan;
  const dates = plan.dates.filter(d => plan.days[d]?.saved);
  if (!state.session) return <Navigate to="/sign-in?next=/checkout/review" replace />;
  if (!dates.length) return <Navigate to="/plan/dates" replace />;
  const dl = state.delivery;
  const win = iso => (dl.sameForAll || dates.length === 1 ? dl.window : dl.perDay[iso]?.window);
  const addrOf = iso => (dl.sameForAll || dates.length === 1 ? dl.address : (dl.perDay[iso]?.address || dl.address));
  const prices = dates.map(d => dayPrice(plan.days[d].cfg, state.profile));
  const total = prices.reduce((t, p) => t + p.total, 0);

  /* The server re-validates every morning and re-prices the order before payment. */
  const pay = async () => {
    setPaying(true); setError('');
    try {
      const order = await post('/orders', {
        method: method === 'apple' ? 'apple' : 'card', email: email.trim(), address: dl.address,
        days: dates.map(iso => {
          const c = plan.days[iso].cfg;
          return { date: iso, context: c.context, recipeId: c.recipeId, components: c.components, size: c.size, addons: c.addons, window: win(iso), address: addrOf(iso) };
        })
      });
      set(s => {
        s.orders = [order, ...s.orders.filter(o => o.id !== order.id)];
        if (email.trim()) s.user.email = email.trim();
        s.plan = { dates: [], days: {} };
      });
      nav(`/orders/${order.id}/confirmed`, { replace: true });
    } catch (e) {
      setError(e.message); setPaying(false);
    }
  };

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Review &amp; pay</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 18 }}>
        <h1 className="h-display" style={{ fontSize: 38 }}>Review your mornings</h1>
        <section className="card list" style={{ padding: '4px 20px' }}>
          {dates.map((iso, k) => {
            const c = plan.days[iso].cfg;
            const d = dateInfo(iso);
            const meta = [c.addons.length ? extrasShort(c.addons) : null, windowLabel(win(iso)).replace(' AM', '').replace(' – ', '–'), shortPlace(addrOf(iso).building)].filter(Boolean).join(' · ');
            return (
              <div key={iso} className="row" style={{ alignItems: 'flex-start', gap: 16, padding: '18px 0', borderTop: k ? '1px solid var(--line-soft)' : 0 }}>
                <span className="stack" style={{ alignItems: 'center', width: 46, flex: 'none' }}>
                  <span className="eyebrow grey" style={{ letterSpacing: '.08em', fontWeight: 500 }}>{d.wd}</span>
                  <span className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>{d.day}</span>
                  <span className="xs">{d.mon}</span>
                </span>
                <span className="stack" style={{ flex: 1, gap: 2 }}>
                  <Link to={`/plan/day/${iso}/box`} className="strong" style={{ fontSize: 17, textDecoration: 'none' }}>{boxName(c)} · {canChooseSize(c) ? sizeLabel(c.size) : 'Standard'}</Link>
                  <span className="help" style={{ fontSize: 15 }}>{meta}</span>
                </span>
                <span className="money" style={{ fontSize: 17 }}>AED {prices[k].total}</span>
              </div>
            );
          })}
        </section>
        <section className="card stack gap-12" style={{ padding: 20 }}>
          <div className="sr"><span className="help">Breakfasts &amp; extras</span><span>AED {total}</span></div>
          <div className="sr"><span className="help">Delivery ({dates.length} morning{dates.length > 1 ? 's' : ''})</span><span>Included</span></div>
          <hr className="divider" />
          <div className="sr" style={{ fontSize: 22, fontWeight: 700 }}><span>Total</span><span>AED {total}</span></div>
        </section>
        <div className="field"><label htmlFor="em">Email for confirmation <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <input id="em" className="input" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="grid-2" role="radiogroup" aria-label="Payment method">
          {[['apple', 'apple', 'Apple Pay'], ['card', 'card', 'Card']].map(([id, icon, label]) => (
            <button key={id} type="button" className={`win${method === id ? ' on' : ''}`} role="radio" aria-checked={method === id} onClick={() => setMethod(id)} style={{ padding: '0 14px', minHeight: 60, gap: 10 }}>
              <Icon name={icon} size={22} stroke={1.6} /><span style={{ fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
              {method === id && <span className="dot"><Icon name="check" size={15} stroke={2.2} /></span>}
            </button>
          ))}
        </div>
        <p className="help" style={{ fontSize: 15.5, margin: 0 }}>Free cancellation for any morning until 9:00 PM the night before.</p>
        {SHOW_DEMO && <span className="demo-note">Development build: no card is charged. The payment gateway connects at the integration point in server/personal.js.</span>}
        <ErrorBanner>{error}</ErrorBanner>
      </main>
      <Footer sheet>
        <button className="btn" onClick={pay} disabled={paying}><Icon name="lock" size={20} stroke={1.8} />{paying ? 'Processing…' : `Pay AED ${total}`}</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Your mornings are set (style-1 P18) ---------- */
function SunCheck() {
  const rays = [-60, -30, 0, 30, 60].map(d => {
    const a = (d - 90) * Math.PI / 180;
    return <line key={d} x1={210 + 92 * Math.cos(a)} y1={170 + 92 * Math.sin(a)} x2={210 + 116 * Math.cos(a)} y2={170 + 116 * Math.sin(a)} stroke="#D99A12" strokeWidth="5" strokeLinecap="round" />;
  });
  return (
    <svg viewBox="0 0 420 180" width="100%" style={{ maxWidth: 330, display: 'block', margin: '0 auto' }} aria-hidden="true">
      <path d="M40 170 A170 120 0 0 1 380 170" fill="none" stroke="#E6D3AE" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round" />
      <line x1="20" y1="172" x2="400" y2="172" stroke="#EADCC1" strokeWidth="2" />
      {rays}
      <path d="M135 172 A75 75 0 0 1 285 172 Z" fill="#D99A12" />
      <path d="M185 140 l20 20 l38 -38" fill="none" stroke="#3B2D22" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Confirmed() {
  const { id } = useParams();
  const { state, set } = useStore();
  const order = state.orders.find(o => o.id === id);
  if (!order) return <Navigate to="/orders" replace />;
  const first = order.days[0];
  const ds = order.days.map(d => dateInfo(d.date));
  const list = ds.length === 1 ? ds[0].long.replace(',', '') : `${ds.slice(0, -1).map(d => `${d.wd} ${d.day}`).join(', ')} & ${ds[ds.length - 1].wd} ${ds[ds.length - 1].day} ${dateInfo(ds[ds.length - 1].iso).long.split(' ').pop()}`;
  return (
    <Screen>
      <main className="screen-main" style={{ paddingTop: 48, gap: 22 }}>
        <SunCheck />
        <div className="stack center" style={{ alignItems: 'center', gap: 10, marginTop: -6 }}>
          <span className="eyebrow" style={{ letterSpacing: '.24em' }}>Order {order.id}</span>
          <h1 className="h-display" style={{ fontSize: 38 }}>Your mornings are set, {state.user?.firstName}.</h1>
          <p className="help" style={{ fontSize: 17 }}>{order.days.length} breakfast{order.days.length > 1 ? 's' : ''} · {list}</p>
        </div>
        <section className="card stack gap-14" style={{ padding: 20, gap: 14 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="stack" style={{ gap: 2 }}>
              <span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>First delivery</span>
              <span className="strong" style={{ fontSize: 18 }}>{ds[0].wd}, {ds[0].day} {ds[0].mon} · {windowLabel(first.window).replace(' – ', '–')}</span>
              <span className="help" style={{ fontSize: 16 }}>{shortPlace(first.address.building)} · {first.address.handover === 'door' ? 'Door' : 'Reception'}</span>
            </span>
            <span className="status ok">Confirmed</span>
          </div>
          <hr className="divider" />
          <span className="row" style={{ justifyContent: 'flex-start', gap: 12, fontSize: 16 }}><Icon name="bread" size={22} stroke={1.6} style={{ flex: 'none' }} />Bakery assigned at the 9:00 PM cutoff — you’ll see who’s baking it.</span>
        </section>
        <section className="panel row" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Icon name="coffee" size={24} stroke={1.6} style={{ flex: 'none' }} />
          <span className="stack" style={{ flex: 1 }}><span className="strong" style={{ fontSize: 17 }}>A little reminder</span>
            <span className="help" style={{ fontSize: 15.5 }}>Coffee or fresh juice? We’ll nudge you the night before to have your drink ready.</span></span>
          <Switch checked={state.settings.coffeeReminder} label="Drink reminder" onChange={v => set(s => { s.settings.coffeeReminder = v; })} />
        </section>
      </main>
      <Footer>
        <Link to={`/orders/${order.id}/${first.date}`} className="btn">Track my morning</Link>
        <Link to="/today" className="btn-text" style={{ alignSelf: 'center' }}>Back to home</Link>
      </Footer>
    </Screen>
  );
}
