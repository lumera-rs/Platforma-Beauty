import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type GuideHelpLinkProps = {
  sectionId: string;
  label: string;
  className?: string;
  onClick?: () => void;
};

export function GuideHelpLink({ sectionId, label, className, onClick }: GuideHelpLinkProps) {
  return (
    <a
      href={`/biznis/vodic#${sectionId}`}
      aria-label={`Otvori pomoć za ${label}`}
      title={`Pomoć: ${label}`}
      data-testid={`guide-help-${sectionId}`}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <HelpCircle className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}