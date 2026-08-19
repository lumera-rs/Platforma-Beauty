import { ReactNode } from "react";
import { BusinessNavbar } from "./business-navbar";
import { BusinessFooter } from "./business-footer";

export function BusinessLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <BusinessNavbar />
      <main className="flex-1 flex flex-col">
        {children}
      </main>
      <BusinessFooter />
    </div>
  );
}
