import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DiscoveryCarouselProps = {
  children: React.ReactNode;
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
};

/**
 * A shared discovery rail for categories and salon cards.
 * Embla provides touch dragging and snapping; responsive item sizes create
 * the intentional "next card" peek on narrow screens.
 */
export function DiscoveryCarousel({
  children,
  ariaLabel,
  className,
  itemClassName,
}: DiscoveryCarouselProps) {
  const slides = React.Children.toArray(children);
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(false);

  const updateControls = React.useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    const maxScrollLeft = scrollArea.scrollWidth - scrollArea.clientWidth;
    setCanScrollPrev(scrollArea.scrollLeft > 2);
    setCanScrollNext(scrollArea.scrollLeft < maxScrollLeft - 2);
  }, []);

  React.useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    updateControls();
    const observer = new ResizeObserver(updateControls);
    observer.observe(scrollArea);
    return () => observer.disconnect();
  }, [slides.length, updateControls]);

  const scrollByViewport = (direction: 1 | -1) => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    if (direction === 1) {
      setCanScrollPrev(true);
    } else {
      setCanScrollNext(true);
    }

    scrollArea.scrollBy({
      left: direction * Math.max(scrollArea.clientWidth * 0.88, 260),
      behavior: "smooth",
    });
    window.setTimeout(updateControls, 350);
  };

  if (!slides.length) {
    return null;
  }

  return (
    <section
      aria-label={ariaLabel}
      aria-roledescription="carousel"
      className={cn("group/discovery-carousel relative", className)}
    >
      <div
        ref={scrollAreaRef}
        onScroll={updateControls}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-smooth px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, index) => (
          <div
            // The caller's child keys are not available after Children.toArray.
            // Index is safe here because rails receive a stable ordered dataset.
            key={index}
            role="group"
            aria-roledescription="slide"
            className={cn(
              "shrink-0 snap-start basis-[84%] sm:basis-[48%] lg:basis-1/3 xl:basis-1/4",
              itemClassName,
            )}
          >
            {slide}
          </div>
        ))}
      </div>

      {slides.length > 1 ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Prikaži prethodne stavke"
            disabled={!canScrollPrev}
            onClick={() => scrollByViewport(-1)}
            className="absolute left-3 top-[42%] hidden h-11 w-11 rounded-full border-border/80 bg-background/95 shadow-lg backdrop-blur transition-all hover:scale-105 hover:bg-background hover:shadow-xl disabled:pointer-events-none disabled:opacity-0 md:inline-flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Prikaži sledeće stavke"
            disabled={!canScrollNext}
            onClick={() => scrollByViewport(1)}
            className="absolute right-3 top-[42%] hidden h-11 w-11 rounded-full border-border/80 bg-background/95 shadow-lg backdrop-blur transition-all hover:scale-105 hover:bg-background hover:shadow-xl disabled:pointer-events-none disabled:opacity-0 md:inline-flex"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </>
      ) : null}
    </section>
  );
}