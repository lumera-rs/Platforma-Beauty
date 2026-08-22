import { Layout } from "@/components/layout";
import { useListSalons, type ListSalonsParams } from "@workspace/api-client-react";
import { Link, useSearch } from "wouter";
import { MapPin, Star, SlidersHorizontal, BadgeCheck, Zap, CreditCard, Clock3, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState, useRef } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SalonFavoriteButton } from "@/components/salon-favorite-button";

const PAGE_SIZE = 6;
const salonSortValues = ["recommended", "top-rated", "cheapest", "largest-discount", "nearest", "first-available", "most-popular", "most-booked-recently", "newest"] as const;

function isSalonSort(value: string | null): value is NonNullable<ListSalonsParams["sort"]> {
  return value !== null && (salonSortValues as readonly string[]).includes(value);
}

export default function Salons() {
  const searchString = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);

  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [city, setCity] = useState(searchParams.get("city") || "");
  const [municipality, setMunicipality] = useState("");
  const [brand, setBrand] = useState("");
  const [priceMax, setPriceMax] = useState<number | undefined>();
  const [minReviewCount, setMinReviewCount] = useState<number | undefined>();
  const [sort, setSort] = useState<ListSalonsParams["sort"]>("recommended");
  const [discountsOnly, setDiscountsOnly] = useState(false);
  const [menOnly, setMenOnly] = useState(false);
  const [acceptsCards, setAcceptsCards] = useState(false);
  const [openSunday, setOpenSunday] = useState(false);
  const [instantBooking, setInstantBooking] = useState(false);
  const [topSalon, setTopSalon] = useState(false);
  const [featured, setFeatured] = useState(false);
  const [homeService, setHomeService] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationNote, setLocationNote] = useState("");
  const [page, setPage] = useState(1);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sort !== "nearest") return;
    if (!navigator.geolocation) { setLocationNote("Pregledač ne podržava lokaciju — prikazano preporučeno."); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }); setLocationNote("Sortirano prema vašoj lokaciji."); },
      () => { setLocation(null); setLocationNote("Lokacija nije odobrena — prikazano preporučeno."); },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
    );
  }, [sort]);

  useEffect(() => {
    setCategory(searchParams.get("category") || "");
    setCity(searchParams.get("city") || "");
    const sortFromQuery = searchParams.get("sort");
    setSort(isSalonSort(sortFromQuery) ? sortFromQuery : "recommended");
    setDiscountsOnly(searchParams.get("discountsOnly") === "true");
    setMenOnly(searchParams.get("gender") === "men");
    setAcceptsCards(searchParams.get("acceptsCards") === "true");
    setOpenSunday(searchParams.get("openSunday") === "true");
    setInstantBooking(searchParams.get("instantBooking") === "true");
    setHomeService(searchParams.get("homeService") === "true");
    setTopSalon(searchParams.get("topSalon") === "true");
    setFeatured(searchParams.get("featured") === "true");
    const minReviewCountFromQuery = Number(searchParams.get("minReviewCount"));
    setMinReviewCount(Number.isFinite(minReviewCountFromQuery) && minReviewCountFromQuery > 0 ? minReviewCountFromQuery : undefined);
  }, [searchParams]);

  const params = useMemo<ListSalonsParams>(() => ({
    category: category || undefined, city: city || undefined, municipality: municipality || undefined, brand: brand || undefined, priceMax, minReviewCount,
    sort, discountsOnly: discountsOnly || undefined, gender: menOnly ? "men" : undefined,
    acceptsCards: acceptsCards || undefined, openSunday: openSunday || undefined,
    instantBooking: instantBooking || undefined, homeService: homeService || undefined, topSalon: topSalon || undefined, featured: featured || undefined,
    latitude: sort === "nearest" ? location?.latitude : undefined, longitude: sort === "nearest" ? location?.longitude : undefined,
  }), [category, city, municipality, brand, priceMax, minReviewCount, sort, discountsOnly, menOnly, acceptsCards, openSunday, instantBooking, homeService, topSalon, featured, location]);

  const { data: allSalons, isLoading, isFetching } = useListSalons(params);
  const isResultsLoading = isLoading || isFetching;

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [params]);

  const categories = ["Frizerski saloni", "Muški frizeri", "Kozmetički saloni", "Depilacija", "Lice", "Nokti", "Masaža", "Telo", "Wellness", "Lux tretmani", "Paketi usluga", "Ordinacije i poliklinike"];

  const toggle = (label: string, checked: boolean, setChecked: (value: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm text-foreground/80 cursor-pointer hover:text-foreground">
      <input type="checkbox" className="accent-primary w-4 h-4 rounded border-border" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
      {label}
    </label>
  );

  const paginatedSalons = useMemo(() => {
    if (!allSalons) return [];
    return allSalons.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [allSalons, page]);

  const totalPages = allSalons ? Math.max(1, Math.ceil(allSalons.length / PAGE_SIZE)) : 1;
  const relativeLastBooked = (value: Date | string) => {
    const hours = Math.round((new Date(value).getTime() - Date.now()) / 3_600_000);
    if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat("sr", { numeric: "auto" }).format(hours, "hour");
    return new Intl.RelativeTimeFormat("sr", { numeric: "auto" }).format(Math.round(hours / 24), "day");
  };

  const goToPage = (nextPage: number) => {
    setPage(nextPage);
  };

  const FiltersContent = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-2 font-medium border-b pb-4 text-lg">
        <SlidersHorizontal className="w-5 h-5" /> Filteri
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Kategorija</h3>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
          {["Sve", ...categories].map(cat => (
            <label key={cat} className="flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground cursor-pointer">
              <input type="radio" name="category" className="accent-primary w-4 h-4" checked={(cat === "Sve" ? "" : cat) === category} onChange={() => setCategory(cat === "Sve" ? "" : cat)} />
              {cat}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Lokacija</h3>
        <Input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Grad (npr. Beograd)" className="h-10 bg-background" />
        <Input value={municipality} onChange={(event) => setMunicipality(event.target.value)} placeholder="Opština / deo grada" className="h-10 bg-background" />
        <Input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Brend proizvoda" className="h-10 bg-background" />
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Cenovni rang</h3>
        <select value={priceMax ?? ""} onChange={(event) => setPriceMax(event.target.value ? Number(event.target.value) : undefined)} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
          <option value="">Bez ograničenja</option>
          <option value="1000">Do 1.000 RSD</option>
          <option value="2500">Do 2.500 RSD</option>
          <option value="5000">Do 5.000 RSD</option>
          <option value="10000">Do 10.000 RSD</option>
        </select>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Dodatno</h3>
        <div className="space-y-2.5">
          {toggle("Samo popusti", discountsOnly, setDiscountsOnly)}
          {toggle("Saloni za muškarce", menOnly, setMenOnly)}
          {toggle("Prima platne kartice", acceptsCards, setAcceptsCards)}
          {toggle("Otvoren nedeljom", openSunday, setOpenSunday)}
          {toggle("Instant zakazivanje", instantBooking, setInstantBooking)}
          {toggle("Dolazak na adresu", homeService, setHomeService)}
          {toggle("Top Salon", topSalon, setTopSalon)}
          {toggle("Istaknuti saloni", featured, setFeatured)}
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={() => { setCategory(""); setCity(""); setMunicipality(""); setBrand(""); setPriceMax(undefined); setMinReviewCount(undefined); setDiscountsOnly(false); setMenOnly(false); setAcceptsCards(false); setOpenSunday(false); setInstantBooking(false); setHomeService(false); setTopSalon(false); setFeatured(false); }}>
        Resetuj filtere
      </Button>
    </div>
  );

  return (
    <Layout>
      <div className="bg-secondary/30 py-8 border-b">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2">Istražite salone</h1>
            <p className="text-muted-foreground text-base max-w-2xl">
              Pronađite najbolje salone i stručnjake za lepotu u vašoj blizini.
            </p>
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

      <div className="container mx-auto px-4 py-8 flex flex-col lg:flex-row gap-6 items-start h-[calc(100vh-200px)] min-h-[800px]">
        {/* Filters Sidebar - Desktop */}
        <aside className="hidden lg:block w-64 shrink-0 space-y-6 sticky top-24 h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar pr-4">
          <FiltersContent />
        </aside>

        <div className="flex-1 w-full h-full min-h-0">
          <div className="flex w-full h-full min-h-0">
            {/* List side */}
            <div className="flex-1 flex flex-col min-w-[50%] h-full">
              <div className="flex justify-between items-center mb-4 shrink-0">
                <p className="text-muted-foreground text-sm font-medium">
                  {isResultsLoading ? "Učitavanje..." : `Pronađeno ${allSalons?.length || 0} salona`}
                </p>
                <div className="flex items-center gap-2 text-sm">
                  <select value={sort} onChange={(event) => setSort(event.target.value as ListSalonsParams["sort"])} className="bg-transparent border border-border rounded-md px-2 py-1.5 outline-none text-sm font-medium focus:border-primary">
                    <option value="recommended">Preporučeno</option>
                    <option value="nearest">U mojoj blizini</option>
                    <option value="newest">Nedavno dodato</option>
                    <option value="top-rated">Najbolje ocenjeno</option>
                    <option value="cheapest">Najniža cena</option>
                    <option value="most-popular">Najpopularnije</option>
                    <option value="most-booked-recently">Najviše rezervacija u poslednjih 30 dana</option>
                    <option value="largest-discount">Najveći popust</option>
                    <option value="first-available">Prvi slobodan termin</option>
                  </select>
                </div>
              </div>

              <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar pr-2 grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
                {isResultsLoading ? (
                  Array(6).fill(0).map((_, i) => (
                    <div key={i} className="flex flex-col gap-3">
                      <Skeleton className="w-full aspect-[4/3] rounded-2xl" />
                      <Skeleton className="h-6 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  ))
                ) : allSalons?.length === 0 ? (
                  <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
                    Nije pronađen nijedan salon koji odgovara kriterijumima.
                  </div>
                ) : paginatedSalons?.map((salon) => (
                  <div key={salon.id} className="relative">
                   <Link
                    href={`/saloni/${salon.slug}`}
                      className="group cursor-pointer flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div className="relative w-full h-48 overflow-hidden bg-muted">
                      <img
                        src={salon.imageUrl || "https://images.unsplash.com/photo-1521590832167-7bfc17484d20?q=80&w=800&auto=format&fit=crop"}
                        alt={salon.name}
                        className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-700 ease-out"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                      <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                        {salon.featured && <Badge className="bg-white/95 text-primary hover:bg-white backdrop-blur-md font-semibold border-none shadow-sm">Istaknuto</Badge>}
                        {salon.topSalon && <Badge className="bg-amber-100/95 text-amber-900 hover:bg-amber-100 border-none shadow-sm backdrop-blur-md"><BadgeCheck className="mr-1 h-3.5 w-3.5" />Top Salon</Badge>}
                        {salon.instantBooking && <Badge className="bg-emerald-100/95 text-emerald-900 hover:bg-emerald-100 border-none shadow-sm backdrop-blur-md"><Zap className="mr-1 h-3.5 w-3.5" />Instant</Badge>}
                      </div>
                    </div>
                    <div className="p-5 pt-1">
                      <div className="flex justify-between items-start mt-2">
                        <h3 className="font-serif font-bold text-xl text-foreground group-hover:text-primary transition-colors line-clamp-1">{salon.name}</h3>
                        <div className="bg-muted px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 shadow-sm shrink-0">
                          <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                          {salon.rating.toFixed(1)}
                        </div>
                      </div>
                      <p className="text-muted-foreground text-sm flex items-center gap-1.5 mt-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        {salon.city}, {salon.municipality}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {salon.popularServices?.slice(0, 2).map((srv, i) => (
                          <span key={i} className="text-xs font-medium bg-secondary/50 text-secondary-foreground px-2 py-1 rounded-md truncate max-w-[120px]">
                            {srv}
                          </span>
                        ))}
                        {salon.popularServices?.length > 2 && (
                          <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-1 rounded-md shrink-0">
                            +{salon.popularServices.length - 2}
                          </span>
                        )}
                      </div>
                      {salon.lastBookedAt && <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Poslednji put zakazano {relativeLastBooked(salon.lastBookedAt)}</p>}
                    </div>
                  </Link>
                   <SalonFavoriteButton salonId={salon.id} className="absolute right-3 top-3" />
                  </div>
                ))}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="col-span-full flex items-center justify-center gap-2 mt-6 pb-6">
                    <Button variant="outline" size="sm" onClick={() => goToPage(Math.max(1, page - 1))} disabled={page === 1} className="h-9">
                      <ChevronLeft className="w-4 h-4 mr-1" /> Prethodna
                    </Button>
                    <span className="text-sm font-medium text-muted-foreground px-3">Strana {page} od {totalPages}</span>
                    <Button variant="outline" size="sm" onClick={() => goToPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="h-9">
                      Sledeća <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </Layout>
  );
}
