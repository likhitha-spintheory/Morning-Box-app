/* Android app (Capacitor) behaviour. Does nothing in a normal browser. */

/** Where the phone's Back button goes on screens without an on-screen back arrow. */
function fallbackRoute(route) {
  if (['/', '/today'].includes(route)) return null;                       // leave the app
  if (/^\/business\/orders\/[^/]+\/confirmed$/.test(route)) return '/business';
  if (/^\/orders\/[^/]+\/confirmed$/.test(route)) return '/today';        // never back into checkout after paying
  if (['/orders', '/me', '/start'].includes(route)) return '/today';      // tab screens
  return undefined;                                                       // use history
}

export async function setupNative() {
  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  const { App } = await import('@capacitor/app');
  /* Hardware/gesture Back behaves like the screen's own back arrow, so both always agree:
     close an open sheet first, then follow the top-left arrow; from Today/Home leave the app. */
  App.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('[role=dialog]')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return;
    }
    const arrow = document.querySelector('.topbar button[aria-label="Back"]');
    if (arrow) { arrow.click(); return; }
    const route = location.hash.replace(/^#/, '').split('?')[0] || '/';
    const target = fallbackRoute(route);
    if (target === null) App.minimizeApp();
    else if (target) location.hash = `#${target}`;
    else if (canGoBack) window.history.back();
    else location.hash = '#/';
  });
}
