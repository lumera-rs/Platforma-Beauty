import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Search, MapPin, Star, CalendarDays, ArrowRight, Scissors, Leaf, Sparkles, Smile, Flower2, Droplets, Users, CheckCircle2 } from "lucide-react";
import { useListSalons, useGetPlatformTrustStats } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: salons, isLoading } = useListSalons({ sort: 'recommended' });
  const { data: trustStats } = useGetPlatformTrustStats();

  const [searchCategory, setSearchCategory] = useState("");
  const [searchCity, setSearchCity] = useState("");
  const categories = ["Frizerski saloni", "Masaža", "Nokti", "Kozmetički saloni", "Depilacija", "Wellness"];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchCategory) params.append("category", searchCategory);
    if (searchCity) params.append("city", searchCity);
    setLocation(`/saloni?${params.toString()}`);
  };

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative w-full bg-secondary pt-24 pb-32 md:pt-32 md:pb-48 overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=2574&auto=format&fit=crop')] opacity-10 bg-cover bg-center mix-blend-multiply" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-3xl">
            <Badge variant="outline" className="mb-6 border-primary/20 text-primary bg-primary/5 px-3 py-1 text-sm font-medium tracking-wide">
              NOVO U SRBIJI
            </Badge>
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-foreground leading-[1.1] mb-6">
              Pronađite <span className="text-primary italic">savršen</span> trenutak za sebe.
            </h1>
            <p className="text-lg md:text-xl text-foreground/80 mb-10 max-w-xl font-light">
              Otkrijte i rezervišite najbolje salone lepote, wellness centre i spa tretmane u vašem gradu. Vaše vreme je dragoceno.
            </p>
            
            <form onSubmit={handleSearch} className="bg-background rounded-2xl shadow-xl p-2 md:p-3 flex flex-col md:flex-row gap-3 items-center w-full max-w-2xl mb-8">
              <div className="flex-1 flex items-center gap-3 w-full bg-muted/50 rounded-xl px-4 py-3 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-colors">
                <Search className="text-muted-foreground w-5 h-5 shrink-0" />
                <select
                  value={searchCategory}
                  onChange={(e) => setSearchCategory(e.target.value)}
                  className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground text-base"
                  aria-label="Izaberite kategoriju"
                >
                  <option value="">Koju uslugu tražite?</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div className="flex-1 flex items-center gap-3 w-full bg-muted/50 rounded-xl px-4 py-3 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-colors">
                <MapPin className="text-muted-foreground w-5 h-5 shrink-0" />
                <input 
                  type="text"
                  list="hero-city-options"
                  value={searchCity}
                  onChange={(e) => setSearchCity(e.target.value)}
                  placeholder="Lokacija (npr. Beograd)" 
                  className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground text-base"
                />
                <datalist id="hero-city-options">
                  <option value="Beograd" />
                  <option value="Novi Sad" />
                  <option value="Niš" />
                  <option value="Kragujevac" />
                </datalist>
              </div>
              <Button type="submit" size="lg" className="w-full md:w-auto h-12 rounded-xl px-8 font-medium">
                Pronađi
              </Button>
            </form>

            {trustStats ? (
              <div className="flex flex-wrap items-center gap-6 text-sm font-medium text-foreground/80 mt-12 animate-in fade-in slide-in-from-bottom-4 duration-1000 fill-mode-forwards">
                <div className="flex items-center gap-2 bg-background/50 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm border border-border/50">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span><strong className="text-foreground">{trustStats.activeSalons.toLocaleString("sr")}</strong> aktivnih salona</span>
                </div>
                <div className="flex items-center gap-2 bg-background/50 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm border border-border/50">
                  <CalendarDays className="w-4 h-4 text-blue-600" />
                  <span><strong className="text-foreground">{trustStats.bookingsThisMonth.toLocaleString("sr")}</strong> zakazivanja ovog meseca</span>
                </div>
                <div className="flex items-center gap-2 bg-background/50 backdrop-blur-sm px-4 py-2 rounded-full shadow-sm border border-border/50">
                  <Users className="w-4 h-4 text-primary" />
                  <span><strong className="text-foreground">{trustStats.customerAccounts.toLocaleString("sr")}</strong> zadovoljnih korisnika</span>
                </div>
              </div>
            ) : (
              <div className="mt-12 flex flex-wrap gap-3" aria-label="Učitavanje statistika platforme">
                <Skeleton className="h-10 w-44 rounded-full" />
                <Skeleton className="h-10 w-52 rounded-full" />
                <Skeleton className="h-10 w-48 rounded-full" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Featured Categories */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-3xl font-serif font-bold mb-3">Popularne usluge</h2>
              <p className="text-muted-foreground">Ono što naši korisnici najviše traže ove nedelje</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[
              { name: "Frizerski saloni", icon: Scissors, color: "bg-orange-100/50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400" },
              { name: "Masaža", icon: Leaf, color: "bg-emerald-100/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400" },
              { name: "Nokti", icon: Sparkles, color: "bg-pink-100/50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-400" },
              { name: "Kozmetički saloni", icon: Smile, color: "bg-blue-100/50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400" },
              { name: "Depilacija", icon: Flower2, color: "bg-yellow-100/50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400" },
              { name: "Wellness", icon: Droplets, color: "bg-purple-100/50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400" },
            ].map((cat, i) => (
              <Link key={i} href={`/saloni?category=${encodeURIComponent(cat.name)}`} className={`rounded-2xl p-6 flex flex-col items-center justify-center gap-4 hover:shadow-md transition-all cursor-pointer group text-center border border-transparent hover:border-border bg-card`}>
                <div className={`p-4 rounded-full ${cat.color} group-hover:scale-110 transition-transform duration-300`}>
                  <cat.icon className="w-8 h-8" strokeWidth={1.5} />
                </div>
                <span className="font-medium text-sm text-foreground/90">{cat.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Salons */}
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-4xl font-serif font-bold mb-4">Preporučujemo za vas</h2>
              <p className="text-muted-foreground text-lg">Najbolje ocenjeni saloni u vašoj blizini sa proverenim recenzijama.</p>
            </div>
            <Button variant="ghost" className="hidden md:flex gap-2 group font-medium" asChild>
              <Link href="/saloni">
                Svi saloni <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {isLoading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="flex flex-col gap-3">
                  <Skeleton className="w-full aspect-[4/3] rounded-2xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))
            ) : salons?.slice(0, 4).map((salon) => (
              <Link key={salon.id} href={`/saloni/${salon.slug}`} className="group cursor-pointer flex flex-col gap-3">
                <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden mb-2">
                  <img 
                    src={salon.imageUrl || "https://images.unsplash.com/photo-1521590832167-7bfc17484d20?q=80&w=800&auto=format&fit=crop"} 
                    alt={salon.name}
                    className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-700 ease-out"
                  />
                  <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors duration-500" />
                  {salon.featured && (
                    <Badge className="absolute top-3 left-3 bg-white/95 text-primary hover:bg-white backdrop-blur-md font-semibold border-none shadow-sm">
                      Istaknuto
                    </Badge>
                  )}
                  <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-md px-2.5 py-1.5 rounded-lg text-sm font-bold flex items-center gap-1.5 shadow-sm text-foreground">
                    <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                    <span>{salon.rating.toFixed(1)}</span>
                    <span className="text-muted-foreground text-xs font-medium">({salon.reviewCount})</span>
                  </div>
                </div>
                <div>
                  <h3 className="font-serif font-bold text-xl text-foreground group-hover:text-primary transition-colors line-clamp-1">{salon.name}</h3>
                  <p className="text-muted-foreground text-sm flex items-center gap-1.5 mt-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {salon.city}, {salon.municipality}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-sm font-semibold">Od {salon.startingPrice.toLocaleString("sr")} RSD</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          
          <div className="mt-10 flex justify-center md:hidden">
            <Button variant="outline" className="w-full h-12 rounded-xl" asChild>
              <Link href="/saloni">Prikaži sve salone</Link>
            </Button>
          </div>
        </div>
      </section>
      
      <section className="py-20 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://images.unsplash.com/photo-1540555700478-4be289fbecef?q=80&w=2574&auto=format&fit=crop')] bg-cover bg-center mix-blend-overlay" />
        <div className="container mx-auto px-4 text-center relative z-10">
          <CalendarDays className="mx-auto h-12 w-12 mb-6 text-primary-foreground/90" strokeWidth={1.5} />
          <h2 className="text-4xl md:text-5xl font-serif font-bold mb-6 tracking-tight">Vaš sledeći termin je bliže nego što mislite.</h2>
          <p className="text-lg text-primary-foreground/90 mb-10 max-w-2xl mx-auto font-light">
            Uporedite usluge, proverite slobodne termine i rezervišite vreme za sebe na jednom mestu.
          </p>
          <Button size="lg" variant="secondary" className="h-14 px-10 text-primary font-semibold text-lg rounded-xl shadow-lg hover:shadow-xl transition-shadow" asChild>
            <Link href="/saloni">Pronađi salon</Link>
          </Button>
        </div>
      </section>
    </Layout>
  );
}
