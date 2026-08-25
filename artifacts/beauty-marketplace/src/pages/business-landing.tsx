import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { OptimizedImage } from "@/components/optimized-image";
import {
  Building2,
  GraduationCap, 
  Briefcase,
  BookOpen,
  ArrowRight
} from "lucide-react";

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
