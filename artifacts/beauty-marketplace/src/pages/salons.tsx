import { Layout } from "@/components/layout";
import { useListSalons } from "@workspace/api-client-react";
import { Link } from "wouter";
import { MapPin, Star, Filter, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

export default function Salons() {
  const { data: salons, isLoading } = useListSalons();

  return (
    <Layout>
      <div className="bg-secondary/30 py-8 md:py-12 border-b">
        <div className="container mx-auto px-4">
          <h1 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-4">Istražite salone</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Pronađite najbolje salone i stručnjake za lepotu u vašoj blizini. Filtrirajte po uslugama, lokaciji i ocenama.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8">
        {/* Filters Sidebar */}
        <aside className="w-full md:w-64 shrink-0 space-y-6">
          <div className="bg-card border rounded-xl p-5 shadow-sm space-y-6 sticky top-24">
            <div className="flex items-center gap-2 font-medium border-b pb-4">
              <SlidersHorizontal className="w-4 h-4" /> Filteri
            </div>
            
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Kategorija</h3>
              <div className="space-y-2">
                {["Sve", "Frizerski saloni", "Masaža", "Manikir", "Kozmetičar"].map(cat => (
                  <label key={cat} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                    <input type="radio" name="category" className="accent-primary" />
                    {cat}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Lokacija</h3>
              <Input placeholder="Unesite grad..." className="h-9" />
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Minimalna ocena</h3>
              <div className="space-y-2">
                {[5, 4, 3].map(rating => (
                  <label key={rating} className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input type="radio" name="rating" className="accent-primary" />
                    <span className="flex items-center gap-1">
                      {rating}+ <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <Button className="w-full">Primeni filtere</Button>
          </div>
        </aside>

        {/* Results */}
        <div className="flex-1">
          <div className="flex justify-between items-center mb-6">
            <p className="text-muted-foreground text-sm font-medium">
              {isLoading ? "Učitavanje..." : `Pronađeno ${salons?.length || 0} salona`}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Sortiraj po:</span>
              <select className="bg-transparent border rounded-md px-2 py-1 outline-none text-sm font-medium">
                <option value="recommended">Preporučeno</option>
                <option value="top-rated">Najbolje ocenjeno</option>
                <option value="cheapest">Najniža cena</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {isLoading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="flex flex-col gap-3">
                  <Skeleton className="w-full aspect-[4/3] rounded-2xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))
            ) : salons?.length === 0 ? (
              <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
                Nije pronađen nijedan salon koji odgovara kriterijumima.
              </div>
            ) : salons?.map((salon) => (
              <Link key={salon.id} href={`/saloni/${salon.slug}`} className="group cursor-pointer flex flex-col gap-3 bg-card border rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
                <div className="relative w-full aspect-[4/3] overflow-hidden">
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
                </div>
                <div className="p-4 pt-1">
                  <div className="flex justify-between items-start mt-2">
                    <h3 className="font-serif font-bold text-lg text-foreground group-hover:text-primary transition-colors line-clamp-1">{salon.name}</h3>
                    <div className="bg-muted px-1.5 py-0.5 rounded text-xs font-bold flex items-center gap-1">
                      <Star className="w-3 h-3 fill-accent text-accent" />
                      {salon.rating.toFixed(1)}
                    </div>
                  </div>
                  <p className="text-muted-foreground text-sm flex items-center gap-1 mt-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {salon.city}, {salon.municipality}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {salon.popularServices?.slice(0, 2).map((srv, i) => (
                      <span key={i} className="text-xs bg-secondary/50 text-secondary-foreground px-2 py-1 rounded-md">
                        {srv}
                      </span>
                    ))}
                    {salon.popularServices?.length > 2 && (
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-md">
                        +{salon.popularServices.length - 2}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
