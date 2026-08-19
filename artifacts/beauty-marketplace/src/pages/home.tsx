import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Search, MapPin, Star, CalendarDays, ArrowRight } from "lucide-react";
import { useListSalons } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  const { data: salons, isLoading } = useListSalons({ sort: 'recommended' });

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
            
            <div className="bg-background rounded-2xl shadow-xl p-2 md:p-3 flex flex-col md:flex-row gap-3 items-center w-full max-w-2xl">
              <div className="flex-1 flex items-center gap-3 w-full bg-muted/50 rounded-xl px-4 py-3">
                <Search className="text-muted-foreground w-5 h-5" />
                <input 
                  type="text" 
                  placeholder="Koji tretman tražite?" 
                  className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex-1 flex items-center gap-3 w-full bg-muted/50 rounded-xl px-4 py-3">
                <MapPin className="text-muted-foreground w-5 h-5" />
                <input 
                  type="text" 
                  placeholder="Lokacija (npr. Beograd)" 
                  className="bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <Button size="lg" className="w-full md:w-auto h-12 rounded-xl px-8" asChild>
                <Link href="/saloni">Pronađi</Link>
              </Button>
            </div>
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
              { name: "Frizerski saloni", icon: "✂️", color: "bg-orange-100/50" },
              { name: "Masaža", icon: "🌿", color: "bg-emerald-100/50" },
              { name: "Manikir", icon: "💅", color: "bg-pink-100/50" },
              { name: "Kozmetičar", icon: "✨", color: "bg-blue-100/50" },
              { name: "Depilacija", icon: "🍯", color: "bg-yellow-100/50" },
              { name: "Spa & Wellness", icon: "🧖‍♀️", color: "bg-purple-100/50" },
            ].map((cat, i) => (
              <Link key={i} href={`/saloni?category=${cat.name}`} className={`${cat.color} rounded-2xl p-6 flex flex-col items-center justify-center gap-4 hover-elevate transition-all cursor-pointer group text-center`}>
                <span className="text-4xl group-hover:scale-110 transition-transform">{cat.icon}</span>
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
            <Button variant="ghost" className="hidden md:flex gap-2 group" asChild>
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
                    className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                  />
                  {salon.featured && (
                    <Badge className="absolute top-3 left-3 bg-white/90 text-primary hover:bg-white backdrop-blur-sm font-semibold">
                      Istaknuto
                    </Badge>
                  )}
                  <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg text-sm font-medium flex items-center gap-1 shadow-sm">
                    <Star className="w-3 h-3 fill-accent text-accent" />
                    <span>{salon.rating.toFixed(1)}</span>
                    <span className="text-muted-foreground text-xs">({salon.reviewCount})</span>
                  </div>
                </div>
                <div>
                  <h3 className="font-serif font-bold text-lg text-foreground group-hover:text-primary transition-colors line-clamp-1">{salon.name}</h3>
                  <p className="text-muted-foreground text-sm flex items-center gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {salon.city}, {salon.municipality}
                  </p>
                  <p className="text-sm font-medium mt-3">Od {salon.startingPrice} RSD</p>
                </div>
              </Link>
            ))}
          </div>
          
          <div className="mt-10 flex justify-center md:hidden">
            <Button variant="outline" className="w-full" asChild>
              <Link href="/saloni">Prikaži sve salone</Link>
            </Button>
          </div>
        </div>
      </section>
      
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <CalendarDays className="mx-auto h-10 w-10 mb-5 text-primary-foreground/80" />
          <h2 className="text-4xl md:text-5xl font-serif font-bold mb-5">Vaš sledeći termin je bliže nego što mislite.</h2>
          <p className="text-lg text-primary-foreground/80 mb-8 max-w-2xl mx-auto">
            Uporedite usluge, proverite slobodne termine i rezervišite vreme za sebe na jednom mestu.
          </p>
          <Button size="lg" variant="secondary" className="h-12 px-8 text-primary" asChild>
            <Link href="/saloni">Pronađi salon</Link>
          </Button>
          </div>
      </section>
    </Layout>
  );
}
