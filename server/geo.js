/* Delivery area validation (client feedback FLW-023, high priority).
   The Area dropdown alone is not proof of where an address is: "Azizi Riviera 46" with Area = DIFC used to reach
   Review & Pay. Two checks, both on the server (the app runs the same check before Review, and every order and
   address change is checked again before payment):
     1. Place names (always on, no external service): a building or street that names a known Dubai place in a
        different area (Meydan, Business Bay, Marina, …) is refused. The rule itself lives in src/domain/places.js.
     2. Coordinates (when GOOGLE_MAPS_SERVER_KEY is set): the address is geocoded with the Google Geocoding API and a
        precise result must fall inside an active area's boundary. Results are cached in the database. Imprecise
        results (only a district or the city) never refuse an address on their own; check 1 still applies. */
import { db } from './db.js';
import { ApiError } from './rules.js';
import { ACTIVE_AREAS, SERVICE_AREAS } from '../src/domain/standards.js';
import { AREA_BOUNDS, areaMessage } from '../src/domain/places.js';

db.exec(`CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY, lat REAL, lng REAL, precise INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const KEY = () => process.env.GOOGLE_MAPS_SERVER_KEY || '';
export const geocodingConfigured = () => !!KEY();

/* ~300 m allowance around each boundary so a building on the edge is not refused. */
const MARGIN = 0.003;
const inside = (b, lat, lng) => lat >= b.south - MARGIN && lat <= b.north + MARGIN && lng >= b.west - MARGIN && lng <= b.east + MARGIN;
/** The service area whose boundary contains the point, or null. */
export const areaAt = (lat, lng) => SERVICE_AREAS.find(a => AREA_BOUNDS[a.id] && inside(AREA_BOUNDS[a.id], lat, lng))?.id || null;

async function geocode(text) {
  const query = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const hit = db.prepare("SELECT lat, lng, precise FROM geocode_cache WHERE query = ? AND created_at > datetime('now', '-90 days')").get(query);
  if (hit) return hit.lat == null ? null : hit;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(`${text}, Dubai, United Arab Emirates`)}&components=country:AE&key=${encodeURIComponent(KEY())}`;
  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    data = await res.json();
  } catch (e) {
    console.error('[geo] geocoding failed:', e.message);
    return null;   // the service is down: don't block customers; the place-name check still ran
  }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') { console.error('[geo] geocoding:', data.status, data.error_message || ''); return null; }
  const r = data.results?.[0];
  /* Precise: a building or street address, not just a district/the city ("partial" matches are not trusted). */
  const precise = !!r && !r.partial_match && ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(r.geometry?.location_type)
    && r.types?.some(t => ['premise', 'subpremise', 'street_address', 'establishment', 'point_of_interest'].includes(t));
  const row = r ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng, precise: precise ? 1 : 0 } : { lat: null, lng: null, precise: 0 };
  db.prepare('INSERT OR REPLACE INTO geocode_cache (query, lat, lng, precise) VALUES (?, ?, ?, ?)').run(query, row.lat, row.lng, row.precise);
  return r ? row : null;
}

/** Coordinate check of one address ({ building, unit|office, area }). Throws area_unavailable / area_mismatch. */
export async function checkCoordinates(a) {
  if (!geocodingConfigured() || !a?.building) return;
  const g = await geocode(String(a.building).slice(0, 120));
  if (!g || !g.precise) return;
  const at = areaAt(g.lat, g.lng);
  if (!at || !ACTIVE_AREAS.includes(at)) throw new ApiError(400, 'area_unavailable', areaMessage());
  if (a.area && ACTIVE_AREAS.includes(a.area) && a.area !== at) {
    throw new ApiError(400, 'area_mismatch', `This building looks like it’s in ${SERVICE_AREAS.find(x => x.id === at).label}. Choose that area, or check the building name.`);
  }
}

/** Every delivery address in an order or change request body (personal and business shapes). */
export function addressesIn(body = {}) {
  const out = [];
  const add = x => { if (x && typeof x === 'object' && x.building) out.push(x); };
  add(body.address); add(body.delivery);
  for (const d of Array.isArray(body.days) ? body.days : []) { add(d?.address); add(d?.delivery); }
  return out.slice(0, 40);
}

/** Express middleware: coordinate-check the addresses in the request body before the handler runs. */
export const geoCheck = (req, _res, next) => {
  Promise.all([...new Map(addressesIn(req.body).map(a => [`${a.building}|${a.area}`, a])).values()].map(checkCoordinates))
    .then(() => next(), next);
};
