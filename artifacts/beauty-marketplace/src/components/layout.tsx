import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { CustomerMobileNav } from "./customer-mobile-nav";

export function Layout({ children, hideCustomerNavigation = false }: { children: React.ReactNode; hideCustomerNavigation?: boolean }) {
  return (
    <div className="min-h-[100dvh] flex flex-col font-sans">
      <Navbar />
      <main className="flex-1 flex flex-col">
        {children}
      </main>
      {!hideCustomerNavigation && <Footer />}
      {!hideCustomerNavigation && <CustomerMobileNav />}
    </div>
  );
}
