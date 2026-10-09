import { useEffect, useState } from 'react';
import { Logo } from '../components/ui.jsx';

const KEY = 'morningbox.splash.seen';

/** Brand splash (style-1 P01), shown once per browser session while the app opens. */
export default function Splash() {
  const [show, setShow] = useState(() => { try { return !sessionStorage.getItem(KEY); } catch { return false; } });
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!show) return undefined;
    try { sessionStorage.setItem(KEY, '1'); } catch { /* storage blocked: show once in memory */ }
    const t1 = setTimeout(() => setFading(true), 1100);
    const t2 = setTimeout(() => setShow(false), 1450);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [show]);
  if (!show) return null;
  return (
    <div role="presentation" onClick={() => setShow(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'var(--ivory)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transition: 'opacity .35s', opacity: fading ? 0 : 1 }}>
      <svg viewBox="0 0 280 60" width="280" aria-hidden="true" style={{ marginBottom: 12 }}>
        <path d="M10 56 Q140 -4 270 56" fill="none" stroke="#E6D3AE" strokeWidth="2.5" strokeDasharray="2 8" strokeLinecap="round" />
      </svg>
      <Logo width={300} to="/" />
      <span className="eyebrow grey" style={{ marginTop: 34, letterSpacing: '.3em', fontSize: 13 }}>Now serving DIFC</span>
      <span className="help" style={{ position: 'absolute', bottom: 'calc(48px + env(safe-area-inset-bottom))', fontSize: 17 }}>Good mornings, made for you.</span>
    </div>
  );
}
