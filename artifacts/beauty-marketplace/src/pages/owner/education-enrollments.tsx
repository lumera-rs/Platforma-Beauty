import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEnrollments,
  getListEnrollmentsQueryKey,
  useListSalonEmployees,
  getListSalonEmployeesQueryKey,
  useTransferEducationOnlineEnrollment
} from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, ArrowRightLeft, Loader2, Info } from "lucide-react";

const statusLabel: Record<string, string> = {
  pending: "Čeka potvrdu uplate",
  active: "Aktivna",
  completed: "Završena",
  cancelled: "Otkazana",
};

function TransferDialog({ enrollment, open, onOpenChange }: { enrollment: any; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>("");

  const { data: employees } = useListSalonEmployees(undefined, {
    query: { enabled: open, queryKey: getListSalonEmployeesQueryKey() }
  });

  const transfer = useTransferEducationOnlineEnrollment();

  const handleTransfer = () => {
    if (!targetEmployeeId) return;
    transfer.mutate({ enrollmentId: enrollment.id, data: { targetEmployeeId } }, {
      onSuccess: () => {
        toast.success("Pristup je uspešno prebačen", { description: "Zaposleni sada ima pristup edukaciji." });
        queryClient.invalidateQueries({ queryKey: getListEnrollmentsQueryKey() });
        onOpenChange(false);
      },
      onError: (e: any) => {
        toast.error("Greška pri prebacivanju", { description: e.message || "Došlo je do greške." });
      }
    });
  };

  const availableEmployees = employees?.filter(e => e.id !== enrollment.employeeId) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Prebacivanje pristupa edukaciji</DialogTitle>
          <DialogDescription>
            Možete prebaciti aktivni online pristup drugom zaposlenom. Originalni uslovi uplate ostaju nepromenjeni.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Izaberite novog polaznika</Label>
            <Select value={targetEmployeeId} onValueChange={setTargetEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Izaberite zaposlenog..." />
              </SelectTrigger>
              <SelectContent>
                {availableEmployees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded bg-muted/50 p-3 text-sm text-muted-foreground flex gap-2">
            <Info className="w-5 h-5 shrink-0 mt-0.5 text-primary" />
            <p>
              Prebacivanjem prava pristupa, <strong>{enrollment.learnerName}</strong> će trenutno izgubiti pristup ovoj edukaciji,
              dok će novi polaznik dobiti pristup preostalom online sadržaju.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Odustani</Button>
          <Button onClick={handleTransfer} disabled={transfer.isPending || !targetEmployeeId}>
            {transfer.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Potvrdi prebacivanje
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OwnerEducationEnrollments() {
  const { data: enrollments, isLoading } = useListEnrollments(undefined, {
    query: { queryKey: getListEnrollmentsQueryKey() },
  });

  const [transferEnrollment, setTransferEnrollment] = useState<any>(null);

  const ownedPurchases = (enrollments ?? []).filter((enrollment) => enrollment.employeeId);

  return (
    <BusinessLayout>
      <main className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-7">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Edukacije tima</p>
          <h1 className="font-serif text-3xl font-bold">Moje prijave zaposlenih</h1>
          <p className="mt-1 text-muted-foreground">Status uplate i pristupa za mesta koja je kupio vaš salon.</p>
        </div>
        {isLoading ? <Skeleton className="h-36 w-full" /> : ownedPurchases.length ? (
          <div className="space-y-3">
            {ownedPurchases.map((enrollment: any) => {
              const accessExpiresAt = enrollment.accessExpiresAt ? new Date(enrollment.accessExpiresAt) : null;
              const isUnexpired = accessExpiresAt && accessExpiresAt > new Date();

              return (
                <Card key={enrollment.id} className="transition-shadow hover:shadow-md relative overflow-hidden group">
                  <div className="absolute inset-0 z-0">
                    <Link href={`/biznis/edukacije/${enrollment.courseId}`} className="block w-full h-full" />
                  </div>
                  <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 relative z-10 pointer-events-none">
                    <div className="pointer-events-auto w-full sm:w-auto flex-1">
                      <Link href={`/biznis/edukacije/${enrollment.courseId}`} className="hover:underline">
                        <p className="font-semibold text-lg" data-testid={`text-owner-enrollment-course-${enrollment.id}`}>{enrollment.courseTitle}</p>
                      </Link>
                      <p className="mt-1 text-sm font-medium text-foreground">{enrollment.learnerName}</p>
                      {accessExpiresAt && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Online pristup do: {accessExpiresAt.toLocaleDateString("sr-RS")}
                          {!isUnexpired && <span className="text-destructive ml-2">(Isteklo)</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 sm:gap-2 shrink-0 pointer-events-auto">
                      <div className="text-right">
                        <Badge variant={enrollment.paymentStatus === "paid" ? "default" : "secondary"} data-testid={`status-owner-enrollment-${enrollment.id}`}>
                          {statusLabel[enrollment.status] ?? enrollment.status}
                        </Badge>
                        <p className="mt-1 text-xs text-muted-foreground hidden sm:block">{enrollment.paymentStatus === "paid" ? "Uplata potvrđena" : "Uplata nije potvrđena"}</p>
                      </div>

                      {isUnexpired && enrollment.paymentStatus === "paid" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-medium bg-background hover:bg-muted"
                          onClick={(e) => { e.preventDefault(); setTransferEnrollment(enrollment); }}
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" /> Transfer polaznika
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardHeader className="items-center py-14 text-center">
              <GraduationCap className="mb-3 h-10 w-10 text-muted-foreground" />
              <CardTitle>Nema prijava zaposlenih</CardTitle>
              <p className="text-sm text-muted-foreground">Kada kupite kurs za zaposlenog, prijava će biti prikazana ovde.</p>
            </CardHeader>
          </Card>
        )}

        {transferEnrollment && (
          <TransferDialog
            enrollment={transferEnrollment}
            open={!!transferEnrollment}
            onOpenChange={(o) => !o && setTransferEnrollment(null)}
          />
        )}
      </main>
    </BusinessLayout>
  );
}