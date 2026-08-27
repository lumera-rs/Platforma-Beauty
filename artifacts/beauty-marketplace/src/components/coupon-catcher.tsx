import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { Tag, X } from "lucide-react";
import { Button } from "./ui/button";

export function CouponCatcher() {
  const searchString = useSearch();
  const [captured, setCaptured] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const kupon = params.get("kupon");
    
    if (kupon) {
      sessionStorage.setItem("lumera_retail_coupon", kupon.toUpperCase());
      setCaptured(kupon.toUpperCase());
      
      params.delete("kupon");
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
    }
  }, [searchString]);

  if (!captured) return null;

  return (
    <div className="bg-emerald-500 text-white px-4 py-2 flex items-center justify-between text-sm font-medium z-50 animate-in slide-in-from-top">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4" />
        <span>
          Kupon <strong>{captured}</strong> je uspešno primenjen. Popust će biti obračunat u korpi.
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="text-white hover:text-emerald-100 hover:bg-emerald-600/50 h-6 w-6 -mr-1"
        onClick={() => setCaptured(null)}
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
