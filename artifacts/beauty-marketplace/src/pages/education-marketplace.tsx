import { useState, useMemo, useEffect, ReactNode } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import {
  Award, BadgeCheck, BookOpen, Building2, CalendarDays, ChevronLeft, ChevronRight,
  Gift, Heart, Briefcase,
  Clock3, Filter, Loader2, MapPin, ShieldCheck, Sparkles, Star, Users, Zap, Search, MessageCircle,
  LayoutGrid, TrendingUp, ChevronDown, CheckCircle2, Navigation, ArrowLeft, ArrowRight
} from "lucide-react";
import {
  useGetCurrentUser,
   useListEducationBundles,
  useGetPublicEducationCenter,
  useGetPublicEducationCourse,
  useListPublicEducationCourses, ListPublicEducationCoursesParams, ListPublicEducationPlacementsParams,

  useListRelatedEducationCourses,
  getListRelatedEducationCoursesQueryKey,
  useListEducationWishlist,
  useAddEducationWishlistItem,
  useRemoveEducationWishlistItem,
  getListEducationWishlistQueryKey,
  usePurchaseEducationGiftVoucher,
  useListEducationGiftVouchers,
  getListEducationGiftVouchersQueryKey,
  useRedeemEducationGiftVoucher,

  useGetPublicEducationTaxonomy,
  useGetPublicEducationRankings,
  useListPublicEducationPlacements,
  useListPublicEducationSearchSuggestions, getListPublicEducationSearchSuggestionsQueryKey,
  useCreatePublicEducationCourseInquiry,
  useCreateEducationOperationalBooking,
  useGetEducationCourseAvailability,
  useGetEducationCenterStatus,
  useListPublicEducationCenterReviews,
  getListPublicEducationCenterReviewsQueryKey,
  useCreateEducationCenterReview,
  getGetPublicEducationCenterQueryKey,
  getGetPublicEducationTaxonomyQueryKey,
  getGetPublicEducationRankingsQueryKey,
  getListPublicEducationPlacementsQueryKey,
  getListPublicEducationCoursesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { EducationOperationalBookingFlow } from "@/components/education/booking-flow";
import { educationBookingCtaVisible } from "@/lib/education-operational-time";
import { EducationFieldHelp } from "@/components/education/education-field-help";

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


export function CourseWishlistButton({ course }: { course: any }) {
  const { data: user } = useGetCurrentUser();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: wishlistData } = useListEducationWishlist({ page: 1, pageSize: 1000 }, {
    query: {
      enabled: !!user?.user,
      queryKey: getListEducationWishlistQueryKey({ page: 1, pageSize: 1000 })
    }
  });

  const isSaved = wishlistData?.items?.some((i: any) => i.course?.id === course.id);

  const addMut = useAddEducationWishlistItem({
    mutation: {
      onSuccess: () => {
        toast.success("Sačuvano", { description: "Edukacija je dodata u vašu listu želja." });
        queryClient.invalidateQueries({ queryKey: getListEducationWishlistQueryKey({ page: 1, pageSize: 1000 }) });
      }
    }
  });

  const removeMut = useRemoveEducationWishlistItem({
    mutation: {
      onSuccess: () => {
        toast.success("Uklonjeno", { description: "Edukacija je uklonjena iz vaše liste želja." });
        queryClient.invalidateQueries({ queryKey: getListEducationWishlistQueryKey({ page: 1, pageSize: 1000 }) });
      }
    }
  });

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user?.user) {
      setLocation("/prijava?returnTo=" + encodeURIComponent(window.location.pathname + window.location.search));
      return;
    }
    if (isSaved) removeMut.mutate({ courseId: course.id });
    else addMut.mutate({ data: { courseId: course.id } });
  };

  return (
    <Button variant="ghost" size="icon" className="absolute top-3 right-3 z-10 bg-background/50 backdrop-blur hover:bg-background/80" onClick={toggle} disabled={addMut.isPending || removeMut.isPending}>
      <Heart className={`h-5 w-5 ${isSaved ? "fill-primary text-primary" : "text-foreground"}`} />
    </Button>
  );
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
        <CourseWishlistButton course={course} />
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
          {course.accredited && <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">Akreditovano</Badge>}
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
          {(course.instructorProfile || course.instructor) && (
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 flex items-center justify-center shrink-0 text-primary/60">🗣️</span>
              <span className="truncate">{course.instructorProfile?.fullName || course.instructor}</span>
            </div>
          )}
          {course.city && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-primary/60" />{course.city}</p>}
          <p className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1"><Clock3 className="h-4 w-4 shrink-0 text-primary/60" />{course.duration}</span>
            {course.rating > 0 && <span className="flex items-center gap-1 text-amber-600"><span className="text-border mx-1">·</span><Star className="h-3.5 w-3.5 fill-amber-500" />{course.rating.toFixed(1)} {course.reviewCount !== undefined ? `(${course.reviewCount})` : ""}</span>}
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

function CourseFilters({
  q, formatFilter, levelFilter, cityFilter, minPrice, maxPrice, accreditedFilter, certificationFilter, minRating,
  minDurationMinutes, maxDurationMinutes, courseTypeId, languageFilter, setFilter, onClear, taxonomy, taxonomyScope
}: any) {
  const courseTypes = useMemo(() => {
    if (!taxonomy) return [];
    let types: any[] = [];
    taxonomy.forEach((section: any) => {
      if (taxonomyScope?.section && section.id !== taxonomyScope.section.id) return;
      section.categories?.forEach((cat: any) => {
        if (taxonomyScope?.category && cat.id !== taxonomyScope.category.id) return;
        cat.subcategories?.forEach((sub: any) => {
          if (taxonomyScope?.subcategory && sub.id !== taxonomyScope.subcategory.id) return;
          sub.courseTypes?.forEach((ct: any) => types.push(ct));
        });
      });
    });
    const unique = types.filter((value, index, self) => index === self.findIndex((t) => t.id === value.id));
    return unique.sort((a, b) => a.name.localeCompare(b.name));
  }, [taxonomy, taxonomyScope]);

  return (
    <div className="space-y-5 filter-component">
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pretraga <EducationFieldHelp id="education-catalog-query-help" label="Pretraga kataloga" text="Unesite naziv edukacije, tehniku ili drugu ključnu reč da biste suzili prikazane rezultate." /></Label>
        <Input aria-describedby="education-catalog-query-help" placeholder="Pretraži..." value={q || ""} onChange={e => setFilter('q', e.target.value)} className="bg-background border-border/50" />
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Tip obuke <EducationFieldHelp id="education-catalog-course-type-help" label="Tip obuke" text="Izaberite konkretnu vrstu beauty obuke koju želite da vidite u rezultatima." /></Label>
        <Select value={courseTypeId || ""} onValueChange={v => setFilter("courseTypeId", v === "all" ? undefined : v)}>
          <SelectTrigger aria-describedby="education-catalog-course-type-help" className="bg-background border-border/50"><SelectValue placeholder="Svi tipovi" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Svi tipovi</SelectItem>
            {courseTypes.map(ct => <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Format <EducationFieldHelp id="education-catalog-format-help" label="Format edukacije" text="Izaberite da li tražite online edukaciju, nastavu uživo ili program koji kombinuje oba formata." /></Label>
        <Select value={formatFilter || ""} onValueChange={v => setFilter("format", v === "all" ? undefined : v)}>
          <SelectTrigger aria-describedby="education-catalog-format-help" className="bg-background border-border/50"><SelectValue placeholder="Svi formati" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Svi formati</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="in-person">Uživo</SelectItem>
            <SelectItem value="hybrid">Hibridno</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Nivo <EducationFieldHelp id="education-catalog-level-help" label="Nivo edukacije" text="Izaberite nivo koji odgovara vašem trenutnom iskustvu i predznanju." /></Label>
        <Select value={levelFilter || ""} onValueChange={v => setFilter("level", v === "all" ? undefined : v)}>
          <SelectTrigger aria-describedby="education-catalog-level-help" className="bg-background border-border/50"><SelectValue placeholder="Svi nivoi" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Svi nivoi</SelectItem>
            <SelectItem value="beginner">Početni</SelectItem>
            <SelectItem value="intermediate">Srednji</SelectItem>
            <SelectItem value="advanced">Napredni</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Jezik <EducationFieldHelp id="education-catalog-language-help" label="Jezik edukacije" text="Izaberite jezik na kojem želite da pratite predavanja i nastavne materijale." /></Label>
        <Select value={languageFilter || ""} onValueChange={v => setFilter("language", v === "all" ? undefined : v)}>
          <SelectTrigger aria-describedby="education-catalog-language-help" className="bg-background border-border/50"><SelectValue placeholder="Svi jezici" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Svi jezici</SelectItem>
            <SelectItem value="sr">Srpski</SelectItem>
            <SelectItem value="en">Engleski</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Grad <EducationFieldHelp id="education-catalog-city-help" label="Grad održavanja" text="Unesite grad u kojem želite da pohađate edukacije koje se održavaju uživo." /></Label>
        <Input aria-describedby="education-catalog-city-help" placeholder="Npr. Beograd" value={cityFilter || ""} onChange={e => setFilter("city", e.target.value)} className="bg-background border-border/50" />
      </div>
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Cena (RSD)</Label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="flex items-center gap-1 text-xs">Najniža <EducationFieldHelp id="education-catalog-min-price-help" label="Najniža cena" text="Unesite najmanju cenu edukacije u dinarima koju želite da uključite u rezultate." /></Label>
            <Input aria-describedby="education-catalog-min-price-help" placeholder="Od" type="number" value={minPrice || ""} onChange={e => setFilter('minPrice', e.target.value)} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="flex items-center gap-1 text-xs">Najviša <EducationFieldHelp id="education-catalog-max-price-help" label="Najviša cena" text="Unesite najveću cenu edukacije u dinarima koju ste spremni da razmotrite." /></Label>
            <Input aria-describedby="education-catalog-max-price-help" placeholder="Do" type="number" value={maxPrice || ""} onChange={e => setFilter('maxPrice', e.target.value)} />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Trajanje (minuti)</Label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="flex items-center gap-1 text-xs">Najkraće <EducationFieldHelp id="education-catalog-min-duration-help" label="Najkraće trajanje" text="Unesite minimalno prihvatljivo trajanje edukacije izraženo u minutima." /></Label>
            <Input aria-describedby="education-catalog-min-duration-help" placeholder="Od" type="number" value={minDurationMinutes || ""} onChange={e => setFilter('minDurationMinutes', e.target.value)} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="flex items-center gap-1 text-xs">Najduže <EducationFieldHelp id="education-catalog-max-duration-help" label="Najduže trajanje" text="Unesite maksimalno trajanje edukacije u minutima koje odgovara vašem raspoloživom vremenu." /></Label>
            <Input aria-describedby="education-catalog-max-duration-help" placeholder="Do" type="number" value={maxDurationMinutes || ""} onChange={e => setFilter('maxDurationMinutes', e.target.value)} />
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold">Minimalna ocena <EducationFieldHelp id="education-catalog-min-rating-help" label="Minimalna ocena" text="Izaberite najnižu prosečnu ocenu koju edukacija mora da ima da bi bila prikazana." /></Label>
        <Select value={minRating ? String(minRating) : ""} onValueChange={v => setFilter("minRating", v === "all" ? undefined : v)}>
          <SelectTrigger aria-describedby="education-catalog-min-rating-help" className="bg-background border-border/50"><SelectValue placeholder="Bilo koja ocena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Bilo koja ocena</SelectItem>
            <SelectItem value="4.5">Od 4.5</SelectItem>
            <SelectItem value="4.0">Od 4.0</SelectItem>
            <SelectItem value="3.0">Od 3.0</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2 pt-2">
        <div className="flex items-center gap-2">
          <Checkbox id="free-only" aria-describedby="education-catalog-free-only-help" checked={maxPrice === 0} onCheckedChange={c => setFilter('maxPrice', c ? '0' : undefined)} />
          <Label htmlFor="free-only" className="flex items-center gap-2">Samo besplatno <EducationFieldHelp id="education-catalog-free-only-help" label="Samo besplatne edukacije" text="Uključite da biste prikazali isključivo edukacije bez naknade." /></Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="accr-filter" aria-describedby="education-catalog-accredited-help" checked={!!accreditedFilter} onCheckedChange={c => setFilter('accredited', c ? 'true' : undefined)} />
          <Label htmlFor="accr-filter" className="flex items-center gap-2">Akreditovano <EducationFieldHelp id="education-catalog-accredited-help" label="Akreditovane edukacije" text="Uključite da biste videli samo programe koji su označeni kao akreditovani." /></Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="cert-filter" aria-describedby="education-catalog-certification-help" checked={!!certificationFilter} onCheckedChange={c => setFilter('certification', c ? 'true' : undefined)} />
          <Label htmlFor="cert-filter" className="flex items-center gap-2">Sertifikat uključen <EducationFieldHelp id="education-catalog-certification-help" label="Sertifikat uključen" text="Uključite da biste prikazali edukacije koje po završetku obezbeđuju sertifikat." /></Label>
        </div>
      </div>
      <Button variant="secondary" className="w-full mt-4" onClick={onClear}>Obriši filtere</Button>
    </div>
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
      <Label className="mb-2 flex items-center justify-center gap-2 text-primary-foreground">
        Brza pretraga edukacija
        <EducationFieldHelp id="education-autocomplete-search-help" label="Brza pretraga edukacija" text="Počnite da kucate naziv kursa, tehniku ili ime edukatora, pa izaberite odgovarajući predlog sa liste." />
      </Label>
      <div className="relative flex items-center">
        <Search className="absolute left-4 h-5 w-5 text-muted-foreground" />
        <Input
          aria-describedby="education-autocomplete-search-help"
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

export type TaxonomyScope = {
  section?: { id: string, name: string, slug: string };
  category?: { id: string, name: string, slug: string };
  subcategory?: { id: string, name: string, slug: string };
};

export default function EducationMarketplace({
  taxonomyScope,
  basePath = "/edukacije"
}: {
  taxonomyScope?: TaxonomyScope;
  basePath?: string;
} = {}) {

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
  const certificationFilter = searchParams.get("certification") === "true" ? true : undefined;

  const minPrice = searchParams.get("minPrice") ? Number(searchParams.get("minPrice")) : undefined;
  const maxPrice = searchParams.get("maxPrice") && searchParams.get("maxPrice") !== "" ? Number(searchParams.get("maxPrice")) : undefined;
  const minDurationMinutes = searchParams.get("minDurationMinutes") ? Number(searchParams.get("minDurationMinutes")) : undefined;
  const maxDurationMinutes = searchParams.get("maxDurationMinutes") ? Number(searchParams.get("maxDurationMinutes")) : undefined;
  const minRating = searchParams.get("minRating") ? Number(searchParams.get("minRating")) : undefined;

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchString);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1'); // setPage(1)
    setLocation(`${basePath}?${next.toString()}`);
  };

  const clearFilters = () => setLocation(basePath);
  const { data: taxonomy } = useGetPublicEducationTaxonomy({ query: { queryKey: getGetPublicEducationTaxonomyQueryKey() } });
  const { data: educationBundles } = useListEducationBundles();
  const { data: rankings } = useGetPublicEducationRankings({ query: { queryKey: getGetPublicEducationRankingsQueryKey() } });

  const placementScopeStr = taxonomyScope?.subcategory ? 'subcategory' : taxonomyScope?.category ? 'category' : taxonomyScope?.section ? null : 'home';
  const placementScopeId = taxonomyScope?.subcategory?.id || taxonomyScope?.category?.id;

  const placementParams: ListPublicEducationPlacementsParams | null = placementScopeStr ? {
    scope: placementScopeStr as any,
    ...(placementScopeId ? { scopeId: placementScopeId } : {})
  } : null;

  const effectivePlacementParams: ListPublicEducationPlacementsParams = placementParams || { scope: "home" as any };
  const { data: placements } = useListPublicEducationPlacements(
    effectivePlacementParams,
    {
      query: {
        enabled: !!placementParams,
        queryKey: getListPublicEducationPlacementsQueryKey(effectivePlacementParams)
      }
    }
  );

  const activeSectionId = taxonomyScope?.section?.id || sectionId;
  const activeCategoryId = taxonomyScope?.category?.id || categoryId;
  const activeSubcategoryId = taxonomyScope?.subcategory?.id || subcategoryId;

  const queryParams: ListPublicEducationCoursesParams & { page: number; pageSize: number } = {
    q,
    category: categoryFilter,
    sectionId: activeSectionId,
    categoryId: activeCategoryId,
    subcategoryId: activeSubcategoryId,
    courseTypeId,
    format: formatFilter as any,
    city: cityFilter,
    level: levelFilter as any,
    language: languageFilter,
    accredited: accreditedFilter,
    certification: certificationFilter,
    minRating,
    minPrice,
    maxPrice,
    minDurationMinutes: minDurationMinutes as any,
    maxDurationMinutes: maxDurationMinutes as any,
    page,
    pageSize: EDUCATION_PAGE_SIZE,
  };

  const { data: courses, isLoading: loadingCourses } = useListPublicEducationCourses(queryParams, {
    query: { queryKey: getListPublicEducationCoursesQueryKey(queryParams) }
  });

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
          {taxonomyScope ? (
            <>
              <div className="mb-6 flex items-center justify-center space-x-2 text-sm text-muted-foreground font-medium">
                <Link href="/edukacije" className="hover:text-primary transition-colors">Edukacije</Link>
                {taxonomyScope.section && (
                  <>
                    <ChevronRight className="h-4 w-4" />
                    <Link href={`/edukacije/sekcije/${taxonomyScope.section.slug}`} className="hover:text-primary transition-colors">{taxonomyScope.section.name}</Link>
                  </>
                )}
                {taxonomyScope.category && (
                  <>
                    <ChevronRight className="h-4 w-4" />
                    <Link href={`/edukacije/sekcije/${taxonomyScope.section?.slug}/${taxonomyScope.category.slug}`} className="hover:text-primary transition-colors">{taxonomyScope.category.name}</Link>
                  </>
                )}
                {taxonomyScope.subcategory && (
                  <>
                    <ChevronRight className="h-4 w-4" />
                    <span className="text-foreground">{taxonomyScope.subcategory.name}</span>
                  </>
                )}
              </div>
              <h1 className="mx-auto max-w-4xl font-serif text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl leading-[1.1]">
                {taxonomyScope.subcategory?.name || taxonomyScope.category?.name || taxonomyScope.section?.name}
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed">
                Pronađite najbolje obuke i kurseve u ovoj oblasti.
              </p>
            </>
          ) : (
            <>
              <Badge className="mb-6 h-8 px-4 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 text-sm font-medium tracking-wide">
                <Sparkles className="mr-2 h-4 w-4" /> B2B Edukacije
              </Badge>
              <h1 className="mx-auto max-w-4xl font-serif text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl leading-[1.1]">
                Evolucija vašeg <span className="text-primary italic">zanata</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground leading-relaxed">
                Zvanični registar verifikovanih kurseva, majstorskih radionica i sertifikovanih obuka za profesionalce u industriji lepote.
              </p>
            </>
          )}

          <div className="mt-10">
            <AutocompleteSearch onSelect={(id, kind) => {
              if (kind === 'course') setLocation(`/edukacije/${id}`);
              else if (kind === 'center') setLocation(`/edukacije/centri/${id}`);
              else if (kind === 'section') setFilter('sectionId', id);
              else if (kind === 'category') setFilter('categoryId', id);
              else if (kind === 'subcategory') setFilter('subcategoryId', id);
              else if (kind === 'courseType') setFilter('courseTypeId', id);
              else setFilter('q', id);
            }} />
          </div>

          {!taxonomyScope && (
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {flatCategories.slice(0, 5).map(cat => (
                <Button key={cat.id} variant="secondary" size="sm" className="rounded-full bg-secondary/50 hover:bg-secondary border border-border/50 text-xs font-medium px-4 h-9" onClick={() => setFilter('categoryId', cat.id)}>
                  {cat.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!taxonomyScope && taxonomy && taxonomy.length > 0 && (
        <div className="border-b border-border/50 bg-muted/10">
          <div className="container mx-auto px-4 py-12">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
              {taxonomy.map((section: any) => (
                <Link key={section.id} href={`/edukacije/sekcije/${section.slug}`}>
                  <Card className="h-full border border-border/50 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer bg-background group text-center">
                    <CardContent className="p-6">
                      <div className="w-12 h-12 rounded-full bg-primary/5 flex items-center justify-center text-primary mb-4 mx-auto group-hover:scale-110 transition-transform">
                        <LayoutGrid className="w-6 h-6" />
                      </div>
                      <h3 className="font-medium text-sm text-foreground mb-1 leading-tight">{section.name}</h3>
                      <p className="text-xs text-muted-foreground">{section.courseCount || 0} obuka</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {!taxonomyScope && educationBundles && educationBundles.length > 0 && (
        <section className="container mx-auto px-4 py-10" aria-label="Paketi edukacija">
          <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-sm font-medium text-primary">Uštedite uz paket</p><h2 className="font-serif text-3xl font-bold">Paketi edukacija</h2></div>
            <div className="flex items-center gap-3"><p className="text-sm text-muted-foreground">Jedna kupovina, pristup svim kursevima u paketu.</p><Link className="text-sm font-medium text-primary" href="/edukacije/moji-paketi">Moji paketi</Link></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {educationBundles.map((bundle: any) => (
              <Card key={bundle.id} className="flex flex-col border-primary/20">
                <CardHeader><CardTitle>{bundle.name}</CardTitle><CardDescription>{bundle.centerName}</CardDescription></CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{bundle.description}</p>
                  <p className="text-sm">{bundle.courses?.length ?? 0} kurs{(bundle.courses?.length ?? 0) === 1 ? "" : "a"} u paketu</p>
                  <div className="mt-auto flex items-center justify-between gap-3"><strong className="text-lg text-primary">{money(bundle.price)}</strong><Link href={`/edukacije/paketi/${bundle.id}`}><Button size="sm">Pogledaj paket</Button></Link></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

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
                <div className="py-4">
                  <CourseFilters
                    q={q} formatFilter={formatFilter} levelFilter={levelFilter} cityFilter={cityFilter}
                    minPrice={minPrice} maxPrice={maxPrice} accreditedFilter={accreditedFilter}
                    certificationFilter={certificationFilter} minRating={minRating}
                    minDurationMinutes={minDurationMinutes} maxDurationMinutes={maxDurationMinutes}
                    courseTypeId={courseTypeId} languageFilter={languageFilter}
                    setFilter={setFilter} onClear={clearFilters}
                    taxonomy={taxonomy} taxonomyScope={taxonomyScope}
                  />
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
                <CourseFilters
                    q={q} formatFilter={formatFilter} levelFilter={levelFilter} cityFilter={cityFilter}
                    minPrice={minPrice} maxPrice={maxPrice} accreditedFilter={accreditedFilter}
                    certificationFilter={certificationFilter} minRating={minRating}
                    minDurationMinutes={minDurationMinutes} maxDurationMinutes={maxDurationMinutes}
                    courseTypeId={courseTypeId} languageFilter={languageFilter}
                    setFilter={setFilter} onClear={clearFilters}
                    taxonomy={taxonomy} taxonomyScope={taxonomyScope}
                  />
              </div>
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

/** Purchase page keeps IPS explicitly pending; the server grants no access until admin settlement. */
export function EducationBundleDetail() {
  const [, params] = useRoute("/edukacije/paketi/:bundleId");
  const bundleId = params?.bundleId ?? "";
  const { data: current } = useGetCurrentUser();
  const { toast } = useToast();
  const [bundle, setBundle] = useState<any>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; salonId: string; name: string }>>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [pending, setPending] = useState(false);
  const [purchase, setPurchase] = useState<any>(null);
  useEffect(() => { void fetch(`/api/education/bundles/${bundleId}`).then(r => r.ok ? r.json() : Promise.reject()).then(setBundle).catch(() => setBundle(false)); }, [bundleId]);
  useEffect(() => { if (current?.user?.role === "SALON_OWNER") void fetch("/api/education/bundle-purchases/eligible-employees", { credentials: "include" }).then(r => r.json()).then(setEmployees); }, [current?.user?.role]);
  const submit = async () => {
    const employee = employees.find(item => item.id === employeeId);
    if (current?.user?.role === "SALON_OWNER" && !employee) { toast.error("Izaberite zaposlenog"); return; }
    setPending(true);
    try {
      const body = employee ? { targetType: "salon_employee", salonId: employee.salonId, employeeId: employee.id } : { targetType: "individual" };
      const response = await fetch(`/api/education/bundles/${bundleId}/purchases`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setPurchase(result); toast.success("Zahtev za paket je evidentiran");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Kupovina nije uspela"); } finally { setPending(false); }
  };
  if (bundle === false) return <Layout><main className="container mx-auto px-4 py-16">Paket nije pronađen.</main></Layout>;
  if (!bundle) return <Layout><main className="container mx-auto px-4 py-16"><Loader2 className="animate-spin" /></main></Layout>;
  return (
    <Layout>
      <main className="container mx-auto max-w-3xl px-4 py-10">
        <Link href="/edukacije" className="text-sm text-primary">← Sve edukacije</Link>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-3xl">{bundle.name}</CardTitle>
            <CardDescription>{bundle.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <strong>{money(bundle.price)}</strong>
              <p className="text-sm text-muted-foreground">Jedna roditeljska kupovina pokriva sve navedene kurseve.</p>
            </div>
            <ul className="space-y-2">
              {bundle.courses?.map((course: any) => (
                <li key={course.courseId} className="rounded border p-3">
                  {course.title} <span className="text-sm text-muted-foreground">· {course.duration}</span>
                </li>
              ))}
            </ul>
            {current?.user?.role === "SALON_OWNER" && (
              <div>
                <Label className="flex items-center gap-2">
                  Polaznik iz salona
                  <EducationFieldHelp id="education-bundle-employee-help" label="Polaznik iz salona" text="Izaberite zaposlenog kome će nakon potvrđene uplate biti dodeljen pristup svim kursevima iz paketa." />
                </Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger aria-describedby="education-bundle-employee-help">
                    <SelectValue placeholder="Izaberite zaposlenog" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map(employee => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={submit} disabled={pending}>{pending ? "Slanje…" : "Kupi paket"}</Button>
            {purchase && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
                <strong>Čeka potvrdu uplate.</strong> IPS instrukcije su pripremljene, ali pristup kursevima će biti aktiviran tek nakon pouzdane administrativne potvrde.
                {purchase.paymentInstructions?.payload && <code className="mt-2 block break-all text-xs">{purchase.paymentInstructions.payload}</code>}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </Layout>
  );
}

export function EducationBundlePurchasesPage() {
  const [purchases, setPurchases] = useState<any[] | null>(null);
  useEffect(() => { void fetch("/api/education/bundle-purchases", { credentials: "include" }).then(r => r.ok ? r.json() : Promise.reject()).then(setPurchases).catch(() => setPurchases([])); }, []);
  return <Layout><main className="container mx-auto max-w-4xl px-4 py-10"><h1 className="font-serif text-3xl font-bold">Moji paketi edukacija</h1><p className="mt-2 text-muted-foreground">Pregled kupovina za vas ili vaše zaposlene.</p><div className="mt-6 grid gap-3">{purchases === null ? <Loader2 className="animate-spin" /> : purchases.length === 0 ? <Card><CardContent className="p-6 text-muted-foreground">Još nemate kupljenih paketa.</CardContent></Card> : purchases.map(purchase => <Card key={purchase.id}><CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{money(purchase.amount)} · {purchase.targetType === "salon_employee" ? "Zaposleni salona" : "Lični paket"}</p><p className="text-sm text-muted-foreground">{purchase.status === "pending_payment" ? "Čeka potvrdu uplate — pristup još nije aktivan." : "Pristup kursevima je aktivan."}</p></div><div className="flex flex-col gap-2 sm:items-end"><Badge variant={purchase.status === "settled" ? "default" : "secondary"}>{purchase.status === "settled" ? "Aktivan" : "Na čekanju"}</Badge>{purchase.status === "pending_payment" && <a href={`/api/education/payment-slips/bundle/${purchase.id}`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">Preuzmi A4 uplatnicu (PDF)</a>}</div></CardContent></Card>)}</div></main></Layout>;
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

function SafeVideoEmbed({ url }: { url: string }) {
  if (!url) return null;
  let embedUrl = url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
      const videoId = parsed.hostname.includes('youtu.be') ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
      if (videoId) embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
    } else if (parsed.hostname.includes('vimeo.com')) {
      const videoId = parsed.pathname.split('/').pop();
      if (videoId) embedUrl = `https://player.vimeo.com/video/${videoId}?dnt=1`;
    } else {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-4 bg-muted/30 rounded-xl border border-border/50 hover:bg-muted/50 transition-colors mt-8">
          <div className="bg-primary/10 p-3 rounded-full"><Sparkles className="w-5 h-5 text-primary" /></div>
          <div><p className="font-medium text-foreground">Pogledaj video prezentaciju</p><p className="text-sm text-muted-foreground">Otvori spoljni link</p></div>
        </a>
      );
    }

    return (
      <div className="aspect-video w-full rounded-2xl overflow-hidden border border-border/50 shadow-sm mt-8">
        <iframe
          src={embedUrl}
          className="w-full h-full"
          title="Video prezentacija"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  } catch (e) {
    return null;
  }
}

export function EducationPublicCourseDetail() {
  const [, params] = useRoute("/edukacije/:courseId");
  const courseId = params?.courseId ?? "";
  const { data: course, isLoading, isError } = useGetPublicEducationCourse(courseId);
  const { data: currentUser } = useGetCurrentUser();
  const { data: viewerCenters } = useGetEducationCenterStatus({
    query: {
      enabled: Boolean(currentUser?.user && ["SALON_OWNER", "EDUKATIVNI_CENTAR", "SALON_EMPLOYEE"].includes(currentUser.user.role)),
      retry: false,
      queryKey: ["educationViewerCenters", currentUser?.user?.id],
    },
  });
  const { buy, buying } = useEducationPurchase();
  const session = course ? courseSession(course) : null;
  const { data: relatedCourses } = useListRelatedEducationCourses(courseId, { limit: 3 }, {
    query: { enabled: !!courseId, queryKey: getListRelatedEducationCoursesQueryKey(courseId, { limit: 3 }) }
  });

  const [, setLocation] = useLocation();

  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryMsg, setInquiryMsg] = useState("");
  const inquiryMut = useCreatePublicEducationCourseInquiry();
  const { toast } = useToast();
  const [operationalBookingOpen, setOperationalBookingOpen] = useState(false);
  const operationalSession = course?.sessions?.find((item: any) => !item.cancelledAt && new Date(item.startsAt) > new Date());
  const { data: operationalAvailability, isLoading: operationalAvailabilityLoading, isError: operationalAvailabilityError, refetch: refetchOperationalAvailability } = useGetEducationCourseAvailability(courseId, {}, {
    query: { enabled: Boolean(courseId), queryKey: ["educationOperationalAvailability", courseId] },
  });
  const [operationalBookingKey, setOperationalBookingKey] = useState(() => crypto.randomUUID());
  const createOperationalBookingMut = useCreateEducationOperationalBooking({ request: { headers: { "Idempotency-Key": operationalBookingKey } } });
  const viewerPublishesCourse = Boolean(course?.center?.id && viewerCenters?.some((center) => center.id === course.center!.id));
  const showOperationalBookingCta = educationBookingCtaVisible({
    hasFutureSession: Boolean(operationalSession),
    hasNextAvailable: Boolean(operationalAvailability?.nextAvailable),
    isAdmin: currentUser?.user?.role === "ADMIN",
    isPublisher: viewerPublishesCourse,
  });
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
        {course.trailerUrl && <SafeVideoEmbed url={course.trailerUrl} />}

        <div><div className="mb-3 flex flex-wrap gap-2"><Badge>{formatLabel[course.format]}</Badge><Badge variant="secondary">{levelLabel[course.level]}</Badge>{course.certification && <Badge variant="outline"><Award className="mr-1 h-3.5 w-3.5" /> Sertifikat</Badge>}</div><h1 className="font-serif text-4xl font-bold leading-tight">{course.title}</h1><p className="mt-4 text-lg leading-relaxed text-muted-foreground">{course.description}</p></div>
        <div className="grid gap-4 sm:grid-cols-3"><InfoCard icon={<Clock3 />} label="Trajanje" value={course.duration} /><InfoCard icon={<CalendarDays />} label="Početak" value={course.startDate ? new Date(course.startDate).toLocaleDateString("sr-RS") : "Po dogovoru"} /><InfoCard icon={<Users />} label="Mesta" value={session ? session.availableSeats > 0 ? `${session.availableSeats} slobodno` : "Lista čekanja" : "Bez ograničenja"} /></div>
                {course.theoryHours || course.practicalHours || course.language ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {course.theoryHours ? <InfoCard icon={<BookOpen />} label="Teorija" value={`${course.theoryHours} časova`} /> : null}
            {course.practicalHours ? <InfoCard icon={<Zap />} label="Praksa" value={`${course.practicalHours} časova`} /> : null}
            {course.language ? <InfoCard icon={<Users />} label="Jezik" value={course.language} /> : null}
          </div>
        ) : null}

        {course.instructorProfile && (
          <div className="mt-12 p-6 border border-border/50 rounded-2xl bg-muted/20">
            <h2 className="font-serif text-xl font-bold mb-6">Upoznajte instruktora</h2>
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              {course.instructorProfile.photoUrl && (
                <div className="shrink-0">
                  <OptimizedImage src={course.instructorProfile.photoUrl} alt={course.instructorProfile.fullName} width={120} height={120} className="w-24 h-24 sm:w-32 sm:h-32 object-cover rounded-full border-4 border-background shadow-md" />
                </div>
              )}
              <div className="flex-1 space-y-3">
                <h3 className="font-serif text-lg font-bold">{course.instructorProfile.fullName}</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{course.instructorProfile.biography}</p>

                <div className="flex flex-wrap gap-4 pt-3 text-sm">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Briefcase className="w-4 h-4 text-primary" />
                    <span><strong className="text-foreground">{course.instructorProfile.industryYears}</strong> god. u industriji</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Award className="w-4 h-4 text-primary" />
                    <span><strong className="text-foreground">{course.instructorProfile.experienceYears}</strong> god. edukatorskog iskustva</span>
                  </div>
                </div>

                {course.instructorProfile.specializations && course.instructorProfile.specializations.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {course.instructorProfile.specializations.map((spec: string, i: number) => (
                      <Badge key={i} variant="secondary" className="bg-primary/5 text-primary text-xs">{spec}</Badge>
                    ))}
                  </div>
                )}

                {course.instructorProfileId && (
                  <Button variant="outline" size="sm" className="mt-4 w-full sm:w-auto" asChild>
                    <Link href={`/edukacije/instruktori/${course.instructorProfileId}`}>Prikaži ceo profil</Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

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

        {course.publicModules && course.publicModules.length > 0 && (
          <section>
            <h2 className="mb-4 font-serif text-2xl font-bold">Moduli obuke</h2>
            <div className="space-y-4">
              {course.publicModules.map((module: any) => (
                <Card key={module.id}>
                  <CardContent className="p-5 flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{module.title}</h3>
                      {module.description && <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>}
                    </div>
                    <Badge variant="outline">{module.lessonCount} {module.lessonCount === 1 ? 'lekcija' : 'lekcija'}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {course.dayProgram.length ? <section><h2 className="mb-4 font-serif text-2xl font-bold">Dnevni program</h2><div className="space-y-3">{course.dayProgram.map((day) => <Card key={day.id}><CardContent className="flex gap-4 p-4"><Badge className="h-7 shrink-0">Dan {day.dayNumber}</Badge><div><h3 className="font-semibold">{day.title}</h3><p className="mt-1 text-sm text-muted-foreground">{day.description}</p>{day.durationMinutes ? <p className="mt-2 text-xs text-muted-foreground">{day.durationMinutes} min</p> : null}</div></CardContent></Card>)}</div></section> : null}
        {course.learningOutcomes.length ? <section><h2 className="mb-3 font-serif text-2xl font-bold">Šta ćete naučiti</h2><div className="grid gap-2 sm:grid-cols-2">{course.learningOutcomes.map((outcome) => <div key={outcome} className="flex gap-2 rounded-lg bg-muted/50 p-3 text-sm"><BadgeCheck className="h-4 w-4 shrink-0 text-emerald-600" />{outcome}</div>)}</div></section> : null}
        {(course.includedItems.length || course.requirements) ? <section className="grid gap-4 sm:grid-cols-2">{course.includedItems.length ? <Card><CardHeader><CardTitle className="text-lg">Uključeno u cenu</CardTitle></CardHeader><CardContent className="space-y-2">{course.includedItems.map((item) => <p className="flex gap-2 text-sm" key={item}><BadgeCheck className="h-4 w-4 text-primary" />{item}</p>)}</CardContent></Card> : null}{course.requirements ? <Card><CardHeader><CardTitle className="text-lg">Preduslovi</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{course.requirements}</CardContent></Card> : null}</section> : null}
        {course.center ? <Card><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"><OptimizedImage src={course.center.imageUrl} alt={course.center.name} width={64} height={64} preferredSize="thumbnail" responsiveSizes="64px" className="h-16 w-16 rounded-xl object-cover" /><div className="flex-1"><p className="font-semibold">{course.center.name}</p><p className="mt-1 text-sm text-muted-foreground">{course.center.description}</p></div><Button variant="outline" asChild><Link href={`/edukacije/centri/${course.center.id}`}>Profil centra</Link></Button></CardContent></Card> : null}
        {course.reviews.length ? <section><h2 className="mb-4 font-serif text-2xl font-bold">Utisci polaznika</h2><div className="space-y-3">{course.reviews.map((review) => <Card key={review.id}><CardContent className="p-4"><p className="flex items-center gap-1 text-sm text-amber-600"><Star className="h-4 w-4 fill-amber-500" />{review.rating.toFixed(1)}</p><p className="mt-2 text-sm">{review.comment}</p></CardContent></Card>)}</div></section> : null}
      </div>
      <aside><Card className="sticky top-24 border-primary/25"><CourseWishlistButton course={course} /><CardContent className="p-6"><p className="text-2xl font-bold">{money(course.price)}</p>{course.paymentMode === "live_deposit" ? <p className="mt-1 text-sm text-muted-foreground">Plaćanje depozita od {money(course.depositAmount || 0)} za rezervaciju, ostatak uživo.</p> : course.paymentMode === "live_off_platform" ? <p className="mt-1 text-sm text-muted-foreground">Plaćanje uživo na lokaciji centra.</p> : <p className="mt-1 text-sm text-muted-foreground">Jednokratna uplata celokupnog iznosa.</p>}<Separator className="my-5" /><div className="space-y-3 text-sm"><p className="flex gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{course.publisher}</p>{course.city ? <p className="flex gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{course.city} <span className="text-muted-foreground">· detalji po uplati</span></p> : null}<p className="flex gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{course.refundPolicy}</p></div>
      {currentUser?.user?.role !== "ADMIN" && !viewerPublishesCourse && (
        <>
          {showOperationalBookingCta && (
            <Button data-testid="operational-booking-cta" className="mt-6 w-full" size="lg" disabled={buying === course.id} onClick={() => {
              if (!currentUser?.user) { setLocation("/prijava"); return; }
              setOperationalBookingOpen(true);
            }}>{currentUser?.user ? "Rezerviši edukaciju" : "Prijavite se za rezervaciju"}</Button>
          )}
          {!showOperationalBookingCta && (
            <Button data-testid="legacy-enrollment-cta" className="mt-6 w-full" size="lg" disabled={buying === course.id} onClick={() => buy(course)}>
              {buying === course.id ? "Obrada..." : "Prijavi se na edukaciju"}
            </Button>
          )}
          <Dialog open={operationalBookingOpen} onOpenChange={setOperationalBookingOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader><DialogTitle>Rezervacija edukacije</DialogTitle><DialogDescription>Izaberite raspoloživ termin i unesite učesnike.</DialogDescription></DialogHeader>
              <EducationOperationalBookingFlow course={course} availability={operationalAvailability} availabilityLoading={operationalAvailabilityLoading} availabilityError={operationalAvailabilityError} currentUser={currentUser} onCancel={() => setOperationalBookingOpen(false)} createBookingMut={createOperationalBookingMut} refetchAvail={refetchOperationalAvailability} resetIdempotencyKey={() => setOperationalBookingKey(crypto.randomUUID())} />
            </DialogContent>
          </Dialog>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" className="mt-2 w-full" size="lg">
                <Gift className="h-4 w-4 mr-2" /> Kupi kao poklon vaučer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Kupovina vaučera: {course.title}</DialogTitle>
                <DialogDescription>
                  Ispunite formu ispod da biste kupili ovu edukaciju kao poklon. Vaučer će biti dostupan nakon evidentirane uplate.
                </DialogDescription>
              </DialogHeader>
              <VoucherPurchaseForm courseId={course.id} />
            </DialogContent>
          </Dialog>

          {canSendInquiry ? (
            <>
              <Button data-testid="inquiry-course-btn" variant="outline" className="mt-2 w-full" size="lg" onClick={() => setInquiryOpen(true)}><MessageCircle className="h-4 w-4 mr-2"/>Pošalji upit</Button>
              <Dialog open={inquiryOpen} onOpenChange={setInquiryOpen}>
                <DialogContent data-testid="inquiry-dialog">
                  <DialogHeader><DialogTitle>Pošalji upit centru</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">Vaša poruka (do 2000 karaktera) <EducationFieldHelp id="education-course-inquiry-help" label="Poruka centru" text="Napišite konkretno pitanje o programu, uslovima, terminu ili organizaciji edukacije; ne unosite osetljive lične podatke." /></Label>
                      <Textarea aria-describedby="education-course-inquiry-help" value={inquiryMsg} onChange={e => setInquiryMsg(e.target.value)} placeholder="Postavite pitanje u vezi edukacije..." className="min-h-[120px]" maxLength={2000} />
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

      {relatedCourses && relatedCourses.length > 0 && (
        <div className="mt-16 border-t border-border/40 pt-12">
          <h2 className="font-serif text-2xl font-bold mb-6">Povezane edukacije</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {relatedCourses.map((c: any) => (
              <EducationCourseCard key={c.id} course={c} />
            ))}
          </div>
        </div>
      )}

  </main></Layout>;
}

function InfoCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <Card><CardContent className="flex gap-3 p-4"><span className="text-primary">{icon}</span><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium text-sm">{value}</p></div></CardContent></Card>;
}


function VoucherPurchaseForm({ courseId }: { courseId: string }) {
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [purchasedCode, setPurchasedCode] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const mut = usePurchaseEducationGiftVoucher({
    request: { headers: { "Idempotency-Key": idempotencyKey } },
  });
  const { toast } = useToast();

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handlePurchase = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      toast.error("Neispravan unos", { description: "Unesite ispravnu adresu e-pošte primaoca." });
      return;
    }
    mut.mutate({
      data: {
        courseId,
        recipientName: recipientName || undefined,
        recipientEmail: recipientEmail,
        giftMessage: giftMessage || undefined
      }
    }, {
      onSuccess: (data: any) => {
        setPurchasedCode(data.redemptionCode || "N/A");
        setPaymentReference(data.paymentReference || "N/A");
        toast.success("Vaučer je generisan", { description: "Sačuvajte kod i izvršite uplatu." });
      },
      onError: (e: any) => {
        toast.error("Greška", { description: e.message });
      }
    });
  };

  if (purchasedCode) {
    return (
      <div className="space-y-4">
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3 font-medium uppercase tracking-widest">Vaš kod vaučera</p>
          <code className="text-3xl font-bold tracking-widest text-primary bg-background px-4 py-2 rounded-lg border border-border/50 inline-block shadow-sm">
            {purchasedCode}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              void navigator.clipboard.writeText(purchasedCode);
              toast.success("Kod je kopiran");
            }}
          >
            Kopiraj kod
          </Button>
          <p className="text-xs text-destructive mt-3 font-medium">Sačuvajte ovaj kod. Biće prikazan samo sada.</p>
        </div>
        <div className="bg-muted p-5 rounded-xl text-sm space-y-3 border border-border/50">
          <p className="font-semibold text-base border-b border-border/50 pb-2">Uputstvo za plaćanje</p>
          <p>Uplatite iznos edukacije na račun platforme (ili preuzmite predračun putem e-pošte).</p>
          <p className="flex items-center gap-2">
            <span>Poziv na broj:</span>
            <strong className="text-foreground text-base bg-background px-2 py-1 rounded">{paymentReference}</strong>
          </p>
          <p className="text-xs text-muted-foreground mt-2 bg-background/50 p-2 rounded">Nakon evidentirane uplate, vaučer će postati aktivan i primalac će moći da ga iskoristi.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handlePurchase} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="recipient-email" className="flex items-center gap-2">E-pošta primaoca <span className="text-destructive">*</span> <EducationFieldHelp id="education-voucher-recipient-email-help" label="E-pošta primaoca" text="Unesite tačnu adresu e-pošte osobe kojoj je vaučer namenjen i na koju mogu stići informacije o poklonu." /></Label>
        <Input id="recipient-email" aria-describedby="education-voucher-recipient-email-help" type="email" required value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="Npr. ana@example.com" maxLength={320} aria-required="true" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="recipient-name" className="flex items-center gap-2">Ime primaoca (opciono) <EducationFieldHelp id="education-voucher-recipient-name-help" label="Ime primaoca" text="Unesite ime i prezime osobe kojoj poklanjate edukaciju, kako bi poklon bio lično označen." /></Label>
        <Input id="recipient-name" aria-describedby="education-voucher-recipient-name-help" value={recipientName} onChange={e => setRecipientName(e.target.value)} placeholder="Npr. Ana Jovanović" maxLength={160} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gift-message" className="flex items-center gap-2">Poruka za poklon (opciono) <EducationFieldHelp id="education-voucher-gift-message-help" label="Poruka za poklon" text="Dodajte kratku ličnu poruku koja će biti sačuvana uz vaučer i prikazana primaocu." /></Label>
        <Textarea id="gift-message" aria-describedby="education-voucher-gift-message-help" value={giftMessage} onChange={e => setGiftMessage(e.target.value)} placeholder="Srećan rođendan i uspešan rad!" maxLength={1000} className="min-h-[100px]" />
      </div>
      <Button type="submit" className="w-full mt-4" size="lg" disabled={mut.isPending || !recipientEmail || !isValidEmail(recipientEmail)}>
        {mut.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "Generiši vaučer"}
      </Button>
    </form>
  );
}

export function EducationPublicCenterPage() {
  const [, params] = useRoute("/edukacije/centri/:centerId");
  const centerId = params?.centerId ?? "";
  const { data: center, isLoading, isError } = useGetPublicEducationCenter(centerId);
  const { buy, buying } = useEducationPurchase();
  if (isLoading) return <Layout><div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></Layout>;
  if (isError || !center) return <Layout><div className="container mx-auto px-4 py-20 text-center"><h1 className="font-serif text-3xl font-bold">Centar nije dostupan</h1><Button className="mt-6" asChild><Link href="/edukacije">Nazad na katalog</Link></Button></div></Layout>;
  const gallery = [{ type: "image" as const, url: center.imageUrl }, ...center.gallery.map((media) => ({ type: "image" as const, url: media.url }))];
  const [page, setPage] = useState(1);
  const { data: reviewsPage } = useListPublicEducationCenterReviews(centerId, { page, pageSize: 10 }, {
    query: { queryKey: getListPublicEducationCenterReviewsQueryKey(centerId, { page, pageSize: 10 }) }
  });

  return <Layout><main className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
    <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground"><Link href="/edukacije" className="hover:text-foreground">Edukacije</Link><ChevronRight className="h-4 w-4" /><span>Centar</span></div>
    <SalonGallery media={gallery} salonName={center.name} />
    <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary"><BadgeCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Verifikovan centar</Badge>
          <Badge variant="outline">{center.courseCount} edukacija</Badge>
        </div>
        <h1 className="mt-3 font-serif text-4xl font-bold">{center.name}</h1>
        <p className="mt-3 max-w-3xl text-lg text-muted-foreground">{center.description}</p>


      </div>
      <Card>
        <CardContent className="space-y-3 p-5 text-sm">
          <p className="flex gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{center.city}</p>
          <p className="flex gap-2"><Star className="h-4 w-4 fill-amber-500 text-amber-500" />{center.rating ? `${center.rating.toFixed(1)} · ${center.reviewCount} utisaka` : "Novi centar"}</p>
          {center.websiteUrl ? <a className="block text-primary underline" href={center.websiteUrl} target="_blank" rel="noreferrer">Sajt centra</a> : null}
          {center.instagramUrl ? <a className="block text-primary underline" href={center.instagramUrl} target="_blank" rel="noreferrer">Instagram</a> : null}
        </CardContent>
      </Card>
    </section>

    <section className="mt-16">
      <h2 className="mb-8 font-serif text-3xl font-bold">Edukacije centra</h2>
      <CourseGrid courses={center.courses} onBuy={buy} buying={buying} />
    </section>

    {reviewsPage && (
      <section className="mt-16 border-t border-border/50 pt-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-serif text-3xl font-bold">Utisci polaznika</h2>
        </div>

        {reviewsPage.viewerEligibility?.canReview && reviewsPage.viewerEligibility.eligibleEnrollmentId && (
          <div className="mb-8">
            <CenterReviewForm centerId={centerId} enrollmentId={reviewsPage.viewerEligibility.eligibleEnrollmentId} />
          </div>
        )}

        {!reviewsPage.viewerEligibility?.canReview && reviewsPage.viewerEligibility?.reason && (
          <div className="mb-8 p-4 bg-muted/20 border border-border/50 rounded-xl text-center text-sm text-muted-foreground">
            {reviewsPage.viewerEligibility.reason}
          </div>
        )}

        <div className="space-y-4">
          {reviewsPage.items.length === 0 ? (
            <p className="text-muted-foreground">Centar još uvek nema recenzija.</p>
          ) : (
            reviewsPage.items.map((review: any) => (
              <Card key={review.id}>
                <CardContent className="p-5 flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0">
                    {review.reviewerName?.charAt(0) || "K"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{review.reviewerName || "Korisnik"}</span>
                      <span className="text-muted-foreground text-sm">· {new Date(review.createdAt).toLocaleDateString('sr-RS')}</span>
                    </div>
                    <div className="flex mt-1 mb-2">
                      {[1,2,3,4,5].map(star => (
                        <Star key={star} className={`w-3.5 h-3.5 ${star <= review.rating ? "fill-amber-500 text-amber-500" : "text-muted"}`} />
                      ))}
                    </div>
                    {review.comment && <p className="text-sm">{review.comment}</p>}
                    {review.courseTitle && <p className="mt-2 text-xs text-primary/70">Pohađao/la: {review.courseTitle}</p>}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {Math.ceil(reviewsPage.total / reviewsPage.pageSize) > 1 && (
          <div className="mt-8 flex justify-center gap-2">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prethodna</Button>
            <Button variant="outline" disabled={page === Math.ceil(reviewsPage.total / reviewsPage.pageSize)} onClick={() => setPage(p => p + 1)}>Sledeća</Button>
          </div>
        )}
      </section>
    )}
  </main></Layout>;
}

function CenterReviewForm({ centerId, enrollmentId }: { centerId: string, enrollmentId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const mut = useCreateEducationCenterReview();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSubmit = () => {
    if (rating === 0) {
      toast.error("Greška", { description: "Unesite ocenu." });
      return;
    }
    mut.mutate({
      data: { enrollmentId, rating, comment: comment.trim() || undefined }
    }, {
      onSuccess: () => {
        toast.success("Uspešno", { description: "Vaša recenzija je objavljena." });
        setRating(0);
        setComment("");
        queryClient.invalidateQueries({ queryKey: getListPublicEducationCenterReviewsQueryKey(centerId, { page: 1, pageSize: 10 }) });
        queryClient.invalidateQueries({ queryKey: getGetPublicEducationCenterQueryKey(centerId) });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  return (
    <Card className="bg-muted/10 border-primary/20">
      <CardHeader>
        <CardTitle className="text-lg">Ocenite edukativni centar</CardTitle>
        <CardDescription>Bili ste polaznik ovog centra. Podelite svoje iskustvo sa drugima.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="mb-2 flex items-center gap-2">Vaša ocena <EducationFieldHelp id="education-center-review-rating-help" label="Ocena centra" text="Izaberite od jedne do pet zvezdica prema ukupnom iskustvu sa edukacijom i centrom." /></Label>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(star => (
              <button key={star} type="button" aria-describedby="education-center-review-rating-help" onClick={() => setRating(star)} className="focus:outline-none transition-transform hover:scale-110">
                <Star className={`w-8 h-8 ${star <= rating ? "fill-amber-500 text-amber-500" : "text-muted"}`} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="flex items-center gap-2">Komentar (opciono) <EducationFieldHelp id="education-center-review-comment-help" label="Komentar recenzije" text="Opišite korisno i pristojno svoje iskustvo sa programom, edukatorima i organizacijom centra." /></Label>
          <Textarea aria-describedby="education-center-review-comment-help" placeholder="Kako vam se svideo kurs?" value={comment} onChange={e => setComment(e.target.value)} className="mt-1" />
        </div>
        <Button onClick={handleSubmit} disabled={mut.isPending || rating === 0}>
          {mut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Objavi recenziju"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function EducationTaxonomyPage() {
  const [match, params] = useRoute("/edukacije/sekcije/:sectionSlug/:categorySlug?/:subcategorySlug?");
  const { data: taxonomy, isLoading } = useGetPublicEducationTaxonomy({ query: { queryKey: getGetPublicEducationTaxonomyQueryKey() } });

  const sectionSlug = (params as any)?.sectionSlug;
  const categorySlug = (params as any)?.categorySlug;
  const subcategorySlug = (params as any)?.subcategorySlug;

  const scope = useMemo(() => {
    if (!taxonomy || !sectionSlug) return { ready: true, valid: false, data: null };
    const section = taxonomy.find((s: any) => s.slug === sectionSlug);
    if (!section) return { ready: true, valid: false, data: null };

    let category;
    if (categorySlug) {
      category = section.categories?.find((c: any) => c.slug === categorySlug);
      if (!category) return { ready: true, valid: false, data: null };
    }

    let subcategory;
    if (subcategorySlug) {
      if (!category) return { ready: true, valid: false, data: null };
      subcategory = category.subcategories?.find((s: any) => s.slug === subcategorySlug);
      if (!subcategory) return { ready: true, valid: false, data: null };
    }

    return {
      ready: true,
      valid: true,
      data: {
        section: section ? { id: section.id, name: section.name, slug: section.slug } : undefined,
        category: category ? { id: category.id, name: category.name, slug: category.slug } : undefined,
        subcategory: subcategory ? { id: subcategory.id, name: subcategory.name, slug: subcategory.slug } : undefined
      }
    };
  }, [taxonomy, sectionSlug, categorySlug, subcategorySlug]);

  if (isLoading || !scope.ready) {
    return <Layout><div className="flex justify-center py-20"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div></Layout>;
  }

  if (!scope.valid) {
    return (
      <Layout>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/20">
          <h1 className="text-6xl font-serif font-bold text-primary mb-4">404</h1>
          <h2 className="text-2xl font-bold mb-2">Kategorija nije pronađena</h2>
          <p className="text-muted-foreground mb-8">Tražena kategorija ne postoji.</p>
          <Button asChild>
            <Link href="/edukacije">Nazad na katalog edukacija</Link>
          </Button>
        </div>
      </Layout>
    );
  }

  return <EducationMarketplace taxonomyScope={scope.data as any} basePath={window.location.pathname} />;
}

export function EducationWishlistPage() {
  const { data: wishlistData, isLoading } = useListEducationWishlist({ page: 1, pageSize: 1000 }, { query: { queryKey: getListEducationWishlistQueryKey({ page: 1, pageSize: 1000 }) } });

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <h1 className="font-serif text-3xl font-bold mb-8">Moja lista želja</h1>
        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : !wishlistData || wishlistData.items.length === 0 ? (
          <div className="text-center py-20 bg-muted/20 rounded-2xl border border-border/50">
            <Heart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Vaša lista želja je prazna</h2>
            <p className="text-muted-foreground mb-6">Sačuvajte edukacije koje vas zanimaju klikom na ikonicu srca.</p>
            <Button asChild><Link href="/edukacije">Istraži edukacije</Link></Button>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {wishlistData.items.map((item: any) => (
              <EducationCourseCard key={item.id} course={item.course} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

export function EducationVouchersPage() {
  const { data: vouchers, isLoading } = useListEducationGiftVouchers({ page: 1, pageSize: 100 }, { query: { queryKey: getListEducationGiftVouchersQueryKey({ page: 1, pageSize: 100 }) } });
  const redeemMut = useRedeemEducationGiftVoucher();
  const [code, setCode] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleRedeem = () => {
    if (!code.trim()) return;
    redeemMut.mutate({ data: { code: code.trim() } }, {
      onSuccess: () => {
        toast.success("Vaučer uspešno iskorišćen");
        setCode("");
        queryClient.invalidateQueries({ queryKey: getListEducationGiftVouchersQueryKey({ page: 1, pageSize: 100 }) });
      },
      onError: (e: any) => toast.error("Greška pri korišćenju vaučera", { description: e.message })
    });
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <h1 className="font-serif text-3xl font-bold mb-8">Moji vaučeri</h1>

        <div className="grid md:grid-cols-[1fr_300px] gap-8">
          <div>
            {isLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : !vouchers || vouchers.items.length === 0 ? (
              <div className="text-center py-20 bg-muted/20 rounded-2xl border border-border/50">
                <Gift className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Nemate vaučera</h2>
                <p className="text-muted-foreground">Kada kupite ili dobijete vaučer, on će se pojaviti ovde.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {vouchers.items.map((voucher: any) => (
                  <Card key={voucher.id}>
                    <CardContent className="p-5">
                      <div className="flex justify-between items-start mb-4">
                        <Badge variant={voucher.status === 'redeemed' ? 'secondary' : voucher.status === 'active' ? 'default' : 'outline'}>
                          {voucher.status === 'redeemed' ? 'Iskorišćen' : voucher.status === 'active' ? 'Aktivan' : voucher.status === 'pending_payment' ? 'Na čekanju' : voucher.status}
                        </Badge>
                        <span className="text-xl font-bold">{new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(voucher.amount || 0)}</span>
                      </div>
                      <h3 className="font-semibold text-lg line-clamp-1">{voucher.courseTitle}</h3>
                      <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                        <div className="flex justify-between">
                          <span>Kod:</span>
                          <code className="bg-muted px-1.5 rounded text-foreground">****-{voucher.codeLast4}</code>
                        </div>
                        <div className="flex justify-between">
                          <span>Referenca:</span>
                          <span className="text-foreground">{voucher.paymentReference}</span>
                        </div>
                        {voucher.recipientName && <div className="border-t border-border/40 pt-2 mt-2"><p><strong>Za:</strong> {voucher.recipientName}</p></div>}
                        {voucher.recipientEmail && <p><strong>E-pošta:</strong> {voucher.recipientEmail}</p>}
                        {voucher.giftMessage && <p className="italic">"{voucher.giftMessage}"</p>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <Card className="sticky top-24">
              <CardHeader>
                <CardTitle>Iskoristi vaučer</CardTitle>
                <CardDescription>Unesite kod koji ste dobili kako biste preuzeli vaučer.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Label className="flex items-center gap-2">Kod vaučera <EducationFieldHelp id="education-voucher-redemption-code-help" label="Kod vaučera" text="Unesite ceo kod koji ste dobili od kupca poklona, uključujući sva slova, brojeve i crtice." /></Label>
                <Input aria-describedby="education-voucher-redemption-code-help" placeholder="Unesite kod vaučera" value={code} onChange={e => setCode(e.target.value)} />
                <Button className="w-full" onClick={handleRedeem} disabled={redeemMut.isPending || !code.trim()}>
                  {redeemMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Iskoristi
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
