import { BookingWidget, MobileBookingTrigger, MobileBookingDrawer } from "@/components/booking-widget";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  useGetSalon, 
  useGetSalonAvailability, 
  useCreateAppointment, 
  useGetCurrentUser, 
  useGetCustomerSalonReview, 
  useUpsertCustomerSalonReview, 
  useDeleteCustomerSalonReview, 
  useGetSalonFirstAvailable,
  useListSalons,
  getGetCustomerDashboardQueryKey,
  getGetSalonAvailabilityQueryKey, 
  getGetSalonQueryKey, 
  getGetCustomerSalonReviewQueryKey,
  getGetSalonFirstAvailableQueryKey,
  getListMyAppointmentsQueryKey,
  getListSalonsQueryKey,
  type FirstAvailableServiceSlot
} from "@workspace/api-client-react";
import { useParams, useLocation, useSearch, Link } from "wouter";
import { MapPin, Star, Clock, CalendarDays, Loader2, Heart, ShieldCheck, Flame, House, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { format, isValid, parseISO } from "date-fns";
import { SalonGallery, MediaItem } from "@/components/salon-gallery";
import { OptimizedImage } from "@/components/optimized-image";
import { Skeleton } from "@/components/ui/skeleton";
import { SalonFavoriteButton } from "@/components/salon-favorite-button";
import { useBookingDraft } from "@/hooks/use-booking-draft";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DiscoveryCarousel } from "@/components/discovery-carousel";

const profileSections = [
  { id: "popular-services", label: "Popularno" },
  { id: "services", label: "Usluge" },
  { id: "staff", label: "Tim" },
  { id: "reviews", label: "Recenzije" },
  { id: "faq", label: "FAQ" },
  { id: "location", label: "Lokacija" },
];

function serviceCategoryAnchor(category: string) {
  return `service-category-${category.toLocaleLowerCase("sr-RS").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}`;
}

export default function SalonProfile() {
  const { slug } = useParams();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: salon, isLoading, refetch: refetchSalon } = useGetSalon(slug || "", {
    query: {
      queryKey: getGetSalonQueryKey(slug || ""),
      refetchOnMount: "always",
    },
  });
  const { data: userResp } = useGetCurrentUser();
  const user = userResp?.user;
  const { draft, saveDraft, clearDraft } = useBookingDraft(user?.role === "CUSTOMER" ? user.id : undefined);

  const salonData = salon;
  
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [employeeSelection, setEmployeeSelection] = useState<"any" | "specific" | null>(null);
  const [favoriteEmployeeId, setFavoriteEmployeeId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{start: string, end: string, employeeId?: string|null} | null>(null);
  const [bookingStep, setBookingStep] = useState(1);
  const [hasInteractedWithEmployee, setHasInteractedWithEmployee] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<"pending" | "confirmed" | undefined>();
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [treatmentLocation, setTreatmentLocation] = useState<"salon" | "home">("salon");
  const [homeAddress, setHomeAddress] = useState({ line1: "", city: "", postalCode: "", details: "" });
  const [verificationPhone, setVerificationPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [phoneVerifiedForBooking, setPhoneVerifiedForBooking] = useState(false);
  const [phoneCodeRequested, setPhoneCodeRequested] = useState(false);
  const [isVerifyingPhone, setIsVerifyingPhone] = useState(false);
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewServiceName, setReviewServiceName] = useState("");
  const [showProfilePhoto, setShowProfilePhoto] = useState(false);
  const restoredSelection = useRef<string | null>(null);
  const [activeSection, setActiveSection] = useState("services");
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  
  const [quickBookTarget, setQuickBookTarget] = useState<{
    serviceId: string;
    date: string;
    startTime: string;
    employeeId: string | null;
  } | null>(null);
  
  const dateStr = format(selectedDate, 'yyyy-MM-dd');
  const availabilityEmployeeId = employeeSelection === "any" ? undefined : selectedEmployee || undefined;
  
  const { data: availability, isLoading: isLoadingAvailability } = useGetSalonAvailability(
    salonData?.id || "",
    { serviceId: selectedService || "", date: dateStr, employeeId: availabilityEmployeeId },
    { query: { enabled: !!salonData?.id && !!selectedService, queryKey: getGetSalonAvailabilityQueryKey(salonData?.id || "", { serviceId: selectedService || "", date: dateStr, employeeId: availabilityEmployeeId }) } }
  );

  const { data: firstAvailableResponse } = useGetSalonFirstAvailable(salonData?.id || "", {
    query: {
      enabled: !!salonData?.id,
      staleTime: 30000,
      queryKey: getGetSalonFirstAvailableQueryKey(salonData?.id || ""),
    },
  });

  const { data: nearbySalonsResponse } = useListSalons(
    {
      city: salonData?.city,
    },
    {
      query: {
        enabled: !!salonData?.city,
        queryKey: getListSalonsQueryKey({
          city: salonData?.city,
        }),
      }
    }
  );

  const createAppointment = useCreateAppointment();
  const upsertReview = useUpsertCustomerSalonReview();
  const deleteCustomerSalonReview = useDeleteCustomerSalonReview();
  
  const { data: reviewContext, isLoading: isLoadingReviewContext, refetch: refetchReviewContext } = useGetCustomerSalonReview(
    salonData?.id || "",
    {
      query: {
        enabled: user?.role === "CUSTOMER" && !!salonData?.id,
        queryKey: getGetCustomerSalonReviewQueryKey(salonData?.id || ""),
        refetchOnMount: "always",
      },
    },
  );

  const reviewServiceOptions = useMemo(() => [...new Set([
    ...(reviewContext?.eligibleServices ?? []),
    ...(reviewContext?.review ? [reviewContext.review.serviceName] : []),
  ])], [reviewContext]);

  const eligibleStaff = useMemo(() => selectedService ? salonData?.staff.filter((employee) => employee.serviceIds.includes(selectedService)) ?? [] : salonData?.staff ?? [], [salonData?.staff, selectedService]);

  const servicesByCategory = useMemo(() => {
    if (!salonData?.services) return {};
    return salonData.services.reduce((acc, service) => {
      const cat = service.category || "Ostale usluge";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(service);
      return acc;
    }, {} as Record<string, typeof salonData.services[0][]>);
  }, [salonData?.services]);

  const popularServiceIds = useMemo(
    () => new Set(salonData?.topServices.map((service) => service.id) ?? []),
    [salonData?.topServices],
  );

  const nearbySalons = useMemo(() => {
    const list = Array.isArray(nearbySalonsResponse) 
      ? nearbySalonsResponse 
      : (nearbySalonsResponse as any)?.salons || (nearbySalonsResponse as any)?.data || [];
    return list.filter((s: any) => s.id !== salonData?.id).slice(0, 5);
  }, [nearbySalonsResponse, salonData?.id]);

  const scrollToSection = (id: string) => {
    const section = document.getElementById(id);
    if (!section) return;
    window.scrollTo({ top: Math.max(0, section.getBoundingClientRect().top + window.scrollY - 142), behavior: "smooth" });
  };

  useEffect(() => {
    if (!salonData?.id || user?.role !== "CUSTOMER") return;
    fetch(`/api/customer/favorite-employees/${salonData.id}`, { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setFavoriteEmployeeId(data?.employeeId ?? null))
      .catch(() => setFavoriteEmployeeId(null));
  }, [salonData?.id, user?.role]);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      void refetchSalon();
      if (user?.role === "CUSTOMER" && salonData?.id) void refetchReviewContext();
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [refetchReviewContext, refetchSalon, salonData?.id, user?.role]);

  useEffect(() => {
    const observers = profileSections
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => !!section)
      .map((section) => new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) setActiveSection(section.id);
        },
        { rootMargin: "-24% 0px -64% 0px", threshold: 0 },
      ));
    const sections = profileSections
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => !!section);
    sections.forEach((section, index) => observers[index]?.observe(section));
    return () => observers.forEach((observer) => observer.disconnect());
  }, [salonData?.id]);

  useEffect(() => {
    if (selectedEmployee && !eligibleStaff.some((employee) => employee.id === selectedEmployee)) {
      setSelectedEmployee(null);
      if (employeeSelection === "specific") setEmployeeSelection("any");
    }
    if (employeeSelection === null && !selectedEmployee && favoriteEmployeeId && eligibleStaff.some((employee) => employee.id === favoriteEmployeeId)) {
      setSelectedEmployee(favoriteEmployeeId);
    }
  }, [eligibleStaff, employeeSelection, favoriteEmployeeId, selectedEmployee]);

  useEffect(() => {
    if (selectedService && bookingStep === 1) setBookingStep(2);
  }, [selectedService]);

  useEffect(() => {
    if (!salonData) return;
    const params = new URLSearchParams(search);
    const requestedServiceId = params.get("serviceId");
    const requestedEmployeeId = params.get("employeeId");
    const requestedDate = params.get("date");
    const requestedStartTime = params.get("startTime");
    const matchingDraft = !requestedServiceId && user?.role === "CUSTOMER" && draft?.salonSlug === salonData.slug ? draft : null;
    const serviceId = requestedServiceId ?? matchingDraft?.serviceId;
    const employeeId = requestedEmployeeId ?? matchingDraft?.employeeId ?? null;
    const key = `${salonData.id}:${search}:${matchingDraft?.serviceId ?? ""}:${matchingDraft?.date ?? ""}`;
    if (restoredSelection.current === key || !serviceId || !salonData.services.some((service) => service.id === serviceId)) return;
    if (matchingDraft && selectedService === matchingDraft.serviceId) return;

    const requestedDateValue = requestedDate ? parseISO(requestedDate) : null;
    const hasValidRequestedSlot = !!requestedDate
      && !!requestedStartTime
      && /^\d{2}:\d{2}$/.test(requestedStartTime)
      && !!requestedDateValue
      && isValid(requestedDateValue)
      && format(requestedDateValue, "yyyy-MM-dd") === requestedDate
      && requestedDate >= format(new Date(), "yyyy-MM-dd");
    const dateValue = hasValidRequestedSlot && requestedDateValue
      ? requestedDateValue
      : matchingDraft
        ? parseISO(matchingDraft.date)
        : new Date();
    const selectedServiceEmployees = salonData.staff.filter((employee) => employee.serviceIds.includes(serviceId));
    const validEmployeeId = employeeId && selectedServiceEmployees.some((employee) => employee.id === employeeId)
      ? employeeId
      : null;
    const restoredEmployeeSelection = validEmployeeId
      ? "specific"
      : matchingDraft?.employeeSelection === "any"
        ? "any"
        : null;
    setSelectedService(serviceId);
    setSelectedEmployee(validEmployeeId);
    setEmployeeSelection(restoredEmployeeSelection);
    setSelectedDate(isValid(dateValue) ? dateValue : new Date());
    setSelectedSlot(null);
    setBookingStep(3);
    setHasInteractedWithEmployee(restoredEmployeeSelection === "any" || !!validEmployeeId);
    if (hasValidRequestedSlot && requestedStartTime && validEmployeeId) {
      setQuickBookTarget({ serviceId, date: requestedDate!, startTime: requestedStartTime, employeeId: validEmployeeId });
    }
    restoredSelection.current = key;
    if (requestedServiceId) {
      window.setTimeout(() => document.getElementById("booking-widget")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [draft, salonData, search, selectedService, user?.role]);

  useEffect(() => {
    if (!salonData || user?.role !== "CUSTOMER" || !selectedService || isSuccess) return;
    saveDraft({
      salonSlug: salonData.slug,
      salonName: salonData.name,
      serviceId: selectedService,
      employeeId: selectedEmployee,
      employeeSelection: employeeSelection ?? undefined,
      date: format(selectedDate, "yyyy-MM-dd"),
    });
  }, [employeeSelection, hasInteractedWithEmployee, isSuccess, salonData, saveDraft, selectedDate, selectedEmployee, selectedService, user?.role]);

  useEffect(() => {
    if (selectedEmployee) setHasInteractedWithEmployee(true);
  }, [selectedEmployee]);

  // Handle Quick Book resolution
  useEffect(() => {
    if (quickBookTarget && !isLoadingAvailability && salonData) {
      if (selectedService === quickBookTarget.serviceId && dateStr === quickBookTarget.date) {
        const matchingSlot = availability?.find(s => 
          s.start === quickBookTarget.startTime && 
          (!quickBookTarget.employeeId || s.employeeId === quickBookTarget.employeeId)
        );
        if (matchingSlot) {
          setSelectedSlot(matchingSlot);
          setBookingStep(4);
        } else {
          toast.error("Termin više nije dostupan", { description: "Neko drugi je upravo rezervisao ovaj termin. Molimo izaberite drugi." });
          setSelectedSlot(null);
          setBookingStep(3);
        }
        setQuickBookTarget(null);
      }
    }
  }, [availability, isLoadingAvailability, quickBookTarget, selectedService, dateStr, toast, salonData]);

  const selectEmployee = (employeeId: string | null) => {
    setSelectedEmployee(employeeId);
    setEmployeeSelection(employeeId ? "specific" : "any");
    setHasInteractedWithEmployee(true);
  };

  const setFavorite = async (employeeId: string) => {
    if (!user) { setLocation("/prijava"); return; }
    const response = await fetch(`/api/customer/favorite-employees/${salonData?.id}`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId }) });
    if (!response.ok) { toast.error("Omiljeni zaposleni nije sačuvan."); return; }
    setFavoriteEmployeeId(employeeId); selectEmployee(employeeId); toast.success("Omiljeni zaposleni je sačuvan.");
  };

  const submitBooking = (locationType: "salon" | "home") => {
    if (!user) {
      toast.error("Prijava obavezna", { description: "Morate biti prijavljeni da biste zakazali termin." });
      setLocation("/prijava");
      return;
    }
    if (user.role !== "CUSTOMER") {
      toast.error("Zakazivanje nije dostupno", { description: "Za zakazivanje termina prijavite se klijentskim nalogom." });
      return;
    }
    
    if (!salonData || !selectedService || !selectedSlot) return;

    createAppointment.mutate({
      data: {
        salonId: salonData.id,
        serviceId: selectedService,
        date: dateStr,
        startTime: selectedSlot.start,
        employeeId: employeeSelection === "any" ? undefined : selectedEmployee ?? undefined,
        treatmentLocation: locationType,
        treatmentAddress: locationType === "home"
          ? { line1: homeAddress.line1.trim(), city: homeAddress.city.trim(), postalCode: homeAddress.postalCode.trim() || undefined, details: homeAddress.details.trim() || undefined }
          : undefined,
      }
    }, {
      onSuccess: (response) => {
        queryClient.invalidateQueries({ queryKey: getListMyAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCustomerDashboardQueryKey() });
        clearDraft();
        setBookingStatus(response.status === "confirmed" ? "confirmed" : "pending");
        setLocationDialogOpen(false);
        setIsSuccess(true);
      },
      onError: (error: unknown) => {
        const isBookingConflict = (error as { status?: number })?.status === 409;
        if (isBookingConflict) {
          const availabilityQueryKey = getGetSalonAvailabilityQueryKey(salonData.id, {
            serviceId: selectedService,
            date: dateStr,
            employeeId: availabilityEmployeeId,
          });

          setLocationDialogOpen(false);
          setSelectedSlot(null);
          setBookingStep(3);
          void queryClient.invalidateQueries({ queryKey: availabilityQueryKey, exact: true });
          toast.error("Termin više nije slobodan", {
            description: "Osvežili smo slobodne termine. Izaberite drugi termin.",
          });
          return;
        }

        const description = (error as { data?: { error?: string }; message?: string })?.data?.error
          ?? (error as { message?: string })?.message
          ?? "Došlo je do greške prilikom zakazivanja.";
        toast.error("Zakazivanje nije uspelo", { description });
      }
    });
  };

  const handleBook = () => {
    if (!user) { setLocation("/prijava"); return; }
    const service = salonData?.services.find((item) => item.id === selectedService);
    if (service?.homeServiceAvailable) {
      setTreatmentLocation("salon");
      setLocationDialogOpen(true);
      return;
    }
    submitBooking("salon");
  };

  const requestPhoneCode = async () => {
    if (!verificationPhone.trim()) { toast.error("Unesite broj mobilnog telefona."); return; }
    setIsVerifyingPhone(true);
    try {
      const response = await fetch("/api/auth/phone-verification/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: verificationPhone }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setPhoneCodeRequested(true);
      toast.success("SMS kod je poslat.");
    } catch (error) {
      toast.error("Kod nije poslat.", { description: error instanceof Error ? error.message : "Pokušajte ponovo." });
    } finally { setIsVerifyingPhone(false); }
  };

  const confirmPhoneCode = async () => {
    if (!verificationCode.trim()) { toast.error("Unesite kod iz SMS poruke."); return; }
    setIsVerifyingPhone(true);
    try {
      const response = await fetch("/api/auth/phone-verification/confirm", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: verificationPhone, code: verificationCode }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setPhoneVerifiedForBooking(true);
      toast.success("Broj telefona je potvrđen.");
    } catch (error) {
      toast.error("Broj nije potvrđen.", { description: error instanceof Error ? error.message : "Pokušajte ponovo." });
    } finally { setIsVerifyingPhone(false); }
  };

  const handleSelectService = (serviceId: string) => {
    setSelectedService(serviceId);
    setSelectedSlot(null);
    setBookingStep(2);
    if (window.innerWidth < 1024) {
      setIsMobileDrawerOpen(true);
    } else {
      setTimeout(() => {
        document.getElementById('booking-widget')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  const handleQuickBook = (serviceId: string, slot: FirstAvailableServiceSlot) => {
    if (!slot.date || !slot.startTime) return;
    const targetDate = parseISO(slot.date);
    setSelectedService(serviceId);
    selectEmployee(slot.employeeId);
    setSelectedDate(isValid(targetDate) ? targetDate : new Date());
    setQuickBookTarget({
      serviceId,
      date: slot.date,
      startTime: slot.startTime,
      employeeId: slot.employeeId
    });
    setBookingStep(3); // Wait for availability before moving to 4
    if (window.innerWidth < 1024) {
      setIsMobileDrawerOpen(true);
    } else {
      setTimeout(() => {
        document.getElementById('booking-widget')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  const openReviewDialog = () => {
    const review = reviewContext?.review;
    const selectedService = review?.serviceName ?? reviewContext?.eligibleServices[0] ?? "";
    setReviewRating(review?.rating ?? 5);
    setReviewText(review?.text ?? "");
    setReviewServiceName(selectedService);
    setShowProfilePhoto(review?.showProfilePhoto ?? false);
    setIsReviewDialogOpen(true);
  };

  const saveReview = () => {
    if (!salonData || !reviewServiceName || !reviewText.trim()) return;
    upsertReview.mutate({
      salonId: salonData.id,
      data: { serviceName: reviewServiceName, rating: reviewRating, text: reviewText.trim(), showProfilePhoto },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalonQueryKey(salonData.slug) });
        queryClient.invalidateQueries({ queryKey: getGetCustomerSalonReviewQueryKey(salonData.id) });
        setIsReviewDialogOpen(false);
        toast.success(reviewContext?.review ? "Recenzija je izmenjena." : "Hvala na recenziji!");
      },
      onError: (error: unknown) => {
        const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? "Recenzija nije sačuvana. Pokušajte ponovo.";
        toast.error("Promena nije sačuvana", { description: message });
      },
    });
  };

  const deleteReview = () => {
    if (!salonData) return;
    deleteCustomerSalonReview.mutate({ salonId: salonData.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSalonQueryKey(salonData.slug) });
        queryClient.invalidateQueries({ queryKey: getGetCustomerSalonReviewQueryKey(salonData.id) });
        setReviewRating(5);
        setReviewText("");
        setReviewServiceName("");
        setShowProfilePhoto(false);
        setIsReviewDialogOpen(false);
        toast.success("Recenzija je obrisana.");
      },
      onError: (error: unknown) => {
        const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? "Recenzija nije obrisana. Pokušajte ponovo.";
        toast.error("Brisanje nije uspelo", { description: message });
      },
    });
  };

  const mediaItems: MediaItem[] = useMemo(() => {
    if (!salonData) return [];
    const items: MediaItem[] = [];
    if (salonData.videoUrl) {
      items.push({ type: 'video', url: salonData.videoUrl });
    }
    if (salonData.imageUrl) {
      items.push({ type: 'image', url: salonData.imageUrl });
    }
    if (salonData.gallery && Array.isArray(salonData.gallery)) {
      salonData.gallery.forEach(url => {
        if (url && url !== salonData.imageUrl) {
           items.push({ type: 'image', url });
        }
      });
    }
    // Fallbacks if completely empty
    if (items.length === 0) {
      items.push({ type: 'image', url: "https://images.unsplash.com/photo-1519014816548-bf5fe059c98b?q=80&w=800" });
    }
    return items;
  }, [salonData]);

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 space-y-8">
          <Skeleton className="h-[360px] w-full rounded-3xl" />
          <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
            <div className="space-y-4">
              <Skeleton className="h-9 w-1/2" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
            <Skeleton className="hidden h-[520px] rounded-2xl lg:block" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!salonData) return <Layout><div className="p-12 text-center text-xl font-medium">Salon nije pronađen.</div></Layout>;

  const renderTopServiceCard = (service: (typeof salonData.topServices)[number]) => {
    const quickBookSlot = firstAvailableResponse?.services?.find(s => s.serviceId === service.id);
    return (
      <Card key={service.id} className="group hover:border-primary/50 transition-all flex flex-col shadow-sm hover:shadow-lg rounded-2xl overflow-hidden border-border/60 h-full">
        <CardContent className="p-6 flex-1 flex flex-col bg-card">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-bold text-xl group-hover:text-primary transition-colors pr-2 leading-tight">{service.name}</h3>
            <Badge variant="secondary" className="bg-primary/5 text-primary border-none shrink-0 font-bold">{service.bookingCount}+</Badge>
          </div>
          <p className="text-muted-foreground line-clamp-3 mb-6 leading-relaxed flex-1">{service.description}</p>
          <div className="flex items-center gap-4 text-sm font-semibold mt-auto bg-muted/30 p-3 rounded-xl">
            <span className="flex items-center gap-2 text-muted-foreground"><Clock className="w-4 h-4" /> {service.durationMinutes} min</span>
            <span className="text-foreground ml-auto text-lg">
              {service.promoPrice ? <span className="flex items-center gap-2"><span className="line-through text-muted-foreground text-sm font-normal">{service.price} RSD</span><span className="text-primary font-bold">{service.promoPrice} RSD</span></span> : <span className="font-bold">{service.price} RSD</span>}
            </span>
          </div>
          {quickBookSlot && quickBookSlot.date && quickBookSlot.startTime && (
            <div className="mt-4 pt-4 border-t border-border/50 text-sm">
              <span className="text-muted-foreground text-xs block mb-1 uppercase tracking-wider font-bold">Prvi slobodan termin</span>
              <div className="flex items-center justify-between">
                <span className="font-bold text-foreground">{format(parseISO(quickBookSlot.date), 'dd.MM.')} u {quickBookSlot.startTime}</span>
                {quickBookSlot.employeeName && <span className="text-muted-foreground">kod {quickBookSlot.employeeName.split(' ')[0]}</span>}
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="p-6 pt-0 bg-card">
          <Button
            variant={quickBookSlot ? "default" : "outline"}
            className={`w-full font-bold text-base h-12 rounded-xl transition-all ${!quickBookSlot ? 'group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary' : 'shadow-md'}`}
            onClick={() => quickBookSlot ? handleQuickBook(service.id, quickBookSlot) : handleSelectService(service.id)}
          >
            {quickBookSlot ? "Brzo zakazivanje" : "Izaberi termin"}
          </Button>
        </CardFooter>
      </Card>
    );
  };

  return (
    <Layout>
      <div className="w-full bg-background border-b border-border/50">
        <div className="container mx-auto px-4 py-8 md:py-12">
          {/* Top Section */}
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 items-start">
             <div className="w-full lg:w-[55%] xl:w-[60%]">
                <SalonGallery media={mediaItems} salonName={salonData.name} />
             </div>

              <div className="relative w-full lg:w-[45%] xl:w-[40%] flex flex-col justify-center space-y-8 lg:pt-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge className="bg-primary text-primary-foreground hover:bg-primary/90 border-none px-3 py-1 text-xs">Salon</Badge>
                  {salonData.featured && <Badge className="bg-amber-100 text-amber-800 border-none px-3 py-1 text-xs">Istaknuto</Badge>}
                  {salonData.topSalon && <Badge className="bg-rose-100 text-rose-800 border-none px-3 py-1 text-xs">Top Salon</Badge>}
                  {salonData.instantBooking && <Badge className="bg-emerald-100 text-emerald-800 border-none px-3 py-1 text-xs">Instant zakazivanje</Badge>}
                </div>

                 <div>
                  <div className="flex flex-wrap items-baseline gap-4 mb-4">
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-bold flex items-center gap-2 tracking-tight">
                      {salonData.name}
                       {salonData.isVerified && <Badge className="gap-1.5 bg-primary/10 px-2.5 py-1 text-sm text-primary hover:bg-primary/15"><ShieldCheck className="h-4 w-4" />Verifikovan</Badge>}
                    </h1>
                  </div>
                   {user?.role === "CUSTOMER" && (
                     <SalonFavoriteButton salonId={salonData.id} className="absolute right-4 top-4 md:static md:mt-2 md:mb-6" />
                   )}

                  <button
                    type="button"
                    onClick={() => {
                      const reviews = document.getElementById("reviews");
                      if (!reviews) return;
                      window.scrollTo({ top: Math.max(0, reviews.getBoundingClientRect().top + window.scrollY - 88), behavior: "smooth" });
                    }}
                    className="flex items-center gap-2 text-lg font-medium hover:text-primary transition-colors group mb-2"
                  >
                    <div className="flex items-center">
                      <Star className="w-6 h-6 fill-accent text-accent" />
                      <span className="ml-1.5 text-xl font-bold text-foreground">{salonData.rating.toFixed(1)}</span>
                    </div>
                    <span className="text-muted-foreground text-base group-hover:underline decoration-dotted underline-offset-4">
                      ({salonData.reviewCount} recenzija)
                    </span>
                  </button>
                   {salonData.returnClientRate !== null && salonData.returnClientRate > 0 && (
                     <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 border border-emerald-100">
                       <Heart className="h-4 w-4 fill-emerald-600 text-emerald-600" />
                       {salonData.returnClientRate}% klijenata se vraća
                     </div>
                   )}
                </div>

                <p className="text-muted-foreground text-lg leading-relaxed max-w-xl">
                  {salonData.description}
                </p>

                <div className="flex flex-col gap-4 pt-6 border-t border-border/60">
                  <div className="flex items-center gap-4 text-foreground font-medium text-lg">
                    <div className="w-12 h-12 rounded-full bg-primary/5 flex items-center justify-center shrink-0 border border-primary/10">
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <span>{salonData.city}, {salonData.municipality}</span>
                  </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="container mx-auto flex gap-1 overflow-x-auto px-4 py-3 no-scrollbar">
          {profileSections.filter(({ id }) => id !== "popular-services" || salonData.topServices.length > 0).map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                activeSection === section.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 md:py-16 flex flex-col lg:flex-row gap-12 lg:gap-16 relative">
        
        {/* Left Column: Services & Staff */}
        <div className="flex-1 space-y-20">
          
           {salonData.topServices.length > 0 && (
            <section id="popular-services">
              <h2 className="text-3xl font-serif font-bold mb-8 flex items-center gap-3">
                <span className="w-10 h-1.5 bg-primary inline-block rounded-full"></span>
                <Flame className="w-6 h-6 text-primary" />
                Popularne usluge
              </h2>
              {salonData.topServices.length === 1 ? (
                <div className="w-full max-w-[520px]">{renderTopServiceCard(salonData.topServices[0])}</div>
              ) : (
                <DiscoveryCarousel ariaLabel="Popularne usluge" itemClassName="basis-[88%] sm:basis-2/3 md:basis-2/3 lg:!basis-2/3 xl:!basis-2/3">
                  {salonData.topServices.map(renderTopServiceCard)}
                </DiscoveryCarousel>
              )}
            </section>
          )}

          <section id="services">
            <h2 className="text-3xl font-serif font-bold mb-8 flex items-center gap-3">
              <span className="w-10 h-1.5 bg-primary inline-block rounded-full"></span>
              Sve usluge
            </h2>
            <div className="mb-6 flex gap-2 overflow-x-auto pb-2 lg:hidden no-scrollbar">
              {Object.keys(servicesByCategory).map((category) => (
                <button key={category} type="button" onClick={() => scrollToSection(serviceCategoryAnchor(category))} className="shrink-0 rounded-full border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:border-primary hover:text-primary">
                  {category}
                </button>
              ))}
            </div>
            <div className="grid items-start gap-8 lg:grid-cols-[190px_minmax(0,680px)]">
              <aside className="hidden lg:block">
                <div className="sticky top-28 rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
                  <p className="px-3 pb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Kategorije</p>
                  <div className="space-y-1">
                    {Object.keys(servicesByCategory).map((category) => (
                      <button key={category} type="button" onClick={() => scrollToSection(serviceCategoryAnchor(category))} className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-bold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary">
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
              <div className="w-full max-w-[680px] space-y-10">
              {Object.entries(servicesByCategory).map(([category, services]) => (
                <div id={serviceCategoryAnchor(category)} key={category} className="scroll-mt-36">
                  <div className="mb-1 flex items-baseline justify-between border-b border-border/70 pb-4">
                    <h3 className="text-2xl font-serif font-bold text-foreground">{category}</h3>
                    <span className="text-sm text-muted-foreground">{services.length} {services.length === 1 ? "usluga" : "usluge"}</span>
                  </div>
                  <div className="divide-y divide-border/70">
                    {services.map(service => {
                      const quickBookSlot = firstAvailableResponse?.services?.find(s => s.serviceId === service.id);
                      const isExpanded = expandedServiceId === service.id;
                      const promotionalPrice = service.promoPrice ?? null;
                      const hasPromotion = promotionalPrice !== null && promotionalPrice < service.price;
                      return (
                        <div
                          key={service.id} 
                          role="button"
                          tabIndex={0}
                          aria-pressed={selectedService === service.id}
                          className={`w-full px-1 py-5 text-left transition-colors sm:px-2 ${selectedService === service.id ? 'bg-primary/5' : 'hover:bg-muted/45'}`}
                          onClick={() => handleSelectService(service.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleSelectService(service.id);
                            }
                          }}
                        >
                          <div className="flex items-start justify-between gap-5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <h4 className="font-semibold leading-snug text-foreground">{service.name}</h4>
                                {popularServiceIds.has(service.id) && <Badge variant="secondary" className="h-5 rounded-full bg-primary/10 px-2 text-[10px] font-bold text-primary">Popularno</Badge>}
                                {service.description && (
                                  <button
                                    type="button"
                                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                                    onClick={(event) => { event.stopPropagation(); setExpandedServiceId(isExpanded ? null : service.id); }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setExpandedServiceId(isExpanded ? null : service.id);
                                      }
                                    }}
                                  >
                                    {isExpanded ? "Sakrij" : "Detaljnije"}
                                  </button>
                                )}
                              </div>
                              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />{service.durationMinutes} min</p>
                              {isExpanded && service.description && <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{service.description}</p>}
                              {service.packageTreatments ? <p className="mt-2 text-xs font-semibold text-primary">Paket od {service.packageTreatments} tretmana</p> : null}
                            </div>
                            <div className="shrink-0 pt-0.5 text-right">
                              {hasPromotion && <p className="text-xs text-muted-foreground line-through">{service.price} RSD</p>}
                              <p className={`text-lg font-bold leading-tight ${hasPromotion ? "text-primary" : "text-foreground"}`}>{hasPromotion && promotionalPrice !== null ? promotionalPrice : service.price} RSD</p>
                            </div>
                          </div>
                          {quickBookSlot && quickBookSlot.date && quickBookSlot.startTime && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs">
                              <span className="text-muted-foreground">Prvi slobodan: <span className="font-semibold text-foreground">{format(parseISO(quickBookSlot.date), 'dd.MM.')} u {quickBookSlot.startTime}</span></span>
                              <button
                                type="button"
                                className="font-semibold text-primary underline-offset-4 hover:underline"
                                onClick={(event) => { event.stopPropagation(); handleQuickBook(service.id, quickBookSlot); }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleQuickBook(service.id, quickBookSlot);
                                  }
                                }}
                              >
                                Brzo zakaži
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </section>

          <section id="staff">
            <h2 className="text-3xl font-serif font-bold mb-8 flex items-center gap-3">
              <span className="w-10 h-1.5 bg-primary inline-block rounded-full"></span>
              Naš tim
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {eligibleStaff.map(employee => (
                <div 
                  key={employee.id} 
                  className={`p-6 rounded-2xl border transition-all cursor-pointer flex items-start gap-5 bg-card shadow-sm ${selectedEmployee === employee.id ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border/60 hover:border-primary/40 hover:shadow-md'}`}
                  onClick={() => selectEmployee(selectedEmployee === employee.id ? null : employee.id)}
                >
                  <OptimizedImage src={employee.avatarUrl || "https://i.pravatar.cc/150"} alt={employee.name} width={80} height={80} className="w-20 h-20 rounded-full object-cover border-4 border-background shadow-md shrink-0" />
                   <div className="min-w-0 flex-1 pt-1">
                    <h4 className="font-bold text-xl text-foreground">{employee.name}</h4>
                    <p className="text-sm font-medium text-primary mt-1">{employee.role}</p>
                     {employee.specialties?.length ? <p className="mt-2 text-sm text-muted-foreground leading-snug">{employee.specialties.join(" · ")}</p> : null}
                  </div>
                   {user?.role === "CUSTOMER" && (
                     <button 
                       className="p-2.5 hover:bg-muted rounded-full transition-colors shrink-0 -mt-2 -mr-2" 
                       aria-label={`Omiljeni zaposleni ${employee.name}`} 
                       onClick={(event) => { event.stopPropagation(); setFavorite(employee.id).catch(() => toast.error("Omiljeni zaposleni nije sačuvan.")); }}
                     >
                       <Heart className={`h-6 w-6 transition-colors ${favoriteEmployeeId === employee.id ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                     </button>
                   )}
                </div>
              ))}
            </div>
          </section>

          <section id="reviews">
             <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
               <h2 className="text-3xl font-serif font-bold flex items-center gap-3">
                 <span className="w-10 h-1.5 bg-primary inline-block rounded-full"></span>
                 Iskustva klijenata
               </h2>
               {user?.role === "CUSTOMER" && !isLoadingReviewContext && (reviewContext?.review || reviewContext?.eligibleServices.length) ? (
                 <Button variant={reviewContext.review ? "outline" : "default"} size="lg" className="rounded-xl font-bold shadow-sm" onClick={openReviewDialog}>
                   <Star className={`mr-2 h-5 w-5 ${reviewContext.review ? 'text-primary' : ''}`} />
                   {reviewContext.review ? "Izmeni recenziju" : "Ostavite recenziju"}
                 </Button>
               ) : null}
             </div>
             <div className="space-y-5">
              {salonData.reviews?.map(review => (
                <div key={review.id} className="p-8 rounded-3xl border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center gap-4">
                      {review.avatarUrl ? (
                        <OptimizedImage src={review.avatarUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover shadow-sm ring-2 ring-background" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg ring-2 ring-background">
                          {review.authorName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <span className="font-bold text-foreground block text-lg">{review.authorName}</span>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-0.5">
                          <span>{format(parseISO(review.date), 'dd.MM.yyyy')}</span>
                          {review.verifiedBooking && <span className="inline-flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md"><ShieldCheck className="h-4 w-4" />Proverena poseta</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-muted/30 px-3 py-1.5 rounded-lg border border-border/50">
                      {Array(5).fill(0).map((_, i) => (
                        <Star key={i} className={`w-4 h-4 ${i < review.rating ? 'fill-accent text-accent' : 'text-muted-foreground/30'}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-foreground text-base mb-4 leading-relaxed font-medium">"{review.text}"</p>
                  <div className="text-xs text-primary font-bold inline-flex items-center bg-primary/10 px-3 py-1.5 rounded-lg">
                    Usluga: {review.serviceName}
                  </div>
                </div>
              ))}
              {(!salonData.reviews || salonData.reviews.length === 0) && (
                <div className="p-12 text-center border border-dashed rounded-3xl bg-muted/20 text-muted-foreground">
                  <Star className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="font-medium text-lg">Još uvek nema recenzija za ovaj salon.</p>
                  <p className="text-sm mt-2 max-w-md mx-auto">Budite prvi koji će podeliti svoje iskustvo nakon posete.</p>
                </div>
              )}
            </div>
          </section>

          <section id="faq">
            <h2 className="text-3xl font-serif font-bold mb-8 flex items-center gap-3">
              <span className="w-10 h-1.5 bg-primary inline-block rounded-full"></span>
              Često postavljana pitanja
            </h2>
            <Accordion type="single" collapsible className="w-full space-y-4">
              <AccordionItem value="item-1" className="border rounded-2xl px-6 bg-card data-[state=open]:border-primary/30 data-[state=open]:shadow-sm transition-all">
                <AccordionTrigger className="hover:no-underline text-left font-bold text-lg py-5">Kako da pronađem prvi slobodan termin?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-5">
                  Uz svaku uslugu prikazujemo prvi pronađeni slobodan termin. Kliknite na „Brzo zakazivanje”, a zatim još jednom proveravamo da li je termin i dalje dostupan pre potvrde.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2" className="border rounded-2xl px-6 bg-card data-[state=open]:border-primary/30 data-[state=open]:shadow-sm transition-all">
                <AccordionTrigger className="hover:no-underline text-left font-bold text-lg py-5">Koji su načini plaćanja dostupni?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-5">
                  {salonData.acceptsCards ? "U ovom salonu možete platiti gotovinom, kao i platnim karticama direktno u salonu." : "Ovaj salon trenutno prihvata isključivo plaćanje gotovinom u salonu. Rezervacija putem platforme je besplatna."}
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3" className="border rounded-2xl px-6 bg-card data-[state=open]:border-primary/30 data-[state=open]:shadow-sm transition-all">
                <AccordionTrigger className="hover:no-underline text-left font-bold text-lg py-5">Kako mogu da zakažem termin?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-5">
                  Izaberite uslugu, zaposlenog po želji i slobodno vreme. Pre potvrde rezervacije videćete ceo pregled termina i cenu usluge.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4" className="border rounded-2xl px-6 bg-card data-[state=open]:border-primary/30 data-[state=open]:shadow-sm transition-all">
                <AccordionTrigger className="hover:no-underline text-left font-bold text-lg py-5">Da li mogu da biram kod koga ću zakazati?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-base leading-relaxed pb-5">
                  Naravno. Prilikom zakazivanja, sistem će vam ponuditi sve zaposlene koji obavljaju željenu uslugu. Možete izabrati svog omiljenog stručnjaka, ili ostaviti opciju "Bilo koji zaposleni" za najbrže zakazivanje.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>

          <section id="location">
            <h2 className="text-3xl font-serif font-bold mb-8 flex items-center gap-3">
              <span className="w-10 h-1.5 bg-primary inline-block rounded-full"></span>
              Lokacija i radno vreme
            </h2>
            <div className="grid lg:grid-cols-[1fr_300px] gap-6">
                <div className="h-[400px] rounded-3xl bg-muted/30 border border-dashed flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <MapPin className="w-12 h-12 mb-4 opacity-50" />
                  <p className="font-medium">Salon se nalazi u: {salonData.city}, {salonData.municipality}</p>
                  <p className="text-sm mt-2 max-w-sm">Tačna adresa, mapa i kontakt podaci prikazuju se u vašim terminima nakon zakazivanja.</p>
                </div>
               <Card className="h-full rounded-3xl border-border/60 shadow-sm bg-card overflow-hidden flex flex-col">
                 <div className="bg-primary/5 p-6 border-b border-border/60">
                   <h3 className="font-serif font-bold text-xl flex items-center gap-2 text-foreground">
                     <Clock className="w-5 h-5 text-primary" /> Radno vreme
                   </h3>
                 </div>
                 <div className="p-6 space-y-4 flex-1">
                   {salonData.hours.map((hour) => (
                     <div key={hour.day} className="flex justify-between items-center text-base">
                       <span className="font-medium text-muted-foreground">{hour.day}</span>
                       <span className={`font-bold ${hour.closed ? "text-rose-500" : "text-foreground"}`}>
                         {hour.closed ? "Ne radi" : `${hour.open} – ${hour.close}`}
                       </span>
                     </div>
                   ))}
                 </div>
               </Card>
            </div>
          </section>

          {nearbySalons.length > 0 && (
            <section id="nearby-salons" className="pt-8 border-t border-border/60">
              <h2 className="text-3xl font-serif font-bold mb-8 flex items-center gap-3">
                <span className="w-10 h-1.5 bg-primary inline-block rounded-full"></span>
                Još salona u blizini
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {nearbySalons.map((nearbySalon: any) => (
                  <Link key={nearbySalon.id} href={`/saloni/${nearbySalon.slug}`} className="group block h-full">
                    <Card className="h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-primary/40 border-border/60 flex flex-col rounded-2xl bg-card">
                      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                        <OptimizedImage
                          src={nearbySalon.imageUrl || "https://images.unsplash.com/photo-1519014816548-bf5fe059c98b?q=80&w=800"}
                          alt={nearbySalon.name}
                          width={640}
                          height={480}
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
                        <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-md text-white px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs font-bold shadow-sm">
                          <Star className="w-3.5 h-3.5 fill-accent text-accent" />
                          <span>{nearbySalon.rating.toFixed(1)}</span>
                        </div>
                      </div>
                      <CardContent className="p-5 flex flex-col flex-1">
                        <h3 className="font-serif font-bold text-lg leading-tight mb-2 group-hover:text-primary transition-colors">{nearbySalon.name}</h3>
                        <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-auto">
                          <MapPin className="w-4 h-4 shrink-0 text-primary/70" />
                          <span className="truncate">{nearbySalon.city}, {nearbySalon.municipality}</span>
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Booking Widget */}
        <div className="hidden lg:block w-[400px] shrink-0">
          <div className="sticky top-24 pt-4" id="booking-widget">
            <BookingWidget 
              salon={salonData}
              user={user}
              eligibleStaff={eligibleStaff}
              selectedService={selectedService}
              setSelectedService={setSelectedService}
              selectedEmployee={selectedEmployee}
              setSelectedEmployee={selectEmployee}
              isAnyEmployeeSelected={employeeSelection === "any"}
              favoriteEmployeeId={favoriteEmployeeId}
              setFavorite={setFavorite}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              selectedSlot={selectedSlot}
              setSelectedSlot={setSelectedSlot}
              availability={availability}
              isLoadingAvailability={isLoadingAvailability || !!quickBookTarget}
              onBook={handleBook}
              isBooking={createAppointment.isPending}
              isSuccess={isSuccess}
              bookingStatus={bookingStatus}
              onViewAppointments={() => setLocation("/moj-nalog")}
              step={bookingStep}
              setStep={setBookingStep}
              hasInteractedWithEmployee={hasInteractedWithEmployee}
              setHasInteractedWithEmployee={setHasInteractedWithEmployee}
              className="rounded-3xl shadow-xl border-border/60 max-h-[calc(100vh-8rem)]"
            />
          </div>
        </div>
      </div>
      
      {/* Mobile Booking Elements */}
      <div className="lg:hidden">
      <MobileBookingTrigger 
          salon={salonData} 
          selectedService={selectedService} 
          selectedSlot={selectedSlot} 
          onOpen={() => setIsMobileDrawerOpen(true)} 
        />
      <MobileBookingDrawer isOpen={isMobileDrawerOpen} onClose={() => setIsMobileDrawerOpen(false)}>
           <BookingWidget 
              salon={salonData}
              user={user}
              eligibleStaff={eligibleStaff}
              selectedService={selectedService}
              setSelectedService={setSelectedService}
              selectedEmployee={selectedEmployee}
              setSelectedEmployee={selectEmployee}
              isAnyEmployeeSelected={employeeSelection === "any"}
              favoriteEmployeeId={favoriteEmployeeId}
              setFavorite={setFavorite}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              selectedSlot={selectedSlot}
              setSelectedSlot={setSelectedSlot}
              availability={availability}
              isLoadingAvailability={isLoadingAvailability || !!quickBookTarget}
              onBook={handleBook}
              isBooking={createAppointment.isPending}
              isSuccess={isSuccess}
              bookingStatus={bookingStatus}
              onViewAppointments={() => {
                setIsMobileDrawerOpen(false);
                setLocation("/moj-nalog");
              }}
              step={bookingStep}
              setStep={setBookingStep}
              hasInteractedWithEmployee={hasInteractedWithEmployee}
              setHasInteractedWithEmployee={setHasInteractedWithEmployee}
              onCloseMobile={() => setIsMobileDrawerOpen(false)}
              className="h-auto min-h-full border-0 rounded-none shadow-none"
            />
      </MobileBookingDrawer>
      <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Gde želite tretman?</DialogTitle>
            <DialogDescription>Izaberite lokaciju pre slanja zahteva za termin.</DialogDescription>
          </DialogHeader>
          {(() => {
            const service = salonData.services.find((item) => item.id === selectedService);
            const basePrice = service?.promoPrice ?? service?.price ?? 0;
            const travelFee = service?.homeServiceFee ?? 0;
            const needsPhoneVerification = !user?.phone && !phoneVerifiedForBooking;
            return <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setTreatmentLocation("salon")} className={`rounded-xl border p-4 text-left transition-colors ${treatmentLocation === "salon" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40"}`}>
                  <MapPin className="mb-2 h-5 w-5 text-primary" /><p className="font-semibold">U salonu</p><p className="mt-1 text-xs text-muted-foreground">Tretman na adresi salona.</p>
                </button>
                <button type="button" onClick={() => setTreatmentLocation("home")} className={`rounded-xl border p-4 text-left transition-colors ${treatmentLocation === "home" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:border-primary/40"}`}>
                  <House className="mb-2 h-5 w-5 text-primary" /><p className="font-semibold">Na mojoj adresi</p><p className="mt-1 text-xs text-muted-foreground">Salon potvrđuje zahtev.</p>
                </button>
              </div>
              {treatmentLocation === "home" ? <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                <div className="flex gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 text-primary" /><p>Salon pokriva do <strong>{salonData.homeServiceRadiusKm} km</strong>. Adresa se proverava pri potvrdi termina i nije javna.</p></div>
                <div className="space-y-2"><Label htmlFor="home-address">Ulica i broj</Label><Input id="home-address" value={homeAddress.line1} onChange={(event) => setHomeAddress({ ...homeAddress, line1: event.target.value })} placeholder="npr. Knez Mihailova 10" /></div>
                <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="home-city">Grad</Label><Input id="home-city" value={homeAddress.city} onChange={(event) => setHomeAddress({ ...homeAddress, city: event.target.value })} placeholder={salonData.city} /></div><div className="space-y-2"><Label htmlFor="home-postal">Poštanski broj</Label><Input id="home-postal" value={homeAddress.postalCode} onChange={(event) => setHomeAddress({ ...homeAddress, postalCode: event.target.value })} /></div></div>
                <div className="space-y-2"><Label htmlFor="home-details">Sprat, interfon ili napomena <span className="text-muted-foreground">(opciono)</span></Label><Textarea id="home-details" value={homeAddress.details} onChange={(event) => setHomeAddress({ ...homeAddress, details: event.target.value })} /></div>
                {needsPhoneVerification ? <div className="space-y-3 rounded-lg border border-primary/20 bg-background p-3">
                  <div className="flex gap-2 text-sm"><Smartphone className="mt-0.5 h-4 w-4 text-primary" /><p>Potvrdite broj telefona SMS kodom pre slanja zahteva.</p></div>
                  <div className="flex gap-2"><Input value={verificationPhone} onChange={(event) => setVerificationPhone(event.target.value)} placeholder="+381 6x..." /><Button type="button" variant="outline" onClick={requestPhoneCode} disabled={isVerifyingPhone}>Pošalji kod</Button></div>
                  {phoneCodeRequested ? <div className="flex gap-2"><Input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="Šestocifreni kod" /><Button type="button" onClick={confirmPhoneCode} disabled={isVerifyingPhone}>{isVerifyingPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : "Potvrdi"}</Button></div> : null}
                </div> : null}
              </div> : null}
              <div className="rounded-xl bg-primary/5 p-4 text-sm"><div className="flex justify-between"><span>Usluga</span><strong>{basePrice} RSD</strong></div>{treatmentLocation === "home" ? <div className="mt-2 flex justify-between"><span>Naknada za dolazak</span><strong>{travelFee} RSD</strong></div> : null}<div className="mt-3 flex justify-between border-t pt-3 text-base"><span>Ukupno</span><strong>{basePrice + (treatmentLocation === "home" ? travelFee : 0)} RSD</strong></div>{treatmentLocation === "home" && service?.homeServiceMinimumOrder ? <p className="mt-2 text-xs text-muted-foreground">Minimalna vrednost usluge za dolazak: {service.homeServiceMinimumOrder} RSD.</p> : null}</div>
              <Button className="w-full" onClick={() => submitBooking(treatmentLocation)} disabled={createAppointment.isPending || (treatmentLocation === "home" && (!homeAddress.line1.trim() || !homeAddress.city.trim() || needsPhoneVerification))}>{createAppointment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{treatmentLocation === "home" ? "Pošalji zahtev za dolazak" : "Potvrdi rezervaciju"}</Button>
            </div>;
          })()}
        </DialogContent>
      </Dialog>
      </div>

      <Dialog open={isReviewDialogOpen} onOpenChange={(open) => !open && setIsReviewDialogOpen(false)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{reviewContext?.review ? "Izmenite recenziju" : "Podelite svoje iskustvo"}</DialogTitle>
            <DialogDescription>
              Podelite svoje iskustvo iz salona {salonData.name}. Vaše mišljenje pomaže drugima da donesu pravu odluku.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-6">
             <div className="space-y-3">
                <Label>Usluga koju ste koristili</Label>
                <Select value={reviewServiceName} onValueChange={setReviewServiceName}>
                  <SelectTrigger id="review-service">
                    <SelectValue placeholder="Izaberite uslugu" />
                  </SelectTrigger>
                  <SelectContent>
                    {reviewServiceOptions.map(option => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
             </div>

             <div className="space-y-3">
               <Label>Ocena (1-5)</Label>
               <div className="flex gap-2">
                 {[1, 2, 3, 4, 5].map((star) => (
                   <button 
                     key={star} 
                     type="button" 
                     className="p-2 -m-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full transition-transform hover:scale-110"
                     onClick={() => setReviewRating(star)}
                      aria-label={`${star} od 5 zvezdica`}
                   >
                     <Star className={`w-8 h-8 ${star <= reviewRating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                   </button>
                 ))}
               </div>
             </div>

             <div className="space-y-3">
               <Label>Vaš utisak</Label>
               <Textarea 
                  id="review-text"
                 placeholder="Sve je bilo odlično, veoma sam zadovoljan/na uslugom..." 
                 value={reviewText} 
                 onChange={(e) => setReviewText(e.target.value)}
                 className="min-h-[120px] resize-none" 
               />
             </div>

             <div className="flex items-start gap-3 bg-muted/30 p-4 rounded-xl border">
               <Checkbox 
                 id="show-photo" 
                 checked={showProfilePhoto} 
                 onCheckedChange={(checked) => setShowProfilePhoto(checked === true)} 
                 className="mt-1"
               />
               <div className="space-y-1.5 leading-none">
                 <Label htmlFor="show-photo" className="font-medium cursor-pointer">Prikaži moju profilnu sliku uz recenziju</Label>
                 <p className="text-sm text-muted-foreground leading-snug">Ukoliko ne izaberete ovu opciju, biće prikazani samo inicijali vašeg imena.</p>
               </div>
             </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
             {reviewContext?.review && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" type="button" className="w-full sm:w-auto sm:mr-auto">Obriši recenziju</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Obrisati recenziju?</AlertDialogTitle>
                      <AlertDialogDescription>Ova akcija trajno uklanja vašu recenziju i ne može da se opozove.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Zadrži recenziju</AlertDialogCancel>
                      <AlertDialogAction onClick={deleteReview} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Obriši recenziju</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
             )}
              <Button variant="outline" onClick={() => setIsReviewDialogOpen(false)} className="w-full sm:w-auto">Otkaži</Button>
             <Button onClick={saveReview} disabled={!reviewServiceName || !reviewText.trim() || upsertReview.isPending} className="w-full sm:w-auto font-bold">
               {upsertReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sačuvaj recenziju
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
