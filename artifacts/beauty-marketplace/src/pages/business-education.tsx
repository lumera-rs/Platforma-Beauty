
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { z } from "zod";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";

import {
  useGetCurrentUser, useGetPublicEducationTaxonomy, getGetPublicEducationTaxonomyQueryKey, useListCourses, useGetEducationCourse,
  useListEnrollments, useGetEducationLms,
  useListSalonEmployees, useListEmployeeShiftSwaps,
  useListMyFeaturedPlacements, getListMyFeaturedPlacementsQueryKey, useCreateFeaturedPlacement, useProposeEducationCourseType,
  useCreateEducationCourse, useUpdateEducationCourse,
  usePublishEducationCourse, useArchiveEducationCourse,
  useCreateEducationModule, useCreateEducationLesson,
  useCreateEducationSession, useEnrollInEducationCourse, createEducationGroupEnrollments, useCreateEducationEnrollmentExtension,
  useGetEducationEnrollmentPaymentInstructions, getEducationEnrollmentPaymentInstructions, getGetEducationEnrollmentPaymentInstructionsQueryKey,
  useCompleteEducationLesson,
  useListEducationInstructors, useCreateEducationInstructor, useUpdateEducationInstructor, useDeleteEducationInstructor,
  useGetEducationCourseFeaturedStatus, useUpdateEducationCourseFeatured, useLinkEducationCourseInstructor,
  useReplaceEducationCourseDays,
  useAddEducationCourseGalleryMedia,
  useReorderEducationCourseGallery, useDeleteEducationCourseGalleryMedia,
  useGetPublicInstructorProfile,
  useListEducationNotifications, useAcceptEducationWaitlistOffer, useMarkEducationNotificationRead,
  useGetEducationCenterStatus,
  getListCoursesQueryKey, getGetEducationCourseQueryKey,
  getListEnrollmentsQueryKey, getGetEducationLmsQueryKey, getListSalonEmployeesQueryKey, getListEmployeeShiftSwapsQueryKey,
  getListEducationInstructorsQueryKey, getGetEducationCourseFeaturedStatusQueryKey,
  getListEducationNotificationsQueryKey,
  getApiErrorMessage,
  type EducationNotificationList,
  type EducationEnrollmentPaymentInstructions,
} from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";

import { BusinessLayout } from "@/components/business-layout";
import { CenterOperationsView } from "@/components/education/center-operations";
import { EducationFieldHelp } from "@/components/education/education-field-help";
import { Layout } from "@/components/layout";
import { SalonGallery } from "@/components/salon-gallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { rollbackQueries, updateQueryOptimistically } from "@/lib/optimistic-query";
import { EDUCATION_NOTIFICATION_MUTATION_KEY, educationNotificationMutationQueue, useMutationQueueBusy } from "@/lib/optimistic-mutation-queue";
import { OptimizedImage } from "@/components/optimized-image";
import { uploadOptimizedImage } from "@/lib/media-upload";
import { trackEvent } from "@/lib/analytics";
import { DIGITAL_CONTENT_CONSENT_TEXT } from "@/lib/education-consent";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  GraduationCap, Search, MapPin, Clock, Award,
  PlayCircle, Users, CheckCircle2, ArrowLeft,
  ArrowRight, Plus, Filter, Monitor, Video, Calendar, Star, Loader2,
  Download, CalendarPlus, Info, ShieldCheck, UserCircle2, Zap, Trash2, Pencil, Link2, Bell, ImagePlus, ArrowUp, ArrowDown
} from "lucide-react";

const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);
const DEFAULT_COURSE_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400' viewBox='0 0 800 400'%3E%3Crect width='800' height='400' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif' font-size='24' fill='%239ca3af'%3EEdukacija%3C/text%3E%3C/svg%3E";

const courseSchema = z.object({
  title: z.string().min(2, "Naslov mora imati bar 2 karaktera"),
  description: z.string().optional(),

  category: z.string().min(2, "Kategorija je obavezna (nova ili legacy)"),
  subcategoryId: z.string().optional().nullable(),
  courseTypeId: z.string().optional().nullable(),

  format: z.enum(["online", "in-person", "hybrid"]),
  city: z.string().optional(),
  price: z.coerce.number().min(0, "Cena ne može biti negativna"),
  duration: z.string().min(1, "Trajanje je obavezno"),
  level: z.enum(["beginner", "intermediate", "advanced", "all-levels"]).optional(),
  learningOutcomesText: z.string().optional(),
  includedItemsText: z.string().optional(),
  requirements: z.string().max(2000).optional(),

  certification: z.boolean().optional(),
  certificateName: z.string().optional(),
  accredited: z.boolean().optional(),

  theoryHours: z.coerce.number().optional().nullable(),
  practicalHours: z.coerce.number().optional().nullable(),
  language: z.string().optional(),
  trailerUrl: z.string().optional(),
  tagsText: z.string().optional(),

  imageUrl: z.string().min(1, "Slika je obavezna"),
  startDate: z.string().optional(),
  refundPolicy: z.string().min(1, "Politika povraćaja je obavezna").max(2000),

  paymentMode: z.enum(["online_full", "live_deposit", "live_off_platform"]),
  depositAmount: z.coerce.number().optional().nullable(),

  groupDiscountMinimum: z.coerce.number().int().min(2).max(999).optional().nullable(),
  groupDiscountPercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
  durationMinutes: z.coerce.number().int().min(1).max(5256000).optional().nullable(),
  giftVoucherEligible: z.boolean().optional(),
  schedulingMode: z.enum(["fixed_group", "individual_calendar"]).optional(),
  cancellationCutoffHours: z.coerce.number().int().min(0).max(8760).optional(),
  depositDisposition: z.enum(["refund", "forfeit", "transfer"]).optional(),
  minimumEnrollmentRiskDeadline: z.string().optional(),
  earlyBirdPrice: z.preprocess((value) => value === "" ? null : value, z.coerce.number().min(0).nullable().optional()),
  earlyBirdCutoff: z.string().optional(),
  installmentCount: z.coerce.number().int().min(1).max(3).optional(),
  onlineAccessDays: z.preprocess((val) => (val === "" ? null : val), z.coerce.number().int().min(1).nullable().optional()),
  extensionPrice1Month: z.preprocess((val) => (val === "" ? null : val), z.coerce.number().min(1).nullable().optional()),
  extensionPrice3Months: z.preprocess((val) => (val === "" ? null : val), z.coerce.number().min(1).nullable().optional()),
  extensionPrice6Months: z.preprocess((val) => (val === "" ? null : val), z.coerce.number().min(1).nullable().optional()),
}).refine(
  (data) => (data.groupDiscountMinimum == null) === (data.groupDiscountPercent == null),
  { message: "Unesite i minimalan broj polaznika i procenat popusta za grupni popust.", path: ["groupDiscountPercent"] }
).refine(
  (data) => data.paymentMode !== "live_deposit" || (data.depositAmount && data.depositAmount > 0 && data.depositAmount <= data.price),
  { message: "Depozit mora biti veći od nule i manji od ukupne cene.", path: ["depositAmount"] }
).refine(
  (data) => data.paymentMode !== "live_deposit" || (!!data.refundPolicy && data.refundPolicy.trim().length > 0),
  { message: "Politika povraćaja je obavezna za opciju 'Uživo (Depozit)'.", path: ["refundPolicy"] }
).refine(
  (data) => data.paymentMode !== "live_off_platform" || data.format !== "online",
  { message: "Plaćanje uživo je dozvoljeno samo za kurseve koji se održavaju uživo ili hibridno.", path: ["paymentMode"] }
).refine(
  (data) => data.format !== "online" || data.paymentMode === "online_full",
  { message: "Online kursevi zahtevaju potpuno online plaćanje.", path: ["paymentMode"] }
).refine(
  (data) => data.format !== "online" || (data.onlineAccessDays != null && data.onlineAccessDays > 0),
  { message: "Broj dana pristupa je obavezan za online edukacije.", path: ["onlineAccessDays"] }
).refine(
  (data) => data.format !== "online" || (data.extensionPrice1Month != null && data.extensionPrice1Month > 0),
  { message: "Cena produženja za 1 mesec mora biti veća od nule.", path: ["extensionPrice1Month"] }
).refine(
  (data) => data.format !== "online" || (data.extensionPrice3Months != null && data.extensionPrice3Months > 0),
  { message: "Cena produženja za 3 meseca mora biti veća od nule.", path: ["extensionPrice3Months"] }
).refine(
  (data) => data.format !== "online" || (data.extensionPrice6Months != null && data.extensionPrice6Months > 0),
  { message: "Cena produženja za 6 meseci mora biti veća od nule.", path: ["extensionPrice6Months"] }
).refine(
  (data) => Boolean(data.earlyBirdPrice == null) === !data.earlyBirdCutoff,
  { message: "Rana prijava cena i rok se unose zajedno.", path: ["earlyBirdCutoff"] }
).refine(
  (data) => data.earlyBirdPrice == null || data.earlyBirdPrice < data.price,
  { message: "Rana prijava cena mora biti manja od redovne cene.", path: ["earlyBirdPrice"] }
);

export default function BusinessEducation({ hideLayout = false }: { hideLayout?: boolean }) {
  const [matchLms, paramsLms] = useRoute("/biznis/edukacije/lms/:enrollmentId");
  const [matchStudentLms, studentLmsParams] = useRoute("/student/edukacije/lms/:enrollmentId");
  const [matchJobseekerLms, jobseekerLmsParams] = useRoute("/poslovi/nalog/edukacije/lms/:enrollmentId");
  const [matchCourse, paramsCourse] = useRoute("/biznis/edukacije/:courseId");
  const { data: userResponse } = useGetCurrentUser();
  const mayHaveCenterMembership = Boolean(userResponse?.user);
  const { data: statusList } = useGetEducationCenterStatus({ query: { enabled: mayHaveCenterMembership, retry: false, queryKey: [ "educationCenterStatus" ] } });
  const [selectedOperationsCenterId, setSelectedOperationsCenterId] = useState("");
  const operationsCenterId = selectedOperationsCenterId || statusList?.[0]?.id || "";

  if (matchStudentLms && studentLmsParams) {
    return <Layout hideCustomerNavigation><LmsView enrollmentId={studentLmsParams.enrollmentId} /></Layout>;
  }
  if (matchJobseekerLms && jobseekerLmsParams) {
    return <Layout><LmsView enrollmentId={jobseekerLmsParams.enrollmentId} /></Layout>;
  }
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

  if (userResponse?.user?.role === "STUDENT") {
    return <Layout hideCustomerNavigation><StudentLearningView /></Layout>;
  }
  if (userResponse?.user?.role === "JOBSEEKER") {
    const learningView = <StudentLearningView jobseeker />;
    return hideLayout ? learningView : <Layout>{learningView}</Layout>;
  }

  const isCenter = Boolean(statusList?.length);

  if (!isCenter) {
    if (userResponse?.user?.role === "SALON_EMPLOYEE") {
      return <BusinessLayout><EmployeeLearningView /></BusinessLayout>;
    }
    return (
      <BusinessLayout>
        <CatalogView />
      </BusinessLayout>
    );
  }

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8">
        {statusList && statusList.length > 1 ? (
          <div className="mb-4 max-w-sm">
            <Label className="flex items-center gap-2" aria-describedby="help-Centar-za-operacije">Centar za operacije <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Centar-za-operacije">Pomoć za polje: Centar za operacije</TooltipContent></Tooltip></Label>
            <Select value={operationsCenterId} onValueChange={setSelectedOperationsCenterId}>
              <SelectTrigger aria-describedby="education-operations-center-help" data-testid="education-center-selector"><SelectValue /></SelectTrigger>
              <SelectContent>{statusList.map((center) => <SelectItem key={center.id} value={center.id}>{center.name}</SelectItem>)}</SelectContent>
            </Select>
            <EducationFieldHelp id="education-operations-center-help" label="Centar za operacije" text="Izaberite edukativni centar čijim kursevima, terminima i prijavama želite da upravljate." />
          </div>
        ) : null}
        <Tabs defaultValue="catalog" className="space-y-6">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 md:h-9 md:w-auto md:flex-nowrap">
            <TabsTrigger value="operations">Operacije</TabsTrigger>
            <TabsTrigger value="catalog">Katalog i edukacije</TabsTrigger>
            <TabsTrigger value="placements">Sponzorisane pozicije</TabsTrigger>
            <TabsTrigger value="profile">Profil i status centra</TabsTrigger>
          </TabsList>
          <TabsContent value="operations" className="m-0">
            <CenterOperationsView centerId={operationsCenterId} />
          </TabsContent>
          <TabsContent value="catalog" className="m-0">
            <CatalogView />
          </TabsContent>
          <TabsContent value="placements" className="m-0">
            <MyPlacementsView />
          </TabsContent>
          <TabsContent value="profile" className="m-0">
            <CenterProfileView />
          </TabsContent>
        </Tabs>
      </div>
    </BusinessLayout>
  );
}

function CenterProfileView() {
  const { data: statusList, isLoading } = useGetEducationCenterStatus();

  if (isLoading) return <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/50" /></div>;
  if (!statusList || statusList.length === 0) return <div className="py-12 text-center text-muted-foreground">Nemate profil edukativnog centra.</div>;

  return (
    <div className="space-y-12 max-w-4xl">
      <div>
        <h2 className="text-2xl font-serif font-bold">Profil i status centra</h2>
        <p className="text-muted-foreground">Vaša analitika, rangiranje i metrike bez uticaja sponzorisanih pozicija.</p>
      </div>

      {statusList.map((center) => (
        <div key={center.id} className="space-y-6 pb-6 border-b last:border-0">
          <h3 className="text-xl font-bold">{center.name}</h3>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className={center.verificationStatus === "verified" ? "border-emerald-500/30 bg-emerald-50/10" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Status verifikacije
                  <Badge variant={center.verificationStatus === "verified" ? "default" : center.verificationStatus === "pending" ? "secondary" : "destructive"}>
                    {center.verificationStatus === "verified" ? "Verifikovan" : center.verificationStatus === "pending" ? "Na čekanju" : "Obustavljen"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {center.verificationNote && (
                  <Alert variant={center.verificationStatus === "verified" ? "default" : "destructive"}>
                    <Info className="h-4 w-4" />
                    <AlertDescription>{center.verificationNote}</AlertDescription>
                  </Alert>
                )}
                <p className="text-sm text-muted-foreground">
                  Da bi se vaši kursevi prikazivali u katalogu, centar mora biti verifikovan. Uslovi za održavanje verifikacije uključuju visoku prosečnu ocenu i nizak procenat sporova.
                </p>
                <div className="pt-2">
                  <div className="flex justify-between items-center pb-2 border-b">
                    <span className="text-sm font-medium text-muted-foreground">Status pretplate</span>
                    <span className="font-semibold">{center.subscriptionStatus === "active" ? "Aktivan" : (center.subscriptionStatus || "Nema")}</span>
                  </div>
                  {center.currentPeriodEnd && (
                     <div className="flex justify-between items-center pt-2">
                       <span className="text-sm font-medium text-muted-foreground">Pretplata ističe</span>
                       <span className="font-semibold">{new Date(center.currentPeriodEnd).toLocaleDateString("sr-RS")}</span>
                     </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Organske metrike</CardTitle>
                <CardDescription>Metrike bez uticaja plaćenih pozicija.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Organski pregledi (90d)</span>
                  <span className="font-semibold">{center.organicInquiriesAndCompletedEnrollments90d}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Završilo polaznika</span>
                  <span className="font-semibold">{center.completedLearnerCount}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Objavljenih recenzija</span>
                  <span className="font-semibold">{center.publishedReviewCount}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b">
                  <span className="text-sm font-medium text-muted-foreground">Prosečna ocena</span>
                  <span className="font-semibold flex items-center">
                    <Star className={`w-4 h-4 mr-1 ${center.publishedRating > 0 ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
                    {center.publishedRating > 0 ? center.publishedRating.toFixed(1) : "—"}
                  </span>
                </div>

                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-3">{center.metricsExplanation}</p>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="flex items-center gap-1"><Award className={`w-3 h-3 ${center.qualifiesMostRequested ? "text-primary" : "text-muted-foreground"}`}/> Najtraženije</span>
                        <span>{Math.min(center.organicInquiriesAndCompletedEnrollments90d, 10)}/10</span>
                      </div>
                      <Progress value={Math.min(100, (center.organicInquiriesAndCompletedEnrollments90d / 10) * 100)} className="h-1.5" />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="flex items-center gap-1"><Star className={`w-3 h-3 ${center.qualifiesTopRated ? "text-amber-500" : "text-muted-foreground"}`}/> Najbolje ocenjeno</span>
                        <span>{Math.min(center.publishedReviewCount, 5)}/5 recenzija</span>
                      </div>
                      <Progress value={Math.min(100, (center.publishedReviewCount / 5) * 100)} className="h-1.5" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ))}
    </div>
  );
}

function MyPlacementsView() {
  const { data: placements, isLoading } = useListMyFeaturedPlacements({ query: { queryKey: getListMyFeaturedPlacementsQueryKey(), refetchInterval: 30_000 } });
  const { data: notifications } = useListEducationNotifications({
    query: { queryKey: getListEducationNotificationsQueryKey(), refetchInterval: 30_000 },
  });
  const { data: courses } = useListCourses(undefined, { query: { queryKey: getListCoursesQueryKey() } });
  const { data: taxonomy } = useGetPublicEducationTaxonomy({ query: { queryKey: getGetPublicEducationTaxonomyQueryKey() } });
  const purchaseMut = useCreateFeaturedPlacement();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const trackedQrPlacementIds = useRef(new Set<string>());

  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [kind, setKind] = useState<"featured_center" | "special_offer">("special_offer");
  const [scope, setScope] = useState<"home" | "category" | "subcategory">("category");
  const [scopeId, setScopeId] = useState<string>("");
  const [courseId, setCourseId] = useState<string>("");

  const categories = useMemo(() => taxonomy ? taxonomy.flatMap(s => s.categories) : [], [taxonomy]);
  const subcategories = useMemo(() => categories.flatMap(c => c.subcategories), [categories]);

  useEffect(() => {
    placements?.forEach((placement: any) => {
      if (
        placement.status !== "pending_payment"
        || !placement.paymentInstructionsAvailable
        || !placement.ipsPayload
        || trackedQrPlacementIds.current.has(placement.id)
      ) return;

      trackedQrPlacementIds.current.add(placement.id);
      trackEvent("featured_placement_qr_viewed", {
        placement_kind: placement.kind,
        placement_scope: placement.scope,
      });
    });
  }, [placements]);

  const purchase = () => {
    let finalScopeId: string | null = scopeId;
    if (scope === "home") finalScopeId = null;

    let finalCourseId: string | null = courseId;
    if (kind === "featured_center") finalCourseId = null;

    if (scope !== "home" && !finalScopeId) {
      toast.error("Greška", { description: "Morate izabrati kategoriju ili potkategoriju." });
      return;
    }
    if (kind === "special_offer" && !finalCourseId) {
      toast.error("Greška", { description: "Morate izabrati kurs za specijalnu ponudu." });
      return;
    }

    purchaseMut.mutate({
      data: {
        kind,
        scope,
        scopeId: finalScopeId,
        targetId: kind === "special_offer" ? finalCourseId : null
      }
    }, {
      onSuccess: (res: any) => {
        trackEvent("featured_placement_requested", {
          placement_kind: res.kind,
          placement_scope: res.scope,
        });
        toast.success("Zahtev evidentiran", { description: `Referenca za uplatu: ${res.paymentReference}` });
        queryClient.invalidateQueries({ queryKey: getListMyFeaturedPlacementsQueryKey() });
        setPurchaseOpen(false);
        setScopeId("");
        setCourseId("");
      },
      onError: (e: any) => toast.error("Greška", { description: e.message || "Došlo je do greške." })
    });
  };

  return (
    <div className="space-y-6">
      {notifications?.notifications
        .filter((notification) => notification.type.startsWith("featured_placement_") && !notification.readAt)
        .slice(0, 3)
        .map((notification) => (
          <Alert key={notification.id} data-testid="featured-placement-notification">
            <Bell className="h-4 w-4" />
            <AlertDescription>
              <span className="font-medium">{notification.title}</span>
              <span className="mt-1 block">{notification.body}</span>
            </AlertDescription>
          </Alert>
        ))}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-serif font-bold">Sponzorisane pozicije</h2>
          <p className="text-muted-foreground">Istaknite svoj centar ili kurseve.</p>
        </div>
        <Button data-testid="buy-placement-btn" onClick={() => setPurchaseOpen(true)}>Kupi poziciju</Button>
      </div>

      <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <DialogContent data-testid="buy-placement-dialog">
          <DialogHeader><DialogTitle>Kupi poziciju</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2" aria-describedby="help-Tip-pozicije">Tip pozicije <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Tip-pozicije">Pomoć za polje: Tip pozicije</TooltipContent></Tooltip></Label>
              <Select value={kind} onValueChange={(val: any) => setKind(val)}>
                <SelectTrigger aria-describedby="education-placement-kind-help" data-testid="placement-kind-select"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="featured_center">Istaknuti centar</SelectItem>
                  <SelectItem value="special_offer">Specijalna ponuda (Kurs)</SelectItem>
                </SelectContent>
              </Select>
              <EducationFieldHelp id="education-placement-kind-help" label="Tip pozicije" text="Odaberite da li promovišete ceo edukativni centar ili jednu konkretnu edukaciju." />
            </div>

            {kind === "special_offer" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Izaberite-edukaciju">Izaberite edukaciju <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Izaberite-edukaciju">Pomoć za polje: Izaberite edukaciju</TooltipContent></Tooltip></Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger aria-describedby="education-placement-course-help" data-testid="placement-course-select"><SelectValue placeholder="Izaberite kurs..." /></SelectTrigger>
                  <SelectContent>
                    {courses?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <EducationFieldHelp id="education-placement-course-help" label="Edukacija za promociju" text="Izaberite objavljenu edukaciju koja će biti prikazana kao specijalna ponuda." />
              </div>
            )}

            <div className="space-y-2">
              <Label className="flex items-center gap-2" aria-describedby="help-Obim">Obim <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Obim">Pomoć za polje: Obim</TooltipContent></Tooltip></Label>
              <Select value={scope} onValueChange={(val: any) => { setScope(val); setScopeId(""); }}>
                <SelectTrigger aria-describedby="education-placement-scope-help" data-testid="placement-scope-select"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Početna (Home)</SelectItem>
                  <SelectItem value="category">Kategorija</SelectItem>
                  <SelectItem value="subcategory">Potkategorija</SelectItem>
                </SelectContent>
              </Select>
              <EducationFieldHelp id="education-placement-scope-help" label="Obim pozicije" text="Odredite na kom delu kataloga će se prikazivati sponzorisana pozicija." />
            </div>

            {scope === "category" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Izaberite-kategoriju">Izaberite kategoriju <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Izaberite-kategoriju">Pomoć za polje: Izaberite kategoriju</TooltipContent></Tooltip></Label>
                <Select value={scopeId} onValueChange={setScopeId}>
                  <SelectTrigger aria-describedby="education-placement-category-help" data-testid="placement-category-select"><SelectValue placeholder="Izaberite kategoriju..." /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <EducationFieldHelp id="education-placement-category-help" label="Kategorija pozicije" text="Izaberite kategoriju u kojoj želite da se sponzorisana pozicija prikazuje." />
              </div>
            )}

            {scope === "subcategory" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Izaberite-potkategoriju">Izaberite potkategoriju <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Izaberite-potkategoriju">Pomoć za polje: Izaberite potkategoriju</TooltipContent></Tooltip></Label>
                <Select value={scopeId} onValueChange={setScopeId}>
                  <SelectTrigger aria-describedby="education-placement-subcategory-help" data-testid="placement-subcategory-select"><SelectValue placeholder="Izaberite potkategoriju..." /></SelectTrigger>
                  <SelectContent>
                    {subcategories.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <EducationFieldHelp id="education-placement-subcategory-help" label="Potkategorija pozicije" text="Izaberite užu oblast kataloga kojoj je promocija najrelevantnija." />
              </div>
            )}

            <Button data-testid="placement-submit-btn" onClick={purchase} disabled={purchaseMut.isPending} className="w-full">Potvrdi</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {placements?.map((p: any) => (
          <Card key={p.id} data-testid="placement-card">
            <CardContent className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <Badge variant="outline" className="mb-2">{p.kind === "featured_center" ? "Centar" : "Kurs"}</Badge>
                  <h3 className="font-semibold">{p.label}</h3>
                  <p className="text-xs text-muted-foreground mt-1">Obim: {p.scope}</p>
                </div>
                <Badge variant={p.status === "active" ? "default" : "secondary"}>
                  {p.status === "pending_payment" ? "Čeka uplatu" : p.status === "expired" ? "Istekao" : p.status}
                </Badge>
              </div>
              <div className="mt-4 pt-4 border-t text-sm space-y-1">
                {p.courseId && <p className="text-muted-foreground truncate">Kurs ID: {p.courseId}</p>}
                <p>Cena: {money(p.priceSnapshot)} · {p.durationDaysSnapshot} dana</p>
                <p>Ref: <span className="font-mono text-xs">{p.paymentReference}</span></p>
                {p.status === "pending_payment" && p.paymentInstructionsAvailable && p.ipsPayload ? (
                  <div className="mt-3 space-y-2 rounded-lg border bg-white p-3 text-center text-slate-950">
                    <QRCodeSVG value={p.ipsPayload} size={160} className="mx-auto" />
                    <p className="text-xs">{p.recipientName} · {p.recipientAccount}</p>
                    <p className="text-xs">Uplata se aktivira tek nakon ručne potvrde administratora.</p>
                    <p className="text-xs font-medium">Rok za uplatu: {new Date(new Date(p.createdAt).getTime() + 24 * 60 * 60 * 1000).toLocaleString("sr-RS")}</p>
                  </div>
                ) : p.status === "pending_payment" ? <p className="mt-2 text-xs text-destructive">Ovaj istorijski zahtev nema važeća uputstva za uplatu. Kreirajte novi zahtev.</p> : null}
                {p.status === "expired" ? <p className="mt-2 text-sm text-destructive">Rok za uplatu je istekao. Za isticanje morate napraviti novi zahtev.</p> : null}
                {p.startsAt && <p className="text-xs mt-2">Trajanje: {new Date(p.startsAt).toLocaleDateString("sr-RS")} - {p.endsAt ? new Date(p.endsAt).toLocaleDateString("sr-RS") : ""}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
        {placements?.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">
            Trenutno nemate aktivnih ni istorijskih sponzorisanih pozicija.
          </div>
        )}
      </div>
    </div>
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
  const notificationMutationPending = useMutationQueueBusy(educationNotificationMutationQueue);
  const { data: inbox, isLoading } = useListEducationNotifications();
  const acceptOffer = useAcceptEducationWaitlistOffer();
  const markRead = useMarkEducationNotificationRead({
    mutation: {
      mutationKey: EDUCATION_NOTIFICATION_MUTATION_KEY,
      onMutate: async ({ notificationId }) => {
        const release = await educationNotificationMutationQueue.acquire();
        try {
          const snapshot = await updateQueryOptimistically<EducationNotificationList>(
            queryClient,
            getListEducationNotificationsQueryKey(),
            (current) => current ? {
              ...current,
              notifications: current.notifications.map((item) => item.id === notificationId
                ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
                : item),
            } : current,
          );
          return { snapshot, release };
        } catch (error) {
          release();
          throw error;
        }
      },
      onError: (_error, _variables, context) => {
        rollbackQueries(queryClient, context?.snapshot ? [context.snapshot] : undefined);
        toast.error("Obaveštenje nije ažurirano", { description: "Vraćeno je prethodno stanje. Pokušajte ponovo." });
      },
      onSettled: async (_data, _error, _variables, context) => {
        try {
          await queryClient.invalidateQueries({ queryKey: getListEducationNotificationsQueryKey() });
        } finally {
          context?.release();
        }
      },
    },
  });

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
                   if (item.readAt || educationNotificationMutationQueue.isBusy()) return;
                  markRead.mutate({ notificationId: item.id });
                }}
                role="button"
                tabIndex={0}
                aria-disabled={notificationMutationPending}
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

const ENROLLMENTS_PAGE_SIZE = 20;

function StudentLearningView({ jobseeker = false }: { jobseeker?: boolean }) {
  const [page, setPage] = useState(1);
  const { data: enrollments, isLoading, isError } = useListEnrollments({ page, pageSize: ENROLLMENTS_PAGE_SIZE });
  const hasNext = (enrollments?.length ?? 0) === ENROLLMENTS_PAGE_SIZE;
  return <div className="container mx-auto max-w-5xl px-4 py-10">
    <Badge variant="secondary" className="mb-3 gap-1.5"><GraduationCap className="h-3.5 w-3.5" /> {jobseeker ? "PROFESIONALAC" : "STUDENT"}</Badge>
    <h1 className="font-serif text-3xl font-bold">Moje edukacije</h1>
    <p className="mt-2 text-muted-foreground">Vaši kupljeni programi, napredak i sertifikati.</p>
    <StudentEducationInbox />
    {isLoading ? <div className="mt-8 grid gap-4 md:grid-cols-2">{[1, 2].map((item) => <Skeleton key={item} className="h-44 rounded-xl" />)}</div>
      : isError ? <Card className="mt-8"><CardContent className="py-10 text-center">Edukacije trenutno nisu dostupne.</CardContent></Card>
        : enrollments?.length ? <><div className="mt-8 grid gap-5 md:grid-cols-2">{enrollments.map((enrollment: any) => <Card key={enrollment.id}><CardHeader><CardTitle>{enrollment.courseTitle}</CardTitle><p className="text-sm text-muted-foreground">Napredak: {enrollment.progress}%</p></CardHeader><CardContent><Progress value={enrollment.progress} /></CardContent><CardFooter><Button className="w-full" asChild><Link href={jobseeker ? `/poslovi/nalog/edukacije/lms/${enrollment.id}` : `/student/edukacije/lms/${enrollment.id}`}>{enrollment.status === "completed" ? "Pregledaj program" : "Nastavi učenje"} <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardFooter></Card>)}</div><EnrollmentsPager page={page} hasNext={hasNext} onChange={setPage} /></>
          : page > 1 ? <Card className="mt-8"><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">Nema više edukacija.</p><Button variant="outline" className="mt-4" onClick={() => setPage((p) => Math.max(1, p - 1))}>Nazad</Button></CardContent></Card>
            : <Card className="mt-8"><CardContent className="py-14 text-center"><GraduationCap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" /><h2 className="font-serif text-xl font-semibold">Još nemate edukacija</h2><p className="mt-2 text-sm text-muted-foreground">Kada administrator potvrdi vašu kupovinu, kurs će se pojaviti ovde.</p></CardContent></Card>}
  </div>;
}

function EnrollmentsPager({ page, hasNext, onChange }: { page: number; hasNext: boolean; onChange: (updater: (prev: number) => number) => void }) {
  if (page <= 1 && !hasNext) return null;
  return (
    <div className="mt-8 flex items-center justify-center gap-3">
      <Button variant="outline" disabled={page <= 1} onClick={() => onChange((p) => Math.max(1, p - 1))}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Prethodna
      </Button>
      <span className="text-sm text-muted-foreground">Strana {page}</span>
      <Button variant="outline" disabled={!hasNext} onClick={() => onChange((p) => p + 1)}>
        Sledeća <ArrowRight className="ml-1.5 h-4 w-4" />
      </Button>
    </div>
  );
}

function EmployeeLearningView() {
  const [page, setPage] = useState(1);
  const { data: enrollments, isLoading, isError } = useListEnrollments({ page, pageSize: ENROLLMENTS_PAGE_SIZE });
  const hasNext = (enrollments?.length ?? 0) === ENROLLMENTS_PAGE_SIZE;

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
      ) : page > 1 ? (
        <Card><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">Nema više edukacija.</p><Button variant="outline" className="mt-4" onClick={() => setPage((p) => Math.max(1, p - 1))}>Nazad</Button></CardContent></Card>
      ) : (
        <Card><CardContent className="py-14 text-center"><GraduationCap className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" /><h2 className="font-serif text-xl font-semibold">Još nemate dodeljenih edukacija</h2><p className="mt-2 text-sm text-muted-foreground">Kada vas vlasnik salona upiše na kurs, pojaviće se ovde.</p></CardContent></Card>
      )}
      {!isLoading && !isError && !!enrollments?.length && <EnrollmentsPager page={page} hasNext={hasNext} onChange={setPage} />}
    </div>
  );
}

const EDUCATION_PAGE_SIZE = 24;

function CatalogView() {
  const { data: userResponse } = useGetCurrentUser();
  const user = userResponse?.user;
  const canCreate = user?.role === 'EDUKATIVNI_CENTAR';
  const isEducationCenter = user?.role === 'EDUKATIVNI_CENTAR';

  const [filters, setFilters] = useState<any>({});
  const [page, setPage] = useState(1);
  const debouncedCategory = useDebouncedSearch(filters.category ?? "");
  const debouncedCity = useDebouncedSearch(filters.city ?? "");
  const debouncedCenter = useDebouncedSearch(filters.center ?? "");
  const serverFilters = useMemo(() => ({
    ...filters,
    category: debouncedCategory || undefined,
    city: debouncedCity || undefined,
    center: debouncedCenter || undefined,
  }), [filters.format, filters.minPrice, filters.maxPrice, filters.startDate, filters.minRating, filters.certification, filters.mine, debouncedCategory, debouncedCity, debouncedCenter]);
  const { data: courses, isLoading } = useListCourses({ ...serverFilters, page, pageSize: EDUCATION_PAGE_SIZE });
  const [createOpen, setCreateOpen] = useState(false);
  const [instructorsOpen, setInstructorsOpen] = useState(false);

  const handleFilterChange = (key: string, value: any) => {
    if (key !== "category" && key !== "city" && key !== "center") setPage(1);
    setFilters((prev: any) => {
      const updated = { ...prev, [key]: value };
      if (value === undefined || value === "") delete updated[key];
      return updated;
    });
  };
  useEffect(() => setPage(1), [debouncedCategory, debouncedCity, debouncedCenter]);
  // Bare-array response: a full page implies another page may exist.
  const hasNextPage = (courses?.length ?? 0) === EDUCATION_PAGE_SIZE;

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
                <Label className="flex items-center gap-2" aria-describedby="help-Kategorija">Kategorija <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Kategorija">Uža kategorija edukacije</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-filter-category-help" placeholder="Npr. Manikir, Masaža..." value={filters.category || ""} onChange={e => handleFilterChange("category", e.target.value)} />
                <EducationFieldHelp id="education-filter-category-help" label="Kategorija pretrage" text="Unesite oblast edukacije koju tražite, na primer manikir, masaža ili šminkanje." />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Format-nastave">Format nastave <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Format-nastave">Pomoć za polje: Format nastave</TooltipContent></Tooltip></Label>
                <Select value={filters.format || ""} onValueChange={v => handleFilterChange("format", v === "all" ? undefined : v)}>
                  <SelectTrigger aria-describedby="education-filter-format-help"><SelectValue placeholder="Svi formati" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Svi formati</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="in-person">Uživo</SelectItem>
                    <SelectItem value="hybrid">Hibridno</SelectItem>
                  </SelectContent>
                </Select>
                <EducationFieldHelp id="education-filter-format-help" label="Format nastave" text="Ograničite rezultate na onlajn, nastavu uživo ili hibridne edukacije." />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Grad">Grad <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Grad">Grad u kom se održava edukacija</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-filter-city-help" placeholder="Npr. Beograd" value={filters.city || ""} onChange={e => handleFilterChange("city", e.target.value)} />
                <EducationFieldHelp id="education-filter-city-help" label="Grad pretrage" text="Unesite grad u kojem želite da pohađate edukaciju uživo." />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Edukativni-centar">Edukativni centar <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Edukativni-centar">Pomoć za polje: Edukativni centar</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-filter-center-help" placeholder="Naziv organizatora" value={filters.center || ""} onChange={e => handleFilterChange("center", e.target.value)} />
                <EducationFieldHelp id="education-filter-center-help" label="Edukativni centar" text="Unesite naziv organizatora čije edukacije želite da pronađete." />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Raspon-cene-(RSD)">Raspon cene (RSD) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Raspon-cene-(RSD)">Pomoć za polje: Raspon cene (RSD)</TooltipContent></Tooltip></Label>
                <div className="flex items-center gap-2">
                  <Input aria-describedby="education-filter-min-price-help" type="number" placeholder="Od" min="0" value={filters.minPrice || ""} onChange={e => handleFilterChange("minPrice", e.target.value ? Number(e.target.value) : undefined)} />
                  <EducationFieldHelp id="education-filter-min-price-help" label="Minimalna cena" text="Unesite najnižu cenu edukacije koju želite da vidite, u dinarima." />
                  <span className="text-muted-foreground">-</span>
                  <Input aria-describedby="education-filter-max-price-help" type="number" placeholder="Do" min="0" value={filters.maxPrice || ""} onChange={e => handleFilterChange("maxPrice", e.target.value ? Number(e.target.value) : undefined)} />
                  <EducationFieldHelp id="education-filter-max-price-help" label="Maksimalna cena" text="Unesite najvišu cenu edukacije koju želite da vidite, u dinarima." />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Početak-nakon">Početak nakon <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Početak-nakon">Pomoć za polje: Početak nakon</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-filter-start-date-help" type="date" value={filters.startDate ?? ""} onChange={e => handleFilterChange("startDate", e.target.value || undefined)} />
                <EducationFieldHelp id="education-filter-start-date-help" label="Početak nakon" text="Prikažite samo edukacije čiji prvi termin počinje na ovaj datum ili kasnije." />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Minimalna-ocena">Minimalna ocena <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Minimalna-ocena">Pomoć za polje: Minimalna ocena</TooltipContent></Tooltip></Label>
                <Select value={filters.minRating?.toString() || ""} onValueChange={v => handleFilterChange("minRating", v ? Number(v) : undefined)}>
                  <SelectTrigger aria-describedby="education-filter-rating-help"><SelectValue placeholder="Bilo koja ocena" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Bilo koja ocena</SelectItem>
                    <SelectItem value="3">3+ Zvezdice</SelectItem>
                    <SelectItem value="4">4+ Zvezdice</SelectItem>
                    <SelectItem value="4.5">4.5+ Zvezdice</SelectItem>
                  </SelectContent>
                </Select>
                <EducationFieldHelp id="education-filter-rating-help" label="Minimalna ocena" text="Izaberite najnižu prosečnu ocenu koju edukacija mora da ima." />
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
              {user?.role === "SALON_OWNER" && (
                <Button variant="outline" asChild>
                  <Link href="/vlasnik/edukacije" data-testid="link-owner-employee-enrollments">Moje prijave zaposlenih</Link>
                </Button>
              )}
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
                        <OptimizedImage src={course.imageUrl} alt={course.title} width={800} height={450} responsiveSizes="(max-width: 768px) 100vw, 420px" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out" />
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
                <Button variant="outline" className="mt-6" onClick={() => { setPage(1); setFilters({}); }}>Poništi sve filtere</Button>
              )}
            </div>
          )}
          {!isLoading && (page > 1 || hasNextPage) && (
            <div className="flex items-center justify-between gap-4 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ArrowLeft className="w-4 h-4 mr-1.5" /> Prethodna
              </Button>
              <span className="text-sm text-muted-foreground">Strana {page}</span>
              <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage((current) => current + 1)}>
                Sledeća <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
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
  const { data: userResponse } = useGetCurrentUser();
  const user = userResponse?.user;
  const canCreate = user?.role === 'EDUKATIVNI_CENTAR';
  const isSalonOperator = user?.role === "SALON_OWNER" || user?.role === "SALON_EMPLOYEE";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: course, isLoading, isError } = useGetEducationCourse(courseId);
  const { data: myCourses } = useListCourses({ mine: true }, { query: { enabled: canCreate, queryKey: getListCoursesQueryKey({ mine: true }) } });

  const isMyCourse = useMemo(() => {
    return myCourses?.some((c: any) => c.id === courseId) ?? false;
  }, [myCourses, courseId]);

  const isEducationCenter = user?.role === "EDUKATIVNI_CENTAR";
  const isSalonOwner = user?.role === "SALON_OWNER";
  const isSalonEmployee = user?.role === "SALON_EMPLOYEE";

  const { data: enrollments } = useListEnrollments(undefined, { query: { enabled: !!course?.enrollmentStatus, queryKey: getListEnrollmentsQueryKey() } });
  const { data: ownerEmployees } = useListSalonEmployees({
    query: {
      enabled: isSalonOwner,
      queryKey: getListSalonEmployeesQueryKey(),
    },
  });
  const { data: employeeShiftSwaps } = useListEmployeeShiftSwaps({
    query: {
      enabled: isSalonEmployee,
      queryKey: getListEmployeeShiftSwapsQueryKey(),
    },
  });
  const employees = isSalonEmployee ? employeeShiftSwaps?.colleagues : ownerEmployees;
  const { data: instructors } = useListEducationInstructors({
    query: { enabled: isMyCourse && isEducationCenter, queryKey: getListEducationInstructorsQueryKey() },
  });
  const { data: featuredStatus, refetch: refetchFeatured } = useGetEducationCourseFeaturedStatus(courseId, {
    query: { enabled: isMyCourse, queryKey: getGetEducationCourseFeaturedStatusQueryKey(courseId) },
  });
  const myEnrollment = enrollments?.find((e: any) => e.courseId === courseId);
  const pendingCourseEnrollmentIds = useMemo(
    () => enrollments
      ?.filter((enrollment: any) => enrollment.courseId === courseId && enrollment.status === "pending" && enrollment.paymentStatus === "pending")
      .map((enrollment: any) => enrollment.id) ?? [],
    [courseId, enrollments],
  );

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
  const [groupDigitalContentConsent, setGroupDigitalContentConsent] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [digitalContentConsent, setDigitalContentConsent] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"online_full" | "live_deposit" | "live_off_platform">("online_full");
  const [createdEnrollmentId, setCreatedEnrollmentId] = useState<string | null>(null);
  const [groupPaymentInstructions, setGroupPaymentInstructions] = useState<EducationEnrollmentPaymentInstructions[]>([]);
  const enrollmentIdempotencyKey = useMemo(
    () => crypto.randomUUID(),
    [courseId, learnerId, sessionId, paymentMode],
  );
  const enroll = useEnrollInEducationCourse({
    request: { headers: { "Idempotency-Key": enrollmentIdempotencyKey } },
  });
  const pendingEnrollmentId = createdEnrollmentId
    ?? (isSalonOwner && pendingCourseEnrollmentIds.length === 1 ? pendingCourseEnrollmentIds[0] : null);
  const { data: paymentInstructions, isLoading: paymentInstructionsLoading, isError: paymentInstructionsError } = useGetEducationEnrollmentPaymentInstructions(
    pendingEnrollmentId ?? "",
    { query: { enabled: Boolean(pendingEnrollmentId), queryKey: getGetEducationEnrollmentPaymentInstructionsQueryKey(pendingEnrollmentId ?? "") } },
  );

  useEffect(() => {
    if (course) setPriceEdit(String(course.price));
  }, [course?.id, course?.price]);
  useEffect(() => {
    if (course?.paymentMode) setPaymentMode(course.paymentMode);
    setSessionId("");
    setDigitalContentConsent(false);
    setGroupDigitalContentConsent(false);
    setCreatedEnrollmentId(null);
    setGroupPaymentInstructions([]);
  }, [course?.id, course?.paymentMode]);
  useEffect(() => {
    if (!isSalonOwner || pendingCourseEnrollmentIds.length < 2) return;
    let cancelled = false;
    void Promise.allSettled(
      pendingCourseEnrollmentIds.map((enrollmentId) => getEducationEnrollmentPaymentInstructions(enrollmentId)),
    ).then((results) => {
      if (cancelled) return;
      setGroupPaymentInstructions(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    });
    return () => { cancelled = true; };
  }, [isSalonOwner, pendingCourseEnrollmentIds.join(":")]);

  const handleEnroll = () => {
    if (isSalonOwner && !learnerId) {
      toast.error("Izaberite jednog zaposlenog pre slanja prijave.");
      return;
    }
    if (course?.format === "online" && !digitalContentConsent) {
      toast.error("Potvrdite saglasnost za digitalni sadržaj pre slanja prijave.");
      return;
    }
    enroll.mutate({ courseId, data: {
      employeeId: learnerId || null,
      sessionId: sessionId || null,
      paymentMode,
      ...(course?.format === "online" ? { digitalContentConsent } : {}),
    } }, {
      onSuccess: (res: any) => {
        setCreatedEnrollmentId(res.id);
        setDigitalContentConsent(false);
        toast.success("Zahtev za upis je primljen. Pratite instrukcije za uplatu.");
        queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
        queryClient.invalidateQueries({ queryKey: getListEnrollmentsQueryKey() });
      },
      onError: (error) => toast.error("Greška pri rezervaciji", { description: getApiErrorMessage(error, "Proverite izabrani termin i zaposlenog.") })
    });
  };

  const handleGroupEnroll = async () => {
    if (groupSelectedIds.length === 0) { toast.error("Izaberite bar jednog zaposlenog."); return; }
    if (course?.format === "online" && !groupDigitalContentConsent) {
      toast.error("Potvrdite saglasnost za digitalni sadržaj pre grupne prijave.");
      return;
    }
    setGroupEnrolling(true);
    try {
      const data = await createEducationGroupEnrollments(courseId, {
        employeeIds: groupSelectedIds,
        ...(groupSessionId ? { sessionId: groupSessionId } : {}),
        ...(course?.format === "online" ? { digitalContentConsent: groupDigitalContentConsent } : {}),
      }, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const discountMsg = data.discountPercent > 0
        ? ` Primenjen je popust od ${data.discountPercent}%. Cena po polazniku: ${data.unitPrice.toLocaleString("sr-RS")} RSD.`
        : "";
      setGroupPaymentInstructions(data.paymentInstructions);
      toast.success(`Grupna prijava za ${data.enrollments.length} polaznika je primljena.${discountMsg}`);
      queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(courseId) });
      queryClient.invalidateQueries({ queryKey: getListEnrollmentsQueryKey() });
      setGroupMode(false);
      setGroupSelectedIds([]);
      setGroupDigitalContentConsent(false);
    } catch (err) {
      toast.error("Grupna prijava nije uspela", { description: getApiErrorMessage(err, "Proverite izabrane polaznike i uslove kursa.") });
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
                <OptimizedImage src={course.imageUrl} alt={course.title} width={1200} height={675} priority responsiveSizes="(max-width: 768px) 100vw, 720px" className="w-full h-full object-cover" />
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
                      <Input aria-label="Cena edukacije" aria-describedby="education-edit-price-help" type="number" min="0" value={priceEdit} onChange={(event) => setPriceEdit(event.target.value)} />
                      <EducationFieldHelp id="education-edit-price-help" label="Cena edukacije" text="Unesite novu redovnu cenu edukacije u dinarima, bez negativnih vrednosti." />
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
                          <SelectTrigger aria-describedby="education-course-instructor-help" className="h-8 text-xs"><SelectValue placeholder="Bez instruktora" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Bez instruktora</SelectItem>
                            {instructors.map((inst) => <SelectItem key={inst.id} value={inst.id}>{inst.fullName}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <EducationFieldHelp id="education-course-instructor-help" label="Instruktor kursa" text="Povežite edukaciju sa instruktorom koji će biti prikazan polaznicima." />
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
                    {/* Group enrollment is available to every salon operator with employees. */}
                    {isSalonOperator && employees && employees.length >= 2 && (course.groupDiscountMinimum ?? 0) > 0 && !groupMode && (
                      <Button variant="outline" className="w-full gap-2" onClick={() => setGroupMode(true)}>
                        <Users className="w-4 h-4" /> Grupna prijava ({employees.length} zaposlenih)
                      </Button>
                    )}

                    {groupMode ? (
                      <div className="space-y-3 border rounded-lg p-4 bg-muted/10">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm">Izaberite polaznike</h4>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setGroupMode(false); setGroupSelectedIds([]); setGroupDigitalContentConsent(false); }}>Odustani</Button>
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
                            <div key={emp.id} className="flex items-center gap-2 rounded p-2 hover:bg-muted/40">
                              <Checkbox checked={groupSelectedIds.includes(emp.id)} onCheckedChange={() => toggleGroupEmployee(emp.id)} id={`emp-${emp.id}`} />
                              <label htmlFor={`emp-${emp.id}`} className="text-sm cursor-pointer flex-1">{emp.name}</label>
                            </div>
                          ))}
                        </div>
                        {(course.format === "in-person" || course.format === "hybrid") && course.sessions?.length > 0 && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">Termin (opciono)</Label>
                            <Select value={groupSessionId || "auto"} onValueChange={(v) => setGroupSessionId(v === "auto" ? "" : v)}>
                              <SelectTrigger aria-describedby="education-group-session-help" className="h-8 text-xs"><SelectValue placeholder="Automatski" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">Automatski</SelectItem>
                                {course.sessions.filter((s: any) => s.availableSeats > 0).map((s: any) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {new Date(s.startsAt).toLocaleDateString("sr-RS")} — {s.availableSeats} mesta
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <EducationFieldHelp id="education-group-session-help" label="Termin grupne prijave" text="Izaberite isti raspoloživ termin za sve označene polaznike ili prepustite automatski izbor." />
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {groupSelectedIds.length} odabrano
                          {groupSelectedIds.length >= (course.groupDiscountMinimum ?? 999) && (
                            <span className="text-emerald-600 font-medium"> · Cena po polazniku: {Math.round(course.price * (1 - (course.groupDiscountPercent ?? 0) / 100)).toLocaleString("sr-RS")} RSD</span>
                          )}
                        </div>
                        {course.format === "online" && (
                          <div className="min-w-0 rounded-lg border bg-background p-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <Checkbox
                                id="education-group-digital-consent"
                                aria-describedby="education-group-digital-consent-help"
                                checked={groupDigitalContentConsent}
                                onCheckedChange={(checked) => setGroupDigitalContentConsent(checked === true)}
                              />
                              <Label htmlFor="education-group-digital-consent" className="min-w-0 cursor-pointer text-sm leading-relaxed [overflow-wrap:anywhere]">
                                {DIGITAL_CONTENT_CONSENT_TEXT}
                              </Label>
                            </div>
                            <EducationFieldHelp id="education-group-digital-consent-help" label="Saglasnost za digitalni sadržaj" text="Jedna potvrda kupca čuva se kao zaseban dokaz uz prijavu svakog označenog polaznika." />
                          </div>
                        )}
                        <Button className="w-full" onClick={() => void handleGroupEnroll()} disabled={groupEnrolling || groupSelectedIds.length === 0 || (course.format === "online" && !groupDigitalContentConsent)}>
                          {groupEnrolling ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Prijavljujem...</> : `Prijavi ${groupSelectedIds.length} polaznika`}
                        </Button>
                      </div>
                    ) : (
                      <>
                        {groupPaymentInstructions.length > 0 && (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20" data-testid="group-payment-instructions">
                            <p className="font-semibold text-amber-900 dark:text-amber-200">IPS instrukcije za grupnu prijavu</p>
                            <p className="mt-1 text-xs text-amber-950 dark:text-amber-100">
                              Ukupno: {groupPaymentInstructions.reduce((sum, item) => sum + item.amount, 0).toLocaleString("sr-RS")} RSD. Uplatite svaku obavezu zasebno uz njen poziv na broj.
                            </p>
                            <div className="mt-3 space-y-3">
                              {groupPaymentInstructions.map((instructions, index) => (
                                <div key={instructions.enrollmentId} className="rounded-md border border-amber-200 bg-white/70 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-background/50 dark:text-amber-100">
                                  <p className="font-semibold">Prijava {index + 1}</p>
                                  <p><strong>Iznos:</strong> {instructions.amount.toLocaleString("sr-RS")} {instructions.currency}</p>
                                  <p className="[overflow-wrap:anywhere]"><strong>Poziv na broj:</strong> {instructions.reference}</p>
                                  <p><strong>Račun:</strong> {instructions.recipientAccount}</p>
                                  <QRCodeSVG value={instructions.payload} size={104} className="mt-2 rounded bg-white p-1" />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {isSalonOperator && employees?.length ? (
                          <div className="space-y-1.5">
                            <Label htmlFor="education-learner">Polaznik</Label>
                            <Select
                              value={isSalonOwner ? learnerId : learnerId || "self"}
                              onValueChange={(value) => {
                                setLearnerId(value === "self" ? "" : value);
                                setDigitalContentConsent(false);
                              }}
                            >
                              <SelectTrigger id="education-learner" aria-describedby="education-learner-help"><SelectValue placeholder="Izaberite polaznika" /></SelectTrigger>
                              <SelectContent>
                                {!isSalonOwner && <SelectItem value="self">Ja lično</SelectItem>}
                                {employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <EducationFieldHelp id="education-learner-help" label="Polaznik" text="Izaberite zaposlenog za kog rezervišete mesto na edukaciji." />
                            <p className="text-xs text-muted-foreground">{isSalonOwner ? "Vlasnik salona kupuje mesto za tačno jednog zaposlenog." : "Izabrani zaposleni koristi svoj poslovni nalog za Sistem za učenje; vlasnik u ovom prostoru prati prijavu i napredak tima."}</p>
                          </div>
                        ) : null}
                        {(course.format === "in-person" || course.format === "hybrid") && course.sessions?.length > 0 && (
                          <div className="space-y-1.5">
                            <Label htmlFor="education-session">Termin</Label>
                            <Select value={sessionId || "auto"} onValueChange={(value) => setSessionId(value === "auto" ? "" : value)}>
                              <SelectTrigger id="education-session" aria-describedby="education-enrollment-session-help" data-testid="select-enrollment-session"><SelectValue placeholder="Automatski prvi slobodan termin" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">Automatski prvi slobodan termin</SelectItem>
                                {course.sessions.filter((session: any) => session.availableSeats > 0).map((session: any) => (
                                  <SelectItem key={session.id} value={session.id}>{new Date(session.startsAt).toLocaleDateString("sr-RS")} · {session.availableSeats} mesta</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <EducationFieldHelp id="education-enrollment-session-help" label="Termin prijave" text="Izaberite željeni raspoloživ termin ili dozvolite sistemu da dodeli prvi slobodan." />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label htmlFor="education-payment-mode">Način plaćanja</Label>
                          <Select value={paymentMode} onValueChange={(value) => setPaymentMode(value as typeof paymentMode)}>
                            <SelectTrigger id="education-payment-mode" aria-describedby="education-enrollment-payment-help" data-testid="select-enrollment-payment-mode"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {course.paymentMode === "online_full" && <SelectItem value="online_full">Puna uplata putem IPS-a</SelectItem>}
                              {course.paymentMode === "live_deposit" && <SelectItem value="live_deposit">Depozit putem IPS-a</SelectItem>}
                              {course.paymentMode === "live_off_platform" && <SelectItem value="live_off_platform">Plaćanje direktno organizatoru</SelectItem>}
                            </SelectContent>
                          </Select>
                          <EducationFieldHelp id="education-enrollment-payment-help" label="Način plaćanja prijave" text="Proverite način plaćanja koji je organizator omogućio za ovu edukaciju." />
                        </div>
                        {course.format === "online" && (
                          <div className="min-w-0 rounded-lg border p-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <Checkbox
                                id="education-enrollment-digital-consent"
                                aria-describedby="education-enrollment-digital-consent-help"
                                checked={digitalContentConsent}
                                onCheckedChange={(checked) => setDigitalContentConsent(checked === true)}
                              />
                              <Label htmlFor="education-enrollment-digital-consent" className="min-w-0 cursor-pointer text-sm leading-relaxed [overflow-wrap:anywhere]">
                                {DIGITAL_CONTENT_CONSENT_TEXT}
                              </Label>
                            </div>
                            <EducationFieldHelp id="education-enrollment-digital-consent-help" label="Saglasnost za digitalni sadržaj" text="Potvrda je obavezna samo za online kurs i čuva se kao dokaz uz ovu prijavu." />
                          </div>
                        )}
                        <Button data-testid="button-submit-employee-enrollment" className="w-full text-base h-12 shadow-md hover:shadow-lg transition-shadow" size="lg" onClick={handleEnroll} disabled={enroll.isPending || (isSalonOwner && !learnerId) || (course.format === "online" && !digitalContentConsent)}>
                          {enroll.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rezervacija...</> : 'Rezerviši mesto'}
                        </Button>
                        {pendingEnrollmentId && (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20" data-testid="status-enrollment-payment-pending">
                            <p className="font-semibold text-amber-900 dark:text-amber-200">Prijava čeka ručnu potvrdu uplate</p>
                            {paymentInstructionsLoading && <p className="mt-1 text-muted-foreground">Učitavam IPS instrukcije…</p>}
                            {paymentInstructions && (
                              <div className="mt-2 space-y-1 text-xs text-amber-950 dark:text-amber-100">
                                <p><strong>Iznos:</strong> {paymentInstructions.amount.toLocaleString("sr-RS")} {paymentInstructions.currency}</p>
                                <p><strong>Primalac:</strong> {paymentInstructions.recipientName}</p>
                                <p><strong>Račun:</strong> {paymentInstructions.recipientAccount}</p>
                                <p><strong>Poziv na broj:</strong> {paymentInstructions.reference}</p>
                                <QRCodeSVG value={paymentInstructions.payload} size={112} className="mt-2 rounded bg-white p-1" />
                                <p className="pt-1 font-medium">{paymentInstructions.settlementNotice}</p>
                              </div>
                            )}
                            {paymentInstructionsError && (
                              <p className="mt-1 text-xs text-destructive" data-testid="text-payment-instructions-error">
                                {getApiErrorMessage(paymentInstructionsError, "IPS instrukcije trenutno nisu dostupne. Pokušajte ponovo ili kontaktirajte podršku.")}
                              </p>
                            )}
                          </div>
                        )}
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
  return getApiErrorMessage(error, "Pokušajte ponovo sa drugom slikom.");
}

function CourseGalleryEditor({ courseId, gallery: initialGallery }: { courseId: string; gallery: CourseGalleryItem[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [gallery, setGallery] = useState<CourseGalleryItem[]>(initialGallery);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
    const supported = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!supported.includes(file.type.toLowerCase()) || file.size > 12 * 1024 * 1024) {
      const message = "Izaberite JPG, PNG, WEBP ili AVIF sliku do 12 MB.";
      setUploadError(message);
      toast.error("Neispravna slika", { description: message });
      return;
    }
    setUploading(true);
    try {
      const upload = await uploadOptimizedImage(file, "education-gallery", courseId);
      const media = await addMedia.mutateAsync({ courseId, data: { mediaId: upload.id, altText: "" } });
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
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" disabled={uploading || gallery.length >= 20}>
            <label className="cursor-pointer">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              {uploading ? "Otpremanje..." : "Dodaj fotografiju"}
              <input
                aria-label="Dodaj fotografiju u galeriju"
                aria-describedby="education-gallery-upload-help"
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                disabled={uploading || gallery.length >= 20}
                onChange={(event) => void uploadImage(event)}
              />
            </label>
          </Button>
          <EducationFieldHelp id="education-gallery-upload-help" label="Fotografija galerije" text="Otpremite JPG, PNG, WebP ili AVIF fotografiju koja verno prikazuje edukaciju." />
        </div>
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
               <OptimizedImage src={media.url} alt={media.altText || `Fotografija ${index + 1} kursa`} width={640} height={360} preferredSize="medium" responsiveSizes="(max-width: 640px) 100vw, 320px" className="h-40 w-full object-cover" />
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
                    aria-describedby={`education-gallery-alt-help-${media.id}`}
                    value={media.altText}
                    maxLength={240}
                    placeholder="Npr. Praktični rad na radionici"
                    onChange={(event) => setGallery((current) => current.map((item) => item.id === media.id ? { ...item, altText: event.target.value } : item))}
                    onBlur={(event) => updateAltText(media.id, event.target.value)}
                    disabled={reorder.isPending}
                  />
                  <EducationFieldHelp id={`education-gallery-alt-help-${media.id}`} label={`Opis fotografije ${index + 1}`} text="Ukratko opišite sadržaj fotografije radi pristupačnosti i boljeg razumevanja galerije." />
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
        <div><Input aria-label={`Dan ${index + 1}`} aria-describedby={`education-program-day-number-help-${index}`} type="number" min="1" value={day.dayNumber} onChange={(event) => updateDay(index, "dayNumber", event.target.value)} /><EducationFieldHelp id={`education-program-day-number-help-${index}`} label={`Redni broj dana ${index + 1}`} text="Unesite redni broj dana kojim određujete poredak u javnom programu." /></div>
        <div><Input aria-label={`Naslov dana ${index + 1}`} aria-describedby={`education-program-day-title-help-${index}`} placeholder="Naslov dana" value={day.title} onChange={(event) => updateDay(index, "title", event.target.value)} /><EducationFieldHelp id={`education-program-day-title-help-${index}`} label={`Naslov dana ${index + 1}`} text="Navedite jasan naziv teme ili celine koja se obrađuje tog dana." /></div>
        <div><Input aria-label={`Opis dana ${index + 1}`} aria-describedby={`education-program-day-description-help-${index}`} placeholder="Kratak opis" value={day.description} onChange={(event) => updateDay(index, "description", event.target.value)} /><EducationFieldHelp id={`education-program-day-description-help-${index}`} label={`Opis dana ${index + 1}`} text="Sažeto objasnite šta će polaznici raditi i naučiti tog dana." /></div>
        <div><Input aria-label={`Trajanje dana ${index + 1}`} aria-describedby={`education-program-day-duration-help-${index}`} type="number" min="0" placeholder="min" value={day.durationMinutes} onChange={(event) => updateDay(index, "durationMinutes", event.target.value)} /><EducationFieldHelp id={`education-program-day-duration-help-${index}`} label={`Trajanje dana ${index + 1}`} text="Unesite planirano trajanje programa tog dana u minutima." /></div>
      </div>)}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setDays((current) => [...current, { dayNumber: current.length + 1, title: "", description: "", durationMinutes: "" }])}><Plus className="mr-2 h-4 w-4" /> Dodaj dan</Button><Button type="button" onClick={save} disabled={replaceProgram.isPending}>{replaceProgram.isPending ? "Čuvanje..." : "Sačuvaj dnevni program"}</Button></div>
    </CardContent>
  </Card>;
}

function LmsView({ enrollmentId }: { enrollmentId: string }) {
  const { data: userResponse } = useGetCurrentUser();
  const { data: lms, isLoading, isError } = useGetEducationLms(enrollmentId, {
    query: { queryKey: getGetEducationLmsQueryKey(enrollmentId), retry: false },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const complete = useCompleteEducationLesson();
  const createExtension = useCreateEducationEnrollmentExtension();
  const [pendingExtension, setPendingExtension] = useState<any>(null);
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

  const activeLesson = useMemo(() => {
    if (!lms) return null;
    for (const mod of lms.course.modules) {
      const lesson = mod.lessons.find((l: any) => l.id === activeLessonId);
      if (lesson) return lesson;
    }
    return null;
  }, [lms, activeLessonId]);

  if (isLoading) return <div className="flex h-[80vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (isError || !lms) return <div className="flex h-[80vh] items-center justify-center flex-col px-4 text-center">
    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4 text-muted-foreground"><Monitor className="w-8 h-8" /></div>
    <h2 className="text-2xl font-bold mb-2">Nemate pristup ovoj edukaciji</h2>
    <p className="text-muted-foreground mb-6">Pristup nije aktivan, istekao je ili je prebačen drugom polazniku.</p>
    <Button asChild><Link href="/biznis/edukacije">Nazad na katalog</Link></Button>
  </div>;

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
      toast.error("Kalendarski fajl nije preuzet", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setIcsDownloading(false);
    }
  };

  const isCompleted = lms.enrollment.status === "completed";
  const isPaid = lms.enrollment.paymentStatus === "paid";
  const extensionPrices = lms.enrollment.extensionPricesSnapshot as {
    oneMonth: number;
    threeMonths: number;
    sixMonths: number;
  } | null | undefined;
  const hasCertification = (lms.course as any).certification as boolean;
  // Sessions are live for in-person/hybrid courses that have at least one session.
  // The ICS endpoint needs a sessionId on the enrollment — if sessions exist, the button
  // is shown and the server validates whether this specific enrollment has one.
  const hasSession = (lms.course as any).format !== "online" && Array.isArray((lms.course as any).sessions) && ((lms.course as any).sessions as unknown[]).length > 0;

  return (
    <div className="flex flex-col md:flex-row min-h-[100dvh]">
      <div className="w-full md:w-80 shrink-0 border-r border-border bg-sidebar flex flex-col md:h-[100dvh] md:sticky md:top-0">
        <div className="p-5 border-b bg-sidebar shadow-sm z-10 relative">
          <Link href={userResponse?.user?.role === "STUDENT" ? "/student/edukacije" : userResponse?.user?.role === "JOBSEEKER" ? "/poslovi/nalog/edukacije" : `/biznis/edukacije/${lms.course.id}`} className="text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground flex items-center mb-5 transition-colors">
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
          {lms.enrollment.accessExpiresAt && extensionPrices && (
            <div className="mt-4 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3">
              <p className="text-xs font-semibold text-sidebar-foreground">
                Pristup do {new Date(lms.enrollment.accessExpiresAt).toLocaleDateString("sr-RS")}
              </p>
              <p className="mt-1 text-xs text-sidebar-foreground/70">
                Produženje se aktivira tek posle potvrde uplate.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                {([
                  { months: 1 as const, key: "oneMonth" as const, label: "1 mesec" },
                  { months: 3 as const, key: "threeMonths" as const, label: "3 meseca" },
                  { months: 6 as const, key: "sixMonths" as const, label: "6 meseci" },
                ]).map((option) => (
                  <Button
                    key={option.months}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-w-0 flex-col gap-0.5 px-1 py-2 text-[11px]"
                    disabled={createExtension.isPending}
                    onClick={() => createExtension.mutate(
                      { enrollmentId, data: { months: option.months } },
                      {
                        onSuccess: (result) => {
                          setPendingExtension(result);
                          queryClient.invalidateQueries({ queryKey: getGetEducationLmsQueryKey(enrollmentId) });
                          queryClient.invalidateQueries({ queryKey: getListEnrollmentsQueryKey() });
                          toast.success("Zahtev za produženje je kreiran");
                        },
                        onError: (error) => toast.error("Produženje nije kreirano", {
                          description: getApiErrorMessage(error, "Pokušajte ponovo."),
                        }),
                      },
                    )}
                  >
                    <span>{option.label}</span>
                    <span>{money(extensionPrices[option.key])}</span>
                  </Button>
                ))}
              </div>
              {pendingExtension && (
                <div className="mt-3 rounded-md bg-background/70 p-2 text-xs text-sidebar-foreground">
                  <p className="font-medium">Uplata na čekanju</p>
                  <p>Iznos: {money(pendingExtension.payment.expectedAmount)}</p>
                  <p className="break-all">Poziv na broj: {pendingExtension.payment.referenceSnapshot}</p>
                </div>
              )}
            </div>
          )}
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
                  Izvezi termin u kalendar
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
  const proposeMut = useProposeEducationCourseType();
  const proposeType = () => {
    if (!watchSubcategoryId) { toast.error("Izaberite potkategoriju prvo."); return; }
    const name = window.prompt("Unesite naziv novog tipa obuke:");
    if (!name) return;
    proposeMut.mutate({ data: { subcategoryId: watchSubcategoryId, name } } as any, {
      onSuccess: () => toast.success("Predlog je poslat na odobrenje."),
      onError: (e: any) => { toast.error("Greška", { description: e.message }); }
    });
  };
  const create = useCreateEducationCourse();
  const update = useUpdateEducationCourse();
  const [uploadingCover, setUploadingCover] = useState(false);

  const { data: taxonomy } = useGetPublicEducationTaxonomy();

  const DEFAULT_REFUND_POLICY = "Povraćaj je moguć do isteka roka zaštite kupovine. Ako centar otkaže termin, kupovina se refundira u celosti.";
  const { register, handleSubmit, control, formState: { errors }, reset, setValue, watch } = useForm<any>({
    resolver: zodResolver(courseSchema) as any,
    defaultValues: { format: 'online', level: 'all-levels', certification: false, price: 0, imageUrl: DEFAULT_COURSE_IMAGE, refundPolicy: DEFAULT_REFUND_POLICY, paymentMode: 'online_full', subcategoryId: '', courseTypeId: '', groupDiscountMinimum: "", groupDiscountPercent: "", learningOutcomesText: "", includedItemsText: "", requirements: "", durationMinutes: "", giftVoucherEligible: false, schedulingMode: "fixed_group", cancellationCutoffHours: 0, depositDisposition: "refund", installmentCount: 1, earlyBirdPrice: "", earlyBirdCutoff: "", minimumEnrollmentRiskDeadline: "" }
  });
  const coverImageUrl = watch("imageUrl");
  const watchFormat = watch("format");
  const watchPaymentMode = watch("paymentMode");
  const watchSectionId = watch("sectionId");
  const watchCategoryId = watch("categoryId");
  const watchSubcategoryId = watch("subcategoryId");

  // Options cascading
  const sections = taxonomy || [];
  const categories = useMemo(() => sections.find((s: any) => s.id === watchSectionId)?.categories || [], [sections, watchSectionId]);
  const subcategories = useMemo(() => categories.find((c: any) => c.id === watchCategoryId)?.subcategories || [], [categories, watchCategoryId]);
  const courseTypes = useMemo(() => subcategories.find((s: any) => s.id === watchSubcategoryId)?.courseTypes || [], [subcategories, watchSubcategoryId]);

  const uploadCover = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const asset = await uploadOptimizedImage(file, "education-cover", course?.id);
      setValue("imageUrl", asset.imageUrl, { shouldValidate: true, shouldDirty: true });
      toast.success("Naslovna fotografija je obrađena.");
    } catch (error) {
      toast.error("Greška", { description: "Slanje slike nije uspelo." });
    } finally {
      setUploadingCover(false);
    }
  };

  useEffect(() => {
    if (open) {
      if (course) {
        // Hydrate taxonomy parents based on subcategoryId
        let foundSectionId = "";
        let foundCategoryId = "";
        let foundSubcat = false;
        for (const s of (taxonomy || [])) {
          for (const c of s.categories) {
            for (const sub of c.subcategories) {
              if (sub.id === course.subcategoryId) {
                foundSectionId = s.id;
                foundCategoryId = c.id;
                foundSubcat = true;
                break;
              }
            }
            if (foundSubcat) break;
          }
          if (foundSubcat) break;
        }

        reset({
          title: course.title,
          description: course.description,
          sectionId: foundSectionId,
          categoryId: foundCategoryId,
          subcategoryId: course.subcategoryId,
          courseTypeId: course.courseTypeId,
          format: course.format,
          city: course.city || "",
          price: course.price,
          duration: course.duration,
          level: course.level || "all-levels",
          learningOutcomesText: course.learningOutcomes?.join("\n") || "",
          includedItemsText: course.includedItems?.join("\n") || "",
          requirements: course.requirements || "",
          certification: course.certification,
          certificateName: course.certificateName || "",
          accredited: course.accredited || false,
          category: course.category || "",
          faqText: course.faq?.map((f: any) => `P: ${f.question}\nO: ${f.answer}`).join("\n\n") || "",
          theoryHours: course.theoryHours || "",
          practicalHours: course.practicalHours || "",
          language: course.language || "",
          trailerUrl: course.trailerUrl || "",
          tagsText: course.tags?.join(", ") || "",
          imageUrl: course.imageUrl || DEFAULT_COURSE_IMAGE,
          startDate: course.startDate ? new Date(course.startDate).toISOString().split('T')[0] : "",
          refundPolicy: course.refundPolicy || DEFAULT_REFUND_POLICY,
          paymentMode: course.paymentMode || "online_full",
          depositAmount: course.depositAmount || "",
          groupDiscountMinimum: course.groupDiscountMinimum || "",
          groupDiscountPercent: course.groupDiscountPercent || "",
          durationMinutes: course.durationMinutes || "",
          giftVoucherEligible: course.giftVoucherEligible || false,
           schedulingMode: course.schedulingMode || "fixed_group",
           cancellationCutoffHours: course.cancellationCutoffHours ?? 0,
           depositDisposition: course.depositDisposition || "refund",
           minimumEnrollmentRiskDeadline: course.minimumEnrollmentRiskDeadline ? course.minimumEnrollmentRiskDeadline.slice(0, 16) : "",
           earlyBirdPrice: course.earlyBirdPrice ?? "",
           earlyBirdCutoff: course.earlyBirdCutoff ? course.earlyBirdCutoff.slice(0, 16) : "",
           installmentCount: course.installmentCount ?? 1,
          onlineAccessDays: course.onlineAccessDays || "",
          extensionPrice1Month: course.extensionPrice1Month ?? "",
          extensionPrice3Months: course.extensionPrice3Months ?? "",
          extensionPrice6Months: course.extensionPrice6Months ?? "",
        });
      } else {
        reset({ category: '', faqText: '', format: 'online', level: 'all-levels', certification: false, price: 0, imageUrl: DEFAULT_COURSE_IMAGE, refundPolicy: DEFAULT_REFUND_POLICY, paymentMode: 'online_full', subcategoryId: '', courseTypeId: '', groupDiscountMinimum: "", groupDiscountPercent: "", learningOutcomesText: "", includedItemsText: "", requirements: "", durationMinutes: "", giftVoucherEligible: false, schedulingMode: "fixed_group", cancellationCutoffHours: 0, depositDisposition: "refund", installmentCount: 1, earlyBirdPrice: "", earlyBirdCutoff: "", minimumEnrollmentRiskDeadline: "", onlineAccessDays: "", extensionPrice1Month: "", extensionPrice3Months: "", extensionPrice6Months: "" });
      }
    }
  }, [open, course, reset, taxonomy]);

  const submit = (values: any) => {
    const payload = {
      title: values.title,
      category: values.category || (categories.find((c:any) => c.id === values.categoryId)?.name || "Ostalo"),
      faq: values.faqText ? values.faqText.split('\n\n').map((block: string) => {
        const lines = block.split('\n');
        if (lines.length >= 2) return { question: lines[0].replace(/^P:\s*/, ''), answer: lines.slice(1).join('\n').replace(/^O:\s*/, '') };
        return null;
      }).filter(Boolean) : [],
      description: values.description || null,
      categoryId: values.categoryId || course?.categoryId || null,
      subcategoryId: values.subcategoryId || course?.subcategoryId || null,
      courseTypeId: values.courseTypeId || course?.courseTypeId || null,
      format: values.format,
      city: values.format !== "online" ? values.city : null,
      price: values.price,
      duration: values.duration,
      level: values.level || null,
      learningOutcomes: values.learningOutcomesText ? values.learningOutcomesText.split("\n").map((s: string) => s.trim()).filter(Boolean) : [],
      includedItems: values.includedItemsText ? values.includedItemsText.split("\n").map((s: string) => s.trim()).filter(Boolean) : [],
      requirements: values.requirements || null,
      certification: values.certification,
      certificateName: values.certificateName || null,
      accredited: values.accredited,
      theoryHours: values.theoryHours ? Number(values.theoryHours) : null,
      practicalHours: values.practicalHours ? Number(values.practicalHours) : null,
      language: values.language || null,
      trailerUrl: values.trailerUrl || null,
      tags: values.tagsText ? values.tagsText.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
      imageUrl: values.imageUrl,
      startDate: values.startDate || null,
      refundPolicy: values.refundPolicy,
      paymentMode: values.paymentMode,
      depositAmount: values.paymentMode === "live_deposit" && values.depositAmount ? Number(values.depositAmount) : null,
      groupDiscountMinimum: values.groupDiscountMinimum ? Number(values.groupDiscountMinimum) : null,
      groupDiscountPercent: values.groupDiscountPercent ? Number(values.groupDiscountPercent) : null,
      durationMinutes: values.durationMinutes ? Number(values.durationMinutes) : null,
      giftVoucherEligible: !!values.giftVoucherEligible,
      schedulingMode: values.schedulingMode,
      cancellationCutoffHours: Number(values.cancellationCutoffHours || 0),
      depositDisposition: values.depositDisposition,
      minimumEnrollmentRiskDeadline: values.minimumEnrollmentRiskDeadline ? new Date(values.minimumEnrollmentRiskDeadline).toISOString() : null,
      earlyBirdPrice: values.earlyBirdPrice === "" || values.earlyBirdPrice == null ? null : Number(values.earlyBirdPrice),
      earlyBirdCutoff: values.earlyBirdCutoff ? new Date(values.earlyBirdCutoff).toISOString() : null,
      installmentCount: Number(values.installmentCount || 1),
    };

    if (course) {
      update.mutate({ courseId: course.id, data: payload as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetEducationCourseQueryKey(course.id) });
          queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
          toast.success("Edukacija sačuvana");
          onOpenChange(false);
        },
        onError: (e) => toast.error("Greška", { description: e.message })
      });
    } else {
      create.mutate({ data: payload as any }, {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
          toast.success("Edukacija kreirana");
          onOpenChange(false);
          setLocation(`/biznis/edukacije/${res.id}`);
        },
        onError: (e) => toast.error("Greška", { description: e.message })
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{course ? "Izmeni edukaciju" : "Nova edukacija"}</DialogTitle>
        </DialogHeader>
        <TooltipProvider>
<form onSubmit={handleSubmit(submit)} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Naziv-edukacije">Naziv edukacije <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Naziv-edukacije">Zvaničan komercijalni naziv kurseva</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-course-title-help" {...register("title")} />
                <EducationFieldHelp id="education-course-title-help" label="Naziv edukacije" text="Unesite prepoznatljiv zvaničan naziv koji jasno opisuje temu edukacije." />
                {errors.title && <p className="text-xs text-destructive">{errors.title.message as string}</p>}
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Oblast-(Sekcija)">Oblast (Sekcija) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Oblast-(Sekcija)">Šira oblast kojoj edukacija pripada</TooltipContent></Tooltip></Label>
                <Controller control={control} name="sectionId" render={({ field }) => (
                  <Select value={field.value} onValueChange={(val) => { field.onChange(val); setValue("categoryId", ""); setValue("subcategoryId", ""); setValue("courseTypeId", ""); }}>
                    <SelectTrigger aria-describedby="education-course-section-help"><SelectValue placeholder="Izaberite sekciju" /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                <EducationFieldHelp id="education-course-section-help" label="Oblast edukacije" text="Izaberite najširu oblast kojoj pripada sadržaj edukacije." />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Kategorija">Kategorija <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Kategorija">Uža kategorija edukacije</TooltipContent></Tooltip></Label>
                <Controller control={control} name="categoryId" render={({ field }) => (
                  <Select value={field.value} onValueChange={(val) => { field.onChange(val); setValue("subcategoryId", ""); setValue("courseTypeId", ""); }} disabled={!watchSectionId}>
                    <SelectTrigger aria-describedby="education-course-category-id-help"><SelectValue placeholder="Izaberite kategoriju" /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                <EducationFieldHelp id="education-course-category-id-help" label="Kategorija edukacije" text="Izaberite kategoriju unutar oblasti koja najbolje opisuje edukaciju." />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Potkategorija">Potkategorija <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Potkategorija">Specifična potkategorija</TooltipContent></Tooltip></Label>
                <Controller control={control} name="subcategoryId" render={({ field }) => (
                  <Select value={field.value} onValueChange={(val) => { field.onChange(val); setValue("courseTypeId", ""); }} disabled={!watchCategoryId}>
                    <SelectTrigger aria-describedby="education-course-subcategory-help"><SelectValue placeholder="Izaberite potkategoriju" /></SelectTrigger>
                    <SelectContent>
                      {subcategories.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                <EducationFieldHelp id="education-course-subcategory-help" label="Potkategorija edukacije" text="Izaberite precizniju potkategoriju kako bi polaznici lakše pronašli edukaciju." />
                {errors.subcategoryId && <p className="text-xs text-destructive">{errors.subcategoryId.message as string}</p>}
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Tip-obuke">Tip obuke <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Tip-obuke">Format i nivo obuke</TooltipContent></Tooltip></Label>
                <Controller control={control} name="courseTypeId" render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!watchSubcategoryId}>
                    <SelectTrigger aria-describedby="education-course-type-help"><SelectValue placeholder="Izaberite tip" /></SelectTrigger>
                    <SelectContent>
                      {courseTypes.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
                <EducationFieldHelp id="education-course-type-help" label="Tip obuke" text="Izaberite konkretan tip obuke koji odgovara sadržaju i nameni programa." />
                {errors.courseTypeId && <p className="text-xs text-destructive">{errors.courseTypeId.message as string}</p>}
                <Button type="button" variant="link" size="sm" className="px-0 h-auto text-xs" onClick={proposeType} disabled={!watchSubcategoryId || proposeMut.isPending}>Nema vašeg tipa? Predložite novi</Button>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Stara-kategorija-(ili-izaberite-iznad)">Stara kategorija (ili izaberite iznad) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Stara-kategorija-(ili-izaberite-iznad)">Unos stare kategorije ukoliko nova nije odabrana</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-course-legacy-category-help" {...register("category")} placeholder="Ako ne izaberete potkategoriju, unesite ručno" />
                <EducationFieldHelp id="education-course-legacy-category-help" label="Ručni naziv kategorije" text="Unesite naziv kategorije samo kada odgovarajuća potkategorija nije dostupna iznad." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Opis">Opis <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Opis">Detaljan opis edukacije i šta polaznici dobijaju</TooltipContent></Tooltip></Label>
                <Textarea aria-describedby="education-course-description-help" {...register("description")} rows={4} />
                <EducationFieldHelp id="education-course-description-help" label="Opis edukacije" text="Objasnite sadržaj, način rada i koristi koje polaznik dobija završetkom edukacije." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Cena-(RSD)">Cena (RSD) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Cena-(RSD)">Konačna cena edukacije za polaznike</TooltipContent></Tooltip></Label>
                  <Input aria-describedby="education-course-price-help" type="number" {...register("price")} />
                  <EducationFieldHelp id="education-course-price-help" label="Cena edukacije" text="Unesite punu redovnu cenu jednog mesta na edukaciji u dinarima." />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Način-plaćanja">Način plaćanja <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Način-plaćanja">Kako polaznici mogu platiti edukaciju</TooltipContent></Tooltip></Label>
                  <Controller control={control} name="paymentMode" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-describedby="education-course-payment-mode-help"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="online_full">Onlajn (celokupan iznos)</SelectItem>
                        {watchFormat !== 'online' && <SelectItem value="live_deposit">Depozit + Uživo</SelectItem>}
                        {watchFormat !== 'online' && <SelectItem value="live_off_platform">Plaćanje uživo (van platforme)</SelectItem>}
                      </SelectContent>
                    </Select>
                  )} />
                  <EducationFieldHelp id="education-course-payment-mode-help" label="Način plaćanja" text="Odredite da li polaznik plaća ceo iznos onlajn, depozit ili direktno organizatoru." />
                </div>
              </div>

              {watchPaymentMode === "live_deposit" && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Iznos-depozita-(RSD)">Iznos depozita (RSD) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Iznos-depozita-(RSD)">Pomoć za polje: Iznos depozita (RSD)</TooltipContent></Tooltip></Label>
                  <Input aria-describedby="education-course-deposit-help" type="number" {...register("depositAmount")} />
                  <EducationFieldHelp id="education-course-deposit-help" label="Iznos depozita" text="Unesite iznos depozita u dinarima; mora biti veći od nule i manji od pune cene." />
                  {errors.depositAmount && <p className="text-xs text-destructive">{errors.depositAmount.message as string}</p>}
                </div>
              )}

              <div className="space-y-2 pt-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Politika-povraćaja">Politika povraćaja <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Politika-povraćaja">Pomoć za polje: Politika povraćaja</TooltipContent></Tooltip></Label>
                <Textarea aria-describedby="education-course-refund-help" {...register("refundPolicy")} placeholder="Opišite uslove povraćaja novca..." />
                <EducationFieldHelp id="education-course-refund-help" label="Politika povraćaja" text="Jasno navedite rokove i uslove pod kojima polaznik može dobiti povraćaj uplate." />
                {errors.refundPolicy && <p className="text-xs text-destructive">{errors.refundPolicy.message as string}</p>}
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <Controller control={control} name="giftVoucherEligible" render={({ field: { value, onChange } }) => (
                  <Checkbox id="gift-voucher-check" checked={value} onCheckedChange={onChange} />
                )} />
                <Label htmlFor="gift-voucher-check">Moguća kupovina na poklon</Label>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Naslovna-fotografija">Naslovna fotografija <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Naslovna-fotografija">Pomoć za polje: Naslovna fotografija</TooltipContent></Tooltip></Label>
                <div className="border rounded-md overflow-hidden relative aspect-video bg-muted group">
                  <img src={coverImageUrl} alt="Naslovna fotografija" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Button type="button" variant="secondary" onClick={() => document.getElementById("cover-upload")?.click()} disabled={uploadingCover}>
                      {uploadingCover ? <Loader2 className="h-4 w-4 animate-spin" /> : "Promeni sliku"}
                    </Button>
                  </div>
                  <input id="cover-upload" aria-describedby="education-course-cover-help" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={uploadCover} />
                </div>
                <EducationFieldHelp id="education-course-cover-help" label="Naslovna fotografija" text="Otpremite jasnu JPG, PNG ili WebP fotografiju koja predstavlja edukaciju u katalogu." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Format">Format <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Format">Način održavanja edukacije</TooltipContent></Tooltip></Label>
                  <Controller control={control} name="format" render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => { field.onChange(v); if(v==='online') setValue('paymentMode', 'online_full'); }}>
                      <SelectTrigger aria-describedby="education-course-format-help"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="in-person">Uživo</SelectItem>
                        <SelectItem value="hybrid">Hibridno</SelectItem>
                      </SelectContent>
                    </Select>
                  )} />
                  <EducationFieldHelp id="education-course-format-help" label="Format edukacije" text="Odredite da li se edukacija održava onlajn, uživo ili kombinovano." />
                </div>
                {watchFormat === 'online' && (
                  <div className="col-span-2 space-y-4 pt-4 border-t border-border">
                    <h4 className="text-sm font-semibold">Uslovi online pristupa</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label aria-describedby="help-online-access-days">Trajanje osnovnog pristupa (u danima) *</Label>
                        <Input aria-describedby="help-online-access-days" type="number" {...register("onlineAccessDays")} placeholder="npr. 30" />
                        <EducationFieldHelp id="help-online-access-days" label="Trajanje osnovnog pristupa" text="Koliko dana će polaznik imati pristup online sadržaju nakon kupovine." />
                        {errors.onlineAccessDays && <p className="text-xs text-destructive">{String(errors.onlineAccessDays.message)}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label aria-describedby="help-ext-1m">Cena produženja (1 mesec) *</Label>
                        <Input aria-describedby="help-ext-1m" type="number" min="1" {...register("extensionPrice1Month")} placeholder="RSD" />
                        <EducationFieldHelp id="help-ext-1m" label="Produženje 1 mesec" text="Unesite cenu veću od nule za produženje pristupa na dodatnih mesec dana." />
                        {errors.extensionPrice1Month && <p className="text-xs text-destructive">{String(errors.extensionPrice1Month.message)}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label aria-describedby="help-ext-3m">Cena produženja (3 meseca) *</Label>
                        <Input aria-describedby="help-ext-3m" type="number" min="1" {...register("extensionPrice3Months")} placeholder="RSD" />
                        <EducationFieldHelp id="help-ext-3m" label="Produženje 3 meseca" text="Unesite cenu veću od nule za produženje pristupa na dodatna 3 meseca." />
                        {errors.extensionPrice3Months && <p className="text-xs text-destructive">{String(errors.extensionPrice3Months.message)}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label aria-describedby="help-ext-6m">Cena produženja (6 meseci) *</Label>
                        <Input aria-describedby="help-ext-6m" type="number" min="1" {...register("extensionPrice6Months")} placeholder="RSD" />
                        <EducationFieldHelp id="help-ext-6m" label="Produženje 6 meseci" text="Unesite cenu veću od nule za produženje pristupa na dodatnih 6 meseci." />
                        {errors.extensionPrice6Months && <p className="text-xs text-destructive">{String(errors.extensionPrice6Months.message)}</p>}
                      </div>
                    </div>
                  </div>
                )}
                {watchFormat !== 'online' && (
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2" aria-describedby="help-Grad">Grad <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Grad">Grad u kom se održava edukacija</TooltipContent></Tooltip></Label>
                    <Input aria-describedby="education-course-city-help" {...register("city")} placeholder="Npr. Beograd" />
                    <EducationFieldHelp id="education-course-city-help" label="Grad održavanja" text="Unesite grad u kojem se održava deo edukacije uživo." />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Česta-pitanja-(Najčešća-pitanja)">Česta pitanja (Najčešća pitanja) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Česta-pitanja-(Najčešća-pitanja)">Pomoć za polje: Česta pitanja (Najčešća pitanja)</TooltipContent></Tooltip></Label>
                <Textarea aria-describedby="education-course-faq-help" {...register("faqText")} placeholder="P: Pitanje\nO: Odgovor\n\n(odvojite praznim redom)" rows={4} />
                <EducationFieldHelp id="education-course-faq-help" label="Česta pitanja" text="Unesite parove pitanja i odgovora, a svaki par odvojite praznim redom." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Trajanje">Trajanje <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Trajanje">Ukupno trajanje u danima ili nedeljama</TooltipContent></Tooltip></Label>
                  <Input aria-describedby="education-course-duration-help" {...register("duration")} placeholder="Npr. 2 dana, 6 modula" />
                  <EducationFieldHelp id="education-course-duration-help" label="Opis trajanja" text="Opišite trajanje razumljivim izrazom, na primer broj dana, nedelja ili modula." />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Trajanje-(minuti,-opciono)">Trajanje (minuti, opciono) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Trajanje-(minuti,-opciono)">Pomoć za polje: Trajanje (minuti, opciono)</TooltipContent></Tooltip></Label>
                  <Input aria-describedby="education-course-duration-minutes-help" type="number" {...register("durationMinutes")} placeholder="Npr. 120" />
                  <EducationFieldHelp id="education-course-duration-minutes-help" label="Trajanje u minutima" text="Po želji unesite precizno ukupno trajanje edukacije u minutima." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Nivo">Nivo <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Nivo">Nivo predznanja koji je potreban</TooltipContent></Tooltip></Label>
                  <Controller control={control} name="level" render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-describedby="education-course-level-help"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-levels">Svi nivoi</SelectItem>
                        <SelectItem value="beginner">Početni</SelectItem>
                        <SelectItem value="intermediate">Srednji</SelectItem>
                        <SelectItem value="advanced">Napredni</SelectItem>
                      </SelectContent>
                    </Select>
                  )} />
                  <EducationFieldHelp id="education-course-level-help" label="Nivo predznanja" text="Izaberite nivo iskustva koji polaznik treba da ima pre početka edukacije." />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Teorija-(sati)">Teorija (sati) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Teorija-(sati)">Pomoć za polje: Teorija (sati)</TooltipContent></Tooltip></Label>
                  <Input aria-describedby="education-course-theory-hours-help" type="number" {...register("theoryHours")} placeholder="Opciono" />
                  <EducationFieldHelp id="education-course-theory-hours-help" label="Sati teorije" text="Unesite koliko sati programa je namenjeno teorijskoj nastavi." />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2" aria-describedby="help-Praksa-(sati)">Praksa (sati) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Praksa-(sati)">Pomoć za polje: Praksa (sati)</TooltipContent></Tooltip></Label>
                  <Input aria-describedby="education-course-practical-hours-help" type="number" {...register("practicalHours")} placeholder="Opciono" />
                  <EducationFieldHelp id="education-course-practical-hours-help" label="Sati prakse" text="Unesite koliko sati programa je namenjeno praktičnim vežbama." />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <Controller control={control} name="certification" render={({ field: { value, onChange } }) => (
                  <Checkbox id="cert-check" checked={value} onCheckedChange={onChange} />
                )} />
                <Label htmlFor="cert-check">Uključuje sertifikat</Label>
              </div>

              {watch("certification") && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2" aria-describedby="help-Naziv-sertifikata">Naziv sertifikata <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Naziv-sertifikata">Tačan naziv dokumenta koji se izdaje</TooltipContent></Tooltip></Label>
                    <Input aria-describedby="education-course-certificate-name-help" {...register("certificateName")} placeholder="Npr. PMU Master" />
                    <EducationFieldHelp id="education-course-certificate-name-help" label="Naziv sertifikata" text="Unesite tačan naziv koji će biti odštampan na sertifikatu polaznika." />
                  </div>
                  <div className="flex items-center space-x-2 pt-8">
                    <Controller control={control} name="accredited" render={({ field: { value, onChange } }) => (
                      <Checkbox id="accr-check" checked={value} onCheckedChange={onChange} />
                    )} />
                    <Label htmlFor="accr-check">Akreditovan program</Label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t pt-4 mt-6">
            <h3 className="text-lg font-serif font-bold mb-1">Termini i komercijalna politika</h3>
            <p className="text-xs text-muted-foreground mb-4">Sva vremena su u vremenskoj zoni Europe/Belgrade.</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Režim-zakazivanja">Režim zakazivanja <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Režim-zakazivanja">Način na koji se formiraju grupe</TooltipContent></Tooltip></Label>
                <Controller control={control} name="schedulingMode" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger aria-describedby="education-course-scheduling-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed_group">Fiksna grupna sesija</SelectItem><SelectItem value="individual_calendar">Individualni termini / kalendar</SelectItem></SelectContent></Select>} />
                <EducationFieldHelp id="education-course-scheduling-help" label="Režim zakazivanja" text="Izaberite da li svi polaznici pohađaju fiksne grupe ili rezervišu individualne termine." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Broj-rata">Broj rata <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Broj-rata">Mogućnost plaćanja na više rata</TooltipContent></Tooltip></Label>
                <Controller control={control} name="installmentCount" render={({ field }) => <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}><SelectTrigger aria-describedby="education-course-installments-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1 rata</SelectItem><SelectItem value="2">2 rate</SelectItem><SelectItem value="3">3 rate</SelectItem></SelectContent></Select>} />
                <EducationFieldHelp id="education-course-installments-help" label="Broj rata" text="Izaberite na koliko rata polaznik može da plati cenu edukacije." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Rok-za-otkazivanje-(sati)">Rok za otkazivanje (sati) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Rok-za-otkazivanje-(sati)">Rok do kad je dozvoljeno besplatno otkazivanje</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-course-cancellation-hours-help" type="number" min="0" max="8760" {...register("cancellationCutoffHours")} />
                <EducationFieldHelp id="education-course-cancellation-hours-help" label="Rok za otkazivanje" text="Unesite broj sati pre termina do kada je polazniku dozvoljeno otkazivanje." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Postupanje-sa-depozitom">Postupanje sa depozitom <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Postupanje-sa-depozitom">Šta se dešava sa depozitom u slučaju otkazivanja</TooltipContent></Tooltip></Label>
                <Controller control={control} name="depositDisposition" render={({ field }) => <Select value={field.value} onValueChange={field.onChange}><SelectTrigger aria-describedby="education-course-deposit-disposition-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="refund">Povraćaj</SelectItem><SelectItem value="forfeit">Zadržava se</SelectItem><SelectItem value="transfer">Prenos na drugi termin</SelectItem></SelectContent></Select>} />
                <EducationFieldHelp id="education-course-deposit-disposition-help" label="Postupanje sa depozitom" text="Odredite da li se depozit vraća, zadržava ili prenosi kada polaznik otkaže." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Rana-prijava-cena-(RSD)">Rana prijava cena (RSD) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Rana-prijava-cena-(RSD)">Niža cena za prijave pre zadatog roka</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-course-early-price-help" type="number" min="0" {...register("earlyBirdPrice")} placeholder="Npr. 15000" />
                <EducationFieldHelp id="education-course-early-price-help" label="Cena rane prijave" text="Unesite sniženu cenu u dinarima koja važi samo do roka za ranu prijavu." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Rana-prijava-rok">Rana prijava rok <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Rana-prijava-rok">Datum do kog važi niža cena</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-course-early-cutoff-help" type="datetime-local" {...register("earlyBirdCutoff")} />
                <EducationFieldHelp id="education-course-early-cutoff-help" label="Rok rane prijave" text="Izaberite datum i vreme do kada polaznici mogu ostvariti cenu rane prijave." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2" aria-describedby="help-Rok-rizika-minimalnog-broja-polaznika">Rok rizika minimalnog broja polaznika <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Rok-rizika-minimalnog-broja-polaznika">Krajnji rok za potvrdu održavanja edukacije</TooltipContent></Tooltip></Label>
                <Input aria-describedby="education-course-risk-deadline-help" type="datetime-local" {...register("minimumEnrollmentRiskDeadline")} />
                <EducationFieldHelp id="education-course-risk-deadline-help" label="Rok potvrde održavanja" text="Izaberite krajnji trenutak kada odlučujete da li ima dovoljno prijava za održavanje edukacije." />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Odustani</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>{course ? "Sačuvaj izmene" : "Kreiraj edukaciju"}</Button>
          </DialogFooter>
        </form>
        </TooltipProvider>
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
            <Label className="flex items-center gap-2" aria-describedby="help-Naziv-modula-*">Naziv modula * <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Naziv-modula-*">Pomoć za polje: Naziv modula *</TooltipContent></Tooltip></Label>
            <Input aria-describedby="education-module-title-help" placeholder="Npr. Uvod u teoriju..." {...register("title")} />
            <EducationFieldHelp id="education-module-title-help" label="Naziv modula" text="Unesite kratak naziv tematske celine koja grupiše povezane lekcije." />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message as string}</p>}
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2" aria-describedby="help-Opis-(opciono)">Opis (opciono) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Opis-(opciono)">Pomoć za polje: Opis (opciono)</TooltipContent></Tooltip></Label>
            <Textarea aria-describedby="education-module-description-help" placeholder="Kratak opis sadržaja modula..." rows={3} {...register("description")} />
            <EducationFieldHelp id="education-module-description-help" label="Opis modula" text="Sažeto objasnite koje teme i veštine obuhvata ovaj modul." />
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
              <Label className="flex items-center gap-2" aria-describedby="help-Naslov-lekcije-*">Naslov lekcije * <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Naslov-lekcije-*">Pomoć za polje: Naslov lekcije *</TooltipContent></Tooltip></Label>
              <Input aria-describedby="education-lesson-title-help" placeholder="Npr. Priprema radnog mesta" {...register("title")} />
              <EducationFieldHelp id="education-lesson-title-help" label="Naslov lekcije" text="Unesite jasan naslov pojedinačne lekcije koji opisuje njen glavni sadržaj." />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message as string}</p>}
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label className="flex items-center gap-2" aria-describedby="help-Trajanje-(min)-*">Trajanje (min) * <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Trajanje-(min)-*">Pomoć za polje: Trajanje (min) *</TooltipContent></Tooltip></Label>
              <Input aria-describedby="education-lesson-duration-help" type="number" min="1" {...register("durationMinutes")} />
              <EducationFieldHelp id="education-lesson-duration-help" label="Trajanje lekcije" text="Unesite očekivano vreme potrebno za završetak lekcije, u minutima." />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2" aria-describedby="help-Sadržaj-(Tekst-ili-HTML)">Sadržaj (Tekst ili HTML) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Sadržaj-(Tekst-ili-HTML)">Pomoć za polje: Sadržaj (Tekst ili HTML)</TooltipContent></Tooltip></Label>
            <Textarea aria-describedby="education-lesson-content-help" className="font-mono text-sm" rows={8} placeholder="<p>Dobrodošli u prvu lekciju...</p>" {...register("content")} />
            <EducationFieldHelp id="education-lesson-content-help" label="Sadržaj lekcije" text="Unesite tekst ili bezbedan HTML koji će polaznici čitati u lekciji Sistema za učenje." />
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
              <Label className="flex items-center gap-2" aria-describedby="help-Početak-*">Početak * <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Početak-*">Pomoć za polje: Početak *</TooltipContent></Tooltip></Label>
              <Input aria-describedby="education-session-start-help" type="datetime-local" {...register("startsAt")} />
              <EducationFieldHelp id="education-session-start-help" label="Početak termina" text="Izaberite lokalni datum i vreme početka termina prema vremenskoj zoni Beograda." />
              {errors.startsAt && <p className="text-sm text-destructive">{errors.startsAt.message as string}</p>}
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2" aria-describedby="help-Kraj-*">Kraj * <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Kraj-*">Pomoć za polje: Kraj *</TooltipContent></Tooltip></Label>
              <Input aria-describedby="education-session-end-help" type="datetime-local" {...register("endsAt")} />
              <EducationFieldHelp id="education-session-end-help" label="Kraj termina" text="Izaberite lokalni datum i vreme završetka termina, nakon vremena početka." />
              {errors.endsAt && <p className="text-sm text-destructive">{errors.endsAt.message as string}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2" aria-describedby="help-Tačna-lokacija-(adresa-ili-link)">Tačna lokacija (adresa ili link) <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Tačna-lokacija-(adresa-ili-link)">Pomoć za polje: Tačna lokacija (adresa ili link)</TooltipContent></Tooltip></Label>
            <Input aria-describedby="education-session-location-help" placeholder="Npr. Resavska 10, Novi Sad" {...register("location")} />
            <EducationFieldHelp id="education-session-location-help" label="Lokacija termina" text="Unesite tačnu adresu održavanja ili pristupni link za hibridni termin." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2" aria-describedby="help-Kapacitet-polaznika-*">Kapacitet polaznika * <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Kapacitet-polaznika-*">Pomoć za polje: Kapacitet polaznika *</TooltipContent></Tooltip></Label>
              <Input aria-describedby="education-session-capacity-help" type="number" min="1" {...register("capacity")} />
              <EducationFieldHelp id="education-session-capacity-help" label="Kapacitet termina" text="Unesite najveći broj polaznika koji mogu rezervisati ovaj termin." />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2" aria-describedby="help-Minimalan-broj-prijava">Minimalan broj prijava <Tooltip><TooltipTrigger type="button" aria-label="Pomoć" className="shrink-0"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent id="help-Minimalan-broj-prijava">Pomoć za polje: Minimalan broj prijava</TooltipContent></Tooltip></Label>
              <Input aria-describedby="education-session-minimum-help" type="number" min="0" max="9999" placeholder="Opciono" {...register("minimumEnrollments")} />
              <EducationFieldHelp id="education-session-minimum-help" label="Minimalan broj prijava" text="Unesite prag prijava ispod kojeg organizator može odlučiti da otkaže termin." />
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

// ── Instructor management dialog (EDUKATIVNI_CENTAR) ────────────────────────

const instructorSchema = z.object({
  fullName: z.string().min(1, "Ime je obavezno").max(120),
  photoUrl: z.string().optional(),
  biography: z.string().max(4000).optional(),
  industryYears: z.coerce.number().int().min(0).optional(),
  experienceYears: z.coerce.number().int().min(0).optional(),
  specializations: z.string().optional(),
  qualifications: z.string().optional(),
  portfolioMediaText: z.string().optional(),
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
      portfolioMediaText: (inst.portfolioMedia ?? []).join("\n"),
    });
  };

  const parseList = (val?: string) => (val ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const parseUrlList = (val?: string) => (val ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

  const onSubmit = (data: InstructorForm) => {
    const portfolioUrls = parseUrlList(data.portfolioMediaText);
    const invalidUrl = portfolioUrls.find(u => !u.startsWith("https://"));
    if (invalidUrl) {
      toast.error("Nevažeći URL u portfoliju", { description: "Svi linkovi moraju početi sa https://" });
      return;
    }
    if (portfolioUrls.length > 12) {
      toast.error("Previše linkova", { description: "Maksimalno je dozvoljeno 12 portfolijo linkova." });
      return;
    }

    const payload = {
      fullName: data.fullName,
      photoUrl: data.photoUrl || undefined,
      biography: data.biography,
      industryYears: data.industryYears ?? 0,
      experienceYears: data.experienceYears ?? 0,
      specializations: parseList(data.specializations),
      qualifications: parseList(data.qualifications),
      portfolioMedia: portfolioUrls,
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
                  {inst.photoUrl ? <OptimizedImage src={inst.photoUrl} alt={inst.fullName} width={80} height={80} preferredSize="thumbnail" responsiveSizes="40px" className="w-10 h-10 rounded-full object-cover border" /> : <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center"><UserCircle2 className="w-6 h-6 text-muted-foreground" /></div>}
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
                  <Input aria-describedby="education-instructor-name-help" placeholder="Ime i prezime" {...register("fullName")} />
                  <EducationFieldHelp id="education-instructor-name-help" label="Puno ime instruktora" text="Unesite ime i prezime instruktora onako kako treba da se prikaže polaznicima." />
                  {errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">URL fotografije</Label>
                  <Input aria-describedby="education-instructor-photo-help" placeholder="https://..." {...register("photoUrl")} />
                  <EducationFieldHelp id="education-instructor-photo-help" label="Fotografija instruktora" text="Unesite javno dostupan HTTPS link do profesionalne fotografije instruktora." />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Biografija</Label>
                <Textarea aria-describedby="education-instructor-biography-help" placeholder="Kratka biografija instruktora..." rows={3} {...register("biography")} />
                <EducationFieldHelp id="education-instructor-biography-help" label="Biografija instruktora" text="Sažeto predstavite iskustvo, stručnost i profesionalni rad instruktora." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Godine u industriji</Label>
                  <Input aria-describedby="education-instructor-industry-years-help" type="number" min="0" {...register("industryYears")} />
                  <EducationFieldHelp id="education-instructor-industry-years-help" label="Godine u industriji" text="Unesite broj punih godina profesionalnog rada instruktora u beauty ili wellness industriji." />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Godine poučavanja</Label>
                  <Input aria-describedby="education-instructor-teaching-years-help" type="number" min="0" {...register("experienceYears")} />
                  <EducationFieldHelp id="education-instructor-teaching-years-help" label="Godine poučavanja" text="Unesite broj punih godina iskustva instruktora u izvođenju obuka." />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Specijalizacije (zarezom odvojeno)</Label>
                <Input aria-describedby="education-instructor-specializations-help" placeholder="Npr. Manikir, Gelovi, Akrilne nokte" {...register("specializations")} />
                <EducationFieldHelp id="education-instructor-specializations-help" label="Specijalizacije instruktora" text="Navedite stručne oblasti instruktora odvojene zarezima." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Kvalifikacije i sertifikati (zarezom odvojeno)</Label>
                <Input aria-describedby="education-instructor-qualifications-help" placeholder="Npr. OPI sertifikat, Ombre majstor" {...register("qualifications")} />
                <EducationFieldHelp id="education-instructor-qualifications-help" label="Kvalifikacije instruktora" text="Navedite relevantne diplome, sertifikate i stručna zvanja odvojena zarezima." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Portfolio linkovi (HTTPS, 1 po redu, maks 12)</Label>
                <Textarea aria-describedby="education-instructor-portfolio-help" placeholder="https://instagram.com/..." rows={3} {...register("portfolioMediaText")} />
                <EducationFieldHelp id="education-instructor-portfolio-help" label="Portfolio instruktora" text="Unesite do 12 HTTPS linkova ka radovima instruktora, svaki u posebnom redu." />
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
          <div className="flex flex-col items-start gap-6 sm:flex-row">
            {profile.photoUrl ? (
              <OptimizedImage src={profile.photoUrl} alt={profile.name} width={192} height={192} preferredSize="thumbnail" responsiveSizes="96px" className="w-24 h-24 rounded-full object-cover border-2 border-border shadow-md shrink-0" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center shrink-0"><UserCircle2 className="w-12 h-12 text-muted-foreground" /></div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="font-serif text-3xl font-bold mb-2">{profile.name}</h1>
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  {profile.reviewCount > 0
                    ? `${profile.rating.toFixed(1)} (${profile.reviewCount} ${
                      profile.reviewCount === 1
                        ? "recenzija"
                        : profile.reviewCount >= 2 && profile.reviewCount <= 4
                          ? "recenzije"
                          : "recenzija"
                    })`
                    : "Još nema recenzija"}
                </span>
                <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {profile.participantCount} polaznika</span>
                <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {profile.industryYears} god. u industriji</span>
                <span className="flex items-center gap-1"><GraduationCap className="w-4 h-4" /> {profile.experienceYears} god. poučavanja</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Ocena je izračunata iz objavljenih recenzija javnih kurseva ovog instruktora.
              </p>
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

        {profile.portfolioMedia.length > 0 && (
          <section aria-labelledby="instructor-portfolio-heading">
            <h2 id="instructor-portfolio-heading" className="font-serif text-xl font-semibold mb-4">Portfolio</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {profile.portfolioMedia.map((mediaUrl, index) => (
                <a
                  key={mediaUrl}
                  href={mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group overflow-hidden rounded-xl border border-border/60 bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Otvori portfolio rad ${index + 1}`}
                >
                  <div className="aspect-square overflow-hidden">
                    <OptimizedImage
                      src={mediaUrl}
                      alt={`Portfolio rad ${index + 1} — ${profile.name}`}
                      width={720}
                      height={720}
                      responsiveSizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 300px"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                </a>
              ))}
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
                        <OptimizedImage src={course.imageUrl} alt={course.title} width={800} height={450} responsiveSizes="(max-width: 768px) 100vw, 420px" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
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
