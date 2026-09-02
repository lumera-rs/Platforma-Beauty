import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { OptimizedImage } from "@/components/optimized-image";
import {
  Building2,
  GraduationCap,
  Briefcase,
  BookOpen,
  ArrowRight,
  UsersRound,
  Boxes,
  Bot,
  BadgeCheck,
  ChartNoAxesCombined,
  Workflow,
} from "lucide-react";

const salonModuleHighlights = [
  {
    title: "Zaposleni",
    description: "Rasporedi, timske uloge i upravljanje zaposlenima.",
    icon: UsersRound,
  },
  {
    title: "Zalihe",
    description: "Pregled potrošnje i pravovremena dopuna proizvoda.",
    icon: Boxes,
  },
  {
    title: "AI Asistent",
    description: "Pametna podrška za svakodnevne poslovne odluke.",
    icon: Bot,
  },
  {
    title: "Paketi tretmana",
    description: "Kreiranje i prodaja paketa prilagođenih klijentima.",
    icon: BadgeCheck,
  },
  {
    title: "Performanse tima",
    description: "Jasan pregled rezultata salona i svakog člana tima.",
    icon: ChartNoAxesCombined,
  },
  {
    title: "Automatizacije",
    description: "Manje rutinskog rada uz automatizovane procese.",
    icon: Workflow,
  },
];

export default function BusinessLanding() {
  return (
    <BusinessLayout>
      <section className="relative w-full bg-foreground text-background pt-24 pb-32 md:pt-32 md:pb-40 overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1600880292203-757bb62b4baf?q=80&w=2670&auto=format&fit=crop')] bg-cover bg-center mix-blend-luminosity" />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/90 to-foreground" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-white leading-[1.1] mb-8">
              Rast vašeg beauty biznisa počinje <span className="text-accent italic">ovde</span>.
            </h1>
            <p className="text-lg md:text-xl text-background/80 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
              LUMERA Biznis okuplja salone, edukativne centre, profesionalce i stručnjake na jednoj jedinstvenoj platformi. Otkrijte rešenje kreirano specijalno za vaše potrebe.
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 bg-background -mt-16 relative z-20">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">

            <Link href="/za-biznise/saloni" className="block group">
              <div className="bg-card border border-border p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all h-full flex flex-col items-start relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full transition-transform group-hover:scale-110" />
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground transition-colors text-primary relative z-10">
                  <Building2 className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3 relative z-10 group-hover:text-primary transition-colors">Za Beauty Salone</h3>
                <p className="text-muted-foreground mb-8 leading-relaxed relative z-10 flex-1">
                  Kompletan operativni sistem za salon: kalendar i CRM, zaposleni, zalihe, B2B nabavka, loyalty, automatizacije, AI podrška i praćenje performansi.
                </p>
                <div className="flex items-center text-primary font-medium text-sm mt-auto relative z-10 group-hover:underline">
                  Saznajte više <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>

            <Link href="/za-biznise/edukativni-centri" className="block group">
              <div className="bg-card border border-border p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all h-full flex flex-col items-start relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-bl-full transition-transform group-hover:scale-110" />
                <div className="w-14 h-14 bg-accent/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-accent group-hover:text-accent-foreground transition-colors text-accent relative z-10">
                  <GraduationCap className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3 relative z-10 group-hover:text-accent transition-colors">Za Edukativne Centre</h3>
                <p className="text-muted-foreground mb-8 leading-relaxed relative z-10 flex-1">
                  Infrastruktura za organizaciju i prodaju edukacija. Upravljajte programima, sertifikatima i studentima sa lakoćom.
                </p>
                <div className="flex items-center text-accent font-medium text-sm mt-auto relative z-10 group-hover:underline">
                  Saznajte više <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>

            <div className="md:col-span-2 rounded-2xl border border-primary/15 bg-primary/[0.035] p-6 md:p-8">
              <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    Sve za moderan salon
                  </p>
                  <h2 className="text-2xl font-serif font-bold text-foreground">
                    Više alata, manje administracije
                  </h2>
                </div>
                <Link
                  href="/za-biznise/saloni"
                  className="inline-flex items-center text-sm font-medium text-primary hover:underline"
                >
                  Saznajte više
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {salonModuleHighlights.map(({ title, description, icon: Icon }) => (
                  <div
                    key={title}
                    className="flex gap-3 rounded-xl border border-border/70 bg-background/85 p-4"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{title}</h3>
                      <p className="mt-1 text-sm leading-snug text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Link href="/za-biznise/poslovi" className="block group">
              <div className="bg-card border border-border p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all h-full flex flex-col items-start relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-secondary/5 rounded-bl-full transition-transform group-hover:scale-110" />
                <div className="w-14 h-14 bg-secondary rounded-xl flex items-center justify-center mb-6 group-hover:bg-secondary-foreground group-hover:text-secondary transition-colors text-secondary-foreground relative z-10">
                  <Briefcase className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3 relative z-10 group-hover:text-secondary-foreground transition-colors">Beauty Poslovi</h3>
                <p className="text-muted-foreground mb-8 leading-relaxed relative z-10 flex-1">
                  Pronađite najbolje talente za vaš salon ili centar. Objavite oglase, pregledajte biografije i iznajmite radna mesta profesionalcima.
                </p>
                <div className="flex items-center text-secondary-foreground font-medium text-sm mt-auto relative z-10 group-hover:underline">
                  Saznajte više <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>

            <Link href="/za-biznise/edukacije" className="block group">
              <div className="bg-card border border-border p-8 rounded-2xl shadow-sm hover:shadow-xl transition-all h-full flex flex-col items-start relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full transition-transform group-hover:scale-110" />
                <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground transition-colors text-primary relative z-10">
                  <BookOpen className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3 relative z-10 group-hover:text-primary transition-colors">Marketplace edukacija</h3>
                <p className="text-muted-foreground mb-8 leading-relaxed relative z-10 flex-1">
                  Kreirajte i prodajte programe ili pronađite obuke za sebe i svoj tim — uživo, online i uz sertifikaciju.
                </p>
                <div className="flex items-center text-primary font-medium text-sm mt-auto relative z-10 group-hover:underline">
                  Saznajte više <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>

          </div>
        </div>
      </section>
    </BusinessLayout>
  );
}
