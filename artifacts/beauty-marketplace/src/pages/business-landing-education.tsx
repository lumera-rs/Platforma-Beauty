import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { 
  BookOpen, 
  Target, 
  Award,
  Users,
  GraduationCap,
  ArrowRight
} from "lucide-react";

export default function BusinessLandingEducation() {
  return (
    <BusinessLayout>
      <section className="relative w-full bg-primary text-primary-foreground pt-24 pb-32 md:pt-32 md:pb-48 overflow-hidden">
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white text-sm font-medium mb-8">
              <BookOpen className="w-4 h-4" />
              <span>B2B Usavršavanje tima</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-white leading-[1.1] mb-8">
              Ponuda znanja za one koji stvaraju i one koji uče.
            </h1>
            <p className="text-lg md:text-xl text-primary-foreground/80 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
              Edukativni centri kreiraju i prodaju programe, dok saloni, zaposleni i JOBSEEKER profesionalci pronalaze obuke za sledeći korak u karijeri.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-14 px-8 text-base shadow-lg transition-transform hover:scale-105" asChild>
                <Link href="/edukacije">Pregledajte katalog</Link>
              </Button>
              <Button size="lg" variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white h-14 px-8 text-base" asChild>
                <Link href="/pridruzi-se-edukativni-centar">Objavite edukaciju</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto">
            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm flex items-start gap-6">
              <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                <Target className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-serif font-bold mb-3">Specijalizovani programi</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Pristupite majstorskim radionicama koje nude priznati edukativni centri i renomirani stručnjaci, bilo da je reč o novim tehnikama ili poslovnim veštinama.
                </p>
              </div>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm flex items-start gap-6">
              <div className="w-14 h-14 bg-accent/10 rounded-xl flex items-center justify-center shrink-0">
                <Users className="w-7 h-7 text-accent" />
              </div>
              <div>
                <h3 className="text-xl font-serif font-bold mb-3">Praćenje napretka tima</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Kupite pristup Sistemu za učenje za svoje zaposlene. Pratite koje lekcije su završili, kakve rezultate ostvaruju i u kom pravcu se usavršavaju.
                </p>
              </div>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm flex items-start gap-6">
              <div className="w-14 h-14 bg-secondary rounded-xl flex items-center justify-center shrink-0">
                <Award className="w-7 h-7 text-secondary-foreground" />
              </div>
              <div>
                <h3 className="text-xl font-serif font-bold mb-3">Zvanični sertifikati u profilu salona</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Završene obuke donose digitalne sertifikate koji se automatski pojavljuju na javnom profilu vašeg salona. Klijenti na prvi pogled vide da je vaš tim stručan i posvećen kontinuiranom učenju.
                </p>
              </div>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm flex items-start gap-6">
              <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                <GraduationCap className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h3 className="text-xl font-serif font-bold mb-3">Za kreatore edukacija</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Kreirajte kurseve uživo ili online, upravljajte instruktorima i polaznicima, ponudite sertifikaciju i izgradite javni profil centra.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-muted/50 border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-serif font-bold mb-6">Učite ili prenesite znanje</h2>
          <p className="text-lg text-muted-foreground mb-10 font-light">
             Otvorite katalog kao polaznik ili registrujte edukativni centar i objavite sopstvene programe.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 h-14 px-10 text-base shadow-lg transition-transform hover:scale-105" asChild>
              <Link href="/edukacije">Otvori katalog <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button size="lg" variant="outline" className="h-14 px-10 text-base" asChild>
              <Link href="/pridruzi-se-edukativni-centar">Registruj edukativni centar</Link>
            </Button>
          </div>
        </div>
      </section>
    </BusinessLayout>
  );
}
