import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, applySession, setToken, resetPersonal, newIdempotencyKey, download, track } from '../../api.js';
import { Screen, TopBar, Footer, Icon, Chip, Switch, Option, Logo, PhoneField, Go, IconButton, InfoTip, AreaField } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import {
  DELIVERY_WINDOWS, dateInfo, dayPrice, boxName, sizeLabel, windowLabel, canChooseSize, componentName, shortPlace,
  recommendDay, unsafeComponents
} from '../../domain/app.js';
import { useOrder, Loading, usePruneExpired } from '../../state/orders.jsx';
import { PRICING, areaFor } from '../../domain/standards.js';

const emailValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
const union = (a = [], b = []) => [...new Set([...a, ...b])];
/** Terms and Privacy open in the app; a hosted version (VITE_TERMS_URL / VITE_PRIVACY_URL) can replace them. */
const TERMS_URL = import.meta.env.VITE_TERMS_URL || '';
const PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL || '';
export function Agreement({ className = 'help center', style }) {
  const a = (url, to, label) => (url ? <a href={url} target="_blank" rel="noopener noreferrer">{label}</a> : <Link to={to} className="link-hit" style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}>{label}</Link>);
  return <p className={className} style={{ margin: 0, fontSize: 15, ...style }}>By continuing you agree to the {a(TERMS_URL, '/legal/terms', 'Terms')} &amp; {a(PRIVACY_URL, '/legal/privacy', 'Privacy Policy')}.</p>;
}
/** Fill all six code boxes from a pasted or auto-filled code. */
export const pastedCode = e => { const t = (e.clipboardData?.getData('text') || '').replace(/\D/g, ''); return t.length > 1 ? t.slice(0, 6) : ''; };

const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
const ErrorBanner = ({ children }) => children
  ? <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{children}</div> : null;
const prettyMobile = d => `+971 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
const extrasShort = addons => addons.map(a => `+${a.qty} ${componentName(a.item)}${a.unit ? ` (${a.unit} loaf)` : a.qty > 1 ? 's' : ''}${a.flavour ? ` (${a.flavour})` : ''}`).join(' · ');

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
  const [needName, setNeedName] = useState(false);
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
      setDevCode(r.devCode || ''); setSent(true); setWait(30); setCode(['', '', '', '', '', '']);
      setTimeout(() => refs.current[0]?.focus(), 50);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const verify = async () => {
    if (needName && !nameOk) { setTouched(true); setError('Enter your first name to create your account.'); return; }
    setBusy(true); setError('');
    try {
      const r = await post('/auth/verify', { mobile: digits, code: code.join(''), firstName: nameOk ? name.trim() : undefined });
      setToken(null);
      const switching = !!state.owner && state.owner !== r.user.mobile;
      /* MB-FLW-001 §6–7: the plan built before sign-in is kept, with the profile it was
         built with. Safety never weakens: allergies and dietary needs already saved on the
         account are added to it, and any planned morning that no longer fits is re-checked. */
      const keepLocal = state.profileDone && (planned.length > 0 || !r.profile);
      let merged = null;
      const changedDays = [];
      if (keepLocal) {
        const sp = r.profile;
        merged = sp ? {
          ...state.profile, dietary: union(state.profile.dietary, sp.dietary), allergies: union(state.profile.allergies, sp.allergies),
          otherAllergies: [...new Set([state.profile.otherAllergies, sp.otherAllergies].map(x => (x || '').trim()).filter(Boolean))].join(', ').slice(0, 120)
        } : state.profile;
        if (JSON.stringify(sp) !== JSON.stringify(merged)) await put('/me/profile', merged).catch(() => {});
        r.profile = merged;
        planned.forEach(iso => { if (unsafeComponents(state.plan.days[iso].cfg, merged).length) changedDays.push(iso); });
      }
      set(s => {
        if (switching && !keepLocal) resetPersonal(s);
        if (switching && keepLocal) { s.orders = []; s.businessOrders = []; s.businessUser = null; }
        if (merged) {
          s.profile = merged; s.profileDone = true;
          changedDays.forEach(iso => {
            const d = s.plan.days[iso];
            const options = recommendDay(merged, d.context);
            s.plan.days[iso] = { ...d, options, which: 'primary', cfg: options.none ? null : options.primary, saved: false, changed: true };
          });
        }
        applySession(s, r);
      });
      const orders = await get('/orders').catch(() => null);
      if (orders) set(s => { s.orders = orders; });
      nav(changedDays.length ? '/plan/summary' : next, { replace: true });
    } catch (e) {
      setBusy(false);
      if (e.code === 'name_required') { setNeedName(true); setTouched(true); setError('Enter your first name to create your account.'); return; }
      setError(e.message);
      if (e.code === 'otp_wrong') { setCode(['', '', '', '', '', '']); refs.current[0]?.focus(); }
    }
  };
  const onPaste = e => { const t = pastedCode(e); if (t) { e.preventDefault(); typeDigit(0, t); } };

  if (sent) {
    return (
      <Screen>
        <header className="topbar"><IconButton icon="back" label="Back" onClick={() => { setSent(false); setError(''); }} /><span style={{ flex: 1 }} /></header>
        <main className="screen-main" style={{ paddingTop: 20, gap: 24 }}>
          <div className="stack gap-8">
            <span className="eyebrow">Verify</span>
            <h1 className="h-display" style={{ fontSize: 34 }}>Enter the code</h1>
            <p className="help" style={{ fontSize: 17 }}>Sent to {prettyMobile(digits)} · <button type="button" className="link" style={{ padding: 0, fontWeight: 400, color: 'var(--text-3)' }} onClick={() => setSent(false)}>Change</button></p>
          </div>
          <div className="otp" role="group" aria-label="6-digit code">
            {code.map((c, i) => (
              <input key={i} ref={el => (refs.current[i] = el)} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={i === 0 ? 6 : 1}
                aria-label={`Digit ${i + 1}`} value={c} onChange={e => typeDigit(i, e.target.value)} onPaste={onPaste}
                onKeyDown={e => { if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus(); }} />
            ))}
          </div>
          <div className="row">
            <span className="help" style={{ fontSize: 16 }}>Didn’t get it?</span>
            {wait > 0
              ? <span className="strong" style={{ fontSize: 16 }}>Resend in 0:{String(wait).padStart(2, '0')}</span>
              : <button type="button" className="link" onClick={send} disabled={busy}>Resend code</button>}
          </div>
          {needName && (
            <div className="field">
              <label htmlFor="fn2">Your first name</label>
              <input id="fn2" className={`input${touched && !nameOk ? ' invalid' : ''}`} value={name} autoComplete="given-name" onChange={e => setName(e.target.value)} />
            </div>
          )}
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
          <h1 className="h-display" style={{ fontSize: 34 }}>{planned.length ? 'Almost there.' : 'Welcome back.'}</h1>
          <p className="help" style={{ fontSize: 17 }}>
            {planned.length
              ? `Sign in to secure your ${planned.length === 1 ? 'morning' : `${planned.length} mornings`}.`
              : 'Sign in to see your mornings.'}
          </p>
        </div>
        <div className="field">
          <label htmlFor="mb">Mobile number</label>
          <PhoneField id="mb" value={mobile} onChange={setMobile} invalid={touched && !mobileOk} describedBy={touched && !mobileOk ? 'mb-h' : undefined} />
          {touched && !mobileOk
            ? <span id="mb-h" className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Enter a UAE mobile number, e.g. 50 123 4567</span>
            : null}
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
        <Agreement />
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
  const expiredNote = usePruneExpired();
  /* MB-DLV-001 §8: a window closes when production or delivery capacity is exhausted. */
  const [avail, setAvail] = useState({});
  const key = dates.join(',');
  useEffect(() => { if (key) get(`/availability?dates=${key}`).then(setAvail).catch(() => {}); }, [key]);
  if (!state.session) return <Navigate to="/sign-in?next=/checkout/delivery" replace />;
  if (!dates.length) return <Navigate to="/plan/dates" replace />;

  const isFull = (iso, w) => (avail[iso]?.[w] ? !avail[iso][w].available : false);
  const dl = state.delivery;
  const a = dl.address;
  const upd = fn => set(s => fn(s.delivery));
  /* FLW §8: for several mornings the customer first answers whether the same delivery details
     apply to all of them. Nothing is preselected; the answer is kept for this set of dates. */
  const multi = dates.length > 1;
  const answered = !multi || (typeof dl.sameForAll === 'boolean' && dl.sameAnswerFor === key);
  const answer = v => upd(d => { d.sameForAll = v; d.sameAnswerFor = key; });
  const sameForAll = !multi || (answered && dl.sameForAll);
  const addrFor = iso => (sameForAll ? dl.address : (dl.perDay[iso]?.address || dl.address));
  const setDayAddr = (iso, k, v) => upd(d => { const cur = d.perDay[iso]?.address || structuredClone(d.address); d.perDay[iso] = { ...(d.perDay[iso] || {}), address: { ...cur, [k]: v } }; });
  const remaining = (iso, w) => avail[iso]?.[w]?.remaining;
  const windowFor = iso => (sameForAll ? dl.window : dl.perDay[iso]?.window);
  const addrOk = (sameForAll ? [a] : dates.map(addrFor)).every(x => x.building.trim() && x.unit.trim() && areaFor(x.area));
  const windowsOk = dates.every(iso => windowFor(iso) && !isFull(iso, windowFor(iso)));

  const WindowCards = ({ iso }) => (
    <div className="stack gap-12" role="radiogroup" aria-label={`Delivery window${iso ? ` for ${dateInfo(iso).label}` : ''}`}>
      {DELIVERY_WINDOWS.map(w => {
        const fullOn = iso ? (isFull(iso, w.id) ? iso : null) : dates.find(d => isFull(d, w.id));
        const on = iso ? dl.perDay[iso]?.window === w.id : dl.window === w.id;
        const left = Math.min(...(iso ? [iso] : dates).map(d => remaining(d, w.id) ?? 999));
        const sub = fullOn ? `Full for ${dateInfo(fullOn).wd}, ${dateInfo(fullOn).day} ${dateInfo(fullOn).mon}` : left <= 10 ? 'Few slots left' : '';
        return (
          <button key={w.id} type="button" className={`win${on ? ' on' : ''}`} role="radio" aria-checked={on} disabled={!!fullOn}
            onClick={() => upd(d => { if (iso) d.perDay[iso] = { ...(d.perDay[iso] || {}), window: w.id }; else d.window = w.id; })}>
            <span className="ico" style={on ? { background: 'var(--gold-soft)' } : undefined}><Icon name={WINDOW_ICON[w.id]} size={24} stroke={1.6} /></span>
            <span className="stack" style={{ flex: 1 }}><span style={{ fontSize: 19, fontWeight: 600 }}>{w.label}</span>{sub && <span className="help" style={{ fontSize: 15.5 }}>{sub}</span>}</span>
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
          <h1 className="h-display" style={{ fontSize: 34 }}>Where &amp; when?</h1>
        </div>
        {expiredNote && <div className="note" role="status"><Icon name="clock" size={20} stroke={1.6} style={{ flex: 'none' }} /><span>{expiredNote}</span></div>}
        {multi && (
          <section className="stack gap-12" aria-labelledby="same-q">
            <h2 id="same-q" className="h3" style={{ fontSize: 20 }}>Same delivery details for all {dates.length} mornings?</h2>
            <div className="stack gap-12" role="radiogroup" aria-labelledby="same-q">
              <Option icon="copy" on={answered && dl.sameForAll === true} title="Yes, the same for all" onClick={() => answer(true)}>One address and delivery window for every morning.</Option>
              <Option icon="cal" on={answered && dl.sameForAll === false} title="No, set each morning" onClick={() => answer(false)}>Choose the address and window for each date.</Option>
            </div>
            {touched && !answered && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Choose Yes or No to continue</span>}
          </section>
        )}

        {!answered ? null : !sameForAll ? null : !editing && addrOk ? (
          <div className="card row" style={{ padding: '20px 24px', gap: 16 }}>
            <Icon name="pin" size={24} stroke={1.6} />
            <span className="stack" style={{ flex: 1 }}><span className="strong" style={{ fontSize: 18 }}>{a.building}</span>
              <span className="help" style={{ fontSize: 16 }}>{a.unit} · {a.handover === 'door' ? 'At my door' : 'At reception'}</span></span>
            <button type="button" className="link" onClick={() => setEditing(true)}>Change</button>
          </div>
        ) : (
          <section className="card stack gap-16" style={{ padding: 20, gap: 16 }}>
            <div className="field"><label htmlFor="b">Building / Tower</label>
              <input id="b" className={`input${touched && !a.building.trim() ? ' invalid' : ''}`} placeholder="e.g. Gate Village, Building 3" value={a.building} onChange={e => upd(d => { d.address.building = e.target.value; })} /></div>
            <div className="grid-2">
              <div className="field"><label htmlFor="u">Office / Floor</label>
                <input id="u" className={`input${touched && !a.unit.trim() ? ' invalid' : ''}`} placeholder="Office 402" value={a.unit} onChange={e => upd(d => { d.address.unit = e.target.value; })} /></div>
              <AreaField id="ar" value={a.area} invalid={touched} onChange={v => upd(d => { d.address.area = v; })} />
            </div>
            <div className="stack gap-8">
              <span className="label">Hand over at</span>
              <div className="chips">
                <Chip on={a.handover === 'reception'} onClick={() => upd(d => { d.address.handover = 'reception'; })}>Reception</Chip>
                <Chip on={a.handover === 'door'} onClick={() => upd(d => { d.address.handover = 'door'; })}>My door</Chip>
              </div>
            </div>
            <div className="field"><label htmlFor="n">Delivery notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
              <input id="n" className="input" placeholder="e.g. Leave with the concierge" maxLength={200} value={a.notes} onChange={e => upd(d => { d.address.notes = e.target.value; })} /></div>
            {touched && !addrOk && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Add your building and office or floor</span>}
            {addrOk && <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Use this address</button>}
          </section>
        )}

        {answered && !sameForAll && dates.map(iso => {
          const x = addrFor(iso);
          return (
            <section key={`a${iso}`} className="card stack gap-12" style={{ padding: 16 }} aria-label={`Address for ${dateInfo(iso).long}`}>
              <span className="strong">{dateInfo(iso).long}</span>
              <div className="field"><label htmlFor={`b-${iso}`}>Building / Tower</label>
                <input id={`b-${iso}`} className={`input${touched && !x.building.trim() ? ' invalid' : ''}`} value={x.building} onChange={e => setDayAddr(iso, 'building', e.target.value)} /></div>
              <div className="grid-2">
                <div className="field"><label htmlFor={`u-${iso}`}>Office / Floor</label>
                  <input id={`u-${iso}`} className={`input${touched && !x.unit.trim() ? ' invalid' : ''}`} value={x.unit} onChange={e => setDayAddr(iso, 'unit', e.target.value)} /></div>
                {/* FLW §8: each date has its own location, within the active service areas. */}
                <AreaField id={`ar-${iso}`} value={x.area} invalid={touched} onChange={v => setDayAddr(iso, 'area', v)} />
              </div>
              <div className="stack gap-8">
                <span className="label">Hand over at</span>
                <div className="chips">
                  <Chip on={x.handover === 'reception'} onClick={() => setDayAddr(iso, 'handover', 'reception')}>Reception</Chip>
                  <Chip on={x.handover === 'door'} onClick={() => setDayAddr(iso, 'handover', 'door')}>My door</Chip>
                </div>
              </div>
              <div className="field"><label htmlFor={`n-${iso}`}>Delivery notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                <input id={`n-${iso}`} className="input" placeholder="e.g. Leave with the concierge" maxLength={200} value={x.notes || ''} onChange={e => setDayAddr(iso, 'notes', e.target.value)} /></div>
            </section>
          );
        })}
        {answered && <>
        <h2 className="h3" style={{ fontSize: 20, marginTop: 4 }}>Delivery window <InfoTip label="About delivery windows">Availability updates live. A window closes when it’s fully booked.</InfoTip></h2>
        {sameForAll
          ? <WindowCards />
          : dates.map(iso => (<section key={iso} className="stack gap-10"><span className="strong">{dateInfo(iso).long}</span><WindowCards iso={iso} /></section>))}

        {touched && !windowsOk && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Choose an available delivery window{sameForAll ? '' : ' for each morning'}</span>}
        </>}
      </main>
      <Footer><button className="btn" onClick={() => { setTouched(true); if (!answered) return; if (addrOk && windowsOk) nav('/checkout/review'); else if (!addrOk) setEditing(true); }}><Go>Review my order</Go></button></Footer>
    </Screen>
  );
}

/* ---------- Review your mornings (style-1 P17) ---------- */
export function ReviewPay() {
  const { state, set } = useStore();
  const nav = useNavigate();
  /* Apple Pay is offered first only where the device supports it. */
  const [method, setMethod] = useState(() => (typeof window !== 'undefined' && window.ApplePaySession ? 'apple' : 'card'));
  const [email, setEmail] = useState(state.user?.email || '');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  /* One key per checkout: a double tap or a retry after a lost response never creates a second order. */
  const [idemKey] = useState(newIdempotencyKey);
  const [serverTotal, setServerTotal] = useState(null);
  /* Morning Box credit from service recovery is used automatically. */
  const [credit, setCredit] = useState(0);
  useEffect(() => { if (state.session) get('/me').then(m => setCredit(m.credit || 0)).catch(() => {}); track('checkout_started'); }, [state.session]); // eslint-disable-line react-hooks/exhaustive-deps
  const expiredNote = usePruneExpired();
  const plan = state.plan;
  const dates = plan.dates.filter(d => plan.days[d]?.saved);
  if (!state.session) return <Navigate to="/sign-in?next=/checkout/review" replace />;
  if (!dates.length) return <Navigate to="/plan/dates" replace />;
  const dl = state.delivery;
  /* The same-delivery question (FLW §8) must be answered for these dates before review. */
  if (dates.length > 1 && (typeof dl.sameForAll !== 'boolean' || dl.sameAnswerFor !== dates.join(','))) return <Navigate to="/checkout/delivery" replace />;
  const win = iso => (dl.sameForAll || dates.length === 1 ? dl.window : dl.perDay[iso]?.window);
  const addrOf = iso => (dl.sameForAll || dates.length === 1 ? dl.address : (dl.perDay[iso]?.address || dl.address));
  const prices = dates.map(d => dayPrice(plan.days[d].cfg, state.profile));
  const total = prices.reduce((t, p) => t + p.total, 0);
  const payTotal = serverTotal ?? total;
  const creditUsed = Math.min(credit, payTotal);
  const oneAddress = dl.sameForAll || dates.length === 1;
  const emailBad = !!email.trim() && !emailValid(email);

  /* The server re-validates every morning and re-prices the order before payment;
     if its total differs from the one shown, nothing is charged and the new total is shown. */
  const pay = async () => {
    setEmailTouched(true);
    if (emailBad) return;
    setPaying(true); setError('');
    try {
      const order = await post('/orders', {
        idempotencyKey: idemKey, expectedTotal: payTotal,
        method: method === 'apple' ? 'apple' : 'card', email: email.trim(), address: addrOf(dates[0]),
        days: dates.map(iso => {
          const c = plan.days[iso].cfg;
          return { date: iso, context: c.context, recipeId: c.recipeId, components: c.components, size: c.size, addons: c.addons, danishFlavour: c.danishFlavour, window: win(iso), address: addrOf(iso) };
        })
      });
      set(s => {
        s.orders = [order, ...s.orders.filter(o => o.id !== order.id)];
        if (email.trim()) s.user.email = email.trim();
        s.plan = { dates: [], days: {} };
        s.onboarding = false;
      });
      nav(`/orders/${order.id}/confirmed`, { replace: true });
    } catch (e) {
      if (e.code === 'price_changed' && typeof e.details?.total === 'number') setServerTotal(e.details.total);
      setError(e.message); setPaying(false);
    }
  };

  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">Review &amp; pay</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 16 }}>
        <h1 className="h-display" style={{ fontSize: 34 }}>Review your mornings</h1>
        {expiredNote && <div className="note" role="status"><Icon name="clock" size={20} stroke={1.6} style={{ flex: 'none' }} /><span>{expiredNote}</span></div>}
        <section className="card list" style={{ padding: '4px 20px' }}>
          {dates.map((iso, k) => {
            const c = plan.days[iso].cfg;
            const d = dateInfo(iso);
            const meta = [c.addons.length ? extrasShort(c.addons) : null, windowLabel(win(iso)).replace(' AM', '').replace(' – ', '–'), dl.sameForAll || dates.length === 1 ? null : shortPlace(addrOf(iso).building)].filter(Boolean).join(' · ');
            return (
              <div key={iso} className="row" style={{ alignItems: 'flex-start', gap: 16, padding: '16px 0', borderTop: k ? '1px solid var(--line-soft)' : 0 }}>
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
          <div className="sr"><span className="help">Delivery</span><span>Included</span></div>
          {creditUsed > 0 && <div className="sr"><span className="help">Morning Box credit</span><span>− AED {creditUsed}</span></div>}
          <hr className="divider" />
          <div className="sr" style={{ fontSize: 22, fontWeight: 700 }}><span>Total</span><span>AED {payTotal - creditUsed}</span></div>
          {PRICING.indicative && <span className="xs">Prices are indicative during our pilot.</span>}
        </section>
        {oneAddress && dl.address.building && (
          <Link to="/checkout/delivery" className="card row" style={{ textDecoration: 'none', gap: 16, padding: '16px 20px' }}>
            <Icon name="pin" size={22} stroke={1.6} />
            <span className="stack" style={{ flex: 1, gap: 2 }}><span className="strong" style={{ fontSize: 16 }}>{dl.address.building}{dl.address.unit ? `, ${dl.address.unit}` : ''}</span>
              <span className="help" style={{ fontSize: 15 }}>{dl.address.handover === 'door' ? 'To your door' : 'At Reception'} · {dates.length > 1 ? 'all mornings' : 'DIFC'}</span></span>
            <span className="link">Edit</span>
          </Link>
        )}
        <div className="field"><label htmlFor="em">Email for confirmation <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <input id="em" className={`input${emailTouched && emailBad ? ' invalid' : ''}`} type="email" autoComplete="email" placeholder="you@company.com" value={email}
            aria-invalid={emailTouched && emailBad} onBlur={() => setEmailTouched(true)} onChange={e => setEmail(e.target.value)} />
          {emailTouched && emailBad && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Enter a valid email, e.g. name@company.com — or leave it empty</span>}</div>
        <div className="grid-2" role="radiogroup" aria-label="Payment method">
          {[['apple', 'apple', 'Apple Pay'], ['card', 'card', 'Card']].map(([id, icon, label]) => (
            <button key={id} type="button" className={`win${method === id ? ' on' : ''}`} role="radio" aria-checked={method === id} onClick={() => setMethod(id)} style={{ padding: '0 16px', minHeight: 60, gap: 10 }}>
              <Icon name={icon} size={22} stroke={1.6} /><span style={{ fontSize: 17, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
              {method === id && <span className="dot"><Icon name="check" size={15} stroke={2.2} /></span>}
            </button>
          ))}
        </div>
        <p className="help" style={{ fontSize: 15.5, margin: 0 }}>Free cancellation until 9:00 PM the night before.</p>
        {SHOW_DEMO && <span className="demo-note">Development build: no card is charged. The payment gateway connects at the integration point in server/personal.js.</span>}
        <ErrorBanner>{error}</ErrorBanner>
      </main>
      <Footer sheet>
        <button className="btn" onClick={pay} disabled={paying}><Icon name="lock" size={20} stroke={1.8} />{paying ? 'Processing…' : `Pay AED ${payTotal - creditUsed}`}</button>
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
  const { order, loading } = useOrder(id);
  if (loading) return <Loading back="/today" />;
  if (!order) return <Navigate to={state.session ? '/orders' : `/sign-in?next=/orders/${id}/confirmed`} replace />;
  const first = order.days[0];
  const ds = order.days.map(d => dateInfo(d.date));
  const list = ds.length === 1 ? ds[0].long.replace(',', '') : `${ds.slice(0, -1).map(d => `${d.wd} ${d.day}`).join(', ')} & ${ds[ds.length - 1].wd} ${ds[ds.length - 1].day} ${dateInfo(ds[ds.length - 1].iso).long.split(' ').pop()}`;
  return (
    <Screen>
      <main className="screen-main" style={{ paddingTop: 48, gap: 24 }}>
        <SunCheck />
        <div className="stack center" style={{ alignItems: 'center', gap: 10, marginTop: -6 }}>
          <span className="eyebrow" style={{ letterSpacing: '.24em' }}>Order {order.id}</span>
          <h1 className="h-display" style={{ fontSize: 34 }}>Your mornings are set, {state.user?.firstName}.</h1>
          <p className="help" style={{ fontSize: 17 }}>{order.days.length} breakfast{order.days.length > 1 ? 's' : ''} · {list}</p>
        </div>
        <section className="card stack gap-16" style={{ padding: 20, gap: 16 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span className="stack" style={{ gap: 2 }}>
              <span className="eyebrow grey" style={{ letterSpacing: '.1em', fontWeight: 500 }}>First delivery</span>
              <span className="strong" style={{ fontSize: 18 }}>{ds[0].wd}, {ds[0].day} {ds[0].mon} · {windowLabel(first.window).replace(' – ', '–')}</span>
              <span className="help" style={{ fontSize: 16 }}>{shortPlace(first.address.building)} · {first.address.handover === 'door' ? 'Door' : 'Reception'}</span>
              {first.bakery && <span className="help" style={{ fontSize: 16 }}>Prepared by {first.bakery}</span>}
            </span>
            <span className="status ok">Confirmed</span>
          </div>
        </section>
        <section className="panel row" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Icon name="coffee" size={24} stroke={1.6} style={{ flex: 'none' }} />
          <span className="strong" style={{ flex: 1, fontSize: 17 }}>Remind me the night before</span>
          <Switch checked={state.settings.coffeeReminder} label="Drink reminder" onChange={v => set(s => { s.settings.coffeeReminder = v; })} />
        </section>
      </main>
      <Footer>
        <Link to={`/orders/${order.id}/${first.date}`} className="btn">Track my morning</Link>
        <div className="row" style={{ justifyContent: 'center', gap: 24 }}>
          <button type="button" className="btn-text" onClick={() => download(`/orders/${order.id}/calendar`, `Morning-Box-${order.id}.ics`, 'text/calendar').catch(() => {})}><Icon name="cal" size={16} />Add to calendar</button>
          <Link to="/today" className="btn-text">Back to home</Link>
        </div>
      </Footer>
    </Screen>
  );
}
