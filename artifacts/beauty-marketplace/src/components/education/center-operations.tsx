
import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, startOfWeek, endOfWeek, addDays } from "date-fns";

import { 
  useGetEducationCenterOperationalPermissions,
  useGetEducationCenterOperationsCalendar,
  useListEducationCenterOperationalStaff,
  useCreateEducationCenterOperationalStaff,
  useUpdateEducationCenterOperationalStaff,
  useListEducationEducatorWeeklyAvailability,
  useUpdateEducationEducatorWeeklyAvailability,
  useListEducationEducatorAbsences,
  useCreateEducationEducatorAbsence,
  useUpdateEducationEducatorAbsence,
  useDeleteEducationEducatorAbsence,
  usePreviewEducationCourseRecurrence,
  useCommitEducationCourseRecurrence,
  useCreateEducationOperationalBooking,
  useCancelEducationOperationalSession,
  useUpsertEducationOperationalAttendance,
  useSubstituteEducationSessionEducator,
  getListCoursesQueryKey,
  useListCourses,
  getListEducationCenterOperationalStaffQueryKey,
  getListEducationEducatorWeeklyAvailabilityQueryKey,
  getListEducationEducatorAbsencesQueryKey,
  getGetEducationCenterOperationsCalendarQueryKey
} from "@workspace/api-client-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Calendar as CalendarIcon, Users, UserCog, CalendarClock, ChevronLeft, ChevronRight, UserPlus, Clock, Trash2, Edit2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { educationBelgradeDateKey, educationBelgradeDateLabel, educationBelgradeTime } from "@/lib/education-operational-time";

// ==========================================
// MAIN COMPONENT
// ==========================================

export function CenterOperationsView({ centerId }: { centerId: string }) {
  const { data: permissions, isLoading } = useGetEducationCenterOperationalPermissions(centerId, { 
    query: { enabled: !!centerId, queryKey: ["educationCenterOperationalPermissions", centerId] } 
  });

  if (!centerId) return null;
  
  if (isLoading) {
    return <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/50" /></div>;
  }

  if (!permissions) {
    return <div className="py-12 text-center text-muted-foreground">Nemate pristup operacijama.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-serif font-bold">Operacije i Kalendar</h2>
        <p className="text-muted-foreground">Upravljanje kalendarom, osobljem i prisustvom. Uloga: <span className="font-semibold">{permissions.role}</span></p>
      </div>

      <Tabs defaultValue="calendar" className="space-y-6">
        <TabsList className="overflow-x-auto w-full justify-start rounded-lg h-12">
          <TabsTrigger value="calendar" className="h-10"><CalendarIcon className="w-4 h-4 mr-2" /> Kalendar</TabsTrigger>
          {(permissions.role === "owner_admin" || permissions.role === "manager_reception") && (
            <TabsTrigger value="recurrence" className="h-10"><CalendarClock className="w-4 h-4 mr-2" /> Generisanje termina</TabsTrigger>
          )}
          <TabsTrigger value="schedule" className="h-10"><UserCog className="w-4 h-4 mr-2" /> Raspored i odsustva</TabsTrigger>
          {permissions.canManageStaff && (
            <TabsTrigger value="staff" className="h-10"><Users className="w-4 h-4 mr-2" /> Osoblje</TabsTrigger>
          )}
        </TabsList>
        
        <TabsContent value="calendar" className="m-0">
          <OperationsCalendar centerId={centerId} permissions={permissions} />
        </TabsContent>

        {(permissions.role === "owner_admin" || permissions.role === "manager_reception") && (
          <TabsContent value="recurrence" className="m-0">
            <RecurrenceManager centerId={centerId} />
          </TabsContent>
        )}

        <TabsContent value="schedule" className="m-0">
          <EducatorSchedule centerId={centerId} permissions={permissions} />
        </TabsContent>

        {permissions.canManageStaff && (
          <TabsContent value="staff" className="m-0">
            <StaffManager centerId={centerId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ==========================================
// SUBCOMPONENTS
// ==========================================

function StaffManager({ centerId }: { centerId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: staff, isLoading } = useListEducationCenterOperationalStaff(centerId, { 
    query: { enabled: !!centerId, queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) } 
  });
  
  const createMut = useCreateEducationCenterOperationalStaff();
  const updateMut = useUpdateEducationCenterOperationalStaff();

  const handleUpdateRole = (staffId: string, newRole: "owner_admin" | "manager_reception" | "educator") => {
    updateMut.mutate({ centerId, staffId, data: { role: newRole } }, {
      onSuccess: () => {
        toast.success("Uloga je ažurirana.");
        queryClient.invalidateQueries({ queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const handleToggleActive = (staffId: string, active: boolean) => {
    updateMut.mutate({ centerId, staffId, data: { active } }, {
      onSuccess: () => {
        toast.success(active ? "Nalog je aktiviran." : "Nalog je deaktiviran.");
        queryClient.invalidateQueries({ queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const handleCreate = () => {
    const userId = window.prompt("Unesite ID korisnika (UUID):");
    if (!userId) return;
    
    createMut.mutate({ centerId, data: { userId, role: "manager_reception" } }, {
      onSuccess: () => {
        toast.success("Osoblje je dodato.");
        queryClient.invalidateQueries({ queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Osoblje edukativnog centra</CardTitle>
          <CardDescription>Upravljajte pristupom kalendaru i operacijama.</CardDescription>
        </div>
        <Button onClick={handleCreate} disabled={createMut.isPending}>Dodaj člana</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : staff?.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground border-2 border-dashed rounded-lg">
            Nema dodatih članova osoblja.
          </div>
        ) : (
          <div className="space-y-4">
            {staff?.map(member => (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-4 p-4 border rounded-xl">
                <div>
                  <p className="font-semibold">{member.userId} {member.instructorProfileId && <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full ml-2">Instruktor povezan</span>}</p>
                  <p className="text-sm text-muted-foreground">Uloga: {member.role}</p>
                </div>
                <div className="flex gap-2">
                  <select 
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                    value={member.role}
                    onChange={(e) => handleUpdateRole(member.id, e.target.value as any)}
                    disabled={updateMut.isPending}
                  >
                    <option value="owner_admin">Vlasnik / Admin</option>
                    <option value="manager_reception">Menadžer / Recepcija</option>
                    <option value="educator">Edukator</option>
                  </select>
                  <Button 
                    variant={member.active ? "outline" : "default"} 
                    size="sm"
                    onClick={() => handleToggleActive(member.id, !member.active)}
                    disabled={updateMut.isPending}
                  >
                    {member.active ? "Deaktiviraj" : "Aktiviraj"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------
// OPERATIONS CALENDAR
// ------------------------------------------
function OperationsCalendar({ centerId, permissions }: { centerId: string, permissions: any }) {
  const [currentWeek, setCurrentWeek] = useState(() => startOfWeek(new Date(`${educationBelgradeDateKey(new Date())}T12:00:00.000Z`), { weekStartsOn: 1 }));
  const startDate = currentWeek.toISOString().slice(0, 10);
  const endDate = endOfWeek(currentWeek, { weekStartsOn: 1 }).toISOString().slice(0, 10);
  
  const { data: staff } = useListEducationCenterOperationalStaff(centerId, { 
    query: { enabled: !!centerId && (permissions.role === "owner_admin" || permissions.role === "manager_reception"), queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) } 
  });
  
  const [selectedStaffId, setSelectedStaffId] = useState<string>("all");
  const activeStaffId = permissions.role === "educator" ? permissions.educatorStaffId : (selectedStaffId === "all" ? undefined : selectedStaffId);

  const { data: sessions, isLoading, refetch } = useGetEducationCenterOperationsCalendar(
    centerId, { startDate, endDate, educatorStaffId: activeStaffId }, 
    { query: { enabled: !!centerId, queryKey: getGetEducationCenterOperationsCalendarQueryKey(centerId, { startDate, endDate, educatorStaffId: activeStaffId }) } }
  );

  const prevWeek = () => setCurrentWeek(w => addDays(w, -7));
  const nextWeek = () => setCurrentWeek(w => addDays(w, 7));

  const [selectedSession, setSelectedSession] = useState<any>(null);

  // Group by day
  const days = Array.from({ length: 7 }).map((_, i) => addDays(currentWeek, i));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevWeek}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="font-semibold text-sm w-36 text-center">{educationBelgradeDateLabel(currentWeek, { day: "2-digit", month: "2-digit", year: "numeric" })} - {educationBelgradeDateLabel(endOfWeek(currentWeek, { weekStartsOn: 1 }), { day: "2-digit", month: "2-digit", year: "numeric" })}</span>
          <Button variant="outline" size="icon" onClick={nextWeek}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {staff && staff.length > 0 && (
          <div className="flex items-center gap-2">
            <Label>Edukator:</Label>
            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Svi edukatori" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi edukatori</SelectItem>
                {staff.filter(s => s.role === "educator").map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.userId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary/50" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
          {days.map(day => {
            const dayKey = day.toISOString().slice(0, 10);
            const daySessions = sessions?.filter(s => educationBelgradeDateKey(new Date(s.startsAt)) === dayKey) || [];
            return (
              <div key={day.toISOString()} className="border rounded-xl bg-card overflow-hidden">
                <div className="bg-muted/50 p-2 text-center border-b">
                  <p className="text-sm font-semibold">{educationBelgradeDateLabel(day, { weekday: "long" })}</p>
                  <p className="text-xs text-muted-foreground">{educationBelgradeDateLabel(day, { day: "2-digit", month: "short" })}</p>
                </div>
                <div className="p-2 space-y-2 min-h-[150px]">
                  {daySessions.map(session => (
                    <div 
                      key={session.id} 
                      className="text-xs p-2 rounded-md bg-primary/10 border border-primary/20 cursor-pointer hover:bg-primary/20 transition-colors"
                      onClick={() => setSelectedSession(session)}
                    >
                      <p className="font-bold text-primary">{educationBelgradeTime(new Date(session.startsAt))} - {educationBelgradeTime(new Date(session.endsAt))}</p>
                      <p className="truncate font-medium">{session.courseId}</p>
                      <p className="text-[10px] mt-1 text-muted-foreground">{session.reservedSeats}/{session.capacity} mesta</p>
                    </div>
                  ))}
                  {daySessions.length === 0 && (
                    <p className="text-xs text-center text-muted-foreground py-4">Nema termina</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedSession && (
        <SessionDetailDialog 
          session={selectedSession} 
          centerId={centerId} 
          permissions={permissions} 
          onClose={() => { setSelectedSession(null); refetch(); }} 
        />
      )}
    </div>
  );
}

function SessionDetailDialog({ session, centerId, permissions, onClose }: { session: any, centerId: string, permissions: any, onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [guestBookingKey, setGuestBookingKey] = useState(() => crypto.randomUUID());
  const addGuestMut = useCreateEducationOperationalBooking({ request: { headers: { "Idempotency-Key": guestBookingKey } } });
  const cancelSessionMut = useCancelEducationOperationalSession();
  const substituteMut = useSubstituteEducationSessionEducator();
  const { data: staff } = useListEducationCenterOperationalStaff(centerId, { query: { enabled: !!centerId, queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) } });
  const attendanceMut = useUpsertEducationOperationalAttendance();

  const handleAddGuest = () => {
    const fullName = window.prompt("Ime i prezime gosta:");
    if (!fullName) return;
    const email = window.prompt("Email gosta:");
    if (!email) return;
    
    addGuestMut.mutate({
      data: {
        courseId: session.courseId,
        sessionId: session.id,
        participants: [{ fullName, email }]
      }
    }, {
      onSuccess: () => {
        setGuestBookingKey(crypto.randomUUID());
        toast.success("Gost je dodat.");
        onClose();
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const handleCancelSession = () => {
    if (!window.confirm("Da li ste sigurni da želite da otkažete termin? Svi prijavljeni će biti obavešteni.")) return;
    const reason = window.prompt("Razlog otkazivanja (opciono):");
    cancelSessionMut.mutate({ centerId, sessionId: session.id, data: { reason: reason || undefined } }, {
      onSuccess: () => {
        toast.success("Termin je otkazan.");
        onClose();
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const handleAttendance = (participantId: string, status: "present" | "absent" | "excused") => {
    attendanceMut.mutate({ centerId, sessionId: session.id, participantId, data: { status } }, {
      onSuccess: () => {
        toast.success("Prisustvo evidentirano.");
        onClose();
      }
    });
  };

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Detalji termina</DialogTitle>
          <DialogDescription>
            {educationBelgradeDateLabel(new Date(session.startsAt), { day: "2-digit", month: "2-digit", year: "numeric" })}{" "}
            {educationBelgradeTime(new Date(session.startsAt))} - {educationBelgradeTime(new Date(session.endsAt))}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-muted/30 p-3 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Popunjenost</p>
              <p className="font-semibold">{session.reservedSeats} / {session.capacity}</p>
            </div>
            {permissions.role !== "educator" && (
              <Button size="sm" variant="outline" onClick={handleAddGuest} disabled={addGuestMut.isPending}><UserPlus className="w-4 h-4 mr-2"/> Dodaj gosta</Button>
            )}
          </div>
          
          <div>
            <h4 className="font-semibold text-sm mb-2">Prijavljeni polaznici</h4>
            {session.participants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nema prijavljenih polaznika.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {session.participants.map((p: any) => (
                  <div key={p.id} className="flex flex-col sm:flex-row justify-between sm:items-center p-3 border rounded-md gap-2">
                    <div>
                      <p className="font-medium text-sm">{p.fullName}</p>
                      <p className="text-xs text-muted-foreground">{p.status} {p.email && `· ${p.email}`} {p.phone && `· ${p.phone}`}</p>
                    </div>
                    {permissions.canTakeAttendance && p.status !== "cancelled" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100" onClick={() => handleAttendance(p.id, "present")}>Prisutan</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={() => handleAttendance(p.id, "absent")}>Odsutan</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="sm:justify-between flex-row">
          {(permissions.role === "owner_admin" || permissions.role === "manager_reception") && (
            <>
              <Button variant="destructive" onClick={handleCancelSession} disabled={cancelSessionMut.isPending}><Trash2 className="w-4 h-4 mr-2"/> Otkaži termin</Button>
              <Button variant="outline" onClick={() => {
                const newEducator = window.prompt("Unesite ID novog edukatora (mora biti 'educator' ulogu):");
                if (newEducator) {
                  substituteMut.mutate({ centerId, sessionId: session.id, data: { educatorStaffId: newEducator } }, {
                    onSuccess: () => { toast.success("Edukator je zamenjen."); onClose(); },
                    onError: (e: any) => toast.error("Greška", { description: e.message })
                  });
                }
              }} disabled={substituteMut.isPending}>
                Zameni edukatora
              </Button>
            </>
          )}
          <Button variant="outline" onClick={onClose}>Zatvori</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ------------------------------------------
// RECURRENCE MANAGER
// ------------------------------------------
function RecurrenceManager({ centerId }: { centerId: string }) {
  const { toast } = useToast();
  const { data: courses, isLoading: coursesLoading } = useListCourses(undefined, { query: { queryKey: getListCoursesQueryKey() }});
  const { data: staff } = useListEducationCenterOperationalStaff(centerId, { query: { queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) } });
  
  const [courseId, setCourseId] = useState("");
  const [educatorStaffId, setEducatorStaffId] = useState("");
  const [startDate, setStartDate] = useState(educationBelgradeDateKey(new Date()));
  const [endDate, setEndDate] = useState(() => educationBelgradeDateKey(addDays(new Date(`${educationBelgradeDateKey(new Date())}T12:00:00.000Z`), 30)));
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("18:00");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  
  const previewMut = usePreviewEducationCourseRecurrence();
  const commitMut = useCommitEducationCourseRecurrence({ request: { headers: { "Idempotency-Key": crypto.randomUUID() } } });

  const toggleWeekday = (day: number) => {
    setWeekdays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const handlePreview = () => {
    if (!courseId || !educatorStaffId || weekdays.length === 0) {
      toast.error("Unesite sve podatke", { description: "Izaberite kurs, edukatora i bar jedan dan u nedelji." });
      return;
    }
    previewMut.mutate({
      courseId,
      data: {
        educatorStaffId, weekdays, startTime, endTime, durationMinutes, startDate, endDate
      }
    });
  };

  const handleCommit = () => {
    if (!previewMut.data?.candidates) return;
    commitMut.mutate({ courseId, data: { educatorStaffId, weekdays, startTime, endTime, durationMinutes, startDate, endDate } }, {
      onSuccess: () => {
        toast.success("Termini su uspešno generisani.");
        previewMut.reset();
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generisanje termina</CardTitle>
        <CardDescription>Kreirajte seriju individualnih termina za kurs koji podržava kalendar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Edukacija / Kurs</Label>
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger><SelectValue placeholder="Izaberite kurs..." /></SelectTrigger>
              <SelectContent>
                {courses?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Edukator</Label>
            <Select value={educatorStaffId} onValueChange={setEducatorStaffId}>
              <SelectTrigger><SelectValue placeholder="Izaberite edukatora..." /></SelectTrigger>
              <SelectContent>
                {staff?.filter(s => s.role === "educator").map((s: any) => <SelectItem key={s.id} value={s.id}>{s.userId}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Datum početka</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Datum kraja</Label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Radno vreme od</Label>
            <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Radno vreme do</Label>
            <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Trajanje termina (minuta)</Label>
            <Input type="number" min={5} value={durationMinutes} onChange={e => setDurationMinutes(parseInt(e.target.value))} />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label>Dani u nedelji</Label>
          <div className="flex flex-wrap gap-2">
            {[{v: 1, l: "Pon"}, {v: 2, l: "Uto"}, {v: 3, l: "Sre"}, {v: 4, l: "Čet"}, {v: 5, l: "Pet"}, {v: 6, l: "Sub"}, {v: 7, l: "Ned"}].map(day => (
              <Badge 
                key={day.v} 
                variant={weekdays.includes(day.v) ? "default" : "outline"} 
                className="cursor-pointer text-sm py-1 px-3"
                onClick={() => toggleWeekday(day.v)}
              >
                {day.l}
              </Badge>
            ))}
          </div>
        </div>

        <Button onClick={handlePreview} disabled={previewMut.isPending} className="w-full sm:w-auto">Pregled generisanja</Button>

        {previewMut.data && (
          <div className="mt-6 border p-4 rounded-xl bg-muted/20">
            <h3 className="font-semibold mb-2">Pregled (Pronađeno termina: {previewMut.data.candidates.length})</h3>
            <p className="text-sm text-muted-foreground mb-4">Preskočeno zbog konflikata: {previewMut.data.skippedConflictCount} | Zbog odsustva: {previewMut.data.skippedAbsenceCount}</p>
            <div className="max-h-40 overflow-y-auto space-y-1 mb-4 text-sm">
              {previewMut.data.candidates.map((c: any, i: number) => (
                <div key={i} className="flex justify-between border-b pb-1">
                  <span>{c.date.split("-").reverse().join(".")}</span>
                  <span className="font-medium">{c.startTime} - {c.endTime}</span>
                </div>
              ))}
            </div>
            <Button onClick={handleCommit} disabled={commitMut.isPending || previewMut.data.candidates.length === 0} variant="default">Potvrdi i kreiraj termine</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------
// EDUCATOR SCHEDULE & ABSENCES
// ------------------------------------------
function EducatorSchedule({ centerId, permissions }: { centerId: string, permissions: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: staff } = useListEducationCenterOperationalStaff(centerId, { 
    query: { enabled: !!centerId && permissions.role !== "educator", queryKey: getListEducationCenterOperationalStaffQueryKey(centerId) } 
  });
  
  const [selectedStaffId, setSelectedStaffId] = useState<string>(permissions.educatorStaffId || "");
  const activeStaffId = permissions.role === "educator" ? permissions.educatorStaffId : selectedStaffId;

  const { data: availability, isLoading: availLoading } = useListEducationEducatorWeeklyAvailability(centerId, activeStaffId!, {
    query: { enabled: !!centerId && !!activeStaffId, queryKey: getListEducationEducatorWeeklyAvailabilityQueryKey(centerId, activeStaffId!) }
  });

  const { data: absences, isLoading: absencesLoading } = useListEducationEducatorAbsences(centerId, activeStaffId!, {
    query: { enabled: !!centerId && !!activeStaffId, queryKey: getListEducationEducatorAbsencesQueryKey(centerId, activeStaffId!) }
  });

  const createAbsenceMut = useCreateEducationEducatorAbsence();
  const deleteAbsenceMut = useDeleteEducationEducatorAbsence();

  const handleAddAbsence = () => {
    if (!activeStaffId) return;
    const startDate = window.prompt("Početak odsustva (YYYY-MM-DD):");
    const endDate = window.prompt("Kraj odsustva (YYYY-MM-DD):");
    if (!startDate || !endDate) return;
    createAbsenceMut.mutate({ centerId, staffId: activeStaffId, data: { startDate, endDate } }, {
      onSuccess: () => {
        toast.success("Odsustvo dodato.");
        queryClient.invalidateQueries({ queryKey: getListEducationEducatorAbsencesQueryKey(centerId, activeStaffId) });
      },
      onError: (e: any) => toast.error("Greška", { description: e.message })
    });
  };

  const handleDeleteAbsence = (absenceId: string) => {
    if (!activeStaffId || !window.confirm("Obriši odsustvo?")) return;
    deleteAbsenceMut.mutate({ centerId, staffId: activeStaffId, absenceId }, {
      onSuccess: () => {
        toast.success("Odsustvo obrisano.");
        queryClient.invalidateQueries({ queryKey: getListEducationEducatorAbsencesQueryKey(centerId, activeStaffId) });
      }
    });
  };

  return (
    <div className="space-y-6">
      {permissions.role !== "educator" && (
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <Label className="whitespace-nowrap">Izaberite edukatora:</Label>
            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Izaberite edukatora..." /></SelectTrigger>
              <SelectContent>
                {staff?.filter(s => s.role === "educator").map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.userId}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {!activeStaffId ? (
        <div className="py-12 text-center text-muted-foreground border-2 border-dashed rounded-lg">Molimo izaberite edukatora za pregled rasporeda.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Nedeljni raspored</CardTitle>
              <CardDescription>Redovno radno vreme (Europe/Belgrade)</CardDescription>
            </CardHeader>
            <CardContent>
              {availLoading ? <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
                <div className="space-y-3">
                  {availability?.length === 0 && <p className="text-sm text-muted-foreground">Nema definisanog rasporeda.</p>}
                  {availability?.map(a => (
                    <div key={a.id} className="flex justify-between items-center p-3 border rounded-md">
                      <span className="font-semibold">{["Pon", "Uto", "Sre", "Čet", "Pet", "Sub", "Ned"][a.weekday - 1]}</span>
                      <span className="text-sm">{a.startTime} - {a.endTime}</span>
                    </div>
                  ))}
                  {/* U produkciji ovde bi bio kompleksniji editor */}
                  <Button variant="outline" className="w-full text-xs">Izmeni raspored (u pripremi)</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <div>
                <CardTitle>Odsustva</CardTitle>
                <CardDescription>Godišnji odmori i slobodni dani</CardDescription>
              </div>
              <Button size="sm" onClick={handleAddAbsence} disabled={createAbsenceMut.isPending}>Dodaj</Button>
            </CardHeader>
            <CardContent>
              {absencesLoading ? <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
                <div className="space-y-3">
                  {absences?.length === 0 && <p className="text-sm text-muted-foreground">Nema unetih odsustava.</p>}
                  {absences?.map(a => (
                    <div key={a.id} className="flex justify-between items-center p-3 border rounded-md">
                      <div>
                        <p className="font-semibold text-sm">{a.startDate.split("-").reverse().join(".")} - {a.endDate.split("-").reverse().join(".")}</p>
                        {a.startTime && <p className="text-xs text-muted-foreground">{a.startTime} - {a.endTime}</p>}
                      </div>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteAbsence(a.id)} disabled={deleteAbsenceMut.isPending}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

