import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import {
  useListBeautyJobApplicants,
  getListBeautyJobApplicantsQueryKey,
  useDecideBeautyJobApplicants,
  getListMyBeautyJobsQueryKey,
  getListBeautyJobInboxQueryKey,
  getApiErrorDetails,
  getApiErrorMessage,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function BusinessJobApplicants({ listingId }: { listingId: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useListBeautyJobApplicants(listingId, { query: { enabled: true, queryKey: getListBeautyJobApplicantsQueryKey(listingId) } });
  const decideMutation = useDecideBeautyJobApplicants();

  const applicants = data?.applicants || [];
  const actionableStatuses = new Set(["pending", "viewed", "replied"]);
  const selectableApplicants = applicants.filter((applicant) => actionableStatuses.has(applicant.authorStatus));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectTargetIds, setRejectTargetIds] = useState<string[]>([]);
  const [internalNote, setInternalNote] = useState("");

  useEffect(() => {
    setSelectedIds(new Set());
  }, [data, listingId]);

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(selectableApplicants.map(a => a.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const handleDecision = (contactIds: string[], action: 'approve' | 'reject', note?: string) => {
    decideMutation.mutate({ listingId, data: { contactIds, action, internalNote: note } }, {
      onSuccess: () => {
        toast.success(`Uspešno ${action === 'approve' ? 'odobreno' : 'odbijeno'}.`);
        queryClient.invalidateQueries({ queryKey: getListBeautyJobApplicantsQueryKey(listingId) });
        queryClient.invalidateQueries({ queryKey: getListMyBeautyJobsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBeautyJobInboxQueryKey() });
        setIsRejectOpen(false);
        setInternalNote("");
        setSelectedIds(new Set());
      },
      onError: (err: unknown) => {
        const { status } = getApiErrorDetails(err);
        if (status === 409) {
           toast.error("Prijave su već obrađene ili je došlo do promene.", { description: "Podaci su zastareli. Molimo osvežite listu." });
           queryClient.invalidateQueries({ queryKey: getListBeautyJobApplicantsQueryKey(listingId) });
        } else {
           toast.error("Došlo je do greške prilikom obrade.", {
             description: getApiErrorMessage(err, "Pokušajte ponovo."),
           });
        }
      }
    });
  };

  const confirmApprove = (ids: string[]) => {
    if (confirm("Da li ste sigurni da želite da odobrite izabrane prijave?")) {
      handleDecision(ids, 'approve');
    }
  };

  const openReject = (ids: string[]) => {
    setRejectTargetIds(ids);
    setInternalNote("");
    setIsRejectOpen(true);
  };

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;

  if (isError) return (
    <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5" />
        <span className="text-sm font-medium">Došlo je do greške prilikom učitavanja prijava.</span>
      </div>
      <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5 h-8 border-destructive/20 hover:bg-destructive/10 text-destructive">
        <RefreshCw className="w-3.5 h-3.5" /> Pokušaj ponovo
      </Button>
    </div>
  );

  if (applicants.length === 0) return <div className="text-center py-8 text-muted-foreground">Nema prijava za ovaj oglas.</div>;

  const allSelected = selectableApplicants.length > 0 && selectedIds.size === selectableApplicants.length;

  return (
    <div className="space-y-4" data-testid={`applicants-list-${listingId}`}>
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-background p-3 rounded-lg border shadow-sm">
         <div className="flex items-center gap-2 px-2">
           <Checkbox 
             checked={allSelected} 
             onCheckedChange={(c) => toggleAll(!!c)} 
             id={`sel-all-${listingId}`} 
             disabled={selectableApplicants.length === 0}
             data-testid="select-all-applicants"
           />
           <Label htmlFor={`sel-all-${listingId}`} className="cursor-pointer font-medium">Selektuj sve</Label>
         </div>
         <div className="flex flex-wrap gap-2">
           <Button 
             size="sm" 
             variant="outline" 
             disabled={selectedIds.size === 0 || decideMutation.isPending} 
             onClick={() => confirmApprove(Array.from(selectedIds))}
             data-testid="bulk-approve"
           >
             <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" /> Odobri selektovane
           </Button>
           <Button 
             size="sm" 
             variant="outline" 
             disabled={selectedIds.size === 0 || decideMutation.isPending} 
             onClick={() => openReject(Array.from(selectedIds))}
             data-testid="bulk-reject"
           >
             <XCircle className="w-4 h-4 mr-2 text-destructive" /> Odbij selektovane
           </Button>
         </div>
      </div>

      <div className="space-y-3">
         {applicants.map(app => {
           const isActionable = actionableStatuses.has(app.authorStatus);
           return (
             <div key={app.id} className={`flex flex-col sm:flex-row gap-4 p-5 border rounded-xl bg-background items-start transition-colors shadow-sm ${isActionable ? 'hover:border-primary/20' : 'opacity-80'}`}>
               <div className="flex items-center gap-3 w-full sm:w-auto mt-1">
                 <Checkbox 
                   checked={selectedIds.has(app.id)} 
                   onCheckedChange={(c) => toggleOne(app.id, !!c)} 
                   disabled={!isActionable}
                   data-testid={`applicant-checkbox-${app.id}`}
                 />
                 <div className="sm:hidden flex-1 flex justify-between items-center">
                   <span className="font-bold text-sm">{app.applicantDisplayName}</span>
                   <StatusBadge status={app.authorStatus} />
                 </div>
               </div>
               <div className="flex-1 min-w-0 w-full">
                  <div className="hidden sm:flex justify-between items-start mb-1">
                     <h4 className="font-bold text-foreground text-lg">{app.applicantDisplayName}</h4>
                     <StatusBadge status={app.authorStatus} />
                  </div>
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-3">
                    <Clock className="w-3.5 h-3.5" />
                    {format(new Date(app.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}
                  </div>
                  <p className="text-sm text-foreground/90 bg-muted/30 p-4 rounded-lg border whitespace-pre-wrap">{app.applicantMessage}</p>

                  {app.rejectionNote && (
                     <div className="mt-3 p-3 bg-destructive/5 text-destructive text-sm rounded-lg border border-destructive/20">
                       <strong className="block mb-1">Vaša interna beleška (odbijeno):</strong>
                       {app.rejectionNote}
                     </div>
                  )}
               </div>
               <div className="flex sm:flex-col gap-2 w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-border/50">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="flex-1 sm:flex-none hover:bg-green-600/10 hover:text-green-700 hover:border-green-600/20" 
                    onClick={() => confirmApprove([app.id])} 
                    disabled={decideMutation.isPending || !isActionable}
                  >
                    Odobri
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="flex-1 sm:flex-none hover:bg-destructive/10 hover:text-destructive hover:border-destructive/20" 
                    onClick={() => openReject([app.id])} 
                    disabled={decideMutation.isPending || !isActionable}
                  >
                    Odbij
                  </Button>
               </div>
             </div>
           );
         })}
      </div>

      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odbijanje prijava</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Interna beleška (opciono)</Label>
              <Textarea
                placeholder="Unesite razlog odbijanja koji će biti sačuvan uz prijavu i vidljiv samo vama..."
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                maxLength={2000}
                className="min-h-[120px]"
                data-testid="dialog-reject-note"
              />
              <p className="text-xs text-muted-foreground">Ova beleška služi isključivo za vašu internu evidenciju i neće biti vidljiva kandidatu.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)}>Odustani</Button>
            <Button variant="destructive" onClick={() => handleDecision(rejectTargetIds, 'reject', internalNote)} disabled={decideMutation.isPending}>
              {decideMutation.isPending ? "Odbijanje..." : "Potvrdi odbijanje"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'accepted') return <Badge className="bg-green-600/10 text-green-700 border-green-600/20 hover:bg-green-600/20">Odobren</Badge>;
  if (status === 'declined') return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20">Odbijen</Badge>;
  if (status === 'replied') return <Badge variant="outline">Odgovoreno — čeka odluku</Badge>;
  if (status === 'viewed') return <Badge variant="outline">Pregledan — čeka odluku</Badge>;
  return <Badge variant="secondary">Na čekanju</Badge>;
}
