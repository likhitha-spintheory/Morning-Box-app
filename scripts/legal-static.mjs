/* Writes the legal pages for the coming-soon site (morningbox.ae/terms, /refunds, /privacy, /cookies, /allergens)
   into coming-soon/<id>.html from the same source the app uses (src/legal/documents.js).
   Caddy serves them with `try_files {path} {path}.html /index.html` (see README → Domains).
   Contacts come from the same environment variables as the server (MB_SUPPORT_EMAIL, MB_LEGAL_NAME, …). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalHtml, LEGAL_PAGES } from '../src/legal/documents.js';
import { DELIVERY_WINDOWS } from '../src/domain/standards.js';
import { SUPPLIER, SUPPORT, LEGAL } from '../server/company.js';

const out = join(import.meta.dirname, '..', 'coming-soon');
const ctx = { company: SUPPLIER, support: SUPPORT, legal: LEGAL, windows: DELIVERY_WINDOWS };
for (const [id] of LEGAL_PAGES) {
  writeFileSync(join(out, `${id}.html`), legalHtml(id, ctx, { appUrl: '/' }));
  console.log(`coming-soon/${id}.html`);
}
