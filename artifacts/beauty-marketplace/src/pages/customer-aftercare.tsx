import { Layout } from "@/components/layout";
import { 
  useCustomerListAftercareRecommendations, 
  useCustomerGetAftercareRecommendation, 
  useCustomerReadAftercareRecommendation, 
  getCustomerListAftercareRecommendationsQueryKey,
  getCustomerGetAftercareRecommendationQueryKey,
  getApiErrorDetails,
  useAddRetailCartItem,
  getGetRetailCartQueryKey,
  CustomerAftercareRecommendationStatus,
  type CustomerAftercareRecommendation,
  type CustomerAftercareItemCard,
  type CustomerAftercareRecommendationLineItem,
  type CustomerAftercareRecommendationLine
} from "@workspace/api-client-react";
import { Link, useLocation, useSearch } from "wouter";
import { Loader2, Sparkles, Clock, CheckCircle2, ChevronRight, Package, ShoppingBag, ArrowRight } from "lucide-react";
import { format, parseISO, isPast } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { OptimizedImage } from "@/components/optimized-image";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

function money(value: number) {
  return new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);
}

function LineItemCard({ item, kind, recommendationId, discountPercent }: { item: NonNullable<CustomerAftercareRecommendationLineItem>, kind: string, recommendationId: string, discountPercent: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const addCart = useAddRetailCartItem({
    mutation: {
      onSuccess: (data) => {
        qc.setQueryData(getGetRetailCartQueryKey(), data);
        toast.success("Dodato u korpu");
        setLocation(`/korpa?aftercareRecommendationId=${recommendationId}`);
      },
      onError: (err) => {
        toast.error("Greška", { description: "Nije moguće dodati u korpu." });
      }
    }
  });

  const handleAdd = () => {
    if (kind === 'PREMADE_BUNDLE') {
      addCart.mutate({ data: { bundleId: item.id, quantity: 1 } });
    } else {
      addCart.mutate({ data: { productId: item.id, quantity: 1 } });
    }
  };

  return (
    <Card className="overflow-hidden flex flex-col group">
      <div className="aspect-square bg-muted relative">
        {item.imageUrl ? (
          <OptimizedImage 
            src={item.imageUrl} 
            alt={item.name} 
            width={400} 
            height={400} 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
            <Package className="w-12 h-12 opacity-20" />
          </div>
        )}
        {discountPercent > 0 && (
          <Badge className="absolute top-2 right-2 bg-accent text-accent-foreground">
            -{discountPercent}%
          </Badge>
        )}
      </div>
      <CardContent className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-medium line-clamp-2 leading-tight mb-2">{item.name}</h3>
        </div>
        <div className="mt-4">
          <Button 
            className="w-full" 
            size="sm" 
            onClick={handleAdd}
            disabled={addCart.isPending}
            data-testid={`button-add-to-cart-${item.id}`}
          >
            {addCart.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShoppingBag className="w-4 h-4 mr-2" />}
            Dodaj u korpu
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PersonalizedBundleCard({ line, recommendationId }: { line: CustomerAftercareRecommendationLine, recommendationId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const addCart = useAddRetailCartItem();
  const [isAdding, setIsAdding] = useState(false);

  const handleAddAll = async () => {
    setIsAdding(true);
    let successCount = 0;
    for (const p of line.coveredProducts) {
      try {
        await addCart.mutateAsync({ data: { productId: p.id, quantity: 1 } });
        successCount++;
      } catch (err) {
        toast.error("Greška", { description: `Nije moguće dodati proizvod ${p.name} u korpu.` });
      }
    }
    setIsAdding(false);
    
    if (successCount === line.coveredProducts.length && successCount > 0) {
       qc.invalidateQueries({ queryKey: getGetRetailCartQueryKey() });
       toast.success("Ceo paket je uspešno dodat u korpu");
       setLocation(`/korpa?aftercareRecommendationId=${recommendationId}`);
    } else if (successCount > 0) {
       qc.invalidateQueries({ queryKey: getGetRetailCartQueryKey() });
       toast.error("Delimičan uspeh", { description: "Neki proizvodi nisu dodati u korpu." });
    }
  };

  return (
    <div className="col-span-full border rounded-xl p-6 bg-primary/5">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
           <h3 className="font-bold text-lg flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Personalizovani paket</h3>
           <p className="text-sm text-muted-foreground mt-1">Dodajte sve preporučene proizvode zajedno i ostvarite popust.</p>
        </div>
        <Button onClick={handleAddAll} disabled={isAdding}>
          {isAdding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShoppingBag className="w-4 h-4 mr-2" />}
          Dodaj ceo paket u korpu
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
         {line.coveredProducts.map((p: CustomerAftercareItemCard) => (
           <Card key={p.id} className="overflow-hidden flex flex-col group opacity-90 border-primary/20 bg-background/50">
              <div className="aspect-square bg-muted relative">
                {p.imageUrl ? (
                  <OptimizedImage src={p.imageUrl} alt={p.name} width={200} height={200} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                    <Package className="w-8 h-8 opacity-20" />
                  </div>
                )}
              </div>
              <CardContent className="p-3 flex-1 flex flex-col justify-center text-center">
                <h4 className="font-medium text-xs line-clamp-2 leading-tight">{p.name}</h4>
              </CardContent>
           </Card>
         ))}
      </div>
    </div>
  );
}

function RecommendationDetail({ id, onClose }: { id: string, onClose: () => void }) {
  const qc = useQueryClient();
  const { data: rec, isLoading, isError, error } = useCustomerGetAftercareRecommendation(id, {
    query: {
      queryKey: getCustomerGetAftercareRecommendationQueryKey(id),
      retry: false
    }
  });
  const markRead = useCustomerReadAftercareRecommendation();
  const hasMarkedRead = useRef(false);
  const errorStatus = error ? getApiErrorDetails(error).status : undefined;
  const isTerminallyUnavailable = isError && [401, 403, 404, 409].includes(errorStatus ?? 0);

  useEffect(() => {
    if (isTerminallyUnavailable) {
      sessionStorage.removeItem("lumera_retail_aftercare");
    }
  }, [id, isTerminallyUnavailable]);
  
  useEffect(() => {
    if (rec && !rec.readAt && !hasMarkedRead.current) {
      hasMarkedRead.current = true;
      markRead.mutate({ recommendationId: id }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getCustomerListAftercareRecommendationsQueryKey() });
          qc.invalidateQueries({ queryKey: getCustomerGetAftercareRecommendationQueryKey(id) });
        }
      });
    }
  }, [rec, id]);

  if (isLoading) {
    return (
      <div className="py-20 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !rec) {
    return (
      <div className="py-20 text-center space-y-4">
        <p className="text-muted-foreground">Preporuka nije pronađena ili nemate pristup.</p>
        <Button variant="link" onClick={onClose}>Nazad na listu</Button>
      </div>
    );
  }

  const expired = isPast(parseISO(rec.expiresAt));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
          <ChevronRight className="w-4 h-4 mr-1 rotate-180" /> Nazad na listu
        </Button>
      </div>

      <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
        <div className="bg-primary/5 p-6 md:p-8 border-b">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <Badge variant="outline" className="mb-3 bg-background">Preporučena nega</Badge>
              <h1 className="font-serif text-2xl md:text-3xl font-bold">Nakon vašeg tretmana</h1>
              <p className="text-muted-foreground mt-2">
                Tretmani: {rec.treatments.join(", ")}
              </p>
            </div>
            <div className="text-right flex flex-col items-start md:items-end">
              {rec.status === CustomerAftercareRecommendationStatus.CONVERTED ? (
                <Badge className="bg-emerald-500 text-white hover:bg-emerald-600"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Iskorišćeno</Badge>
              ) : expired ? (
                <Badge variant="destructive">Isteklo</Badge>
              ) : (
                <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">Aktivno</Badge>
              )}
              {!expired && rec.status !== CustomerAftercareRecommendationStatus.CONVERTED && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Ponuda važi do {format(parseISO(rec.expiresAt), 'dd.MM.yyyy.')}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8 space-y-10">
          <section>
            <h2 className="text-xl font-serif font-bold mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> Saveti stručnjaka
            </h2>
            <ul className="space-y-3 bg-muted/30 p-5 rounded-xl border">
              {rec.tips.map((tip, idx) => (
                <li key={idx} className="flex gap-3 text-sm md:text-base">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <div>
                <h2 className="text-xl font-serif font-bold flex items-center gap-2">
                  <Package className="w-5 h-5 text-primary" /> Preporučeni proizvodi
                </h2>
                <p className="text-sm text-muted-foreground mt-1">Pažljivo odabrani proizvodi za optimalne rezultate i duže trajanje efekata.</p>
              </div>
            </div>

            <div className="space-y-8">
              {rec.lines.map((line, lIdx) => (
                <div key={lIdx} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{line.kind === 'PRODUCT' ? 'Proizvod' : 'Paket'}</Badge>
                    <span className="text-sm font-medium">
                      {line.discountPercent > 0 && <span className="text-accent font-bold mr-2">Dodatnih {line.discountPercent}% popusta</span>}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                    {line.kind === 'PERSONALIZED_BUNDLE' ? (
                      <PersonalizedBundleCard line={line} recommendationId={rec.id} />
                    ) : (
                      line.item && <LineItemCard item={line.item} kind={line.kind} recommendationId={rec.id} discountPercent={line.discountPercent} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function CustomerAftercarePage() {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(search);
  const selectedId = searchParams.get("recommendationId");

  const { data: recommendations, isLoading } = useCustomerListAftercareRecommendations({}, {
    query: {
      queryKey: getCustomerListAftercareRecommendationsQueryKey(),
    }
  });

  const handleSelect = (id: string | null) => {
    if (id) {
      setLocation(`${location}?recommendationId=${id}`);
    } else {
      setLocation(location);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-10 max-w-5xl">
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 md:py-12 max-w-5xl">
        {!selectedId ? (
          <>
            <div className="mb-8">
              <h1 className="font-serif text-3xl md:text-4xl font-bold tracking-tight">Preporučena nega</h1>
              <p className="text-muted-foreground mt-2">Vaše personalizovane preporuke za oporavak i negu nakon tretmana.</p>
            </div>
            
            {!recommendations || recommendations.length === 0 ? (
              <div className="bg-card rounded-2xl border p-12 text-center shadow-sm">
                <Sparkles className="mx-auto w-12 h-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-xl font-bold mb-2">Nemate novih preporuka</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Kada posetite salon i obavite tretman, ovde ćete dobiti personalizovane savete i ponude za produženu negu.
                </p>
                <Button asChild className="mt-6">
                  <Link href="/saloni">Zakažite termin</Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-4 md:gap-6">
                {recommendations.map(rec => {
                  const expired = isPast(parseISO(rec.expiresAt));
                  const unread = !rec.readAt;
                  
                  return (
                    <button 
                      key={rec.id}
                      onClick={() => handleSelect(rec.id)}
                      className={cn(
                        "w-full text-left bg-card rounded-xl border p-5 md:p-6 transition-all duration-200 hover:shadow-md hover:border-primary/30 flex flex-col md:flex-row md:items-center justify-between gap-4",
                        unread ? "border-l-4 border-l-primary" : ""
                      )}
                      data-testid={`button-view-recommendation-${rec.id}`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          {rec.status === CustomerAftercareRecommendationStatus.CONVERTED ? (
                            <Badge className="bg-emerald-500 text-white"><CheckCircle2 className="w-3 h-3 mr-1" /> Iskorišćeno</Badge>
                          ) : expired ? (
                            <Badge variant="destructive">Isteklo</Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-primary/10 text-primary">Aktivno</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            Važi do {format(parseISO(rec.expiresAt), 'dd.MM.yyyy.')}
                          </span>
                        </div>
                        <h3 className="font-bold text-lg">Preporuka posle tretmana</h3>
                        <p className="text-sm text-muted-foreground">
                          {rec.treatments.join(", ")}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm font-medium text-primary">
                        <span>Prikaži detalje</span>
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <RecommendationDetail id={selectedId} onClose={() => handleSelect(null)} />
        )}
      </div>
    </Layout>
  );
}
