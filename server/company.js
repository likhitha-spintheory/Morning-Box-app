/* Company details shown in the app, on receipts and in the legal pages.
   Set these environment variables before launch. */
export const SUPPLIER = {
  name: process.env.MB_LEGAL_NAME || 'Morning Box',
  trn: (process.env.MB_TRN || '').replace(/\D/g, ''),
  address: process.env.MB_ADDRESS || 'DIFC, Dubai, United Arab Emirates'
};
export const VAT_RATE = Number(process.env.VAT_RATE ?? 0.05);   // prices are VAT-inclusive

/* Customer support contacts. Empty values are hidden in the app. */
export const SUPPORT = {
  email: process.env.MB_SUPPORT_EMAIL || '',
  phone: process.env.MB_SUPPORT_PHONE || '',
  whatsapp: (process.env.MB_SUPPORT_WHATSAPP || '').replace(/\D/g, ''),
  hours: process.env.MB_SUPPORT_HOURS || '7:00 AM – 9:00 PM, every day'
};

/* Bump when the Terms or Privacy Policy change: customers accept the new version at their next sign-in. */
export const TERMS_VERSION = process.env.MB_TERMS_VERSION || '2026-10-11';
