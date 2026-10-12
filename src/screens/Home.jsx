import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Icon, Logo, Ring } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';
import { get, track } from '../api.js';
import { planningWeeks, timeLeft, tomorrowIso, fromPrice, dubaiNote } from '../domain/app.js';
import { cutoffFor } from '../domain/standards.js';


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
          <span className="date-pill" style={{ padding: '10px 16px', fontWeight: 500 }}><Icon name="pin" size={18} stroke={1.7} /> DIFC</span>
          <Link to={signedIn ? '/today' : '/sign-in?next=/today'} className="icon-btn" style={{ width: 48, height: 48 }} aria-label={signedIn ? 'My mornings' : 'Sign in'}>
            <Icon name="user" size={22} />
          </Link>
        </span>
      </header>

      <section className="home-wide home-hero" style={{ paddingTop: 12, paddingBottom: 32 }}>
        <div className="stack gap-16">
          <span className="eyebrow grey" style={{ letterSpacing: '.24em' }}>{greeting()}{signedIn ? `, ${state.user.firstName}` : ''}</span>
          <h1 className="h-hero big">Tomorrow’s breakfast, <em>already sorted.</em></h1>
        </div>

        <div className="stack gap-16">
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
          {open !== null && open < 3 && (
            <span className="live" style={{ fontWeight: 500 }}><i />
              <span><b>Live</b> <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{open ? `${open} of 3 windows left` : 'Fully booked'} for {first.iso === tomorrowIso() ? 'tomorrow' : first.label}</span></span>
            </span>
          )}

          <div className="stack gap-12" style={{ marginTop: 6 }}>
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
            <p className="sm center" style={{ margin: '4px 0 0', fontSize: 16 }}>
              Already planning with us? <Link to="/sign-in?next=/today" className="strong link-hit" style={{ textDecorationColor: 'var(--gold)', textUnderlineOffset: 4 }}>Sign in</Link>
            </p>
          )}
          <nav className="row xs" aria-label="Help and policies" style={{ justifyContent: 'center', gap: 18, marginTop: 6 }}>
            <Link to="/help" className="link-hit" style={{ color: 'inherit' }}>Help</Link>
            <Link to="/legal/terms" className="link-hit" style={{ color: 'inherit' }}>Terms</Link>
            <Link to="/legal/privacy" className="link-hit" style={{ color: 'inherit' }}>Privacy</Link>
          </nav>
        </div>
      </section>
    </div>
  );
}
