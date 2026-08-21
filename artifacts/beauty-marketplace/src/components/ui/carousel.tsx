import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, ArrowRight } from 'lucide-react';

type CarouselApi = {
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: () => boolean;
  canScrollNext: () => boolean;
};

type CarouselProps = {
  orientation?: 'horizontal' | 'vertical';
  setApi?: (api: CarouselApi) => void;
};

type CarouselContextProps = {
  scrollAreaRef: React.RefObject<HTMLDivElement | null>;
  updateControls: () => void;
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
} & CarouselProps;

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

function useCarousel() {
  const context = React.useContext(CarouselContext);

  if (!context) {
    throw new Error('useCarousel must be used within a <Carousel />');
  }

  return context;
}

const Carousel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & CarouselProps
>(
  (
    {
      orientation = 'horizontal',
      setApi,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const scrollAreaRef = React.useRef<HTMLDivElement>(null);
    const [canScrollPrev, setCanScrollPrev] = React.useState(false);
    const [canScrollNext, setCanScrollNext] = React.useState(false);

    const updateControls = React.useCallback(() => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea) return;

      const position =
        orientation === 'horizontal'
          ? scrollArea.scrollLeft
          : scrollArea.scrollTop;
      const maximum =
        orientation === 'horizontal'
          ? scrollArea.scrollWidth - scrollArea.clientWidth
          : scrollArea.scrollHeight - scrollArea.clientHeight;

      setCanScrollPrev(position > 2);
      setCanScrollNext(position < maximum - 2);
    }, [orientation]);

    const scrollByViewport = React.useCallback(
      (direction: 1 | -1) => {
        const scrollArea = scrollAreaRef.current;
        if (!scrollArea) return;

        const viewportSize =
          orientation === 'horizontal'
            ? scrollArea.clientWidth
            : scrollArea.clientHeight;
        const distance = direction * Math.max(viewportSize * 0.88, 260);

        scrollArea.scrollBy(
          orientation === 'horizontal'
            ? { left: distance, behavior: 'smooth' }
            : { top: distance, behavior: 'smooth' },
        );
      },
      [orientation],
    );

    const scrollPrev = React.useCallback(() => {
      scrollByViewport(-1);
    }, [scrollByViewport]);

    const scrollNext = React.useCallback(() => {
      scrollByViewport(1);
    }, [scrollByViewport]);

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          scrollPrev();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          scrollNext();
        }
      },
      [scrollPrev, scrollNext],
    );

    const api = React.useMemo<CarouselApi>(
      () => ({
        scrollPrev,
        scrollNext,
        canScrollPrev: () => canScrollPrev,
        canScrollNext: () => canScrollNext,
      }),
      [canScrollNext, canScrollPrev, scrollNext, scrollPrev],
    );

    React.useEffect(() => {
      setApi?.(api);
    }, [api, setApi]);

    React.useEffect(() => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea) return;

      updateControls();
      const observer = new ResizeObserver(updateControls);
      observer.observe(scrollArea);
      return () => observer.disconnect();
    }, [updateControls]);

    return (
      <CarouselContext.Provider
        value={{
          scrollAreaRef,
          orientation,
          updateControls,
          scrollPrev,
          scrollNext,
          canScrollPrev,
          canScrollNext,
        }}
      >
        <div
          ref={ref}
          onKeyDownCapture={handleKeyDown}
          className={cn('relative', className)}
          role="region"
          aria-roledescription="carousel"
          {...props}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    );
  },
);
Carousel.displayName = 'Carousel';

const CarouselContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { scrollAreaRef, orientation, updateControls } = useCarousel();

  return (
    <div
      ref={scrollAreaRef}
      data-carousel-viewport
      onScroll={updateControls}
      className={cn(
        orientation === 'horizontal'
          ? 'overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'overflow-y-auto overscroll-y-contain scroll-smooth snap-y snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      <div
        ref={ref}
        className={cn(
          'flex',
          orientation === 'horizontal' ? '-ml-4' : '-mt-4 flex-col',
          className,
        )}
        {...props}
      />
    </div>
  );
});
CarouselContent.displayName = 'CarouselContent';

const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { orientation } = useCarousel();

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      className={cn(
        'min-w-0 shrink-0 grow-0 basis-full snap-start',
        orientation === 'horizontal' ? 'pl-4' : 'pt-4',
        className,
      )}
      {...props}
    />
  );
});
CarouselItem.displayName = 'CarouselItem';

const CarouselPrevious = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, variant = 'outline', size = 'icon', onClick, ...props }, ref) => {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        'absolute  h-8 w-8 rounded-full',
        orientation === 'horizontal'
          ? '-left-12 top-1/2 -translate-y-1/2'
          : '-top-12 left-1/2 -translate-x-1/2 rotate-90',
        className,
      )}
      disabled={!canScrollPrev}
      onClick={(event) => {
        scrollPrev();
        onClick?.(event);
      }}
      {...props}
    >
      <ArrowLeft className="h-4 w-4" />
      <span className="sr-only">Previous slide</span>
    </Button>
  );
});
CarouselPrevious.displayName = 'CarouselPrevious';

const CarouselNext = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ className, variant = 'outline', size = 'icon', onClick, ...props }, ref) => {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        'absolute h-8 w-8 rounded-full',
        orientation === 'horizontal'
          ? '-right-12 top-1/2 -translate-y-1/2'
          : '-bottom-12 left-1/2 -translate-x-1/2 rotate-90',
        className,
      )}
      disabled={!canScrollNext}
      onClick={(event) => {
        scrollNext();
        onClick?.(event);
      }}
      {...props}
    >
      <ArrowRight className="h-4 w-4" />
      <span className="sr-only">Next slide</span>
    </Button>
  );
});
CarouselNext.displayName = 'CarouselNext';

export {
  type CarouselApi,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
};
