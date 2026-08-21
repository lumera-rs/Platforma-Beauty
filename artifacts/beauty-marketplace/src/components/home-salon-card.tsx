import { Link } from "wouter";
import { MapPin, Star, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SalonCard, DiscountedSalonCard } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

export function HomeSalonCard({ salon, className }: { salon: SalonCard; className?: string }) {
  return (
    <Link href={`/saloni/${salon.slug}`} className={cn("group flex h-full cursor-pointer flex-col gap-3 rounded-2xl p-1 transition-all duration-300 hover:-translate-y-1 hover:bg-card hover:shadow-xl", className)}>
      <div className="relative mb-2 aspect-[4/3] w-full overflow-hidden rounded-2xl">
        <img
          src={salon.imageUrl || "/default-salon.jpg"}
          alt={salon.name}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 bg-muted"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        
        <div className="absolute left-3 top-3 flex flex-col gap-2 items-start">
          {salon.featured && (
            <Badge className="border-none bg-primary/95 font-medium text-primary-foreground shadow-sm backdrop-blur-md">
              Istaknuto
            </Badge>
          )}
          {salon.topSalon && (
            <Badge className="border-none bg-accent/95 font-medium text-accent-foreground shadow-sm backdrop-blur-md">
              Top Salon
            </Badge>
          )}
        </div>

        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-background/95 px-2.5 py-1.5 text-sm font-bold text-foreground shadow-sm backdrop-blur-md">
          <Star className="h-3.5 w-3.5 fill-accent text-accent" />
          <span>{salon.rating.toFixed(1)}</span>
          <span className="text-xs font-medium text-muted-foreground">({salon.reviewCount})</span>
        </div>
      </div>
      
      <div className="px-1 pb-2 flex-1 flex flex-col">
        <h3 className="line-clamp-1 font-serif text-xl font-bold text-foreground transition-colors group-hover:text-primary">{salon.name}</h3>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-1">{salon.city}, {salon.municipality}</span>
        </p>
        <div className="mt-auto pt-4 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Od {salon.startingPrice.toLocaleString("sr")} RSD</span>
          {salon.earliestSlot && (
            <div className="flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 rounded-md">
              <Clock className="w-3 h-3" />
              Danas
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export function HomeDiscountSalonCard({ salon, className }: { salon: DiscountedSalonCard; className?: string }) {
  return (
    <Link href={`/saloni/${salon.slug}`} className={cn("group flex h-full cursor-pointer flex-col gap-3 rounded-2xl p-1 transition-all duration-300 hover:-translate-y-1 hover:bg-card hover:shadow-xl", className)}>
      <div className="relative mb-2 aspect-[4/3] w-full overflow-hidden rounded-2xl">
        <img
          src={salon.imageUrl || "/default-salon.jpg"}
          alt={salon.name}
          className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 bg-muted"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        
        <Badge className="absolute left-3 top-3 border-none bg-destructive/95 font-bold text-destructive-foreground shadow-sm backdrop-blur-md">
          Akcija
        </Badge>

        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg bg-background/95 px-2.5 py-1.5 text-sm font-bold text-foreground shadow-sm backdrop-blur-md">
          <Star className="h-3.5 w-3.5 fill-accent text-accent" />
          <span>{salon.rating.toFixed(1)}</span>
        </div>
      </div>
      
      <div className="px-1 pb-2 flex-1 flex flex-col">
        <h3 className="line-clamp-1 font-serif text-xl font-bold text-foreground transition-colors group-hover:text-primary">{salon.name}</h3>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-1">{salon.city}</span>
        </p>
        
        <div className="mt-auto pt-3 flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground line-clamp-1">{salon.discount.serviceName}</p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-destructive">{salon.discount.promoPrice.toLocaleString("sr")} RSD</span>
            <span className="text-xs text-muted-foreground line-through">{salon.discount.price.toLocaleString("sr")} RSD</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
