import { useMemo, useState, useEffect } from "react";
import { useSearch, useLocation, Link } from "wouter";
import { 
  useListBeautyJobs, 
  getListBeautyJobsQueryKey,
  useListBeautyJobCategories,
  getListBeautyJobCategoriesQueryKey,
  useToggleSavedBeautyJob,
  useGetCurrentUser,
  type ListBeautyJobsParams
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { CreateListingCta } from "@/components/beauty-jobs/create-listing-cta";
import { BeautyJobCard } from "@/components/beauty-jobs/beauty-job-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { SlidersHorizontal, ChevronLeft, ChevronRight, Briefcase, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 10;
const beautyJobSortValues = ["newest", "oldest", "price_asc", "price_desc", "nearest"] as const;
const beautyJobTypeValues = ["job", "equipment_rental", "space_rental", "freelance"] as const;
const beautyJobIntentValues = ["offering", "seeking"] as const;
const beautyJobListingModeValues = ["offering", "rental", "seeking", "seeking_work", "seeking_rental"] as const;

function isBeautyJobSort(value: string | null): value is NonNullable<ListBeautyJobsParams["sort"]> {
  return value !== null && (beautyJobSortValues as readonly string[]).includes(value);
}

function isBeautyJobType(value: string | null): value is NonNullable<ListBeautyJobsParams["type"]> {
  return value !== null && (beautyJobTypeValues as readonly string[]).includes(value);
}

function isBeautyJobIntent(value: string | null): value is NonNullable<ListBeautyJobsParams["intent"]> {
  return value !== null && (beautyJobIntentValues as readonly string[]).includes(value);
}

function isBeautyJobListingMode(value: string | null): value is NonNullable<ListBeautyJobsParams["listingMode"]> {
  return value !== null && (beautyJobListingModeValues as readonly string[]).includes(value);
}

function positiveNumberParam(params: URLSearchParams, key: string): number | undefined {
  const rawValue = params.get(key);
  if (rawValue === null || rawValue.trim() === "") return undefined;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export default function BeautyJobsPage() {
  const searchString = useSearch();
  const [historyVersion, setHistoryVersion] = useState(0);
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString, historyVersion]);
  const [, setLocationPath] = useLocation();
  
  const queryClient = useQueryClient();
  const { data: userResp, isLoading: isLoadingUser } = useGetCurrentUser();
  const user = userResp?.user;

  useEffect(() => {
    const rehydrateFromHistory = () => setHistoryVersion((version) => version + 1);
    window.addEventListener("popstate", rehydrateFromHistory);
    return () => window.removeEventListener("popstate", rehydrateFromHistory);
  }, []);

  useEffect(() => {
    if (!isLoadingUser && user?.role === "SALON_EMPLOYEE") {
      setLocationPath("/zaposleni");
    }
  }, [isLoadingUser, user, setLocationPath]);

  // Filter State from URL
  const query = searchParams.get("query") || "";
  const rawType = searchParams.get("type");
  const rawIntent = searchParams.get("intent");
  const rawListingMode = searchParams.get("listingMode");
  const type = isBeautyJobType(rawType) ? rawType : undefined;
  const intent = isBeautyJobIntent(rawIntent) ? rawIntent : undefined;
  const listingMode = isBeautyJobListingMode(rawListingMode) ? rawListingMode : undefined;
  const categorySlug = searchParams.get("category") || "";
  const city = searchParams.get("city") || "";
  const region = searchParams.get("region") || "";
  const minPrice = positiveNumberParam(searchParams, "minPrice");
  const maxPrice = positiveNumberParam(searchParams, "maxPrice");
  const availability = searchParams.get("availability") || "";
  const sort = isBeautyJobSort(searchParams.get("sort")) ? (searchParams.get("sort") as ListBeautyJobsParams["sort"]) : "newest";
  const parsedPage = Number(searchParams.get("page"));
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [locationCoords, setLocationCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const [localQuery, setLocalQuery] = useState(query);
  const [localCity, setLocalCity] = useState(city);
  const [localRegion, setLocalRegion] = useState(region);
  const [localAvailability, setLocalAvailability] = useState(availability);
  const [localMinPrice, setLocalMinPrice] = useState(minPrice ? String(minPrice) : "");
  const [localMaxPrice, setLocalMaxPrice] = useState(maxPrice ? String(maxPrice) : "");

  useEffect(() => {
    setLocalQuery(query);
    setLocalCity(city);
    setLocalRegion(region);
    setLocalAvailability(availability);
    setLocalMinPrice(minPrice === undefined ? "" : String(minPrice));
    setLocalMaxPrice(maxPrice === undefined ? "" : String(maxPrice));
  }, [query, city, region, availability, minPrice, maxPrice]);

  const debouncedQuery = useDebouncedSearch(localQuery);
  const debouncedCity = useDebouncedSearch(localCity);
  const debouncedRegion = useDebouncedSearch(localRegion);
  const debouncedAvailability = useDebouncedSearch(localAvailability);
  const debouncedMinPrice = useDebouncedSearch(localMinPrice);
  const debouncedMaxPrice = useDebouncedSearch(localMaxPrice);

  useEffect(() => {
    // avoid resetting page on mount
    if (debouncedQuery !== query || debouncedCity !== city || debouncedRegion !== region || debouncedAvailability !== availability || debouncedMinPrice !== (minPrice === undefined ? "" : String(minPrice)) || debouncedMaxPrice !== (maxPrice === undefined ? "" : String(maxPrice))) {
      updateFilters({ 
        query: debouncedQuery, 
        city: debouncedCity, 
        region: debouncedRegion, 
        availability: debouncedAvailability,
        minPrice: debouncedMinPrice, 
        maxPrice: debouncedMaxPrice 
      });
    }
  }, [debouncedQuery, debouncedCity, debouncedRegion, debouncedAvailability, debouncedMinPrice, debouncedMaxPrice, query, city, region, availability, minPrice, maxPrice]);

  const updateFilters = (updates: Record<string, string | number | undefined | null>) => {
    const newParams = new URLSearchParams(searchString);
    let filtersChanged = false;

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== "page") filtersChanged = true;
      if (value === undefined || value === null || value === "") {
        newParams.delete(key);
      } else {
        newParams.set(key, String(value));
      }
    });

    if (filtersChanged && !updates.page) {
      newParams.set("page", "1");
    }

    setLocationPath(`/poslovi?${newParams.toString()}`);
  };

  const { data: categoriesData } = useListBeautyJobCategories({
    query: {
      queryKey: getListBeautyJobCategoriesQueryKey(),
      enabled: !isLoadingUser && user?.role !== "SALON_EMPLOYEE",
    }
  });
  
  const toggleSaved = useToggleSavedBeautyJob();

  useEffect(() => {
    if (sort !== "nearest") return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocationCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude }); },
      () => { setLocationCoords(null); updateFilters({ sort: "newest" }); },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
    );
  }, [sort]);

  const filterParams = useMemo<ListBeautyJobsParams>(() => ({
    query: debouncedQuery || undefined,
    type,
    intent,
    listingMode,
    category: categorySlug || undefined,
    city: debouncedCity || undefined,
    region: debouncedRegion || undefined,
    minPrice,
    maxPrice,
    availability: debouncedAvailability || undefined,
    sort,
    latitude: sort === "nearest" ? locationCoords?.latitude : undefined,
    longitude: sort === "nearest" ? locationCoords?.longitude : undefined,
  }), [debouncedQuery, type, intent, listingMode, categorySlug, debouncedCity, debouncedRegion, minPrice, maxPrice, debouncedAvailability, sort, locationCoords]);

  const params = useMemo<ListBeautyJobsParams>(() => ({
    ...filterParams,
    page,
    pageSize: PAGE_SIZE,
  }), [filterParams, page]);

  const { data: pageJobs, isLoading, isFetching, error, refetch } = useListBeautyJobs(params, {
    query: { queryKey: getListBeautyJobsQueryKey(params), enabled: !isLoadingUser && user?.role !== "SALON_EMPLOYEE" },
  });

  const isResultsLoading = isLoading || isFetching;
  const paginatedJobs = pageJobs?.items ?? [];
  const totalJobs = pageJobs?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalJobs / PAGE_SIZE));
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  const handleToggleSaved = (jobId: string, currentState: boolean) => {
    if (!user) {
      setLocationPath("/prijava");
      return;
    }
    toggleSaved.mutate({ listingId: jobId }, {
      onSuccess: () => {
        toast.success(currentState ? "Oglas uklonjen iz sačuvanih." : "Oglas sačuvan.");
        queryClient.invalidateQueries({ queryKey: getListBeautyJobsQueryKey(params) });
      },
      onError: () => toast.error("Došlo je do greške.")
    });
  };

  const FiltersContent = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-2 font-medium border-b pb-4 text-lg">
        <SlidersHorizontal className="w-5 h-5" /> Filteri
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Pretraga</h3>
        <Input value={localQuery} onChange={(e) => setLocalQuery(e.target.value)} placeholder="Pretražite po ključnoj reči..." className="h-10 bg-background" />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Tip oglasa</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="type" className="accent-primary" checked={!type} onChange={() => updateFilters({ type: "" })} /> Svi oglasi
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="type" className="accent-primary" checked={type === "job"} onChange={() => updateFilters({ type: "job" })} /> Posao
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="type" className="accent-primary" checked={type === "freelance"} onChange={() => updateFilters({ type: "freelance" })} /> Freelance
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="type" className="accent-primary" checked={type === "space_rental"} onChange={() => updateFilters({ type: "space_rental" })} /> Prostor / Stolica
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="type" className="accent-primary" checked={type === "equipment_rental"} onChange={() => updateFilters({ type: "equipment_rental" })} /> Oprema
          </label>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Namera</h3>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="listingMode" className="accent-primary" checked={!listingMode && !intent} onChange={() => updateFilters({ listingMode: "", intent: "" })} /> Sve
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="listingMode" className="accent-primary" checked={listingMode === "offering"} onChange={() => updateFilters({ listingMode: "offering", intent: "" })} /> Nudim posao / usluge
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="listingMode" className="accent-primary" checked={listingMode === "rental"} onChange={() => updateFilters({ listingMode: "rental", intent: "" })} /> Izdajem opremu / prostor
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="listingMode" className="accent-primary" checked={listingMode === "seeking_work" || listingMode === "seeking"} onChange={() => updateFilters({ listingMode: "seeking_work", intent: "" })} /> Tražim posao / usluge
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="listingMode" className="accent-primary" checked={listingMode === "seeking_rental"} onChange={() => updateFilters({ listingMode: "seeking_rental", intent: "" })} /> Tražim opremu / prostor
          </label>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Kategorija</h3>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="radio" name="category" className="accent-primary" checked={!categorySlug} onChange={() => updateFilters({ category: "" })} /> Sve kategorije
          </label>
          {categoriesData?.categories?.map((cat) => (
            <label key={cat.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="category" className="accent-primary" checked={categorySlug === cat.slug} onChange={() => updateFilters({ category: cat.slug })} /> {cat.name}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Lokacija</h3>
        <Input value={localCity} onChange={(e) => setLocalCity(e.target.value)} placeholder="Grad (npr. Beograd)" className="h-10 bg-background" />
        <Input value={localRegion} onChange={(e) => setLocalRegion(e.target.value)} placeholder="Opština (npr. Vračar)" className="h-10 bg-background mt-2" />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Raspoloživost</h3>
        <Input value={localAvailability} onChange={(e) => setLocalAvailability(e.target.value)} placeholder="Npr. vikendom ili puno radno vreme" className="h-10 bg-background" />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Cena</h3>
        <div className="flex items-center gap-2">
          <Input type="number" value={localMinPrice} onChange={(e) => setLocalMinPrice(e.target.value)} placeholder="Min RSD" className="h-10 bg-background" />
          <span>-</span>
          <Input type="number" value={localMaxPrice} onChange={(e) => setLocalMaxPrice(e.target.value)} placeholder="Max RSD" className="h-10 bg-background" />
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={() => {
        setLocalQuery(""); setLocalCity(""); setLocalRegion(""); setLocalAvailability(""); setLocalMinPrice(""); setLocalMaxPrice("");
        updateFilters({ type: "", intent: "", listingMode: "", category: "", city: "", region: "", availability: "", minPrice: "", maxPrice: "", query: "", sort: "newest" });
      }}>
        Resetuj filtere
      </Button>
    </div>
  );

  return (
    <Layout>
      <div className="bg-primary/5 py-8 border-b border-primary/10">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2 flex items-center gap-3">
              <Briefcase className="w-8 h-8 text-primary" /> Beauty Poslovi
            </h1>
            <p className="text-muted-foreground text-base max-w-2xl">
              Najveća berza poslova i prostora u industriji lepote. Pronađite idealnog radnika, salon ili opremu za rad.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <CreateListingCta className="gap-2" />
            </div>
          </div>
          <div className="lg:hidden">
            <Sheet open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <SlidersHorizontal className="w-4 h-4" /> Filteri
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] sm:w-[400px] overflow-y-auto">
                <FiltersContent />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 flex flex-col lg:flex-row gap-6 items-start">
        <aside className="hidden lg:block w-64 shrink-0 space-y-6 sticky top-24 h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar pr-4">
          <FiltersContent />
        </aside>

        <div className="flex-1 w-full">
          <div className="flex w-full flex-col">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-4">
              <p className="text-muted-foreground text-sm font-medium">
                {isResultsLoading ? "Učitavanje..." : (paginatedJobs.length === 0 ? "Nema rezultata" : `Prikazano ${paginatedJobs.length} oglasa`)}
              </p>
              <div className="flex items-center gap-2 text-sm shrink-0">
                <select value={sort} onChange={(e) => updateFilters({ sort: e.target.value })} className="bg-transparent border border-border rounded-md px-2 py-1.5 outline-none text-sm font-medium focus:border-primary">
                  <option value="newest">Najnovije</option>
                  <option value="oldest">Najstarije</option>
                  <option value="nearest">U mojoj blizini</option>
                  <option value="price_asc">Cena rastuća</option>
                  <option value="price_desc">Cena opadajuća</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {isResultsLoading ? (
                Array(4).fill(0).map((_, i) => (
                  <div key={i} className="flex gap-4 p-4 rounded-xl border bg-card">
                    <Skeleton className="w-48 h-32 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-3">
                      <Skeleton className="w-32 h-6" />
                      <Skeleton className="w-3/4 h-8" />
                      <Skeleton className="w-1/2 h-4" />
                    </div>
                  </div>
                ))
              ) : error ? (
                <div role="alert" className="py-12 text-center bg-destructive/5 rounded-xl border border-destructive/20 flex flex-col items-center justify-center gap-3">
                  <p className="font-semibold">Oglasi trenutno nisu dostupni.</p>
                  <p className="text-sm text-muted-foreground">Proverite vezu i pokušajte ponovo.</p>
                  <Button variant="outline" onClick={() => refetch()} className="gap-2">
                    <RefreshCw className="h-4 w-4" /> Pokušaj ponovo
                  </Button>
                </div>
              ) : paginatedJobs.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-xl border border-dashed flex flex-col items-center justify-center gap-3">
                  <Briefcase className="w-10 h-10 opacity-20" />
                  <p>Nije pronađen nijedan oglas koji odgovara kriterijumima.</p>
                </div>
              ) : paginatedJobs.map((job) => (
                <BeautyJobCard 
                  key={job.id} 
                  job={job} 
                  showSaveButton={user?.role === 'JOBSEEKER' || user?.role === 'SALON_OWNER' || user?.role === 'EDUKATIVNI_CENTAR'}
                  onClickToggleSaved={() => handleToggleSaved(job.id, !!job.isSaved)}
                />
              ))}

              {(hasPreviousPage || hasNextPage) && (
                <div className="flex items-center justify-center gap-2 mt-4 pb-8">
                  <Button variant="outline" size="sm" onClick={() => updateFilters({ page: Math.max(1, page - 1) })} disabled={!hasPreviousPage}>
                    <ChevronLeft className="w-4 h-4 mr-1" /> Prethodna
                  </Button>
                  <span className="text-sm font-medium text-muted-foreground px-3">Strana {page} od {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => updateFilters({ page: Math.min(totalPages, page + 1) })} disabled={!hasNextPage}>
                    Sledeća <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}