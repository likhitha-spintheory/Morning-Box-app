import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Home from './screens/Home.jsx';
import Splash from './screens/Splash.jsx';
import { EatingStyle, Preferences, Dietary } from './screens/personal/Profile.jsx';
import { Start, ChooseDates, DailyContext, MorningBox, Extras, NextMorning, WeeklySummary } from './screens/personal/Plan.jsx';
import { SignIn, Delivery, ReviewPay, Confirmed } from './screens/personal/Checkout.jsx';
import { Today, Orders, OrderDay, EditMorning, Feedback, Me } from './screens/personal/Account.jsx';
import Legal from './screens/Legal.jsx';
import Help from './screens/Help.jsx';
import Notifications from './screens/Notifications.jsx';
import { ErrorBoundary, OfflineBanner, UpdateBanner } from './components/Safety.jsx';

/* Business Breakfast loads on demand, so personal customers download less. */
const biz = name => lazy(() => import('./screens/business/Business.jsx').then(m => ({ default: m[name] })));
const BizWelcome = biz('BizWelcome'), People = biz('People'), Specials = biz('Specials'), Selection = biz('Selection');
const ChooseBoxes = biz('ChooseBoxes'), BizDates = biz('BizDates'), BizDelivery = biz('BizDelivery'), BizAccount = biz('BizAccount');
const BizReview = biz('BizReview'), BizConfirmed = biz('BizConfirmed'), BizManage = biz('BizManage');
/* The operations console is for the Morning Box team only. */
const Ops = lazy(() => import('./screens/Ops.jsx'));
const Bakery = lazy(() => import('./screens/Bakery.jsx'));
const Courier = lazy(() => import('./screens/Courier.jsx'));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ScrollTop />
      <Splash />
      <OfflineBanner />
      <UpdateBanner />
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/start" element={<Start />} />

        <Route path="/profile/eating" element={<EatingStyle />} />
        <Route path="/profile/preferences" element={<Preferences />} />
        <Route path="/profile/dietary" element={<Dietary />} />

        <Route path="/plan/dates" element={<ChooseDates />} />
        <Route path="/plan/day/:iso/context" element={<DailyContext />} />
        <Route path="/plan/day/:iso/box" element={<MorningBox />} />
        <Route path="/plan/day/:iso/extras" element={<Extras />} />
        <Route path="/plan/day/:iso/next" element={<NextMorning />} />
        <Route path="/plan/summary" element={<WeeklySummary />} />

        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/checkout/delivery" element={<Delivery />} />
        <Route path="/checkout/review" element={<ReviewPay />} />
        <Route path="/orders/:id/confirmed" element={<Confirmed />} />

        <Route path="/today" element={<Today />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id/:date" element={<OrderDay />} />
        <Route path="/orders/:id/:date/edit" element={<EditMorning />} />
        <Route path="/orders/:id/:date/feedback" element={<Feedback />} />
        <Route path="/me" element={<Me />} />

        <Route path="/business" element={<BizWelcome />} />
        <Route path="/business/people" element={<People />} />
        <Route path="/business/special" element={<Specials />} />
        <Route path="/business/selection" element={<Selection />} />
        <Route path="/business/boxes" element={<ChooseBoxes />} />
        <Route path="/business/dates" element={<BizDates />} />
        <Route path="/business/delivery" element={<BizDelivery />} />
        <Route path="/business/account" element={<BizAccount />} />
        <Route path="/business/review" element={<BizReview />} />
        <Route path="/business/orders/:id/confirmed" element={<BizConfirmed />} />
        <Route path="/business/orders/:id" element={<BizManage />} />

        <Route path="/legal/:doc" element={<Legal />} />
        <Route path="/help" element={<Help />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/ops" element={<Ops />} />
        <Route path="/bakery" element={<Bakery />} />
        <Route path="/courier" element={<Courier />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
