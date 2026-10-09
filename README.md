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
`OPS_KEY` (operations API key, default `dev-ops-key` — change it), `NODE_ENV=production`
(hides the development OTP code and the demo status endpoint).

## Backend API

| Area | Endpoints |
|---|---|
| Auth (MB-FLW-001 §7) | `POST /api/auth/otp` · `POST /api/auth/verify` · `POST /api/auth/logout` |
| Me | `GET /api/me` · `PUT /api/me/profile` · `PUT /api/me/settings` |
| Planning | `GET /api/availability?dates=…` · `POST /api/recommendations` |
| Personal orders | `GET/POST /api/orders` · `GET /api/orders/:id` · `PATCH /api/orders/:id/days/:date` · `POST …/cancel` · `POST …/feedback` |
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
- **Ops & bakery screens**: the operations API exists (production list, allocation, status, exceptions); the staff UI is the next build step. In development, "Demo: advance delivery status" on an order steps it through the stages.
- **Prices**: indicative values from the MVP (`PRICE_LEVELS`, `SIZE_ADJUSTMENT`, `ADDON_PRICES`, `VOLUME_DISCOUNT` in `standards.js`). Final AED pricing is pending approval.
- **Partner bakeries**: seeded as placeholders (Partner Bakery A/B/C) until agreements are signed.
- **Special Breakfasts**: with the current approved library, some combinations (e.g. Gluten-Free, or Vegan + tree-nut allergy) have no safe breakfast; the app blocks them rather than weakening safety.
