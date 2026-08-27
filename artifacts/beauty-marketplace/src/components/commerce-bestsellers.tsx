import { useState } from "react";
import { useListCommerceBestsellers, getListCommerceBestsellersQueryKey, BestsellerRanking } from "@workspace/api-client-react";
import { Flame, Medal, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { OptimizedImage } from "./optimized-image";

interface BestsellersProps {
  audience: "B2C" | "B2B";
  categoryId?: string;
  title?: string;
  supplierSlug?: string; // Optional: If we want to link directly to a specific supplier's product
}

export function CommerceBestsellers({ audience, categoryId, title = "Najprodavaniji proizvodi", supplierSlug }: BestsellersProps) {
  const { data: bestsellers = [] } = useListCommerceBestsellers({
    audience,
    categoryId,
    supplierSlug
  }, {
    query: {
      queryKey: getListCommerceBestsellersQueryKey({ audience, categoryId, supplierSlug })
    }
  });

  if (bestsellers.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="w-5 h-5 text-amber-500" />
        <h2 className="text-xl font-serif font-bold">{title}</h2>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar snap-x">
        {bestsellers.slice(0, 10).map((item) => (
          <BestsellerCard key={item.productId} item={item} audience={audience} supplierSlug={supplierSlug} />
        ))}
      </div>
    </section>
  );
}

function BestsellerCard({ item, audience, supplierSlug }: { item: BestsellerRanking; audience: "B2C" | "B2B"; supplierSlug?: string }) {
  const linkPath = supplierSlug ? (audience === "B2C" ? `/shop/${supplierSlug}/proizvod/${item.productId}` : `/vlasnik/shop/${supplierSlug}/proizvodi/${item.productId}`) : "#";

  return (
    <Link href={linkPath} className="group shrink-0 w-40 relative rounded-xl border bg-card p-3 shadow-sm hover:shadow-md transition-shadow snap-start flex flex-col h-full">
      <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-background border shadow flex items-center justify-center font-bold text-sm z-10">
        {item.rank === 1 ? <Medal className="w-4 h-4 text-yellow-500" /> : 
         item.rank === 2 ? <Medal className="w-4 h-4 text-gray-400" /> : 
         item.rank === 3 ? <Medal className="w-4 h-4 text-amber-700" /> : 
         `#${item.rank}`}
      </div>
      <div className="aspect-square bg-muted rounded-lg overflow-hidden mb-3">
        <OptimizedImage src={item.imageUrl} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
      </div>
      <div className="flex-1 flex flex-col">
        <h3 className="text-sm font-semibold line-clamp-2 leading-tight group-hover:text-primary transition-colors">{item.name}</h3>
        {item.automaticBestseller && (
           <p className="text-[10px] text-muted-foreground mt-auto pt-2">{item.quantitySold} prodato</p>
        )}
      </div>
    </Link>
  );
}
