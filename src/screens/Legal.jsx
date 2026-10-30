import { Link, Navigate, useParams } from 'react-router-dom';
import { Screen, TopBar } from '../components/ui.jsx';
import { useConfig } from '../state/config.js';

/* Customer-facing legal pages. The wording follows how Morning Box actually works
   (9:00 PM cutoff, DIFC delivery, allergen records, refunds to the original
   payment method). Have it reviewed by the company's legal adviser before launch. */
const DOCS = {
  terms: {
    title: 'Terms of Service',
    sections: c => [
      ['Who we are', [`Morning Box is operated by ${c.company.name}, ${c.company.address}. These terms apply when you use the Morning Box app or website and when you order breakfast from us. By signing in you agree to them.`]],
      ['Your account', ['You sign in with a UAE mobile number and a one-time code. Keep your phone secure: anyone with your code can use your account. You must be 18 or older to order.', 'You can change your number, sign out of all devices or delete your account at any time from Profile.']],
      ['Ordering', ['You can order up to four weeks ahead. Orders for a morning close at 9:00 PM (Dubai time) the evening before. We confirm each order in the app.', 'Breakfasts are recommended from your Morning Profile. You are responsible for keeping your allergies and dietary needs up to date.']],
      ['Prices and payment', ['Prices are in UAE dirhams and include VAT. Delivery within our service area is included. You pay when you place an order. If a price changes before you pay, we show you the new total first and you choose whether to continue.']],
      ['Changes and cancellations', ['You can change or cancel a morning until 9:00 PM the evening before. Cancelled mornings are refunded in full. After the cutoff a morning is prepared fresh and can no longer be changed or refunded, except as described in our Refunds & Cancellations policy.']],
      ['Delivery', ['We deliver within DIFC in the window you choose, to reception or your door. Someone must be able to receive the delivery, or we leave it at reception. We may be late in exceptional circumstances; we will tell you in the app.', 'We are closed on some public holidays. Closed days can’t be selected.']],
      ['Allergies and food safety', ['We only recommend breakfasts whose ingredient and allergen records match your profile. Our partner bakeries handle common allergens, so we can’t guarantee a product is free from traces. Read our Allergen Information before ordering if you have a severe allergy.']],
      ['If something goes wrong', ['Report missing, late, wrong or poor-quality breakfasts from the order screen on the day. We will review every report and, where appropriate, refund or replace.']],
      ['Business orders', ['Business orders follow the same cutoff and cancellation rules for each day. A tax invoice is issued to the billing details you provide. Volume discounts are calculated per day.']],
      ['Fair use', ['Don’t misuse the app, try to access other people’s accounts, or place orders you don’t intend to receive. We may suspend accounts that do.']],
      ['Our responsibility', ['Nothing in these terms limits your rights as a consumer under UAE law. Otherwise, our liability for any order is limited to the amount you paid for it.']],
      ['Changes to these terms', ['If we change these terms we will update the date above and ask you to accept the new version in the app.']],
      ['Law', ['These terms are governed by the laws of the Emirate of Dubai and the federal laws of the United Arab Emirates.']]
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    sections: c => [
      ['Who is responsible', [`${c.company.name} (${c.company.address}) is responsible for your personal data in Morning Box.`]],
      ['What we collect', ['Your mobile number and first name; optionally your email. Your Morning Profile: eating style, breakfast preferences, dietary requirements and allergies. Delivery details: building, office and notes. Your orders, feedback and messages to support.', 'Allergy and dietary information is sensitive: we use it only to keep your breakfast safe.']],
      ['Why we use it', ['To create your account and sign you in; to recommend safe breakfasts; to prepare and deliver your orders; to send order updates; to answer support requests; to issue receipts and invoices; and to improve our breakfasts using your feedback. We send offers only if you turn them on.']],
      ['Who we share it with', ['The partner bakery that prepares and delivers your breakfast (your breakfast and allergen needs, and your building, office and delivery window). Our payment provider, which processes your payment. We never see or store your full card number. We never sell your data.']],
      ['How long we keep it', ['Your profile is kept while you have an account. Order and invoice records are kept as required by UAE tax law, without your personal details once you delete your account.']],
      ['Your rights', ['You can see and correct your details in Profile, download a copy of your data, turn offers off, and delete your account. For anything else, contact us from Help & Support.']],
      ['Cookies and storage', ['We use one secure cookie to keep you signed in, and store your unfinished plan on your device. We don’t use advertising cookies.']],
      ['Security', ['Sign-in codes are single-use and time-limited, sessions can be ended on all devices, and data is sent over encrypted connections.']],
      ['Changes', ['If we change this policy we will update the date above and let you know in the app.']]
    ]
  },
  refunds: {
    title: 'Refunds & Cancellations',
    sections: () => [
      ['Before the cutoff', ['Change or cancel any morning until 9:00 PM (Dubai time) the evening before. A cancelled morning is refunded in full. Other mornings in the same order stay as planned.', 'If you change a morning and the price changes, we charge or refund the difference.']],
      ['After the cutoff', ['Your breakfast is prepared fresh for you, so it can’t be cancelled or refunded unless something went wrong on our side.']],
      ['When something goes wrong', ['Not delivered, very late, wrong or missing items, quality or allergy concerns: report it from the order screen on the day, or contact Help & Support within 24 hours. We review every report and refund or credit where appropriate.']],
      ['If we cancel', ['If we can’t deliver (for example an unexpected closure), we tell you as early as possible and refund that morning in full.']],
      ['How refunds are paid', ['Refunds go back to your original payment method. Most banks show them within 5–10 working days.']]
    ]
  },
  allergens: {
    title: 'Allergen Information',
    sections: () => [
      ['How we keep you safe', ['Every ingredient in Morning Box has an approved allergen record. When you mark an allergy or dietary requirement, we never recommend, swap in or add anything that contains it.', 'Breakfasts for customers with allergies are prepared only by partner bakeries approved to handle them, and are labelled separately.']],
      ['Allergens we track', ['Our records cover gluten (wheat), milk, egg, peanut, tree nuts, sesame and soy. If you have an allergy we don’t list, add it under “Other allergies” and our team checks it with the bakery for every morning you order.']],
      ['Traces and cross-contact', ['Our partner bakeries handle common allergens in the same kitchen. Although they follow strict controls, we can’t guarantee any breakfast is completely free from traces. If you have a severe allergy, please consider whether Morning Box is right for you.']],
      ['If you have a reaction', ['Call 998 for an ambulance immediately. Then report it from the order screen (Allergy concern) so we can investigate with the bakery the same day.']],
      ['Questions', ['Ask us about any ingredient from Help & Support before you order.']]
    ]
  }
};
export const LEGAL_PAGES = [['terms', 'Terms of Service'], ['privacy', 'Privacy Policy'], ['refunds', 'Refunds & Cancellations'], ['allergens', 'Allergen Information']];

export default function Legal() {
  const { doc } = useParams();
  const config = useConfig();
  const page = DOCS[doc];
  if (!page) return <Navigate to="/" replace />;
  const updated = config.termsVersion ? new Date(`${config.termsVersion}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return (
    <Screen>
      <TopBar back={-1} close={null}><span className="topbar-title">{page.title}</span></TopBar>
      <main className="screen-main legal" style={{ paddingTop: 8, gap: 22 }}>
        <div className="stack gap-8">
          <h1 className="h-display" style={{ fontSize: 34 }}>{page.title}</h1>
          {updated && <span className="xs">Last updated {updated}</span>}
        </div>
        {page.sections(config).map(([h, ps], i) => (
          <section key={h} className="stack gap-8">
            <h2 className="h3" style={{ fontSize: 19 }}>{i + 1}. {h}</h2>
            {ps.map(p => <p key={p.slice(0, 24)} className="help" style={{ margin: 0, fontSize: 16, lineHeight: 1.6 }}>{p}</p>)}
          </section>
        ))}
        <p className="help" style={{ margin: 0, fontSize: 15 }}>Questions? <Link to="/help" className="link">Contact us</Link></p>
      </main>
    </Screen>
  );
}
