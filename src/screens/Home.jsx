import { Link } from 'react-router-dom';
import { Icon, Logo } from '../components/ui.jsx';
import { useStore } from '../state/store.jsx';
import { planningWeeks, timeLeft } from '../domain/app.js';

export default function Home() {
  const { state } = useStore();
  const first = planningWeeks()[0][0];
  const left = timeLeft(first.iso);
  const signedIn = !!state.user;

  return (
    <div style={{ background: 'var(--ivory)', minHeight: '100dvh' }}>
      <header className="home-wide row" style={{ paddingTop: 12, paddingBottom: 12 }}>
        <Logo width={140} />
        <nav className="nav-links" aria-label="Main">
          <a className="l" href="#how">How it works</a>
          <Link className="l" to="/business">For companies</Link>
          <span className="tag" style={{ padding: '8px 12px' }}><Icon name="pin" size={14} stroke={2} /> DIFC</span>
          <Link to={signedIn ? '/today' : '/sign-in?next=/today'} className="icon-btn" aria-label={signedIn ? 'My mornings' : 'Sign in'}>
            <Icon name="user" />
          </Link>
        </nav>
      </header>

      <section className="home-wide home-hero" style={{ paddingTop: 8 }}>
        <div className="stack gap-16" style={{ order: 2 }}>
          <span className="eyebrow">Your personal breakfast assistant</span>
          <h1 className="h-hero big">Breakfast, arranged around your morning.</h1>
          <p className="help" style={{ maxWidth: 520 }}>
            Three simple questions. One confident recommendation. Freshly prepared by a partner bakery and delivered in the window you choose.
          </p>
          <div className="stack gap-10" style={{ maxWidth: 420 }}>
            <Link to="/start" className="btn">Create My Morning <Icon name="arrow" size={18} stroke={2} /></Link>
            <Link to="/business/people" className="btn-secondary">Business Breakfast</Link>
          </div>
          <span className="sm row" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <Icon name="clock" size={18} color="#7A5A14" />
            {left ? <>Order by 9:00 PM for {first.label} · <b className="strong">{left} left</b></> : 'Order by 9:00 PM for next-day breakfast'}
          </span>
        </div>
        <div style={{ order: 1 }}>
          <img className="home-hero-img" src="./assets/morningbox-breakfast-over-dubai.png" alt="A Morning Box breakfast on a sunlit table over the Dubai skyline" />
        </div>
      </section>

      <section id="how" className="home-wide stack gap-16" style={{ paddingTop: 72 }}>
        <span className="eyebrow">How it works</span>
        <h2 className="h-section">Simple questions. Clear choices. Fast decisions.</h2>
        <div className="home-grid">
          {[
            ['Tell us how you like to eat', 'Eating style, what you enjoy, and any dietary needs or allergies. Asked once.'],
            ['Plan your mornings', 'Pick one or more dates, tell us what each morning looks like, and receive your Morning Box.'],
            ['Delivered in your window', 'Prepared fresh by a partner bakery, delivered between 7:30 and 10:30 AM.']
          ].map(([t, d], i) => (
            <div key={t} className="step card" style={{ padding: 22 }}>
              <span className="num">{i + 1}</span>
              <div><div className="strong">{t}</div><div className="sm">{d}</div></div>
            </div>
          ))}
        </div>
      </section>

      <section className="home-wide home-hero" style={{ paddingTop: 72 }}>
        <img className="home-hero-img" src="./assets/morningbox-skyline-breakfast.png" alt="An open Morning Box with croissant, granola bowl and yogurt" style={{ height: 320 }} />
        <div className="stack gap-12">
          <span className="eyebrow">Plan ahead</span>
          <h2 className="h-section">Plan a day, a week, or the week after.</h2>
          <p className="help">Choose the dates first, then build one morning at a time. Copy a morning you liked to the next day in one tap. Never a subscription — every morning is your choice.</p>
        </div>
      </section>

      <section className="home-wide" style={{ paddingTop: 72 }}>
        <div className="dark-band">
          <span className="eyebrow">For teams, meetings &amp; companies</span>
          <h2 className="h-section" style={{ color: 'var(--ivory)' }}>Breakfast for the whole team, without the catering hassle.</h2>
          <p style={{ margin: 0, color: '#E9DCC6' }}>Tell us how many people. We handle the mix, protect special dietary needs, and deliver individual boxes to your office.</p>
          <Link to="/business/people" className="btn auto" style={{ alignSelf: 'flex-start', marginTop: 6 }}>Plan a Business Breakfast</Link>
        </div>
      </section>

      <footer className="home-wide sm row" style={{ padding: '48px clamp(16px,4vw,48px) 32px', flexWrap: 'wrap' }}>
        <span><b className="strong">Morning Box</b> · DIFC, Dubai</span>
        <span>Pre-order only · Delivery windows 7:30–10:30 AM</span>
      </footer>
    </div>
  );
}
