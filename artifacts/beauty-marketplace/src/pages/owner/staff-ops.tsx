import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, startOfWeek, endOfWeek } from "date-fns";
import { srLatn } from "date-fns/locale";
import { AlertTriangle, CalendarClock, Check, Clock3, Loader2, Pencil, X } from "lucide-react";
import {
  getListSalonClockEntriesQueryKey,
  getListSalonShiftSwapsQueryKey,
  useListSalonClockEntries,
  useListSalonShiftSwaps,
  useReviewSalonShiftSwap,
  useUpdateSalonClockEntry,
  useListEmployeeLocationAssignments,
  useReplaceEmployeeLocationSchedule,
  getListEmployeeLocationAssignmentsQueryKey,
} from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OwnerSidebar } from "./dashboard";
import { useToast } from "@/hooks/use-toast";

const statusLabel: Record<string, string> = {
  pending_colleague: "Čeka kolegu",
  colleague_declined: "Kolega je odbio",
  pending_owner: "Čeka odobrenje",
  owner_declined: "Vlasnik je odbio",
  approved: "Odobreno",
  cancelled: "Otkazano",
};

function minutesLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${rest} min`;
}

function localDateTime(value: string) {
  return value ? value.slice(0, 16) : "";
}

export default function OwnerStaffOps() {
  const today = new Date();
  const [from, setFrom] = useState(format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [editing, setEditing] = useState<{ id: string; clockOutAt: string; note: string } | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const period = useMemo(() => ({ from, to }), [from, to]);
  const clock = useListSalonClockEntries(period, { query: { queryKey: getListSalonClockEntriesQueryKey(period) } });
  const swaps = useListSalonShiftSwaps({ query: { queryKey: getListSalonShiftSwapsQueryKey() } });
  const correctEntry = useUpdateSalonClockEntry();
  const reviewSwap = useReviewSalonShiftSwap();
  useEffect(() => {
    void fetch("/api/salon/employees", { credentials: "include" })
      .then(async (response) => response.ok ? response.json() as Promise<Array<{ id: string; name: string }>> : [])
      .then(setEmployees)
      .catch(() => undefined);
  }, []);

  const refreshClock = () => queryClient.invalidateQueries({ queryKey: getListSalonClockEntriesQueryKey(period) });
  const refreshSwaps = () => queryClient.invalidateQueries({ queryKey: getListSalonShiftSwapsQueryKey() });
  const setPreset = (kind: "today" | "week" | "month") => {
    const now = new Date();
    if (kind === "today") {
      const day = format(now, "yyyy-MM-dd");
      setFrom(day); setTo(day);
    } else if (kind === "week") {
      setFrom(format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"));
      setTo(format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"));
    } else {
      setFrom(format(startOfMonth(now), "yyyy-MM-dd"));
      setTo(format(now, "yyyy-MM-dd"));
    }
  };
  const saveCorrection = () => {
    if (!editing) return;
    const clockOutAt = new Date(editing.clockOutAt).toISOString();
    correctEntry.mutate({ entryId: editing.id, data: { clockOutAt, note: editing.note.trim() || null } }, {
      onSuccess: () => {
        toast.success("Evidencija je korigovana.");
        setEditing(null);
        void refreshClock();
      },
      onError: () => toast.error("Korekcija nije sačuvana."),
    });
  };
  const decideSwap = (requestId: string, approve: boolean) => {
    reviewSwap.mutate({ requestId, data: { approve } }, {
      onSuccess: () => {
        toast.success(approve ? "Zamena je odobrena i termini su preraspoređeni." : "Zamena je odbijena.");
        void refreshSwaps();
      },
      onError: () => toast.error("Odluka nije sačuvana."),
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto flex flex-col gap-8 px-4 py-8 md:flex-row">
        <OwnerSidebar current="/vlasnik/radno-vreme" />
        <main className="min-w-0 flex-1 space-y-6" data-testid="page-owner-staff-ops">
          <div>
            <p className="text-sm font-medium text-primary">Tim</p>
            <h1 className="font-serif text-3xl font-bold">Radno vreme i zamene</h1>
            <p className="mt-1 text-muted-foreground">Proverite evidenciju smena, ispravite otvorene unose i odobrite zamene.</p>
          </div>
          <LocationScheduleEditor employees={employees} selectedEmployeeId={selectedEmployeeId} setSelectedEmployeeId={setSelectedEmployeeId} />

          <Card>
            <CardHeader className="gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-primary" />Evidencija radnog vremena</CardTitle>
                <CardDescription>Uporedite radne sate sa brojem termina u izabranom periodu.</CardDescription>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreset("today")} data-testid="clock-period-today">Danas</Button>
                <Button variant="outline" size="sm" onClick={() => setPreset("week")} data-testid="clock-period-week">Ova nedelja</Button>
                <Button variant="outline" size="sm" onClick={() => setPreset("month")} data-testid="clock-period-month">Ovaj mesec</Button>
                <div><Label htmlFor="clock-from" className="text-xs">Od</Label><Input id="clock-from" className="mt-1 h-9" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="clock-from" /></div>
                <div><Label htmlFor="clock-to" className="text-xs">Do</Label><Input id="clock-to" className="mt-1 h-9" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="clock-to" /></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {clock.isLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                : !clock.data?.length ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nema evidentiranih smena za izabrani period.</p>
                  : clock.data.map((employee) => (
                    <section key={employee.employeeId} className="overflow-hidden rounded-xl border" data-testid={`clock-employee-${employee.employeeId}`}>
                      <div className="flex flex-col gap-3 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div><h2 className="font-semibold">{employee.employeeName}</h2><p className="text-sm text-muted-foreground">{minutesLabel(employee.totalMinutes)} rada · {employee.appointmentCount} termina</p></div>
                        <div className="flex gap-2">
                          {employee.staleOpenEntry && <Badge variant="destructive" className="gap-1" data-testid={`stale-shift-${employee.employeeId}`}><AlertTriangle className="h-3.5 w-3.5" />Nezavršena smena</Badge>}
                          {employee.openEntry && !employee.staleOpenEntry && <Badge variant="secondary">Trenutno na smeni</Badge>}
                        </div>
                      </div>
                      <div className="divide-y">
                        {employee.entries.map((entry) => (
                          <div className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between" key={entry.id}>
                            <div>
                              <p className="font-medium">{entry.clockInAt ? <>{format(new Date(entry.clockInAt), "d. MMM yyyy. HH:mm", { locale: srLatn })} — {entry.clockOutAt ? format(new Date(entry.clockOutAt), "HH:mm") : "otvorena smena"}</> : "—"}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{entry.durationMinutes == null ? "Trajanje se računa po zatvaranju" : minutesLabel(entry.durationMinutes)}{entry.note ? ` · ${entry.note}` : ""}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {entry.editedByOwner && <Badge variant="outline">Korigovano</Badge>}
                              <Button variant="outline" size="sm" onClick={() => setEditing({ id: entry.id, clockOutAt: localDateTime(entry.clockOutAt ?? new Date().toISOString()), note: entry.note ?? "" })} data-testid={`clock-correct-${entry.id}`}><Pencil className="mr-1 h-3.5 w-3.5" />Koriguj</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" />Zahtevi za zamenu smene</CardTitle><CardDescription>Odobrenje menja samo pending i potvrđene termine tog dana između ova dva člana tima.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {swaps.isLoading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                : !swaps.data?.length ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nema zahteva za zamenu smene.</p>
                  : swaps.data.map(({ request, requesterAppointments, targetAppointments }) => (
                    <section key={request.id} className="rounded-xl border p-4" data-testid={`shift-swap-${request.id}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div><p className="font-semibold">{request.requesterName} <span className="text-muted-foreground">↔</span> {request.targetName}</p><p className="text-sm text-muted-foreground">{format(new Date(`${request.swapDate}T12:00:00`), "d. MMMM yyyy.", { locale: srLatn })}{request.note ? ` · ${request.note}` : ""}</p></div>
                        <Badge variant={request.status === "pending_owner" ? "default" : "secondary"}>{statusLabel[request.status] ?? request.status}</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <AppointmentPreview name={request.requesterName} appointments={requesterAppointments} />
                        <AppointmentPreview name={request.targetName} appointments={targetAppointments} />
                      </div>
                      {request.status === "pending_owner" && <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => decideSwap(request.id, false)} disabled={reviewSwap.isPending} data-testid={`swap-decline-${request.id}`}><X className="mr-1 h-4 w-4" />Odbij</Button><Button onClick={() => decideSwap(request.id, true)} disabled={reviewSwap.isPending} data-testid={`swap-approve-${request.id}`}><Check className="mr-1 h-4 w-4" />Odobri zamenu</Button></div>}
                    </section>
                  ))}
            </CardContent>
          </Card>
        </main>
      </div>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent><DialogHeader><DialogTitle>Ručno zatvaranje smene</DialogTitle></DialogHeader>
          {editing && <div className="space-y-4"><div><Label htmlFor="clock-out">Završetak smene</Label><Input id="clock-out" type="datetime-local" value={editing.clockOutAt} onChange={(e) => setEditing({ ...editing, clockOutAt: e.target.value })} data-testid="clock-correction-out" /></div><div><Label htmlFor="clock-note">Napomena</Label><Input id="clock-note" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} data-testid="clock-correction-note" /></div><Button className="w-full" onClick={saveCorrection} disabled={correctEntry.isPending} data-testid="clock-correction-save">{correctEntry.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sačuvaj korekciju</Button></div>}
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}

const weekdayNames = ["", "Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"];

function LocationScheduleEditor({ employees, selectedEmployeeId, setSelectedEmployeeId }: {
  employees: Array<{ id: string; name: string }>;
  selectedEmployeeId: string;
  setSelectedEmployeeId: (id: string) => void;
}) {
  return <Card>
    <CardHeader>
      <CardTitle>Raspored po lokaciji</CardTitle>
      <CardDescription>Izaberite zaposlenog, zatim lokaciju na kojoj je dodeljen. Preklapanja sa njegovim drugim lokacijama nisu dozvoljena.</CardDescription>
    </CardHeader>
    <CardContent>
      <Label htmlFor="schedule-employee">Zaposleni</Label>
      <select id="schedule-employee" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
        <option value="">Izaberite zaposlenog</option>
        {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
      </select>
      {selectedEmployeeId && <EmployeeLocationSchedule employeeId={selectedEmployeeId} />}
    </CardContent>
  </Card>;
}

function EmployeeLocationSchedule({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const assignments = useListEmployeeLocationAssignments(employeeId);
  const [salonId, setSalonId] = useState("");
  const [windows, setWindows] = useState<Array<{ weekday: number; startTime: string; endTime: string; breakStart: string | null; breakEnd: string | null }>>([]);
  const replaceSchedule = useReplaceEmployeeLocationSchedule();
  const active = (assignments.data ?? []).filter((assignment) => assignment.active);
  useEffect(() => {
    if (!salonId && active[0]) setSalonId(active[0].salonId);
    if (salonId && !active.some((assignment) => assignment.salonId === salonId)) setSalonId(active[0]?.salonId ?? "");
  }, [active, salonId]);
  const selected = active.find((assignment) => assignment.salonId === salonId);
  useEffect(() => { setWindows(selected?.scheduleWindows ?? []); }, [selected?.salonId, selected?.scheduleWindows]);
  const overlaps = windows.some((window) => active.some((assignment) => assignment.salonId !== salonId && assignment.scheduleWindows.some((other) => other.weekday === window.weekday && window.startTime < other.endTime && other.startTime < window.endTime)));
  const updateDay = (weekday: number, key: "startTime" | "endTime", value: string) => setWindows((current) => {
    const found = current.find((window) => window.weekday === weekday);
    return found ? current.map((window) => window.weekday === weekday ? { ...window, [key]: value } : window) : [...current, { weekday, startTime: key === "startTime" ? value : "09:00", endTime: key === "endTime" ? value : "17:00", breakStart: null, breakEnd: null }];
  });
  if (assignments.isLoading) return <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!active.length) return <p className="mt-4 text-sm text-muted-foreground">Zaposleni nema aktivnu dodelu lokacije. Dodelu uredite na stranici Zaposleni.</p>;
  return <div className="mt-5 space-y-4">
    <div><Label htmlFor="schedule-location">Lokacija</Label><select id="schedule-location" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={salonId} onChange={(event) => setSalonId(event.target.value)}>{active.map((assignment) => <option key={assignment.salonId} value={assignment.salonId}>{assignment.locationName}{assignment.isDefault ? " (podrazumevana)" : ""}</option>)}</select></div>
    <div className="space-y-2">{weekdayNames.slice(1).map((name, index) => {
      const weekday = index + 1; const window = windows.find((item) => item.weekday === weekday);
      return <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm" key={weekday}><span>{name}</span><Input aria-label={`${name} početak`} type="time" value={window?.startTime ?? ""} onChange={(event) => updateDay(weekday, "startTime", event.target.value)} /><Input aria-label={`${name} kraj`} type="time" value={window?.endTime ?? ""} onChange={(event) => updateDay(weekday, "endTime", event.target.value)} /></div>;
    })}</div>
    <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">Rotacija: {windows.length ? windows.map((window) => `${weekdayNames[window.weekday].slice(0, 3)} ${window.startTime}–${window.endTime}`).join(" · ") : "nema radnih dana na ovoj lokaciji"}.</p>
    {overlaps && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" />Raspored se preklapa sa rasporedom na drugoj lokaciji. Izmenite vreme pre čuvanja.</p>}
    <Button disabled={replaceSchedule.isPending || overlaps || !salonId} onClick={() => replaceSchedule.mutate({ employeeId, salonId, data: { windows } }, { onSuccess: () => { toast.success("Raspored lokacije je sačuvan."); void queryClient.invalidateQueries({ queryKey: getListEmployeeLocationAssignmentsQueryKey(employeeId) }); }, onError: (error) => toast.error(error instanceof Error ? error.message : "Raspored nije sačuvan.") })}>Sačuvaj raspored lokacije</Button>
  </div>;
}

function AppointmentPreview({ name, appointments }: { name: string; appointments: { id: string; startTime: string; endTime: string; serviceName: string; customerName?: string | null; status: string }[] }) {
  return <div className="rounded-lg bg-muted/35 p-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{name}</p>{appointments.length ? <div className="space-y-2">{appointments.map((appointment) => <div key={appointment.id} className="rounded bg-background px-2 py-1.5 text-xs"><span className="font-medium">{appointment.startTime}–{appointment.endTime}</span> · {appointment.serviceName}{appointment.customerName ? ` · ${appointment.customerName}` : ""}</div>)}</div> : <p className="text-xs text-muted-foreground">Nema termina za ovaj dan.</p>}</div>;
}