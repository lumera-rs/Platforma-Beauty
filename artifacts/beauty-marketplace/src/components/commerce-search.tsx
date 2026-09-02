import { useState, useRef, useEffect } from "react";
import { useGetCommerceSearchSuggestions, SearchProductSuggestion, getGetCommerceSearchSuggestionsQueryKey } from "@workspace/api-client-react";
import { Input } from "./ui/input";
import { Search, Loader2, ShoppingCart, Info, Flame } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { useAddRetailCartItem } from "@workspace/api-client-react";
import { useShopCartMutations } from "@/hooks/use-shop-cart-mutations";
import { notifyRetailCartChanged } from "@/lib/retail-cart-events";
import { useToast } from "@/hooks/use-toast";
import { Button } from "./ui/button";
import { OptimizedImage } from "./optimized-image";
import { Link } from "wouter";

interface CommerceSearchProps {
  audience: "B2C" | "B2B";
  value: string;
  onChange: (val: string) => void;
  supplierSlug?: string; // used for routing to product details
}

export function CommerceSearch({ audience, value, onChange, supplierSlug }: CommerceSearchProps) {
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Local state for debouncing the query to the suggestions API
  const debouncedQuery = useDebounce(value, 300);

  const { data: suggestions = [], isLoading } = useGetCommerceSearchSuggestions(
    { audience, q: debouncedQuery, limit: 5 },
    { query: { enabled: focused, queryKey: getGetCommerceSearchSuggestionsQueryKey({ audience, q: debouncedQuery, limit: 5 }) } }
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        placeholder="Pretraga proizvoda..."
        className="pl-9 h-9 text-sm"
      />
      {focused && (
        <div className="absolute top-full mt-1 w-full bg-card rounded-xl border shadow-lg z-50 overflow-hidden max-h-[70vh] flex flex-col">
          <div className="px-3 py-2 bg-muted/30 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider flex justify-between">
            <span>{debouncedQuery ? "Rezultati pretrage" : "Preporučeno za vas"}</span>
            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          <div className="overflow-y-auto p-2">
            {!isLoading && suggestions.length === 0 && (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Nema rezultata za "{debouncedQuery}".
              </div>
            )}
            {suggestions.map((suggestion) => (
              <SuggestionItem
                key={suggestion.id}
                suggestion={suggestion}
                audience={audience}
                supplierSlug={supplierSlug}
                onClose={() => setFocused(false)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SuggestionItem({ suggestion, audience, supplierSlug, onClose }: { suggestion: SearchProductSuggestion; audience: "B2C" | "B2B"; supplierSlug?: string; onClose: () => void }) {
  const { toast } = useToast();

  // B2C Cart
  const addRetailItem = useAddRetailCartItem();

  // B2B Cart
  const { addItem: addShopItem } = useShopCartMutations();
  const [addingB2b, setAddingB2b] = useState(false);

  const [selectedVariant, setSelectedVariant] = useState(suggestion.variants?.[0]?.value ?? "");

  const hasVariants = suggestion.variants && suggestion.variants.length > 0;
  const isPOR = suggestion.priceOnRequest || suggestion.price === null;
  const linkPath = supplierSlug ? (audience === "B2C" ? `/shop/${supplierSlug}/proizvod/${suggestion.id}` : `/vlasnik/shop/${supplierSlug}/proizvodi/${suggestion.id}`) : "#";

  const handleAdd = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!suggestion.cartEligible) {
      toast.error("Proizvod nije moguće dodati u korpu.");
      return;
    }

    if (audience === "B2C") {
      addRetailItem.mutate({ data: { productId: suggestion.id, quantity: 1, variantValue: selectedVariant || undefined } }, {
        onSuccess: (cart) => {
          notifyRetailCartChanged(cart.itemCount);
          toast.success("Dodato u korpu.");
          onClose();
        },
        onError: () => toast.error("Greška pri dodavanju.")
      });
    } else {
      setAddingB2b(true);
      try {
        await addShopItem.mutateAsync({ data: { productId: suggestion.id, quantity: 1, variantValue: selectedVariant || undefined } });
        onClose();
      } catch (err) {
        // handled in hook
      } finally {
        setAddingB2b(false);
      }
    }
  };

  const isAdding = addRetailItem.isPending || addingB2b;

  const currentPrice = suggestion.discountPrice ?? suggestion.price;

  return (
    <div className="group flex flex-col p-2 hover:bg-muted/50 rounded-lg transition-colors border-b last:border-0 border-border/50">
      <Link href={linkPath} className="flex items-start gap-3 w-full" onClick={onClose}>
        <div className="w-12 h-12 rounded bg-muted overflow-hidden shrink-0 border relative">
          {suggestion.automaticBestseller && (
            <div className="absolute top-0 left-0 bg-amber-500 text-white rounded-br px-1 text-[8px] font-bold z-10"><Flame className="w-2 h-2" /></div>
          )}
          <OptimizedImage src={suggestion.imageUrl} alt={suggestion.name} className="w-full h-full object-cover" width={48} height={48} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center h-12">
          <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{suggestion.name}</p>
          <div className="text-xs">
            {isPOR ? (
              <span className="text-primary font-medium">Cena na upit</span>
            ) : (
              <span className="font-medium">
                {currentPrice?.toLocaleString("sr-RS")} RSD
                {suggestion.discountPrice && <span className="line-through text-muted-foreground ml-1">{suggestion.price?.toLocaleString("sr-RS")} RSD</span>}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Inline Actions */}
      <div className="mt-2 flex items-center gap-2 pl-[60px]">
        {hasVariants && !isPOR && (
          <select
            className="text-xs border rounded h-7 px-1 flex-1 bg-background"
            value={selectedVariant}
            onChange={(e) => setSelectedVariant(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          >
            {suggestion.variants.map((v) => (
              <option key={v.value} value={v.value} disabled={!v.cartEligible}>{v.label} {v.cartEligible ? "" : "(nedostupno)"}</option>
            ))}
          </select>
        )}

        {isPOR ? (
           <Button size="sm" variant="outline" className="h-7 text-xs px-2 whitespace-nowrap" asChild onClick={onClose}>
             <Link href={linkPath}><Info className="w-3 h-3 mr-1"/> Upit</Link>
           </Button>
        ) : (
           <Button
            size="sm"
            className="h-7 text-xs px-2 whitespace-nowrap"
            disabled={!suggestion.cartEligible || isAdding || (hasVariants && !selectedVariant)}
            onClick={handleAdd}
           >
             {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShoppingCart className="w-3 h-3 mr-1"/>}
             Dodaj
           </Button>
        )}
      </div>
    </div>
  );
}
