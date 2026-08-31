import { useState, useMemo, useEffect, ReactNode } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import {
  Award, BadgeCheck, BookOpen, Building2, CalendarDays, ChevronLeft, ChevronRight,
  Clock3, Filter, Loader2, MapPin, ShieldCheck, Sparkles, Star, Users, Zap, Search, MessageCircle,
  LayoutGrid, TrendingUp, ChevronDown, CheckCircle2, Navigation, ArrowLeft, ArrowRight
} from "lucide-react";
import {
  useGetCurrentUser,
  useGetPublicEducationCenter,
  useGetPublicEducationCourse,
  useListPublicEducationCourses,
  useGetPublicEducationTaxonomy,
  useGetPublicEducationRankings,
  useListPublicEducationPlacements,
  useListPublicEducationSearchSuggestions, getListPublicEducationSearchSuggestionsQueryKey,
  useCreatePublicEducationCourseInquiry,
  getGetPublicEducationTaxonomyQueryKey,
  getGetPublicEducationRankingsQueryKey,
  getListPublicEducationPlacementsQueryKey,
  getListPublicEducationCoursesQueryKey,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { SalonGallery } from "@/components/salon-gallery";
import { OptimizedImage } from "@/components/optimized-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const money = (value: number) => new Intl.NumberFormat("sr-RS", {
  style: "currency", currency: "RSD", maximumFractionDigits: 0,
}).format(value);

const levelLabel: Record<string, string> = {
  beginner: "Početni",
  intermediate: "Srednji",
  advanced: "Napredni",
  "all-levels": "Svi nivoi",
};

const formatLabel: Record<string, string> = {
  online: "Online",
  "in-person": "Uživo",
  hybrid: "Hibridno",
};

function courseSession(course: any) {
  return course.sessions?.find((item: any) => !item.cancelledAt) ?? course.sessions?.[0] ?? null;
}

export function EducationCourseCard({ course, compact = false, placementLabel, onBuy, buying }: {
  course: any;
  compact?: boolean;
  placementLabel?: string;
  onBuy?: (c: any) => void;
  buying?: string | null;
}) {
  const session = courseSession(course);
  return (
    <Card className="group flex h-full flex-col overflow-hidden border-border/60 transition-all hover:border-primary/30 hover:shadow-xl hover:-translate-y-1">
      <Link href={`/edukacije/${course.id}`} className="block aspect-[16/9] overflow-hidden bg-muted relative">
        <OptimizedImage src={course.imageUrl} alt={course.title} width={800} height={450} responsiveSizes="(max-width: 640px) 100vw, 400px" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
        {placementLabel && (
          <div className="absolute top-3 right-3">
            <Badge variant="default" className="bg-background/95 backdrop-blur text-foreground border border-border shadow-sm">{placementLabel}</Badge>
          </div>
        )}
      </Link>
      <CardContent className={`flex flex-1 flex-col ${compact ? "p-4" : "p-5"}`}>
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge variant="secondary" className="bg-primary/5 text-primary hover:bg-primary/10">{formatLabel[course.format] ?? course.format}</Badge>
          {course.certification && <Badge variant="outline" className="border-primary/20 text-primary/80">Sertifikat</Badge>}
          {course.level && <Badge variant="outline" className="text-muted-foreground">{levelLabel[course.level] ?? course.level}</Badge>}
        </div>
        <Link href={`/edukacije/${course.id}`} className="font-serif text-xl font-bold leading-tight hover:text-primary mt-1 line-clamp-2">
          {course.title}
        </Link>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground leading-relaxed">{course.description}</p>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground font-medium">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-primary/60" />
            <span className="truncate">{course.publisher ?? course.centerName}</span>
            {course.publisherVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Verifikovan centar" />}
          </div>
          {course.city && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-primary/60" />{course.city}</p>}
          <p className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 shrink-0 text-primary/60" />{course.duration}
            {course.rating > 0 && <><span className="text-border mx-1">·</span><Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />{course.rating.toFixed(1)}</>}
          </p>
          {session && <p className="flex items-center gap-2"><Users className="h-4 w-4 shrink-0 text-primary/60" />{session.availableSeats > 0 ? <span className="text-emerald-600">{session.availableSeats} slobodnih mesta</span> : "Lista čekanja"}</p>}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 pt-5 border-t border-border/40 mt-5">
          <strong className="text-lg font-serif">{money(course.price)}</strong>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors" asChild>
              <Link href={`/edukacije/${course.id}`}>Detalji</Link>
            </Button>
            {onBuy && <Button size="sm" disabled={buying === course.id} onClick={() => onBuy(course)}>
              {buying === course.id ? <Loader2 className="h-4 w-4 animate-spin" /> : (course.format !== 'online' && courseSession(course)?.availableSeats === 0) ? "Lista" : "Prijava"}
            </Button>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CourseGrid({ courses, loading, onBuy, buying }: { courses?: any[]; loading?: boolean; onBuy?: (c: any) => void; buying?: string | null }) {
  if (loading) return <div className="flex justify-center py-20"><Loader2 className="h-10 w-10 animate-spin text-primary/50" /></div>;
  if (!courses?.length) return (
    <Card className="border-dashed bg-muted/20"><CardContent className="py-16 text-center">
      <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/5 mb-4">
        <Filter className="h-8 w-8 text-primary/40" />
      </div>
      <p className="font-serif text-xl font-bold text-foreground">Nema rezultata</p>
      <p className="mt-2 text-muted-foreground max-w-md mx-auto">Pokušajte sa širim kriterijumima pretrage ili uklonite neke od filtera.</p>
    </CardContent></Card>
  );
  return <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{courses.map((course) => <EducationCourseCard key={course.id} course={course} onBuy={onBuy} buying={buying} />)}</div>;
}

function AutocompleteSearch({ onSelect }: { onSelect: (id: string, type: string) => void }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedSearch(query);
  const { data: suggestions, isLoading } = useListPublicEducationSearchSuggestions(
    { q: debouncedQuery, limit: 5 },
    { query: { enabled: debouncedQuery.length > 1, queryKey: getListPublicEducationSearchSuggestionsQueryKey({ q: debouncedQuery, limit: 5 }) } }
  );

  return (
    <div className="relative w-full max-w-2xl mx-auto z-50">
      <div className="relative flex items-center">
        <Search className="absolute left-4 h-5 w-5 text-muted-foreground" />
        <Input
          className="h-14 pl-12 pr-4 rounded-full border-border/60 shadow-lg text-lg bg-background/95 backdrop-blur focus-visible:ring-primary/20"
          placeholder="Pretraži kurseve, tehnike, edukatore..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {isLoading && <Loader2 className="absolute right-4 h-5 w-5 animate-spin text-muted-foreground" />}
      </div>

      {suggestions && suggestions.length > 0 && query.length > 1 && (
        <Card className="absolute top-full left-0 right-0 mt-2 shadow-xl border-border overflow-hidden">
          <ul className="py-2">
            {suggestions.map((item) => (
              <li key={item.id}>
                <button
                  className="w-full px-4 py-3 text-left hover:bg-muted/50 flex flex-col items-start transition-colors"
                  onClick={() => { setQuery(""); onSelect(item.id, item.kind); }}
                >
                  <span className="font-medium text-foreground">{item.label}</span>
                  {item.path && item.path.length > 0 && (
                    <span className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      {item.path.join(" / ")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const EDUCATION_PAGE_SIZE = 24;

export default function EducationMarketplace() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const q = searchParams.get("q") || undefined;
  const categoryFilter = searchParams.get("category") || undefined;
  const sectionId = searchParams.get("sectionId") || undefined;
  const categoryId = searchParams.get("categoryId") || undefined;
  const subcategoryId = searchParams.get("subcategoryId") || undefined;
  const courseTypeId = searchParams.get("courseTypeId") || undefined;
  const formatFilter = searchParams.get("format") as any || undefined;
  const cityFilter = searchParams.get("city") || undefined;
  const levelFilter = searchParams.get("level") as any || undefined;
  const languageFilter = searchParams.get("language") || undefined;
  const accreditedFilter = searchParams.get("accredited") === "true" ? true : undefined;
  const minPrice = searchParams.get("minPrice") ? Number(searchParams.get("minPrice")) : undefined;
  const maxPrice = searchParams.get("maxPrice") ? Number(searchParams.get("maxPrice")) : undefined;

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchString);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1'); // setPage(1)
    setLocation(`?${next.toString()}`);
  };

  const { data: taxonomy } = useGetPublicEducationTaxonomy({ query: { queryKey: getGetPublicEducationTaxonomyQueryKey() } });
  const { data: rankings } = useGetPublicEducationRankings({ query: { queryKey: getGetPublicEducationRankingsQueryKey() } });
  const { data: placements } = useListPublicEducationPlacements({ scope: "home" }, { query: { queryKey: getListPublicEducationPlacementsQueryKey({ scope: "home" }) } });

  const { data: courses, isLoading: loadingCourses } = useListPublicEducationCourses({
    q,
    category: categoryFilter,
    sectionId,
    categoryId,
    subcategoryId,
    courseTypeId,
    format: formatFilter,
    city: cityFilter,
    level: levelFilter,
    language: languageFilter,
    accredited: accreditedFilter,
    minPrice,
    maxPrice,
    page,
    pageSize: EDUCATION_PAGE_SIZE
  } as any, { query: { queryKey: getListPublicEducationCoursesQueryKey({ q, category: categoryFilter, sectionId, categoryId, subcategoryId, courseTypeId, format: formatFilter, city: cityFilter, level: levelFilter, language: languageFilter, accredited: accreditedFilter, minPrice, maxPrice, page, pageSize: EDUCATION_PAGE_SIZE } as any) } });

  const hasNextPage = (courses?.length ?? 0) === EDUCATION_PAGE_SIZE;

  const flatCategories = useMemo(() => {
    if (!taxonomy) return [];
    return taxonomy.flatMap(section => section.categories).sort((a, b) => b.courseCount - a.courseCount);
  }, [taxonomy]);

  return (
    <Layout hideCustomerNavigation>
      <div className="relative overflow-hidden bg-background">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&q=80')] bg-cover bg-center opacity-[0.03]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />

        <div className="container relative z-10 mx-auto px-4 text-center py-20 lg:py-28">
          <Badge className="mb-6 h-8 px-4 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 text-sm font-medium tracking-wide">
            <Sparkles className="mr-2 h-4 w-4" /> B2B Edukacije
          </Badge>
          <h1 className="mx-auto max-w-4xl font-serif text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl leading-[1.1]">
            Evolucija vašeg <span className="text-primary italic">zanata</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed">
            Zvanični registar verifikovanih kurseva, masterclass-ova i sertifikovanih obuka za profesionalce u industriji lepote.
          </p>

          <div className="mt-10">
            <AutocompleteSearch onSelect={(id, kind) => {
              if (kind === 'course') setLocation(`/edukacije/${id}`);
              else if (kind === 'center') setLocation(`/edukacije/centri/${id}`);
              else if (kind === 'section') setFilter('sectionId', id);
              else if (kind === 'category') setFilter('categoryId', id);
              else if (kind === 'subcategory') setFilter('subcategoryId', id);
              else if (kind === 'courseType') setFilter('courseTypeId', id);
              else setFilter('q', id); // fallback to text search
            }} />
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {flatCategories.slice(0, 5).map(cat => (
              <Button key={cat.id} variant="secondary" size="sm" className="rounded-full bg-secondary/50 hover:bg-secondary border border-border/50 text-xs font-medium px-4 h-9" onClick={() => setFilter('categoryId', cat.id)}>
                {cat.name}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col lg:flex-row gap-10">
          {/* Mobile Filter Toggle */}
          <div className="lg:hidden flex items-center justify-between mb-4">
            <h2 className="font-serif text-2xl font-bold">Katalog</h2>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm"><Filter className="w-4 h-4 mr-2" /> Filteri</Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[300px] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Filteri</SheetTitle>
                </SheetHeader>
                <div className="py-4 space-y-6">
                  {/* Reuse the desktop filter fields here by moving them to a component or just repeating */}
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pretraga</Label>
                    <Input placeholder="Pretraži..." value={q || ""} onChange={e => setFilter('q', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Cena</Label>
                    <div className="flex gap-2">
                      <Input placeholder="Od" type="number" value={minPrice || ""} onChange={e => setFilter('minPrice', e.target.value)} />
                      <Input placeholder="Do" type="number" value={maxPrice || ""} onChange={e => setFilter('maxPrice', e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="accr-mob" checked={!!accreditedFilter} onCheckedChange={c => setFilter('accredited', c ? 'true' : undefined)} />
                    <Label htmlFor="accr-mob">Samo akreditovano</Label>
                  </div>
                  <Button variant="secondary" className="w-full" onClick={() => setLocation('?')}>Obriši filtere</Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <aside className="hidden lg:block w-72 shrink-0">
            <div className="sticky top-24 bg-card border border-border/60 rounded-2xl p-6 shadow-sm space-y-8">
              <div>
                <h3 className="flex items-center text-sm font-semibold uppercase tracking-wider text-foreground mb-4">
                  <Filter className="w-4 h-4 mr-2 text-primary" /> Filteri pretrage
                </h3>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Format</Label>
                    <Select value={formatFilter || ""} onValueChange={v => setFilter("format", v === "all" ? undefined : v)}>
                      <SelectTrigger className="bg-background border-border/50"><SelectValue placeholder="Svi formati" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Svi formati</SelectItem>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="in-person">Uživo</SelectItem>
                        <SelectItem value="hybrid">Hibridno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Nivo</Label>
                    <Select value={levelFilter || ""} onValueChange={v => setFilter("level", v === "all" ? undefined : v)}>
                      <SelectTrigger className="bg-background border-border/50"><SelectValue placeholder="Svi nivoi" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Svi nivoi</SelectItem>
                        <SelectItem value="beginner">Početni</SelectItem>
                        <SelectItem value="intermediate">Srednji</SelectItem>
                        <SelectItem value="advanced">Napredni</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Grad</Label>
                    <Input placeholder="Npr. Beograd" value={cityFilter || ""} onChange={e => setFilter("city", e.target.value)} className="bg-background border-border/50" />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Cena (RSD)</Label>
                    <div className="flex gap-2">
                      <Input placeholder="Od" type="number" value={minPrice || ""} onChange={e => setFilter('minPrice', e.target.value)} />
                      <Input placeholder="Do" type="number" value={maxPrice || ""} onChange={e => setFilter('maxPrice', e.target.value)} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Checkbox id="accr" checked={!!accreditedFilter} onCheckedChange={c => setFilter('accredited', c ? 'true' : undefined)} />
                    <Label htmlFor="accr">Samo akreditovane obuke</Label>
                  </div>
                </div>
              </div>
              {(formatFilter || cityFilter || levelFilter || minPrice || maxPrice || accreditedFilter || q || sectionId || categoryId || subcategoryId || courseTypeId) && (
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground hover:text-foreground" onClick={() => setLocation("?")}>
                  Obriši sve filtere
                </Button>
              )}
            </div>
          </aside>

          <main className="flex-1 space-y-16">
            {placements && placements.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-serif text-3xl font-bold text-foreground">Sponzorisane pozicije</h2>
                </div>
                <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {placements.map((placement: any) => {
  if (placement.kind === 'special_offer') {
    return (
      <Link key={placement.id} href={`/edukacije/${placement.courseId}`}>
        <Card className="h-full overflow-hidden hover:shadow-lg transition-all border-primary/20 bg-primary/5 group relative" data-testid="placement-special-offer">
          <Badge variant="default" className="absolute top-3 right-3 z-10 shadow-md bg-primary text-primary-foreground">Sponzorisano</Badge>
          <div className="aspect-[4/3] w-full overflow-hidden relative">
            <img src={placement.courseImageUrl || placement.centerImageUrl || "https://placehold.co/600x400/e2e8f0/64748b?text=Edukacija"} alt={placement.courseTitle || placement.label} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          </div>
          <div className="p-5 flex flex-col h-[calc(100%-75%)]">
            <h3 className="font-serif font-bold text-lg line-clamp-2">{placement.courseTitle || placement.label}</h3>
            {placement.courseTitle && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{placement.label}</p>}
            <div className="mt-auto pt-4 flex flex-col gap-1">
              <span className="text-sm font-medium">{placement.centerName}</span>
              {placement.coursePrice !== undefined && <span className="font-bold text-primary">{money(placement.coursePrice)}</span>}
            </div>
          </div>
        </Card>
      </Link>
    );
  }
  return (
    <Link key={placement.id} href={`/edukacije/centri/${placement.centerId}`}>
      <Card className="h-full overflow-hidden hover:shadow-lg transition-all border-primary/20 bg-primary/5 group relative" data-testid="placement-featured-center">
        <Badge variant="default" className="absolute top-3 right-3 z-10 shadow-md bg-primary text-primary-foreground">Sponzorisano</Badge>
        <div className="p-5 pt-10 flex flex-col items-center text-center h-full">
          <div className="w-24 h-24 rounded-full bg-background flex items-center justify-center font-bold text-primary text-2xl shadow-sm mb-4 border border-primary/20 overflow-hidden">
            {placement.centerImageUrl ? <img src={placement.centerImageUrl} alt={placement.centerName} className="w-full h-full object-cover" /> : placement.centerName?.charAt(0)}
          </div>
          <h3 className="font-serif font-bold text-xl">{placement.centerName}</h3>
          <p className="text-sm text-muted-foreground mt-3 flex-1">{placement.label}</p>
        </div>
      </Card>
    </Link>
  );
})}
                </div>
              </section>
            )}

            <section>
              <div className="flex items-end justify-between mb-8">
                <div>
                  <h2 className="font-serif text-3xl font-bold text-foreground">Sve edukacije</h2>
                  <p className="text-muted-foreground mt-2">Pronađite pravu obuku za vaš sledeći korak.</p>
                </div>
              </div>

              {loadingCourses ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="space-y-4">
                      <div className="aspect-[4/3] bg-muted/50 rounded-2xl animate-pulse" />
                      <div className="h-5 bg-muted/50 rounded w-3/4 animate-pulse" />
                      <div className="h-4 bg-muted/50 rounded w-1/2 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : courses && courses.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
                  {courses.map((course: any) => (
                    <EducationCourseCard key={course.id} course={course} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-24 bg-card border border-border/60 rounded-3xl shadow-sm">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">Nema rezultata</h3>
                  <p className="text-muted-foreground max-w-sm mx-auto">
                    Nismo pronašli edukacije koje odgovaraju vašim kriterijumima. Pokušajte sa drugim filterima.
                  </p>
                  <Button variant="outline" className="mt-6" onClick={() => setLocation("?")}>
                    Prikaži sve edukacije
                  </Button>
                </div>
              )}

              <div className="mt-12 flex items-center justify-center gap-4 border-t border-border/50 pt-8">
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setFilter("page", (page - 1).toString())}
                >
                  <ArrowLeft className="w-4 h-4 mr-2" /> Prethodna
                </Button>
                <span className="text-sm font-medium text-muted-foreground">Strana {page}</span>
                <Button
                  variant="outline"
                  disabled={!hasNextPage}
                  onClick={() => setFilter("page", (page + 1).toString())}
                >
                  Sledeća <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </section>

            {rankings && (
              <section className="border-t border-border/50 pt-16">
                <div className="text-center mb-12">
                  <h2 className="font-serif text-3xl font-bold text-foreground">Najtraženiji centri (90 dana)</h2>
                  <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">Centri sa najvećim brojem uspešnih upisa i pozitivnih ocena zajednice.</p>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  {rankings.mostRequestedCenters90d.slice(0, 3).map((center: any, idx: number) => (
                    <Link key={center.centerId} href={`/edukacije/centri/${center.centerId}`}>
                      <Card className="h-full hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer bg-background relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-primary/10 rounded-bl-[100px] flex items-start justify-end p-3 transition-colors group-hover:bg-primary/20">
                          <span className="font-serif font-bold text-xl text-primary leading-none">#{idx + 1}</span>
                        </div>
                        <CardContent className="p-6 text-center flex flex-col items-center">
                          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-2xl mb-4 border border-primary/20">
                            {center.name.charAt(0)}
                          </div>
                          <h3 className="font-serif font-bold text-lg leading-tight">{center.name}</h3>
                          <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1">
                            <MapPin className="h-3.5 w-3.5" /> {center.city}
                          </p>
                          <div className="mt-4 flex flex-wrap justify-center gap-2">
                            <Badge variant="secondary" className="font-normal">{center.metric} upita</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {rankings && (
              <section className="border-t border-border/50 pt-16">
                <div className="text-center mb-12">
                  <h2 className="font-serif text-3xl font-bold text-foreground">Novi centri</h2>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  {rankings.newCenters.slice(0, 3).map((center: any) => (
                    <Link key={center.centerId} href={`/edukacije/centri/${center.centerId}`}>
                      <Card className="h-full hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer bg-background relative overflow-hidden group">
                        <CardContent className="p-6 text-center flex flex-col items-center">
                          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-2xl mb-4 border border-primary/20">
                            {center.name.charAt(0)}
                          </div>
                          <h3 className="font-serif font-bold text-lg leading-tight">{center.name}</h3>
                          <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1">
                            <MapPin className="h-3.5 w-3.5" /> {center.city}
                          </p>
                          <div className="mt-4 flex flex-wrap justify-center gap-2">
                            <Badge variant="secondary" className="font-normal">Novo</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}

                      {rankings && rankings.topRatedCenters && rankings.topRatedCenters.length > 0 && (
              <section className="border-t border-border/50 pt-16">
                <div className="text-center mb-12">
                  <h2 className="font-serif text-3xl font-bold text-foreground">Najbolje ocenjeni centri</h2>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  {rankings.topRatedCenters.slice(0, 3).map((center: any) => (
                    <Link key={center.centerId} href={`/edukacije/centri/${center.centerId}`}>
                      <Card className="h-full hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer bg-background relative overflow-hidden group">
                        <CardContent className="p-6 text-center flex flex-col items-center">
                          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-2xl mb-4 border border-primary/20">
                            {center.name.charAt(0)}
                          </div>
                          <h3 className="font-serif font-bold text-lg leading-tight">{center.name}</h3>
                          <p className="text-sm text-muted-foreground mt-1 flex items-center justify-center gap-1">
                            <MapPin className="h-3.5 w-3.5" /> {center.city}
                          </p>
                          <div className="mt-4 flex flex-wrap justify-center gap-2">
                            <Badge variant="secondary" className="font-normal"><Star className="h-3 w-3 fill-amber-500 text-amber-500 mr-1"/> {center.metric.toFixed(1)}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {rankings && rankings.popularCategories30d && rankings.popularCategories30d.length > 0 && (
              <section className="border-t border-border/50 pt-16 pb-8">
                <div className="text-center mb-12">
                  <h2 className="font-serif text-3xl font-bold text-foreground">Popularne kategorije</h2>
                </div>
                <div className="flex flex-wrap justify-center gap-4">
                  {rankings.popularCategories30d.map((cat: any) => (
                    <Button key={cat.categoryId} variant="outline" size="lg" className="rounded-full shadow-sm hover:border-primary/50" onClick={() => setFilter('categoryId', cat.categoryId)}>
                      {cat.name} <Badge className="ml-2 bg-primary/10 text-primary hover:bg-primary/20 border-0">{cat.metric} upita</Badge>
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
      </div>
    </Layout>
  );
}
function useEducationPurchase() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: currentUser } = useGetCurrentUser();
  const [buying, setBuying] = useState<string | null>(null);

  const buy = async (course: any) => {
    if (!currentUser?.user) {
      setLocation("/prijava");
      return;
    }
    if (currentUser.user.role === "CUSTOMER") {
      toast.error("Nije dozvoljeno", { description: "Samo poslovni korisnici i studenti mogu da kupuju edukacije." });
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
      setLocation(currentUser.user.role === "STUDENT" ? "/student/edukacije" : currentUser.user.role === "JOBSEEKER" ? "/poslovi/nalog/edukacije" : "/biznis/edukacije");
    } catch (error) {
      toast.error("Zahtev nije poslat", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBuying(null);
    }
  };
  return { buy, buying };
}

export function EducationPublicCourseDetail() {
  const [, params] = useRoute("/edukacije/:courseId");
  const courseId = params?.courseId ?? "";
  const { data: course, isLoading, isError } = useGetPublicEducationCourse(courseId);
  const { data: currentUser } = useGetCurrentUser();
  const { buy, buying } = useEducationPurchase();
  const session = course ? courseSession(course) : null;
  const [, setLocation] = useLocation();

  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryMsg, setInquiryMsg] = useState("");
  const inquiryMut = useCreatePublicEducationCourseInquiry();
  const { toast } = useToast();
  const canSendInquiry = Boolean(
    currentUser?.user
    && ["SALON_OWNER", "EDUKATIVNI_CENTAR", "JOBSEEKER", "STUDENT"].includes(currentUser.user.role),
  );

  const sendInquiry = () => {
    if (!canSendInquiry) {
      toast.error("Nije dozvoljeno", { description: "Samo poslovni korisnici i studenti mogu poslati upit." });
      return;
    }
    if (!inquiryMsg.trim()) {
      toast.error("Greška", { description: "Unesite poruku." });
      return;
    }
    inquiryMut.mutate({ courseId, data: { message: inquiryMsg } }, {
      onSuccess: () => {
        toast.success("Upit je poslat", { description: "Centar će vas kontaktirati." });
        setInquiryOpen(false);
        setInquiryMsg("");
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };
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
                {course.theoryHours || course.practicalHours || course.language ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {course.theoryHours ? <InfoCard icon={<BookOpen />} label="Teorija" value={`${course.theoryHours} časova`} /> : null}
            {course.practicalHours ? <InfoCard icon={<Zap />} label="Praksa" value={`${course.practicalHours} časova`} /> : null}
            {course.language ? <InfoCard icon={<Users />} label="Jezik" value={course.language} /> : null}
          </div>
        ) : null}

        {course.faq && course.faq.length > 0 ? (
          <section>
            <h2 className="mb-4 font-serif text-2xl font-bold">Česta pitanja</h2>
            <div className="space-y-4">
              {course.faq.map((f: any, i: number) => (
                <div key={i} className="rounded-lg bg-muted/30 p-4">
                  <h4 className="font-semibold text-foreground mb-2">{f.question}</h4>
                  <p className="text-muted-foreground text-sm">{f.answer}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {course.dayProgram.length ? <section><h2 className="mb-4 font-serif text-2xl font-bold">Dnevni program</h2><div className="space-y-3">{course.dayProgram.map((day) => <Card key={day.id}><CardContent className="flex gap-4 p-4"><Badge className="h-7 shrink-0">Dan {day.dayNumber}</Badge><div><h3 className="font-semibold">{day.title}</h3><p className="mt-1 text-sm text-muted-foreground">{day.description}</p>{day.durationMinutes ? <p className="mt-2 text-xs text-muted-foreground">{day.durationMinutes} min</p> : null}</div></CardContent></Card>)}</div></section> : null}
        {course.learningOutcomes.length ? <section><h2 className="mb-3 font-serif text-2xl font-bold">Šta ćete naučiti</h2><div className="grid gap-2 sm:grid-cols-2">{course.learningOutcomes.map((outcome) => <div key={outcome} className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm"><BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />{outcome}</div>)}</div></section> : null}
        {(course.includedItems.length || course.requirements) ? <section className="grid gap-4 sm:grid-cols-2">{course.includedItems.length ? <Card><CardHeader><CardTitle className="text-lg">Uključeno u cenu</CardTitle></CardHeader><CardContent className="space-y-2">{course.includedItems.map((item) => <p className="flex gap-2 text-sm" key={item}><BadgeCheck className="h-4 w-4 text-primary" />{item}</p>)}</CardContent></Card> : null}{course.requirements ? <Card><CardHeader><CardTitle className="text-lg">Preduslovi</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{course.requirements}</CardContent></Card> : null}</section> : null}
        {course.center ? <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><OptimizedImage src={course.center.imageUrl} alt={course.center.name} width={64} height={64} preferredSize="thumbnail" responsiveSizes="64px" className="h-16 w-16 rounded-xl object-cover" /><div className="flex-1"><p className="font-semibold">{course.center.name}</p><p className="mt-1 text-sm text-muted-foreground">{course.center.description}</p></div><Button variant="outline" asChild><Link href={`/edukacije/centri/${course.center.id}`}>Profil centra</Link></Button></CardContent></Card> : null}
        {course.reviews.length ? <section><h2 className="mb-4 font-serif text-2xl font-bold">Utisci polaznika</h2><div className="space-y-3">{course.reviews.map((review) => <Card key={review.id}><CardContent className="p-4"><p className="flex items-center gap-1 text-sm text-amber-600"><Star className="h-4 w-4 fill-amber-500" />{review.rating.toFixed(1)}</p><p className="mt-2 text-sm">{review.comment}</p></CardContent></Card>)}</div></section> : null}
      </div>
      <aside><Card className="sticky top-24 border-primary/25"><CardContent className="p-6"><p className="text-2xl font-bold">{money(course.price)}</p>{course.paymentMode === "live_deposit" ? <p className="mt-1 text-sm text-muted-foreground">Plaćanje depozita od {money(course.depositAmount || 0)} za rezervaciju, ostatak uživo.</p> : course.paymentMode === "live_off_platform" ? <p className="mt-1 text-sm text-muted-foreground">Plaćanje uživo na lokaciji centra.</p> : <p className="mt-1 text-sm text-muted-foreground">Jednokratna uplata celokupnog iznosa.</p>}<Separator className="my-5" /><div className="space-y-3 text-sm"><p className="flex gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{course.publisher}</p>{course.city ? <p className="flex gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{course.city} <span className="text-muted-foreground">· detalji po uplati</span></p> : null}<p className="flex gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{course.refundPolicy}</p></div>
      {(!currentUser?.user || currentUser.user.role !== "CUSTOMER") && (
        <>
          <Button data-testid="buy-course-btn" className="mt-6 w-full" size="lg" disabled={buying === course.id} onClick={() => buy(course)}>{buying === course.id ? <Loader2 className="h-4 w-4 animate-spin" /> : session?.availableSeats === 0 ? "Dodaj se na listu čekanja" : "Prijavi se na edukaciju"}</Button>
          {canSendInquiry ? (
            <>
              <Button data-testid="inquiry-course-btn" variant="outline" className="mt-2 w-full" size="lg" onClick={() => setInquiryOpen(true)}><MessageCircle className="h-4 w-4 mr-2"/>Pošalji upit</Button>
              <Dialog open={inquiryOpen} onOpenChange={setInquiryOpen}>
                <DialogContent data-testid="inquiry-dialog">
                  <DialogHeader><DialogTitle>Pošalji upit centru</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Vaša poruka (do 2000 karaktera)</Label>
                      <Textarea value={inquiryMsg} onChange={e => setInquiryMsg(e.target.value)} placeholder="Postavite pitanje u vezi edukacije..." className="min-h-[120px]" maxLength={2000} />
                    </div>
                    <Button data-testid="submit-inquiry-btn" className="w-full" onClick={sendInquiry} disabled={inquiryMut.isPending}>Pošalji upit</Button>
                </div>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
        </>
      )}

      </CardContent></Card></aside>
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