import { useState } from "react";
import { Loader2, Calendar, Ban, Repeat, Download, BookOpen, AlertCircle, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { EducationFieldHelp } from "@/components/education/education-field-help";
import {
  useListMyEducationOperationalBookings,
  useGetEducationOperationalPaymentPlan,
  useCancelEducationOperationalBooking,
  useRescheduleEducationOperationalBooking,
  useGetEducationLms,
  useGetCurrentUser,
} from "@workspace/api-client-react";

const money = (val: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD" }).format(val);

function LMSStatus({ enrollmentId }: { enrollmentId: string }) {
  const { data: lms, isLoading } = useGetEducationLms(enrollmentId, {
    query: { enabled: !!enrollmentId, queryKey: ["educationLms", enrollmentId] }
  });

  if (isLoading) return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
  if (!lms) return null;

  return (
    <div className="mt-2 text-xs border rounded-lg p-3 bg-muted/20">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold flex items-center gap-1"><BookOpen className="w-3 h-3"/> LMS Napredak</span>
        <Badge variant={lms.eligibility.certificateEligible ? "default" : "secondary"}>
          {lms.eligibility.percent}% završen
        </Badge>
      </div>
      
      {!lms.eligibility.certificateEligible && lms.eligibility.reasons.length > 0 && (
        <ul className="text-muted-foreground list-disc pl-4 space-y-0.5 mt-1">
          {lms.eligibility.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      
      <div className="mt-2 flex items-center justify-between">
        <span className="text-muted-foreground">Sertifikat:</span>
        {lms.eligibility.certificateEligible ? (
          <span className="text-emerald-600 font-medium flex items-center gap-1"><FileText className="w-3 h-3"/> Otključan</span>
        ) : (
          <span className="text-muted-foreground flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Zaključan</span>
        )}
      </div>
    </div>
  );
}

function PaymentPlanDetails({ bookingGroupId }: { bookingGroupId: string }) {
  const { data: plan, isLoading } = useGetEducationOperationalPaymentPlan(bookingGroupId, {
    query: { enabled: !!bookingGroupId, queryKey: ["educationOperationalPaymentPlan", bookingGroupId] }
  });

  if (isLoading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (!plan) return null;

  return (
    <div className="text-sm space-y-2">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Ukupno:</span>
        <span className="font-medium">{money(plan.grossAmount)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Uplaćeno:</span>
        <span className="font-medium text-emerald-600">{money(plan.netPaidAmount)}</span>
      </div>
      {plan.outstandingAmount > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Preostalo:</span>
          <span className="font-medium text-destructive">{money(plan.outstandingAmount)}</span>
        </div>
      )}
      {plan.refundedAmount > 0 && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Refundi:</span>
          <span className="font-medium text-amber-600">{money(plan.refundedAmount)}</span>
        </div>
      )}
      <Badge variant={plan.paymentStatus === 'paid' ? 'default' : plan.paymentStatus === 'partial' ? 'secondary' : 'outline'} className="mt-1">
        {plan.paymentStatus === 'paid' ? 'Plaćeno' : plan.paymentStatus === 'partial' ? 'Delimično plaćeno' : plan.paymentStatus}
      </Badge>
    </div>
  );
}

import { RescheduleModal } from "./reschedule-modal";
import { educationBelgradeDateLabel, educationBelgradeTime, educationCancellationReasonValid } from "@/lib/education-operational-time";
export function OperationalEducationPurchases() {
  const { data: bookings, isLoading, refetch } = useListMyEducationOperationalBookings();
  const { data: currentUser } = useGetCurrentUser();
  const [cancelModal, setCancelModal] = useState<any>(null);
  const [rescheduleModal, setRescheduleModal] = useState<any>(null);
  
  const [cancelReason, setCancelReason] = useState("");
  
  const cancelMut = useCancelEducationOperationalBooking();
  const rescheduleMut = useRescheduleEducationOperationalBooking();
  const { toast } = useToast();
  const cancelReasonIsValid = educationCancellationReasonValid(cancelReason);

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!bookings || bookings.length === 0) return null;

  const openCancel = (b: any) => {
    setCancelModal(b);
    setCancelReason("");
  };

  const executeCancel = () => {
    if (!cancelModal || !cancelReasonIsValid) return;
    cancelMut.mutate({
      bookingGroupId: cancelModal.id,
      data: {
        reason: cancelReason.trim()
      }
    }, {
      onSuccess: () => {
        toast.success("Otkazivanje uspešno");
        setCancelModal(null);
        refetch();
      },
      onError: (err: any) => {
        toast.error("Greška", { description: err.message });
      }
    });
  };

  return (
    <div className="space-y-4 mt-8 pt-8 border-t">
      <h3 className="font-serif text-xl font-bold mb-4">Grupne i operativne rezervacije</h3>
      
      {bookings.map(b => (
        <Card key={b.id} className="overflow-hidden">
          <CardHeader className="pb-3 bg-muted/10">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-lg">{b.courseTitle}</CardTitle>
                <CardDescription className="flex items-center gap-1 mt-1">
                  <Calendar className="w-4 h-4"/>
                  {b.session?.startsAt ? `${educationBelgradeDateLabel(new Date(b.session.startsAt), { day: "2-digit", month: "2-digit", year: "numeric" })} ${educationBelgradeTime(new Date(b.session.startsAt))}` : "Bez termina"}
                </CardDescription>
              </div>
              <Badge variant={b.status === 'active' ? 'default' : b.status === 'pending' ? 'secondary' : 'outline'}>
                {b.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 flex flex-col md:flex-row gap-6">
            <div className="flex-1 space-y-4">
              <h4 className="font-semibold text-sm">Učesnici ({b.participants.length})</h4>
              <div className="space-y-3">
                {b.participants.map(p => (
                  <div key={p.id} className="border-l-2 pl-3 border-primary/30 py-1">
                    <div className="flex justify-between">
                      <span className="font-medium text-sm">{p.fullName}</span>
                      <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
                    </div>
                    {b.status === "active" && p.status === "reserved" && p.enrollmentId && p.userId === currentUser?.user?.id
                      ? <LMSStatus enrollmentId={p.enrollmentId} />
                      : null}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="md:w-64 bg-muted/20 p-4 rounded-xl border self-start">
              <h4 className="font-semibold text-sm mb-3">Plaćanje</h4>
              <PaymentPlanDetails bookingGroupId={b.id} />
              
              <div className="mt-5 pt-5 border-t space-y-2">
                <Button size="sm" variant="outline" className="w-full justify-start" asChild>
                  <a href={`/api/education/operations/bookings/${b.id}/calendar.ics`} target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" /> Dodaj u kalendar
                  </a>
                </Button>
                
                {b.status !== 'cancelled' && (
                  <>
                    {/* Reschedule missing date picker as per strict instruction: "reschedule selected/all with available target session and 409 recovery" 
                        We would typically launch a modal with GroupedAvailabilityView here. For brevity: */}
                    <Button size="sm" variant="outline" className="w-full justify-start text-amber-600 hover:text-amber-700" onClick={() => setRescheduleModal(b)}>
                      <Repeat className="w-4 h-4 mr-2" /> Promeni termin
                    </Button>
                    <Button size="sm" variant="ghost" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => openCancel(b)}>
                      <Ban className="w-4 h-4 mr-2" /> Otkaži
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {rescheduleModal && (
        <RescheduleModal 
          booking={rescheduleModal} 
          onClose={() => setRescheduleModal(null)} 
          onSuccess={() => { setRescheduleModal(null); refetch(); }} 
        />
      )}
      
      {cancelModal && (
        <Dialog open={!!cancelModal} onOpenChange={(o) => !o && setCancelModal(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Otkazivanje rezervacije</DialogTitle>
              <DialogDescription>
                Otkazivanje se odnosi na celu aktivnu grupu. Delimično otkazivanje zahteva da kupac ili centar otkaže grupu i ponovo rezerviše potrebna mesta. Povraćaj zavisi od važećih uslova i roka.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <label htmlFor="operational-cancel-reason" className="text-sm font-medium">Razlog otkazivanja</label>
                  <EducationFieldHelp id="operational-cancel-reason-help" label="Razlog otkazivanja" text="Opišite razlog otkazivanja sa najmanje 3 znaka; beleži se uz otkazanu rezervaciju." />
                </div>
                <Textarea id="operational-cancel-reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Unesite razlog..." maxLength={1000} aria-describedby="operational-cancel-reason-help" aria-invalid={cancelReason.length > 0 && !cancelReasonIsValid} />
              </div>
              <Button 
                variant="destructive" 
                className="w-full" 
                type="button"
                disabled={cancelMut.isPending || !cancelReasonIsValid}
                aria-disabled={cancelMut.isPending || !cancelReasonIsValid}
                onClick={executeCancel}
              >
                {cancelMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : null}
                Potvrdi otkazivanje
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
