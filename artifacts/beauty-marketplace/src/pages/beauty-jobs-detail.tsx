import { useState, useEffect } from "react";
import { useRoute, Link, useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import { 
  useGetBeautyJob, 
  getGetBeautyJobQueryKey,
  useGetBeautyJobAdminPreview,
  getGetBeautyJobAdminPreviewQueryKey,
  useContactBeautyJobAuthor,
  useReportBeautyJob,
  useToggleSavedBeautyJob,
  useCreateBeautyJobRentalRequest,
  getListMyBeautyJobRentalRequestsQueryKey,
  useGetCurrentUser
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OptimizedImage } from "@/components/optimized-image";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MapPin, Calendar, Clock, Eye, Bookmark, MessageSquare, ArrowLeft, Briefcase, Scissors, Flag, CheckCircle2, CalendarClock } from "lucide-react";

export default function BeautyJobDetailPage() {
  const [, canonicalParams] = useRoute<{ listingId: string }>("/poslovi/:slug/:listingId");
  const [, legacyParams] = useRoute<{ listingId: string }>("/beauty-poslovi/:listingId");
  const [, adminPreviewParams] = useRoute<{ listingId: string }>("/admin/poslovi/pregled/:listingId");
  const isAdminPreview = !!adminPreviewParams?.listingId;
  const listingId = canonicalParams?.listingId ?? legacyParams?.listingId ?? adminPreviewParams?.listingId;
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const queryClient = useQueryClient();

  const { data: userResp, isLoading: isUserLoading } = useGetCurrentUser();
  const user = userResp?.user;

  useEffect(() => {
    if (!isUserLoading && user?.role === "SALON_EMPLOYEE") {
      setLocation("/zaposleni");
    }
  }, [isUserLoading, user, setLocation]);

  const publicQuery = useGetBeautyJob(listingId ?? "", {
    query: {
      enabled: !!listingId && !isAdminPreview && !isUserLoading && user?.role !== "SALON_EMPLOYEE",
      queryKey: getGetBeautyJobQueryKey(listingId ?? "")
    }
  });
  const adminPreviewQuery = useGetBeautyJobAdminPreview(listingId ?? "", {
    query: {
      enabled: !!listingId && isAdminPreview && !isUserLoading && (user?.role === "ADMIN" || user?.role === "SUPER_ADMIN"),
      queryKey: getGetBeautyJobAdminPreviewQueryKey(listingId ?? "")
    }
  });
  const job = isAdminPreview ? adminPreviewQuery.data : publicQuery.data;
  const isLoading = isAdminPreview ? adminPreviewQuery.isLoading : publicQuery.isLoading;
  const error = isAdminPreview ? adminPreviewQuery.error : publicQuery.error;

  useEffect(() => {
    if (!legacyParams?.listingId || !job) return;
    const slug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "oglas";
    setLocation(`/poslovi/${slug}/${job.id}${searchString}`);
  }, [job, legacyParams?.listingId, searchString, setLocation]);

  const contactMutation = useContactBeautyJobAuthor();
  const reportMutation = useReportBeautyJob();
  const toggleSaved = useToggleSavedBeautyJob();
  const rentalRequestMutation = useCreateBeautyJobRentalRequest();

  const [message, setMessage] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [isContactOpen, setIsContactOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [bookingSlotId, setBookingSlotId] = useState<string | null>(null);
  const [bookingMessage, setBookingMessage] = useState("");

  if (isLoading || isUserLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Skeleton className="h-8 w-32 mb-8" />
          <Skeleton className="w-full aspect-[2/1] rounded-2xl mb-8" />
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !job) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-16 text-center max-w-md">
          <h1 className="text-3xl font-serif font-bold text-primary mb-4">Oglas nije pronađen</h1>
          <p className="text-muted-foreground mb-8">Ovaj oglas ne postoji, obrisan je ili je istekao.</p>
          <Button asChild>
            <Link href={isAdminPreview ? "/admin/poslovi" : "/poslovi"}>
              {isAdminPreview ? "Nazad na moderaciju" : "Nazad na sve poslove"}
            </Link>
          </Button>
        </div>
      </Layout>
    );
  }

  const isJob = job.type === "job" || job.type === "freelance";
  const isOffer = job.intent === "offering";
  const TypeIcon = isJob ? Briefcase : Scissors;

  const intentLabel = isOffer
    ? (job.type === "job" ? "Nudim posao" : job.type === "freelance" ? "Nudim usluge" : "Izdajem")
    : (job.type === "job" ? "Tražim posao" : job.type === "freelance" ? "Tražim usluge" : "Tražim opremu/prostor");

  const handleToggleSaved = () => {
    if (!user) return setLocation("/prijava");
    toggleSaved.mutate({ listingId: job.id }, {
      onSuccess: () => {
        toast.success(job.isSaved ? "Oglas uklonjen iz sačuvanih." : "Oglas sačuvan.");
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobQueryKey(job.id) });
      },
      onError: () => toast.error("Greška prilikom čuvanja.")
    });
  };

  const handleContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setLocation("/prijava");
      return;
    }
    if (!message.trim()) {
      toast.error("Unesite poruku.");
      return;
    }

    contactMutation.mutate({ listingId: job.id, data: { message: message.trim() } }, {
      onSuccess: () => {
        toast.success("Poruka uspešno poslata autoru!");
        setIsContactOpen(false);
        setMessage("");
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobQueryKey(job.id) });
      },
      onError: () => toast.error("Neuspešno slanje poruke.")
    });
  };

  const handleReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) {
      toast.error("Unesite razlog prijave.");
      return;
    }

    reportMutation.mutate({ listingId: job.id, data: { reason: reportReason.trim() } }, {
      onSuccess: () => {
        toast.success("Oglas je prijavljen administratoru.");
        setIsReportOpen(false);
        setReportReason("");
      },
      onError: () => toast.error("Greška prilikom prijave.")
    });
  };

  const handleRentalRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return setLocation("/prijava");
    if (!bookingSlotId) return;
    rentalRequestMutation.mutate({ listingId: job.id, data: { slotId: bookingSlotId, message: bookingMessage.trim() || undefined } }, {
      onSuccess: () => {
        toast.success("Zahtev za termin je poslat autoru.");
        setBookingSlotId(null);
        setBookingMessage("");
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobQueryKey(job.id) });
        queryClient.invalidateQueries({ queryKey: getListMyBeautyJobRentalRequestsQueryKey() });
      },
      onError: () => {
        toast.error("Termin više nije dostupan ili zahtev nije mogao biti poslat.");
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobQueryKey(job.id) });
      }
    });
  };

  return (
    <Layout>
      <div className="bg-secondary/30 border-b">
        <div className="container mx-auto px-4 py-4">
          <Link href={isAdminPreview ? "/admin/poslovi" : "/poslovi"} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> {isAdminPreview ? "Nazad na moderaciju" : "Nazad na poslove"}
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {isAdminPreview && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <strong>Privatni admin pregled.</strong> Ovaj prikaz je dostupan moderatorima bez obzira na javni status oglasa.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Badge variant={isOffer ? "default" : "secondary"}>
            {intentLabel}
          </Badge>
          <Badge variant="outline">{job.categoryName || job.categorySlug}</Badge>
          {isAdminPreview && <Badge variant="secondary">Moderacija: {job.moderationStatus}</Badge>}
          {isAdminPreview && <Badge variant="outline">Status: {job.status}</Badge>}
          {job.status === "closed" && <Badge variant="destructive">Zatvoren</Badge>}
        </div>

        <h1 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-6 leading-tight">
          {job.title}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-6 pb-6 border-b">
          <div className="flex flex-wrap items-center gap-4 sm:gap-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="font-medium text-foreground">{job.city}{job.region ? `, ${job.region}` : ''}</span>
            </div>
            
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-primary" />
              <span>Objavljeno: {format(new Date(job.createdAt), "dd.MM.yyyy.", { locale: srLatn })}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-primary" />
              <span>{job.viewCount} pregleda</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {(!isAdminPreview && user?.role !== "SALON_EMPLOYEE" && !job.isOwner) && (
              <>
                <Button variant={job.isSaved ? "secondary" : "outline"} className="gap-2" onClick={handleToggleSaved}>
                  <Bookmark className={`w-4 h-4 ${job.isSaved ? 'fill-current text-primary' : ''}`} />
                  {job.isSaved ? "Sačuvano" : "Sačuvaj"}
                </Button>
                
                <Dialog open={isContactOpen} onOpenChange={setIsContactOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2" onClick={() => !user && setLocation("/prijava")}>
                      <MessageSquare className="w-4 h-4" /> Kontaktiraj
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Kontaktirajte autora oglasa</DialogTitle>
                      <DialogDescription>
                        Pošaljite poruku autoru {job.authorDisplayName}. Vaša poruka će stići u njihov inbox na platformi.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleContact} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="message">Poruka</Label>
                        <Textarea 
                          id="message" 
                          placeholder="Unesite vašu poruku..." 
                          className="min-h-[120px]"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setIsContactOpen(false)}>Odustani</Button>
                        <Button type="submit" disabled={contactMutation.isPending}>
                          {contactMutation.isPending ? "Slanje..." : "Pošalji poruku"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </>
            )}
            {job.isOwner && (
              <Badge variant="secondary" className="px-3 py-1 text-sm bg-primary/10 text-primary border-0">
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Vaš oglas
              </Badge>
            )}
          </div>
        </div>

        {/* Gallery */}
        {job.photos && job.photos.length > 0 && (
          <div className="my-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="md:col-span-3 aspect-[4/3] md:aspect-[16/9] rounded-xl overflow-hidden bg-muted relative">
                <OptimizedImage
                  src={job.photos[0]}
                  alt="Glavna slika"
                  width={800}
                  height={600}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="hidden md:flex flex-col gap-2 h-full overflow-hidden">
                {job.photos.slice(1, 4).map((photo, idx) => (
                  <div key={idx} className="flex-1 rounded-xl overflow-hidden bg-muted relative min-h-0">
                    <OptimizedImage
                      src={photo}
                      alt={`Slika ${idx + 2}`}
                      width={300}
                      height={200}
                      className="w-full h-full object-cover"
                    />
                    {idx === 2 && job.photos!.length > 4 && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white font-bold text-lg">
                        +{job.photos!.length - 4}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 my-8">
          <div className="md:col-span-2 space-y-8">
            <section>
              <h2 className="text-xl font-bold font-serif mb-4 flex items-center gap-2">
                <TypeIcon className="w-5 h-5 text-primary" /> Detalji
              </h2>
              <div className="prose prose-slate max-w-none text-foreground/90 leading-relaxed whitespace-pre-wrap">
                {job.description}
              </div>
            </section>
            {!isJob && isOffer && (
              <section className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold font-serif flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /> Termini za rezervaciju</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Izaberite konkretan termin. Precizna adresa se ne objavljuje uz oglas.</p>
                </div>
                {job.availableSlots.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/20 p-5 text-sm text-muted-foreground">Trenutno nema budućih termina.</div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {job.availableSlots.map((slot) => (
                      <div key={slot.id} className={`rounded-xl border p-4 ${slot.available ? "bg-card" : "bg-muted/40 opacity-70"}`}>
                        <p className="font-medium capitalize">{format(new Date(slot.startsAt), "EEEE, dd.MM.yyyy.", { locale: srLatn })}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{format(new Date(slot.startsAt), "HH:mm", { locale: srLatn })}–{format(new Date(slot.endsAt), "HH:mm", { locale: srLatn })}</p>
                        <Button className="mt-3 w-full" size="sm" variant={slot.available ? "default" : "secondary"} disabled={isAdminPreview || !slot.available || job.isOwner} onClick={() => {
                          if (!user) setLocation("/prijava");
                          else setBookingSlotId(slot.id);
                        }}>
                          {isAdminPreview ? "Privatni pregled" : slot.available ? (job.isOwner ? "Vaš termin" : "Zatraži termin") : "Rezervisano"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Dialog open={bookingSlotId !== null} onOpenChange={(open) => { if (!open) { setBookingSlotId(null); setBookingMessage(""); } }}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Pošaljite zahtev za termin</DialogTitle>
                      <DialogDescription>Autor će dobiti zahtev i može da ga prihvati ili odbije. Termin postaje rezervisan tek nakon prihvatanja.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleRentalRequest} className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <Label htmlFor="booking-message">Poruka autoru (opciono)</Label>
                        <Textarea id="booking-message" value={bookingMessage} onChange={(event) => setBookingMessage(event.target.value)} maxLength={1000} placeholder="Dodajte kratku napomenu..." />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setBookingSlotId(null)}>Odustani</Button>
                        <Button type="submit" disabled={rentalRequestMutation.isPending}>{rentalRequestMutation.isPending ? "Slanje..." : "Pošalji zahtev"}</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </section>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="p-6 rounded-xl border bg-card/50 shadow-sm">
              <h3 className="font-bold mb-4 uppercase tracking-wider text-xs text-muted-foreground">Informacije</h3>
              
              <dl className="space-y-4">
                {job.priceAmount != null && (
                  <div>
                    <dt className="text-sm text-muted-foreground mb-1">Cena</dt>
                    <dd className="font-medium text-lg text-primary">
                      {job.priceAmount.toLocaleString('sr-RS')} RSD
                      {job.pricePeriod ? ` / ${
                        job.pricePeriod === 'month' ? 'mesec' : 
                        job.pricePeriod === 'week' ? 'nedelja' : 
                        job.pricePeriod === 'day' ? 'dan' : 
                        job.pricePeriod === 'hour' ? 'sat' : 
                        job.pricePeriod === 'project' ? 'projekat' : 'fiksno'
                      }` : ''}
                      {job.negotiable && <span className="block text-xs font-normal text-muted-foreground mt-0.5">Cena po dogovoru</span>}
                    </dd>
                  </div>
                )}
                
                <div>
                  <dt className="text-sm text-muted-foreground mb-1">Autor</dt>
                  <dd className="font-medium">{job.authorDisplayName}</dd>
                </div>

                {job.availabilityPattern && (
                  <div>
                    <dt className="text-sm text-muted-foreground mb-1 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" /> Raspoloživost
                    </dt>
                    <dd className="font-medium">{job.availabilityPattern}</dd>
                  </div>
                )}
                
                {job.dayLabels && job.dayLabels.length > 0 && (
                  <div>
                    <dt className="text-sm text-muted-foreground mb-1">Radni dani</dt>
                    <dd className="font-medium flex flex-wrap gap-1">
                      {job.dayLabels.map((d) => (
                        <Badge key={d} variant="secondary" className="text-xs">{d}</Badge>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            
            {!isAdminPreview && !job.isOwner && (
              <div className="text-center pt-4">
                <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
                  <DialogTrigger asChild>
                    <button className="text-xs text-muted-foreground flex items-center justify-center gap-1.5 hover:text-destructive transition-colors mx-auto">
                      <Flag className="w-3 h-3" /> Prijavi oglas
                    </button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Prijavi oglas</DialogTitle>
                      <DialogDescription>
                        Ako smatrate da ovaj oglas krši pravila platforme, opišite problem administratorima.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleReport} className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="reason">Razlog prijave</Label>
                        <Textarea 
                          id="reason" 
                          placeholder="Opišite zašto prijavljujete ovaj oglas..." 
                          className="min-h-[100px]"
                          value={reportReason}
                          onChange={(e) => setReportReason(e.target.value)}
                        />
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setIsReportOpen(false)}>Odustani</Button>
                        <Button type="submit" variant="destructive" disabled={reportMutation.isPending}>
                          {reportMutation.isPending ? "Slanje..." : "Prijavi"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}