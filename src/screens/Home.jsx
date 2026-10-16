import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Icon, Logo, Ring } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';
import { get, track } from '../api.js';
import { planningWeeks, timeLeft, tomorrowIso, fromPrice, dubaiNote } from '../domain/app.js';
import { cutoffFor, areasText, SERVICE_AREAS, ACTIVE_AREAS } from '../domain/standards.js';


function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const { state } = useStore();
  const first = planningWeeks()[0][0];
  const left = timeLeft(first.iso);
  const hoursLeft = Math.max(0, (cutoffFor(first.iso) - new Date()) / 3.6e6);
  const signedIn = !!(state.session && state.user);
  const [open, setOpen] = useState(null);
  const [params] = useSearchParams();
  /* Demand KPI (Master Plan §15): one visit per app session. */
  useEffect(() => { try { if (!sessionStorage.getItem('mb.visit')) { sessionStorage.setItem('mb.visit', '1'); track('visit'); } } catch { /* storage blocked */ } }, []);

  /* Live delivery-window availability for the next orderable morning (MB-DLV-001 §8). */
  useEffect(() => {
    get(`/availability?dates=${first.iso}`)
      .then(a => setOpen(Object.values(a[first.iso] || {}).filter(w => w.available).length))
      .catch(() => setOpen(null));
  }, [first.iso]);

  /* MB-FLW-001 §10: returning customers go straight to their mornings (?home=1 shows this page). */
  if (signedIn && !params.get('home')) return <Navigate to="/today" replace />;
  return (
    <div style={{ background: 'var(--ivory)', minHeight: '100dvh' }}>
      <header className="home-wide row" style={{ paddingTop: 16, paddingBottom: 8 }}>
        <Logo width={150} />
        <span className="row" style={{ gap: 10 }}>
          <span className="date-pill" style={{ padding: '10px 16px', fontWeight: 500 }}><Icon name="pin" size={18} stroke={1.7} /> {areasText()}</span>
          <Link to={signedIn ? '/today' : '/sign-in?next=/today'} className="icon-btn" style={{ width: 48, height: 48 }} aria-label={signedIn ? 'My mornings' : 'Sign in'}>
            <Icon name="user" size={22} />
          </Link>
        </span>
      </header>

      {/* MB-DSN-001 §5/§8: editorial hero — headline, short line and the two entry paths beside a large photo (FLW §1). */}
      <section className="home-wide home-hero">
        <div className="home-hero-text stack gap-16">
          <span className="eyebrow grey" style={{ letterSpacing: '.24em' }}>{greeting()}{signedIn ? `, ${state.user.firstName}` : ''}</span>
          <h1 className="h-hero big">Tomorrow’s breakfast, <em>already sorted.</em></h1>
          <p className="home-lede">Personalized breakfast boxes from partner bakeries, delivered in the window you choose.</p>
        </div>

        <div className="home-photo">
          <img src="./assets/morningbox-skyline-breakfast.jpg" alt="An open Morning Box with croissant, granola bowl and yogurt over the Dubai skyline" />
          <div className="countdown">
            <Ring fraction={Math.min(1, hoursLeft / 24)} label={`${Math.floor(hoursLeft)}h`} size={44} />
            <span className="stack" style={{ lineHeight: 1.3 }}>
              <span className="strong" style={{ fontSize: 16 }}>Order by 9:00 PM{dubaiNote()}</span>
              <span className="sm">for {first.label}{left ? <> · <b className="strong">{left} left</b></> : ''}</span>
            </span>
          </div>
        </div>

        <div className="home-hero-actions stack gap-16">
          {open !== null && open < 3 && (
            <span className="live" style={{ fontWeight: 500 }}><i />
              <span><b>Live</b> <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{open ? `${open} of 3 windows left` : 'Fully booked'} for {first.iso === tomorrowIso() ? 'tomorrow' : first.label}</span></span>
            </span>
          )}

          <div className="home-entries">
            <Link to="/start" className="entry gold">
              <Icon name="sunny" size={24} stroke={1.6} />
              <span style={{ flex: 1 }}><b>Create My Morning</b><span className="d">From AED {fromPrice()}</span></span>
              <Icon name="arrow" size={22} stroke={1.8} />
            </Link>
            <Link to={state.businessUser ? '/business' : '/business/people'} className="entry plain">
              <Icon name="brief" size={24} stroke={1.6} />
              <span style={{ flex: 1 }}><b>Business Breakfast</b><span className="d" style={{ color: 'var(--text-3)', opacity: 1 }}>For teams &amp; meetings</span></span>
              <Icon name="arrow" size={22} stroke={1.8} />
            </Link>
          </div>
          {!signedIn && (
            <p className="sm home-signin" style={{ margin: '4px 0 0', fontSize: 16 }}>
              Already planning with us? <Link to="/sign-in?next=/today" className="strong link-hit" style={{ textDecorationColor: 'var(--gold)', textUnderlineOffset: 4 }}>Sign in</Link>
            </p>
          )}
        </div>
      </section>

      {/* MB-DSN-001 §8 approved homepage direction: a quiet trust strip and the launch-area band (copy is provisional). */}
      <section className="home-wide home-section" aria-label="Why Morning Box">
        <ul className="home-strip">
          {[['leaf', 'Curated from trusted partner bakeries'], ['sparkle', 'Personalized to your mornings'], ['bread', 'Freshly prepared for your morning'], ['clock', 'Delivered in the window you choose']].map(([icon, text]) => (
            <li key={icon}><span className="home-strip-ico"><Icon name={icon} size={26} stroke={1.4} color="var(--muted-gold)" /></span><span>{text}</span></li>
          ))}
        </ul>
      </section>
      <section className="home-wide home-section" aria-label="Delivery areas">
        <div className="home-areas">
          <div className="stack gap-8">
            <span className="eyebrow">Now in</span>
            <span className="h-display home-areas-name">{areasText()}</span>
            {SERVICE_AREAS.some(a => !ACTIVE_AREAS.includes(a.id)) && <span className="help">More areas coming soon</span>}
          </div>
          <ul className="home-area-list">
            {SERVICE_AREAS.map(a => {
              const on = ACTIVE_AREAS.includes(a.id);
              return (
                <li key={a.id} className={on ? 'on' : ''}>
                  <span className="ico"><Icon name={on ? 'building' : 'pin'} size={24} stroke={1.4} /></span>
                  <span className="strong">{a.label}</span>
                  <span className="xs">{on ? 'Delivering now' : 'Coming soon'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* How it works — the personal flow as it is (MB-FLW-001 §2–§8), in three steps. */}
      <section className="home-wide home-section" aria-labelledby="how-title">
        <div className="stack gap-8" style={{ maxWidth: 640 }}>
          <span className="eyebrow">How it works</span>
          <h2 id="how-title" className="h-display home-h2">Breakfast, planned around your mornings</h2>
        </div>
        <ol className="home-steps">
          {[
            ['sparkle', 'Tell us about your mornings', 'Your eating style, the breakfasts you like, and any dietary needs or allergies.'],
            ['cal', 'Plan your dates', 'Pick your mornings and how each one looks. We recommend a Morning Box for each, and you can adjust size, swaps and extras.'],
            ['clock', 'Delivered in your window', 'Choose a delivery window. You can change a morning until 9:00 PM the evening before.']
          ].map(([icon, title, text], i) => (
            <li key={icon}>
              <span className="home-step-top">
                <span className="home-step-ico"><Icon name={icon} size={26} stroke={1.4} color="var(--muted-gold)" /></span>
                <span className="home-step-num" aria-hidden="true">0{i + 1}</span>
              </span>
              <span className="eyebrow grey">Step {i + 1}</span>
              <b>{title}</b>
              <span className="help">{text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Closing band: the same primary action again, with the brand line from the approved packaging. */}
      <section className="home-wide home-section" aria-label="Get started">
        <div className="home-closing">
          <img className="home-closing-photo" src="./assets/morningbox-skyline-breakfast.jpg" alt="" />
          <div className="home-closing-text stack gap-12">
            <span className="eyebrow">Good food, brighter days</span>
            <h2 className="h-display home-h2">Your next morning, <em>planned in minutes.</em></h2>
          </div>
          <div className="home-closing-actions">
            <Link to="/start" className="entry gold">
              <Icon name="sunny" size={24} stroke={1.6} />
              <span style={{ flex: 1 }}><b>Create My Morning</b></span>
              <Icon name="arrow" size={22} stroke={1.8} />
            </Link>
            <Link to={state.businessUser ? '/business' : '/business/people'} className="link-hit strong" style={{ textAlign: 'center', textDecorationColor: 'var(--gold)', textUnderlineOffset: 4 }}>Ordering for a team? Business Breakfast</Link>
          </div>
        </div>
      </section>

      <footer className="home-wide"><div className="home-footer">
        <Logo width={110} />
        <nav className="row xs" aria-label="Help and policies" style={{ gap: 18 }}>
          <Link to="/help" className="link-hit" style={{ color: 'inherit' }}>Help</Link>
          <Link to="/legal/terms" className="link-hit" style={{ color: 'inherit' }}>Terms</Link>
          <Link to="/legal/privacy" className="link-hit" style={{ color: 'inherit' }}>Privacy</Link>
        </nav>
      </div></footer>
    </div>
  );
}
