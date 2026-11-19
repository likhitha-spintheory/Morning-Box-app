/* Device storage choice (legal pack 04: Cookie & Device Storage Notice, banner text B5).
   Essential storage is always on; app analytics run only after "Accept all" (or turning analytics on in Settings).
   The choice lasts 12 months, is kept on this device, and is also recorded on the server with its version and time. */
import { useEffect, useState } from 'react';
import { CONSENT_VERSION } from '../legal/documents.js';

const KEY = 'morningbox.consent';
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const CONSENT_EVENT = 'morningbox:consent';

/** { analytics, version, at } or null when the visitor hasn't chosen (or the choice expired / the text changed). */
export function storageChoice() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!c || c.version !== CONSENT_VERSION || !(Date.now() - c.at < YEAR_MS)) return null;
    return c;
  } catch { return null; }
}
export const analyticsAllowed = () => storageChoice()?.analytics === true;

/** Save the choice here and record it on the server (fire and forget). */
export function setStorageChoice(analytics) {
  const c = { analytics: !!analytics, version: CONSENT_VERSION, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage blocked: applies to this visit only */ }
  memory = c;
  window.dispatchEvent(new Event(CONSENT_EVENT));
  fetch('./api/consents', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ analytics: !!analytics }) }).catch(() => {});
}
/* When storage is blocked the choice still holds for this visit, so the banner doesn't keep coming back. */
let memory = null;
export const currentChoice = () => storageChoice() || memory;

/** The current choice, updated when it changes anywhere in the app. */
export function useStorageChoice() {
  const [c, setC] = useState(currentChoice);
  useEffect(() => {
    const on = () => setC(currentChoice());
    window.addEventListener(CONSENT_EVENT, on);
    return () => window.removeEventListener(CONSENT_EVENT, on);
  }, []);
  return c;
}

/** Ask the banner to open its Settings view (from Profile › Privacy & data or the home page link). */
export const openCookieSettings = () => window.dispatchEvent(new Event('morningbox:cookie-settings'));
