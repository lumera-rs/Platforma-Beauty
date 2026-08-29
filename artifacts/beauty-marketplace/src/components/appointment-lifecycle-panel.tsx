import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Appointment,
  type AppointmentLifecycleInputAction,
  getApiErrorMessage,
  getListSalonAppointmentsQueryKey,
  useTransitionAppointmentLifecycle,
} from "@workspace/api-client-react";
import { AlertTriangle, Check, Clock3, Loader2, Play, UserCheck, UserX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type LifecycleAppointment = Pick<
  Appointment,
  "id" | "date" | "startTime" | "endTime" | "status" | "plannedEndTime" | "arrivedAt" | "confirmedAt" | "actualStartedAt" | "actualCompletedAt" | "completedAt" | "cancelledAt" | "noShowAt"
>;

const actionSuccess: Record<AppointmentLifecycleInputAction, string> = {
  confirm: "Rezervacija je potvrđena.",
  arrive: "Dolazak klijenta je evidentiran.",
  start: "Početak tretmana je evidentiran.",
  complete: "Tretman je označen kao završen.",
  cancel: "Termin je otkazan.",
  "no-show": "Nedolazak je evidentiran.",
};

const statusLabels: Record<Appointment["status"], string> = {
  pending: "Na čekanju",
  confirmed: "Potvrđen",
  completed: "Završen",
  cancelled: "Otkazan",
  "no-show": "Nije došao",
};

function auditTime(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleString("sr-RS", { dateStyle: "short", timeStyle: "short" });
}

export function AppointmentLifecyclePanel({
  appointment,
  onUpdated,
}: {
  appointment: LifecycleAppointment;
  onUpdated: (appointment: Appointment) => void | Promise<void>;
}) {
  const mutation = useTransitionAppointmentLifecycle();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const timing = useMemo(() => {
    const start = new Date(`${appointment.date}T${appointment.startTime}:00`);
    const end = new Date(`${appointment.date}T${appointment.plannedEndTime ?? appointment.endTime}:00`);
    const now = new Date();
    const lateMinutes = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000));
    const remainingMinutes = Math.floor((end.getTime() - now.getTime()) / 60000);
    return { lateMinutes, remainingMinutes };
  }, [appointment.date, appointment.endTime, appointment.plannedEndTime, appointment.startTime]);

  const terminal = ["completed", "cancelled", "no-show"].includes(appointment.status);
  const arrived = Boolean(appointment.arrivedAt);
  const started = Boolean(appointment.actualStartedAt);

  const transition = (action: AppointmentLifecycleInputAction) => {
    if ((action === "cancel" || action === "no-show") && !window.confirm(action === "cancel" ? "Otkazati ovaj termin?" : "Označiti da klijent nije došao?")) return;
    mutation.mutate({
      appointmentId: appointment.id,
      data: { action, ...(action === "cancel" && reason.trim() ? { reason: reason.trim() } : {}) },
    }, {
      onSuccess: async (updated) => {
        toast.success(actionSuccess[action]);
        setReason("");
        await queryClient.invalidateQueries({ queryKey: getListSalonAppointmentsQueryKey() });
        await onUpdated(updated);
      },
      onError: (error) => {
        const message = getApiErrorMessage(error, "Promena statusa nije sačuvana. Osvežite raspored i pokušajte ponovo.");
        toast.error(action === "start" ? "Tretman ne može da počne" : "Promena nije dozvoljena", { description: message });
      },
    });
  };

  const events = [
    { label: "Dolazak potvrđen", value: appointment.confirmedAt },
    { label: "Klijent stigao", value: appointment.arrivedAt },
    { label: "Tretman započet", value: appointment.actualStartedAt },
    { label: "Tretman završen", value: appointment.actualCompletedAt ?? appointment.completedAt },
    { label: "Otkazano", value: appointment.cancelledAt },
    { label: "Nije došao", value: appointment.noShowAt },
  ].filter((event) => event.value);

  return (
    <section className="space-y-4 rounded-xl border bg-muted/20 p-4" data-testid={`appointment-lifecycle-${appointment.id}`}>
      <div>
        <h3 className="font-semibold">Tok termina</h3>
        <p className="mt-1 text-xs text-muted-foreground">Svaka radnja se beleži u istoriji termina sa korisnikom i vremenom promene.</p>
      </div>

      {!terminal && !started && timing.lateMinutes > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid={`late-policy-${appointment.id}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Termin kasni {timing.lateMinutes} min. Preostalo je približno {Math.max(0, timing.remainingMinutes)} min do planiranog kraja.
            Pri pokretanju se proverava minimalno korisno vreme iz pravila salona; ako ga nema dovoljno, početak neće biti dozvoljen.
          </p>
        </div>
      )}

      {!terminal && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {appointment.status === "pending" && (
            <Button type="button" disabled={mutation.isPending} onClick={() => transition("confirm")} data-testid={`button-confirm-${appointment.id}`}>
              <Check className="mr-2 h-4 w-4" />Potvrdi rezervaciju
            </Button>
          )}
          {appointment.status === "confirmed" && !arrived && !started && (
            <Button type="button" disabled={mutation.isPending} onClick={() => transition("arrive")} data-testid={`button-arrived-${appointment.id}`}>
              <UserCheck className="mr-2 h-4 w-4" />Označi da je stigao
            </Button>
          )}
          {appointment.status === "confirmed" && arrived && !started && (
            <Button type="button" disabled={mutation.isPending} onClick={() => transition("start")} data-testid={`button-start-${appointment.id}`}>
              <Play className="mr-2 h-4 w-4" />Započni tretman
            </Button>
          )}
          {appointment.status === "confirmed" && started && (
            <Button type="button" disabled={mutation.isPending} onClick={() => transition("complete")} data-testid={`button-complete-${appointment.id}`}>
              <Check className="mr-2 h-4 w-4" />Završi tretman
            </Button>
          )}
          {!arrived && !started && (
            <>
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => transition("no-show")} data-testid={`button-no-show-${appointment.id}`}>
                <UserX className="mr-2 h-4 w-4" />Nije došao
              </Button>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={`cancel-reason-${appointment.id}`} className="text-xs">Razlog otkazivanja (opciono)</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id={`cancel-reason-${appointment.id}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Unesite razlog za audit zapis" data-testid={`input-cancel-reason-${appointment.id}`} />
                  <Button type="button" variant="destructive" className="shrink-0" disabled={mutation.isPending} onClick={() => transition("cancel")} data-testid={`button-cancel-${appointment.id}`}>
                    <X className="mr-2 h-4 w-4" />Otkaži termin
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {mutation.isPending && <p className="flex items-center text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Čuvanje promene…</p>}
      <div className="space-y-2" data-testid={`appointment-audit-${appointment.id}`}>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Status i evidencija</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Status: {statusLabels[appointment.status]}</Badge>
          {events.length ? events.map((event) => <Badge key={event.label} variant="secondary">{event.label}: {auditTime(event.value)}</Badge>) : <span className="text-xs text-muted-foreground">Još nema evidentiranih promena.</span>}
        </div>
      </div>
    </section>
  );
}