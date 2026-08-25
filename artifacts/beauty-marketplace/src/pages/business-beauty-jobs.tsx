import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import {
  useListMyBeautyJobs,
  getListMyBeautyJobsQueryKey,
  useListSavedBeautyJobs,
  getListSavedBeautyJobsQueryKey,
  useListBeautyJobInbox,
  getListBeautyJobInboxQueryKey,
  useListBeautyJobNotifications,
  getListBeautyJobNotificationsQueryKey,
  useListMyBeautyJobRentalRequests,
  getListMyBeautyJobRentalRequestsQueryKey,
  useListBeautyJobRentalRequestInbox,
  getListBeautyJobRentalRequestInboxQueryKey,
  useRespondToBeautyJobRentalRequest,
  useCloseBeautyJob,
  useRenewBeautyJob,
  useToggleSavedBeautyJob,
  useReplyToBeautyJobContact,
  useMarkBeautyJobNotificationRead,
  BeautyJobListing,
  BeautyJobContact,
  useGetCurrentUser
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { BusinessLayout } from "@/components/business-layout";
import { BeautyJobCard } from "@/components/beauty-jobs/beauty-job-card";
import { BeautyJobForm } from "@/components/beauty-jobs/beauty-job-form";
import { RentalRequestList } from "@/components/beauty-jobs/rental-request-list";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, MessageSquare, Bookmark, Bell, Edit, RotateCcw, XCircle, CornerDownRight, CalendarClock } from "lucide-react";
import { toast } from "sonner";

export default function BusinessBeautyJobsPage() {
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const requestedTab = searchParams.get("tab");
  const requestedListingId = searchParams.get("listingId");
  const requestedContactId = searchParams.get("contactId");
  const [activeTab, setActiveTab] = useState(
    requestedTab === "saved" || requestedTab === "inbox" || requestedTab === "rentals" || requestedTab === "notifications"
      ? requestedTab
      : "my-jobs",
  );
  const [editingJob, setEditingJob] = useState<BeautyJobListing | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const { data: currentUser } = useGetCurrentUser();
  
  const { data: myJobs, isLoading: isLoadingMyJobs } = useListMyBeautyJobs({ query: { queryKey: getListMyBeautyJobsQueryKey() } });
  const { data: savedJobs, isLoading: isLoadingSaved } = useListSavedBeautyJobs({ query: { queryKey: getListSavedBeautyJobsQueryKey() } });
  const { data: inbox, isLoading: isLoadingInbox } = useListBeautyJobInbox({ query: { queryKey: getListBeautyJobInboxQueryKey() } });
  const { data: notifications, isLoading: isLoadingNotifications } = useListBeautyJobNotifications({ query: { queryKey: getListBeautyJobNotificationsQueryKey() } });
  const { data: sentRentalRequests, isLoading: isLoadingSentRentalRequests } = useListMyBeautyJobRentalRequests({ query: { queryKey: getListMyBeautyJobRentalRequestsQueryKey() } });
  const { data: receivedRentalRequests, isLoading: isLoadingReceivedRentalRequests } = useListBeautyJobRentalRequestInbox({ query: { queryKey: getListBeautyJobRentalRequestInboxQueryKey() } });

  const closeMutation = useCloseBeautyJob();
  const renewMutation = useRenewBeautyJob();
  const toggleSaved = useToggleSavedBeautyJob();
  const replyMutation = useReplyToBeautyJobContact();
  const markReadMutation = useMarkBeautyJobNotificationRead();
  const respondRentalMutation = useRespondToBeautyJobRentalRequest();
  const [respondingRequestId, setRespondingRequestId] = useState<string>();

  useEffect(() => {
    if (requestedTab === "my-jobs" || requestedTab === "saved" || requestedTab === "inbox" || requestedTab === "rentals" || requestedTab === "notifications") {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    if (!requestedListingId || !myJobs?.items) return;
    const requestedListing = myJobs.items.find((job) => job.id === requestedListingId);
    if (!requestedListing) return;
    setActiveTab("my-jobs");
    setEditingJob(requestedListing);
    setIsFormOpen(true);
  }, [myJobs?.items, requestedListingId]);

  useEffect(() => {
    if (!requestedContactId || !inbox?.contacts?.some((contact) => contact.id === requestedContactId)) return;
    setActiveTab("inbox");
    const timeout = window.setTimeout(() => {
      document.getElementById(`beauty-job-contact-${requestedContactId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [inbox?.contacts, requestedContactId]);

  const handleToggleSaved = (jobId: string, currentState: boolean) => {
    toggleSaved.mutate({ listingId: jobId }, {
      onSuccess: () => {
        toast.success(currentState ? "Oglas uklonjen iz sačuvanih." : "Oglas sačuvan.");
        queryClient.invalidateQueries({ queryKey: getListSavedBeautyJobsQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške.")
    });
  };

  const [replyContact, setReplyContact] = useState<BeautyJobContact | null>(null);
  const [replyMessage, setReplyMessage] = useState("");
  const [authorStatus, setAuthorStatus] = useState<"pending" | "accepted" | "declined">("pending");

  const handleReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContact) return;
    replyMutation.mutate({ contactId: replyContact.id as string, data: { authorReply: replyMessage, authorStatus } }, {
      onSuccess: () => {
        toast.success("Odgovor uspešno poslat.");
        setReplyContact(null);
        setReplyMessage("");
        queryClient.invalidateQueries({ queryKey: getListBeautyJobInboxQueryKey() });
      },
      onError: () => toast.error("Greška prilikom slanja odgovora.")
    });
  };

  const handleMarkRead = (notificationId: string) => {
    markReadMutation.mutate({ notificationId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBeautyJobNotificationsQueryKey() })
    });
  };

  const handleRentalResponse = (requestId: string, status: "accepted" | "declined") => {
    setRespondingRequestId(requestId);
    respondRentalMutation.mutate({ requestId, data: { status } }, {
      onSuccess: () => {
        toast.success(status === "accepted" ? "Termin je potvrđen." : "Zahtev je odbijen.");
        queryClient.invalidateQueries({ queryKey: getListBeautyJobRentalRequestInboxQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyBeautyJobRentalRequestsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBeautyJobNotificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyBeautyJobsQueryKey() });
      },
      onError: () => toast.error("Zahtev je već obrađen ili termin više nije dostupan."),
      onSettled: () => setRespondingRequestId(undefined),
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Poslovi & Berza</h1>
          <p className="text-muted-foreground">Upravljajte oglasima za posao vašeg salona i ponudama za iznajmljivanje opreme.</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-8 overflow-x-auto w-full justify-start h-12 bg-muted/50 p-1 rounded-xl">
            <TabsTrigger value="my-jobs" className="gap-2 h-10 rounded-lg"><Briefcase className="w-4 h-4" /> Oglasi salona</TabsTrigger>
            <TabsTrigger value="saved" className="gap-2 h-10 rounded-lg"><Bookmark className="w-4 h-4" /> Sačuvano</TabsTrigger>
            <TabsTrigger value="inbox" className="gap-2 h-10 rounded-lg">
              <MessageSquare className="w-4 h-4" /> Inbox
              {inbox?.contacts?.filter((i) => !i.authorReply && i.authorStatus === 'pending').length ? (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                  {inbox.contacts.filter((i) => !i.authorReply && i.authorStatus === 'pending').length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="rentals" className="gap-2 h-10 rounded-lg">
              <CalendarClock className="w-4 h-4" /> Rezervacije
              {receivedRentalRequests?.requests?.filter((request) => request.status === "pending").length ? (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                  {receivedRentalRequests.requests.filter((request) => request.status === "pending").length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2 h-10 rounded-lg">
              <Bell className="w-4 h-4" /> Obaveštenja
              {notifications?.notifications?.filter((n) => !n.readAt).length ? (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                  {notifications.notifications.filter((n) => !n.readAt).length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-jobs" className="space-y-6">
            <div className="flex justify-between items-center bg-card p-4 rounded-xl border shadow-sm">
              <div>
                <h2 className="text-lg font-bold font-serif text-foreground">Vaši aktivni i istekli oglasi</h2>
                <p className="text-sm text-muted-foreground mt-1">Oglasi se automatski zatvaraju nakon 30 dana osim ako ih ne obnovite.</p>
              </div>
              <Button onClick={() => { setEditingJob(null); setIsFormOpen(true); }} className="gap-2 shrink-0">
                <Briefcase className="w-4 h-4" /> Novi oglas
              </Button>
            </div>

            {isLoadingMyJobs ? (
              <div className="space-y-4"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-32 w-full rounded-xl" /></div>
            ) : myJobs?.items?.length === 0 ? (
              <div className="text-center py-16 bg-card border border-dashed rounded-xl shadow-sm">
                <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="font-medium text-lg mb-2">Nemate aktivnih oglasa</h3>
                <p className="text-muted-foreground mb-6">Objavite oglas i pronađite radnike ili ponudite prostor.</p>
                <Button onClick={() => { setEditingJob(null); setIsFormOpen(true); }}>Objavi prvi oglas</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {myJobs?.items?.map((job) => (
                  <div key={job.id} className="relative group">
                    <BeautyJobCard job={job} showSaveButton={false} />
                    <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-card/95 backdrop-blur p-2 rounded-lg shadow-md border border-primary/10">
                      <Button size="sm" variant="ghost" className="h-8 justify-start text-xs hover:text-primary hover:bg-primary/10" onClick={() => { setEditingJob(job); setIsFormOpen(true); }}>
                        <Edit className="w-3.5 h-3.5 mr-2" /> Izmeni
                      </Button>
                      {job.status === "active" ? (
                        <Button size="sm" variant="ghost" className="h-8 justify-start text-xs text-destructive hover:text-destructive hover:bg-destructive/10" 
                          onClick={() => {
                            if (confirm("Da li ste sigurni da želite da zatvorite ovaj oglas?")) {
                              closeMutation.mutate({ listingId: job.id }, {
                                onSuccess: () => { toast.success("Oglas zatvoren."); queryClient.invalidateQueries({ queryKey: getListMyBeautyJobsQueryKey() }); }
                              });
                            }
                          }}
                        >
                          <XCircle className="w-3.5 h-3.5 mr-2" /> Zatvori
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-8 justify-start text-xs text-primary hover:text-primary hover:bg-primary/10"
                          onClick={() => {
                            renewMutation.mutate({ listingId: job.id }, {
                              onSuccess: () => { toast.success("Oglas uspešno obnovljen na 30 dana."); queryClient.invalidateQueries({ queryKey: getListMyBeautyJobsQueryKey() }); }
                            });
                          }}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-2" /> Obnovi
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="saved" className="space-y-6">
            <h2 className="text-xl font-bold font-serif mb-4">Sačuvani oglasi</h2>
            {isLoadingSaved ? (
              <div className="space-y-4"><Skeleton className="h-32 w-full rounded-xl" /></div>
            ) : savedJobs?.items?.length === 0 ? (
              <div className="text-center py-12 bg-card border border-dashed rounded-xl text-muted-foreground shadow-sm">
                Nemate sačuvanih oglasa.
              </div>
            ) : (
              <div className="space-y-4">
                {savedJobs?.items?.map((job) => (
                  <BeautyJobCard key={job.id} job={job} onClickToggleSaved={() => handleToggleSaved(job.id, true)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inbox" className="space-y-6">
            <h2 className="text-xl font-bold font-serif mb-4">Inbox (Prijave)</h2>
            {isLoadingInbox ? (
              <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /></div>
            ) : inbox?.contacts?.length === 0 ? (
              <div className="text-center py-12 bg-card border border-dashed rounded-xl text-muted-foreground shadow-sm">
                Vaš inbox je prazan.
              </div>
            ) : (
              <div className="space-y-4">
                {inbox?.contacts?.map((contact) => {
                  const isOutgoing = contact.applicantUserId === currentUser?.user?.id;
                  return (
                  <div
                    id={`beauty-job-contact-${contact.id}`}
                    key={contact.id}
                    className={`p-5 rounded-xl border bg-card shadow-sm space-y-4 transition-all hover:border-primary/20 ${requestedContactId === contact.id ? "ring-2 ring-primary ring-offset-2" : ""}`}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <h4 className="font-medium text-foreground text-lg">{isOutgoing ? "Vaš kontakt" : contact.applicantDisplayName}</h4>
                        <p className="text-sm font-medium text-primary">Oglas: {contact.listingTitle}</p>
                      </div>
                      <div className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-md shrink-0">
                        {format(new Date(contact.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}
                      </div>
                    </div>
                    <div className="bg-muted/30 p-4 rounded-lg text-sm text-foreground/90 whitespace-pre-wrap border border-muted">
                      {contact.applicantMessage}
                    </div>
                    {contact.authorReply ? (
                      <div className="pl-4 border-l-2 border-primary/50 mt-4 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <CornerDownRight className="w-3.5 h-3.5" /> {isOutgoing ? "Odgovor autora" : "Vaš odgovor"}
                        </p>
                        <p className="text-sm text-foreground">{contact.authorReply}</p>
                        <Badge variant="outline" className="mt-2 text-xs bg-card">Status kandidata: {contact.authorStatus}</Badge>
                      </div>
                    ) : isOutgoing ? (
                      <Badge variant="outline">Čeka se odgovor autora</Badge>
                    ) : (
                      <div className="pt-2 flex justify-end">
                        <Dialog open={replyContact?.id === contact.id} onOpenChange={(open) => {
                          if (open) { setReplyContact(contact); setReplyMessage(""); setAuthorStatus("pending"); }
                          else setReplyContact(null);
                        }}>
                          <DialogTrigger asChild>
                            <Button size="sm" className="gap-2">
                              <MessageSquare className="w-3.5 h-3.5" /> Odgovori kandidatu
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Odgovorite kandidatu {contact.applicantDisplayName}</DialogTitle>
                            </DialogHeader>
                            <form onSubmit={handleReply} className="space-y-4 pt-4">
                              <div className="space-y-2">
                                <label className="text-sm font-medium">Vaša poruka</label>
                                <Textarea value={replyMessage} onChange={e => setReplyMessage(e.target.value)} required minLength={5} className="min-h-[120px]"/>
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-medium">Status kandidata</label>
                                <Select value={authorStatus} onValueChange={(v: "pending" | "accepted" | "declined") => setAuthorStatus(v)}>
                                  <SelectTrigger><SelectValue/></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pending">Na čekanju</SelectItem>
                                    <SelectItem value="accepted">Prihvaćen</SelectItem>
                                    <SelectItem value="declined">Odbijen</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <DialogFooter>
                                <Button type="submit" disabled={replyMutation.isPending}>{replyMutation.isPending ? "Slanje..." : "Pošalji odgovor"}</Button>
                              </DialogFooter>
                            </form>
                          </DialogContent>
                        </Dialog>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rentals" className="space-y-8">
            <section className="space-y-4">
              <div><h2 className="text-xl font-bold font-serif">Primljeni zahtevi</h2><p className="text-sm text-muted-foreground">Zahtevi korisnika za termine u oglasima salona.</p></div>
              <RentalRequestList requests={receivedRentalRequests?.requests} isLoading={isLoadingReceivedRentalRequests} incoming pendingRequestId={respondingRequestId} onRespond={handleRentalResponse} />
            </section>
            <section className="space-y-4">
              <div><h2 className="text-xl font-bold font-serif">Poslati zahtevi</h2><p className="text-sm text-muted-foreground">Termini koje ste zatražili iz drugih oglasa.</p></div>
              <RentalRequestList requests={sentRentalRequests?.requests} isLoading={isLoadingSentRentalRequests} incoming={false} />
            </section>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <h2 className="text-xl font-bold font-serif mb-4">Sistemska obaveštenja</h2>
            {isLoadingNotifications ? (
              <div className="space-y-4"><Skeleton className="h-16 w-full rounded-xl" /></div>
            ) : notifications?.notifications?.length === 0 ? (
              <div className="text-center py-12 bg-card border border-dashed rounded-xl text-muted-foreground shadow-sm">
                Nemate novih obaveštenja.
              </div>
            ) : (
              <div className="space-y-2">
                {notifications?.notifications?.map((notif) => (
                  <div key={notif.id} className={`flex items-start justify-between p-4 rounded-xl border transition-colors ${notif.readAt ? 'bg-card' : 'bg-primary/5 border-primary/20'}`}>
                    <div className="space-y-1.5">
                      <p className={`text-sm ${notif.readAt ? 'text-foreground/80' : 'text-foreground font-medium'}`}>{notif.title}</p>
                      <p className="text-sm text-muted-foreground">{notif.body}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(notif.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}</p>
                    </div>
                    {!notif.readAt && (
                      <Button size="sm" variant="ghost" onClick={() => handleMarkRead(notif.id)} className="h-8 text-xs text-primary hover:bg-primary/10 hover:text-primary">
                        Označi pročitano
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <BeautyJobForm 
        open={isFormOpen} 
        onCancel={() => { setIsFormOpen(false); setEditingJob(null); }}
        onSuccess={() => { setIsFormOpen(false); setEditingJob(null); queryClient.invalidateQueries({ queryKey: getListMyBeautyJobsQueryKey() }); }}
        initialData={editingJob}
      />
    </BusinessLayout>
  );
}