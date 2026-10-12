/* App configuration from the server (closures, support contacts, company details).
   Fetched once per app start and shared by every screen. */
import { useEffect, useState } from 'react';
import { get } from '../api.js';

const FALLBACK = { closedDates: [], support: {}, company: { name: 'Morning Box', address: 'DIFC, Dubai, United Arab Emirates' }, termsVersion: '' };
const cache = {};
function useShared(key, path, fallback) {
  const [value, setValue] = useState(cache[key]?.value ?? fallback);
  useEffect(() => {
    if (!cache[key]) cache[key] = { promise: get(path).then(v => (cache[key].value = v)).catch(() => { delete cache[key]; return fallback; }) };
    let live = true;
    cache[key].promise.then(v => { if (live && v) setValue(v); });
    return () => { live = false; };
  }, [key, path]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

export const useConfig = () => useShared('config', '/config', FALLBACK);

/** Reason a date is closed (public holiday etc.), or null. */
export const closedOn = (config, iso) => config.closedDates?.find(c => c.date === iso)?.reason || null;
