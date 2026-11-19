/* Company details shown in the app, on receipts and invoices, and in the legal pages.
   Set these environment variables before launch. Defaults are the operator named in the legal pack. */
import { LEGAL_UPDATED } from '../src/legal/documents.js';

/* The platform operator (Morning Box is operated by Studio Nest L.L.C-FZ). On a food invoice the seller is the
   partner bakery; the operator appears as the platform operator (client feedback FLW-044). */
export const SUPPLIER = {
  name: process.env.MB_LEGAL_NAME || 'Studio Nest L.L.C-FZ',
  trn: (process.env.MB_TRN || '').replace(/\D/g, ''),
  address: process.env.MB_ADDRESS || 'Meydan Grandstand, 6th Floor, Nad Al Sheba, Dubai, United Arab Emirates',
  licence: process.env.MB_LICENCE_NO || ''
};
export const VAT_RATE = Number(process.env.VAT_RATE ?? 0.05);   // prices are VAT-inclusive

/* Customer support contacts. Empty values are hidden in the app (the legal pages fall back to info@morningbox.ae). */
export const SUPPORT = {
  email: process.env.MB_SUPPORT_EMAIL || '',
  phone: process.env.MB_SUPPORT_PHONE || '',
  whatsapp: (process.env.MB_SUPPORT_WHATSAPP || '').replace(/\D/g, ''),
  hours: process.env.MB_SUPPORT_HOURS || '7:00 AM – 9:00 PM, every day'
};

/* Privacy Policy contacts and providers. */
export const LEGAL = {
  privacyEmail: process.env.MB_PRIVACY_EMAIL || '',
  dpo: process.env.MB_DPO || '',
  hosting: process.env.MB_HOSTING_PROVIDER || 'UltaHost',
  /* Where the server (and so the database) is: UltaHost VPS, New York. Change if the server moves. */
  dataRegion: process.env.MB_DATA_REGION || 'the United States (New York)'
};

/* Bump when the Terms or Privacy Policy change: customers accept the new version at their next sign-in. */
export const TERMS_VERSION = process.env.MB_TERMS_VERSION || LEGAL_UPDATED;
