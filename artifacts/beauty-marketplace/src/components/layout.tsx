import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { CustomerMobileNav } from "./customer-mobile-nav";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col font-sans">
      <Navbar />
      <main className="flex-1 flex flex-col">
        {children}
      </main>
      <Footer />
      <CustomerMobileNav />
    </div>
  );
}
