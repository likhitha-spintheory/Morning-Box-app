# Morning Box — requirements cross-check (11 Oct 2026)

Checked against every document in `extracted/Morning Box Data/` (Master Plan v1.1, MB-PRD/USR/FLW/PER/DSN/REC/BOX/PRO/DLV/OPS/BKY/B2B-001, Competitive Landscape) and the two images (logo, home-page concept). Each item was verified in the code, not assumed.

Legend: ☐ to do · ⚠ decision needed · 🔵 needs third party · 🟡 needs client content/decision

---

## 1. Built against the client's specs — reverted 12 Oct 2026 ✅

| # | Was | Now (matches spec) | Spec ref |
|---|---|---|---|
| C1 | Remove any item / Put back | Removed. Box keeps every item; server refuses a shorter box | BOX-001 §1, §7 |
| C2 | "Add an item" from the whole library | Removed. Add-ons are Bread and Pastry only (`ITEM_PRICES` deleted) | PRO-001 §14, BOX-001 §6 |
| C3 | Multi-select "Change" sheet | Single-choice **Swap** sheet, same price, one item replaces one item | BOX-001 §1, §5 |
| C4 | Extras skipped Eating Style | Gone with C2 | REC-001 §4.1 |
| C5 | Extras skipped combination rules | Gone with C2 | PRO-001 §11–12 |
| C6 | Poorly rated breakfast moved behind the alternative | Removed. Same inputs → same recommendation (tested) | REC-001 §1.4, §14 |
| C7 | 1–5 stars, tags, free-text note, NPS, public averages | **Loved it / Not for me** + optional predefined reason; ops shows counts | PRD §12 |
| C8 | Swap before Size | **Kept** — this order is the client-approved design (style-1 P09 → P11); FLW §5 also puts Swaps on the recommendation screen | FLW §5 |
| C9 | Approved copy removed | Restored: Eating Style descriptions, "not a medical classification", Daily Context purposes, safety / size / same-day lines | PER-001 §1–2 |
| C10 | Hard cap 120 people | Removed. Capacity (window + bakery) is checked before payment | DLV-001 §8 |
| C11 | One-tap reorder picked the date | "Have it again" opens the date picker; customer chooses dates | FLW §10 |
| C12 | Delivered point assumed from preference | Ops must choose the actual handover point (Reception / Door / In person / Contact person) | DLV-001 §10 |
| C13 | Business edit changed total without settlement | Difference recorded (`business_payment_adjustments`) and customer notified | B2B-001 §8, §10 |

A backup of the code before this revert is in the session scratchpad (`backup-before-revert`).

---|---|---|---|---|
| C1 | Remove any item from the box / Put back | "No Remove: there is no independent Remove action" | BOX-001 §1, §7 | Remove, or get written client approval |
| C2 | "Add an item": any of ~35 library items as paid extras (ITEM_PRICES) | "MVP Add-ons are limited to Bread and Pastry"; "not a build-your-own menu" | PRO-001 §14, BOX-001 §6, REC-001 §12, PRD §7.2–7.3, Master Plan §2/§4, USR §5, FLW §5 | Remove, or get approval and fix C4–C5 |
| C3 | Multi-select "Change" sheet (eggs **and** omelette) | "Only one item replaces the original"; "Swap does not add another component" | BOX-001 §1, §5 | Back to single-choice swap, or approval |
| C4 | Extras skip the Eating Style check — Health-Conscious users can add bacon/sausage | "Customization cannot bypass eligibility rules" | REC-001 §4.1, §9, §16 | Fix if C2 is kept (use `isComponentEligible`) |
| C5 | Extras skip combination rules — honey on the "no added sweetener" PB sandwich, beans with a sandwich, duplicates | "Combination Compatibility Filter must prevent unsuitable combinations" | PRO-001 §11, §12.1, §12.4 | Fix if C2 is kept |
| C6 | Poorly rated breakfast moved behind the alternative | "Same inputs → same recommendation"; "don't change rules from a single feedback event" | REC-001 §1.4, §14; PRD §7.4; Master Plan §4 | Remove (Plan.jsx DailyContext) |
| C7 | 1–5 stars, tags, NPS card, public average ratings on boxes | Feedback is "Loved it / Not for me" + reason; no ratings/surveys in the UI | PRD §12; DSN §1, §9 | Revert, or client approval |
| C8 | Step order: Swap on the box screen, then Size + Extras | Size → Swap → Add-ons | FLW §2, §5 | Move Size before swaps, or approval |
| C9 | "Less text" cleanup removed approved copy: Eating Style descriptions, Preference titles, Daily Context purpose lines | Spec gives this exact text | PER-001 Q1/Q2, §2 | Restore (text still sits in `standards.js`) |
| C10 | Business headcount hard-capped at 120 per delivery, shown as "Up to 120" | No fixed maximum in v1.0; limit by real capacity | DLV-001 §8 | Show as capacity, not a fixed rule |
| C11 | One-tap "Same breakfast tomorrow" picks the date itself | Reuse copies to **explicitly selected** dates | FLW §10 | Let the customer confirm the date, or approval |
| C12 | Delivered point (Reception/Door) taken from the customer's preference | "Handover is delivery" — record the actual point | DLV-001 §10 | Courier/ops picks the actual point |
| C13 | Business edits change the total but no charge/refund is recorded | Re-price and settle on edit | B2B-001 §10 | Record adjustment like personal orders |

> C1–C3 and C7 were built on your instruction in this project. They're good customer features, but they break rules the client wrote down. Either remove them or get the client's written OK that amends the specs.

---

## 2. Previously missing — built 12 Oct 2026 ✅

**Admin (ops console → Admin tabs)**
- ✅ Bakeries: add, edit, status Active / Under Review / Suspended with reason and history, stated vs effective capacity, allergy capabilities, approved products, Fruit Danish variants, contact, temporary conditions per date, Bakery View access code (BKY §6, §10)
- ✅ Prices: price levels (with the breakfasts in each), Light/Large adjustments, bread and pastry add-ons, business discount tiers, "prices are indicative" switch, change history — used by server and app (BOX §8, B2B §7)
- ✅ Company & support details: legal name, TRN, address, support email/phone/WhatsApp/hours

**Operations / bakery / delivery**
- ✅ Final allocation runs automatically at 9:00 PM; respects status, conditions, products, Danish variants, effective capacity (OPS §1–2)
- ✅ Bakery View (`#/bakery`, own access code): production view, packing view, labels, Confirm plan / Report issue, In Preparation → Ready (QC, packed, labelled), Report delay, Unable to fulfil, temporary conditions (OPS §3–5, BKY §6–7)
- ✅ Courier pickup with box + special-box count; mismatch blocks dispatch and opens an exception; Picked Up → Out for Delivery → Delivered with point and recipient type (OPS §6–7, DLV §10)
- ✅ Failed delivery with reason and attempts; re-attempt (DLV §6)
- ✅ Reallocate to next eligible bakery (OPS §4)
- ✅ Service recovery: No Financial Action / Credit / Partial Refund / Full Refund; credit used automatically at checkout (OPS §10, DLV §11)
- ✅ Live dashboard: On Track / Attention Required / Late / Failed; bakery plan confirmations (OPS §5, §8)
- ✅ "At risk of being late" warning to the customer before the window ends (DLV §6)
- ✅ Exceptions: Safety first, owner / action / cause / responsible party, log form, resolution required (OPS §8)
- ✅ Reports: daily snapshot (delivered, on time, late, failed, refunds, credits, exceptions by category, business), partner performance, reconciliation mismatches, recommendation KPIs and funnel (OPS §9, §11; Master Plan §15)
- ✅ Labels with "Morning Box", size, add-ons, ready-by; readable allergy names (BKY §5)
- ✅ Engine test matrix: 1,920 profiles — determinism, safety, branch, swaps, add-ons (Master Plan §13)

**Customer app**
- ✅ Review shows the delivery address when it covers all dates (FLW §9)
- ✅ "Prepared by [Bakery]" after allocation, personal and business (FLW §17)
- ✅ Business: confirm-allergies-with-attendees note (Master Plan §5)
- ✅ Business: Customize Each Day — own boxes and Special Breakfasts per date (FLW §14)
- ✅ Business order details: delivery tracking
- ✅ Business confirmation mentions the tax invoice only when one was requested
- ✅ "Another option" never repeats the same breakfast (REC §8)
- ✅ Fruit Danish flavour (Apple / Berry / Apricot) limited to what partner bakeries make (PRO §14.2)
- ✅ "Indicative pilot price" label while Admin → Prices says so
- ✅ "Packaging issue" in Report a problem (OPS §10)
- ✅ Active date pills on the Box and Extras screens when planning several mornings (FLW §4)
- ✅ Touch targets ≥44px (the × and NPS buttons were removed)

## 2b. Second full re-audit — built 12 Oct 2026 ✅

**Recommendation & product (REC / BOX / PRO)**
- Ready-to-eat / no-cutlery boxes can't take loose fruit by swap; plant butter + peanut butter blocked
- Bakery sheets show portions per size, the ready-to-eat format, hot/cold and add-on packing rules
- "Other allergies" reaches the bakery; trace records Your Morning Box, Another Option and which was chosen; no-match recorded with inputs + reason code
- Fruit Danish inside a box gets an approved flavour; Fruit Danish hidden when no bakery makes one
- SAMPLE items behind an Admin switch (off by default in production)
- Box name typo fixed; "Halal Chicken Breakfast Sausage"

**Allocation & fulfilment (OPS / DLV / BKY)**
- Capacity reserved at order and edit time with the full allocation rules (products, allergies, Danish, conditions); provisional allocation as orders arrive, Final at 9 PM; started orders never move; plan re-confirmation when it changes
- Business orders split by line when needed; each bakery sees only its share and hands over its own part; dispatch only when every part is handed over
- Plan must be confirmed before production; itemised final check (order, components, size, add-ons, allergy, packaging, labels) before Ready
- Courier/route assigned the night before (per order or whole window) and required at pickup; ready-by lead time per bakery
- Late = delivered after the window (service-failure exception); "at risk" is a separate warning, also for orders out for delivery
- Unable to fulfil (reason from the standard list) → automatic reallocation, otherwise automatic full refund and the customer is told
- Suspending a bakery moves its unstarted orders; bakery sheets/labels carry Order ID, breakfast, size and allergy only (no names/addresses)
- Onboarding: licence, "bakes own bread" required for Active, sample results per product, verified corrective action before returning to Active, open safety incidents flagged
- Admin: delivery capacity per window, delivery cost, bakery payout %
- Reports: finance (payments, refunds, bakery payable, delivery cost, margin), completed with proof of delivery, partner metrics incl. business (ready on time, accuracy, quality), courier/route metrics, retention, B2B, on time by window, AOV, demand funnel
- Customer complaints linked to the responsible bakery or route; order-accuracy and packaging categories

**Customer & business app**
- Client's wording used verbatim (eating styles, preference titles, Q3, morning types)
- Home shows "Your Morning Box" for the next open morning with Order / Another option / Edit preferences
- Morning type learned per weekday (no blind preselection); last size remembered; single feedback reason
- "Prepared by" on confirmation after final allocation; tracking shows missed delivery / not prepared / refunds
- Reuse any past plan; "same weekdays next week" shortcut
- Business: per-day location & contact; per-day editor (add model, change size, add/edit/remove Special Breakfasts) before ordering and when managing; headcount gap shown with "Match my headcount" and charge/refund preview; invoice shows payments, edit charges and refunds; report a problem; reorder any past order (keeps each day's boxes); price summary on Choose Your Boxes; tax invoice off by default; no pre-chosen window; no-match leads to the team and is counted as an inquiry
- "Business Breakfast" entry label; ticks on selected options; 44px controls

Kept as approved by the client: Swap before Size (approved design), Special Breakfasts asked before box selection in the business flow.

## 3. Waiting on client 🟡 or third party 🔵

- 🔵 Payment gateway (card / Apple Pay / Google Pay), real refunds — Master Plan §16, FLW §9, B2B §8
- 🔵 SMS for sign-in codes and order updates; email for confirmations and business invoices (the app says "sent to email")
- 🔵 Courier company integration, routing, GPS, proof-of-delivery photo (the Bakery View is built)
- 🟡 Real prices and discount tiers — enter them in Admin → Prices (placeholders until then)
- 🟡 12-hour change window (Master Plan §3) vs 9 PM cutoff (DLV §2) — documents disagree; confirm
- 🟡 Verified ingredient and allergen records per item; loaf weights; approve or remove the "SAMPLE" gluten-free/vegan items (PRO §15.1)
- 🟡 Real bakeries, audits, capacities and Danish variants — enter them in Admin → Bakeries
- 🟡 Box photography, compact logo/wordmark, legal review; company details/TRN and WhatsApp go in Admin → Company

---

## 4. Done in advance (beyond the documents)

Harmless extras:
- Legal pages, Terms acceptance; Help & Support with replies; notification centre
- Receipts with VAT, .ics calendar, order activity history, share an order
- Safety hold when a profile changes; "Other allergies" note to ops; gluten-free certified bakeries
- Operations console: deliveries, prep list, labels, support inbox, ratings, exceptions, closed days, running late, reports + CSV, backups
- Account deletion and data export, PO number, saved business plans, Android app with release build, offline/update banners, idempotent payments, server re-pricing

Previously ahead of spec and conflicting (free customisation, stars/NPS, rating-based reordering) — now reverted, see section 1.

Design note: the home-page image in the folder is a desktop website concept (top menu, DIFC selector, trust strip, "more areas coming soon"). The app follows the mobile design the client already approved; a desktop marketing site isn't built.

---

## 5. Summary

| | Count |
|---|---|
| Spec requirements done | most of the customer, business and recommendation rules |
| Built but conflicting with spec | 0 (13 reverted on 12 Oct) |
| Missing, buildable now | 0 (built 12 Oct) |
| Waiting on client / third party | 9 groups |

Core is in place and matches the specs: 32 base recommendations, safety-first engine, swap groups, sizes, bread/pastry add-ons, 9 PM cutoff, windows, capacity, business flow (mix, specials, discount, invoice), allocation logic, exceptions.
