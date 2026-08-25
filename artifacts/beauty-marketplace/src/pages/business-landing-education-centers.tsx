import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { OptimizedImage } from "@/components/optimized-image";
import { 
  Users, 
  GraduationCap, 
  TrendingUp, 
  Award,
  Video,
  FileText,
  BriefcaseBusiness,
  CalendarDays
} from "lucide-react";

export default function BusinessLandingEducationCenters() {
  return (
    <BusinessLayout>
      <section className="relative w-full bg-primary text-primary-foreground pt-24 pb-32 md:pt-32 md:pb-48 overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://images.unsplash.com/photo-1574015974293-817f0ebebb74?q=80&w=2673&auto=format&fit=crop')] bg-cover bg-center mix-blend-overlay"></div>
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white text-sm font-medium mb-8">
              <GraduationCap className="w-4 h-4" />
              <span>Infrastruktura za prodaju edukacija</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-white leading-[1.1] mb-8">
              Prenesite svoje znanje. Kreirajte autoritet.
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/80 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
              Organizujte obuke, masterclass programe i sertifikacije, objavite ih u javnom katalogu i vodite svakodnevne operacije centra iz jednog naloga.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-14 px-8 text-base shadow-lg transition-transform hover:scale-105" asChild>
                <Link href="/pridruzi-se-edukativni-centar">Registrujte centar</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <h2 className="text-4xl font-serif font-bold text-foreground mb-6">Sve za modernu akademiju.</h2>
            <p className="text-lg text-muted-foreground font-light">
               Upravljajte svojim programima, instruktorima i polaznicima iz jednog centralnog sistema dizajniranog specifično za beauty industriju.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto">
            <div className="flex gap-6 items-start">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center shrink-0">
                <Users className="w-8 h-8 text-accent" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold mb-3">Vidljivost programa</h3>
               <p className="text-muted-foreground leading-relaxed">Objavljeni kursevi se prikazuju u LUMERA katalogu edukacija gde ih saloni i beauty profesionalci mogu pronaći i kupiti.</p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                <Video className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold mb-3">Uživo i online formati</h3>
                <p className="text-muted-foreground leading-relaxed">Prodajte karte za fizičke događaje (masterclass, praktične obuke) ili postavite pre-recorded video lekcije (LMS) koje polaznici mogu gledati svojim tempom.</p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                <BriefcaseBusiness className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold mb-3">Pronađite instruktore</h3>
                <p className="text-muted-foreground leading-relaxed">Objavite oglas kroz Beauty Poslovi kada tražite instruktora, saradnika ili freelance stručnjaka za novi program.</p>
                <Link href="/za-biznise/poslovi" className="mt-3 inline-flex text-sm font-semibold text-primary hover:underline">Saznajte više o Beauty Poslovima</Link>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center shrink-0">
                <CalendarDays className="w-8 h-8 text-accent" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold mb-3">Kompletan operativni workspace</h3>
                <p className="text-muted-foreground leading-relaxed">Uz centar dobijate kalendar, CRM, zaposlene, zalihe, B2B nabavku, loyalty, pakete, performanse i automatizacije.</p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center shrink-0">
                <Award className="w-8 h-8 text-secondary-foreground" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold mb-3">Sertifikacija</h3>
                <p className="text-muted-foreground leading-relaxed">Izdajte digitalne sertifikate direktno kroz platformu nakon uspešno završene obuke. Polaznici mogu odmah dodati sertifikat na svoj LUMERA profil.</p>
              </div>
            </div>

            <div className="flex gap-6 items-start">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center shrink-0">
                <FileText className="w-8 h-8 text-accent" />
              </div>
              <div>
                <h3 className="text-2xl font-serif font-bold mb-3">Odvojen poslovni profil</h3>
                <p className="text-muted-foreground leading-relaxed">Za razliku od salona, edukativni centri imaju specifične profile na kojima grade autoritet, predstavljaju svoje instruktore i ističu bivše polaznike.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-muted/50 border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-serif font-bold mb-6">Postanite LUMERA Edukativni Partner</h2>
          <p className="text-lg text-muted-foreground mb-10 font-light">
             Registracija je prilagođena upravo vašem tipu biznisa. Očekujemo vaše podatke, reference i programe.
          </p>
          <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90 h-14 px-10 text-base shadow-lg transition-transform hover:scale-105" asChild>
            <Link href="/pridruzi-se-edukativni-centar">Započni registraciju centra</Link>
          </Button>
        </div>
      </section>
    </BusinessLayout>
  );
}
