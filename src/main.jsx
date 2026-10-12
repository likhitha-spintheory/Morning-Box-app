import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { StoreProvider } from './state/store.jsx';
import App from './App.jsx';
import './styles.css';
import { setupNative } from './native.js';
import { applyPricing } from './domain/standards.js';
import { setLibrarySettings } from './domain/library.js';
import { applyMenu } from './domain/menu.js';
import { applyAreas } from './domain/standards.js';

setupNative().catch(error => console.error('Morning Box native setup failed:', error));

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(error => console.error('Morning Box service worker registration failed:', error));
  });
}

/* Prices are set by Morning Box in Admin. Use the last known prices straight away,
   then the server's current ones before the first screen renders (max 2.5 s). */
const PRICE_CACHE = 'morningbox.pricing';
try { const c = JSON.parse(localStorage.getItem(PRICE_CACHE) || 'null'); applyPricing(c?.pricing ?? c); setLibrarySettings(c?.library); applyMenu(c?.menu); applyAreas(c?.areas); } catch { /* storage blocked */ }
const pricing = Promise.race([
  fetch('./api/config').then(r => r.json()).then(c => {
    applyPricing(c.pricing);
    setLibrarySettings(c.library);
    /* Menu rules set in Admin (food items, breakfasts, priority) — the engine recommends from these. */
    applyMenu(c.menu);
    applyAreas(c.areas);
    try { localStorage.setItem(PRICE_CACHE, JSON.stringify({ pricing: c.pricing, library: c.library, menu: c.menu, areas: c.areas })); } catch { /* storage blocked */ }
  }),
  new Promise(resolve => setTimeout(resolve, 2500))
]).catch(() => {});

pricing.then(() => ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <StoreProvider>
        <App />
      </StoreProvider>
    </HashRouter>
  </React.StrictMode>
));
