# Morning Box App

Customer web app **and backend API** for **Morning Box — Your Personal Breakfast Assistant**.
Visual design follows the **Style-2** screens, which implement MB-DSN-001 v1.0 (Morning Gold / Deep Espresso / Warm Ivory, DM Serif Display + Inter, pill CTAs, one primary action per screen).

## Run it

Requires Node 22.5+ (uses the built-in `node:sqlite`; no database server to install).

```bash
npm install
npm run dev        # API on :8787 (auto-restart) + web on http://localhost:5173 (proxies /api)
npm test           # API test suite (in-memory database)
npm run build      # build the web app into dist/
npm start          # production: API + built web app on http://localhost:8787
```

## Install on a phone

Morning Box is an installable Progressive Web App (PWA). Deploy it over HTTPS, open its URL in
your phone's browser, then choose **Install app** in Chrome/Android or **Share → Add to Home Screen**
in Safari/iOS. It opens from the home screen without browser controls. The app shell and previously
loaded static files are cached for startup offline; signing in, checking availability, and placing or
managing orders still need a connection to the API.

Data is stored in `data/morningbox.db` (override with `DB_FILE`). Other settings:
`PORT` (8787), `TZ` (defaults to Asia/Dubai — the 9:00 PM cutoff is Dubai time),
`WINDOW_CAPACITY` (boxes per delivery window per morning, default 120),
`OPS_KEY` (operations API key; `dev-ops-key` in development only — in production the operations API stays
disabled until a real key is set), `NODE_ENV=production` (hides the development OTP code and the demo status
endpoint, marks the session cookie Secure, sends HSTS), `TRUST_PROXY` (set behind a load balancer, e.g. `1`, so
sign-in rate limits see the real client IP).

Invoices: `MB_LEGAL_NAME`, `MB_TRN` (supplier TRN — the invoice is titled "Tax Invoice" only once this is set),
`MB_ADDRESS`, `VAT_RATE` (default `0.05`; prices are VAT-inclusive). Personal orders get the same receipt.
Help & legal: `MB_SUPPORT_EMAIL`, `MB_SUPPORT_PHONE`, `MB_SUPPORT_WHATSAPP`, `MB_SUPPORT_HOURS` (shown in Help when set),
`MB_TERMS_VERSION` (bump when the Terms or Privacy Policy change; customers re-accept in the app). The Terms,
Privacy, Refunds and Allergen pages are built in (`#/legal/...`); `VITE_TERMS_URL` / `VITE_PRIVACY_URL` replace
them with hosted versions. Have the legal text reviewed before launch.

Operations console: open `#/ops` and enter `OPS_KEY` — deliveries and status, bakery allocation, printable kitchen
prep list and box labels, support inbox, Loved it / Not for me feedback, exceptions, and closed days (public holidays).
Bakery View: open `#/bakery` with the bakery's own access code (issued in Admin) — its production plan, labels,
Confirm / Report an issue, In Preparation → Ready, delays and temporary conditions; no customer contact details.
Courier View: open `#/courier` with the courier's own access code — its route only, pickup counts, out for delivery,
handover point with an optional proof-of-delivery photo (never of the customer), running late and failed delivery.
Backups: `npm run backup` writes a consistent copy to `data/backups/` (keeps 14; `MB_BACKUP_DIR`, `MB_BACKUP_KEEP`).
The full product review and roadmap is in `docs/IMPROVEMENTS.md`.

Sign-in: one code per number every 30 s and 5 per hour; 5 tries per code and 10 failed tries per hour per number;
sessions live in an httpOnly cookie and expire after 30 days unused. The server queues evening drink reminders
and order notifications in the `notifications` outbox (`GET /api/me/notifications`) for an SMS/email/push provider.
Original full-size images are kept in `design/originals/`; `public/assets` holds the optimised copies.

## Android app (APK)

The Android app is a Capacitor shell around the same web app, so every screen, the session and the API
behave as on the web. It adds: the phone's Back button (follows each screen's back arrow; leaves the app
from Today/Home), login kept after the app is closed, invoices saved and shared via the Android share
sheet, the Morning Box icon and splash, and ivory system bars.

Requirements: Android SDK (Android Studio) and JDK 21 (`JAVA_HOME`).

```bash
npm run apk                                              # debug APK → apk/morning-box-debug.apk (emulator, local server)
MB_APP_URL=https://your-domain npm run apk:release       # signed release → apk/morning-box-release.apk + .aab (Google Play)
```

Release signing comes from the environment only (no key in the project): `MB_KEYSTORE`, `MB_KEYSTORE_PASSWORD`,
`MB_KEY_ALIAS`, `MB_KEY_PASSWORD`; versions from `MB_VERSION_CODE` (+1 for every Play upload) and
`MB_VERSION_NAME`. Create the upload key once and keep it safe — Google Play needs the same key for every update:
`keytool -genkeypair -keystore morningbox-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`.
Release builds require an `https://` app URL and have web debugging switched off. App ID: `ae.morningbox.app`
(change it in `scripts/apk.mjs` before the first Play upload).

## Backend API

| Area | Endpoints |
|---|---|
| Auth (MB-FLW-001 §7) | `POST /api/auth/otp` · `POST /api/auth/verify` · `POST /api/auth/logout` · `POST /api/auth/logout-all` · `POST /api/auth/change-mobile` |
| Me | `GET /api/me` · `PUT /api/me/profile` · `PUT /api/me/settings` · `GET /api/me/notifications` · `POST /api/me/notifications/read` · `DELETE /api/me` |
| Planning | `GET /api/availability?dates=…` · `POST /api/recommendations` |
| Personal orders | `GET/POST /api/orders` · `GET /api/orders/:id` · `PATCH /api/orders/:id/days/:date` · `POST …/cancel` · `POST …/feedback` · `POST …/issue` |
| Business (MB-B2B-001) | `POST /api/business/account` · `POST /api/business/quote` · `GET/POST /api/business/orders` · `PATCH …/days/:date` · `POST …/cancel` · `GET …/invoice` |
| Operations (`x-ops-key`) | `GET /api/ops/days?date=` · `POST /api/ops/allocate` · `POST /api/ops/days/:kind/:id/stage` · `GET/POST /api/ops/exceptions` · `GET /api/ops/bakeries` |

The server never trusts the browser: every order is re-run through the locked recommendation engine
(eligibility, allergens, swaps, add-ons), re-priced, checked against the 9:00 PM cutoff and delivery
capacity, and edits lock once a morning is in production. Business orders must have Total Boxes = Total People.
Bakery allocation is proximity-first with gluten-free handling eligibility; business orders use Single Bakery First
and split only when capacity requires it.

## What works

**Personal Breakfast** (MB-FLW-001 Part A)
Home → Morning Profile (Eating Style, Breakfast Preference, Dietary & Allergies) → Choose dates → Daily Context → Your Morning Box (deterministic recommendation, Swap within group, Size, Another option, optional extras on the same screen, safe No-Match) → Same as Previous Day / Different Morning → Weekly Summary → Sign-in with mobile + code, first name only for new numbers (registration only after value) → Delivery (same for all or per day, windows, capacity) → Review & Pay → Confirmation → Today (returning user: Plan, Use This Plan Again, Reorder) → My Orders → Tracking → Edit / Cancel before 9:00 PM cutoff → Loved it / Not for me → My Morning Profile.

**Business Breakfast** (MB-FLW-001 Part B, MB-B2B-001)
Number of people → Special Breakfast groups → Morning Box Mix or Choose Your Boxes (Model × Size × Quantity, volume discount) → Dates (same order or per day) → Business delivery → Business account → Review, tax invoice & pay → Confirmation → Manage order (Total Boxes = Total People validation, cancel a day) → Returning business user.

## Project structure

```
src/
  domain/          engine.js, library.js, recipes.js, standards.js — the locked
                   MB-REC / MB-PRO / MB-BOX logic from the MVP, used unchanged.
                   app.js — app helpers (dates, labels, pricing, tracking).
  state/store.jsx  Client state: draft plan before sign-in, cached session/orders (server is the source of truth).
  api.js           API client.
  components/ui.jsx  Shared design-system components and icon set.
  screens/         Home, personal/*, business/*
  styles.css       Design tokens and component styles (Style-2).
server/            Express API: auth, personal, business, ops; rules.js re-validates with the shared engine; db.js (SQLite schema).
tests/             API tests (node --test).
scripts/dev.mjs    Runs API + web together for development.
public/assets/     Approved logo and photography.
```

## Still to connect before launch

- **SMS for OTP**: codes are generated, stored and verified (10 min expiry, 5 attempts); in development the code is shown on screen. Plug an SMS provider into `server/auth.js`.
- **Payment gateway**: orders record a `demo_…` payment reference; authorise/charge and refund at the marked points in `server/personal.js` and `server/business.js`.
- **Staff accounts**: the operations console, Bakery View and Courier View are built; ops still signs in with one shared `OPS_KEY` (bakeries and couriers have their own codes). In development, "Demo: advance delivery status" on an order steps it through the stages.
- **Photo storage**: complaint and proof-of-delivery photos are small data URLs kept in SQLite; move them to file/object storage before scaling.
- **Prices**: indicative values from the MVP (`PRICE_LEVELS`, `SIZE_ADJUSTMENT`, `ADDON_PRICES`, `VOLUME_DISCOUNT` in `standards.js`). Final AED pricing is pending approval.
- **Partner bakeries**: seeded as placeholders (Partner Bakery A/B/C) until agreements are signed.
- **Special Breakfasts**: with the current approved library, some combinations (e.g. Gluten-Free, or Vegan + tree-nut allergy) have no safe breakfast; the app blocks them rather than weakening safety.
# morning-box
