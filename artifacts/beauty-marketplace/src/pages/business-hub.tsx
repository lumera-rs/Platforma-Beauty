import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Loader2, BookOpen, ArrowRight, Building2, CheckCircle2, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BusinessHub() {
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCurrentUser();
  const user = data?.user;

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/poslovna-prijava");
      return;
    }
    if (user.role === "SALON_OWNER") {
      setLocation("/vlasnik");
    } else if (user.role === "ADMIN" || user.role === "SUPER_ADMIN") {
      setLocation("/admin");
    } else if (user.role === "CUSTOMER") {
      setLocation("/moj-nalog");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading || !user || user.role !== "EDUCATION_CENTER_OWNER") {
    return (
      <BusinessLayout>
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </BusinessLayout>
    );
  }

  return (
    <BusinessLayout>
      <div className="bg-muted/30 pb-16 min-h-screen">
        <div className="bg-foreground text-background py-16 px-4 mb-8">
          <div className="container mx-auto max-w-6xl">
            <h1 className="text-4xl font-serif font-bold mb-4 text-white">Dobrodošli nazad, {user.firstName}.</h1>
            <p className="text-background/80 text-lg max-w-2xl font-light">
              Vaš poslovni nalog je odvojen od klijentskog marketplacea i spreman za upravljanje edukativnim sadržajem.
            </p>
          </div>
        </div>

        <div className="container mx-auto px-4 max-w-6xl -mt-12 relative z-10">
          <Card className="border-none shadow-md mb-12">
            <CardHeader>
              <CardDescription>Status poslovnog naloga</CardDescription>
              <CardTitle className="flex items-center gap-3 text-2xl font-serif">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                Edukativni centar je povezan sa LUMERA platformom
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-muted-foreground mb-1">Vlasnik naloga</p>
                <p className="font-semibold">{user.firstName} {user.lastName}</p>
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
                <p className="text-muted-foreground mb-1">Kontakt</p>
                <p className="font-semibold">{user.email}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-8 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-serif font-bold text-foreground">Brze Akcije</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Button variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/biznis/edukacije">
                    <BookOpen className="w-7 h-7 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="font-medium">Katalog edukacija</span>
                  </Link>
                </Button>
                <Button variant="outline" className="h-28 flex flex-col items-center justify-center gap-3 bg-card hover:bg-accent/10 hover:text-accent hover:border-accent/30 border-border shadow-sm group transition-all" asChild>
                  <Link href="/za-biznise">
                    <Building2 className="w-7 h-7 text-muted-foreground group-hover:text-accent transition-colors" />
                    <span className="font-medium">Poslovne pogodnosti</span>
                  </Link>
                </Button>
              </div>
            </div>
          </div>
          
          <div className="bg-foreground text-background rounded-3xl p-8 md:p-10 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8 shadow-xl">
            <div className="absolute right-0 top-0 w-64 h-64 bg-accent/20 rounded-full blur-3xl translate-x-1/3 -translate-y-1/3 pointer-events-none"></div>
            <div className="absolute left-0 bottom-0 w-48 h-48 bg-primary/20 rounded-full blur-3xl -translate-x-1/3 translate-y-1/3 pointer-events-none"></div>
            
            <div className="relative z-10 max-w-xl">
              <div className="flex items-center gap-2 mb-4">
                <GraduationCap className="w-5 h-5 text-accent" />
                <span className="text-accent font-medium text-sm tracking-widest uppercase">Lumera Edukacije</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-serif font-bold text-white mb-3">Predstavite svoje edukacije pravoj publici</h3>
              <p className="text-background/70 text-base leading-relaxed">
                Poslovni katalog povezuje programe, salone i edukativne centre na jednom mestu.
              </p>
            </div>
            <Button size="lg" className="relative z-10 shrink-0 bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/20 transition-transform hover:scale-105 h-14 px-8 text-base" asChild>
              <Link href="/biznis/edukacije">Pregledaj katalog <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </div>
    </BusinessLayout>
  );
}
