import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { BadgeCheck, BookOpen, Building2, Loader2, MapPin, ShieldCheck } from "lucide-react";
import { useGetCurrentUser } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type Course = { id: string; title: string; description: string; format: "online" | "in-person" | "hybrid"; city: string | null; price: number; duration: number; certification: boolean; publisher: string; publisherVerified: boolean; featured?: boolean; refundPolicy?: string; sessions: { id: string; startsAt: string; availableSeats: number; location: string | null }[] };
const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);

export default function EducationMarketplace() {
  const { data: currentUser } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  useEffect(() => { fetch("/api/education/public/courses").then((response) => response.json()).then(setCourses).catch(() => setCourses([])); }, []);
  const buy = async (course: Course) => {
    if (!currentUser?.user) { setLocation("/student/prijava?tab=register"); return; }
    setBuying(course.id);
    try {
      const session = course.sessions.find((item) => item.availableSeats > 0) ?? course.sessions[0];
      if (course.format !== "online" && session && session.availableSeats <= 0) {
        const response = await fetch(`/api/education/courses/${course.id}/sessions/${session.id}/waitlist`, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Dodavanje na listu čekanja nije uspelo.");
        toast.success("Dodati ste na listu čekanja", { description: `Vaša pozicija u redu je ${body.position}. Javićemo vam kada se oslobodi mesto.` });
        return;
      }
      const response = await fetch(`/api/education/courses/${course.id}/enrollments`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(session ? { sessionId: session.id } : {}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Zahtev za kupovinu nije uspeo.");
      toast.success("Zahtev je poslat", { description: "Administrator prvo ručno potvrđuje uplatu. Pristup i privatni podaci kursa aktiviraju se nakon potvrde." });
      setLocation(currentUser.user.role === "STUDENT" ? "/student/edukacije" : currentUser.user.role === "CUSTOMER" ? "/moj-nalog?tab=education" : "/biznis/edukacije");
    } catch (error) { toast.error("Zahtev nije poslat", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBuying(null); }
  };
  return <Layout>
    <section className="border-b bg-muted/30 py-12"><div className="container mx-auto px-4 text-center"><p className="text-sm font-semibold uppercase tracking-[.18em] text-primary">LUMERA Edukacije</p><h1 className="mt-2 font-serif text-4xl font-bold">Znanje za beauty profesionalce</h1><p className="mx-auto mt-3 max-w-2xl text-muted-foreground">Verifikovani edukativni centri, zaštićena kupovina i pristup podacima kursa tek nakon potvrde.</p></div></section>
    <main className="container mx-auto px-4 py-10">{!courses ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : courses.length ? <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{courses.map((course) => <Card key={course.id} className="flex flex-col overflow-hidden"><CardContent className="flex flex-1 flex-col p-6"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{course.format === "online" ? "Online" : course.format === "hybrid" ? "Hibridno" : "Uživo"}</Badge>{course.featured ? <Badge>Istaknuto</Badge> : null}{course.certification ? <Badge variant="outline">Sertifikat</Badge> : null}</div><h2 className="mt-4 font-serif text-xl font-bold">{course.title}</h2><p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{course.description}</p><div className="mt-4 space-y-1 text-sm text-muted-foreground"><p className="flex items-center gap-2"><Building2 className="h-4 w-4" />{course.publisher}{course.publisherVerified ? <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="Verifikovan centar" /> : null}</p>{course.city ? <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{course.city} · detaljna lokacija nakon kupovine</p> : null}<p>{course.duration} h · {money(course.price)}</p>{course.sessions[0] ? <p>{course.sessions[0].availableSeats > 0 ? `${course.sessions[0].availableSeats} slobodnih mesta` : "Popunjeno · lista čekanja"}</p> : null}</div><div className="mt-auto pt-6"><Button className="w-full" disabled={buying === course.id} onClick={() => void buy(course)}>{buying === course.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpen className="mr-2 h-4 w-4" />}{course.format !== "online" && course.sessions.length && !course.sessions.some((item) => item.availableSeats > 0) ? "Pridruži se listi čekanja" : currentUser?.user ? `Pošalji zahtev · ${money(course.price)}` : "Prijavite se za kupovinu"}</Button></div></CardContent></Card>)}</div> : <div className="py-16 text-center"><ShieldCheck className="mx-auto mb-3 h-8 w-8 text-primary" /><p className="font-semibold">Trenutno nema dostupnih edukacija.</p><p className="mt-2 text-sm text-muted-foreground">Kursevi se pojavljuju nakon verifikacije centra i aktivacije pretplate.</p></div>}</main>
  </Layout>;
}