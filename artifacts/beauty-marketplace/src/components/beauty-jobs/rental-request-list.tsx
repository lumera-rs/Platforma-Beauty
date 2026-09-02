import React from "react";
import { format, isValid } from "date-fns";
import { srLatn } from "date-fns/locale";
import type { BeautyJobRentalRequest } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarClock } from "lucide-react";

const statusLabels = {
  pending: "Na čekanju",
  accepted: "Prihvaćen",
  declined: "Odbijen",
} as const;

interface RentalRequestListProps {
  requests: BeautyJobRentalRequest[] | undefined;
  isLoading: boolean;
  incoming: boolean;
  pendingRequestId?: string;
  onRespond?: (requestId: string, status: "accepted" | "declined") => void;
}

export function RentalRequestList({ requests, isLoading, incoming, pendingRequestId, onRespond }: RentalRequestListProps) {
  if (isLoading) return <div className="space-y-3"><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="h-28 w-full rounded-xl" /></div>;
  if (!requests?.length) {
    return <div className="rounded-xl border border-dashed bg-muted/20 py-10 text-center text-sm text-muted-foreground">Nema zahteva u ovoj grupi.</div>;
  }
  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <div key={request.id} data-testid={`rental-request-${request.id}`} className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
            <div>
              <p className="font-medium text-foreground">{request.listingTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {incoming ? `Korisnik: ${request.applicantDisplayName}` : `Termin: ${formatRequestRange(request.startsAt, request.endsAt)}`}
              </p>
            </div>
            <Badge variant={request.status === "accepted" ? "default" : request.status === "declined" ? "destructive" : "secondary"}>
              {statusLabels[request.status]}
            </Badge>
          </div>
          {incoming && (
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
              {formatRequestRange(request.startsAt, request.endsAt, true)}
            </div>
          )}
          {request.message && <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/80">{request.message}</p>}
          {incoming && request.status === "pending" && onRespond && (
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={pendingRequestId === request.id} onClick={() => onRespond(request.id, "declined")}>Odbij</Button>
              <Button size="sm" disabled={pendingRequestId === request.id} onClick={() => onRespond(request.id, "accepted")}>Prihvati termin</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function formatRequestRange(startsAt: string | null, endsAt: string | null, includeWeekday = false) {
  if (!startsAt || !endsAt) return "Datum termina nije dostupan";

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!isValid(start) || !isValid(end)) return "Datum termina nije dostupan";

  const startFormat = includeWeekday ? "EEEE, dd.MM.yyyy. HH:mm" : "dd.MM.yyyy. HH:mm";
  return `${format(start, startFormat, { locale: srLatn })}–${format(end, "HH:mm", { locale: srLatn })}`;
}