import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { AdminLayout } from "./layout";
import { useAdminListSalons, useAdminUpdateSalon, getAdminListSalonsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, Store, Building2, MapPin, CheckCircle, Crown, FilterX, BadgeCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

export default function AdminSalons() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  
  const [city, setCity] = useState("");
  const debouncedCity = useDebouncedSearch(city);
  
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [featuredFilter, setFeaturedFilter] = useState<string>("all");
  const [subStatusFilter, setSubStatusFilter] = useState<string>("all");

  const [page, setPage] = useState(1);
  const pageSize = 50;
  // Reset to the first page whenever any filter changes so results stay reachable.
  useEffect(() => { setPage(1); }, [debouncedSearch, debouncedCity, activeFilter, featuredFilter, subStatusFilter]);

  const queryParams = {
    search: debouncedSearch || undefined,
    city: debouncedCity || undefined,
    active: activeFilter === "all" ? undefined : activeFilter === "true",
    featured: featuredFilter === "all" ? undefined : featuredFilter === "true",
    subscriptionStatus: subStatusFilter === "all" ? undefined : subStatusFilter,
    page,
    pageSize,
  };

  const { data: salons, isLoading, error } = useAdminListSalons(queryParams);
  // customFetch returns only the body; infer next-page availability from length.
  const hasNextPage = (salons?.length ?? 0) === pageSize;
  const updateSalon = useAdminUpdateSalon();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  
  const mutateFnRef = useRef(updateSalon.mutate);
  mutateFnRef.current = updateSalon.mutate;

  const handleToggle = (id: string, field: 'active' | 'featured' | 'isVerified' | 'topSalon', currentValue: boolean) => {
    const actionKey = `${id}:${field}`;
    if (!actionGuard.begin(actionKey)) return;
    mutateFnRef.current({
      salonId: id,
      data: { [field]: !currentValue }
    }, {
      onSuccess: () => {
        toast.success("Salon uspešno ažuriran", { description: "Status salona je promenjen." });
        queryClient.invalidateQueries({ queryKey: getAdminListSalonsQueryKey() });
        actionGuard.end(actionKey);
      },
      onError: () => {
        toast.error("Greška", { description: "Nije moguće ažurirati salon." });
        actionGuard.end(actionKey);
      }
    });
  };

  const handleResetFilters = () => {
    setSearch("");
    setCity("");
    setActiveFilter("all");
    setFeaturedFilter("all");
    setSubStatusFilter("all");
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-serif font-bold text-foreground">Upravljanje Salonima</h1>
              <p className="text-muted-foreground text-sm">Pregled i kontrola statusa svih salona na platformi.</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-4 bg-card rounded-xl border shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Pretraži..." 
                className="pl-9 h-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-salons"
              />
            </div>
            <div>
              <Input 
                placeholder="Grad..." 
                className="h-9"
                value={city}
                onChange={e => setCity(e.target.value)}
                data-testid="input-city-filter"
              />
            </div>
            <Select value={activeFilter} onValueChange={setActiveFilter}>
              <SelectTrigger className="h-9" data-testid="select-active-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi statusi</SelectItem>
                <SelectItem value="true">Aktivni</SelectItem>
                <SelectItem value="false">Neaktivni</SelectItem>
              </SelectContent>
            </Select>
            <Select value={featuredFilter} onValueChange={setFeaturedFilter}>
              <SelectTrigger className="h-9" data-testid="select-featured-filter">
                <SelectValue placeholder="Izdvojeno" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi saloni</SelectItem>
                <SelectItem value="true">Izdvojeni</SelectItem>
                <SelectItem value="false">Nisu izdvojeni</SelectItem>
              </SelectContent>
            </Select>
            <Select value={subStatusFilter} onValueChange={setSubStatusFilter}>
              <SelectTrigger className="h-9" data-testid="select-substatus-filter">
                <SelectValue placeholder="Pretplata" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Sve pretplate</SelectItem>
                <SelectItem value="active">Aktivna</SelectItem>
                <SelectItem value="inactive">Neaktivna</SelectItem>
                <SelectItem value="trial">Probni period</SelectItem>
                <SelectItem value="none">Bez pretplate</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="h-9 w-full" onClick={handleResetFilters} data-testid="btn-reset-filters">
              <FilterX className="w-4 h-4 mr-2" /> Očisti
            </Button>
          </div>
        </div>

        <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="p-8 text-center text-destructive">Došlo je do greške pri učitavanju salona.</div>
          ) : !salons || salons.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-muted-foreground">
              <Store className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema pronađenih salona za odabrane filtere.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                  <tr>
                    <th className="px-6 py-4">Salon</th>
                    <th className="px-6 py-4">Grad</th>
                    <th className="px-6 py-4">Pretplata & Loyalty</th>
                    <th className="px-6 py-4 text-center">Aktivno</th>
                    <th className="px-6 py-4 text-center">Izdvojeno</th>
                    <th className="px-6 py-4 text-center">Top Salon</th>
                    <th className="px-6 py-4 text-center">Verifikovan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {salons.map(salon => (
                    <tr key={salon.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-salon-${salon.id}`}>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <Link href={`/admin/saloni/${salon.id}`} className="inline-flex items-center gap-1 font-semibold text-foreground text-base hover:text-primary hover:underline">{salon.name}{salon.isVerified && <BadgeCheck className="h-4 w-4 text-primary" aria-label="Verifikovan salon" />}</Link>
                          <span className="text-xs text-muted-foreground">Priključeno: {new Date(salon.createdAt).toLocaleDateString('sr-RS')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" /> {salon.city}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1 text-xs">
                          {salon.subscriptionPlan ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-blue-50 text-blue-700 border border-blue-200 w-fit">
                              <Building2 className="w-3 h-3" /> {salon.subscriptionPlan}
                            </span>
                          ) : <span className="text-muted-foreground italic">Nema pretplatu</span>}
                          
                          {salon.loyaltyTier ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-amber-50 text-amber-700 border border-amber-200 w-fit">
                              <Crown className="w-3 h-3" /> {salon.loyaltyTier}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center align-middle">
                        <div className="flex justify-center">
                          <Switch 
                            checked={salon.active} 
                            onCheckedChange={() => handleToggle(salon.id, 'active', salon.active)}
                            disabled={actionGuard.isActive(`${salon.id}:active`)}
                            data-testid={`toggle-active-${salon.id}`}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center align-middle">
                        <div className="flex justify-center">
                          <Switch
                            checked={salon.featured}
                            onCheckedChange={() => handleToggle(salon.id, 'featured', salon.featured)}
                            disabled={actionGuard.isActive(`${salon.id}:featured`)}
                            aria-label={`Izdvoji salon ${salon.name}`}
                            data-testid={`toggle-featured-${salon.id}`}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center align-middle">
                        <div className="flex justify-center">
                          <Switch
                            checked={salon.topSalon}
                            onCheckedChange={() => handleToggle(salon.id, 'topSalon', salon.topSalon)}
                            disabled={actionGuard.isActive(`${salon.id}:topSalon`)}
                            aria-label={`Označi ${salon.name} kao Top Salon`}
                            data-testid={`toggle-top-salon-${salon.id}`}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center align-middle">
                        <div className="flex justify-center">
                          <Switch
                            checked={salon.isVerified}
                            onCheckedChange={() => handleToggle(salon.id, 'isVerified', salon.isVerified)}
                            disabled={actionGuard.isActive(`${salon.id}:isVerified`)}
                            aria-label={`Verifikuj salon ${salon.name}`}
                            data-testid={`toggle-verified-${salon.id}`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!isLoading && !error && salons && salons.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} data-testid="btn-prev-page">Prethodna</Button>
            <span className="text-sm text-muted-foreground">Strana {page}</span>
            <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage(p => p + 1)} data-testid="btn-next-page">Sledeća</Button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
