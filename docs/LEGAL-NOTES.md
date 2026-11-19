# Legal pack: what was filled in or adapted (for counsel to confirm)

Source: `Morning_Box_Legal_Documents.zip` (documents dated 2 November 2026). Published text: `src/legal/documents.js`.
The drafts carry "Draft for review by UAE-qualified counsel"; that internal note is not shown on the public pages.

## Bracketed placeholders and how they were filled

| Document | Placeholder | Filled with | Where it comes from |
|---|---|---|---|
| Terms §1, Privacy §1 | operator, address | Studio Nest L.L.C-FZ, Meydan Grandstand, 6th Floor, Nad Al Sheba, Dubai | the drafts; `MB_LEGAL_NAME`, `MB_ADDRESS` |
| Terms §1 | [licence number] | omitted until set | `MB_LICENCE_NO` |
| Terms §1, Refunds §7 | [support email / phone / hours] | info@morningbox.ae, phone if set, 7:00 AM – 9:00 PM every day | `MB_SUPPORT_EMAIL` (fallback info@morningbox.ae), `MB_SUPPORT_PHONE`, `MB_SUPPORT_HOURS` |
| Terms §3 | Arabic version [available / to be published] | "will be published" | — |
| Terms §7 | payment provider [name] | Stripe | `server/payments.js` |
| Terms §7 | [Confirm with your tax adviser who issues the VAT invoice…] | removed from the public text | internal note; see Invoices below |
| Terms §10, Refunds §3 | [24] hours, [1 business day], [5 business days] | 24 hours, 1 business day, 5 business days | values proposed in the draft |
| Terms §18 | [14] days | 14 days | draft value |
| Refunds §2 | [7:00 AM] | 7:00 AM | draft value |
| Refunds §3 | [30] minutes | 30 minutes | draft value |
| Refunds §5 | [2] / [5–14] business days | 2 / 5–14 business days | draft values |
| Refunds §6 | windows [7:00–8:00 AM] [8:00–9:00 AM] | the app's real windows: 7:30–8:30, 8:30–9:30, 9:30–10:30 AM | `DELIVERY_WINDOWS` |
| Refunds §6 | tracking by [push / SMS / WhatsApp / email] | "shown in the app, and your order confirmation is sent by email when you give an email address" | what the app actually sends today |
| Privacy §1 | [privacy email], [DPO] | privacy email = support email unless set; DPO omitted until set | `MB_PRIVACY_EMAIL`, `MB_DPO` |
| Privacy §2 | retention [6 months] [5 years] [3 years] [12 months] | draft values; app analytics added at 13 months (purged automatically) | draft; `server/index.js` |
| Privacy §4 | Delivery Partner [name] | "the Partner Bakery or Delivery Partner delivering your order" | at launch bakeries deliver their own orders |
| Privacy §4 | technology providers [names] | UltaHost (hosting), Resend (email codes), Meta WhatsApp (mobile codes), Google Maps (tracking map); notifications, support and analytics are first-party | the app's integrations |
| Privacy §5 | [countries], allergy data region | the server itself (all account, order and allergy data) is hosted by UltaHost in New York, USA; Stripe, Resend, Meta, Google may also process data in the EU/US. **Counsel: confirm the PDPL basis for this transfer, or move hosting to a UAE region.** | `MB_HOSTING_PROVIDER`, `MB_DATA_REGION` |
| Privacy §6 | [Account > Privacy] [confirm feature is live] | Profile › Privacy & data (download data, cookie settings) plus allergy filtering, offers and account deletion in Profile; all live | `src/screens/personal/Account.jsx` |
| Privacy §8 | [encryption at rest] | not claimed (the database is not encrypted at rest); listed: TLS, restricted server access, one-time-code sign-in, hashed sessions | — |
| Cookie notice table | [confirm] names and durations | the real storage: `mb_session` cookie (30 days), `morningbox.app.v1`, `morningbox.pricing`, `morningbox.consent` (12 months), app cache, session storage for the welcome screen, first-party analytics with consent; no marketing pixels | the app's code |
| Cookie notice | [Account > Privacy > Cookie settings] | Profile › Privacy & data › Cookie settings, and "Cookie settings" in the home page footer | — |
| Part B2 | by [email / push / SMS] | email | the only marketing channel the app has |

## Wording adapted to how the app works (please confirm)

1. **Bakery named before payment.** The drafts (Terms §1 and §6) say the Partner Bakery's name is shown "on the product page and at checkout before you confirm an order". In the app the customer never chooses a bakery. Morning Box assigns it automatically (MB-PRD-001 §10), and the assignment becomes final at the 9:00 PM cutoff. The text now says the bakery is assigned automatically and named in the order details once assigned. If the law requires the seller's name before payment, the app would need to show the provisional bakery at checkout.
2. **"Accepted" vs "Confirmed".** Terms §6 says a contract forms when the order shows as "Accepted". The app's status after payment is "Confirmed", so the text uses "Confirmed".
3. **Delivery Partner.** The app has no separate courier at launch: Partner Bakeries deliver their own orders. The Terms definition adds: "Where a Partner Bakery delivers its own orders, it acts as the Delivery Partner."
4. **Invoices (client feedback FLW-044).** The Partner Bakery is the seller on receipts and invoices; Morning Box is the platform and Studio Nest L.L.C-FZ the platform operator, collecting payment as the bakery's agent. A document is titled "Tax Invoice" only when every bakery on it has a TRN entered in Admin. Whether Studio Nest may issue invoices on the bakeries' behalf must be confirmed by the accountant and the bakery agreements (as the client noted).
5. **Short allergy consent (B1) on the profile step.** At the client's request (19 Nov) the profile step shows one unticked checkbox with shortened wording: "I agree that Morning Box may use my allergy and dietary details to filter my breakfasts and share them with the bakery preparing my order." It links to the Privacy Policy and Allergen information, which carry the full B1 points (health data, no allergen-free guarantee, withdrawal in the Morning Profile). Counsel: confirm the short form is enough for explicit consent under the PDPL, or the full B1 text has to be shown.
6. **Initial service area.** The drafts say DIFC; Admin can switch on Downtown Dubai and Meydan One. The text keeps "initially DIFC" and says the checkout shows which areas are covered.

## Consent records

Every choice is stored in `consent_log` (kind, value, version, date and time): terms acceptance at each new terms version, allergy/dietary consent and withdrawal, marketing opt-in/out, and device-storage choices (anonymous until signed in). The customer's history is included in "Download my data".
