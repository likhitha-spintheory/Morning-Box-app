import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CONSENT } from '../legal/documents.js';
import { setStorageChoice, useStorageChoice } from '../state/consent.js';
import { Switch } from './ui.jsx';

/* Legal pack B5: first-visit banner with Accept all, Reject non-essential and Settings, equally easy to choose.
   Settings can be reopened from Profile › Privacy & data and the home page ("Cookie settings"). */
export default function CookieBanner() {
  const choice = useStorageChoice();
  const { pathname } = useLocation();
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  useEffect(() => {
    const open = () => { setAnalytics(choice?.analytics === true); setSettings(true); };
    window.addEventListener('morningbox:cookie-settings', open);
    return () => window.removeEventListener('morningbox:cookie-settings', open);
  }, [choice]);
  /* Staff screens and the legal pages themselves don't need it in the way. */
  const staff = pathname.startsWith('/ops') || pathname.startsWith('/bakery');
  if ((choice && !settings) || (staff && !settings) || (pathname.startsWith('/legal/') && !settings)) return null;
  const decide = v => { setStorageChoice(v); setSettings(false); };
  const btn = { flex: '1 1 0', minWidth: 0, minHeight: 44, padding: '0 10px', fontSize: 14.5 };
  return (
    <div className="cookie-banner" role="dialog" aria-modal="false" aria-labelledby="cookie-title">
      <div className="card stack gap-10" style={{ padding: 16, boxShadow: '0 8px 30px rgba(59,45,34,.18)' }}>
        <strong id="cookie-title" style={{ fontSize: 16 }}>{settings ? 'Cookie settings' : 'Your privacy'}</strong>
        {!settings ? (
          <>
            <p className="help" style={{ margin: 0, fontSize: 14.5 }}>{CONSENT.cookieBanner} <Link to="/legal/cookies" className="link">Cookie Notice</Link></p>
            <div className="cookie-actions">
              <button type="button" className="btn-secondary" style={btn} onClick={() => decide(true)}>Accept all</button>
              <button type="button" className="btn-secondary" style={btn} onClick={() => decide(false)}>Reject non-essential</button>
              <button type="button" className="btn-secondary" style={btn} onClick={() => { setAnalytics(false); setSettings(true); }}>Settings</button>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span className="stack" style={{ flex: 1, gap: 2 }}><span className="strong" style={{ fontSize: 15 }}>Essential</span>
                <span className="xs">Keeps you signed in and saves your plan. Always on.</span></span>
              <span className="xs" style={{ paddingTop: 2 }}>On</span>
            </div>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span className="stack" style={{ flex: 1, gap: 2 }}><span className="strong" style={{ fontSize: 15 }}>Analytics</span>
                <span className="xs">Measures how the app is used so we can improve it. No third-party tools, no advertising.</span></span>
              <Switch checked={analytics} label="Analytics" onChange={setAnalytics} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn-secondary" style={btn} onClick={() => decide(analytics)}>Save choices</button>
              {choice && <button type="button" className="btn-text" style={{ ...btn, flex: 'none' }} onClick={() => setSettings(false)}>Close</button>}
            </div>
            <Link to="/legal/cookies" className="link xs" onClick={() => setSettings(false)}>Read the Cookie & Device Storage Notice</Link>
          </>
        )}
      </div>
    </div>
  );
}
