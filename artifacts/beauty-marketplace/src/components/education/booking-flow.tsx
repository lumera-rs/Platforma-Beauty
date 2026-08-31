import { useState, useMemo, useEffect } from "react";
import { Loader2, Plus, Trash2, Users, Calendar, AlertCircle, Copy, CheckCircle2 } from "lucide-react";
import { GroupedAvailabilityView } from "@/components/booking/grouped-availability-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { educationBelgradeDateKey } from "@/lib/education-operational-time";
import { getApiErrorDetails, useGetEducationOperationalInstallmentIpsQr } from "@workspace/api-client-react";

// Use proper types from API when available
export function EducationOperationalBookingFlow({ 
  course, 
  availability, 
  availabilityLoading,
  availabilityError,
  currentUser,
  onCancel,
  createBookingMut,
  refetchAvail,
  resetIdempotencyKey
}: { 
  course: any, 
  availability: any, 
  availabilityLoading?: boolean,
  availabilityError?: boolean,
  currentUser: any,
  onCancel: () => void,
  createBookingMut: any,
  refetchAvail: () => void,
  resetIdempotencyKey: () => void
}) {
  const [step, setStep] = useState<"session" | "participants" | "confirm" | "success">("session");
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  
  const [participants, setParticipants] = useState([
    { userId: currentUser?.user?.id ?? null, fullName: currentUser?.user ? `${currentUser.user.firstName} ${currentUser.user.lastName}` : "", email: currentUser?.user?.email || "", phone: currentUser?.user?.phone || "" }
  ]);
  const [installmentCount, setInstallmentCount] = useState<string>("1");
  const [bookingResult, setBookingResult] = useState<any>(null);
  const ips = useGetEducationOperationalInstallmentIpsQr(bookingResult?.id ?? "", 1, {
    query: {
      enabled: step === "success" && Boolean(bookingResult?.id && bookingResult?.installments?.length),
      queryKey: ["/api/education/operations/bookings", bookingResult?.id, "installments", 1, "ips-qr"],
    }
  });
  
  const candidates = useMemo(() => {
    if (!availability?.slots) return [];
    return availability.slots.map((slot: any) => ({
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      treatments: [{ serviceId: "course", employeeId: slot.educatorStaffId, date: slot.date, startTime: slot.startTime }],
      slot,
      // Availability is authoritative: a candidate must retain the real
      // session identifier rather than trying to reconstruct it from time.
      session: slot.sessionId ? { id: slot.sessionId } : undefined,
    }));
  }, [availability, course.sessions]);

  const calendarDays = useMemo(() => {
    const days: Record<string, any> = {};
    candidates.forEach((c: any) => {
      if (!days[c.date]) days[c.date] = { date: c.date, candidates: [] };
      days[c.date].candidates.push(c);
    });
    return Object.values(days);
  }, [candidates]);
  
  const groupedResponse = {
    salonId: course.id,
    generatedAt: new Date().toISOString(),
    candidates,
    calendarDays
  };

  const handleAddParticipant = () => {
    setParticipants([...participants, { userId: null, fullName: "", email: "", phone: "" }]);
  };
  
  const handleRemoveParticipant = (index: number) => {
    if (index > 0) setParticipants(participants.filter((_, i) => i !== index));
  };
  
  const updateParticipant = (index: number, field: string, value: string) => {
    const next = [...participants];
    next[index] = { ...next[index], [field]: value };
    setParticipants(next);
  };
  
  const handleBook = () => {
    // Validate
    if (participants.some(p => !p.fullName.trim())) return;
    
    // Find sessionId
    const sessionId = selectedCandidate?.session?.id;
    if (!sessionId) {
      alert("Odabrani termin nema vezanu sesiju. Kontaktirajte podršku.");
      return;
    }
    
    createBookingMut.mutate({
      data: {
        courseId: course.id,
        sessionId: sessionId,
        installmentCount: parseInt(installmentCount, 10),
        participants: participants.map(p => ({
          fullName: p.fullName,
          email: p.email || undefined,
          phone: p.phone || undefined,
          userId: p.userId,
        }))
      }
    }, {
      onSuccess: (res: any) => {
        resetIdempotencyKey();
        setBookingResult(res);
        setStep("success");
        refetchAvail();
      },
      onError: (error: unknown) => {
        const { status, message } = getApiErrorDetails(error);
        if (status === 409) {
          alert("Kapacitet je popunjen ili je došlo do konflikta. Proverite dostupnost.");
          refetchAvail();
        } else {
          alert(message || "Greška pri rezervaciji.");
        }
      }
    });
  };

  const money = (val: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(val);
  const totalAmount = course.price * participants.length;
  
  if (step === "session") {
    return (
      <div className="space-y-6">
        <div className="bg-muted/30 p-4 rounded-xl mb-4 border border-border/50">
           <h3 className="font-semibold flex items-center gap-2 mb-2"><Calendar className="w-4 h-4"/> Operativna dostupnost</h3>
           <div className="flex flex-wrap gap-4 text-sm">
             {availability?.nextAvailable && <div className="flex flex-col"><span className="text-muted-foreground">Sledeći termin</span><span className="font-medium">{availability.nextAvailable.date.split("-").reverse().join(".")} u {availability.nextAvailable.startTime}</span></div>}
             {availability?.freeSeats !== null && availability?.freeSeats !== undefined && <div className="flex flex-col"><span className="text-muted-foreground">Slobodnih mesta</span><span className="font-medium">{availability.freeSeats}</span></div>}
             {availability?.lastSpots && <Badge variant="destructive" className="self-center">Poslednja mesta!</Badge>}
             {availability?.waitlistOpen && <Badge variant="secondary" className="self-center">Lista čekanja</Badge>}
           </div>
        </div>

        {availabilityError ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Dostupnost nije učitana</AlertTitle><AlertDescription><Button variant="outline" size="sm" className="mt-2" onClick={refetchAvail}>Pokušaj ponovo</Button></AlertDescription></Alert> : null}
        {!availabilityLoading && !availabilityError && candidates.length === 0 ? <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Nema dostupnih termina</AlertTitle><AlertDescription>Trenutno nema budućih termina sa slobodnim mestima.</AlertDescription></Alert> : null}
        <GroupedAvailabilityView
          isLoading={Boolean(availabilityLoading)}
          viewMode="calendar"
          onViewModeChange={() => {}}
          availabilityResponse={groupedResponse as any}
          salon={{ services: [{ id: "course", name: course.title }], staff: [] }}
          selectedCandidate={selectedCandidate}
          onSelectCandidate={(c) => setSelectedCandidate(c)}
          todayDate={educationBelgradeDateKey(new Date())}
        />
        
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={onCancel}>Odustani</Button>
          <Button disabled={!selectedCandidate} onClick={() => setStep("participants")}>Nastavi</Button>
        </div>
      </div>
    );
  }

  if (step === "participants") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-lg font-bold">Učesnici ({participants.length})</h3>
          {(!availability?.freeSeats || participants.length < availability.freeSeats) && (
            <Button variant="outline" size="sm" onClick={handleAddParticipant}><Plus className="w-4 h-4 mr-2"/>Dodaj učesnika</Button>
          )}
        </div>
        
        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
          {participants.map((p, idx) => (
            <Card key={idx} className="relative">
              {participants.length > 1 && (
                <Button variant="ghost" size="icon" className="absolute top-2 right-2 text-destructive" onClick={() => handleRemoveParticipant(idx)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
              <CardContent className="p-4 space-y-4 pt-6">
                <div className="space-y-2">
                  <Label>Ime i prezime *</Label>
                  <Input value={p.fullName} onChange={(e) => updateParticipant(idx, "fullName", e.target.value)} placeholder="Unesite puno ime" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={p.email} onChange={(e) => updateParticipant(idx, "email", e.target.value)} placeholder="Email adresa" />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefon</Label>
                    <Input type="tel" value={p.phone} onChange={(e) => updateParticipant(idx, "phone", e.target.value)} placeholder="Broj telefona" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        
        <div className="flex justify-between pt-4 border-t mt-4">
          <Button variant="outline" onClick={() => setStep("session")}>Nazad</Button>
          <Button disabled={participants.some(p => !p.fullName.trim())} onClick={() => setStep("confirm")}>Nastavi</Button>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="space-y-6">
        <h3 className="font-serif text-lg font-bold">Pregled rezervacije</h3>
        
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-muted-foreground">Edukacija</p>
                <p className="font-medium">{course.title}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Termin</p>
                <p className="font-medium">{selectedCandidate?.date && selectedCandidate.date.split("-").reverse().join(".")} u {selectedCandidate?.startTime}</p>
              </div>
            </div>
            
            <Separator />
            
            <div>
              <p className="text-sm text-muted-foreground mb-2">Učesnici ({participants.length})</p>
              <ul className="space-y-1 text-sm">
                {participants.map((p, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{p.fullName}</span>
                  </li>
                ))}
              </ul>
            </div>
            
            <Separator />
            
            {course.price > 0 && course.paymentMode === "online_full" && (
              <div className="space-y-2">
                <Label>Način plaćanja</Label>
                <Select value={installmentCount} onValueChange={setInstallmentCount}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Jednokratno ({money(totalAmount)})</SelectItem>
                    <SelectItem value="2">2 rate (po {money(totalAmount / 2)})</SelectItem>
                    <SelectItem value="3">3 rate (po {money(totalAmount / 3)})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="flex justify-between items-center pt-2">
              <span className="font-bold">Ukupno za uplatu:</span>
              <span className="font-serif text-xl font-bold">{money(totalAmount)}</span>
            </div>
          </CardContent>
        </Card>
        
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={() => setStep("participants")}>Nazad</Button>
          <Button disabled={createBookingMut.isPending} onClick={handleBook}>
            {createBookingMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : null}
            Potvrdi rezervaciju
          </Button>
        </div>
      </div>
    );
  }

  if (step === "success" && bookingResult) {
    return (
      <div className="space-y-6 text-center py-8">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <h2 className="font-serif text-2xl font-bold">Rezervacija je zabeležena</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Vaša rezervacija je uspešno kreirana i čeka potvrdu uplate.
          Plaćanje se vrši IPS skeniranjem ili ručnim prenosom.
        </p>

        {bookingResult.installments && bookingResult.installments.length > 0 && (
          <div className="mt-8 text-left bg-muted/20 p-5 rounded-2xl border border-border">
            <h3 className="font-semibold mb-4">Detalji za prvu uplatu</h3>
            
            {ips.isLoading ? <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Učitavanje zvaničnih IPS podataka…</div> : ips.isError ? (
              <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>IPS podaci nisu dostupni</AlertTitle><AlertDescription>Centar nema ispravnu IPS konfiguraciju ili podaci trenutno ne mogu da se učitaju. Ne vršite uplatu bez provere sa centrom.</AlertDescription></Alert>
            ) : ips.data ? (
              <div className="space-y-2">
                <div className="space-y-3 mb-6 text-sm">
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Primalac:</span><span className="font-medium text-right">{ips.data.recipientName}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Račun:</span><span className="font-mono text-right">{ips.data.recipientAccount}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Svrha:</span><span className="text-right">{ips.data.purpose}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Poziv na broj:</span><span className="font-mono text-right">{ips.data.reference}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Iznos:</span><span className="font-bold">{money(ips.data.amount)}</span></div>
                </div>
                <Label>Zvanični IPS payload</Label>
                <div className="relative">
                  <pre className="text-xs bg-background p-3 rounded-lg border overflow-x-auto whitespace-pre-wrap break-all">
                    {ips.data.payload}
                  </pre>
                  <Button size="icon" variant="ghost" className="absolute top-1 right-1" onClick={() => {
                    navigator.clipboard.writeText(ips.data.payload);
                    alert("Kopirano");
                  }}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <Alert className="mt-4 bg-amber-50 border-amber-200">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <AlertTitle className="text-amber-800">Ručna verifikacija</AlertTitle>
                  <AlertDescription className="text-amber-700/80">
                    Skeniranje QR koda ne potvrđuje automatski rezervaciju. Uplata će biti ručno verifikovana od strane administratora u roku od 24h.
                  </AlertDescription>
                </Alert>
              </div>
            ) : <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>IPS podaci nedostaju</AlertTitle><AlertDescription>Kontaktirajte centar pre ručne uplate.</AlertDescription></Alert>}
          </div>
        )}

        <Button className="mt-6 w-full" onClick={onCancel}>Završi i zatvori</Button>
      </div>
    );
  }

  return null;
}
