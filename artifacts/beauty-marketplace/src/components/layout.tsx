import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { CustomerMobileNav } from "./customer-mobile-nav";
import { CouponCatcher } from "./coupon-catcher";
import { CommerceHeaderBar } from "./commerce-header-bar";

export function Layout({ children, hideCustomerNavigation = false }: { children: React.ReactNode; hideCustomerNavigation?: boolean }) {
  return (
    <div className="min-h-[100dvh] flex flex-col font-sans">
      <CouponCatcher />
      <CommerceHeaderBar />
      <Navbar />
      <main className="flex-1 flex flex-col">
        {children}
      </main>
      {!hideCustomerNavigation && <Footer />}
      {!hideCustomerNavigation && <CustomerMobileNav />}
    </div>
  );
}
