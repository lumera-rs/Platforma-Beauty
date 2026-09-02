import { useState } from "react";
import { 
  useListAdminEducationGraceCenters, 
  useListAdminEducationGraceNotes, 
  useCreateAdminEducationGraceNote, 
  useExtendAdminEducationGrace, 
  useListAdminEducationFinancialAudit, 
  getListAdminEducationGraceCentersQueryKey, 
  getListAdminEducationGraceNotesQueryKey, 
  getListAdminEducationFinancialAuditQueryKey,
  type EducationGraceNote,
  type EducationGraceCenter,
  type EducationFinancialAuditEntry,
  type ListAdminEducationFinancialAuditParams
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, History, MessageSquare, Plus, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);

function GraceNotesDialog({ center, open, onOpenChange }: { center: EducationGraceCenter | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const centerId = center?.center.id;
  const centerName = center?.center.name;

  const { data: notes, isLoading } = useListAdminEducationGraceNotes(centerId || "", { limit: 50 }, { query: { enabled: !!centerId && open, queryKey: getListAdminEducationGraceNotesQueryKey(centerId || "", { limit: 50 }) } });
  const createNoteMut = useCreateAdminEducationGraceNote();
  const [newNote, setNewNote] = useState("");

  const handleAddNote = () => {
    if (!newNote.trim() || !centerId) return;
    createNoteMut.mutate({ centerId, data: { note: newNote } }, {
      onSuccess: () => {
        toast.success("Beleška je dodata.");
        setNewNote("");
        queryClient.invalidateQueries({ queryKey: getListAdminEducationGraceNotesQueryKey(centerId, { limit: 50 }) });
        queryClient.invalidateQueries({ queryKey: getListAdminEducationGraceCentersQueryKey() });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Interne beleške (Grace)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{centerName || "Centar"}</p>
          <ScrollArea className="h-[250px] rounded-md border p-4 bg-muted/20">
            {isLoading ? (
              <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : !notes || notes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nema beleški.</p>
            ) : (
              <div className="space-y-4">
                {notes.map((note: EducationGraceNote) => (
                  <div key={note.id} className="text-sm space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="font-medium">{note.authorFirstName} {note.authorLastName}</span>
                      <span>{new Date(note.createdAt).toLocaleString("sr-RS")}</span>
                    </div>
                    <p className="bg-background border rounded p-2">{note.note}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="space-y-2">
            <Textarea 
              placeholder="Unesite novu belešku..." 
              value={newNote} 
              onChange={(e) => setNewNote(e.target.value)} 
              className="resize-none"
              rows={3}
            />
            <Button className="w-full" size="sm" onClick={handleAddNote} disabled={!newNote.trim() || createNoteMut.isPending}>
              {createNoteMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sačuvaj belešku
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GraceExtensionDialog({ center, open, onOpenChange }: { center: EducationGraceCenter | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const extendMut = useExtendAdminEducationGrace();
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const centerId = center?.center.id;
  const centerName = center?.center.name;

  const handleExtend = () => {
    if (!centerId) return;
    const d = parseInt(days, 10);
    if (isNaN(d) || d < 1 || d > 30) {
      toast.error("Broj dana mora biti između 1 i 30.");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Razlog mora imati barem 3 karaktera.");
      return;
    }
    extendMut.mutate({ centerId, data: { days: d, reason } }, {
      onSuccess: () => {
        toast.success(`Grace period produžen. Preostalo dana: ${d}`);
        queryClient.invalidateQueries({ queryKey: getListAdminEducationGraceCentersQueryKey() });
        onOpenChange(false);
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Produženje Grace Perioda</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">{centerName || "Centar"}</p>
          <div className="space-y-2">
            <Label>Broj dana za produženje</Label>
            <Input type="number" min="1" max="30" value={days} onChange={(e) => setDays(e.target.value)} />
            <p className="text-xs text-muted-foreground">Maksimalno 30 dana.</p>
          </div>
          <div className="space-y-2">
            <Label>Obrazloženje odluke</Label>
            <Textarea 
              placeholder="Razlog produženja..." 
              value={reason} 
              onChange={(e) => setReason(e.target.value)} 
              className="resize-none"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Otkaži</Button>
          <Button onClick={handleExtend} disabled={extendMut.isPending || !reason.trim()}>
            {extendMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Potvrdi produženje
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GraceCentersCard() {
  const { data, isLoading } = useListAdminEducationGraceCenters({ query: { queryKey: getListAdminEducationGraceCentersQueryKey() } });
  const [selectedNotesCenter, setSelectedNotesCenter] = useState<EducationGraceCenter | null>(null);
  const [selectedExtendCenter, setSelectedExtendCenter] = useState<EducationGraceCenter | null>(null);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex gap-2"><Clock className="h-5 w-5 text-primary" />Grace period operacije</CardTitle>
        <CardDescription>
          Upravljanje centrima kojima je pretplata istekla ali se nalaze u zaštitnom grace periodu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nema centara u grace periodu.</p>
        ) : (
          <div className="space-y-3">
            {data.items.map((item: EducationGraceCenter) => {
               const cId = item.center.id;
               const cName = item.center.name;
               const cPhone = item.center.contactPhone;
              return (
                 <div key={cId} className="flex min-w-0 flex-col gap-4 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{cName || "Nepoznat centar"}</p>
                      <Badge variant={item.daysRemaining > 3 ? "outline" : "destructive"}>
                        Preostalo: {item.daysRemaining} dana
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="truncate">Vlasnik: {item.owner?.firstName} {item.owner?.lastName} ({item.owner?.email})</span>
                       <span>Telefon: <span className="font-medium text-foreground">{cPhone || "Nije unet"}</span></span>
                      <span>Dug: <span className="font-medium text-foreground">{money(item.debtRsd)}</span></span>
                       <span>Email: <span className="font-medium text-foreground">{item.latestEmail?.status || "Nema slanja"}</span></span>
                    </div>
                    {item.latestNote && (
                      <div className="mt-2 rounded bg-muted/30 p-2 text-xs text-muted-foreground line-clamp-1 border">
                        <span className="font-medium text-foreground">Poslednja beleška:</span> {item.latestNote.note}
                      </div>
                    )}
                  </div>
                   <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setSelectedNotesCenter(item)}>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Beleške ({item.noteCount})
                    </Button>
                    <Button size="sm" onClick={() => setSelectedExtendCenter(item)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Produži grace
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <GraceNotesDialog 
        center={selectedNotesCenter} 
        open={!!selectedNotesCenter} 
        onOpenChange={(v) => !v && setSelectedNotesCenter(null)} 
      />
      
      <GraceExtensionDialog 
        center={selectedExtendCenter} 
        open={!!selectedExtendCenter} 
        onOpenChange={(v) => !v && setSelectedExtendCenter(null)} 
      />
    </Card>
  );
}

function FinancialAuditCard() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [appliedFilters, setAppliedFilters] = useState<Omit<ListAdminEducationFinancialAuditParams, 'limit' | 'cursor'>>({});
  
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  
  const params: ListAdminEducationFinancialAuditParams = {
    limit: 15,
    ...(cursor ? { cursor } : {}),
    ...appliedFilters
  };

  const { data, isLoading, isFetching } = useListAdminEducationFinancialAudit(
    params,
    { query: { queryKey: getListAdminEducationFinancialAuditQueryKey(params) } }
  );

  const handleNext = () => {
    if (data?.nextCursor) {
      setHistory(prev => [...prev, cursor || ""]);
      setCursor(data.nextCursor);
    }
  };

  const handlePrev = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(h => h.slice(0, -1));
      setCursor(prev || null);
    }
  };

  const handleApply = () => {
    setCursor(null);
    setHistory([]);
    setAppliedFilters({
      ...(action.trim() ? { action: action.trim() } : {}),
      ...(entityType.trim() ? { entityType: entityType.trim() } : {}),
      ...(actorUserId.trim() ? { actorUserId: actorUserId.trim() } : {}),
      ...(fromDate ? { from: new Date(fromDate).toISOString() } : {}),
      ...(toDate ? { to: new Date(toDate).toISOString() } : {}),
    });
  };

  const handleClear = () => {
    setAction("");
    setEntityType("");
    setActorUserId("");
    setFromDate("");
    setToDate("");
    setCursor(null);
    setHistory([]);
    setAppliedFilters({});
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex gap-2"><History className="h-5 w-5 text-primary" />Finansijski Audit (Belgrade Time)</CardTitle>
        <CardDescription>Nepromenljiv dnevnik svih finansijskih transakcija, isplata, promena pretplata i dugovanja u sistemu.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6 grid grid-cols-1 gap-4 rounded-lg border bg-muted/10 p-4 md:grid-cols-3 lg:grid-cols-6 items-end">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Akcija</Label>
            <Input size={1} value={action} onChange={(e) => setAction(e.target.value)} placeholder="npr. order_created" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Entitet</Label>
            <Input size={1} value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="npr. enrollment" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">ID korisnika</Label>
            <Input size={1} value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} placeholder="UUID..." />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Od datuma</Label>
            <Input type="datetime-local" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Do datuma</Label>
            <Input type="datetime-local" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2 md:pt-0">
            <Button className="flex-1" variant="outline" onClick={handleClear}>Očisti</Button>
            <Button className="flex-1" onClick={handleApply}>Primeni</Button>
          </div>
        </div>

        {isLoading && !data ? (
          <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nema audit zapisa.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border overflow-hidden">
               <div className="hidden grid-cols-12 bg-muted/50 p-3 text-xs font-semibold text-muted-foreground gap-4 md:grid">
                 <div className="col-span-3">ZAPIS / AKCIJA</div>
                 <div className="col-span-3">ENTITET</div>
                 <div className="col-span-6">DETALJI</div>
              </div>
              <div className="divide-y max-h-[500px] overflow-y-auto custom-scrollbar">
                {data.items.map((item: EducationFinancialAuditEntry) => (
                   <div key={item.id} className="grid min-w-0 grid-cols-1 p-3 text-sm gap-4 hover:bg-muted/10 transition-colors md:grid-cols-12">
                     <div className="min-w-0 space-y-1 md:col-span-3">
                      <p className="font-medium break-all">{item.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.occurredAt).toLocaleString("sr-RS", { timeZone: item.timeZone || "Europe/Belgrade" })}
                      </p>
                      {item.actor && (
                        <p className="text-xs text-muted-foreground truncate" title={`${item.actor.firstName} ${item.actor.lastName} (${item.actor.email})`}>
                          Od: {item.actor.firstName} {item.actor.lastName}
                        </p>
                      )}
                    </div>
                     <div className="min-w-0 space-y-1 md:col-span-3">
                      <Badge variant="outline" className="truncate block max-w-full font-mono text-[10px]">{item.entityType}</Badge>
                      <p className="text-xs text-muted-foreground truncate" title={item.entityId}>ID: {item.entityId}</p>
                    </div>
                     <div className="min-w-0 md:col-span-6">
                      {item.reason && (
                        <p className="mb-2 text-xs font-medium text-foreground"><span className="text-muted-foreground">Razlog:</span> {item.reason}</p>
                      )}
                      <div className="flex flex-col gap-2 xl:flex-row xl:gap-4">
                        {(item.oldValue || item.newValue) ? (
                          <>
                            <div className="flex-1 rounded border bg-muted/20 p-2 overflow-hidden">
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">Staro stanje</p>
                              <pre className="text-[10px] whitespace-pre-wrap break-all">{item.oldValue ? JSON.stringify(item.oldValue, null, 2) : "null"}</pre>
                            </div>
                            <div className="flex-1 rounded border bg-muted/20 p-2 overflow-hidden">
                              <p className="text-[10px] font-semibold text-primary mb-1 uppercase tracking-wider">Novo stanje</p>
                              <pre className="text-[10px] whitespace-pre-wrap break-all">{item.newValue ? JSON.stringify(item.newValue, null, 2) : "null"}</pre>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">Nema promena u stanju entiteta.</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                {isFetching ? <span className="flex items-center"><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Učitavanje...</span> : "Prikaz aktuelne stranice"}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handlePrev} disabled={history.length === 0 || isFetching}>
                  Prethodna
                </Button>
                <Button size="sm" variant="outline" onClick={handleNext} disabled={!data.nextCursor || isFetching}>
                  Sledeća
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EducationGraceAudit() {
  return (
    <div className="space-y-6">
      <GraceCentersCard />
      <FinancialAuditCard />
    </div>
  );
}
