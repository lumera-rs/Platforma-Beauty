import * as React from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

type DiscoveryCarouselProps = {
  children: React.ReactNode;
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
};

/**
 * A shared discovery rail for categories and salon cards.
 * Native scroll snapping keeps every horizontal content row resilient while
 * responsive item sizes create
 * the intentional "next card" peek on narrow screens.
 */
export function DiscoveryCarousel({
  children,
  ariaLabel,
  className,
  itemClassName,
}: DiscoveryCarouselProps) {
  const slides = React.Children.toArray(children);

  if (!slides.length) {
    return null;
  }

  return (
    <Carousel
      aria-label={ariaLabel}
      className={cn("group/discovery-carousel relative", className)}
    >
      <CarouselContent
        className="ml-0 gap-4 px-0.5 py-1"
      >
        {slides.map((slide, index) => (
          <CarouselItem
            // The caller's child keys are not available after Children.toArray.
            // Index is safe here because rails receive a stable ordered dataset.
            key={index}
            className={cn(
              "pl-0 basis-[84%] sm:basis-[48%] lg:basis-1/3 xl:basis-1/4",
              itemClassName,
            )}
          >
            {slide}
          </CarouselItem>
        ))}
      </CarouselContent>

      {slides.length > 1 ? (
        <>
          <CarouselPrevious
            type="button"
            aria-label="Prikaži prethodne stavke"
            className="absolute left-3 top-[42%] hidden h-11 w-11 rounded-full border-border/80 bg-background/95 shadow-lg backdrop-blur transition-all hover:scale-105 hover:bg-background hover:shadow-xl disabled:pointer-events-none disabled:opacity-0 md:inline-flex"
          />
          <CarouselNext
            type="button"
            aria-label="Prikaži sledeće stavke"
            className="absolute right-3 top-[42%] hidden h-11 w-11 rounded-full border-border/80 bg-background/95 shadow-lg backdrop-blur transition-all hover:scale-105 hover:bg-background hover:shadow-xl disabled:pointer-events-none disabled:opacity-0 md:inline-flex"
          />
        </>
      ) : null}
    </Carousel>
  );
}