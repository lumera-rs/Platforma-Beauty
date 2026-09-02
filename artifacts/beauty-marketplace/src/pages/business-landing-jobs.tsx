import { BusinessLayout } from "@/components/business-layout";
import { CreateListingCta } from "@/components/beauty-jobs/create-listing-cta";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { 
  Briefcase, 
  Search, 
  UserPlus, 
  Building,
  UserRoundSearch,
  ArrowRight
} from "lucide-react";

export default function BusinessLandingJobs() {
  return (
    <BusinessLayout>
      <section className="relative w-full bg-foreground text-background pt-24 pb-32 md:pt-32 md:pb-48 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/90 to-foreground" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-secondary text-sm font-medium mb-8">
              <Briefcase className="w-4 h-4" />
              <span>Oglasi i profesionalni profili za beauty industriju</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-serif font-bold text-white leading-[1.1] mb-8">
              Jedno mesto za biznise i beauty profesionalce.
            </h1>
            <p className="text-lg md:text-xl text-background/80 mb-12 max-w-2xl mx-auto font-light leading-relaxed">
              Objavite oglas za posao, ponudite iznajmljivanje radnog mesta ili pregledajte profile slobodnih beauty profesionalaca.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <CreateListingCta
                size="lg"
                className="bg-secondary text-secondary-foreground hover:bg-secondary/90 h-14 px-8 text-base shadow-lg transition-transform hover:scale-105"
              />
              <Button size="lg" variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10 hover:text-white h-14 px-8 text-base" asChild>
                <Link href="/poslovi">Pregledajte oglase</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-muted/30 border-y border-border">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-2 max-w-5xl mx-auto">
            <article className="rounded-3xl border bg-card p-8 md:p-10 shadow-sm">
              <Building className="h-8 w-8 text-primary mb-6" />
              <p className="text-sm font-semibold uppercase tracking-wider text-primary mb-3">Za salone i edukativne centre</p>
              <h2 className="text-3xl font-serif font-bold mb-4">Zaposlite, pronađite saradnika ili ponudite prostor.</h2>
              <p className="text-muted-foreground leading-relaxed mb-7">Objavite stalni posao, freelance projekat, potražnju za instruktorom ili oglas za iznajmljivanje stolice, kabine, prostora i profesionalne opreme.</p>
              <div className="flex flex-wrap gap-3">
                <Button asChild><Link href="/poslovna-registracija">Registrujte biznis</Link></Button>
                <Button variant="outline" asChild><Link href="/pridruzi-se-edukativni-centar">Registrujte centar</Link></Button>
              </div>
            </article>
            <article className="rounded-3xl border bg-card p-8 md:p-10 shadow-sm">
              <UserRoundSearch className="h-8 w-8 text-accent mb-6" />
              <p className="text-sm font-semibold uppercase tracking-wider text-accent mb-3">Za JOBSEEKER profesionalce</p>
              <h2 className="text-3xl font-serif font-bold mb-4">Predstavite veštine, portfolio i dostupnost.</h2>
              <p className="text-muted-foreground leading-relaxed mb-7">Kreirajte profesionalni profil, prijavite se na posao, ponudite freelance uslugu ili pronađite opremu i radni prostor koji odgovaraju vašem planu.</p>
              <Button className="bg-accent text-accent-foreground hover:bg-accent/90" asChild>
                <Link href="/pridruzi-se-poslovi">Kreirajte JOBSEEKER nalog <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </article>
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <UserPlus className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-serif font-bold mb-4">Zapošljavanje</h3>
              <p className="text-muted-foreground leading-relaxed">
                Tražite stalnog radnika? Objavite oglas koji će videti hiljade profesionalaca u vašoj okolini.
              </p>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm text-center">
              <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Building className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-xl font-serif font-bold mb-4">Iznajmljivanje prostora</h3>
              <p className="text-muted-foreground leading-relaxed">
                Imate praznu stolicu ili sobu? Ponudite je freelancer-ima i smanjite fiksne troškove vašeg salona.
              </p>
            </div>

            <div className="bg-card border border-border p-8 rounded-2xl shadow-sm text-center">
              <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="w-8 h-8 text-secondary-foreground" />
              </div>
              <h3 className="text-xl font-serif font-bold mb-4">Pregled CV-jeva</h3>
              <p className="text-muted-foreground leading-relaxed">
                Ne čekajte da se prijave. Pregledajte javne profile i portfolije radnika i direktno im ponudite uslove.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-muted/50 border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-serif font-bold mb-6">Povežite se sa pravim ljudima</h2>
          <p className="text-lg text-muted-foreground mb-10 font-light">
             Registrujte svoj biznis nalog kako biste dobili pristup LUMERA berzi poslova i alatima za regrutaciju.
          </p>
          <Button size="lg" className="bg-foreground text-background hover:bg-foreground/90 h-14 px-10 text-base shadow-lg transition-transform hover:scale-105" asChild>
            <Link href="/poslovna-registracija">Registruj se</Link>
          </Button>
        </div>
      </section>
    </BusinessLayout>
  );
}
