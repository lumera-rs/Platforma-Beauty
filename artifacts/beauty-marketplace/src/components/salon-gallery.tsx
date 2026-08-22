import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Play, X, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OptimizedImage } from "@/components/optimized-image";

export interface MediaItem {
  type: 'video' | 'image';
  url: string;
}

interface SalonGalleryProps {
  media: MediaItem[];
  salonName: string;
}

export function SalonGallery({ media, salonName }: SalonGalleryProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const next = useCallback(() => setCurrentIndex((i) => (i + 1) % media.length), [media.length]);
  const prev = useCallback(() => setCurrentIndex((i) => (i - 1 + media.length) % media.length), [media.length]);

  useEffect(() => {
    if (!lightboxOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === "Tab") {
        const focusable = lightboxRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], video[controls]");
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [lightboxOpen, next, prev]);

  // Prevent background scrolling when lightbox is open
  useEffect(() => {
    if (lightboxOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [lightboxOpen]);

  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  }

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  }

  const onTouchEnd = () => {
    if (touchStart === null || touchEnd === null) return;
    const distance = touchStart - touchEnd;
    if (distance > 50) next();
    if (distance < -50) prev();
    setTouchStart(null);
    setTouchEnd(null);
  }

  if (!media.length) return null;

  const mainMedia = media[0];

  return (
    <div className="space-y-3">
      {/* Main Grid */}
      <div className="grid grid-cols-4 grid-rows-2 gap-2 h-[350px] md:h-[450px] lg:h-[500px] rounded-2xl overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          aria-label={`Otvori galeriju salona ${salonName}`}
          className={cn("relative group cursor-pointer bg-muted", media.length > 1 ? "col-span-4 row-span-2 sm:col-span-3 sm:row-span-2" : "col-span-4 row-span-2")}
          onClick={() => { setCurrentIndex(0); setLightboxOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setCurrentIndex(0);
              setLightboxOpen(true);
            }
          }}
        >
          {mainMedia.type === 'video' ? (
             <>
               <video src={mainMedia.url} className="w-full h-full object-cover" muted loop autoPlay playsInline />
               <div className="absolute inset-0 bg-black/10 flex items-center justify-center transition-opacity group-hover:bg-black/30">
                 <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-md border border-white/20 flex items-center justify-center">
                   <Play className="w-8 h-8 text-white fill-white ml-1" />
                 </div>
               </div>
             </>
          ) : (
             <OptimizedImage src={mainMedia.url} alt={`${salonName} 1`} width={1280} height={960} eager className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" sizes="(max-width: 768px) 100vw, 75vw" />
          )}
          <span className="absolute bottom-4 right-4 bg-black/60 text-white backdrop-blur-md p-2.5 flex items-center gap-2 rounded-lg text-sm font-medium border border-white/10">
            <Maximize2 className="w-4 h-4" />
            <span className="hidden sm:inline">Prikaži sve ({media.length})</span>
          </span>
        </div>

        {/* Thumbnails visible only on sm+ if there are more items */}
        {media.length > 1 && (
          <div className="hidden sm:flex flex-col gap-2 col-span-1 row-span-2 h-full">
            {media.slice(1, 3).map((item, idx) => (
              <div 
                key={idx} 
                className={cn("relative rounded-lg overflow-hidden cursor-pointer group bg-muted", media.length === 2 ? "h-full" : "h-1/2")}
                onClick={() => { setCurrentIndex(idx + 1); setLightboxOpen(true); }}
              >
                {item.type === 'video' ? (
                  <>
                    <video src={item.url} className="w-full h-full object-cover" muted loop playsInline />
                    <div className="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-md">
                      <Play className="w-3 h-3 text-white fill-white" />
                    </div>
                  </>
                ) : (
                  <OptimizedImage src={item.url} alt={`${salonName} ${idx + 2}`} width={320} height={240} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" sizes="25vw" />
                )}
                {idx === 1 && media.length > 3 && (
                  <div className="absolute inset-0 bg-black/50 hover:bg-black/60 transition-colors flex flex-col items-center justify-center text-white backdrop-blur-[2px]">
                     <span className="font-semibold text-2xl">+{media.length - 3}</span>
                     <span className="text-xs font-medium mt-1">fotografija</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox Overlay */}
      {lightboxOpen && (
        <div ref={lightboxRef} role="dialog" aria-modal="true" aria-label={`Galerija salona ${salonName}`} className="fixed inset-0 z-[100] bg-black/98 flex flex-col animate-in fade-in duration-200">
           {/* Header */}
           <div className="flex justify-between items-center p-4 text-white z-10 bg-gradient-to-b from-black/50 to-transparent">
             <div className="text-sm font-medium opacity-80 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-md">
               {currentIndex + 1} / {media.length}
             </div>
              <button ref={closeButtonRef} type="button" aria-label="Zatvori galeriju" onClick={() => setLightboxOpen(false)} className="p-2.5 bg-black/40 hover:bg-white/20 rounded-full transition-colors backdrop-blur-md border border-white/10">
               <X className="w-6 h-6" />
             </button>
           </div>

           {/* Content */}
           <div 
             className="flex-1 flex items-center justify-center relative overflow-hidden"
             onTouchStart={onTouchStart}
             onTouchMove={onTouchMove}
             onTouchEnd={onTouchEnd}
           >
             {media.length > 1 && (
                <button type="button" aria-label="Prethodna stavka galerije" onClick={(e) => { e.stopPropagation(); prev(); }} className="absolute left-4 p-4 bg-black/40 hover:bg-white/20 border border-white/10 text-white rounded-full transition-colors hidden sm:block z-10 backdrop-blur-md">
                 <ChevronLeft className="w-8 h-8" />
               </button>
             )}

             <div className="w-full h-full max-w-6xl px-0 sm:px-20 flex items-center justify-center relative">
               {media[currentIndex].type === 'video' ? (
                 <video src={media[currentIndex].url} controls autoPlay className="max-w-full max-h-[85vh] rounded-md shadow-2xl bg-black" />
               ) : (
                 <OptimizedImage src={media[currentIndex].url} alt={`${salonName} ${currentIndex + 1}`} width={1920} height={1080} className="max-w-full max-h-[85vh] rounded-md shadow-2xl object-contain select-none" draggable={false} sizes="(max-width: 768px) 100vw, 80vw" />
               )}
             </div>

             {media.length > 1 && (
                <button type="button" aria-label="Sledeća stavka galerije" onClick={(e) => { e.stopPropagation(); next(); }} className="absolute right-4 p-4 bg-black/40 hover:bg-white/20 border border-white/10 text-white rounded-full transition-colors hidden sm:block z-10 backdrop-blur-md">
                 <ChevronRight className="w-8 h-8" />
               </button>
             )}
           </div>
           
           {/* Thumbnail Strip */}
           {media.length > 1 && (
             <div className="h-28 p-4 flex justify-start sm:justify-center gap-3 overflow-x-auto custom-scrollbar bg-gradient-to-t from-black/50 to-transparent">
                {media.map((item, idx) => (
                  <button 
                        type="button"
                        aria-label={`Prikaži stavku ${idx + 1} od ${media.length}`}
                    key={idx}
                    onClick={() => setCurrentIndex(idx)}
                    className={cn(
                      "w-20 h-20 shrink-0 rounded-lg overflow-hidden border-2 transition-all relative", 
                      currentIndex === idx ? "border-primary opacity-100 ring-2 ring-primary ring-offset-2 ring-offset-black" : "border-transparent opacity-40 hover:opacity-100"
                    )}
                  >
                    {item.type === 'video' ? (
                      <>
                        <video src={item.url} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                          <Play className="w-5 h-5 text-white fill-white" />
                        </div>
                      </>
                    ) : (
                      <OptimizedImage src={item.url} alt={`${salonName} pregled ${idx + 1}`} width={80} height={80} className="w-full h-full object-cover" sizes="80px" />
                    )}
                  </button>
                ))}
             </div>
           )}
        </div>
      )}
    </div>
  )
}
