import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

type EducationFieldHelpProps = {
  id: string;
  text: string;
  label: string;
};

/**
 * Help for Education data-entry fields. The trigger is deliberately a real,
 * generously-sized button: Radix therefore supports focus/keyboard use as well
 * as hover, while the larger target remains usable on touch screens.
 */
export function EducationFieldHelp({ id, text, label }: EducationFieldHelpProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  return (
    <span className="inline-flex">
      <span id={id} className="sr-only">{text}</span>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setPinned(false);
        }}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
            aria-label={`Pomoć za polje „${label}”`}
            aria-describedby={id}
            aria-expanded={open}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => {
              if (!pinned) setOpen(false);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              if (!pinned) setOpen(false);
            }}
            onClick={() => {
              if (open && pinned) {
                setPinned(false);
                setOpen(false);
                return;
              }
              setPinned(true);
              setOpen(true);
            }}
          >
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverAnchor>
        <PopoverContent
          role="tooltip"
          className="w-auto max-w-xs p-3 text-sm"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {text}
        </PopoverContent>
      </Popover>
    </span>
  );
}