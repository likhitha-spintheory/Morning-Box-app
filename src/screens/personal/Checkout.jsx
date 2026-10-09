import { useEffect, useRef, useState } from 'react';
import { get, post, put, applySession, setToken } from '../../api.js';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Footer, Icon, Chip, Note, Switch } from '../../components/ui.jsx';
import { useStore } from '../../state/store.jsx';
import {
  DELIVERY_WINDOWS, dateInfo, dayPrice, boxTitle, sizeLabel, extrasText, windowLabel
} from '../../domain/app.js';


/* ---------- Mobile + OTP + first name (MB-FLW-001 §7) ---------- */
export function SignIn() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/today';
  const [name, setName] = useState(state.user?.firstName || '');
  const [mobile, setMobile] = useState(state.user?.mobile || '');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');
  const [existing, setExisting] = useState(false);
  const refs = useRef([]);
  const digits = mobile.replace(/\D/g, '').replace(/^(00)?971/, '').replace(/^0/, '');
  const mobileOk = /^5\d{8}$/.test(digits);
  const nameOk = name.trim().length > 0;
  const planned = state.plan.dates.filter(d => state.plan.days[d]?.saved);
  const total = planned.reduce((t, d) => t + dayPrice(state.plan.days[d].cfg, state.profile).total, 0);

  const typeDigit = (i, v) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setCode(c => { const n = c.slice(); n[i] = d; return n; });
    if (d && i < 5) refs.current[i + 1]?.focus();
  };
  const send = async () => {
    setTouched(true); setError('');
    if (!mobileOk) return;
    setBusy(true);
    try {
      const r = await post('/auth/otp', { mobile: digits });
      setDevCode(r.devCode || ''); setExisting(r.existingUser); setSent(true);
      setTimeout(() => refs.current[0]?.focus(), 50);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const needName = sent && !existing;
  const verify = async () => {
    setTouched(true);
    if (needName && !nameOk) return;
    setBusy(true); setError('');
    try {
      const r = await post('/auth/verify', { mobile: digits, code: code.join(''), firstName: needName ? name.trim() : undefined });
      setToken(r.token);
      set(s => applySession(s, r));
      /* First sign-in after onboarding: save the profile built before registration. */
      if (!r.profile && state.profileDone) await put('/me/profile', state.profile).catch(() => {});
      const orders = await get('/orders').catch(() => null);
      if (orders) set(s => { s.orders = orders; });
      nav(next, { replace: true });
    } catch (e) {
      setError(e.message); setBusy(false);
      if (e.code === 'otp_wrong') { setCode(['', '', '', '', '', '']); refs.current[0]?.focus(); }
    }
  };

  return (
    <Screen>
      <TopBar back={-1} close="/"><span className="topbar-title">{planned.length ? 'Almost there' : 'Sign in'}</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
        {planned.length > 0 && (
          <div className="note" style={{ alignItems: 'center' }}>
            <Icon name="cal" size={22} color="#7A5A14" />
            <span style={{ fontSize: 15 }}><b>{planned.length} morning{planned.length > 1 ? 's' : ''} · AED {total}</b> held for you</span>
          </div>
        )}
        <div className="stack gap-8">
          <h1 className="h-display" style={{ fontSize: 34 }}>{planned.length ? 'Save your mornings' : 'Welcome back'}</h1>
          <p className="help">Your mobile number is all we need. Already with us? The same step signs you in.</p>
        </div>
        <div className="field">
          <label htmlFor="mb">Mobile number</label>
          <div className="input-prefix">
            <span className="input pre">+971</span>
            <input id="mb" className={`input${touched && !sent && !mobileOk ? ' invalid' : ''}`} inputMode="tel" autoComplete="tel-national"
              placeholder="50 123 4567" value={mobile} onChange={e => setMobile(e.target.value)} disabled={sent} aria-describedby="mb-err" />
          </div>
          {touched && !sent && !mobileOk && <span id="mb-err" className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Enter a UAE mobile number, e.g. 50 123 4567</span>}
        </div>

        {sent && (
          <div className="stack gap-10">
            <div className="row">
              <span className="label">Enter the 6-digit code</span>
              <button type="button" className="link" onClick={() => { setSent(false); setTouched(false); setCode(['', '', '', '', '', '']); }}>Change number</button>
            </div>
            <div className="otp">
              {code.map((c, i) => (
                <input key={i} ref={el => (refs.current[i] = el)} inputMode="numeric" maxLength={1} aria-label={`Digit ${i + 1}`}
                  value={c} onChange={e => typeDigit(i, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus(); }} />
              ))}
            </div>
            {devCode && <span className="demo-note">Development build — your code is <b>{devCode}</b>. In production it arrives by SMS.</span>}
            {existing && <span className="xs">Welcome back — we’ll keep your saved profile and orders.</span>}
          </div>
        )}
        {needName && (
          <div className="field">
            <label htmlFor="fn">Your first name</label>
            <input id="fn" className={`input${touched && !nameOk ? ' invalid' : ''}`} value={name} autoComplete="given-name"
              onChange={e => setName(e.target.value)} />
            {touched && !nameOk && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Enter your first name</span>}
          </div>
        )}
        {error && <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
      </main>
      <Footer>
        {!sent ? (
          <button className="btn" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send code'}</button>
        ) : (
          <button className="btn" disabled={busy || code.join('').length < 6} onClick={verify}>{busy ? 'Checking…' : 'Verify & Continue'}</button>
        )}
        <p className="xs center" style={{ margin: 0 }}>By continuing you agree to the Terms and Privacy Policy.</p>
      </Footer>
    </Screen>
  );
}

/* ---------- Delivery details (MB-FLW-001 §8) ---------- */
export function Delivery() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const [touched, setTouched] = useState(false);
  const plan = state.plan;
  const dates = plan.dates.filter(d => plan.days[d]?.saved);
  /* MB-DLV-001 §8: a window closes when production or delivery capacity is exhausted. */
  const [avail, setAvail] = useState({});
  const key = dates.join(',');
  useEffect(() => { if (key) get(`/availability?dates=${key}`).then(setAvail).catch(() => {}); }, [key]);
  const isFull = (iso, w) => avail[iso]?.[w] ? !avail[iso][w].available : false;
  if (!state.session) return <Navigate to="/sign-in?next=/checkout/delivery" replace />;
  if (!dates.length) return <Navigate to="/plan/dates" replace />;
  const dl = state.delivery;
  const a = dl.address;
  const upd = fn => set(s => fn(s.delivery));
  const windowFor = iso => (dl.sameForAll ? dl.window : dl.perDay[iso]?.window);
  const addrOk = a.building.trim() && a.unit.trim();
  const windowsOk = dates.every(iso => windowFor(iso) && !isFull(iso, windowFor(iso)));
  const ok = addrOk && windowsOk;

  const WindowPicker = ({ iso }) => (
    <div className="stack gap-8" role="radiogroup" aria-label={`Delivery window${iso ? ` for ${dateInfo(iso).label}` : ''}`}>
      {DELIVERY_WINDOWS.map(w => {
        const full = iso ? isFull(iso, w.id) : dates.some(d => isFull(d, w.id));
        const on = iso ? dl.perDay[iso]?.window === w.id : dl.window === w.id;
        return (
          <button key={w.id} type="button" className={`win${on ? ' on' : ''}`} role="radio" aria-checked={on} disabled={full}
            onClick={() => upd(d => { if (iso) d.perDay[iso] = { ...(d.perDay[iso] || {}), window: w.id }; else d.window = w.id; })}>
            <span className="dot" />
            <span className="stack"><span className="strong">{w.label}</span>
              {full && <span className="xs">Fully booked{iso ? '' : ` for ${dateInfo(dates.find(d => isFull(d, w.id))).label}`}</span>}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Screen>
      <TopBar back={-1} close="/"><span className="topbar-title">Delivery</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8, gap: 22 }}>
        <h1 className="h-display" style={{ fontSize: 34 }}>Where should we bring breakfast, {state.user.firstName}?</h1>

        {dates.length > 1 && (
          <section className="stack gap-10">
            <h2 className="h3">Same delivery for all {dates.length} mornings?</h2>
            <div className="seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }} role="radiogroup">
              <button role="radio" aria-checked={dl.sameForAll} className={dl.sameForAll ? 'on' : ''} onClick={() => upd(d => { d.sameForAll = true; })}>Yes, all mornings</button>
              <button role="radio" aria-checked={!dl.sameForAll} className={!dl.sameForAll ? 'on' : ''} onClick={() => upd(d => { d.sameForAll = false; })}>Set per day</button>
            </div>
          </section>
        )}

        <section className="stack gap-12">
          <h2 className="h3">Location</h2>
          <div className="field"><label htmlFor="b">Building / Tower</label>
            <input id="b" className={`input${touched && !a.building.trim() ? ' invalid' : ''}`} placeholder="e.g. Gate Village, Building 3" value={a.building} onChange={e => upd(d => { d.address.building = e.target.value; })} /></div>
          <div className="grid-2">
            <div className="field"><label htmlFor="u">Floor / Unit</label>
              <input id="u" className={`input${touched && !a.unit.trim() ? ' invalid' : ''}`} placeholder="Level 4, Unit 402" value={a.unit} onChange={e => upd(d => { d.address.unit = e.target.value; })} /></div>
            <div className="field"><label htmlFor="ar">Area</label>
              <input id="ar" className="input" value={a.area} readOnly aria-describedby="ar-h" /></div>
          </div>
          <span id="ar-h" className="xs">Morning Box currently delivers within DIFC.</span>
          {touched && !addrOk && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Add your building and floor or unit</span>}
          <div className="stack gap-8">
            <span className="label">Hand over at</span>
            <div className="chips">
              <Chip on={a.handover === 'reception'} onClick={() => upd(d => { d.address.handover = 'reception'; })}>Reception</Chip>
              <Chip on={a.handover === 'door'} onClick={() => upd(d => { d.address.handover = 'door'; })}>My door</Chip>
            </div>
          </div>
        </section>

        {dl.sameForAll || dates.length === 1 ? (
          <section className="stack gap-10">
            <div className="row"><h2 className="h3">Delivery window</h2><span className="xs">We arrive within your hour</span></div>
            <WindowPicker />
          </section>
        ) : dates.map(iso => (
          <section key={iso} className="stack gap-10">
            <h2 className="h3">{dateInfo(iso).long}</h2>
            <WindowPicker iso={iso} />
          </section>
        ))}
        {touched && !windowsOk && <span className="err-msg"><Icon name="alert" size={14} stroke={2.2} />Choose an available delivery window{dl.sameForAll ? '' : ' for each morning'}</span>}

        <div className="field"><label htmlFor="n">Delivery notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <input id="n" className="input" placeholder="e.g. Leave with the concierge" value={a.notes} onChange={e => upd(d => { d.address.notes = e.target.value; })} /></div>
      </main>
      <Footer><button className="btn" onClick={() => { setTouched(true); if (ok) nav('/checkout/review'); }}>Review Order</button></Footer>
    </Screen>
  );
}

/* ---------- Review & pay (MB-FLW-001 §9) ---------- */
export function ReviewPay() {
  const { state, set } = useStore();
  const nav = useNavigate();
  const [method, setMethod] = useState('card');
  const [email, setEmail] = useState(state.user?.email || '');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const plan = state.plan;
  const dates = plan.dates.filter(d => plan.days[d]?.saved);
  if (!state.session) return <Navigate to="/sign-in?next=/checkout/review" replace />;
  if (!dates.length) return <Navigate to="/plan/dates" replace />;
  const dl = state.delivery;
  const win = iso => (dl.sameForAll ? dl.window : dl.perDay[iso]?.window);
  const prices = dates.map(d => dayPrice(plan.days[d].cfg, state.profile));
  const boxes = prices.reduce((t, p) => t + p.base + p.sizeAdj, 0);
  const extras = prices.reduce((t, p) => t + p.addons, 0);
  const total = boxes + extras;
  const where = `${dl.address.handover === 'door' ? 'Door' : 'Reception'}, ${dl.address.building}`;

  /* The server re-validates every morning and re-prices the order before payment. */
  const pay = async () => {
    setPaying(true); setError('');
    try {
      const order = await post('/orders', {
        method, email: email.trim(), address: dl.address,
        days: dates.map(iso => {
          const c = plan.days[iso].cfg;
          return { date: iso, context: c.context, recipeId: c.recipeId, components: c.components, size: c.size, addons: c.addons, window: win(iso) };
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
      <TopBar back={-1} close="/"><span className="topbar-title">Review &amp; pay</span></TopBar>
      <main className="screen-main" style={{ paddingTop: 8 }}>
        <h1 className="h-display" style={{ fontSize: 34 }}>One last look</h1>
        <section className="card list">
          {dates.map((iso, k) => {
            const c = plan.days[iso].cfg;
            return (
              <div key={iso} className="stack gap-4" style={{ padding: '14px 0', borderTop: k ? '1px solid var(--line-soft)' : 0 }}>
                <div className="sr"><strong>{dateInfo(iso).label}</strong><Link to={`/plan/day/${iso}/box`} style={{ fontWeight: 600, fontSize: 14 }}>Edit</Link></div>
                <span className="sm" style={{ color: 'var(--espresso)' }}>{boxTitle(c)} · {sizeLabel(c.size)}</span>
                <span className="xs">{c.addons.length ? `Extras: ${extrasText(c.addons)}` : 'No extras'}</span>
                <div className="sr"><span className="xs">{windowLabel(win(iso))} · {where}</span><span className="money">AED {prices[k].total}</span></div>
              </div>
            );
          })}
        </section>
        <section className="panel">
          <div className="sr"><span>Breakfasts</span><span className="money">AED {boxes}</span></div>
          {extras > 0 && <div className="sr"><span>Extras</span><span className="money">AED {extras}</span></div>}
          <div className="sr"><span>Delivery</span><span>Included</span></div>
          <hr className="divider" />
          <div className="sr total"><span>Total</span><span>AED {total}</span></div>
          <span className="xs">Prices are indicative until final costing is approved.</span>
        </section>
        <section className="stack gap-10">
          <h2 className="h3">Payment</h2>
          {[['card', 'Card', 'Visa, Mastercard'], ['apple', 'Apple Pay', '']].map(([id, l, d]) => (
            <button key={id} type="button" className={`win${method === id ? ' on' : ''}`} role="radio" aria-checked={method === id} onClick={() => setMethod(id)}>
              <span className="dot" /><span className="strong">{l}</span>{d && <span className="xs" style={{ marginLeft: 'auto' }}>{d}</span>}
            </button>
          ))}
        </section>
        <div className="field"><label htmlFor="em">Email for your receipt <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
          <input id="em" className="input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <p className="xs" style={{ margin: 0 }}>Change or cancel any morning free of charge until 9:00 PM the evening before.</p>
        <span className="demo-note">Development build: no card is charged. The payment gateway connects at the integration point in server/personal.js.</span>
        {error && <div className="banner-err" role="alert"><Icon name="alert" size={18} stroke={2} />{error}</div>}
      </main>
      <Footer>
        <button className="btn" onClick={pay} disabled={paying}><Icon name="lock" size={16} stroke={2} />{paying ? 'Processing…' : `Pay AED ${total}`}</button>
      </Footer>
    </Screen>
  );
}

/* ---------- Confirmation ---------- */
export function Confirmed() {
  const { id } = useParams();
  const { state, set } = useStore();
  const order = state.orders.find(o => o.id === id);
  if (!order) return <Navigate to="/orders" replace />;
  const first = order.days[0];
  return (
    <Screen>
      <main className="screen-main" style={{ paddingTop: 56, gap: 22 }}>
        <div className="stack center" style={{ alignItems: 'center', gap: 14 }}>
          <span style={{ width: 80, height: 80, borderRadius: 999, background: 'var(--gold)', color: 'var(--on-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={38} stroke={2.4} /></span>
          <h1 className="h-display">Your mornings are arranged</h1>
          <p className="help">Thank you, {state.user?.firstName}. We’ll message you when breakfast is on its way.</p>
          <span className="sm">Order <strong className="strong">{order.id}</strong> · Paid AED {order.total}</span>
        </div>
        <section className="card list">
          {order.days.map((d, k) => (
            <div key={d.date} className="row" style={{ padding: '14px 0', borderTop: k ? '1px solid var(--line-soft)' : 0 }}>
              <span className="stack"><strong>{dateInfo(d.date).label}</strong><span className="xs">{boxTitle(d.cfg)}{d.cfg.addons.length ? ' + extras' : ''}</span></span>
              <span className="sm">{windowLabel(d.window).replace(' AM', '')}</span>
            </div>
          ))}
        </section>
        <p className="xs center" style={{ margin: 0 }}>{first.address.building} · {first.address.unit} · {first.address.handover === 'door' ? 'Door' : 'Reception'}</p>
        <section className="note" style={{ alignItems: 'center' }}>
          <Icon name="coffee" size={26} color="#7A5A14" stroke={1.6} />
          <span className="stack"><span className="strong" style={{ fontSize: 15 }}>Coffee reminder</span><span className="xs">A nudge the night before to get your coffee or juice ready. Not part of your order.</span></span>
          <Switch checked={state.settings.coffeeReminder} label="Coffee reminder" onChange={v => set(s => { s.settings.coffeeReminder = v; })} />
        </section>
      </main>
      <Footer>
        <Link to={`/orders/${order.id}/${first.date}`} className="btn">View My Order</Link>
        <Link to="/today" className="btn-text" style={{ alignSelf: 'center' }}>Back to Home</Link>
      </Footer>
    </Screen>
  );
}
