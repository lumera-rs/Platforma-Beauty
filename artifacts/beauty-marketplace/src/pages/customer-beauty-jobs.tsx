import { useState } from "react";
import { useLocation } from "wouter";
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
  BeautyJobContact
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
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
import { Briefcase, MessageSquare, Bookmark, Bell, Edit, RotateCcw, XCircle, ChevronRight, CornerDownRight, CalendarClock } from "lucide-react";
import { toast } from "sonner";

export default function CustomerBeautyJobsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("my-jobs");
  const [editingJob, setEditingJob] = useState<BeautyJobListing | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  
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
    <Layout>
      <div className="bg-secondary/30 py-8 border-b">
        <div className="container mx-auto px-4">
          <h1 className="text-3xl font-serif font-bold mb-2">Moji oglasi</h1>
          <p className="text-muted-foreground">Upravljajte svojim oglasima, pratite prijave i inbox.</p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-8 overflow-x-auto w-full justify-start h-12">
            <TabsTrigger value="my-jobs" className="gap-2 h-10"><Briefcase className="w-4 h-4" /> Moji oglasi</TabsTrigger>
            <TabsTrigger value="saved" className="gap-2 h-10"><Bookmark className="w-4 h-4" /> Sačuvano</TabsTrigger>
            <TabsTrigger value="inbox" className="gap-2 h-10">
              <MessageSquare className="w-4 h-4" /> Inbox
              {inbox?.contacts?.filter((i) => !i.authorReply && i.authorStatus === 'pending').length ? (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                  {inbox.contacts.filter((i) => !i.authorReply && i.authorStatus === 'pending').length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="rentals" className="gap-2 h-10">
              <CalendarClock className="w-4 h-4" /> Rezervacije
              {receivedRentalRequests?.requests?.filter((request) => request.status === "pending").length ? (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                  {receivedRentalRequests.requests.filter((request) => request.status === "pending").length}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2 h-10">
              <Bell className="w-4 h-4" /> Obaveštenja
              {notifications?.notifications?.filter((n) => !n.readAt).length ? (
                <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                  {notifications.notifications.filter((n) => !n.readAt).length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-jobs" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold font-serif">Vaši aktivni i istekli oglasi</h2>
              <Button onClick={() => { setEditingJob(null); setIsFormOpen(true); }} className="gap-2">
                Novi oglas
              </Button>
            </div>

            {isLoadingMyJobs ? (
              <div className="space-y-4"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-32 w-full rounded-xl" /></div>
            ) : myJobs?.items?.length === 0 ? (
              <div className="text-center py-16 bg-muted/20 border border-dashed rounded-xl">
                <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="font-medium text-lg mb-2">Nemate aktivnih oglasa</h3>
                <p className="text-muted-foreground mb-6">Objavite oglas i pronađite radnike ili salon.</p>
                <Button onClick={() => { setEditingJob(null); setIsFormOpen(true); }}>Objavi prvi oglas</Button>
              </div>
            ) : (
              <div className="space-y-4">
                {myJobs?.items?.map((job) => (
                  <div key={job.id} className="relative group">
                    <BeautyJobCard job={job} showSaveButton={false} />
                    <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 backdrop-blur p-2 rounded-lg shadow-sm border">
                      <Button size="sm" variant="ghost" className="h-8 justify-start text-xs" onClick={() => { setEditingJob(job); setIsFormOpen(true); }}>
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
              <div className="text-center py-12 bg-muted/20 border border-dashed rounded-xl text-muted-foreground">
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
            <h2 className="text-xl font-bold font-serif mb-4">Inbox</h2>
            {isLoadingInbox ? (
              <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /></div>
            ) : inbox?.contacts?.length === 0 ? (
              <div className="text-center py-12 bg-muted/20 border border-dashed rounded-xl text-muted-foreground">
                Vaš inbox je prazan.
              </div>
            ) : (
              <div className="space-y-4">
                {inbox?.contacts?.map((contact) => (
                  <div key={contact.id} className="p-4 rounded-xl border bg-card shadow-sm space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-medium text-foreground">{contact.applicantDisplayName}</h4>
                        <p className="text-sm text-muted-foreground">Povodom: {contact.listingTitle}</p>
                      </div>
                      <div className="text-xs text-muted-foreground">{format(new Date(contact.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}</div>
                    </div>
                    <div className="bg-muted/50 p-3 rounded-lg text-sm text-foreground/90 whitespace-pre-wrap">
                      {contact.applicantMessage}
                    </div>
                    {contact.authorReply ? (
                      <div className="pl-4 border-l-2 border-primary/30 mt-2 space-y-1.5">
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CornerDownRight className="w-3 h-3" /> Vaš odgovor:</p>
                        <p className="text-sm text-foreground">{contact.authorReply}</p>
                        <Badge variant="outline" className="mt-1 text-xs">Status: {contact.authorStatus}</Badge>
                      </div>
                    ) : (
                      <div className="pt-2 flex justify-end">
                        <Dialog open={replyContact?.id === contact.id} onOpenChange={(open) => {
                          if (open) { setReplyContact(contact); setReplyMessage(""); setAuthorStatus("pending"); }
                          else setReplyContact(null);
                        }}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" className="gap-1.5">
                              <MessageSquare className="w-3.5 h-3.5" /> Odgovori
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Odgovorite korisniku {contact.applicantDisplayName}</DialogTitle>
                            </DialogHeader>
                            <form onSubmit={handleReply} className="space-y-4 pt-4">
                              <div className="space-y-2">
                                <Label>Vaša poruka</Label>
                                <Textarea value={replyMessage} onChange={e => setReplyMessage(e.target.value)} required minLength={5} className="min-h-[100px]"/>
                              </div>
                              <div className="space-y-2">
                                <Label>Status kandidata</Label>
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
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rentals" className="space-y-8">
            <section className="space-y-4">
              <div><h2 className="text-xl font-bold font-serif">Poslati zahtevi</h2><p className="text-sm text-muted-foreground">Termini koje ste zatražili iz oglasa.</p></div>
              <RentalRequestList requests={sentRentalRequests?.requests} isLoading={isLoadingSentRentalRequests} incoming={false} />
            </section>
            <section className="space-y-4">
              <div><h2 className="text-xl font-bold font-serif">Primljeni zahtevi</h2><p className="text-sm text-muted-foreground">Zahtevi za termine u vašim rental oglasima.</p></div>
              <RentalRequestList requests={receivedRentalRequests?.requests} isLoading={isLoadingReceivedRentalRequests} incoming pendingRequestId={respondingRequestId} onRespond={handleRentalResponse} />
            </section>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <h2 className="text-xl font-bold font-serif mb-4">Sistemska obaveštenja</h2>
            {isLoadingNotifications ? (
              <div className="space-y-4"><Skeleton className="h-16 w-full rounded-xl" /></div>
            ) : notifications?.notifications?.length === 0 ? (
              <div className="text-center py-12 bg-muted/20 border border-dashed rounded-xl text-muted-foreground">
                Nemate novih obaveštenja.
              </div>
            ) : (
              <div className="space-y-2">
                {notifications?.notifications?.map((notif) => (
                  <div key={notif.id} className={`flex items-start justify-between p-4 rounded-xl border ${notif.readAt ? 'bg-card' : 'bg-primary/5 border-primary/20'}`}>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{notif.title}</p>
                      <p className="text-sm text-muted-foreground">{notif.body}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(notif.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}</p>
                    </div>
                    {!notif.readAt && (
                      <Button size="sm" variant="ghost" onClick={() => handleMarkRead(notif.id)} className="h-8 text-xs text-primary">
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
    </Layout>
  );
}