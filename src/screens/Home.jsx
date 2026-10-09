import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Icon, Logo, Ring } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';
import { get } from '../api.js';
import { planningWeeks, timeLeft } from '../domain/app.js';
import { cutoffFor } from '../domain/standards.js';

function tomorrowIso() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
          <p className="help" style={{ fontSize: 17, maxWidth: 520 }}>
            Three simple questions. One breakfast made for you — prepared fresh by a partner bakery and delivered in the window you choose.
          </p>
        </div>

        <div className="stack gap-16">
          <div className="home-photo">
            <img src="./assets/morningbox-skyline-breakfast.png" alt="An open Morning Box with croissant, granola bowl and yogurt over the Dubai skyline" />
            <div className="countdown">
              <Ring fraction={Math.min(1, hoursLeft / 24)} label={`${Math.floor(hoursLeft)}h`} size={44} />
              <span className="stack" style={{ lineHeight: 1.3 }}>
                <span className="strong" style={{ fontSize: 16 }}>Order by 9:00 PM</span>
                <span className="sm">for {first.label}{left ? <> · <b className="strong">{left} left</b></> : ''}</span>
              </span>
            </div>
          </div>
          {open !== null && (
            <span className="live" style={{ fontWeight: 500 }}><i />
              <span><b>Live</b> <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>{open} of 3 delivery windows open for {first.iso === tomorrowIso() ? 'tomorrow' : first.label}</span></span>
            </span>
          )}

          <div className="stack gap-12" style={{ marginTop: 6 }}>
            <Link to="/start" className="entry gold">
              <Icon name="sunny" size={24} stroke={1.6} />
              <span style={{ flex: 1 }}><b>Create My Morning</b><span className="d">A breakfast made for you</span></span>
              <Icon name="arrow" size={22} stroke={1.8} />
            </Link>
            <Link to={state.businessUser ? '/business' : '/business/people'} className="entry plain">
              <Icon name="brief" size={24} stroke={1.6} />
              <span style={{ flex: 1 }}><b>Morning Box for Business</b><span className="d" style={{ color: 'var(--text-3)', opacity: 1 }}>Meetings, teams &amp; company</span></span>
              <Icon name="arrow" size={22} stroke={1.8} />
            </Link>
          </div>
          {!signedIn && (
            <p className="sm center" style={{ margin: '4px 0 0', fontSize: 16 }}>
              Already planning with us? <Link to="/sign-in?next=/today" className="strong" style={{ textDecorationColor: 'var(--gold)', textUnderlineOffset: 4 }}>Sign in</Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
