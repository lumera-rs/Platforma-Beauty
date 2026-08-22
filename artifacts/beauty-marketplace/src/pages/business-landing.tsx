import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { OptimizedImage } from "@/components/optimized-image";
import { 
  CalendarDays, 
  ShoppingBag, 
  GraduationCap, 
  TrendingUp, 
  Users, 
  CheckCircle2, 
  Sparkles,
  Gem
} from "lucide-react";

export default function BusinessLanding() {
  return (
    <BusinessLayout>
      {/* Hero Section */}
      <section className="relative w-full bg-foreground text-background pt-24 pb-32 md:pt-32 md:pb-48 overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1600880292203-757bb62b4baf?q=80&w=2670&auto=format&fit=crop')] bg-cover bg-center mix-blend-luminosity" />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/90 to-foreground" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-accent text-sm font-medium mb-8">
              <Sparkles className="w-4 h-4" />
              <span>Premijum operativni sistem za salone</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-white leading-[1.1] mb-8">
              Sve što vam je potrebno za <span className="text-accent italic">izuzetan</span> biznis.
            </h1>
            <p className="text-lg md:text-xl text-background/80 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
              Lumera nije samo mesto za zakazivanje. To je vaš partner za rast – od naprednog kalendara i CRM-a, preko nabavke materijala po B2B cenama, do vođenja edukacija.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 h-14 px-8 text-base shadow-lg shadow-accent/20 transition-all hover:scale-105" asChild>
                <Link href="/poslovna-registracija">Započnite besplatno</Link>
              </Button>
              <Button size="lg" variant="outline" className="h-14 px-8 text-base border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white transition-all" asChild>
                <Link href="/student/prijava?tab=register">Prijava za edukacije</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats/Credibility Banner */}
      <section className="border-y border-border bg-muted/30 py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center md:divide-x divide-border">
            <div className="px-4">
               <div className="text-4xl font-serif font-bold text-primary mb-2">1</div>
               <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Portal za operacije</div>
            </div>
            <div className="px-4">
              <div className="text-4xl font-serif font-bold text-primary mb-2">24/7</div>
              <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Online zakazivanje</div>
            </div>
            <div className="px-4">
               <div className="text-4xl font-serif font-bold text-primary mb-2">B2B</div>
               <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Partnerske cene</div>
            </div>
            <div className="px-4">
               <div className="text-4xl font-serif font-bold text-primary mb-2">L+</div>
               <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider">Loyalty benefiti</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Value Props */}
      <section id="platforma" className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <h2 className="text-4xl font-serif font-bold text-foreground mb-6">Jedna platforma. Sve operacije.</h2>
            <p className="text-lg text-muted-foreground font-light">
               Zaboravite na desetine različitih alata. Lumera integriše ključne aspekte vašeg poslovanja u jedno elegantno rešenje skrojeno za industriju lepote.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm hover-elevate transition-all group">
              <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <CalendarDays className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-bold mb-4">Pametan Kalendar & CRM</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                 Organizujte termine, usluge i tim kroz pregled koji svakodnevne obaveze čini jasnijim.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-primary" /> Baza klijenata i istorija poseta</li>
                <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-primary" /> Evidencija preferencija</li>
                 <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-primary" /> Pregled usluga i članova tima</li>
              </ul>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm hover-elevate transition-all group">
              <div className="w-14 h-14 bg-accent/20 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <ShoppingBag className="w-7 h-7 text-accent-foreground" />
              </div>
              <h3 className="text-xl font-serif font-bold mb-4">Ekskluzivni B2B Shop</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Kupujte profesionalnu opremu i potrošni materijal direktno od distributera. Značajne uštede na svakodnevnim nabavkama za vaš salon.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-accent" /> Brendovi vrhunskog kvaliteta</li>
                 <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-accent" /> Loyalty cene prema nivou partnera</li>
                 <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-accent" /> Pregled narudžbina u portalu</li>
              </ul>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm hover-elevate transition-all group">
              <div className="w-14 h-14 bg-secondary rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Gem className="w-7 h-7 text-secondary-foreground" />
              </div>
              <h3 className="text-xl font-serif font-bold mb-4">Loyalty & Pretplate</h3>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                Nagrađujemo vaš uspeh. Što više radite preko Lumere, dobijate više popusta, besplatnu pretplatu i prioritetno listanje.
              </p>
              <ul className="space-y-3">
                <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-secondary-foreground" /> Transparentni nivoi benefita</li>
                <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-secondary-foreground" /> Bez skrivenih troškova</li>
                <li className="flex items-center gap-2 text-sm text-foreground/80"><CheckCircle2 className="w-4 h-4 text-secondary-foreground" /> Promocija na klijentskom marketu</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Education Centers */}
      <section className="py-24 bg-primary text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://images.unsplash.com/photo-1574015974293-817f0ebebb74?q=80&w=2673&auto=format&fit=crop')] bg-cover bg-center mix-blend-overlay"></div>
        <div className="container mx-auto px-4 relative z-10">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <Badge variant="outline" className="mb-6 border-white/30 text-white bg-white/10 px-4 py-1.5 text-sm font-medium">
                CENTRI ZA EDUKACIJU
              </Badge>
              <h2 className="text-4xl md:text-5xl font-serif font-bold mb-6">Prenesite svoje znanje. Kreirajte autoritet.</h2>
              <p className="text-lg text-primary-foreground/80 mb-8 font-light leading-relaxed">
                Da li organizujete obuke, masterclass programe ili sertifikacije? Lumera Biznis vam daje infrastrukturu da prodate više karata, bilo da su kursevi uživo ili online.
              </p>
              <ul className="space-y-4 mb-10">
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-white" />
                  </div>
                   <span className="text-white/90">Vidljivost programa u jedinstvenom katalogu edukacija</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <GraduationCap className="w-4 h-4 text-white" />
                  </div>
                   <span className="text-white/90">Podrška za programe uživo i online formate</span>
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-4 h-4 text-white" />
                  </div>
                   <span className="text-white/90">Odvojen poslovni profil edukativnog centra</span>
                </li>
              </ul>
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-14 px-8 shadow-xl transition-transform hover:scale-105" asChild>
                <Link href="/edukacije">Pogledajte edukacije</Link>
              </Button>
            </div>
            <div className="relative">
              <div className="aspect-[4/5] rounded-3xl overflow-hidden shadow-2xl relative">
                <OptimizedImage src="https://images.unsplash.com/photo-1552693673-1bf958298935?q=80&w=2673&auto=format&fit=crop" alt="Edukacija u salonu" width={800} height={1000} className="object-cover w-full h-full" sizes="(max-width: 1024px) 100vw, 40vw" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                <div className="absolute bottom-8 left-8 right-8 bg-white/10 backdrop-blur-md border border-white/20 p-6 rounded-2xl text-white">
                  <div className="flex items-center justify-between mb-2">
                     <h4 className="font-medium text-lg">Vaš sledeći program</h4>
                     <span className="bg-accent text-accent-foreground text-xs font-bold px-2 py-1 rounded">Primer</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-white/80 mt-3">
                     <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Uživo ili online</span>
                     <span className="flex items-center gap-1.5"><CalendarDays className="w-4 h-4" /> Jasna prezentacija</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 bg-foreground text-background text-center px-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] translate-y-1/3 -translate-x-1/4 pointer-events-none"></div>
        
        <div className="container mx-auto relative z-10 max-w-3xl">
          <h2 className="text-4xl md:text-5xl font-serif font-bold mb-6 text-white">Spremni da transformišete svoj biznis?</h2>
          <p className="text-xl text-background/70 mb-10 font-light">
             Pridružite se poslovnoj strani LUMERA platforme kroz onboarding namenjen salonima i edukativnim centrima.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 h-14 px-10 text-base shadow-lg shadow-accent/20 transition-transform hover:scale-105" asChild>
              <Link href="/poslovna-registracija">Besplatna registracija</Link>
            </Button>
             <Button size="lg" variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white h-14 px-10 text-base transition-colors" asChild>
              <Link href="/poslovna-prijava">Prijavite se</Link>
            </Button>
          </div>
        </div>
      </section>
    </BusinessLayout>
  );
}
