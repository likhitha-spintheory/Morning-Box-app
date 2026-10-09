import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Home from './screens/Home.jsx';
import { EatingStyle, Preferences, Dietary } from './screens/personal/Profile.jsx';
import { Start, ChooseDates, DailyContext, MorningBox, Extras, NextMorning, WeeklySummary } from './screens/personal/Plan.jsx';
import { SignIn, Delivery, ReviewPay, Confirmed } from './screens/personal/Checkout.jsx';
import { Today, Orders, OrderDay, EditMorning, Feedback, Me } from './screens/personal/Account.jsx';
import {
  BizWelcome, People, Specials, Selection, ChooseBoxes, BizDates, BizDelivery, BizAccount, BizReview, BizConfirmed, BizManage
} from './screens/business/Business.jsx';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollTop />
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

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
