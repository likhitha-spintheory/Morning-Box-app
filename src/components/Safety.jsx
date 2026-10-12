import { Component, useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

/** If a screen crashes, show a calm recovery screen instead of a blank page. */
export class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('[app]', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen" style={{ justifyContent: 'center' }}>
        <main className="screen-main center" style={{ alignItems: 'center', gap: 18, justifyContent: 'center', flex: 1 }}>
          <span style={{ width: 88, height: 88, borderRadius: 999, background: 'var(--sand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="sunny" size={34} stroke={1.5} /></span>
          <h1 className="h-display" style={{ fontSize: 32 }}>Something went wrong</h1>
          <p className="help" style={{ fontSize: 17, margin: 0 }}>Your orders are safe. Please try again.</p>
          <button type="button" className="btn" style={{ width: '100%', maxWidth: 360 }} onClick={() => { location.hash = '#/today'; location.reload(); }}>Try again</button>
        </main>
      </div>
    );
  }
}

/** A small bar while the phone has no connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  return <div className="offline-bar" role="status"><Icon name="offline" size={20} stroke={1.7} />You’re offline. Changes will need a connection.</div>;
}

/** When a newer build of the app is live, offer a refresh (checked on return to the app and every 15 minutes). */
export function UpdateBanner() {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    const current = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';
    if (!current) return undefined;
    const check = () => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
        .then(v => { if (v?.build && v.build !== current) setNewer(true); }).catch(() => {});
    };
    const timer = setInterval(check, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!newer) return null;
  return (
    <div className="offline-bar" role="status"><Icon name="info" size={20} stroke={1.7} /><span style={{ flex: 1 }}>A new version of Morning Box is ready.</span>
      <button type="button" className="btn-text" style={{ color: 'var(--ivory)', minHeight: 0, padding: 0 }} onClick={() => location.reload()}>Refresh</button></div>
  );
}
