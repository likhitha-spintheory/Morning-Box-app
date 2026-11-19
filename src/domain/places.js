/* Delivery area check by place name (client feedback FLW-023): shared by the app (instant message on the Delivery
   step) and the server (refuses the order). An address whose building / street text names a known Dubai place in a
   different area than the one chosen is refused, e.g. "Azizi Riviera 46" with Area = DIFC.
   Only distinctive names are listed, so ordinary building names never trigger it. Add names here as new areas open. */
import { ACTIVE_AREAS, SERVICE_AREAS } from './standards.js';

/* Names that identify each service area (used to spot an address in another area). */
const AREA_NAMES = {
  DIFC: ['difc', 'dubai international financial centre', 'dubai international financial center', 'gate village', 'the gate building', 'index tower', 'burj daman', 'icd brookfield', 'liberty house', 'limestone house', 'central park towers', 'sky gardens', 'park towers difc'],
  'Downtown Dubai': ['downtown dubai', 'downtown', 'burj khalifa', 'dubai mall', 'boulevard plaza', 'mohammed bin rashid boulevard', 'souk al bahar', 'old town', 'opera district', 'dubai opera', 'burj views', 'south ridge', 'the lofts', 'act one act two', 'burj royale', 'vida residence downtown', 'address downtown', 'emaar square'],
  'Meydan One': ['meydan', 'azizi riviera', 'riviera', 'sobha hartland', 'hartland', 'district one', 'mbr city', 'mohammed bin rashid city', 'nad al sheba', 'meydan one']
};
/* Dubai and UAE places outside every service area. */
const OUTSIDE = [
  'business bay', 'dubai marina', 'marina', 'jlt', 'jumeirah lake towers', 'jumeirah lakes towers', 'jbr', 'jumeirah beach residence',
  'palm jumeirah', 'the palm', 'deira', 'bur dubai', 'karama', 'al barsha', 'barsha', 'tecom', 'internet city', 'media city',
  'knowledge park', 'al quoz', 'jvc', 'jumeirah village', 'jvt', 'motor city', 'sports city', 'arabian ranches', 'silicon oasis',
  'mirdif', 'al nahda', 'qusais', 'festival city', 'creek harbour', 'dubai creek harbour', 'dubai hills', 'city walk', 'al wasl',
  'satwa', 'al jaddaf', 'jaddaf', 'healthcare city', 'al furjan', 'discovery gardens', 'dubai south', 'international city',
  'umm suqeim', 'al sufouh', 'al mankhool', 'oud metha', 'garhoud', 'al rigga', 'al barari', 'dubailand', 'al warqa',
  'muhaisnah', 'rashidiya', 'al mizhar', 'damac hills', 'town square', 'emirates hills', 'jumeirah golf estates',
  'sharjah', 'abu dhabi', 'ajman', 'ras al khaimah', 'umm al quwain', 'fujairah', 'al ain'
];

/* Approximate boundaries for the coordinate check on the server (degrees; confirm with operations before relying on
   them for a new area). DIFC: Sheikh Zayed Rd / Al Saada St / Financial Centre Rd; Downtown: around Burj Khalifa and
   the Boulevard; Meydan One: Meydan / MBR City District One. */
export const AREA_BOUNDS = {
  DIFC: { south: 25.2055, north: 25.2195, west: 55.2745, east: 55.2875 },
  'Downtown Dubai': { south: 25.1850, north: 25.2050, west: 55.2620, east: 55.2900 },
  'Meydan One': { south: 25.1430, north: 25.1800, west: 55.2850, east: 55.3250 }
};

const norm = s => ` ${String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const has = (text, name) => text.includes(` ${name} `);

/** Client wording, listing the areas that are active (Admin → Company → Delivery areas). */
export function areaMessage() {
  const l = ACTIVE_AREAS.map(id => (id === 'DIFC' ? 'DIFC' : SERVICE_AREAS.find(a => a.id === id)?.label || id));
  const list = l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l[0];
  return `Sorry, Morning Box is currently available for delivery in ${list} only. More areas are coming soon!`;
}

/** The area a piece of address text names: an area id, 'outside', or null when it names no known place. */
export function placeArea(text) {
  const t = norm(text);
  for (const [area, names] of Object.entries(AREA_NAMES)) if (names.some(n => has(t, n))) return area;
  return OUTSIDE.some(n => has(t, n)) ? 'outside' : null;
}

/** Problem with an address ({ building, unit|office, notes, area }): { code, message } or null. */
export function placeProblem(a) {
  if (!a) return null;
  const named = placeArea([a.building, a.unit, a.office].filter(Boolean).join(' , '));
  if (!named || named === a.area) return null;
  if (named === 'outside' || !ACTIVE_AREAS.includes(named)) return { code: 'area_unavailable', message: areaMessage() };
  const label = SERVICE_AREAS.find(x => x.id === named)?.label || named;
  return { code: 'area_mismatch', message: `This building looks like it’s in ${label}. Choose ${label} as the area, or check the building name.` };
}
