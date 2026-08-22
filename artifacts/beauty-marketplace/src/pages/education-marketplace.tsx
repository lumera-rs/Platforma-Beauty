import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  Award, BadgeCheck, BookOpen, Building2, CalendarDays, ChevronLeft, ChevronRight,
  Clock3, Filter, Loader2, MapPin, ShieldCheck, Sparkles, Star, Users, Zap,
} from "lucide-react";
import {
  useGetCurrentUser,
  useGetPublicEducationCenter,
  useGetPublicEducationCourse,
  useListFeaturedEducationCourses,
  useListPopularEducationCourses,
  useListPublicEducationCategories,
  useListPublicEducationCourses,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { SalonGallery } from "@/components/salon-gallery";
import { OptimizedImage } from "@/components/optimized-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";

type PublicCourse = any;
type PublicFilters = {
  category?: string;
  format?: "online" | "in-person" | "hybrid";
  city?: string;
  level?: "beginner" | "intermediate" | "advanced" | "all-levels";
  minPrice?: number;
  maxPrice?: number;
  startDate?: Date;
  maxDurationDays?: number;
};

const money = (value: number) => new Intl.NumberFormat("sr-RS", {
  style: "currency", currency: "RSD", maximumFractionDigits: 0,
}).format(value);

const levelLabel: Record<string, string> = {
  beginner: "Početni nivo",
  intermediate: "Srednji nivo",
  advanced: "Napredni nivo",
  "all-levels": "Svi nivoi",
};

const formatLabel: Record<string, string> = {
  online: "Online",
  "in-person": "Uživo",
  hybrid: "Hibridno",
};

function courseSession(course: PublicCourse) {
  return course.sessions?.find((item: any) => !item.cancelledAt) ?? course.sessions?.[0] ?? null;
}

function useEducationPurchase() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: currentUser } = useGetCurrentUser();
  const [buying, setBuying] = useState<string | null>(null);

  const buy = async (course: PublicCourse) => {
    if (!currentUser?.user) {
      setLocation("/prijava");
      return;
    }
    setBuying(course.id);
    try {
      const session = courseSession(course);
      if (course.format !== "online" && session && session.availableSeats <= 0) {
        const response = await fetch(`/api/education/courses/${course.id}/sessions/${session.id}/waitlist`, { method: "POST" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Dodavanje na listu čekanja nije uspelo.");
        toast.success("Dodati ste na listu čekanja", { description: `Vaša pozicija u redu je ${body.position}.` });
        return;
      }
      const response = await fetch(`/api/education/courses/${course.id}/enrollments`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(session ? { sessionId: session.id } : {}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Zahtev za kupovinu nije uspeo.");
      toast.success("Zahtev je poslat", { description: "Administrator potvrđuje uplatu. Pristup se aktivira nakon potvrde." });
      setLocation(currentUser.user.role === "STUDENT" ? "/student/edukacije" : currentUser.user.role === "CUSTOMER" ? "/moj-nalog?tab=education" : "/biznis/edukacije");
    } catch (error) {
      toast.error("Zahtev nije poslat", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBuying(null);
    }
  };
  return { buy, buying };
}

export function EducationCourseCard({ course, onBuy, buying, compact = false }: {
  course: PublicCourse;
  onBuy?: (course: PublicCourse) => void;
  buying?: string | null;
  compact?: boolean;
}) {
  const session = courseSession(course);
  return (
    <Card className="group flex h-full flex-col overflow-hidden border-border/60 transition-shadow hover:shadow-lg">
      <Link href={`/edukacije/${course.id}`} className="block aspect-[16/9] overflow-hidden bg-muted">
        <OptimizedImage src={course.imageUrl} alt={course.title} width={800} height={450} responsiveSizes="(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) 45vw, 350px" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      </Link>
      <CardContent className={`flex flex-1 flex-col ${compact ? "p-4" : "p-5"}`}>
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{formatLabel[course.format] ?? course.format}</Badge>
          {course.certification && <Badge variant="outline">Sertifikat</Badge>}
          {course.level && <Badge variant="outline">{levelLabel[course.level] ?? course.level}</Badge>}
        </div>
        <Link href={`/edukacije/${course.id}`} className="font-serif text-xl font-bold leading-tight hover:text-primary">
          {course.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{course.description}</p>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          <Link href={course.centerId ? `/edukacije/centri/${course.centerId}` : `/edukacije/${course.id}`} className="flex items-center gap-2 hover:text-foreground">
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{course.publisher}</span>
            {course.publisherVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Verifikovan centar" />}
          </Link>
          {course.city && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" />{course.city}</p>}
          <p className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 shrink-0" />{course.duration}
            {course.rating > 0 && <><span className="text-border">·</span><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />{course.rating.toFixed(1)}</>}
          </p>
          {session && <p className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0" />{session.availableSeats > 0 ? `${session.availableSeats} slobodnih mesta` : "Popunjeno · lista čekanja"}</p>}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <strong className="text-lg">{money(course.price)}</strong>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild><Link href={`/edukacije/${course.id}`}>Detalji</Link></Button>
            {onBuy && <Button size="sm" disabled={buying === course.id} onClick={() => onBuy(course)}>
              {buying === course.id ? <Loader2 className="h-4 w-4 animate-spin" /> : session?.availableSeats === 0 ? "Lista" : "Prijava"}
            </Button>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CourseGrid({ courses, onBuy, buying }: { courses?: PublicCourse[]; onBuy: (course: PublicCourse) => void; buying: string | null }) {
  if (!courses) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!courses.length) return (
    <Card><CardContent className="py-14 text-center">
      <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-primary" />
      <p className="font-semibold">Nema edukacija za izabrane filtere.</p>
      <p className="mt-2 text-sm text-muted-foreground">Pokušajte sa širim kriterijumima ili se vratite uskoro.</p>
    </CardContent></Card>
  );
  return <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{courses.map((course) => <EducationCourseCard key={course.id} course={course} onBuy={onBuy} buying={buying} />)}</div>;
}

const EDUCATION_PAGE_SIZE = 24;

export default function EducationMarketplace() {
  const [filters, setFilters] = useState<PublicFilters>({});
  const [page, setPage] = useState(1);
  const debouncedCity = useDebouncedSearch(filters.city ?? "");
  const serverFilters = useMemo(
    () => ({ ...filters, city: debouncedCity || undefined }),
    [filters.category, filters.format, filters.level, filters.minPrice, filters.maxPrice, filters.startDate, filters.maxDurationDays, debouncedCity],
  );
  const { data: categories } = useListPublicEducationCategories();
  const { data: courses } = useListPublicEducationCourses({ ...serverFilters, page, pageSize: EDUCATION_PAGE_SIZE } as any);
  const { data: featuredCourses } = useListFeaturedEducationCourses();
  const { data: popularCourses } = useListPopularEducationCourses({ limit: 6 });
  const { buy, buying } = useEducationPurchase();

  const activeFilters = Object.keys(filters).length;
  const setFilter = <K extends keyof PublicFilters>(key: K, value: PublicFilters[K] | undefined) => {
    if (key !== "city") setPage(1);
    setFilters((previous) => {
      const next = { ...previous, [key]: value };
      if (value === undefined || value === "") delete next[key];
      return next;
    });
  };
  useEffect(() => setPage(1), [debouncedCity]);
  // Bare-array response: a full page implies another page may exist.
  const hasNextPage = (courses?.length ?? 0) === EDUCATION_PAGE_SIZE;

  return (
    <Layout>
      <section className="border-b bg-gradient-to-b from-primary/10 via-primary/5 to-background py-12 sm:py-16">
        <div className="container mx-auto px-4 text-center">
          <Badge className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> LUMERA Edukacije</Badge>
          <h1 className="mx-auto mt-4 max-w-3xl font-serif text-4xl font-bold tracking-tight sm:text-5xl">Znanje koje razvija vaš beauty posao</h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">Birajte među programima verifikovanih edukativnih centara — sa jasnim planom, slobodnim mestima i zaštićenom kupovinom.</p>
          {categories?.length ? <div className="mt-7 flex flex-wrap justify-center gap-2">
            {categories.map((category) => <Button key={category.id} variant={filters.category === category.name ? "default" : "outline"} size="sm" onClick={() => setFilter("category", filters.category === category.name ? undefined : category.name)}>
              {category.name} <span className="ml-1 opacity-70">({category.courseCount})</span>
            </Button>)}
          </div> : null}
        </div>
      </section>

      <main className="container mx-auto space-y-12 px-4 py-10">
        {featuredCourses?.length ? <section>
          <div className="mb-5 flex items-center gap-2"><Zap className="h-5 w-5 text-amber-500" /><h2 className="font-serif text-2xl font-bold">Istaknute edukacije</h2></div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{featuredCourses.map((course) => <EducationCourseCard key={course.id} course={course} onBuy={buy} buying={buying} />)}</div>
        </section> : null}

        {popularCourses?.length ? <section>
          <div className="mb-5 flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-primary">Zajednica bira</p><h2 className="font-serif text-2xl font-bold">Popularne edukacije</h2></div><BookOpen className="h-6 w-6 text-primary/70" /></div>
          <div className="flex snap-x gap-4 overflow-x-auto pb-3">
            {popularCourses.map((course) => <div key={course.id} className="w-[290px] shrink-0 snap-start"><EducationCourseCard course={course} onBuy={buy} buying={buying} compact /></div>)}
          </div>
        </section> : null}

        <section className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-xl border bg-card p-5 lg:sticky lg:top-24">
            <div className="mb-5 flex items-center justify-between border-b pb-4"><span className="flex items-center gap-2 font-semibold"><Filter className="h-4 w-4" /> Filteri</span>{activeFilters ? <Button variant="ghost" size="sm" onClick={() => { setPage(1); setFilters({}); }}>Poništi</Button> : null}</div>
            <div className="space-y-4">
              <div className="space-y-2"><Label htmlFor="education-city">Grad</Label><Input id="education-city" value={filters.city ?? ""} placeholder="Beograd, Novi Sad..." onChange={(event) => setFilter("city", event.target.value || undefined)} /></div>
              <div className="space-y-2"><Label>Format</Label><Select value={filters.format ?? "all"} onValueChange={(value) => setFilter("format", value === "all" ? undefined : value as PublicFilters["format"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Svi formati</SelectItem><SelectItem value="online">Online</SelectItem><SelectItem value="in-person">Uživo</SelectItem><SelectItem value="hybrid">Hibridno</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Nivo</Label><Select value={filters.level ?? "all"} onValueChange={(value) => setFilter("level", value === "all" ? undefined : value as PublicFilters["level"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Svi nivoi</SelectItem><SelectItem value="beginner">Početni</SelectItem><SelectItem value="intermediate">Srednji</SelectItem><SelectItem value="advanced">Napredni</SelectItem><SelectItem value="all-levels">Svi nivoi znanja</SelectItem></SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-2"><div className="space-y-2"><Label htmlFor="min-price">Od RSD</Label><Input id="min-price" type="number" min="0" value={filters.minPrice ?? ""} onChange={(event) => setFilter("minPrice", event.target.value ? Number(event.target.value) : undefined)} /></div><div className="space-y-2"><Label htmlFor="max-price">Do RSD</Label><Input id="max-price" type="number" min="0" value={filters.maxPrice ?? ""} onChange={(event) => setFilter("maxPrice", event.target.value ? Number(event.target.value) : undefined)} /></div></div>
              <div className="space-y-2"><Label htmlFor="start-date">Početak od</Label><Input id="start-date" type="date" onChange={(event) => setFilter("startDate", event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined)} /></div>
              <div className="space-y-2"><Label htmlFor="duration-days">Najviše dana</Label><Input id="duration-days" type="number" min="1" value={filters.maxDurationDays ?? ""} onChange={(event) => setFilter("maxDurationDays", event.target.value ? Number(event.target.value) : undefined)} /></div>
            </div>
          </aside>
          <div>
            <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">Verifikovani centri i aktivni termini</p><h2 className="font-serif text-3xl font-bold">Sve edukacije</h2></div>{courses ? <Badge variant="secondary">{courses.length} dostupno</Badge> : null}</div>
            <CourseGrid courses={courses} onBuy={buy} buying={buying} />
            {(page > 1 || hasNextPage) ? (
              <div className="mt-8 flex items-center justify-between gap-4">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Prethodna
                </Button>
                <span className="text-sm text-muted-foreground">Strana {page}</span>
                <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage((current) => current + 1)}>
                  Sledeća <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </Layout>
  );
}

export function EducationPublicCourseDetail() {
  const [, params] = useRoute("/edukacije/:courseId");
  const courseId = params?.courseId ?? "";
  const { data: course, isLoading, isError } = useGetPublicEducationCourse(courseId);
  const { buy, buying } = useEducationPurchase();
  const session = course ? courseSession(course) : null;
  const gallery = useMemo(() => course ? [
    { type: "image" as const, url: course.imageUrl },
    ...course.gallery.map((media) => ({ type: "image" as const, url: media.url })),
  ].filter((item, index, values) => values.findIndex((candidate) => candidate.url === item.url) === index) : [], [course]);

  if (isLoading) return <Layout><div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (isError || !course) return <Layout><div className="container mx-auto px-4 py-20 text-center"><h1 className="font-serif text-3xl font-bold">Edukacija nije dostupna</h1><p className="mt-3 text-muted-foreground">Možda više nije objavljena ili je centar trenutno neaktivan.</p><Button className="mt-6" asChild><Link href="/edukacije">Nazad na katalog</Link></Button></div></Layout>;

  return <Layout><main className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
    <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground"><Link href="/edukacije" className="hover:text-foreground">Edukacije</Link><ChevronRight className="h-4 w-4" /><span>{course.category}</span></div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="space-y-8">
        <SalonGallery media={gallery} salonName={course.title} />
        <div><div className="mb-3 flex flex-wrap gap-2"><Badge>{formatLabel[course.format]}</Badge><Badge variant="secondary">{levelLabel[course.level]}</Badge>{course.certification && <Badge variant="outline"><Award className="mr-1 h-3.5 w-3.5" /> Sertifikat</Badge>}</div><h1 className="font-serif text-4xl font-bold leading-tight">{course.title}</h1><p className="mt-4 text-lg leading-relaxed text-muted-foreground">{course.description}</p></div>
        <div className="grid gap-4 sm:grid-cols-3"><InfoCard icon={<Clock3 />} label="Trajanje" value={course.duration} /><InfoCard icon={<CalendarDays />} label="Početak" value={course.startDate ? new Date(course.startDate).toLocaleDateString("sr-RS") : "Po dogovoru"} /><InfoCard icon={<Users />} label="Mesta" value={session ? session.availableSeats > 0 ? `${session.availableSeats} slobodno` : "Lista čekanja" : "Bez ograničenja"} /></div>
        {course.dayProgram.length ? <section><h2 className="mb-4 font-serif text-2xl font-bold">Dnevni program</h2><div className="space-y-3">{course.dayProgram.map((day) => <Card key={day.id}><CardContent className="flex gap-4 p-4"><Badge className="h-7 shrink-0">Dan {day.dayNumber}</Badge><div><h3 className="font-semibold">{day.title}</h3><p className="mt-1 text-sm text-muted-foreground">{day.description}</p>{day.durationMinutes ? <p className="mt-2 text-xs text-muted-foreground">{day.durationMinutes} min</p> : null}</div></CardContent></Card>)}</div></section> : null}
        {course.learningOutcomes.length ? <section><h2 className="mb-3 font-serif text-2xl font-bold">Šta ćete naučiti</h2><div className="grid gap-2 sm:grid-cols-2">{course.learningOutcomes.map((outcome) => <div key={outcome} className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm"><BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />{outcome}</div>)}</div></section> : null}
        {(course.includedItems.length || course.requirements) ? <section className="grid gap-4 sm:grid-cols-2">{course.includedItems.length ? <Card><CardHeader><CardTitle className="text-lg">Uključeno u cenu</CardTitle></CardHeader><CardContent className="space-y-2">{course.includedItems.map((item) => <p className="flex gap-2 text-sm" key={item}><BadgeCheck className="h-4 w-4 text-primary" />{item}</p>)}</CardContent></Card> : null}{course.requirements ? <Card><CardHeader><CardTitle className="text-lg">Preduslovi</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{course.requirements}</CardContent></Card> : null}</section> : null}
        {course.center ? <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><OptimizedImage src={course.center.imageUrl} alt={course.center.name} width={64} height={64} preferredSize="thumbnail" responsiveSizes="64px" className="h-16 w-16 rounded-xl object-cover" /><div className="flex-1"><p className="font-semibold">{course.center.name}</p><p className="mt-1 text-sm text-muted-foreground">{course.center.description}</p></div><Button variant="outline" asChild><Link href={`/edukacije/centri/${course.center.id}`}>Profil centra</Link></Button></CardContent></Card> : null}
        {course.reviews.length ? <section><h2 className="mb-4 font-serif text-2xl font-bold">Utisci polaznika</h2><div className="space-y-3">{course.reviews.map((review) => <Card key={review.id}><CardContent className="p-4"><p className="flex items-center gap-1 text-sm text-amber-600"><Star className="h-4 w-4 fill-amber-500" />{review.rating.toFixed(1)}</p><p className="mt-2 text-sm">{review.comment}</p></CardContent></Card>)}</div></section> : null}
      </div>
      <aside><Card className="sticky top-24 border-primary/25"><CardContent className="p-6"><p className="text-2xl font-bold">{money(course.price)}</p><p className="mt-1 text-sm text-muted-foreground">Jednokratna kupovina · potvrda uplate od administratora</p><Separator className="my-5" /><div className="space-y-3 text-sm"><p className="flex gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{course.publisher}</p>{course.city ? <p className="flex gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{course.city} <span className="text-muted-foreground">· detalji po uplati</span></p> : null}<p className="flex gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{course.refundPolicy}</p></div><Button className="mt-6 w-full" size="lg" disabled={buying === course.id} onClick={() => buy(course)}>{buying === course.id ? <Loader2 className="h-4 w-4 animate-spin" /> : session?.availableSeats === 0 ? "Dodaj se na listu čekanja" : "Prijavi se na edukaciju"}</Button></CardContent></Card></aside>
    </div>
  </main></Layout>;
}

function InfoCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <Card><CardContent className="flex gap-3 p-4"><span className="text-primary">{icon}</span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium text-sm">{value}</p></div></CardContent></Card>;
}

export function EducationPublicCenterPage() {
  const [, params] = useRoute("/edukacije/centri/:centerId");
  const centerId = params?.centerId ?? "";
  const { data: center, isLoading, isError } = useGetPublicEducationCenter(centerId);
  const { buy, buying } = useEducationPurchase();
  if (isLoading) return <Layout><div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (isError || !center) return <Layout><div className="container mx-auto px-4 py-20 text-center"><h1 className="font-serif text-3xl font-bold">Centar nije dostupan</h1><Button className="mt-6" asChild><Link href="/edukacije">Nazad na katalog</Link></Button></div></Layout>;
  const gallery = [{ type: "image" as const, url: center.imageUrl }, ...center.gallery.map((media) => ({ type: "image" as const, url: media.url }))];
  return <Layout><main className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
    <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground"><Link href="/edukacije" className="hover:text-foreground">Edukacije</Link><ChevronRight className="h-4 w-4" /><span>Centar</span></div>
    <SalonGallery media={gallery} salonName={center.name} />
    <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="secondary"><BadgeCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Verifikovan centar</Badge><Badge variant="outline">{center.courseCount} edukacija</Badge></div><h1 className="mt-3 font-serif text-4xl font-bold">{center.name}</h1><p className="mt-3 max-w-3xl text-lg text-muted-foreground">{center.description}</p></div><Card><CardContent className="space-y-3 p-5 text-sm"><p className="flex gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{center.city}</p><p className="flex gap-2"><Star className="h-4 w-4 fill-amber-500 text-amber-500" />{center.rating ? `${center.rating.toFixed(1)} · ${center.reviewCount} utisaka` : "Novi centar"}</p>{center.websiteUrl ? <a className="block text-primary underline" href={center.websiteUrl} target="_blank" rel="noreferrer">Sajt centra</a> : null}{center.instagramUrl ? <a className="block text-primary underline" href={center.instagramUrl} target="_blank" rel="noreferrer">Instagram</a> : null}</CardContent></Card></section>
    <section className="mt-10"><h2 className="mb-5 font-serif text-3xl font-bold">Edukacije centra</h2><CourseGrid courses={center.courses} onBuy={buy} buying={buying} /></section>
  </main></Layout>;
}