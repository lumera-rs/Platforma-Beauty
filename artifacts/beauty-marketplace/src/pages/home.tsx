import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { OptimizedImage } from "@/components/optimized-image";
import {
  Search, MapPin, Star, CalendarDays, ArrowRight,
  Leaf, Sparkles, Users, CheckCircle2, ChevronRight, Clock, ShieldCheck, Heart
} from "lucide-react";
import {
  useGetMarketplaceHomeDiscovery,
  useGetPlatformTrustStats,
  useGetCurrentUser,
  useListCities
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DiscoveryCarousel } from "@/components/discovery-carousel";
import { useState, useEffect, useMemo } from "react";
import { HomeSalonCard, HomeDiscountSalonCard } from "@/components/home-salon-card";
import { useDebouncedSearch } from "@/hooks/use-debounce";

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: authData } = useGetCurrentUser();
  const { data: trustStats } = useGetPlatformTrustStats();
  const { data: cities, isLoading: isCitiesLoading } = useListCities();

  // Cities are derived server-side from active salons via the cached /cities
  // catalog. We deliberately avoid a hardcoded city array: until the live
  // catalog resolves we show a loading state, and if it is empty we show a
  // safe empty state — never stale, invented data.
  const cityOptions = useMemo(() => {
    if (cities && cities.length > 0) return cities.map((city) => city.name);
    return [];
  }, [cities]);
  const popularCityLinks = cityOptions.slice(0, 5);

  const [searchCategory, setSearchCategory] = useState("");
  const [sessionCity, setSessionCity] = useState("");
  const [heroCityInput, setHeroCityInput] = useState("");
  const debouncedHeroCityInput = useDebouncedSearch(heroCityInput);

  // Hydrate city from session storage on mount
  useEffect(() => {
    const savedCity = sessionStorage.getItem("lumera_home_city");
    if (savedCity) {
      setSessionCity(savedCity);
      setHeroCityInput(savedCity);
    }
  }, []);

  // Sync city to session storage and update discovery query when input settles
  useEffect(() => {
    if (debouncedHeroCityInput !== sessionCity) {
      sessionStorage.setItem("lumera_home_city", debouncedHeroCityInput);
      setSessionCity(debouncedHeroCityInput);
    }
  }, [debouncedHeroCityInput, sessionCity]);

  const { data: discovery, isLoading } = useGetMarketplaceHomeDiscovery(
    sessionCity ? { city: sessionCity } : undefined
  );

  const categories = ["Frizerski saloni", "Masaža", "Nokti", "Kozmetički saloni", "Depilacija", "Wellness"];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const city = heroCityInput.trim();
    if (city) {
      sessionStorage.setItem("lumera_home_city", city);
      setSessionCity(city);
    }
    if (searchCategory) params.append("category", searchCategory);
    if (city) params.append("city", city);
    setLocation(`/saloni?${params.toString()}`);
  };

  const getSeeAllHref = (context: "featured" | "new" | "discount" | "popular" | "rated") => {
    const params = new URLSearchParams();
    if (sessionCity) params.append("city", sessionCity);

    switch (context) {
      case "featured": params.append("featured", "true"); break;
      case "new": params.append("sort", "newest"); break;
      case "discount": params.append("discountsOnly", "true"); params.append("sort", "largest-discount"); break;
      case "popular": params.append("sort", "most-booked-recently"); break;
      case "rated": params.append("sort", "top-rated"); params.append("minReviewCount", "5"); break;
    }

    return `/saloni?${params.toString()}`;
  };

  const getCategoryHref = (category: string) => {
    const params = new URLSearchParams();
    params.append("category", category);
    if (sessionCity) params.append("city", sessionCity);
    return `/saloni?${params.toString()}`;
  };

  return (
    <Layout>
      {/* Hero Section - Quiet Luxury aesthetic */}
      <section className="relative w-full bg-secondary pt-16 pb-20 md:pt-20 md:pb-24 overflow-hidden">
        {/* We use a generated elegant background to set the tone */}
        <div className="absolute inset-0 bg-[url('/hero-bg.jpg')] opacity-20 bg-cover bg-center mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-b from-secondary/80 to-secondary/30 pointer-events-none" />

        <div className="container mx-auto px-4 relative z-10 flex flex-col items-center text-center">
          <Badge variant="outline" className="mb-4 border-primary/20 text-primary bg-primary/5 px-4 py-1.5 text-sm font-medium tracking-widest uppercase">
            Dobrodošli na Lumeru
          </Badge>
          <h1 className="text-5xl md:text-7xl font-serif font-bold text-foreground leading-[1.1] mb-4 max-w-4xl">
            Vreme za vas je <span className="text-primary italic">neprocenjivo.</span>
          </h1>
          <p className="text-lg md:text-xl text-foreground/80 mb-7 max-w-2xl font-light">
            Otkrijte i rezervišite najbolje salone lepote, wellness centre i spa tretmane, provereno od strane hiljada korisnika.
          </p>

          <form onSubmit={handleSearch} className="bg-background rounded-2xl shadow-xl p-3 flex flex-col md:flex-row gap-3 items-center w-full max-w-3xl mb-6 mx-auto">
            <div className="flex-1 flex items-center gap-3 w-full bg-secondary/50 rounded-xl px-4 py-3.5 border border-transparent focus-within:border-primary/30 focus-within:bg-background transition-colors">
              <Search className="text-muted-foreground w-5 h-5 shrink-0" />
              <select
                value={searchCategory}
                onChange={(e) => setSearchCategory(e.target.value)}
                className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground text-base cursor-pointer"
                aria-label="Izaberite kategoriju"
              >
                <option value="">Koju uslugu tražite?</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>

            <div className="hidden md:block w-px h-8 bg-border" />

            <div className="flex-1 flex items-center gap-3 w-full bg-secondary/50 rounded-xl px-4 py-3.5 border border-transparent focus-within:border-primary/30 focus-within:bg-background transition-colors">
              <MapPin className="text-muted-foreground w-5 h-5 shrink-0" />
              <input
                type="text"
                list="hero-city-options"
                value={heroCityInput}
                onChange={(e) => setHeroCityInput(e.target.value)}
                placeholder="Vaš grad (npr. Beograd)"
                className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground text-base"
                aria-label="Izaberite grad"
              />
              <datalist id="hero-city-options">
                {cityOptions.map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
            </div>
            <Button type="submit" size="lg" className="w-full md:w-auto h-14 rounded-xl px-10 font-semibold text-lg hover:scale-[1.02] transition-transform">
              Pronađi
            </Button>
          </form>

          {trustStats ? (
             <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8 text-sm md:text-base font-medium text-foreground/90 mt-2 animate-in fade-in slide-in-from-bottom-4 duration-1000 fill-mode-forwards">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span><strong className="text-foreground">{trustStats.activeSalons.toLocaleString("sr")}</strong> salona</span>
              </div>
              <div className="hidden md:block w-1.5 h-1.5 rounded-full bg-primary/20" />
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-blue-600" />
                <span><strong className="text-foreground">{trustStats.bookingsThisMonth.toLocaleString("sr")}</strong> rezervacija</span>
              </div>
              <div className="hidden md:block w-1.5 h-1.5 rounded-full bg-primary/20" />
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5 text-accent" />
                <span><strong className="text-foreground">{trustStats.customerAccounts.toLocaleString("sr")}</strong> korisnika</span>
              </div>
            </div>
          ) : (
             <div className="mt-2 flex flex-wrap justify-center gap-4" aria-label="Učitavanje statistika platforme">
              <Skeleton className="h-6 w-32 rounded-full" />
              <Skeleton className="h-6 w-32 rounded-full" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
          )}
        </div>
      </section>

      {/* Popular Categories / Services */}
      <section className="py-8 md:py-12 bg-background border-b border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2 text-primary">Popularne usluge</h2>
              <p className="text-muted-foreground text-lg">Ono što se najviše traži {sessionCity ? `u ${sessionCity}` : "ove nedelje"}</p>
            </div>
          </div>

          {isLoading ? (
            <DiscoveryCarousel ariaLabel="Učitavanje usluga">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="min-h-40 w-full rounded-2xl" />
              ))}
            </DiscoveryCarousel>
          ) : discovery?.popularServices && discovery.popularServices.length > 0 ? (
            <DiscoveryCarousel
              ariaLabel="Popularne usluge"
              itemClassName="basis-[70%] sm:basis-[38%] md:basis-1/4 lg:basis-1/6"
            >
              {discovery.popularServices.map((cat) => {
                return (
                  <Link
                    key={cat.categoryName}
                    href={getCategoryHref(cat.categoryName)}
                    className="group relative flex min-h-48 h-full cursor-pointer flex-col justify-end overflow-hidden rounded-2xl border border-border bg-muted shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <OptimizedImage
                      src={cat.imageUrl}
                      alt=""
                      width={400}
                      height={300}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/5" />
                    <div className="relative z-10 w-full p-5 text-left text-white">
                      <span className="block text-base font-bold leading-tight drop-shadow-sm">{cat.categoryName}</span>
                      <span className="mt-1 block text-xs font-semibold text-white/85">
                        {cat.bookingCount > 0 ? `${cat.bookingCount} rezervacija` : "Istražite ponudu"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </DiscoveryCarousel>
          ) : (
            <div className="text-center py-12 px-4 rounded-2xl bg-muted/30 border border-border border-dashed">
              <Leaf className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" strokeWidth={1} />
              <h3 className="text-lg font-serif font-medium text-foreground mb-2">Nema popularnih usluga</h3>
              <p className="text-muted-foreground">Pokušajte da promenite grad ili pretražite ručno.</p>
            </div>
          )}
        </div>
      </section>

      {/* How it Works - Trust Section */}
      <section className="py-8 md:py-12 bg-card">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-6">
            <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2 text-primary">Kako LUMERA funkcioniše?</h2>
            <p className="text-muted-foreground text-lg">Vaš put do savršenog tretmana u tri jednostavna koraka, bez stresa i pozivanja.</p>
          </div>

          <div className="hidden md:grid md:grid-cols-3 gap-5" aria-label="Kako LUMERA funkcioniše">
            <article className="group h-full rounded-2xl border border-primary/10 bg-background p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary transition-transform duration-300 group-hover:scale-105"><Search className="h-7 w-7" strokeWidth={1.5} /></div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">Korak 01</p><h3 className="mb-3 text-xl font-serif font-bold">Pronađite</h3>
              <p className="text-muted-foreground">Istražite stotine proverenih salona. Filtrirajte po lokaciji, ocenama i uslugama koje vas zanimaju.</p>
            </article>
            <article className="group h-full rounded-2xl border border-primary/10 bg-background p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary transition-transform duration-300 group-hover:scale-105"><CalendarDays className="h-7 w-7" strokeWidth={1.5} /></div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">Korak 02</p><h3 className="mb-3 text-xl font-serif font-bold">Rezervišite</h3>
              <p className="text-muted-foreground">Izaberite slobodan termin koji vam odgovara i rezervišite online u samo nekoliko klikova, 24/7.</p>
            </article>
            <article className="group h-full rounded-2xl border border-accent/20 bg-background p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent transition-transform duration-300 group-hover:scale-105"><Sparkles className="h-7 w-7" strokeWidth={1.5} /></div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent/70">Korak 03</p><h3 className="mb-3 text-xl font-serif font-bold">Uživajte</h3>
              <p className="text-muted-foreground">Pojavite se u salonu i uživajte u tretmanu. Podelite utiske i pomozite drugima u izboru.</p>
            </article>
          </div>
          <div className="md:hidden">
            <DiscoveryCarousel ariaLabel="Kako LUMERA funkcioniše" itemClassName="basis-[86%] sm:basis-[48%]">
              {/* The mobile rail intentionally keeps the next step in view. */}
              <article className="group h-full rounded-2xl border border-primary/10 bg-background p-6 text-left shadow-sm"><div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary"><Search className="h-7 w-7" strokeWidth={1.5} /></div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">Korak 01</p><h3 className="mb-3 text-xl font-serif font-bold">Pronađite</h3><p className="text-muted-foreground">Istražite stotine proverenih salona. Filtrirajte po lokaciji, ocenama i uslugama koje vas zanimaju.</p></article>
              <article className="group h-full rounded-2xl border border-primary/10 bg-background p-6 text-left shadow-sm"><div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary"><CalendarDays className="h-7 w-7" strokeWidth={1.5} /></div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">Korak 02</p><h3 className="mb-3 text-xl font-serif font-bold">Rezervišite</h3><p className="text-muted-foreground">Izaberite slobodan termin koji vam odgovara i rezervišite online u samo nekoliko klikova, 24/7.</p></article>
              <article className="group h-full rounded-2xl border border-accent/20 bg-background p-6 text-left shadow-sm"><div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Sparkles className="h-7 w-7" strokeWidth={1.5} /></div><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-accent/70">Korak 03</p><h3 className="mb-3 text-xl font-serif font-bold">Uživajte</h3><p className="text-muted-foreground">Pojavite se u salonu i uživajte u tretmanu. Podelite utiske i pomozite drugima u izboru.</p></article>
            </DiscoveryCarousel>
          </div>
        </div>
      </section>

      {/* Featured Salons (Top Salons) */}
      <section className="py-8 md:py-12 bg-muted/40">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2 text-primary">Istaknuti saloni</h2>
              <p className="text-muted-foreground text-lg">Najbolji i najpouzdaniji partneri platforme.</p>
            </div>
            <Button variant="ghost" className="hidden md:flex gap-2 group font-medium hover:bg-secondary/50 text-primary" asChild>
              <Link href={getSeeAllHref("featured")}>
                Prikaži sve <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <DiscoveryCarousel ariaLabel="Učitavanje salona">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-3 p-1">
                  <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </DiscoveryCarousel>
          ) : discovery?.featuredSalons && discovery.featuredSalons.length > 0 ? (
            <DiscoveryCarousel ariaLabel="Istaknuti saloni">
              {discovery.featuredSalons.map((salon) => (
                <HomeSalonCard key={salon.id} salon={salon} />
              ))}
            </DiscoveryCarousel>
          ) : (
            <div className="text-center py-16 px-4 rounded-2xl bg-card border border-border shadow-sm">
              <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" strokeWidth={1} />
              <h3 className="text-xl font-serif font-medium text-foreground mb-2">Trenutno nema istaknutih salona</h3>
              <p className="text-muted-foreground">Pokušajte da proširite pretragu na drugi grad.</p>
            </div>
          )}

          <div className="mt-10 flex justify-center md:hidden">
            <Button variant="outline" className="w-full h-12 rounded-xl border-primary/20 text-primary" asChild>
              <Link href={getSeeAllHref("featured")}>Prikaži sve istaknute salone</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Discounted Salons */}
      <section className="py-8 md:py-12 bg-card border-y border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2 text-destructive">Specijalne ponude</h2>
              <p className="text-muted-foreground text-lg">Uštedite uz akcije i popuste u odličnim salonima.</p>
            </div>
            <Button variant="ghost" className="hidden md:flex gap-2 group font-medium hover:bg-destructive/10 text-destructive" asChild>
              <Link href={getSeeAllHref("discount")}>
                Sve akcije <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <DiscoveryCarousel ariaLabel="Učitavanje popusta">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-3 p-1">
                  <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </DiscoveryCarousel>
          ) : discovery?.discountedSalons && discovery.discountedSalons.length > 0 ? (
            <DiscoveryCarousel ariaLabel="Saloni sa popustom">
              {discovery.discountedSalons.map((salon) => (
                <HomeDiscountSalonCard key={salon.id} salon={salon} />
              ))}
            </DiscoveryCarousel>
          ) : (
            <div className="text-center py-16 px-4 rounded-2xl bg-muted/20 border border-border border-dashed">
              <span className="text-4xl mb-4 block opacity-40">%</span>
              <h3 className="text-xl font-serif font-medium text-foreground mb-2">Trenutno nema aktivnih akcija</h3>
              <p className="text-muted-foreground">Saloni redovno objavljuju nove popuste, proverite ponovo uskoro.</p>
            </div>
          )}
        </div>
      </section>

      {/* New Salons */}
      <section className="py-8 md:py-12 bg-muted/40">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2 text-primary">Novi na platformi</h2>
              <p className="text-muted-foreground text-lg">Budite među prvima koji će isprobati ove sjajne nove salone.</p>
            </div>
            <Button variant="ghost" className="hidden md:flex gap-2 group font-medium hover:bg-secondary/50 text-primary" asChild>
              <Link href={getSeeAllHref("new")}>
                Svi novi <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <DiscoveryCarousel ariaLabel="Učitavanje novih salona">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-3 p-1">
                  <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </DiscoveryCarousel>
          ) : discovery?.newSalons && discovery.newSalons.length > 0 ? (
            <DiscoveryCarousel ariaLabel="Novi saloni">
              {discovery.newSalons.map((salon) => (
                <HomeSalonCard key={salon.id} salon={salon} />
              ))}
            </DiscoveryCarousel>
          ) : (
            <div className="text-center py-16 px-4 rounded-2xl bg-card border border-border shadow-sm">
              <Sparkles className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" strokeWidth={1} />
              <h3 className="text-xl font-serif font-medium text-foreground mb-2">Nema novih salona</h3>
              <p className="text-muted-foreground">Redovno dodajemo nove salone.</p>
            </div>
          )}
        </div>
      </section>

      {/* Popular Salons */}
      <section className="py-8 md:py-12 bg-card border-b border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2 text-primary">Najtraženiji saloni</h2>
              <p className="text-muted-foreground text-lg">Mesta gde se traži termin više.</p>
            </div>
            <Button variant="ghost" className="hidden md:flex gap-2 group font-medium hover:bg-secondary/50 text-primary" asChild>
              <Link href={getSeeAllHref("popular")}>
                Svi popularni <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <DiscoveryCarousel ariaLabel="Učitavanje popularnih salona">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-3 p-1">
                  <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </DiscoveryCarousel>
          ) : discovery?.popularSalons && discovery.popularSalons.length > 0 ? (
            <DiscoveryCarousel ariaLabel="Najtraženiji saloni">
              {discovery.popularSalons.map((salon) => (
                <HomeSalonCard key={salon.id} salon={salon} />
              ))}
            </DiscoveryCarousel>
          ) : (
            <div className="text-center py-16 px-4 rounded-2xl bg-muted/20 border border-border shadow-sm">
              <Users className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" strokeWidth={1} />
              <h3 className="text-xl font-serif font-medium text-foreground mb-2">Nedovoljno podataka</h3>
              <p className="text-muted-foreground">Nemamo dovoljno podataka o popularnosti za ovu lokaciju.</p>
            </div>
          )}
        </div>
      </section>

      {/* Auth CTA - Only for non-logged in users */}
      {(!authData || !authData.user) && (
        <section className="py-24 bg-primary text-primary-foreground relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('/cta-bg.jpg')] bg-cover bg-center mix-blend-overlay" />
          <div className="container mx-auto px-4 relative z-10 text-center max-w-3xl">
            <h2 className="text-4xl md:text-5xl font-serif font-bold mb-6">Pristupite ekskluzivnim prednostima</h2>
            <p className="text-lg text-primary-foreground/80 mb-10 max-w-xl mx-auto font-light">
              Kreirajte nalog besplatno. Pratite svoje rezervacije, ostvarite loyalty poene, sačuvajte omiljene salone i ostavite recenzije.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" variant="secondary" className="h-14 px-10 font-bold text-primary rounded-xl shadow-lg hover:shadow-xl transition-shadow w-full sm:w-auto" asChild>
                <Link href="/prijava">Prijavite se</Link>
              </Button>
               <Button size="lg" variant="outline" className="h-14 w-full rounded-xl border-primary-foreground/60 bg-transparent px-10 font-medium text-primary-foreground hover:border-primary-foreground hover:bg-primary-foreground hover:text-primary sm:w-auto" asChild>
                <Link href="/za-biznise">Imate salon?</Link>
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Top Rated Salons */}
      <section className="py-8 md:py-12 bg-card">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-3xl md:text-4xl font-serif font-bold mb-2 text-primary">Najbolje ocenjeni</h2>
              <p className="text-muted-foreground text-lg">Saloni kojima korisnici neprestano daju 5 zvezdica.</p>
            </div>
            <Button variant="ghost" className="hidden md:flex gap-2 group font-medium hover:bg-secondary/50 text-primary" asChild>
              <Link href={getSeeAllHref("rated")}>
                Prikaži sve <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>

          {isLoading ? (
            <DiscoveryCarousel ariaLabel="Učitavanje najbolje ocenjenih salona">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex flex-col gap-3 p-1">
                  <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </DiscoveryCarousel>
          ) : discovery?.topRatedSalons && discovery.topRatedSalons.length > 0 ? (
            <DiscoveryCarousel ariaLabel="Najbolje ocenjeni saloni">
              {discovery.topRatedSalons.map((salon) => (
                <HomeSalonCard key={salon.id} salon={salon} />
              ))}
            </DiscoveryCarousel>
          ) : (
            <div className="text-center py-16 px-4 rounded-2xl bg-muted/20 border border-border shadow-sm">
              <Star className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" strokeWidth={1} />
              <h3 className="text-xl font-serif font-medium text-foreground mb-2">Nedovoljno ocena</h3>
              <p className="text-muted-foreground">Korisnici još nisu ocenili dovoljno salona u ovom gradu.</p>
            </div>
          )}
        </div>
      </section>

      {/* SEO Linking Block */}
      <section className="py-16 bg-muted/60 border-t border-border">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
            <div>
              <h4 className="font-serif font-bold text-lg mb-6 text-foreground">Popularni gradovi</h4>
              {isCitiesLoading && popularCityLinks.length === 0 ? (
                <ul className="space-y-3" aria-label="Učitavanje gradova">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <li key={index}>
                      <Skeleton className="h-4 w-24 rounded" />
                    </li>
                  ))}
                </ul>
              ) : popularCityLinks.length > 0 ? (
                <ul className="space-y-3">
                  {popularCityLinks.map((city) => (
                    <li key={city}>
                      <Link href={`/saloni?city=${encodeURIComponent(city)}`} className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-1.5 group">
                        <ChevronRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-primary" /> {city}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">Trenutno nema dostupnih gradova.</p>
              )}
            </div>
            <div>
              <h4 className="font-serif font-bold text-lg mb-6 text-foreground">Top usluge</h4>
              <ul className="space-y-3">
                {["Frizerski saloni", "Masaža", "Nokti", "Kozmetički saloni", "Depilacija"].map((cat) => (
                  <li key={cat}>
                    <Link href={getCategoryHref(cat)} className="text-muted-foreground hover:text-primary transition-colors text-sm flex items-center gap-1.5 group">
                      <ChevronRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-primary" /> {cat}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="col-span-2 md:col-span-2">
              <h4 className="font-serif font-bold text-lg mb-6 text-foreground">O platformi LUMERA</h4>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                LUMERA je vodeća platforma za zakazivanje termina u salonima lepote i wellness centrima u Srbiji.
                Naša misija je da olakšamo proces pronalaženja i rezervacije pravih usluga, štedeći vaše dragoceno vreme.
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Ponosimo se transparentnim recenzijama, pouzdanim partnerima i jednostavnim sistemom koji stavlja korisnika na prvo mesto.
              </p>
            </div>
          </div>
        </div>
      </section>

    </Layout>
  );
}
