/* Morning Box legal documents (UAE), from the client's legal pack of 2 November 2026:
     01 Terms of Service · 02 Refunds, Cancellations & Delivery Policy · 03 Privacy Policy ·
     04 Cookie & Device Storage Notice (Part A; the Part B consent texts are in CONSENT below).
   The internal Data Protection Policy (05) is for staff and partners and is not published.

   One source for every place the documents appear: the in-app pages (#/legal/<id>), the public pages the
   server serves at /terms, /refunds, /privacy and /cookies, and the static copies for morningbox.ae
   (npm run legal:static). Pure JavaScript (no JSX), so the server and the build script can import it.

   Bracketed items in the drafts are filled from live settings (operator, licence, support and privacy
   contacts) or with the value the draft proposed. Places where the draft did not match how the app works
   were reworded to match the app; they are listed in docs/LEGAL-NOTES.md for counsel to confirm.

   Text markup: [[id|label]] links to another document (id = terms | refunds | privacy | cookies | allergens). */

export const LEGAL_UPDATED = '2026-11-02';

export const LEGAL_PAGES = [
  ['terms', 'Terms of Service'],
  ['refunds', 'Refunds, Cancellations & Delivery'],
  ['privacy', 'Privacy Policy'],
  ['cookies', 'Cookie & Device Storage Notice'],
  ['allergens', 'Allergen Information']
];

/* Part B — in-app consent texts, word for word from the legal pack (04, Part B). */
export const CONSENT = {
  healthTitle: 'Use my allergy and dietary information',
  health: 'I agree that Morning Box may store the allergy and dietary information I enter, use it to filter breakfast suggestions, and share the relevant details with the bakery preparing each order. This information may relate to my health. I understand that filtering does not guarantee food is allergen-free, and that I can withdraw this consent at any time in my Morning Profile.',
  healthAgree: 'I agree',
  healthOff: 'Allergy filtering is off. You can turn it on in your Morning Profile.',
  marketingTitle: 'Breakfast offers and news',
  marketing: 'Send me offers, new bakery launches and Morning Box news by email. I can unsubscribe at any time.',
  marketingAgree: 'Yes, send me offers',
  allergyReminder: 'Your allergy filter is on. Bakeries handle many allergens and cross-contact is possible. If your allergy is severe, contact support before ordering.',
  cookieBanner: 'We use essential storage to keep you signed in and save your plan. With your permission, we also use analytics to improve Morning Box.',
  withdrawn: 'Allergy data removed. Suggestions will no longer be filtered for allergies, and bakeries will not receive allergy notes for future orders.'
};
/* Bump when a consent text above changes; each recorded choice keeps the version it was given under. */
export const CONSENT_VERSION = '2026-11-02';

const DEFAULTS = {
  operator: 'Studio Nest L.L.C-FZ',
  address: 'Meydan Grandstand, 6th Floor, Nad Al Sheba, Dubai, United Arab Emirates',
  email: 'info@morningbox.ae',
  hours: '7:00 AM – 9:00 PM, every day'
};

/** Values the documents need, with the defaults from the legal pack. `ctx` is the app's /api/config shape. */
function values(ctx = {}) {
  const company = ctx.company || {};
  const support = ctx.support || {};
  const email = support.email || DEFAULTS.email;
  const operator = company.name && company.name !== 'Morning Box' ? company.name : DEFAULTS.operator;
  const address = company.address && !/^DIFC, Dubai/.test(company.address) ? company.address : DEFAULTS.address;
  const windows = (ctx.windows || []).map(w => (typeof w === 'string' ? w : w.label)).filter(Boolean);
  const contact = [`by email at ${email}`, support.phone && `by phone on ${support.phone}`].filter(Boolean).join(' or ');
  return {
    operator, address, shortAddress: address.replace(/, Nad Al Sheba/, ''), email,
    licence: company.licence || '',
    privacyEmail: ctx.legal?.privacyEmail || email,
    dpo: ctx.legal?.dpo || '',
    hours: support.hours || DEFAULTS.hours,
    contact,
    windows: windows.length ? windows : ['7:30 – 8:30 AM', '8:30 – 9:30 AM', '9:30 – 10:30 AM'],
    hosting: ctx.legal?.hosting || 'UltaHost',
    dataRegion: ctx.legal?.dataRegion || 'the United States (New York)'
  };
}
const list = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');

/* ---------- 01 · Terms of Service ---------- */
function terms(v) {
  return {
    title: 'Morning Box – Terms of Service',
    summary: 'These Terms govern your use of the Morning Box app and website. Food is sold to you by a licensed Partner Bakery; Morning Box runs the platform, takes your order and payment as the bakery’s agent, and coordinates delivery.',
    blocks: [
      { h: '1. Who we are' },
      { p: `Morning Box is a breakfast discovery, personalisation, ordering and delivery-coordination platform operated by ${v.operator}, ${v.address}${v.licence ? `, licence no. ${v.licence}` : ''} (“Morning Box”, “we”, “us”, “our”).` },
      { p: 'Morning Box is a platform intermediary. We do not manufacture, prepare or package food. Each item is offered and sold by an independent, appropriately licensed Partner Bakery. Morning Box assigns the Partner Bakery for each Order automatically, and its name is shown in your order details once it is assigned.' },
      { p: `You can reach us through Help & Support in the app, or ${v.contact}, ${v.hours} Dubai time.` },
      { h: '2. Key definitions' },
      { table: { head: ['Term', 'Meaning'], rows: [
        ['Platform', 'The Morning Box app, website and related services.'],
        ['Partner Bakery', 'An independent, licensed bakery or food establishment that prepares and sells food through the Platform.'],
        ['Delivery Partner', 'A courier or logistics provider that transports orders, engaged by Morning Box or a Partner Bakery. Where a Partner Bakery delivers its own orders, it acts as the Delivery Partner.'],
        ['Order', 'Your offer to buy one or more breakfasts for a stated date and delivery window, prepared by a Partner Bakery.'],
        ['Plan', 'A set of Orders across several selected dates, built in the app. Each date in a Plan is a separate Order.'],
        ['Morning Profile', 'Your saved preferences, dietary requirements and declared allergies used to tailor suggestions.'],
        ['Cutoff', '9:00 PM Dubai time (GST, UTC+4) on the day before delivery, unless a different time is shown before you pay.'],
        ['Platform Fee', 'The fee or commission Morning Box charges for its services, shown separately at checkout where it is charged to you.']
      ] } },
      { h: '3. Accepting these Terms' },
      { p: 'By creating an account or placing an Order, you agree to these Terms, our [[refunds|Refunds, Cancellations & Delivery Policy]], our [[privacy|Privacy Policy]] and our [[cookies|Cookie & Device Storage Notice]]. If you do not agree, do not use the Platform.' },
      { p: 'These Terms are an electronic contract, valid under UAE law on electronic transactions. You can download or save them at any time from the app. An Arabic version will be published; where the law requires the Arabic text to prevail, it does.' },
      { h: '4. Accounts and eligibility' },
      { ul: [
        'You must be at least 18 years old and legally able to enter into contracts. The Platform is not designed for, or directed at, children.',
        'You sign in with a one-time verification code sent to your email, or another method we offer. Never share your code. You are responsible for activity on your account unless it results from our fault or a security failure on our side.',
        'Tell us promptly through Help & Support if you suspect unauthorised use. We may pause the account while we investigate.',
        'Keep your contact details, delivery address and Morning Profile accurate. Wrong details may cause a failed delivery that is not our or the bakery’s fault.',
        'One person, one account. Business accounts are covered in section 12.'
      ] },
      { h: '5. Recommendations and product information' },
      { ul: [
        'Morning Box suggests breakfasts using your Morning Profile, declared dietary requirements and allergies, and daily context such as the date you selected. Suggestions are for convenience only. They are not medical, nutritional or dietary advice.',
        'Ingredients, allergens, nutrition, photos, portion sizes and availability are supplied and confirmed by the Partner Bakery. We take reasonable care to display that information accurately and to run our filters correctly, and we correct errors we become aware of.',
        'Photos are illustrative; handmade products can vary slightly in shape and decoration but not in the ingredients or allergens stated.',
        'Always read the product details before you order, especially if you have an allergy (see section 9).'
      ] },
      { h: '6. Placing an Order' },
      { ul: [
        'Choose your breakfasts, date(s) and delivery window, then review the checkout screen. It shows the items, the total in AED and the Cutoff before you pay.',
        'When you tap Pay, you make an offer to buy the breakfasts in your Order.',
        'A contract is formed only when the app shows the Order as Confirmed (or sends a confirmation message). A “received” or “submitted” screen is not acceptance.',
        'If a bakery declines or cannot fulfil an Order, we tell you as soon as possible and any amount taken is refunded in full, or you can choose an offered alternative.',
        'Each date in a Plan is a separate Order. Changes to one date do not affect the others.',
        'Orders must be placed before the Cutoff for the delivery date. Available dates and windows are shown at checkout.'
      ] },
      { h: '7. Prices, fees and payment' },
      { ul: [
        'All prices are in UAE Dirhams (AED) and include VAT at the applicable rate. Before you pay, checkout shows the food price, any delivery charge, any Platform Fee, any discount and the total. No other charges are added later.',
        'Agency. Morning Box collects payment as the authorised commercial collection agent of the Partner Bakery, through a licensed payment service provider, Stripe. Paying Morning Box discharges your payment obligation to the bakery. Morning Box keeps its agreed Platform Fee or commission.',
        'Card details are entered directly with the payment provider. We do not store full card numbers.',
        'You receive a dated electronic invoice or receipt showing the seller, the items, the price, VAT and any fees.',
        'Prices can change, but the price shown when you pay applies to that Order.',
        'If a price is obviously wrong (for example, a clear typing error), we will contact you before the Order is accepted; you may cancel for a full refund.',
        'Promotions apply only under their stated terms, cannot be exchanged for cash, and may be withdrawn if misused.'
      ] },
      { h: '8. Changes, cancellations, delivery and refunds' },
      { p: 'The full rules are in our [[refunds|Refunds, Cancellations & Delivery Policy]], which forms part of these Terms. In short:' },
      { table: { head: ['Situation', 'What happens'], rows: [
        ['You change or cancel before the Cutoff', 'Free; full refund to the original payment method.'],
        ['You change or cancel after the Cutoff', 'Preparation may have started, so a voluntary change or refund may not be possible.'],
        ['Bakery cannot fulfil an accepted Order', 'We notify you and give a full refund or an alternative you accept.'],
        ['Item missing, wrong, damaged, unsafe or not delivered', 'Report it in the app; you get a refund, replacement or other remedy required by law.'],
        ['Delivery fails because of wrong details or no one available', 'Treated as delivered if the courier followed your instructions; we will still help where we can.']
      ] } },
      { p: 'Delivery is available only in the areas and windows shown at checkout. The initial service area is Dubai International Financial Centre (DIFC). Some buildings restrict courier access; add clear handover instructions (lobby, reception, floor, contact number).' },
      { p: 'If an event outside anyone’s reasonable control (for example severe weather, road closures, official restrictions or a utility outage) prevents delivery, we will tell you promptly and refund any Order that cannot be delivered.' },
      { h: '9. Allergies, ingredients and food safety' },
      { ul: [
        'Each Partner Bakery is responsible for accurate ingredient and allergen information and for preparing, storing, packing and handing over food in line with UAE and Dubai food-safety rules.',
        'Morning Box uses your declared allergies and restrictions to hide or flag unsuitable items. Filtering depends on the bakery’s information and cannot rule out cross-contact in a kitchen that handles allergens. It is not a guarantee that any item is allergen-free.',
        'If you have a severe allergy, contact Help & Support before ordering so we can check with the bakery. Do not eat any item if you are unsure it is safe for you.',
        'Eat chilled or perishable items promptly and follow any storage note on the packaging. Food left unrefrigerated after handover is outside the bakery’s and our control.',
        'Report any suspected food-safety issue to us immediately and, in an emergency, call 999 or seek medical help first. We investigate every report with the bakery and inform the competent authority where required.'
      ] },
      { h: '10. Problems and complaints' },
      { ul: [
        'Report missing, wrong, damaged, unsafe, late or poor-quality items through Help & Support as soon as possible, ideally within 24 hours of delivery, with your Order number and photos where helpful. A later report is still considered; it may just be harder to investigate.',
        'Morning Box handles your complaint end-to-end. You do not need to chase the bakery or courier yourself.',
        'We acknowledge complaints within 1 business day and aim to resolve them within 5 business days.',
        'Remedies depend on the facts and on UAE consumer law and may include a refund, replacement, credit (only if you choose it) or other fair remedy.',
        'If you are not satisfied, you may contact the competent consumer-protection authority, such as the UAE Ministry of Economy or Dubai’s Department of Economy and Tourism (Consumer Rights).'
      ] },
      { h: '11. Who is responsible for what' },
      { table: { head: ['Party', 'Responsible for'], rows: [
        ['Morning Box', 'The Platform, recommendations and filters, accurate display of bakery information, order processing, payment collection as agent, customer support, delivery coordination, and its own acts and omissions.'],
        ['Partner Bakery', 'Food quality, recipes, ingredients, allergen information, hygiene, preparation, packaging, labelling and its food licences.'],
        ['Delivery Partner', 'Safe, timely transport and handover under the instructions given, including temperature control during its stage.'],
        ['You', 'Accurate details, reading product information, being available for delivery, and safe storage after handover.']
      ] } },
      { p: 'UAE law makes platform operators answerable to consumers for certain failures by sellers on their platform. Nothing in these Terms is used to avoid that. Morning Box will always handle your claim, put things right where you are entitled to a remedy, and then settle responsibility with the bakery or courier separately.' },
      { h: '12. Business and group orders' },
      { p: 'Office, meeting and group orders may be available with their own minimum quantities, lead times, prices and delivery arrangements, shown or agreed before you order. The person ordering confirms they are authorised to bind their organisation. A VAT tax invoice in the organisation’s name is issued where applicable. Consumer-only rights may not apply to purely business purchases, to the extent the law allows.' },
      { h: '13. Acceptable use' },
      { p: 'You must not: use the Platform for fraud or unlawful purposes; place fake Orders or abuse refunds or promotions; access another person’s account; scrape, reverse-engineer or overload the Platform; upload malicious code; or harass bakery staff, couriers or our team. We may suspend or close accounts that breach this section, after telling you why unless the law or a security risk prevents it.' },
      { h: '14. Intellectual property and reviews' },
      { p: `The Platform, its software, design and the Morning Box name and logo belong to ${v.operator} or its licensors. Bakery names, photos and logos belong to the bakeries. You get a personal, non-transferable right to use the Platform for its intended purpose. If you post a review or feedback, you allow us to display and use it in connection with the Platform; reviews must be honest and lawful, and we may remove those that are not.` },
      { h: '15. Privacy' },
      { p: 'We handle personal data as described in our [[privacy|Privacy Policy]] and [[cookies|Cookie & Device Storage Notice]], in line with Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data. To fulfil an Order we share only the necessary details with the Partner Bakery, Delivery Partner and payment provider.' },
      { h: '16. Liability' },
      { ol: [
        'Nothing in these Terms excludes or limits any right or liability that cannot be excluded or limited under UAE law, including liability for death or personal injury caused by negligence, fraud, or your statutory consumer rights.',
        'Subject to point 1, Morning Box is not liable for losses that were not reasonably foreseeable, or for business losses where you used the Platform for non-consumer purposes.',
        'Responsibility for contamination, illness, product defects, payment or delivery incidents is decided by what caused them, each party’s actual role and UAE law. Agreements between Morning Box and its partners do not reduce your rights.'
      ] },
      { h: '17. Suspension and closing your account' },
      { p: 'You may close your account at any time in the app or through Help & Support; Orders already accepted will still be delivered unless you cancel them before the Cutoff. We may suspend or close an account for a serious or repeated breach of these Terms, suspected fraud, or where the law requires, and will refund any undelivered Orders.' },
      { h: '18. Changes to these Terms' },
      { p: 'We may update these Terms to reflect changes to the service or the law. The “last updated” date shows the current version. We give at least 14 days’ notice in the app or by email of material changes, except where an urgent legal or security change is needed. Changes never apply to Orders already accepted or remove rights you have already gained.' },
      { h: '19. General' },
      { p: 'If any part of these Terms is found invalid, the rest remains in force. A failure to enforce a right is not a waiver. You may not transfer your rights under these Terms; we may transfer ours to a successor that continues the service on the same terms.' },
      { h: '20. Governing law and disputes' },
      { p: 'These Terms are governed by the federal laws of the United Arab Emirates and the laws of the Emirate of Dubai as applied onshore, including Federal Law No. 15 of 2020 on Consumer Protection and Federal Decree-Law No. 14 of 2023 on Trading by Modern Technological Means. We will first try to resolve any dispute through our complaints process. If it remains unresolved, the courts of Dubai have jurisdiction, without affecting your right to complain to a consumer-protection authority or to rely on any mandatory jurisdiction rule.' }
    ],
    footer: `Morning Box — operated by ${v.operator}, ${v.shortAddress} · ${v.email} · Help & Support in the app`
  };
}

/* ---------- 02 · Refunds, Cancellations & Delivery Policy ---------- */
function refunds(v) {
  return {
    title: 'Morning Box – Refunds, Cancellations & Delivery Policy',
    summary: 'You can change or cancel any breakfast free of charge until 9:00 PM Dubai time the evening before delivery; after that, we refund whenever something goes wrong on our side, the bakery’s or the courier’s. This Policy forms part of the Morning Box [[terms|Terms of Service]] and is shown before checkout.',
    blocks: [
      { h: '1. Changes and cancellations by you' },
      { table: { head: ['When you act', 'Change items or window', 'Cancel', 'Refund'], rows: [
        ['Before the Cutoff (9:00 PM the day before)', 'Yes, in the app', 'Yes, in the app', '100% to original payment method'],
        ['After the Cutoff, before dispatch', 'Contact support; only if the bakery agrees', 'Contact support; only if the bakery agrees', 'Case by case'],
        ['After dispatch', 'No', 'No', 'Only under section 3']
      ] } },
      { ul: [
        'If a different Cutoff applies to a product, Plan or business order, it is shown clearly before you pay and that Cutoff applies instead.',
        'In a Plan, each date is a separate Order. Cancelling one date does not cancel the others. Cancelling the whole Plan before a date’s Cutoff refunds every date not yet past its Cutoff.'
      ] },
      { h: '2. Changes and cancellations by us or the bakery' },
      { ul: [
        'If a bakery cannot fulfil an accepted Order, we tell you as soon as we know, ideally before 7:00 AM on the delivery day, and offer a full refund or an alternative. You choose; silence means refund.',
        'If an item is unavailable, we will not substitute it without your agreement, except an equivalent packaging or garnish change that does not affect ingredients or allergens.',
        'If delivery to your area or building becomes impossible (for example, official road closures, severe weather or building lockdown), undelivered Orders are refunded in full.'
      ] },
      { h: '3. Problems with a delivered Order' },
      { table: { head: ['Problem', 'Report', 'Usual remedy'], rows: [
        ['Order not delivered', 'Help & Support, as soon as noticed', 'Full refund or redelivery if still useful to you'],
        ['Item missing', 'Within 24 hours, with Order number', 'Refund of the item, or replacement'],
        ['Wrong item delivered', 'Within 24 hours, photo helpful', 'Refund or replacement; do not eat if it may contain an allergen'],
        ['Damaged or tampered packaging', 'Immediately, photo helpful', 'Full refund of affected items; do not eat'],
        ['Unsafe, spoiled or contaminated food', 'Immediately; seek medical help first if unwell', 'Full refund; investigation with the bakery and, where required, the authorities'],
        ['Very late delivery (more than 30 minutes after the window)', 'Same day', 'Refund of the delivery charge, or full refund if you no longer want the Order'],
        ['Quality below description', 'Within 24 hours', 'Fair remedy depending on the issue']
      ] } },
      { p: 'The 24-hour guide helps us investigate; a later report is still considered. These remedies are in addition to your rights under UAE consumer-protection law, which no part of this Policy limits.' },
      { h: '4. When a refund may not apply' },
      { p: 'A voluntary change or cancellation after the Cutoff may not be refunded, because fresh food may already be in preparation. A failed delivery is treated as completed when the courier arrived within the window at the address and followed the instructions you gave, but no one received the Order and the courier could not reach you on the number provided. We will still review each case fairly.' },
      { h: '5. How refunds are paid' },
      { ul: [
        'Refunds go to the original payment method. We start the refund within 2 business days of approving it; banks usually post it within 5–14 business days.',
        'Store credit is offered only as an option. You can always ask for a refund to your payment method instead.',
        'Refunds include the food price and any delivery charge and Platform Fee paid for the affected Order, unless the issue was caused by you.'
      ] },
      { h: '6. Delivery' },
      { ul: [
        'Area: initially DIFC, Dubai. The checkout shows whether your address is covered.',
        `Windows: morning slots shown at checkout: ${list(v.windows)} Dubai time.`,
        'Handover: to you, a person you name, or the building’s reception or concierge if you allow it. Add floor, office, access notes and a reachable phone number.',
        'Food safety in transit: chilled items travel in temperature-controlled packaging. After handover, follow storage notes and eat promptly.',
        'Tracking: order status updates are shown in the app, and your order confirmation is sent by email when you give an email address.'
      ] },
      { h: '7. Contact' },
      { p: `Use Help & Support in the app, or contact us ${v.contact}, ${v.hours} Dubai time. If you are not satisfied with our answer, you can contact the UAE Ministry of Economy or Dubai’s Department of Economy and Tourism (Consumer Rights).` }
    ],
    footer: `Morning Box — operated by ${v.operator}, ${v.shortAddress}`
  };
}

/* ---------- 03 · Privacy Policy ---------- */
function privacy(v) {
  return {
    title: 'Morning Box – Privacy Policy',
    summary: 'Morning Box uses your information to take, prepare and deliver your breakfast orders, and to keep your allergy and preference settings so suggestions fit you. We never sell your data, and we ask for your explicit consent before using allergy or other health-related information.',
    blocks: [
      { h: '1. Who we are' },
      { p: `Morning Box is operated by ${v.operator}, ${v.address} (“Morning Box”, “we”, “us”). We are the controller of the personal data we collect to run the platform, under Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (the “PDPL”).` },
      { p: 'Partner Bakeries, Delivery Partners and our payment provider receive limited data to fulfil your order. For data they use for their own legal duties (for example, food-safety or payment records), they act as separate controllers under their own privacy notices.' },
      { p: `Privacy contact: ${v.privacyEmail} or Help & Support in the app.${v.dpo ? ` Data Protection Officer: ${v.dpo}.` : ''}` },
      { h: '2. What we collect and why' },
      { table: { head: ['Information', 'Examples', 'Why we use it', 'Legal basis', 'How long we keep it'], rows: [
        ['Account', 'Email, sign-in codes, account ID', 'Create your account, sign you in, secure it', 'Contract', 'Life of account + 6 months'],
        ['Contact', 'Name, mobile number', 'Order updates, courier contact, support', 'Contract', 'Life of account + 6 months'],
        ['Morning Profile', 'Eating style, favourite categories, morning context, portion choices, swaps', 'Personalise suggestions, remember unfinished plans', 'Contract; legitimate interest for improvements', 'Until you edit or delete it, or close your account'],
        ['Dietary and allergy data (sensitive)', 'Declared allergies, intolerances, dietary needs, optional notes', 'Filter suggestions; tell the bakery what to avoid for your order', 'Explicit consent', 'Until you withdraw consent, delete it, or close your account'],
        ['Orders', 'Items, bakery, dates, value, status, messages', 'Process and support orders, invoices', 'Contract; legal obligation', '5 years for transaction and tax records'],
        ['Delivery', 'Address, building, floor, office, instructions, window', 'Deliver your order', 'Contract', 'Life of account; per-order copy 5 years with order record'],
        ['Payment', 'Payment status, transaction ID, amounts, refunds, disputes (no full card numbers)', 'Take payment as the bakery’s agent, refunds, fraud checks', 'Contract; legal obligation', '5 years'],
        ['Support', 'Complaints, photos, chat or email messages', 'Resolve issues, food-safety investigations', 'Contract; legal obligation; legitimate interest', '3 years after closure; longer if a claim is open'],
        ['Technical', 'Device and browser type, IP address, session data, crash logs', 'Run, secure and fix the platform', 'Legitimate interest', '12 months'],
        ['App analytics', 'Which steps of the app are used and completed', 'Improve the app', 'Consent', '13 months'],
        ['Marketing choices', 'Opt-in status, email engagement', 'Send offers you asked for', 'Consent', 'Until you opt out']
      ] } },
      { p: 'We collect most of this directly from you. We receive payment status from our payment provider and delivery status from the Partner Bakery or Delivery Partner delivering your order.' },
      { h: '3. Allergy and dietary information' },
      { p: 'Allergy and dietary details can reveal information about your health, which is sensitive personal data under the PDPL. We therefore:' },
      { ul: [
        'ask for your separate, explicit consent before you save them (an unticked box, not bundled with these terms);',
        'use them only to filter suggestions and pass the relevant details for a specific order to the bakery preparing it;',
        'never use them for advertising or share them for anyone’s marketing;',
        'limit staff access to those who need it for support or food-safety cases.'
      ] },
      { p: 'You can use Morning Box without saving allergy data, but then we cannot filter for you. You can withdraw consent any time in your Morning Profile; this deletes the saved details going forward. Filtering is not a guarantee that food is allergen-free (see our [[terms|Terms of Service]], section 9).' },
      { h: '4. Who we share data with' },
      { table: { head: ['Recipient', 'What they receive', 'Why'], rows: [
        ['Partner Bakery for your order', 'Order reference, items, relevant allergy and dietary notes, delivery window', 'Prepare and pack your order safely'],
        ['The Partner Bakery or Delivery Partner delivering your order', 'Delivery address and handover instructions, window; for business orders, the contact person named for the delivery', 'Deliver your order'],
        ['Payment provider (Stripe)', 'Amount, transaction data, data needed for fraud screening', 'Process payments and refunds'],
        ['Technology providers: hosting (' + v.hosting + '), email and sign-in codes (Resend; Meta WhatsApp where mobile sign-in is offered), maps (Google Maps, to show your delivery location on order tracking)', 'Only what each service needs', 'Run the platform, under contracts that require confidentiality and security'],
        ['Authorities, courts, professional advisers', 'What the law requires or a claim needs', 'Legal duties, food-safety investigations, defending legal rights'],
        ['A buyer or successor of the business', 'Data needed to continue the service', 'Business transfer, with you told in advance']
      ] } },
      { p: 'Notifications, support messages and app analytics are handled by Morning Box’s own systems, not by third-party tools. We do not sell personal data, and bakeries may not use your details for their own marketing.' },
      { h: '5. Transfers outside the UAE' },
      { p: `Morning Box’s server, where your account, orders and allergy data are stored, is hosted by ${v.hosting} in ${v.dataRegion}. Other providers, such as Stripe, Resend, Meta and Google, may store or access data outside the UAE, including in the European Union and the United States. We transfer data only to countries with adequate protection recognised under the PDPL, or with safeguards such as contractual protection, or where another lawful condition applies. Sensitive allergy data is not passed to these providers and is shared only with the bakery preparing your order.` },
      { h: '6. Your rights' },
      { p: 'Under the PDPL you can ask us to:' },
      { ul: [
        'tell you what data we hold, why, who receives it and how long we keep it, and give you a copy;',
        'give you your data in a structured, machine-readable format and transfer it to another provider where technically feasible;',
        'correct inaccurate or incomplete data;',
        'delete your data when it is no longer needed, you withdraw consent, or it was processed unlawfully;',
        'restrict or stop processing in certain cases, including objecting to processing for direct marketing;',
        'not be subject to a decision based solely on automated processing that has legal or similarly significant effects (our breakfast suggestions are not such decisions);',
        'withdraw consent at any time, without affecting earlier lawful processing.'
      ] },
      { p: `How: use Profile › Privacy & data in the app (download your data, correct your details, turn allergy filtering or offers off, change cookie settings, or delete your account), or contact ${v.privacyEmail}. We may verify your identity. We reply within 30 days and do not charge for reasonable requests. Some records (for example tax and transaction records) must be kept by law even after you close your account; we will tell you if so.` },
      { p: 'If you are unhappy with our answer, you can complain to the UAE Data Office.' },
      { h: '7. Marketing' },
      { p: 'We send promotional messages only if you opt in. Every email includes an unsubscribe link, and you can change preferences in the app at any time. Order updates and service messages are not marketing and are always sent.' },
      { h: '8. Security' },
      { p: 'We protect data with encryption in transit (TLS), restricted server access, role-based access, one-time-code sign-in, sessions stored only as secure hashes, logging and staff confidentiality obligations. If a personal data breach is likely to put your privacy or rights at risk, we notify the UAE Data Office and, where required, you, without undue delay. No online service can guarantee absolute security.' },
      { h: '9. Cookies and device storage' },
      { p: 'We use essential storage to keep you signed in and save unfinished plans, and optional analytics only with your consent. See our [[cookies|Cookie & Device Storage Notice]] for details.' },
      { h: '10. Children' },
      { p: 'Morning Box is for adults aged 18 and over. We do not knowingly collect data from children. If you believe a child has created an account, contact us and we will delete it. Do not enter allergy information about a child in your own Morning Profile.' },
      { h: '11. Changes to this Policy' },
      { p: 'We update this Policy when our service or the law changes, and show the date at the top. We tell you in the app or by email before material changes take effect, and ask again for consent where required.' },
      { h: '12. Contact' },
      { p: `${v.operator}, ${v.shortAddress} · ${v.privacyEmail} · Help & Support in the app.` }
    ]
  };
}

/* ---------- 04 · Cookie & Device Storage Notice (Part A) ---------- */
function cookies(v) {
  return {
    title: 'Morning Box – Cookie & Device Storage Notice',
    summary: 'Morning Box uses only essential device storage by default; analytics run only after you say yes.',
    blocks: [
      { h: 'What this covers' },
      { p: 'Cookies, local storage, session storage and similar identifiers on the Morning Box website and app (“device storage”). It works alongside our [[privacy|Privacy Policy]].' },
      { h: 'What we use' },
      { table: { head: ['Name / type', 'Category', 'Purpose', 'Duration', 'Consent needed?'], rows: [
        ['mb_session (cookie)', 'Essential', 'Keeps you signed in after one-time-code login', '30 days from your last visit, or until sign-out', 'No'],
        ['morningbox.app.v1 (local storage)', 'Essential', 'Saves an unfinished breakfast plan, your Morning Profile choices and delivery details on your device', 'Until you sign out or clear it', 'No'],
        ['morningbox.pricing (local storage)', 'Essential', 'Keeps current prices, menu and delivery areas so the app starts quickly', 'Replaced each time the app starts', 'No'],
        ['morningbox.consent (local storage)', 'Essential', 'Remembers your device storage choices', '12 months', 'No'],
        ['morning-box app cache (cache storage)', 'Essential', 'Lets the installed app open quickly and when you are briefly offline', 'Until the next app update', 'No'],
        ['Security / anti-fraud', 'Essential', 'Detects abuse and protects sign-in, using your IP address on our server (nothing is stored on your device)', 'Session', 'No'],
        ['morningbox.splash.seen, mb.visit (session storage)', 'Functional', 'Shows the welcome screen once per visit', 'Until you close the tab', 'No (strictly needed for the setting you chose)'],
        ['Morning Box app analytics (first party, no third-party tool)', 'Analytics', 'Measures app use to improve it, such as which steps are completed, using pseudonymous IDs', '13 months', 'Yes'],
        ['Marketing pixels', 'Marketing', 'Not used: Morning Box does not use marketing or advertising pixels', '—', '—']
      ] } },
      { p: 'We do not use device storage to build advertising profiles from allergy or dietary data.' },
      { h: 'Your choices' },
      { p: 'On first visit we show a banner with Accept all, Reject non-essential and Settings, each equally easy to choose. You can change your choice any time in Profile › Privacy & data › Cookie settings, or with the Cookie settings link at the bottom of the home page. Blocking essential storage in your browser may stop sign-in or plan saving from working.' },
      { h: 'Changes and contact' },
      { p: `We update this Notice when we add or remove tools. Questions: ${v.privacyEmail} or Help & Support.` }
    ]
  };
}

/* ---------- Allergen information (Morning Box's own page, consistent with Terms §9) ---------- */
function allergens() {
  return {
    title: 'Allergen Information',
    summary: 'How Morning Box uses your allergy and dietary information, and what filtering can and cannot do.',
    blocks: [
      { h: 'How we keep you safe' },
      { p: 'Every ingredient in Morning Box has an allergen record supplied and confirmed by our Partner Bakeries. When you mark an allergy or dietary requirement (and agree to us using it), we never recommend, swap in or add anything that contains it.' },
      { p: 'Breakfasts for customers with allergies are prepared only by Partner Bakeries approved to handle them, and are labelled separately.' },
      { h: 'Allergens we track' },
      { p: 'Our records cover gluten (wheat), milk, egg, peanut, tree nuts, sesame and soy. If you have an allergy we don’t list, add it under “Other allergies” and our team checks it with the bakery for every morning you order.' },
      { h: 'Traces and cross-contact' },
      { p: 'Our Partner Bakeries handle common allergens in the same kitchen. Filtering cannot rule out cross-contact and is not a guarantee that any breakfast is allergen-free. If you have a severe allergy, contact Help & Support before ordering so we can check with the bakery.' },
      { h: 'If you have a reaction' },
      { p: 'In an emergency call 998 for an ambulance (or 999) or seek medical help first. Then report it from the order screen (Allergy concern) so we can investigate with the bakery the same day.' },
      { h: 'More' },
      { p: 'See section 9 of our [[terms|Terms of Service]] and section 3 of our [[privacy|Privacy Policy]].' }
    ]
  };
}

const BUILDERS = { terms, refunds, privacy, cookies, allergens };

/** The document `id`, filled for `ctx` (the /api/config shape), or null. */
export function legalDocument(id, ctx) {
  const build = BUILDERS[id];
  if (!build) return null;
  return { id, updated: LEGAL_UPDATED, ...build(values(ctx)) };
}

/** "2 November 2026" */
export const legalDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
};

/** Splits text into plain strings and { id, label } links from [[id|label]]. */
export function inlineParts(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\[\[(\w+)\|([^\]]+)\]\]/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ id: m[1], label: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/* ---------- Standalone HTML (public pages on the server and morningbox.ae) ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A complete, self-contained HTML page for document `id`. `href(id)` gives each document's URL. */
export function legalHtml(id, ctx, { href = d => `/${d}`, appUrl = '' } = {}) {
  const doc = legalDocument(id, ctx);
  if (!doc) return null;
  const inline = t => inlineParts(t).map(p => (typeof p === 'string' ? esc(p) : `<a href="${esc(href(p.id))}">${esc(p.label)}</a>`)).join('');
  const block = b => {
    if (b.h) return `<h2>${esc(b.h)}</h2>`;
    if (b.p) return `<p>${inline(b.p)}</p>`;
    if (b.ul) return `<ul>${b.ul.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`;
    if (b.ol) return `<ol>${b.ol.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`;
    if (b.table) {
      const head = b.table.head;
      return `<div class="table"><table><thead><tr>${head.map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${
        b.table.rows.map(r => `<tr>${r.map((c, i) => `<td data-label="${esc(head[i])}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    return '';
  };
  const nav = LEGAL_PAGES.map(([d, label]) => (d === id ? `<span aria-current="page">${esc(label)}</span>` : `<a href="${esc(href(d))}">${esc(label)}</a>`)).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title.replace('Morning Box – ', ''))} · Morning Box</title>
<meta name="description" content="${esc(doc.summary.replace(/\[\[\w+\|([^\]]+)\]\]/g, '$1'))}">
<meta name="theme-color" content="#FBF7EF">
<link rel="icon" type="image/png" href="/icons/morning-box-192.png">
<style>
:root{--gold:#D99A12;--label:#8A6416;--espresso:#3B2D22;--ivory:#FBF7EF;--card:#FFFDF8;--line:#E6DAC6;--text-2:#5E4E3F;--text-3:#75655A;
--serif:"DM Serif Display",Georgia,"Times New Roman",serif;--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ivory);color:var(--espresso);font:16px/1.6 var(--sans);padding:0 16px}
main{max-width:820px;margin:0 auto;padding:32px 0 64px}
header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding-bottom:20px;border-bottom:1px solid var(--line)}
.brand{font:22px/1 var(--serif);color:var(--espresso);text-decoration:none}
nav{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px}
nav a{color:var(--text-2)}nav span{font-weight:600}
h1{font:400 clamp(30px,6vw,42px)/1.15 var(--serif);margin:28px 0 8px}
.updated{color:var(--text-3);font-size:14px;margin:0 0 20px}
.summary{font-size:18px;color:var(--text-2);margin:0 0 8px}
h2{font-size:19px;margin:32px 0 8px}
p,li{color:var(--text-2)}a{color:var(--label)}
ul,ol{padding-left:22px}li{margin:6px 0}
.table{overflow-x:auto;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14.5px;background:var(--card)}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#F5EEDF;color:var(--espresso)}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);font-size:14px;color:var(--text-3)}
@media (max-width:640px){
  thead{display:none}table,tbody,tr,td{display:block;width:100%}
  tr{border:1px solid var(--line);border-radius:10px;margin:0 0 10px;padding:6px 0;background:var(--card)}
  td{border:0;padding:4px 12px}td::before{content:attr(data-label);display:block;font-size:12px;font-weight:600;color:var(--label);text-transform:uppercase;letter-spacing:.04em}
}
</style>
</head>
<body>
<main>
<header><a class="brand" href="${esc(appUrl || '/')}">Morning Box</a><nav aria-label="Legal documents">${nav}</nav></header>
<h1>${esc(doc.title.replace('Morning Box – ', ''))}</h1>
<p class="updated">Last updated: ${esc(legalDate(doc.updated))}</p>
<p class="summary">${inline(doc.summary)}</p>
${doc.blocks.map(block).join('\n')}
<footer>${esc(doc.footer || `Morning Box — operated by ${values(ctx).operator}`)}</footer>
</main>
</body>
</html>
`;
}
