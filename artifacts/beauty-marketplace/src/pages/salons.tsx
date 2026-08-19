import { Layout } from "@/components/layout";
import { useListSalons, type ListSalonsParams } from "@workspace/api-client-react";
import { Link } from "wouter";
import { MapPin, Star, SlidersHorizontal, BadgeCheck, Zap, CreditCard, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";

export default function Salons() {
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [brand, setBrand] = useState("");
  const [priceMax, setPriceMax] = useState<number | undefined>();
  const [sort, setSort] = useState<ListSalonsParams["sort"]>("recommended");
  const [discountsOnly, setDiscountsOnly] = useState(false);
  const [menOnly, setMenOnly] = useState(false);
  const [acceptsCards, setAcceptsCards] = useState(false);
  const [openSunday, setOpenSunday] = useState(false);
  const [instantBooking, setInstantBooking] = useState(false);
  const [topSalon, setTopSalon] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationNote, setLocationNote] = useState("");
  useEffect(() => {
    if (sort !== "nearest") return;
    if (!navigator.geolocation) { setLocationNote("Pregledač ne podržava lokaciju — prikazano preporučeno."); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude }); setLocationNote("Sortirano prema vašoj lokaciji."); },
      () => { setLocation(null); setLocationNote("Lokacija nije odobrena — prikazano preporučeno."); },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
    );
  }, [sort]);
  const params = useMemo<ListSalonsParams>(() => ({
    category: category || undefined, city: city || undefined, municipality: municipality || undefined, brand: brand || undefined, priceMax,
    sort, discountsOnly: discountsOnly || undefined, gender: menOnly ? "men" : undefined,
    acceptsCards: acceptsCards || undefined, openSunday: openSunday || undefined,
    instantBooking: instantBooking || undefined, topSalon: topSalon || undefined,
    latitude: sort === "nearest" ? location?.latitude : undefined, longitude: sort === "nearest" ? location?.longitude : undefined,
  }), [category, city, municipality, brand, priceMax, sort, discountsOnly, menOnly, acceptsCards, openSunday, instantBooking, topSalon, location]);
  const { data: salons, isLoading } = useListSalons(params);
  const categories = ["Frizerski saloni", "Muški frizeri", "Kozmetički saloni", "Depilacija", "Lice", "Nokti", "Masaža", "Telo", "Wellness", "Lux tretmani", "Paketi usluga", "Ordinacije i poliklinike"];
  const toggle = (label: string, checked: boolean, setChecked: (value: boolean) => void) => <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer"><input type="checkbox" className="accent-primary" checked={checked} onChange={(event) => setChecked(event.target.checked)} />{label}</label>;

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
                {["Sve", ...categories].map(cat => (
                  <label key={cat} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                    <input type="radio" name="category" className="accent-primary" checked={(cat === "Sve" ? "" : cat) === category} onChange={() => setCategory(cat === "Sve" ? "" : cat)} />
                    {cat}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Lokacija</h3>
              <Input value={city} onChange={(event) => setCity(event.target.value)} placeholder="Grad (npr. Beograd)" className="h-9" />
              <Input value={municipality} onChange={(event) => setMunicipality(event.target.value)} placeholder="Opština / deo grada" className="h-9" />
              <Input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Brend proizvoda" className="h-9" />
            </div>

            <div className="space-y-3"><h3 className="text-sm font-semibold">Cenovni rang</h3><select value={priceMax ?? ""} onChange={(event) => setPriceMax(event.target.value ? Number(event.target.value) : undefined)} className="w-full h-9 rounded border bg-background px-2 text-sm"><option value="">Bez ograničenja</option><option value="1000">Do 1.000 RSD</option><option value="2500">Do 2.500 RSD</option><option value="5000">Do 5.000 RSD</option><option value="10000">Do 10.000 RSD</option></select></div>
            <div className="space-y-2">
              {toggle("Samo popusti", discountsOnly, setDiscountsOnly)}
              {toggle("Saloni za muškarce", menOnly, setMenOnly)}
              {toggle("Prima platne kartice", acceptsCards, setAcceptsCards)}
              {toggle("Otvoren nedeljom", openSunday, setOpenSunday)}
              {toggle("Instant zakazivanje", instantBooking, setInstantBooking)}
              {toggle("Top Salon", topSalon, setTopSalon)}
            </div>
            <Button variant="outline" className="w-full" onClick={() => { setCategory(""); setCity(""); setMunicipality(""); setBrand(""); setPriceMax(undefined); setDiscountsOnly(false); setMenOnly(false); setAcceptsCards(false); setOpenSunday(false); setInstantBooking(false); setTopSalon(false); }}>Resetuj filtere</Button>
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
              <select value={sort} onChange={(event) => setSort(event.target.value as ListSalonsParams["sort"])} className="bg-transparent border rounded-md px-2 py-1 outline-none text-sm font-medium">
                <option value="recommended">Preporučeno</option>
                <option value="nearest">U mojoj blizini</option>
                <option value="newest">Nedavno dodato</option>
                <option value="top-rated">Najbolje ocenjeno</option>
                <option value="cheapest">Najniža cena</option>
                <option value="most-popular">Najpopularnije</option>
                <option value="first-available">Prvi slobodan termin</option>
              </select>
            </div>
          </div>
          {sort === "nearest" && <p className="mb-4 text-xs text-muted-foreground">{locationNote || "Tražimo vašu lokaciju…"}</p>}

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
                  <div className="absolute top-3 left-3 flex flex-wrap gap-1">
                    {salon.featured && <Badge className="bg-white/90 text-primary hover:bg-white backdrop-blur-sm font-semibold">Istaknuto</Badge>}
                    {salon.topSalon && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100"><BadgeCheck className="mr-1 h-3 w-3" />Top Salon</Badge>}
                    {salon.instantBooking && <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100"><Zap className="mr-1 h-3 w-3" />Instant</Badge>}
                  </div>
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
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {salon.hasDiscount && <span className="text-primary font-medium">Aktivni popusti</span>}
                    {salon.acceptsCards && <span className="flex items-center gap-1"><CreditCard className="h-3 w-3" />Kartice</span>}
                    {salon.lastBookedAt && <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />Poslednje zakazivanje: {new Intl.RelativeTimeFormat("sr", { numeric: "auto" }).format(Math.round((new Date(salon.lastBookedAt).getTime() - Date.now()) / 86400000), "day")}</span>}
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
