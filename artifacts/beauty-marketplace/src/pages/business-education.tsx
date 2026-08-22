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
  useListEducationInstructors, useCreateEducationInstructor, useUpdateEducationInstructor, useDeleteEducationInstructor,
  useGetEducationCourseFeaturedStatus, useUpdateEducationCourseFeatured, useLinkEducationCourseInstructor,
  useReplaceEducationCourseDays,
  useRequestEducationCourseGalleryUpload, useAddEducationCourseGalleryMedia,
  useReorderEducationCourseGallery, useDeleteEducationCourseGalleryMedia,
  useGetPublicInstructorProfile,
  useListEducationNotifications, useAcceptEducationWaitlistOffer, useMarkEducationNotificationRead,
  getListCoursesQueryKey, getGetEducationCourseQueryKey, 
  getListEnrollmentsQueryKey, getGetEducationLmsQueryKey, getListSalonEmployeesQueryKey,
  getListEducationInstructorsQueryKey, getGetEducationCourseFeaturedStatusQueryKey,
  getListEducationNotificationsQueryKey,
} from "@workspace/api-client-react";

import { BusinessLayout } from "@/components/business-layout";
import { Layout } from "@/components/layout";
import { SalonGallery } from "@/components/salon-gallery";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  GraduationCap, Search, MapPin, Clock, Award, 
  PlayCircle, Users, CheckCircle2, ArrowLeft, 
  ArrowRight, Plus, Filter, Monitor, Video, Calendar, Star, Loader2,
  Download, CalendarPlus, Info, ShieldCheck, UserCircle2, Zap, Trash2, Pencil, Link2, Bell, ImagePlus, ArrowUp, ArrowDown
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
  level: z.enum(["beginner", "intermediate", "advanced", "all-levels"]).optional(),
  learningOutcomesText: z.string().optional(),
  includedItemsText: z.string().optional(),
  requirements: z.string().max(2000).optional(),
  certification: z.boolean().optional(),
  imageUrl: z.string().min(1, "Slika je obavezna"),
  startDate: z.string().optional(),
  refundPolicy: z.string().min(1, "Politika povraćaja je obavezna").max(2000),
  groupDiscountMinimum: z.coerce.number().int().min(2).max(999).optional().nullable(),
  groupDiscountPercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
}).refine(
  (data) => (data.groupDiscountMinimum == null) === (data.groupDiscountPercent == null),
  { message: "Unesite i minimalan broj polaznika i procenat popusta za grupni popust.", path: ["groupDiscountPercent"] },
);

export default function BusinessEducation() {
  const [matchLms, paramsLms] = useRoute("/biznis/edukacije/lms/:enrollmentId");
  const [matchCustomerLms, customerLmsParams] = useRoute("/moj-nalog/edukacije/lms/:enrollmentId");
  const [matchStudentLms, studentLmsParams] = useRoute("/student/edukacije/lms/:enrollmentId");
  const [matchCourse, paramsCourse] = useRoute("/biznis/edukacije/:courseId");
  const { data: userResponse } = useGetCurrentUser();

  if (matchStudentLms && studentLmsParams) {
    return <Layout hideCustomerNavigation><LmsView enrollmentId={studentLmsParams.enrollmentId} /></Layout>;
  }
  if ((matchLms && paramsLms) || (matchCustomerLms && customerLmsParams)) {
    return (
      <BusinessLayout>
        <LmsView enrollmentId={(paramsLms ?? customerLmsParams)!.enrollmentId} />
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
  if (userResponse?.user?.role === "STUDENT") {
    return <Layout hideCustomerNavigation><StudentLearningView /></Layout>;
  }

  return (
    <BusinessLayout>
      <CatalogView />
    </BusinessLayout>
  );
}

function OfferCountdown({ expiresAt }: { expiresAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!expiresAt) return null;
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (remainingMs <= 0) return <span className="text-destructive">Ponuda ističe</span>;
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  return <span>{hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`} do isteka ponude</span>;
}

function StudentEducationInbox() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: inbox, isLoading } = useListEducationNotifications();
  const acceptOffer = useAcceptEducationWaitlistOffer();
  const markRead = useMarkEducationNotificationRead();

  const offers = inbox?.offers ?? [];
  const notifications = inbox?.notifications ?? [];
  const unread = notifications.filter((item) => !item.readAt);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListEducationNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListEnrollmentsQueryKey() });
  };

  const handleAccept = (waitlistId: string) => {
    acceptOffer.mutate({ waitlistId }, {
      onSuccess: () => { toast.success("Prihvatili ste ponudu", { description: "Mesto je rezervisano. Pristup se aktivira nakon potvrde uplate." }); refresh(); },
      onError: (error: any) => toast.error("Prihvatanje ponude nije uspelo", { description: error?.message }),
    });
  };

  if (isLoading) return <Skeleton className="mt-8 h-32 rounded-xl" />;
  if (offers.length === 0 && notifications.length === 0) return null;

  return (
    <div className="mt-8 space-y-4">
      {offers.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg"><Zap className="h-5 w-5 text-amber-500" /> Ponude sa liste čekanja</CardTitle>
            <p className="text-sm text-muted-foreground">Mesto je rezervisano za vas. Prihvatite ponudu pre isteka roka od 24 sata.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {offers.map((offer) => (
              <div key={offer.id} className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{offer.courseTitle}</p>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> <OfferCountdown expiresAt={offer.expiresAt} />
                  </p>
                </div>
                <Button
                  disabled={acceptOffer.isPending}
                  onClick={() => handleAccept(offer.id)}
                >
                  {acceptOffer.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Prihvati mesto
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {notifications.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="h-5 w-5" /> Obaveštenja
              {unread.length > 0 && <Badge variant="secondary">{unread.length} novo</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {notifications.slice(0, 10).map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border p-3 ${item.readAt ? "bg-background" : "bg-muted/40 border-primary/30"}`}
                onClick={() => {
                  if (item.readAt) return;
                  markRead.mutate({ notificationId: item.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEducationNotificationsQueryKey() }) });
                }}
                role="button"
                tabIndex={0}
              >
                <p className="text-sm font-medium">{item.title}</p>
                <p className="text-sm text-muted-foreground">{item.body}</p>
                <p className="mt-1 text-xs text-muted-foreground/70">{new Date(item.createdAt).toLocaleString("sr-RS")}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StudentLearningView() {
  const { data: enrollments, isLoading, isError } = useListEnrollments();
  return <div className="container mx-auto max-w-5xl px-4 py-10">
    <Badge variant="secondary" className="mb-3 gap-1.5"><GraduationCap className="h-3.5 w-3.5" /> STUDENT</Badge>
    <h1 className="font-serif text-3xl font-bold">Moje edukacije</h1>
    <p className="mt-2 text-muted-foreground">Vaši kupljeni programi, napredak i sertifikati.</p>
    <StudentEducationInbox />
    {isLoading ? <div className="mt-8 grid gap-4 md:grid-cols-2">{[1, 2].map((item) => <Skeleton key={item} className="h-44 rounded-xl" />)}</div>
      : isError ? <Card className="mt-8"><CardContent className="py-10 text-center">Edukacije trenutno nisu dostupne.</CardContent></Card>
        : enrollments?.length ? <div className="mt-8 grid gap-5 md:grid-cols-2">{enrollments.map((enrollment: any) => <Card key={enrollment.id}><CardHeader><CardTitle>{enrollment.courseTitle}</CardTitle><p className="text-sm text-muted-foreground">Napredak: {enrollment.progress}%</p></CardHeader><CardContent><Progress value={enrollment.progress} /></CardContent><CardFooter><Button className="w-full" asChild><Link href={`/student/edukacije/lms/${enrollment.id}`}>{enrollment.status === "completed" ? "Pregledaj program" : "Nastavi učenje"} <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardFooter></Card>)}</div>
          : <Card className="mt-8"><CardContent className="py-14 text-center"><GraduationCap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" /><h2 className="font-serif text-xl font-semibold">Još nemate edukacija</h2><p className="mt-2 text-sm text-muted-foreground">Kada administrator potvrdi vašu kupovinu, kurs će se pojaviti ovde.</p></CardContent></Card>}
  </div>;
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
  const isEducationCenter = user?.role === 'EDUCATION_CENTER_OWNER';

  const [filters, setFilters] = useState<any>({});
  const { data: courses, isLoading } = useListCourses(filters);
  const [createOpen, setCreateOpen] = useState(false);
  const [instructorsOpen, setInstructorsOpen] = useState(false);

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
            <div className="flex gap-2">
              {isEducationCenter && (
                <Button variant="outline" onClick={() => setInstructorsOpen(true)} className="gap-2">
                  <UserCircle2 className="w-4 h-4" /> Instruktori
                </Button>
              )}
              {canCreate && (
                <Button onClick={() => setCreateOpen(true)} className="gap-2 shadow-sm">
                  <Plus className="w-4 h-4" /> Nova edukacija
                </Button>
              )}
            </div>
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
      {isEducationCenter && <InstructorsDialog open={instructorsOpen} onOpenChange={setInstructorsOpen} />}
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

  const isEducationCenter = user?.role === "EDUCATION_CENTER_OWNER";

  const { data: enrollments } = useListEnrollments({ query: { enabled: !!course?.enrollmentStatus, queryKey: getListEnrollmentsQueryKey() } });
  const { data: employees } = useListSalonEmployees({
    query: {
      enabled: user?.role === "SALON_OWNER",
      queryKey: getListSalonEmployeesQueryKey(),
    },
  });
  const { data: instructors } = useListEducationInstructors({
    query: { enabled: isMyCourse && isEducationCenter, queryKey: getListEducationInstructorsQueryKey() },
  });
  const { data: featuredStatus, refetch: refetchFeatured } = useGetEducationCourseFeaturedStatus(courseId, {
    query: { enabled: isMyCourse, queryKey: getGetEducationCourseFeaturedStatusQueryKey(courseId) },
  });
  const myEnrollment = enrollments?.find((e: any) => e.courseId === courseId);

  const enroll = useEnrollInEducationCourse();
  const update = useUpdateEducationCourse();
  const publish = usePublishEducationCourse();
  const archive = useArchiveEducationCourse();
  const updateFeatured = useUpdateEducationCourseFeatured();
  const linkInstructor = useLinkEducationCourseInstructor();

  const [createModuleOpen, setCreateModuleOpen] = useState(false);
  const [createLessonOpen, setCreateLessonOpen] = useState(false);
  const [createSessionOpen, setCreateSessionOpen] = useState(false);
  const [editCourseOpen, setEditCourseOpen] = useState(false);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [priceEdit, setPriceEdit] = useState("");
  const [learnerId, setLearnerId] = useState("");
  // Group enrollment state
  const [groupMode, setGroupMode] = useState(false);
  const [groupSelectedIds, setGroupSelectedIds] = useState<string[]>([]);
  const [groupEnrolling, setGroupEnrolling] = useState(false);
  const [groupSessionId, setGroupSessionId] = useState("");

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

  const handleGroupEnroll = async () => {
    if (groupSelectedIds.length === 0) { toast.error("Izaberite bar jednog zaposlenog."); return; }
    setGroupEnrolling(true);
    try {
      const body: Record<string, unknown> = { employeeIds: groupSelectedIds };
      if (groupSessionId) body.sessionId = groupSessionId;
      const response = await fetch(`/api/education/courses/${courseId}/group-enrollments`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { error?: string; discountPercent?: number; unitPrice?: number; totalPrice?: number; enrollments?: unknown[] };
      if (!response.ok) throw new Error(data.error ?? "Grupna prijava nije uspela.");
      const discountMsg = (data.discountPercent ?? 0) > 0
        ? ` Primenjen je popust od ${data.discountPercent}%. Cena po polazniku: ${data.unitPrice?.toLocaleString("sr-RS")} RSD.`
        : "";
      toast.success(`Grupna prijava za ${data.enrollments?.length ?? 0} polaznika je primljena.${discountMsg}`);
      queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
      queryClient.invalidateQueries({ queryKey: getListEnrollmentsQueryKey() });
      setGroupMode(false);
      setGroupSelectedIds([]);
    } catch (err) {
      toast.error("Grupna prijava nije uspela", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setGroupEnrolling(false);
    }
  };

  const toggleGroupEmployee = (id: string) =>
    setGroupSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

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
                {course.gallery?.length ? (
                  <section className="space-y-3">
                    <div>
                      <h2 className="font-serif text-2xl font-semibold">Galerija edukacije</h2>
                      <p className="text-sm text-muted-foreground">Pogledajte prostor, materijal i atmosferu sa prethodnih obuka.</p>
                    </div>
                    <SalonGallery
                      media={course.gallery.map((item) => ({ type: "image" as const, url: item.url }))}
                      salonName={course.title}
                    />
                  </section>
                ) : null}
                {isMyCourse && isEducationCenter ? <CourseGalleryEditor courseId={courseId} gallery={course.gallery ?? []} /> : null}
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
                              {isMyCourse && (session.minimumEnrollments ?? 0) > 0 && (
                                <div className="flex justify-between items-center text-xs text-muted-foreground">
                                  <span>Minimalan broj prijava:</span>
                                  <span className="font-medium">{session.minimumEnrollments}</span>
                                </div>
                              )}
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
                  {(course.groupDiscountMinimum ?? 0) > 0 && (
                    <div className="flex items-start text-sm gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-md p-2.5">
                      <Users className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        <strong>Grupni popust {course.groupDiscountPercent}%</strong> za {course.groupDiscountMinimum}+ polaznika
                      </span>
                    </div>
                  )}
                </div>

                {/* Cancellation / Refund Policy — visible before purchase */}
                {(course.refundPolicy) && !isMyCourse && course.enrollmentStatus !== 'active' && course.enrollmentStatus !== 'completed' && (
                  <div className="border border-border/60 rounded-lg p-3 bg-muted/20 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <ShieldCheck className="w-3.5 h-3.5" /> Politika povraćaja
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{course.refundPolicy}</p>
                  </div>
                )}
                
                {isMyCourse ? (
                  <div className="space-y-3 bg-muted/30 p-4 rounded-lg border border-border/50">
                    <h4 className="font-medium text-xs text-muted-foreground uppercase tracking-wider mb-3">Upravljanje sadržajem</h4>
                    <div className="flex gap-2">
                      <Input aria-label="Cena edukacije" type="number" min="0" value={priceEdit} onChange={(event) => setPriceEdit(event.target.value)} />
                      <Button variant="outline" size="sm" onClick={() => update.mutate({ courseId, data: { price: Number(priceEdit) } }, { onSuccess: () => { toast.success("Cena je ažurirana"); queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) }); }, onError: () => toast.error("Cena nije ažurirana") })} disabled={update.isPending || !priceEdit}>
                        Sačuvaj cenu
                      </Button>
                    </div>
                    {isEducationCenter && instructors && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Instruktor kursa</Label>
                        <Select
                          value={(course as any).instructorProfileId ?? "none"}
                          onValueChange={(val) => linkInstructor.mutate({ courseId, data: { instructorId: val === "none" ? null : val } }, {
                            onSuccess: () => { toast.success("Instruktor je ažuriran"); queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) }); },
                            onError: () => toast.error("Instruktor nije ažuriran"),
                          })}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Bez instruktora" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Bez instruktora</SelectItem>
                            {instructors.map((inst) => <SelectItem key={inst.id} value={inst.id}>{inst.fullName}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {featuredStatus && (
                      <div className="rounded-md border border-border/60 bg-background px-3 py-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-amber-500" /> Istaknuta edukacija</p>
                            <p className="text-xs text-muted-foreground">
                              {featuredStatus.featuredCoursePrice > 0 ? `Naknada: ${featuredStatus.featuredCoursePrice.toLocaleString("sr-RS")} RSD` : "Besplatno"}
                            </p>
                          </div>
                          <Switch
                            checked={featuredStatus.isFeatured}
                            onCheckedChange={(checked) => updateFeatured.mutate({ courseId, data: { active: checked } }, {
                              onSuccess: () => {
                                toast.success(checked
                                  ? (featuredStatus.featuredCoursePrice > 0 ? "Zahtev za isticanje je poslat" : "Edukacija je istaknuta")
                                  : "Isticanje je deaktivirano");
                                refetchFeatured();
                              },
                              onError: () => toast.error("Izmena nije uspela"),
                            })}
                            disabled={updateFeatured.isPending}
                          />
                        </div>
                        {/* Honest charge status — the toggle records an auditable platform charge, it does NOT process a payment. */}
                        {featuredStatus.charge && featuredStatus.featuredCoursePrice > 0 && (
                          <div className="rounded bg-muted/40 px-2 py-1.5 text-xs">
                            {featuredStatus.charge.status === "pending" && (
                              <span className="text-amber-600 dark:text-amber-400">Naknada za isticanje ({featuredStatus.charge.amount.toLocaleString("sr-RS")} RSD) čeka potvrdu uplate od strane LUMERA administracije.</span>
                            )}
                            {featuredStatus.charge.status === "paid" && (
                              <span className="text-emerald-600 dark:text-emerald-400">Naknada za isticanje je evidentirana kao plaćena.</span>
                            )}
                            {featuredStatus.charge.status === "cancelled" && (
                              <span className="text-muted-foreground">Prethodni zahtev za isticanje je otkazan.</span>
                            )}
                            {featuredStatus.charge.status === "refunded" && (
                              <span className="text-muted-foreground">Naknada za isticanje je refundirana.</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
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
                    {/* Group enrollment toggle for SALON_OWNER with employees */}
                    {user?.role === "SALON_OWNER" && employees && employees.length >= 2 && (course.groupDiscountMinimum ?? 0) > 0 && !groupMode && (
                      <Button variant="outline" className="w-full gap-2" onClick={() => setGroupMode(true)}>
                        <Users className="w-4 h-4" /> Grupna prijava ({employees.length} zaposlenih)
                      </Button>
                    )}

                    {groupMode ? (
                      <div className="space-y-3 border rounded-lg p-4 bg-muted/10">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm">Izaberite polaznike</h4>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setGroupMode(false); setGroupSelectedIds([]); }}>Odustani</Button>
                        </div>
                        {(course.groupDiscountMinimum ?? 0) > 0 && (
                          <Alert className="py-2 px-3">
                            <Info className="w-4 h-4" />
                            <AlertDescription className="text-xs ml-1">
                              Odaberite najmanje {course.groupDiscountMinimum} polaznika za popust od {course.groupDiscountPercent}%.
                              {groupSelectedIds.length >= (course.groupDiscountMinimum ?? 0) && (
                                <span className="text-emerald-600 font-medium"> Popust će biti primenjen!</span>
                              )}
                            </AlertDescription>
                          </Alert>
                        )}
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {employees?.map((emp) => (
                            <div key={emp.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/40 cursor-pointer" onClick={() => toggleGroupEmployee(emp.id)}>
                              <Checkbox checked={groupSelectedIds.includes(emp.id)} onCheckedChange={() => toggleGroupEmployee(emp.id)} id={`emp-${emp.id}`} />
                              <label htmlFor={`emp-${emp.id}`} className="text-sm cursor-pointer flex-1">{emp.name}</label>
                            </div>
                          ))}
                        </div>
                        {(course.format === "in-person" || course.format === "hybrid") && course.sessions?.length > 0 && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Termin (opciono)</Label>
                            <Select value={groupSessionId || "auto"} onValueChange={(v) => setGroupSessionId(v === "auto" ? "" : v)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Automatski" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">Automatski</SelectItem>
                                {course.sessions.filter((s: any) => s.availableSeats > 0).map((s: any) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {new Date(s.startsAt).toLocaleDateString("sr-RS")} — {s.availableSeats} mesta
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {groupSelectedIds.length} odabrano
                          {groupSelectedIds.length >= (course.groupDiscountMinimum ?? 999) && (
                            <span className="text-emerald-600 font-medium"> · Cena po polazniku: {Math.round(course.price * (1 - (course.groupDiscountPercent ?? 0) / 100)).toLocaleString("sr-RS")} RSD</span>
                          )}
                        </div>
                        <Button className="w-full" onClick={() => void handleGroupEnroll()} disabled={groupEnrolling || groupSelectedIds.length === 0}>
                          {groupEnrolling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Prijavljujem...</> : `Prijavi ${groupSelectedIds.length} polaznika`}
                        </Button>
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {isMyCourse && <CourseProgramEditor courseId={courseId} days={(course as any).dayProgram ?? []} />}
      <CreateModuleDialog courseId={courseId} open={createModuleOpen} onOpenChange={setCreateModuleOpen} />
      {activeModuleId && <CreateLessonDialog courseId={courseId} moduleId={activeModuleId} open={createLessonOpen} onOpenChange={setCreateLessonOpen} />}
      <CreateSessionDialog courseId={courseId} open={createSessionOpen} onOpenChange={setCreateSessionOpen} />
      <CreateCourseDialog open={editCourseOpen} onOpenChange={setEditCourseOpen} course={course} />
    </div>
  );
}

type CourseGalleryItem = { id: string; url: string; altText: string; sortOrder: number };

function galleryUploadErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string") {
      return (data as { error: string }).error;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Pokušajte ponovo sa drugom slikom.";
}

function CourseGalleryEditor({ courseId, gallery: initialGallery }: { courseId: string; gallery: CourseGalleryItem[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [gallery, setGallery] = useState<CourseGalleryItem[]>(initialGallery);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const requestUpload = useRequestEducationCourseGalleryUpload();
  const addMedia = useAddEducationCourseGalleryMedia();
  const reorder = useReorderEducationCourseGallery();
  const removeMedia = useDeleteEducationCourseGalleryMedia();

  useEffect(() => {
    setGallery(initialGallery);
  }, [initialGallery]);

  const refreshCourse = () => queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });

  const saveOrder = async (nextGallery: CourseGalleryItem[]) => {
    try {
      await reorder.mutateAsync({
        courseId,
        data: { items: nextGallery.map((item) => ({ mediaId: item.id, altText: item.altText })) },
      });
      refreshCourse();
    } catch {
      toast.error("Redosled galerije nije sačuvan", { description: "Pokušajte ponovo." });
      refreshCourse();
    }
  };

  const uploadImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    const supported = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!supported.includes(file.type.toLowerCase()) || file.size > 8 * 1024 * 1024) {
      const message = "Izaberite JPG, PNG, WEBP ili GIF sliku do 8 MB.";
      setUploadError(message);
      toast.error("Neispravna slika", { description: message });
      return;
    }
    setUploading(true);
    try {
      const upload = await requestUpload.mutateAsync({
        courseId,
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const uploadResponse = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Otpremanje slike nije uspelo.");
      const media = await addMedia.mutateAsync({ courseId, data: { mediaId: upload.mediaId, altText: "" } });
      setGallery((current) => [...current, media]);
      refreshCourse();
      toast.success("Fotografija je dodata u galeriju");
    } catch (error) {
      const message = galleryUploadErrorMessage(error);
      setUploadError(message);
      toast.error("Upload nije uspeo", { description: message });
    } finally {
      setUploading(false);
    }
  };

  const moveImage = (id: string, direction: -1 | 1) => {
    const index = gallery.findIndex((item) => item.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= gallery.length) return;
    const next = [...gallery];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    setGallery(next);
    void saveOrder(next);
  };

  const updateAltText = (id: string, altText: string) => {
    const next = gallery.map((item) => item.id === id ? { ...item, altText } : item);
    setGallery(next);
    void saveOrder(next);
  };

  const deleteImage = async (mediaId: string) => {
    if (!window.confirm("Ukloniti ovu fotografiju iz galerije?")) return;
    try {
      await removeMedia.mutateAsync({ courseId, mediaId });
      setGallery((current) => current.filter((item) => item.id !== mediaId));
      refreshCourse();
      toast.success("Fotografija je uklonjena iz galerije");
    } catch {
      toast.error("Fotografija nije uklonjena", { description: "Pokušajte ponovo." });
    }
  };

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-xl font-semibold"><ImagePlus className="h-5 w-5 text-primary" /> Fotografije galerije</h2>
          <p className="mt-1 text-sm text-muted-foreground">Dodajte do 20 fotografija. Možete promeniti redosled i opis svake slike.</p>
        </div>
        <Button asChild variant="outline" disabled={uploading || gallery.length >= 20}>
          <label className="cursor-pointer">
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
            {uploading ? "Otpremanje..." : "Dodaj fotografiju"}
            <input
              aria-label="Dodaj fotografiju u galeriju"
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploading || gallery.length >= 20}
              onChange={(event) => void uploadImage(event)}
            />
          </label>
        </Button>
      </div>
      {uploadError ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {uploadError} Izaberite fotografiju i pokušajte ponovo.
        </p>
      ) : null}

      {gallery.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {gallery.map((media, index) => (
            <div key={media.id} className="overflow-hidden rounded-lg border bg-muted/10">
              <img src={media.url} alt={media.altText || `Fotografija ${index + 1} kursa`} className="h-40 w-full object-cover" />
              <div className="space-y-3 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Fotografija {index + 1}</span>
                  <div className="flex gap-1">
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Pomeri fotografiju ranije" disabled={index === 0 || reorder.isPending} onClick={() => moveImage(media.id, -1)}><ArrowUp className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Pomeri fotografiju kasnije" disabled={index === gallery.length - 1 || reorder.isPending} onClick={() => moveImage(media.id, 1)}><ArrowDown className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Ukloni fotografiju" disabled={removeMedia.isPending} onClick={() => void deleteImage(media.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`gallery-alt-${media.id}`} className="text-xs">Opis slike (opciono)</Label>
                  <Input
                    id={`gallery-alt-${media.id}`}
                    value={media.altText}
                    maxLength={240}
                    placeholder="Npr. Praktični rad na radionici"
                    onChange={(event) => setGallery((current) => current.map((item) => item.id === media.id ? { ...item, altText: event.target.value } : item))}
                    onBlur={(event) => updateAltText(media.id, event.target.value)}
                    disabled={reorder.isPending}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Galerija je prazna. Dodajte fotografije prostora, materijala ili rada sa prethodnih edukacija.
        </div>
      )}
    </section>
  );
}

function CourseProgramEditor({ courseId, days: initialDays }: { courseId: string; days: any[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const replaceProgram = useReplaceEducationCourseDays();
  const [days, setDays] = useState(() => initialDays.length
    ? initialDays.map((day) => ({ dayNumber: day.dayNumber, title: day.title, description: day.description ?? "", durationMinutes: day.durationMinutes ?? "" }))
    : [{ dayNumber: 1, title: "", description: "", durationMinutes: "" }]);

  useEffect(() => {
    setDays(initialDays.length
      ? initialDays.map((day) => ({ dayNumber: day.dayNumber, title: day.title, description: day.description ?? "", durationMinutes: day.durationMinutes ?? "" }))
      : [{ dayNumber: 1, title: "", description: "", durationMinutes: "" }]);
  }, [initialDays]);

  const updateDay = (index: number, field: string, value: string | number) => setDays((current) => current.map((day, dayIndex) => dayIndex === index ? { ...day, [field]: value } : day));
  const save = () => {
    const normalized = days.map((day, index) => ({
      dayNumber: Number(day.dayNumber) || index + 1,
      title: String(day.title).trim(),
      description: String(day.description ?? "").trim(),
      durationMinutes: day.durationMinutes === "" || day.durationMinutes == null ? null : Number(day.durationMinutes),
    }));
    if (normalized.some((day) => day.title.length < 2)) { toast.error("Unesite naslov za svaki dan programa."); return; }
    replaceProgram.mutate({ courseId, data: { days: normalized } }, {
      onSuccess: () => {
        toast.success("Dnevni program je sačuvan");
        queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
      },
      onError: () => toast.error("Dnevni program nije sačuvan"),
    });
  };
  return <Card className="container mx-auto mt-8 max-w-6xl border-primary/20">
    <CardHeader><CardTitle className="font-serif text-xl">Javni dnevni program</CardTitle><p className="text-sm text-muted-foreground">Prikazuje se na stranici edukacije, bez detaljne lokacije ili privatne logistike.</p></CardHeader>
    <CardContent className="space-y-3">
      {days.map((day, index) => <div key={`${day.dayNumber}-${index}`} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[80px_1fr_1fr_120px]">
        <Input aria-label={`Dan ${index + 1}`} type="number" min="1" value={day.dayNumber} onChange={(event) => updateDay(index, "dayNumber", event.target.value)} />
        <Input aria-label={`Naslov dana ${index + 1}`} placeholder="Naslov dana" value={day.title} onChange={(event) => updateDay(index, "title", event.target.value)} />
        <Input aria-label={`Opis dana ${index + 1}`} placeholder="Kratak opis" value={day.description} onChange={(event) => updateDay(index, "description", event.target.value)} />
        <Input aria-label={`Trajanje dana ${index + 1}`} type="number" min="0" placeholder="min" value={day.durationMinutes} onChange={(event) => updateDay(index, "durationMinutes", event.target.value)} />
      </div>)}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setDays((current) => [...current, { dayNumber: current.length + 1, title: "", description: "", durationMinutes: "" }])}><Plus className="mr-2 h-4 w-4" /> Dodaj dan</Button><Button type="button" onClick={save} disabled={replaceProgram.isPending}>{replaceProgram.isPending ? "Čuvanje..." : "Sačuvaj dnevni program"}</Button></div>
    </CardContent>
  </Card>;
}

function LmsView({ enrollmentId }: { enrollmentId: string }) {
  const { data: userResponse } = useGetCurrentUser();
  const { data: lms, isLoading } = useGetEducationLms(enrollmentId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const complete = useCompleteEducationLesson();
  const [certDownloading, setCertDownloading] = useState(false);
  const [icsDownloading, setIcsDownloading] = useState(false);
  
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

  const handleDownloadCertificate = async () => {
    setCertDownloading(true);
    try {
      const response = await fetch(`/api/education/enrollments/${enrollmentId}/certificate`);
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "Preuzimanje sertifikata nije uspelo.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sertifikat-${enrollmentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Sertifikat nije preuzet", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setCertDownloading(false);
    }
  };

  const handleDownloadIcs = async () => {
    setIcsDownloading(true);
    try {
      const response = await fetch(`/api/education/enrollments/${enrollmentId}/session.ics`);
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "Preuzimanje termina nije uspelo.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `termin-${enrollmentId}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("ICS nije preuzet", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setIcsDownloading(false);
    }
  };

  const isCompleted = lms.enrollment.status === "completed";
  const isPaid = lms.enrollment.paymentStatus === "paid";
  const hasCertification = (lms.course as any).certification as boolean;
  // Sessions are live for in-person/hybrid courses that have at least one session.
  // The ICS endpoint needs a sessionId on the enrollment — if sessions exist, the button
  // is shown and the server validates whether this specific enrollment has one.
  const hasSession = (lms.course as any).format !== "online" && Array.isArray((lms.course as any).sessions) && ((lms.course as any).sessions as unknown[]).length > 0;

  return (
    <div className="flex flex-col md:flex-row min-h-[100dvh]">
      <div className="w-full md:w-80 shrink-0 border-r border-border bg-sidebar flex flex-col md:h-[100dvh] md:sticky md:top-0">
        <div className="p-5 border-b bg-sidebar shadow-sm z-10 relative">
          <Link href={userResponse?.user?.role === "STUDENT" ? "/student/edukacije" : `/biznis/edukacije/${lms.course.id}`} className="text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground flex items-center mb-5 transition-colors">
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
          {/* Certificate and ICS download buttons */}
          {isPaid && (
            <div className="mt-4 space-y-2">
              {isCompleted && hasCertification && (
                <Button variant="outline" size="sm" className="w-full gap-2 text-xs bg-sidebar-accent/30 border-sidebar-border hover:bg-sidebar-accent" onClick={() => void handleDownloadCertificate()} disabled={certDownloading}>
                  {certDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Preuzmi sertifikat (PDF)
                </Button>
              )}
              {hasSession && (
                <Button variant="outline" size="sm" className="w-full gap-2 text-xs bg-sidebar-accent/30 border-sidebar-border hover:bg-sidebar-accent" onClick={() => void handleDownloadIcs()} disabled={icsDownloading}>
                  {icsDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
                  Dodaj termin u kalendar (.ics)
                </Button>
              )}
            </div>
          )}
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
  
  const DEFAULT_REFUND_POLICY = "Povraćaj je moguć do isteka roka zaštite kupovine. Ako centar otkaže termin, kupovina se refundira u celosti.";
  const { register, handleSubmit, control, formState: { errors }, reset } = useForm<any>({
    resolver: zodResolver(courseSchema) as any,
    defaultValues: { format: 'online', level: 'all-levels', certification: false, price: 0, imageUrl: DEFAULT_COURSE_IMAGE, refundPolicy: DEFAULT_REFUND_POLICY, groupDiscountMinimum: "", groupDiscountPercent: "", learningOutcomesText: "", includedItemsText: "", requirements: "" }
  });
  
  useEffect(() => {
    if (!open) return;
    if (!course) {
      reset({ format: 'online', level: 'all-levels', certification: false, price: 0, imageUrl: DEFAULT_COURSE_IMAGE, refundPolicy: DEFAULT_REFUND_POLICY, groupDiscountMinimum: "", groupDiscountPercent: "", learningOutcomesText: "", includedItemsText: "", requirements: "" });
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
      level: course.level ?? "all-levels",
      learningOutcomesText: (course.learningOutcomes ?? []).join("\n"),
      includedItemsText: (course.includedItems ?? []).join("\n"),
      requirements: course.requirements ?? "",
      certification: course.certification,
      imageUrl: course.imageUrl,
      startDate: course.startDate ? new Date(course.startDate).toISOString().slice(0, 10) : "",
      refundPolicy: course.refundPolicy ?? DEFAULT_REFUND_POLICY,
      groupDiscountMinimum: course.groupDiscountMinimum ?? "",
      groupDiscountPercent: course.groupDiscountPercent ?? "",
    });
  }, [open, reset, course]);

  const onSubmit = (raw: any) => {
    // Normalize the optional group-discount pair: empty inputs become null so the
    // server clears the configuration; both must be provided together (enforced by zod).
    const data = {
      ...raw,
      level: raw.level ?? "all-levels",
      learningOutcomes: String(raw.learningOutcomesText ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      includedItems: String(raw.includedItemsText ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      groupDiscountMinimum: raw.groupDiscountMinimum === "" || raw.groupDiscountMinimum == null ? null : Number(raw.groupDiscountMinimum),
      groupDiscountPercent: raw.groupDiscountPercent === "" || raw.groupDiscountPercent == null ? null : Number(raw.groupDiscountPercent),
    };
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
              <Label>Nivo znanja</Label>
              <Controller name="level" control={control} render={({ field }) => (
                <Select value={field.value ?? "all-levels"} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all-levels">Svi nivoi</SelectItem>
                    <SelectItem value="beginner">Početni nivo</SelectItem>
                    <SelectItem value="intermediate">Srednji nivo</SelectItem>
                    <SelectItem value="advanced">Napredni nivo</SelectItem>
                  </SelectContent>
                </Select>
              )} />
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

            <div className="space-y-2 md:col-span-2">
              <Label>Ishodi učenja</Label>
              <Textarea rows={3} placeholder={"Jedan ishod po redu\nNpr. Samostalno izvodi protokol"} {...register("learningOutcomesText")} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Uključeno u cenu</Label>
              <Textarea rows={3} placeholder={"Jedna stavka po redu\nNpr. Materijal za praktičan rad"} {...register("includedItemsText")} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Preduslovi (opciono)</Label>
              <Textarea rows={2} placeholder="Potrebno prethodno znanje, materijal ili sertifikat..." {...register("requirements")} />
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

          <div className="space-y-2">
            <Label>Politika povraćaja *</Label>
            <Textarea rows={3} placeholder="Uslovi za povraćaj i otkazivanje..." {...register("refundPolicy")} />
            <p className="text-xs text-muted-foreground">Prikazuje se polaznicima pre kupovine.</p>
            {errors.refundPolicy && <p className="text-sm text-destructive">{errors.refundPolicy.message as string}</p>}
          </div>

          <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
            <div>
              <Label className="text-base">Grupni popust (opciono)</Label>
              <p className="text-sm text-muted-foreground">Automatski popust kada salon prijavi više polaznika odjednom. Ostavite prazno da isključite.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Minimalan broj polaznika</Label>
                <Input type="number" min="2" max="999" placeholder="Npr. 3" {...register("groupDiscountMinimum")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Procenat popusta (%)</Label>
                <Input type="number" min="0" max="100" placeholder="Npr. 15" {...register("groupDiscountPercent")} />
              </div>
            </div>
            {errors.groupDiscountPercent && <p className="text-sm text-destructive">{errors.groupDiscountPercent.message as string}</p>}
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
      capacity: z.coerce.number().min(1, "Kapacitet mora biti > 0"),
      minimumEnrollments: z.coerce.number().int().min(0).max(9999).optional().nullable(),
    })) as any,
    defaultValues: { capacity: 10, minimumEnrollments: "" }
  });
  
  useEffect(() => { if (open) reset(); }, [open, reset]);

  const onSubmit = (raw: any) => {
    const data = {
      ...raw,
      startsAt: new Date(raw.startsAt).toISOString(),
      endsAt: new Date(raw.endsAt).toISOString(),
      minimumEnrollments: raw.minimumEnrollments === "" || raw.minimumEnrollments == null ? null : Number(raw.minimumEnrollments),
    };
    create.mutate({ courseId, data }, {
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kapacitet polaznika *</Label>
              <Input type="number" min="1" {...register("capacity")} />
            </div>
            <div className="space-y-2">
              <Label>Minimalan broj prijava</Label>
              <Input type="number" min="0" max="9999" placeholder="Opciono" {...register("minimumEnrollments")} />
              <p className="text-xs text-muted-foreground">Prag ispod kojeg se termin može otkazati.</p>
            </div>
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

// ── Instructor management dialog (EDUCATION_CENTER_OWNER) ───────────────────

const instructorSchema = z.object({
  fullName: z.string().min(1, "Ime je obavezno").max(120),
  photoUrl: z.string().optional(),
  biography: z.string().max(4000).optional(),
  industryYears: z.coerce.number().int().min(0).optional(),
  experienceYears: z.coerce.number().int().min(0).optional(),
  specializations: z.string().optional(),
  qualifications: z.string().optional(),
});
type InstructorForm = z.infer<typeof instructorSchema>;

function InstructorsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: instructors, isLoading } = useListEducationInstructors({ query: { enabled: open, queryKey: getListEducationInstructorsQueryKey() } });
  const createMut = useCreateEducationInstructor();
  const updateMut = useUpdateEducationInstructor();
  const delMut = useDeleteEducationInstructor();
  const [editingId, setEditingId] = useState<string | null>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<InstructorForm>({ resolver: zodResolver(instructorSchema) });

  const openEdit = (inst: any) => {
    setEditingId(inst.id);
    reset({
      fullName: inst.fullName,
      photoUrl: inst.photoUrl ?? "",
      biography: inst.biography ?? "",
      industryYears: inst.industryYears,
      experienceYears: inst.experienceYears,
      specializations: (inst.specializations ?? []).join(", "),
      qualifications: (inst.qualifications ?? []).join(", "),
    });
  };

  const parseList = (val?: string) => (val ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const onSubmit = (data: InstructorForm) => {
    const payload = {
      fullName: data.fullName,
      photoUrl: data.photoUrl || undefined,
      biography: data.biography,
      industryYears: data.industryYears ?? 0,
      experienceYears: data.experienceYears ?? 0,
      specializations: parseList(data.specializations),
      qualifications: parseList(data.qualifications),
    };
    if (editingId) {
      updateMut.mutate({ instructorId: editingId, data: payload }, {
        onSuccess: () => { toast.success("Instruktor je ažuriran"); queryClient.invalidateQueries({ queryKey: getListEducationInstructorsQueryKey() }); setEditingId(null); reset({}); },
        onError: () => toast.error("Greška pri ažuriranju"),
      });
    } else {
      createMut.mutate({ data: payload }, {
        onSuccess: () => { toast.success("Instruktor je dodat"); queryClient.invalidateQueries({ queryKey: getListEducationInstructorsQueryKey() }); reset({}); },
        onError: () => toast.error("Greška pri kreiranju"),
      });
    }
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("Da li ste sigurni da želite da obrišete ovog instruktora?")) return;
    delMut.mutate({ instructorId: id }, {
      onSuccess: () => { toast.success("Instruktor je obrisan"); queryClient.invalidateQueries({ queryKey: getListEducationInstructorsQueryKey() }); if (editingId === id) { setEditingId(null); reset({}); } },
      onError: () => toast.error("Greška pri brisanju"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-serif text-xl flex items-center gap-2"><UserCircle2 className="w-5 h-5" /> Profili instruktora</DialogTitle></DialogHeader>
        <div className="space-y-6 pt-2">
          {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div> : (
            <div className="space-y-2">
              {instructors?.map((inst) => (
                <div key={inst.id} className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
                  {inst.photoUrl ? <img src={inst.photoUrl} alt={inst.fullName} className="w-10 h-10 rounded-full object-cover border" /> : <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center"><UserCircle2 className="w-6 h-6 text-muted-foreground" /></div>}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{inst.fullName}</p>
                    <p className="text-xs text-muted-foreground">{inst.experienceYears} god. iskustva</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(inst)}><Pencil className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(inst.id)} disabled={delMut.isPending}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </div>
              ))}
              {!instructors?.length && <p className="text-sm text-muted-foreground text-center py-4">Nema instruktora. Dodajte prvog ispod.</p>}
            </div>
          )}

          <div className="border-t pt-4">
            <h4 className="font-medium text-sm mb-3">{editingId ? "Izmeni instruktora" : "Dodaj instruktora"}</h4>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Puno ime *</Label>
                  <Input placeholder="Ime i prezime" {...register("fullName")} />
                  {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">URL fotografije</Label>
                  <Input placeholder="https://..." {...register("photoUrl")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Biografija</Label>
                <Textarea placeholder="Kratka biografija instruktora..." rows={3} {...register("biography")} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Godine u industriji</Label>
                  <Input type="number" min="0" {...register("industryYears")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Godine poučavanja</Label>
                  <Input type="number" min="0" {...register("experienceYears")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Specijalizacije (zarezom odvojeno)</Label>
                <Input placeholder="Npr. Manikir, Gelovi, Akrilne nokte" {...register("specializations")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Kvalifikacije i sertifikati (zarezom odvojeno)</Label>
                <Input placeholder="Npr. OPI sertifikat, Ombre majstor" {...register("qualifications")} />
              </div>
              <div className="flex gap-2 pt-1">
                {editingId && <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingId(null); reset({}); }}>Odustani</Button>}
                <Button type="submit" size="sm" disabled={createMut.isPending || updateMut.isPending}>
                  {(createMut.isPending || updateMut.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingId ? "Sačuvaj izmene" : "Dodaj instruktora"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Public instructor profile page ──────────────────────────────────────────

export function InstructorPublicProfilePage({ instructorId }: { instructorId: string }) {
  const { data: profile, isLoading, isError } = useGetPublicInstructorProfile(instructorId);

  if (isLoading) return (
    <div className="container mx-auto max-w-4xl px-4 py-16 space-y-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );

  if (isError || !profile) return (
    <div className="container mx-auto max-w-4xl px-4 py-24 text-center">
      <UserCircle2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
      <h2 className="text-2xl font-bold mb-2">Instruktor nije pronađen</h2>
      <Button asChild variant="outline"><Link href="/edukacije">Nazad na katalog</Link></Button>
    </div>
  );

  return (
    <div className="bg-background min-h-screen">
      <div className="bg-secondary/20 border-b">
        <div className="container mx-auto max-w-4xl px-4 py-10">
          <Link href="/edukacije" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" /> Nazad
          </Link>
          <div className="flex items-start gap-6">
            {profile.photoUrl ? (
              <img src={profile.photoUrl} alt={profile.name} className="w-24 h-24 rounded-full object-cover border-2 border-border shadow-md shrink-0" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center shrink-0"><UserCircle2 className="w-12 h-12 text-muted-foreground" /></div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="font-serif text-3xl font-bold mb-2">{profile.name}</h1>
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Star className="w-4 h-4 text-amber-500 fill-amber-500" /> {profile.rating.toFixed(1)} prosečna ocena</span>
                <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {profile.participantCount} polaznika</span>
                <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {profile.industryYears} god. u industriji</span>
                <span className="flex items-center gap-1"><GraduationCap className="w-4 h-4" /> {profile.experienceYears} god. poučavanja</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-8">
        {profile.biography && (
          <section>
            <h2 className="font-serif text-xl font-semibold mb-3">O instruktoru</h2>
            <div className="prose prose-slate dark:prose-invert max-w-none text-foreground/90 leading-relaxed">
              {profile.biography.split("\n").map((para, i) => <p key={i} className="mb-3">{para}</p>)}
            </div>
          </section>
        )}

        {profile.qualifications.length > 0 && (
          <section>
            <h2 className="font-serif text-xl font-semibold mb-3">Kvalifikacije i sertifikati</h2>
            <div className="flex flex-wrap gap-2">
              {profile.qualifications.map((q) => <Badge key={q} variant="secondary" className="gap-1"><Award className="w-3.5 h-3.5" />{q}</Badge>)}
            </div>
          </section>
        )}

        {profile.specializations.length > 0 && (
          <section>
            <h2 className="font-serif text-xl font-semibold mb-3">Specijalizacije</h2>
            <div className="flex flex-wrap gap-2">
              {profile.specializations.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
            </div>
          </section>
        )}

        {profile.courses.length > 0 && (
          <section>
            <h2 className="font-serif text-xl font-semibold mb-4">Kursevi instruktora</h2>
            <div className="grid gap-5 md:grid-cols-2">
              {profile.courses.map((course: any) => (
                <Link key={course.id} href={`/edukacije/${course.id}`}>
                  <Card className="overflow-hidden hover:shadow-md transition-all cursor-pointer border-border/60 group">
                    {course.imageUrl && (
                      <div className="aspect-video overflow-hidden bg-muted/30">
                        <img src={course.imageUrl} alt={course.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                      </div>
                    )}
                    <CardContent className="p-4">
                      <h3 className="font-serif font-bold text-lg mb-1 group-hover:text-primary transition-colors line-clamp-2">{course.title}</h3>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />{course.rating.toFixed(1)}</span>
                        <span className="font-bold text-foreground">{course.price.toLocaleString("sr-RS")} RSD</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
