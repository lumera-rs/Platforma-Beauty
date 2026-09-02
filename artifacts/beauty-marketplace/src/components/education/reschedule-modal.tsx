import { useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { GroupedAvailabilityView } from "@/components/booking/grouped-availability-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { educationBelgradeDateKey } from "@/lib/education-operational-time";
import { getApiErrorDetails, useGetEducationCourseAvailability, useRescheduleEducationOperationalBooking } from "@workspace/api-client-react";

export function RescheduleModal({ booking, onClose, onSuccess }: { booking: any, onClose: () => void, onSuccess: () => void }) {
  const { data: availability, isLoading: isAvailLoading, isError: isAvailError, refetch: refetchAvailability } = useGetEducationCourseAvailability(booking.courseId, {}, {
    query: { enabled: !!booking.courseId, queryKey: ["getEducationCourseAvailability", booking.courseId, "", ""] }
  });
  const mut = useRescheduleEducationOperationalBooking({ request: { headers: { "Idempotency-Key": crypto.randomUUID() } } });
  const { toast } = useToast();
  
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);

  const candidates = useMemo(() => {
    if (!availability?.slots) return [];
    return availability.slots.map((slot: any) => ({
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      treatments: [{ serviceId: "course", employeeId: slot.educatorStaffId, date: slot.date, startTime: slot.startTime }],
      slot
    }));
  }, [availability]);

  const calendarDays = useMemo(() => {
    const days: Record<string, any> = {};
    candidates.forEach((c: any) => {
      if (!days[c.date]) days[c.date] = { date: c.date, candidates: [] };
      days[c.date].candidates.push(c);
    });
    return Object.values(days);
  }, [candidates]);
  
  const groupedResponse = {
    salonId: booking.courseId,
    generatedAt: new Date().toISOString(),
    candidates,
    calendarDays
  };

  const handleReschedule = () => {
    if (!selectedCandidate) return;
    const targetSessionId = selectedCandidate.slot?.sessionId;
    if (!targetSessionId) {
      toast.error("Izabrani termin više nije dostupan.");
      return;
    }
    
    mut.mutate({
      bookingGroupId: booking.id,
      data: {
        targetSessionId,
        participantIds: booking.participants.filter((p: any) => p.status === "reserved" || p.status === "waitlisted").map((p: any) => p.id)
      }
    }, {
      onSuccess: () => {
        toast.success("Termin je uspešno promenjen");
        onSuccess();
      },
      onError: (error: unknown) => {
        const { status, message } = getApiErrorDetails(error);
        if (status === 409) {
          toast.error("Konflikt", { description: "Kapacitet za novi termin je popunjen." });
          setSelectedCandidate(null);
          void refetchAvailability();
        } else {
          toast.error("Greška", { description: message });
        }
      }
    });
  };

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Promena termina</DialogTitle>
          <DialogDescription>Promena termina odnosi se na celu aktivnu grupu. Za promenu samo pojedinačnih mesta potrebno je otkazivanje i nova rezervacija.</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="border-t pt-4">
            <h4 className="font-medium text-sm mb-3">Novi termin</h4>
            {isAvailLoading ? <Loader2 className="animate-spin w-5 h-5" /> : isAvailError ? (
              <div className="text-sm text-destructive">Dostupnost nije učitana. <Button variant="link" onClick={() => void refetchAvailability()}>Pokušaj ponovo</Button></div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nema kompatibilnih budućih termina sa slobodnim mestima.</p>
            ) : (
              <GroupedAvailabilityView
                isLoading={false}
                viewMode="calendar"
                onViewModeChange={() => {}}
                availabilityResponse={groupedResponse as any}
                salon={{ services: [{ id: "course", name: booking.courseTitle }], staff: [] }}
                selectedCandidate={selectedCandidate}
                onSelectCandidate={(c) => setSelectedCandidate(c)}
                todayDate={educationBelgradeDateKey(new Date())}
              />
            )}
          </div>

          <Button 
            className="w-full" 
            disabled={!selectedCandidate || mut.isPending}
            onClick={handleReschedule}
          >
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Potvrdi promenu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
