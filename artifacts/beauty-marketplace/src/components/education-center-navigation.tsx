import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { GuideHelpLink } from "@/components/guide-help-link";
import { cn } from "@/lib/utils";
import { educationCenterNavSections, type EducationCenterNavLink } from "@/lib/education-center-navigation";

type EducationCenterNavigationProps = {
  variant?: "light" | "dark";
  onNavigate?: () => void;
};

function isLinkActive(location: string, link: EducationCenterNavLink) {
  if (link.href === "/biznis") return location === link.href;
  return location === link.href || location.startsWith(`${link.href}/`);
}

export function EducationCenterNavigation({
  variant = "light",
  onNavigate,
}: EducationCenterNavigationProps) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const dark = variant === "dark";

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        setLocation("/");
      }
    });
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-3 custom-scrollbar">
        {educationCenterNavSections.map((section) => {
          const sectionActive = section.items.some((link) => isLinkActive(location, link));
          return (
            <section key={section.label} className="mb-5 last:mb-1">
              <h2
                className={cn(
                  "mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.16em]",
                  dark
                    ? sectionActive ? "text-accent" : "text-background/45"
                    : sectionActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {section.label}
              </h2>
              <div className="space-y-0.5">
                {section.items.map((link) => {
                  const active = isLinkActive(location, link);
                  return (
                    <div key={link.href} className="flex items-center gap-1">
                      <Link
                        href={link.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-w-0 flex-1 items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                          dark
                            ? active ? "bg-white/12 text-accent" : "text-background/85 hover:bg-white/8 hover:text-background"
                            : active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted",
                        )}
                      >
                        <link.icon className="mr-2.5 h-4 w-4 shrink-0" />
                        <span className="truncate">{link.label}</span>
                      </Link>
                      {link.guideId ? (
                        <GuideHelpLink
                          sectionId={link.guideId}
                          label={link.label}
                          onClick={onNavigate}
                          className={dark ? "text-background/65 hover:bg-white/10 hover:text-accent focus-visible:ring-white" : undefined}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className={cn("shrink-0 border-t p-2", dark ? "border-white/10 bg-foreground" : "bg-background")}>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "w-full justify-start px-3 text-destructive",
            dark ? "hover:bg-red-500/10 hover:text-red-300" : "hover:bg-destructive/10 hover:text-destructive",
          )}
          onClick={handleLogout}
          disabled={logout.isPending}
        >
          <LogOut className="mr-2.5 h-4 w-4" />
          {logout.isPending ? "Odjavljivanje…" : "Odjavi se"}
        </Button>
      </div>
    </div>
  );
}