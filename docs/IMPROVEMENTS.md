# Morning Box — product review: 120 improvements

A review of Morning Box as a real, launched product: what a customer, the kitchen,
support, finance and the business need beyond "the screens work".

Status: ✅ built in this round · 🟡 needs a client decision or content · 🔵 needs a third-party service · ⬜ later

## 1. Legal, trust & compliance
| # | Improvement | Status |
|---|---|---|
| 1 | Terms of Service page in the app | ✅ |
| 2 | Privacy Policy page | ✅ |
| 3 | Refunds & Cancellations policy | ✅ |
| 4 | Allergen Information page (traces, cross-contact, what to do in a reaction) | ✅ |
| 5 | Sign-in records which Terms version the customer accepted, and when | ✅ |
| 6 | When Terms change, customers are asked to accept the new version | ✅ |
| 7 | Terms / Privacy links on sign-in, Home, Help and Profile | ✅ |
| 8 | "Contains: gluten, egg…" shown on every breakfast and order | ✅ |
| 9 | Company legal name, address and TRN on receipts and legal pages (env vars) | ✅ (🟡 client must supply) |
| 10 | Legal pages reviewed by the client's lawyer before launch | 🟡 |
| 11 | Age confirmation (18+) wording confirmed with the client | 🟡 |
| 12 | Food business licence / Dubai Municipality number shown in About | 🟡 |
| 13 | Calories / nutrition per breakfast (needs recipe data) | 🟡 |
| 14 | Halal certification statement | 🟡 |
| 15 | Arabic version of the legal pages | 🟡 |

## 2. Ratings, feedback & learning
| # | Improvement | Status |
|---|---|---|
| 16 | 1–5 star rating after delivery (replaces two-button feedback) | ↩ Reverted 12 Oct — PRD §12: Loved it / Not for me |
| 17 | Quick tags: Tasty, Fresh, Good portion, On time, Well packed | ↩ Reverted 12 Oct — PRD §12 |
| 18 | "What didn't work?" reasons after Not for me | ✅ |
| 19 | "How was your breakfast?" card on Today for the last unrated morning | ✅ |
| 20 | Tap Loved it / Not for me on Today → straight into feedback | ✅ |
| 21 | Feedback shown on orders ("Delivered · Loved it") | ✅ |
| 22 | Average rating on each breakfast once it has 3+ ratings | ↩ Reverted 12 Oct — PRD §12, DSN §9 |
| 23 | Breakfasts you rated poorly are no longer suggested first | ↩ Reverted 12 Oct — REC-001 §1.4, §14 |
| 24 | NPS question ("would you recommend us?") after the 3rd delivery, at most every 90 days | ↩ Reverted 12 Oct — PRD §12 |
| 25 | "Not now" on NPS snoozes it for 14 days | ↩ Reverted 12 Oct — PRD §12 |
| 26 | Feedback dashboard for the team (Loved it / Not for me + reasons) | ✅ |
| 27 | Not for me highlighted for follow-up | ✅ |
| 28 | Ask customers who loved it to rate the app on Google Play | 🔵 (Play In-App Review) |
| 29 | Rate individual items in the box | ⬜ |
| 29a | Customise the suggested box freely (remove, add any item, multi-select) | ↩ Reverted 12 Oct — against BOX-001 §1, §5, §7 |
| 30 | Photo with a complaint | ⬜ (needs file storage) |

## 3. Help & support
| # | Improvement | Status |
|---|---|---|
| 31 | Help & Support screen with 8 FAQs | ✅ |
| 32 | In-app contact form with topics | ✅ |
| 33 | Customer sees their messages and the team's replies | ✅ |
| 34 | Reply arrives as an in-app notification | ✅ |
| 35 | "Get help" on every order opens the form with the order number filled in | ✅ |
| 36 | Allergy messages go straight to the safety exception queue | ✅ |
| 37 | Spam limit (10 messages a day) | ✅ |
| 38 | Phone / email / WhatsApp / opening hours shown when configured | ✅ (🟡 client must supply) |
| 39 | 998 emergency reminder on allergy topics | ✅ |
| 40 | Live chat | 🔵 |
| 41 | Email copy of support replies | 🔵 |

## 4. Notifications
| # | Improvement | Status |
|---|---|---|
| 42 | Notification centre (bell on Today, unread dot) | ✅ |
| 43 | Tapping a notification opens the order or Help | ✅ |
| 44 | Messages use friendly dates ("Mon 12 Oct", not 2026-10-12) | ✅ |
| 45 | "Offers & news" opt-in, off by default | ✅ |
| 46 | Night-before reminder toggle renamed so it's clear | ✅ |
| 47 | Push notifications on the phone | 🔵 (Firebase Cloud Messaging) |
| 48 | SMS for "on its way" / "delivered" | 🔵 |
| 49 | Email confirmations & receipts | 🔵 |
| 50 | 8 PM "you haven't planned tomorrow" nudge for regular customers | ⬜ (needs push) |

## 5. Orders, receipts & calendar
| # | Improvement | Status |
|---|---|---|
| 51 | Receipt / tax invoice for personal orders (with VAT) | ✅ |
| 52 | Add to calendar (.ics) from confirmation and each order | ✅ |
| 53 | Order activity: placed, changed (what changed and the price), cancelled, prepared, out, delivered, rated, reported | ✅ |
| 54 | Refunds for cancelled mornings shown on the receipt | ✅ |
| 55 | Edit name in Profile | ✅ |
| 56 | Download my data (JSON) | ✅ |
| 57 | Support messages & NPS removed when an account is deleted | ✅ |
| 58 | App version shown in Profile | ✅ |
| 59 | Favourite breakfasts | ⬜ |
| 60 | Multiple saved addresses (home / office) | ⬜ |
| 61 | Skip a week / holiday mode | ⬜ |
| 62 | Gift a breakfast to a colleague | ⬜ |
| 63 | Promo codes & referral credit | 🟡 (touches payments) |
| 64 | Wallet / credits instead of card refunds | 🔵 |
| 65 | Subscription (auto-renewing weekly plan) | 🟡 (spec says "never a subscription") |
| 66 | Browse all breakfasts (menu) | 🟡 (spec says "not a menu") |

## 6. Operations (the team's side)
| # | Improvement | Status |
|---|---|---|
| 67 | Operations console at `#/ops` (needs the operations key) | ✅ |
| 68 | Deliveries per day, with one-tap status updates | ✅ |
| 69 | "Allocate bakeries" button | ✅ |
| 70 | Kitchen prep list per bakery (counts per breakfast, size, extras, specials) — printable | ✅ |
| 71 | Box labels with name, building, window, breakfast and ⚠ allergen warnings — printable | ✅ |
| 72 | Safety-hold orders highlighted | ✅ |
| 73 | Support inbox with reply / close | ✅ |
| 74 | Exceptions list with "Mark resolved" | ✅ |
| 75 | Closed days (public holidays): customers can't pick them, server refuses them | ✅ |
| 76 | Closing a day warns how many orders are already booked | ✅ |
| 77 | Daily database backup script (`npm run backup`, keeps 14) | ✅ |
| 78 | Courier app / driver view with proof of delivery photo | 🟡 delivery marked at Reception/Door from the console; photo needs file storage |
| 79 | Live courier location on the map | 🔵 |
| 80 | Bakery portal (partners update their own status) | ⬜ |
| 81 | Revenue & orders reports, CSV export for finance (console → Reports) | ✅ |
| 82 | Refunds issued from the console | 🔵 (payment gateway) |
| 83 | Team accounts with roles instead of one shared key | ⬜ |
| 84 | Ingredient stock / waste tracking | ⬜ |

## 7. Reliability & quality
| # | Improvement | Status |
|---|---|---|
| 85 | Friendly "Something went wrong" screen instead of a blank app on a crash | ✅ |
| 86 | "You're offline" bar | ✅ |
| 87 | "Can't connect" screen in the Android app instead of a blank page | ✅ |
| 88 | 9 new automated tests (29 total) | ✅ |
| 89 | Crash reporting | 🔵 (e.g. Sentry) |
| 90 | Usage analytics / funnel (where people drop off) | 🔵 |
| 91 | Uptime monitoring & alerts | 🔵 |
| 92 | Move SQLite to a managed database before scaling | ⬜ |
| 93 | Load test for the 7–9 PM ordering peak | ⬜ |
| 94 | "A new version is ready — Refresh" bar when a newer build is live | ✅ |
| 95 | iOS app (needs a Mac with Xcode + Apple developer account) | 🟡 |

## 8. Experience & content
| # | Improvement | Status |
|---|---|---|
| 96 | Less text on every screen; details behind ⓘ | ✅ |
| 97 | Real breakfast photos for each box | 🟡 (client photos) |
| 98 | Arabic language & right-to-left layout | 🟡 |
| 99 | Dark mode | ⬜ (design approval needed) |
| 100 | Larger-text / accessibility pass with a screen reader | ⬜ |
| 101 | Onboarding "how it works" in 3 slides | 🟡 |
| 102 | Haptic feedback on key taps | ⬜ |
| 103 | Pull to refresh on Orders | ⬜ |
| 104 | Sign in with Google / Apple | 🔵 |
| 105 | Remember the last delivery window per weekday | ⬜ |
| 106 | Weather-aware suggestion (hot day → fresh options) | 🔵 |
| 107 | "Running late" message with a new time (team sets it in the console; shown on the order and in notifications) | ✅ |
| 108 | Order for a colleague's address | ⬜ |
| 109 | Share an order summary (WhatsApp, Messages…) | ✅ |
| 110 | Home-screen widget "Tomorrow's breakfast" | ⬜ |

## 9. Business customers
| # | Improvement | Status |
|---|---|---|
| 111 | Closed days respected in the business date picker | ✅ |
| 112 | Per-person name labels for special breakfasts | ⬜ |
| 113 | Multiple team members on one company account | ⬜ |
| 114 | Monthly consolidated invoice | ⬜ |
| 115 | Pay by invoice / bank transfer (credit terms) | 🔵 |
| 116 | Purchase-order number on invoices | ✅ |
| 117 | Cost-centre reporting | ⬜ |

## 10. Launch checklist
| # | Improvement | Status |
|---|---|---|
| 118 | Payment gateway (card, Apple Pay, Google Pay) | 🔵 |
| 119 | SMS provider for sign-in codes | 🔵 |
| 120 | HTTPS hosting + Google Play listing (screenshots, privacy form, data safety) | 🟡 |

## Settings to fill in before launch
```
MB_LEGAL_NAME, MB_ADDRESS, MB_TRN           company details on receipts & legal pages
MB_SUPPORT_EMAIL, MB_SUPPORT_PHONE,
MB_SUPPORT_WHATSAPP, MB_SUPPORT_HOURS       contact options in Help
MB_TERMS_VERSION                            bump (e.g. 2026-12-01) when Terms/Privacy change
OPS_KEY                                     operations console key (required in production)
```

Free customisation (29a) and star ratings/NPS were reverted on 12 Oct 2026 to match the client's specs (see docs/REQUIREMENTS-CHECK.md §1).
