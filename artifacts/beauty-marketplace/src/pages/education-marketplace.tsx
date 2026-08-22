import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { BadgeCheck, BookOpen, Building2, Loader2, MapPin, ShieldCheck, Star, Users, Zap } from "lucide-react";
import { useGetCurrentUser, useListFeaturedEducationCourses } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type Course = { id: string; title: string; description: string; format: "online" | "in-person" | "hybrid"; city: string | null; price: number; duration: number; certification: boolean; publisher: string; publisherVerified: boolean; featured?: boolean; refundPolicy?: string | null; groupDiscountMinimum?: number | null; groupDiscountPercent?: number | null; rating?: number; imageUrl?: string; sessions: { id: string; startsAt: string; availableSeats: number; location: string | null }[] };
const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);

function CourseCard({ course, onBuy, buying }: { course: Course; onBuy: (course: Course) => void; buying: string | null }) {
  return (
    <Card className="flex flex-col overflow-hidden border-border/60 hover:shadow-md transition-shadow group">
      {course.imageUrl && (
        <div className="aspect-video overflow-hidden bg-muted/30">
          <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
        </div>
      )}
      <CardContent className="flex flex-1 flex-col p-6">
        <div className="flex flex-wrap gap-2 mb-1">
          <Badge variant="secondary">{course.format === "online" ? "Online" : course.format === "hybrid" ? "Hibridno" : "Uživo"}</Badge>
          {course.certification && <Badge variant="outline">Sertifikat</Badge>}
        </div>
        <h2 className="mt-3 font-serif text-xl font-bold line-clamp-2">{course.title}</h2>
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{course.description}</p>
        <div className="mt-4 space-y-1 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0" />
            {course.publisher}
            {course.publisherVerified && <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Verifikovan centar" />}
          </p>
          {course.city && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" />{course.city} · detaljna lokacija nakon kupovine</p>}
          <p className="flex items-center gap-2">
            {course.rating != null && <><Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />{course.rating.toFixed(1)} · </>}
            {money(course.price)}
          </p>
          {course.sessions[0] && <p>{course.sessions[0].availableSeats > 0 ? `${course.sessions[0].availableSeats} slobodnih mesta` : "Popunjeno · lista čekanja"}</p>}
          {(course.groupDiscountMinimum ?? 0) > 0 && (
            <p className="flex items-center gap-1.5 text-emerald-600">
              <Users className="h-3.5 w-3.5" />Grupni popust {course.groupDiscountPercent}% za {course.groupDiscountMinimum}+ polaznika
            </p>
          )}
        </div>
        {course.refundPolicy && (
          <div className="mt-3 border-t pt-3">
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary/60" />
              <span>{course.refundPolicy}</span>
            </p>
          </div>
        )}
        <div className="mt-auto pt-6">
          <Button className="w-full" disabled={buying === course.id} onClick={() => onBuy(course)}>
            {buying === course.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}
            {course.format !== "online" && course.sessions.length > 0 && !course.sessions.some((s) => s.availableSeats > 0)
              ? "Pridruži se listi čekanja"
              : "Pošalji zahtev"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EducationMarketplace() {
  const { data: currentUser } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const { data: featuredCourses } = useListFeaturedEducationCourses();

  useEffect(() => {
    fetch("/api/education/public/courses").then((r) => r.json()).then(setCourses).catch(() => setCourses([]));
  }, []);

  const buy = async (course: Course) => {
    if (!currentUser?.user) { setLocation("/student/prijava?tab=register"); return; }
    setBuying(course.id);
    try {
      const session = course.sessions.find((s) => s.availableSeats > 0) ?? course.sessions[0];
      if (course.format !== "online" && session && session.availableSeats <= 0) {
        const res = await fetch(`/api/education/courses/${course.id}/sessions/${session.id}/waitlist`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Dodavanje na listu čekanja nije uspelo.");
        toast.success("Dodati ste na listu čekanja", { description: `Vaša pozicija u redu je ${body.position}.` });
        return;
      }
      const res = await fetch(`/api/education/courses/${course.id}/enrollments`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(session ? { sessionId: session.id } : {}) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Zahtev za kupovinu nije uspeo.");
      toast.success("Zahtev je poslat", { description: "Administrator potvrđuje uplatu. Pristup se aktivira nakon potvrde." });
      setLocation(currentUser.user.role === "STUDENT" ? "/student/edukacije" : currentUser.user.role === "CUSTOMER" ? "/moj-nalog?tab=education" : "/biznis/edukacije");
    } catch (err) {
      toast.error("Zahtev nije poslat", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBuying(null);
    }
  };

  return (
    <Layout>
      {/* Hero */}
      <section className="border-b bg-muted/30 py-12">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-primary">LUMERA Edukacije</p>
          <h1 className="mt-2 font-serif text-4xl font-bold">Znanje za beauty profesionalce</h1>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">Verifikovani edukativni centri, zaštićena kupovina i pristup podacima kursa tek nakon potvrde.</p>
        </div>
      </section>

      <main className="container mx-auto px-4 py-10 space-y-12">
        {/* Featured shelf */}
        {featuredCourses && featuredCourses.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-5">
              <Zap className="w-5 h-5 text-amber-500" />
              <h2 className="font-serif text-2xl font-bold">Istaknute edukacije</h2>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {featuredCourses.map((course: any) => (
                <div key={course.id} className="relative">
                  <div className="absolute top-3 left-3 z-10">
                    <Badge className="bg-amber-500 hover:bg-amber-500 text-white gap-1 shadow-sm"><Zap className="w-3 h-3" /> Istaknuto</Badge>
                  </div>
                  <CourseCard course={course} onBuy={buy} buying={buying} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* All courses */}
        <section>
          {featuredCourses && featuredCourses.length > 0 && (
            <h2 className="font-serif text-2xl font-bold mb-5">Sve edukacije</h2>
          )}
          {!courses ? (
            <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : courses.length ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {courses.map((course) => <CourseCard key={course.id} course={course} onBuy={buy} buying={buying} />)}
            </div>
          ) : (
            <div className="py-16 text-center">
              <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-primary" />
              <p className="font-semibold">Trenutno nema dostupnih edukacija.</p>
              <p className="mt-2 text-sm text-muted-foreground">Kursevi se pojavljuju nakon verifikacije centra i aktivacije pretplate.</p>
            </div>
          )}
        </section>
      </main>
    </Layout>
  );
}
