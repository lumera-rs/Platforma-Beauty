import { useState, useRef } from "react";
import { AdminLayout } from "./layout";
import { NetworkError, useAdminListReviews, useAdminUpdateReview, useAdminDeleteReview, getAdminListReviewsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, MessageSquare, Star, Trash2, EyeOff, FilterX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

export default function AdminReviews() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  
  const [visibleFilter, setVisibleFilter] = useState<string>("all");
  const [minRatingFilter, setMinRatingFilter] = useState<string>("all");
  const [maxRatingFilter, setMaxRatingFilter] = useState<string>("all");

  const queryParams = {
    search: debouncedSearch || undefined,
    visible: visibleFilter === "all" ? undefined : visibleFilter === "true",
    minRating: minRatingFilter === "all" ? undefined : parseInt(minRatingFilter, 10),
    maxRating: maxRatingFilter === "all" ? undefined : parseInt(maxRatingFilter, 10),
  };

  const { data: reviews, isLoading, error } = useAdminListReviews(queryParams);
  const updateReview = useAdminUpdateReview();
  const deleteReview = useAdminDeleteReview();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  
  const mutateFnRef = useRef(updateReview.mutate);
  mutateFnRef.current = updateReview.mutate;

  const handleToggleVisibility = (id: string, currentVisible: boolean) => {
    const actionKey = `visibility:${id}`;
    if (!actionGuard.begin(actionKey)) return;
    mutateFnRef.current({
      reviewId: id,
      data: { visible: !currentVisible }
    }, {
      onSuccess: () => {
        toast.success("Recenzija ažurirana", { description: `Recenzija je sada ${!currentVisible ? 'vidljiva' : 'skrivena'}.` });
        queryClient.invalidateQueries({ queryKey: getAdminListReviewsQueryKey() });
        actionGuard.end(actionKey);
      },
      onError: () => {
        toast.error("Greška", { description: "Nije moguće ažurirati recenziju." });
        actionGuard.end(actionKey);
      }
    });
  };

  const handleDelete = (id: string) => {
    const actionKey = `delete:${id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm("Trajno obrisati ovu recenziju? Ova akcija se ne može poništiti.")) {
      actionGuard.end(actionKey);
      return;
    }
    
    deleteReview.mutate({ reviewId: id }, {
      onSuccess: () => {
        toast.success("Obrisano", { description: "Recenzija je uklonjena iz sistema." });
        queryClient.invalidateQueries({ queryKey: getAdminListReviewsQueryKey() });
        actionGuard.end(actionKey);
      },
      onError: (error: unknown) => {
        if ((error as { status?: number }).status === 404) {
          toast.info("Recenzija više nije dostupna", {
            description: "Klijent je u međuvremenu povukao ovu recenziju. Lista je osvežena.",
          });
          queryClient.invalidateQueries({ queryKey: getAdminListReviewsQueryKey() });
          actionGuard.end(actionKey);
          return;
        }
        if (error instanceof NetworkError) {
          toast.warning("Brisanje nije potvrđeno", {
            description: "Veza sa serverom je prekinuta. Lista je osvežena; proverite da li je recenzija obrisana.",
          });
          queryClient.invalidateQueries({ queryKey: getAdminListReviewsQueryKey() });
          actionGuard.end(actionKey);
          return;
        }
        toast.error("Greška", { description: "Nije moguće obrisati recenziju." });
        actionGuard.end(actionKey);
      }
    });
  };

  const handleResetFilters = () => {
    setSearch("");
    setVisibleFilter("all");
    setMinRatingFilter("all");
    setMaxRatingFilter("all");
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-serif font-bold text-foreground">Moderacija Recenzija</h1>
              <p className="text-muted-foreground text-sm">Pregledajte, sakrijte ili uklonite problematične recenzije.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 p-4 bg-card rounded-xl border shadow-sm">
            <div className="relative md:col-span-1 lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Pretraži..." 
                className="pl-9 h-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-reviews"
              />
            </div>
            
            <Select value={visibleFilter} onValueChange={setVisibleFilter}>
              <SelectTrigger className="h-9" data-testid="select-visible-filter">
                <SelectValue placeholder="Sve recenzije" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Sve recenzije</SelectItem>
                <SelectItem value="true">Samo vidljive</SelectItem>
                <SelectItem value="false">Samo skrivene</SelectItem>
              </SelectContent>
            </Select>

            <Select value={minRatingFilter} onValueChange={setMinRatingFilter}>
              <SelectTrigger className="h-9" data-testid="select-minrating-filter">
                <SelectValue placeholder="Min ocena" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Sve ocene</SelectItem>
                <SelectItem value="1">Min 1 ⭐</SelectItem>
                <SelectItem value="2">Min 2 ⭐</SelectItem>
                <SelectItem value="3">Min 3 ⭐</SelectItem>
                <SelectItem value="4">Min 4 ⭐</SelectItem>
                <SelectItem value="5">Min 5 ⭐</SelectItem>
              </SelectContent>
            </Select>

            <Select value={maxRatingFilter} onValueChange={setMaxRatingFilter}>
              <SelectTrigger className="h-9" data-testid="select-maxrating-filter">
                <SelectValue placeholder="Max ocena" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Sve ocene</SelectItem>
                <SelectItem value="1">Max 1 ⭐</SelectItem>
                <SelectItem value="2">Max 2 ⭐</SelectItem>
                <SelectItem value="3">Max 3 ⭐</SelectItem>
                <SelectItem value="4">Max 4 ⭐</SelectItem>
                <SelectItem value="5">Max 5 ⭐</SelectItem>
              </SelectContent>
            </Select>
            
            <Button variant="outline" className="h-9 w-full md:col-span-4 lg:col-span-5" onClick={handleResetFilters} data-testid="btn-reset-filters">
              <FilterX className="w-4 h-4 mr-2" /> Očisti filtere
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju recenzija.</div>
          ) : !reviews || reviews.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema pronađenih recenzija za odabrane filtere.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {reviews.map(review => (
                <div key={review.id} className={`p-6 flex flex-col md:flex-row gap-6 hover:bg-muted/10 transition-colors ${!review.visible ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`} data-testid={`review-card-${review.id}`}>
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star key={star} className={`w-4 h-4 ${star <= review.rating ? 'fill-primary text-primary' : 'fill-muted text-muted'}`} />
                            ))}
                          </div>
                          <span className="font-semibold text-foreground">{review.salonName}</span>
                          <span className="text-muted-foreground text-xs">• {review.serviceName}</span>
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">Napisao/la {review.customerName} - {new Date(review.date).toLocaleDateString('sr-RS')}</p>
                      </div>
                      
                      {!review.visible && (
                        <span className="shrink-0 inline-flex items-center gap-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2.5 py-0.5 rounded-full text-xs font-bold border border-red-200 dark:border-red-800">
                          <EyeOff className="w-3 h-3" /> SKRIVENO
                        </span>
                      )}
                    </div>
                    
                    <div className="bg-background rounded-lg border p-4 text-sm text-foreground/90 italic">
                      "{review.text}"
                    </div>
                  </div>
                  
                  <div className="flex flex-row md:flex-col items-center md:items-end justify-center md:justify-start gap-4 shrink-0 border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-6 border-border/50">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`vis-${review.id}`} className="text-xs cursor-pointer">{review.visible ? 'Vidljivo' : 'Skriveno'}</Label>
                      <Switch 
                        id={`vis-${review.id}`}
                        checked={review.visible} 
                        onCheckedChange={() => handleToggleVisibility(review.id, review.visible)}
                        disabled={actionGuard.isActive(`visibility:${review.id}`)}
                        data-testid={`toggle-visibility-${review.id}`}
                      />
                    </div>
                    
                    <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive hover:text-destructive-foreground border-destructive/30" onClick={() => handleDelete(review.id)} disabled={actionGuard.isActive(`delete:${review.id}`)} data-testid={`btn-delete-${review.id}`}>
                      <Trash2 className="w-4 h-4 mr-2" /> Obriši trajno
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
