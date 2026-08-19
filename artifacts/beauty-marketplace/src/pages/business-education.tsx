import React, { useState, useEffect, useMemo } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { z } from "zod";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";

import { 
  useGetCurrentUser, useListCourses, useGetEducationCourse, 
  useListEnrollments, useGetEducationLms, 
  useListSalonEmployees,
  useCreateEducationCourse, useUpdateEducationCourse, 
  usePublishEducationCourse, useArchiveEducationCourse, 
  useCreateEducationModule, useCreateEducationLesson, 
  useCreateEducationSession, useEnrollInEducationCourse, 
  useCompleteEducationLesson,
  getListCoursesQueryKey, getGetEducationCourseQueryKey, 
  getListEnrollmentsQueryKey, getGetEducationLmsQueryKey, getListSalonEmployeesQueryKey
} from "@workspace/api-client-react";

import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { 
  GraduationCap, Search, MapPin, Clock, Award, 
  PlayCircle, Users, CheckCircle2, ArrowLeft, 
  ArrowRight, Plus, Filter, Monitor, Video, Calendar, Star, Loader2 
} from "lucide-react";

const DEFAULT_COURSE_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400' viewBox='0 0 800 400'%3E%3Crect width='800' height='400' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif' font-size='24' fill='%239ca3af'%3EEdukacija%3C/text%3E%3C/svg%3E";

const courseSchema = z.object({
  title: z.string().min(2, "Naslov mora imati bar 2 karaktera"),
  description: z.string().optional(),
  category: z.string().min(2, "Kategorija je obavezna"),
  format: z.enum(["online", "in-person", "hybrid"]),
  city: z.string().optional(),
  price: z.coerce.number().min(0, "Cena ne može biti negativna"),
  duration: z.string().min(1, "Trajanje je obavezno"),
  certification: z.boolean().optional(),
  imageUrl: z.string().min(1, "Slika je obavezna"),
  startDate: z.string().optional()
});

export default function BusinessEducation() {
  const [matchLms, paramsLms] = useRoute("/biznis/edukacije/lms/:enrollmentId");
  const [matchCourse, paramsCourse] = useRoute("/biznis/edukacije/:courseId");
  const { data: userResponse } = useGetCurrentUser();

  if (matchLms && paramsLms) {
    return (
      <BusinessLayout>
        <LmsView enrollmentId={paramsLms.enrollmentId} />
      </BusinessLayout>
    );
  }

  if (matchCourse && paramsCourse) {
    return (
      <BusinessLayout>
        <CourseDetailView courseId={paramsCourse.courseId} />
      </BusinessLayout>
    );
  }

  if (userResponse?.user?.role === "SALON_EMPLOYEE") {
    return (
      <BusinessLayout>
        <EmployeeLearningView />
      </BusinessLayout>
    );
  }

  return (
    <BusinessLayout>
      <CatalogView />
    </BusinessLayout>
  );
}

function EmployeeLearningView() {
  const { data: enrollments, isLoading, isError } = useListEnrollments();

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="mb-8">
        <Badge variant="secondary" className="mb-3 gap-1.5"><GraduationCap className="h-3.5 w-3.5" /> Moj razvoj</Badge>
        <h1 className="font-serif text-3xl font-bold text-foreground">Moje edukacije</h1>
        <p className="mt-2 text-muted-foreground">Kursevi koje je vaš salon dodelio vašem poslovnom nalogu.</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[1, 2].map((item) => <Skeleton key={item} className="h-44 rounded-xl" />)}</div>
      ) : isError ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Edukacije trenutno nisu dostupne. Pokušajte ponovo.</CardContent></Card>
      ) : enrollments?.length ? (
        <div className="grid gap-5 md:grid-cols-2">
          {enrollments.map((enrollment: any) => (
            <Card key={enrollment.id} className="flex flex-col border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="font-serif text-xl leading-snug">{enrollment.courseTitle}</CardTitle>
                  <Badge variant={enrollment.status === "completed" ? "secondary" : "default"}>{enrollment.status === "completed" ? "Završeno" : "U toku"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">Napredak: {enrollment.progress}%</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={enrollment.progress} />
                <p className="text-sm text-muted-foreground">{enrollment.status === "completed" ? "Uspešno ste završili ovaj program." : "Nastavite od sledeće lekcije."}</p>
              </CardContent>
              <CardFooter className="mt-auto">
                <Button className="w-full" asChild>
                  <Link href={`/biznis/edukacije/lms/${enrollment.id}`}>{enrollment.status === "completed" ? "Pregledaj program" : "Nastavi učenje"} <ArrowRight className="ml-2 h-4 w-4" /></Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="py-14 text-center"><GraduationCap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" /><h2 className="font-serif text-xl font-semibold">Još nemate dodeljenih edukacija</h2><p className="mt-2 text-sm text-muted-foreground">Kada vas vlasnik salona upiše na kurs, pojaviće se ovde.</p></CardContent></Card>
      )}
    </div>
  );
}

function CatalogView() {
  const { data: userResponse } = useGetCurrentUser();
  const user = userResponse?.user;
  const canCreate = user?.role === 'SALON_OWNER' || user?.role === 'EDUCATION_CENTER_OWNER';

  const [filters, setFilters] = useState<any>({});
  const { data: courses, isLoading } = useListCourses(filters);
  const [createOpen, setCreateOpen] = useState(false);

  const handleFilterChange = (key: string, value: any) => {
    setFilters((prev: any) => {
      const updated = { ...prev, [key]: value };
      if (value === undefined || value === "") delete updated[key];
      return updated;
    });
  };

  return (
    <div className="flex flex-col min-h-screen">
      <div className="bg-secondary/30 py-12 md:py-16 border-b border-border shadow-sm">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-4">LUMERA Edukacije</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Pronađite, upišite ili organizujte profesionalne edukacije, kurseve i seminare za industriju lepote i wellness-a.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 flex-1">
        <aside className="w-full md:w-72 shrink-0 space-y-6">
          <div className="bg-card border rounded-xl p-5 shadow-sm space-y-6 sticky top-24">
            <div className="flex items-center gap-2 font-medium border-b pb-4">
              <Filter className="w-4 h-4" /> Filteri pretrage
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Kategorija</Label>
                <Input placeholder="Npr. Manikir, Masaža..." value={filters.category || ""} onChange={e => handleFilterChange("category", e.target.value)} />
              </div>
              
              <div className="space-y-2">
                <Label>Format nastave</Label>
                <Select value={filters.format || ""} onValueChange={v => handleFilterChange("format", v === "all" ? undefined : v)}>
                  <SelectTrigger><SelectValue placeholder="Svi formati" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Svi formati</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="in-person">Uživo</SelectItem>
                    <SelectItem value="hybrid">Hibridno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Grad</Label>
                <Input placeholder="Npr. Beograd" value={filters.city || ""} onChange={e => handleFilterChange("city", e.target.value)} />
              </div>
              
              <div className="space-y-2">
                <Label>Edukativni centar</Label>
                <Input placeholder="Naziv organizatora" value={filters.center || ""} onChange={e => handleFilterChange("center", e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Raspon cene (RSD)</Label>
                <div className="flex items-center gap-2">
                  <Input type="number" placeholder="Od" min="0" value={filters.minPrice || ""} onChange={e => handleFilterChange("minPrice", e.target.value ? Number(e.target.value) : undefined)} />
                  <span className="text-muted-foreground">-</span>
                  <Input type="number" placeholder="Do" min="0" value={filters.maxPrice || ""} onChange={e => handleFilterChange("maxPrice", e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Početak nakon</Label>
                <Input type="date" value={filters.startDate ?? ""} onChange={e => handleFilterChange("startDate", e.target.value || undefined)} />
              </div>

              <div className="space-y-2">
                <Label>Minimalna ocena</Label>
                <Select value={filters.minRating?.toString() || ""} onValueChange={v => handleFilterChange("minRating", v ? Number(v) : undefined)}>
                  <SelectTrigger><SelectValue placeholder="Bilo koja ocena" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Bilo koja ocena</SelectItem>
                    <SelectItem value="3">3+ Zvezdice</SelectItem>
                    <SelectItem value="4">4+ Zvezdice</SelectItem>
                    <SelectItem value="4.5">4.5+ Zvezdice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="pt-2 border-t flex items-center justify-between">
                <Label className="cursor-pointer" htmlFor="cert-switch">Zvanični sertifikat</Label>
                <Switch id="cert-switch" checked={!!filters.certification} onCheckedChange={c => handleFilterChange("certification", c || undefined)} />
              </div>

              {canCreate && (
                <div className="pt-2 border-t flex items-center justify-between">
                  <Label className="cursor-pointer text-primary" htmlFor="mine-switch">Samo moje edukacije</Label>
                  <Switch id="mine-switch" checked={!!filters.mine} onCheckedChange={c => handleFilterChange("mine", c || undefined)} />
                </div>
              )}
            </div>
          </div>
        </aside>
        
        <div className="flex-1 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-2xl font-serif font-bold text-foreground">
              {filters.mine ? 'Moje edukacije' : 'Katalog edukacija'}
            </h2>
            {canCreate && (
              <Button onClick={() => setCreateOpen(true)} className="gap-2 shadow-sm">
                <Plus className="w-4 h-4" /> Nova edukacija
              </Button>
            )}
          </div>
          
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Card key={i} className="overflow-hidden border-border/50">
                  <Skeleton className="w-full aspect-video rounded-none" />
                  <CardContent className="p-5 space-y-3">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-2/3" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : courses?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {courses.map((course: any) => (
                <Link key={course.id} href={`/biznis/edukacije/${course.id}`}>
                  <Card className="overflow-hidden hover:shadow-md transition-all h-full flex flex-col cursor-pointer border-border/60 group">
                    <div className="aspect-video relative overflow-hidden bg-muted/30">
                      {course.imageUrl ? (
                        <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <GraduationCap className="w-12 h-12 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
                        <Badge variant="secondary" className="bg-background/95 backdrop-blur-sm shadow-sm hover:bg-background/95 text-foreground">{course.category}</Badge>
                        {course.format === 'online' && <Badge variant="secondary" className="bg-background/95 backdrop-blur-sm shadow-sm hover:bg-background/95 text-foreground"><Monitor className="w-3 h-3 mr-1"/> Online</Badge>}
                        {course.format === 'in-person' && <Badge variant="secondary" className="bg-background/95 backdrop-blur-sm shadow-sm hover:bg-background/95 text-foreground"><Users className="w-3 h-3 mr-1"/> Uživo</Badge>}
                        {course.format === 'hybrid' && <Badge variant="secondary" className="bg-background/95 backdrop-blur-sm shadow-sm hover:bg-background/95 text-foreground"><Video className="w-3 h-3 mr-1"/> Hibrid</Badge>}
                      </div>
                      {course.certification && (
                        <div className="absolute top-3 right-3">
                          <Badge className="bg-primary/95 hover:bg-primary/95 text-primary-foreground shadow-sm"><Award className="w-3 h-3 mr-1"/> Sertifikat</Badge>
                        </div>
                      )}
                      {!course.published && (
                        <div className="absolute bottom-3 left-3">
                          <Badge variant="destructive" className="shadow-sm">Nije objavljeno</Badge>
                        </div>
                      )}
                    </div>
                    <CardContent className="p-5 flex-1 flex flex-col">
                      <h3 className="font-serif font-bold text-lg mb-2 text-foreground group-hover:text-primary transition-colors line-clamp-2">{course.title}</h3>
                      <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                        <span className="font-medium truncate mr-2">{course.publisher}</span>
                        <span className="flex items-center shrink-0"><Star className="w-3.5 h-3.5 text-accent mr-1 fill-accent" /> {course.rating.toFixed(1)}</span>
                      </div>
                      <div className="mt-auto space-y-2.5 text-sm text-muted-foreground">
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 mr-2.5 opacity-70" /> {course.duration}
                        </div>
                        {course.city && (
                          <div className="flex items-center line-clamp-1">
                            <MapPin className="w-4 h-4 mr-2.5 opacity-70 shrink-0" /> <span className="truncate">{course.city}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                    <CardFooter className="p-5 pt-4 flex items-center justify-between border-t border-border/40 bg-muted/5 mt-auto">
                      <span className="font-bold text-lg text-foreground">{course.price.toLocaleString('sr-RS')} RSD</span>
                      <span className="text-sm font-medium text-primary flex items-center group-hover:underline underline-offset-4">
                        Detalji <ArrowRight className="w-4 h-4 ml-1.5 transition-transform group-hover:translate-x-1" />
                      </span>
                    </CardFooter>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-24 bg-card border rounded-xl shadow-sm flex flex-col items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Search className="w-8 h-8 text-muted-foreground/60" />
              </div>
              <h3 className="text-xl font-serif font-medium text-foreground mb-2">Nema pronađenih edukacija</h3>
              <p className="text-muted-foreground max-w-md">Pokušajte da promenite filtere pretrage ili uklonite neke od kriterijuma kako biste videli više rezultata.</p>
              {Object.keys(filters).length > 0 && (
                <Button variant="outline" className="mt-6" onClick={() => setFilters({})}>Poništi sve filtere</Button>
              )}
            </div>
          )}
        </div>
      </div>

      <CreateCourseDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CourseDetailView({ courseId }: { courseId: string }) {
  const [, setLocation] = useLocation();
  const { data: userResponse } = useGetCurrentUser();
  const user = userResponse?.user;
  const canCreate = user?.role === 'SALON_OWNER' || user?.role === 'EDUCATION_CENTER_OWNER';
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: course, isLoading, isError } = useGetEducationCourse(courseId);
  const { data: myCourses } = useListCourses({ mine: true }, { query: { enabled: canCreate, queryKey: getListCoursesQueryKey({ mine: true }) } });
  
  const isMyCourse = useMemo(() => {
    return myCourses?.some((c: any) => c.id === courseId) ?? false;
  }, [myCourses, courseId]);

  const { data: enrollments } = useListEnrollments({ query: { enabled: !!course?.enrollmentStatus, queryKey: getListEnrollmentsQueryKey() } });
  const { data: employees } = useListSalonEmployees({
    query: {
      enabled: user?.role === "SALON_OWNER",
      queryKey: getListSalonEmployeesQueryKey(),
    },
  });
  const myEnrollment = enrollments?.find((e: any) => e.courseId === courseId);

  const enroll = useEnrollInEducationCourse();
  const update = useUpdateEducationCourse();
  const publish = usePublishEducationCourse();
  const archive = useArchiveEducationCourse();

  const [createModuleOpen, setCreateModuleOpen] = useState(false);
  const [createLessonOpen, setCreateLessonOpen] = useState(false);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState("");
  const [learnerId, setLearnerId] = useState("");

  useEffect(() => {
    if (course) setPriceEdit(String(course.price));
  }, [course?.id, course?.price]);

  const handleEnroll = () => {
    enroll.mutate({ courseId, data: { employeeId: learnerId || null } }, {
      onSuccess: (res: any) => {
        toast.success("Uspešno ste rezervisali mesto");
        queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
        queryClient.invalidateQueries({ queryKey: getListEnrollmentsQueryKey() });
        if (res?.id) setLocation(`/biznis/edukacije/lms/${res.id}`);
      },
      onError: () => toast.error("Greška pri rezervaciji")
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-8 w-32 mb-8" />
        <Skeleton className="h-64 w-full rounded-xl mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <div><Skeleton className="h-80 w-full" /></div>
        </div>
      </div>
    );
  }

  if (isError || !course) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-2xl font-bold mb-4">Edukacija nije pronađena</h2>
        <Button asChild><Link href="/biznis/edukacije">Nazad na katalog</Link></Button>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen pb-20">
      <div className="bg-secondary/20 border-b">
        <div className="container mx-auto px-4 py-6">
          <Link href="/biznis/edukacije" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" /> Nazad na katalog
          </Link>
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="w-full md:w-2/3">
              <div className="flex flex-wrap gap-2 mb-4">
                <Badge variant="secondary" className="bg-background shadow-sm border-border/50">{course.category}</Badge>
                {course.format === 'online' && <Badge variant="secondary" className="bg-background shadow-sm border-border/50"><Monitor className="w-3 h-3 mr-1"/> Online</Badge>}
                {course.format === 'in-person' && <Badge variant="secondary" className="bg-background shadow-sm border-border/50"><Users className="w-3 h-3 mr-1"/> Uživo</Badge>}
                {course.format === 'hybrid' && <Badge variant="secondary" className="bg-background shadow-sm border-border/50"><Video className="w-3 h-3 mr-1"/> Hibrid</Badge>}
                {course.certification && <Badge className="bg-primary text-primary-foreground shadow-sm"><Award className="w-3 h-3 mr-1"/> Sertifikat</Badge>}
                {isMyCourse && !course.published && <Badge variant="destructive">Nije objavljeno</Badge>}
                {isMyCourse && course.archived && <Badge variant="destructive">Arhivirano</Badge>}
              </div>
              <h1 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-4 leading-tight">{course.title}</h1>
              <p className="text-lg text-muted-foreground flex items-center mb-6">
                <span className="font-medium text-foreground">{course.publisher}</span>
                <span className="mx-3 text-muted-foreground/40">•</span>
                <span className="flex items-center text-foreground"><Star className="w-4 h-4 text-accent mr-1.5 fill-accent" /> {course.rating.toFixed(1)}</span>
              </p>
            </div>
            {course.imageUrl && (
              <div className="w-full md:w-1/3 aspect-video md:aspect-auto md:h-48 rounded-xl overflow-hidden shadow-sm border">
                <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-2">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6 overflow-x-auto">
                <TabsTrigger value="overview" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent px-2 md:px-6 py-3 font-medium">Pregled</TabsTrigger>
                <TabsTrigger value="curriculum" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent px-2 md:px-6 py-3 font-medium">Sadržaj i Lekcije</TabsTrigger>
                {(course.format === 'in-person' || course.format === 'hybrid') && (
                  <TabsTrigger value="sessions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent px-2 md:px-6 py-3 font-medium">Termini uživo</TabsTrigger>
                )}
              </TabsList>
              
              <TabsContent value="overview" className="space-y-8 animate-in fade-in duration-500">
                <div className="prose prose-slate dark:prose-invert max-w-none text-foreground/90 leading-relaxed">
                  {course.description ? (
                    course.description.split('\n').map((paragraph: string, idx: number) => (
                      <p key={idx} className="mb-4">{paragraph}</p>
                    ))
                  ) : (
                    <p className="text-muted-foreground italic">Nema detaljnog opisa za ovu edukaciju.</p>
                  )}
                </div>
              </TabsContent>
              
              <TabsContent value="curriculum" className="space-y-6 animate-in fade-in duration-500">
                {isMyCourse && (
                  <Button onClick={() => setCreateModuleOpen(true)} variant="outline" className="mb-2 shadow-sm">
                    <Plus className="w-4 h-4 mr-2" /> Dodaj modul
                  </Button>
                )}
                
                {course.modules?.length ? (
                  <div className="space-y-4">
                    {course.modules.map((mod: any, idx: number) => (
                      <Card key={mod.id} className="overflow-hidden border-border/60 shadow-sm">
                        <div className="bg-muted/30 p-4 sm:px-6 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <h3 className="font-bold text-lg text-foreground flex items-center">
                              <span className="text-muted-foreground mr-3 font-normal text-sm">Modul {idx + 1}</span> 
                              {mod.title}
                            </h3>
                            {mod.description && <p className="text-sm text-muted-foreground mt-1">{mod.description}</p>}
                          </div>
                          {isMyCourse && (
                            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => { setActiveModuleId(mod.id); setCreateLessonOpen(true); }}>
                              <Plus className="w-4 h-4 mr-2" /> Nova lekcija
                            </Button>
                          )}
                        </div>
                        <div className="divide-y divide-border/40">
                          {mod.lessons?.length ? (
                            mod.lessons.map((lesson: any) => (
                              <div key={lesson.id} className="p-4 sm:px-6 flex items-center justify-between hover:bg-muted/20 transition-colors group">
                                <div className="flex items-start gap-4">
                                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                                    <PlayCircle className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <h4 className="font-medium text-foreground">{lesson.title}</h4>
                                    <div className="flex items-center text-xs text-muted-foreground mt-1 space-x-3">
                                      <span className="flex items-center"><Clock className="w-3.5 h-3.5 mr-1 opacity-70" /> {lesson.durationMinutes} min</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-6 text-center text-muted-foreground text-sm italic">Ovaj modul još uvek nema lekcija.</div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16 border border-dashed rounded-xl bg-muted/10">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                      <GraduationCap className="w-6 h-6" />
                    </div>
                    <p className="text-muted-foreground font-medium mb-1">Nema dodatih modula</p>
                    <p className="text-sm text-muted-foreground/70">Ova edukacija trenutno nema definisan plan programa.</p>
                  </div>
                )}
              </TabsContent>
              
              {(course.format === 'in-person' || course.format === 'hybrid') && (
                <TabsContent value="sessions" className="space-y-6 animate-in fade-in duration-500">
                  {isMyCourse && (
                    <Button onClick={() => setCreateSessionOpen(true)} variant="outline" className="mb-2 shadow-sm">
                      <Plus className="w-4 h-4 mr-2" /> Zakaži termin
                    </Button>
                  )}
                  
                  {course.sessions?.length ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      {course.sessions.map((session: any) => (
                        <Card key={session.id} className="border-border/60 shadow-sm overflow-hidden group hover:border-primary/30 transition-colors">
                          <CardContent className="p-0">
                            <div className="bg-primary/5 p-4 border-b flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-background shadow-sm border flex flex-col items-center justify-center shrink-0 text-primary">
                                <span className="text-xs font-bold uppercase leading-none">{new Date(session.startsAt).toLocaleDateString('sr-RS', { month: 'short' })}</span>
                                <span className="text-lg font-bold leading-none">{new Date(session.startsAt).getDate()}</span>
                              </div>
                              <div>
                                <div className="font-medium text-foreground">
                                  {new Date(session.startsAt).toLocaleDateString('sr-RS', { weekday: 'long', year: 'numeric' })}
                                </div>
                                <div className="text-sm text-muted-foreground flex items-center">
                                  <Clock className="w-3.5 h-3.5 mr-1.5 opacity-70" />
                                  {new Date(session.startsAt).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })} - 
                                  {new Date(session.endsAt).toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>
                            </div>
                            <div className="p-4 space-y-3">
                              {session.location && (
                                <div className="text-sm flex items-start text-foreground/80">
                                  <MapPin className="w-4 h-4 mr-2.5 text-muted-foreground shrink-0 mt-0.5" /> 
                                  <span>{session.location}</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center pt-3 border-t text-sm mt-3">
                                <span className="text-muted-foreground flex items-center">
                                  <Users className="w-4 h-4 mr-2 opacity-70" /> Mesta:
                                </span>
                                <span className="font-medium text-foreground bg-secondary px-2 py-0.5 rounded-md">
                                  {session.availableSeats} / {session.capacity} slobodno
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16 border border-dashed rounded-xl bg-muted/10">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 text-muted-foreground">
                        <Calendar className="w-6 h-6" />
                      </div>
                      <p className="text-muted-foreground font-medium mb-1">Nema zakazanih termina</p>
                      <p className="text-sm text-muted-foreground/70">Još uvek nema definisanih datuma za ovu edukaciju.</p>
                    </div>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>
          
          <div>
            <Card className="sticky top-24 border-primary/20 shadow-md">
              <CardContent className="p-6 md:p-8">
                <div className="text-4xl font-serif font-bold text-foreground mb-1">
                  {course.price === 0 ? 'Besplatno' : `${course.price.toLocaleString('sr-RS')} RSD`}
                </div>
                <div className="text-sm text-muted-foreground mb-6 pb-6 border-b border-border/60">Plaćanje jednokratno.</div>
                
                <div className="space-y-4 mb-8">
                  <div className="flex items-center text-sm"><Clock className="w-5 h-5 mr-3 text-primary/70"/> <span className="font-medium text-foreground mr-1">Trajanje:</span> {course.duration}</div>
                  {course.certification && <div className="flex items-center text-sm"><Award className="w-5 h-5 mr-3 text-primary/70"/> <span className="font-medium text-foreground mr-1">Zvanični sertifikat</span> po završetku</div>}
                  <div className="flex items-center text-sm">
                    <Users className="w-5 h-5 mr-3 text-primary/70"/> 
                    {course.availableSeats !== null && course.availableSeats !== undefined ? (
                      <span><span className="font-medium text-foreground mr-1">{course.availableSeats}</span> slobodnih mesta</span>
                    ) : (
                      <span className="font-medium text-foreground">Neograničen broj mesta</span>
                    )}
                  </div>
                </div>
                
                {isMyCourse ? (
                  <div className="space-y-3 bg-muted/30 p-4 rounded-lg border border-border/50">
                    <h4 className="font-medium text-xs text-muted-foreground uppercase tracking-wider mb-3">Upravljanje sadržajem</h4>
                    <div className="flex gap-2">
                      <Input aria-label="Cena edukacije" type="number" min="0" value={priceEdit} onChange={(event) => setPriceEdit(event.target.value)} />
                      <Button variant="outline" size="sm" onClick={() => update.mutate({ courseId, data: { price: Number(priceEdit) } }, { onSuccess: () => { toast.success("Cena je ažurirana"); queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) }); }, onError: () => toast.error("Cena nije ažurirana") })} disabled={update.isPending || !priceEdit}>
                        Sačuvaj cenu
                      </Button>
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => setEditCourseOpen(true)}>
                      Izmeni podatke kursa
                    </Button>
                    {!course.published && (
                       <Button className="w-full" onClick={() => publish.mutate({ courseId }, { onSuccess: () => { toast.success("Edukacija objavljena"); queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) }); }})} disabled={publish.isPending}>
                         {publish.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Objavi edukaciju"}
                       </Button>
                    )}
                    {!course.archived && (
                      <Button variant="outline" className="w-full" onClick={() => archive.mutate({ courseId }, { onSuccess: () => { toast.success("Edukacija je arhivirana"); queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) }); }})} disabled={archive.isPending}>
                        {archive.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : 'Arhiviraj edukaciju'}
                      </Button>
                    )}
                  </div>
                ) : course.enrollmentStatus === 'active' || course.enrollmentStatus === 'completed' ? (
                  myEnrollment ? (
                    <Button className="w-full text-base h-12 shadow-md" size="lg" asChild>
                      <Link href={`/biznis/edukacije/lms/${myEnrollment.id}`}>Nastavi sa učenjem <ArrowRight className="w-4 h-4 ml-2" /></Link>
                    </Button>
                  ) : (
                    <Button className="w-full text-base h-12" size="lg" disabled>Učitavanje...</Button>
                  )
                ) : (
                  <div className="space-y-3">
                    {user?.role === "SALON_OWNER" && employees?.length ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="education-learner">Polaznik</Label>
                        <Select value={learnerId || "self"} onValueChange={(value) => setLearnerId(value === "self" ? "" : value)}>
                          <SelectTrigger id="education-learner"><SelectValue placeholder="Izaberite polaznika" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="self">Ja lično</SelectItem>
                            {employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Izabrani zaposleni koristi svoj poslovni nalog za LMS; vlasnik u ovom prostoru prati prijavu i napredak tima.</p>
                      </div>
                    ) : null}
                    <Button className="w-full text-base h-12 shadow-md hover:shadow-lg transition-shadow" size="lg" onClick={handleEnroll} disabled={enroll.isPending}>
                      {enroll.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rezervacija...</> : 'Rezerviši mesto'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <CreateModuleDialog courseId={courseId} open={createModuleOpen} onOpenChange={setCreateModuleOpen} />
      {activeModuleId && <CreateLessonDialog courseId={courseId} moduleId={activeModuleId} open={createLessonOpen} onOpenChange={setCreateLessonOpen} />}
      <CreateSessionDialog courseId={courseId} open={createSessionOpen} onOpenChange={setCreateSessionOpen} />
      <CreateCourseDialog open={editCourseOpen} onOpenChange={setEditCourseOpen} course={course} />
    </div>
  );
}

function LmsView({ enrollmentId }: { enrollmentId: string }) {
  const { data: lms, isLoading } = useGetEducationLms(enrollmentId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const complete = useCompleteEducationLesson();
  
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  
  useEffect(() => {
    if (lms && !activeLessonId) {
      if (lms.enrollment.nextLesson) {
        setActiveLessonId(lms.enrollment.nextLesson);
      } else if (lms.course.modules.length > 0 && lms.course.modules[0].lessons.length > 0) {
        setActiveLessonId(lms.course.modules[0].lessons[0].id);
      }
    }
  }, [lms, activeLessonId]);
  
  if (isLoading) return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!lms) return <div className="flex h-[80vh] items-center justify-center flex-col text-center">
    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4 text-muted-foreground"><Monitor className="w-8 h-8" /></div>
    <h2 className="text-2xl font-bold mb-2">Sistem za učenje nije dostupan</h2>
    <p className="text-muted-foreground mb-6">Vaša rezervacija možda nije potvrđena ili edukacija ne sadrži online lekcije.</p>
    <Button asChild><Link href="/biznis/edukacije">Nazad na katalog</Link></Button>
  </div>;
  
  const activeLesson = useMemo(() => {
    for (const mod of lms.course.modules) {
      const lesson = mod.lessons.find((l: any) => l.id === activeLessonId);
      if (lesson) return lesson;
    }
    return null;
  }, [lms, activeLessonId]);
  
  const handleComplete = () => {
    if (!activeLessonId) return;
    complete.mutate({ enrollmentId, lessonId: activeLessonId }, {
      onSuccess: () => {
        toast.success("Lekcija uspešno završena!");
        setActiveLessonId(null);
        queryClient.invalidateQueries({ queryKey: getGetEducationLmsQueryKey(enrollmentId) });
      },
      onError: () => toast.error("Lekcija nije označena kao završena")
    });
  };
  
  return (
    <div className="flex flex-col md:flex-row min-h-[100dvh]">
      <div className="w-full md:w-80 shrink-0 border-r border-border bg-sidebar flex flex-col md:h-[100dvh] md:sticky md:top-0">
        <div className="p-5 border-b bg-sidebar shadow-sm z-10 relative">
          <Link href={`/biznis/edukacije/${lms.course.id}`} className="text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground flex items-center mb-5 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" /> Izlaz
          </Link>
          <h2 className="font-serif font-bold text-lg leading-tight mb-4 text-sidebar-foreground line-clamp-2" title={lms.course.title}>{lms.course.title}</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-sidebar-foreground/80 font-medium">
              <span>Vaš napredak</span>
              <span>{lms.enrollment.progress}%</span>
            </div>
            <Progress value={lms.enrollment.progress} className="h-2 bg-sidebar-accent [&>div]:bg-primary" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {lms.course.modules.map((mod: any) => (
            <div key={mod.id} className="space-y-3">
              <h3 className="font-medium text-sm text-sidebar-foreground/60 uppercase tracking-wider pl-2">{mod.title}</h3>
              <div className="space-y-1">
                {mod.lessons.map((lesson: any) => (
                  <button 
                    key={lesson.id}
                    onClick={() => setActiveLessonId(lesson.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all flex items-start gap-3
                      ${activeLessonId === lesson.id 
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm' 
                        : 'hover:bg-sidebar-accent text-sidebar-foreground/90'}
                    `}
                  >
                    <div className="mt-0.5 shrink-0">
                      {lesson.completed ? (
                        <CheckCircle2 className={`w-4 h-4 ${activeLessonId === lesson.id ? 'text-sidebar-primary-foreground' : 'text-primary'}`} />
                      ) : (
                        <div className={`w-4 h-4 rounded-full border ${activeLessonId === lesson.id ? 'border-sidebar-primary-foreground/50 bg-sidebar-primary-foreground/10' : 'border-sidebar-foreground/30'}`} />
                      )}
                    </div>
                    <span className="line-clamp-2 flex-1 leading-snug">{lesson.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="flex-1 bg-background flex flex-col md:h-[100dvh]">
        {activeLesson ? (
          <>
            <div className="border-b border-border/60 p-6 md:p-8 md:px-10 bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-0 z-10 shadow-sm">
              <div className="flex-1">
                <h1 className="text-2xl md:text-3xl font-serif font-bold text-foreground mb-2 leading-tight">{activeLesson.title}</h1>
                <p className="text-muted-foreground text-sm flex items-center font-medium"><Clock className="w-4 h-4 mr-1.5"/> Trajanje: {activeLesson.durationMinutes} minuta</p>
              </div>
              <div className="shrink-0 flex items-center">
                {!activeLesson.completed && (
                  <Button onClick={handleComplete} disabled={complete.isPending} className="w-full sm:w-auto shadow-sm">
                    {complete.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                    Označi kao završeno
                  </Button>
                )}
                {activeLesson.completed && (
                  <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-sm py-2 px-4 whitespace-nowrap">
                    <CheckCircle2 className="w-4 h-4 mr-2" /> Uspešno završeno
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 md:p-10">
            <div className="prose prose-slate dark:prose-invert max-w-4xl mx-auto whitespace-pre-wrap prose-headings:font-serif prose-headings:font-bold prose-a:text-primary hover:prose-a:text-primary/80">
              {activeLesson.content || "Nema dostupnog sadržaja za ovu lekciju."}
            </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-20">
            <PlayCircle className="w-16 h-16 text-muted-foreground/30 mb-4" />
            <p className="text-lg">Izaberite lekciju iz menija sa leve strane</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateCourseDialog({ open, onOpenChange, course }: { open: boolean; onOpenChange: (o: boolean) => void; course?: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const create = useCreateEducationCourse();
  const update = useUpdateEducationCourse();
  
  const { register, handleSubmit, control, formState: { errors }, reset } = useForm<any>({
    resolver: zodResolver(courseSchema) as any,
    defaultValues: { format: 'online', certification: false, price: 0, imageUrl: DEFAULT_COURSE_IMAGE }
  });
  
  useEffect(() => {
    if (!open) return;
    if (!course) {
      reset({ format: 'online', certification: false, price: 0, imageUrl: DEFAULT_COURSE_IMAGE });
      return;
    }
    reset({
      title: course.title,
      description: course.description ?? "",
      category: course.category,
      format: course.format,
      city: course.city ?? "",
      price: course.price,
      duration: course.duration,
      certification: course.certification,
      imageUrl: course.imageUrl,
      startDate: course.startDate ? new Date(course.startDate).toISOString().slice(0, 10) : "",
    });
  }, [open, reset, course]);

  const onSubmit = (data: any) => {
    const mutation = course
      ? update.mutate({ courseId: course.id, data }, {
          onSuccess: () => {
            toast.success("Edukacija je ažurirana");
            queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(course.id) });
            queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
            onOpenChange(false);
          },
          onError: () => toast.error("Greška pri ažuriranju edukacije"),
        })
      : create.mutate({ data }, {
      onSuccess: (newCourse: any) => {
        toast.success("Edukacija uspešno kreirana");
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        onOpenChange(false);
        if (newCourse?.id) setLocation(`/biznis/edukacije/${newCourse.id}`);
      },
      onError: () => toast.error("Greška pri kreiranju edukacije")
    });
    return mutation;
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-xl font-serif">{course ? "Izmeni edukaciju" : "Nova edukacija"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <Label>Naziv edukacije *</Label>
              <Input placeholder="Npr. Masterclass Manikir..." {...register("title")} />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message as string}</p>}
            </div>
            
            <div className="space-y-2 md:col-span-2">
              <Label>Opis</Label>
              <Textarea placeholder="Kratak opis onoga što će polaznici naučiti..." rows={3} {...register("description")} />
            </div>

            <div className="space-y-2">
              <Label>Kategorija *</Label>
              <Input placeholder="Npr. Manikir, Kozmetika" {...register("category")} />
              {errors.category && <p className="text-sm text-destructive">{errors.category.message as string}</p>}
            </div>

            <div className="space-y-2">
              <Label>Format nastave *</Label>
              <Controller
                name="format"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Izaberite format" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="online">Online</SelectItem>
                      <SelectItem value="in-person">Uživo</SelectItem>
                      <SelectItem value="hybrid">Hibridno (Online + Uživo)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>Trajanje *</Label>
              <Input placeholder="Npr. 3 nedelje, 40 časova" {...register("duration")} />
              {errors.duration && <p className="text-sm text-destructive">{errors.duration.message as string}</p>}
            </div>

            <div className="space-y-2">
              <Label>Cena (RSD) *</Label>
              <Input type="number" min="0" placeholder="0 za besplatno" {...register("price")} />
            </div>

            <div className="space-y-2">
              <Label>Grad (za uživo/hibridno)</Label>
              <Input placeholder="Npr. Novi Sad" {...register("city")} />
            </div>

            <div className="space-y-2">
              <Label>Datum početka (opciono)</Label>
              <Input type="date" {...register("startDate")} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>URL naslovne slike *</Label>
              <Input placeholder="https://..." {...register("imageUrl")} />
            </div>
          </div>
          
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
            <div>
              <Label className="text-base">Zvanični sertifikat</Label>
              <p className="text-sm text-muted-foreground">Polaznici dobijaju potvrdu o završenoj edukaciji</p>
            </div>
            <Controller
              name="certification"
              control={control}
              render={({ field }) => (
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Odustani</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : course ? "Sačuvaj izmene" : "Kreiraj i dodaj module"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateModuleDialog({ courseId, open, onOpenChange }: { courseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateEducationModule();
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<any>({
    resolver: zodResolver(z.object({
      title: z.string().min(1, "Naslov je obavezan"),
      description: z.string().optional(),
      sortOrder: z.coerce.number().optional()
    })) as any
  });
  
  useEffect(() => { if (open) reset(); }, [open, reset]);

  const onSubmit = (data: any) => {
    create.mutate({ courseId, data }, {
      onSuccess: () => {
        toast.success("Modul uspešno dodat");
        queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
        onOpenChange(false);
      }
    });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-serif text-xl">Novi modul</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Naziv modula *</Label>
            <Input placeholder="Npr. Uvod u teoriju..." {...register("title")} />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message as string}</p>}
          </div>
          <div className="space-y-2">
            <Label>Opis (opciono)</Label>
            <Textarea placeholder="Kratak opis sadržaja modula..." rows={3} {...register("description")} />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Odustani</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Dodavanje..." : "Dodaj modul"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateLessonDialog({ moduleId, courseId, open, onOpenChange }: { moduleId: string; courseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateEducationLesson();
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<any>({
    resolver: zodResolver(z.object({
      title: z.string().min(1, "Naslov je obavezan"),
      description: z.string().optional(),
      content: z.string().optional(),
      durationMinutes: z.coerce.number().min(1, "Trajanje mora biti > 0")
    })) as any,
    defaultValues: { durationMinutes: 10 }
  });
  
  useEffect(() => { if (open) reset(); }, [open, reset]);

  const onSubmit = (data: any) => {
    create.mutate({ moduleId, data }, {
      onSuccess: () => {
        toast.success("Lekcija uspešno dodata");
        queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
        onOpenChange(false);
      }
    });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="font-serif text-xl">Nova lekcija</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-2 sm:col-span-3">
              <Label>Naslov lekcije *</Label>
              <Input placeholder="Npr. Priprema radnog mesta" {...register("title")} />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message as string}</p>}
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label>Trajanje (min) *</Label>
              <Input type="number" min="1" {...register("durationMinutes")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Sadržaj (Tekst ili HTML)</Label>
            <Textarea className="font-mono text-sm" rows={8} placeholder="<p>Dobrodošli u prvu lekciju...</p>" {...register("content")} />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Odustani</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Dodavanje..." : "Dodaj lekciju"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateSessionDialog({ courseId, open, onOpenChange }: { courseId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateEducationSession();
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<any>({
    resolver: zodResolver(z.object({
      startsAt: z.string().min(1, "Početak je obavezan"),
      endsAt: z.string().min(1, "Kraj je obavezan"),
      location: z.string().optional(),
      capacity: z.coerce.number().min(1, "Kapacitet mora biti > 0")
    })) as any,
    defaultValues: { capacity: 10 }
  });
  
  useEffect(() => { if (open) reset(); }, [open, reset]);

  const onSubmit = (data: any) => {
    create.mutate({ courseId, data: { ...data, startsAt: new Date(data.startsAt).toISOString(), endsAt: new Date(data.endsAt).toISOString() } }, {
      onSuccess: () => {
        toast.success("Termin uspešno dodat");
        queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
        onOpenChange(false);
      },
      onError: () => toast.error("Greška pri dodavanju termina")
    });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle className="font-serif text-xl">Novi termin (Uživo / Hibridno)</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Početak *</Label>
              <Input type="datetime-local" {...register("startsAt")} />
              {errors.startsAt && <p className="text-sm text-destructive">{errors.startsAt.message as string}</p>}
            </div>
            <div className="space-y-2">
              <Label>Kraj *</Label>
              <Input type="datetime-local" {...register("endsAt")} />
              {errors.endsAt && <p className="text-sm text-destructive">{errors.endsAt.message as string}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tačna lokacija (adresa ili link)</Label>
            <Input placeholder="Npr. Resavska 10, Novi Sad" {...register("location")} />
          </div>
          <div className="space-y-2">
            <Label>Kapacitet polaznika *</Label>
            <Input type="number" min="1" {...register("capacity")} />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Odustani</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? "Zazakivanje..." : "Zakaži termin"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
