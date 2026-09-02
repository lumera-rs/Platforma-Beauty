import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import { Link, useLocation, useSearch } from "wouter";
import { useListRejectedBeautyJobs, getListRejectedBeautyJobsQueryKey, type ListRejectedBeautyJobsParams } from "@workspace/api-client-react";
import { keepPreviousData } from "@tanstack/react-query";
import { AdminLayout } from "@/pages/admin/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Lock, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";

const periods = [
  ["week", "Ova nedelja"],
  ["month", "Ovaj mesec"],
  ["last_30_days", "Poslednjih 30 dana"],
  ["custom", "Prilagođeni datum"],
  ["all", "Sve vreme"],
] as const;

function isRejectedPeriod(
  value: string | null,
): value is NonNullable<ListRejectedBeautyJobsParams["period"]> {
  return value !== null && periods.some(([period]) => period === value);
}

export default function AdminRejectedBeautyJobsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    const handlePopState = () => setHistoryVersion((version) => version + 1);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const searchParams = useMemo(
    () => new URLSearchParams(search),
    [search, historyVersion],
  );

  const rawPeriod = searchParams.get("period");
  const period = isRejectedPeriod(rawPeriod) ? rawPeriod : "month";

  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  const rawPageSize = parseInt(searchParams.get("pageSize") || "20", 10);
  const pageSize = [20, 50, 100].includes(rawPageSize) ? rawPageSize : 20;

  const params: ListRejectedBeautyJobsParams = {
    period,
    from: period === "custom" ? searchParams.get("from") || undefined : undefined,
    to: period === "custom" ? searchParams.get("to") || undefined : undefined,
    page,
    pageSize,
  };

  const { data, isLoading, isError } = useListRejectedBeautyJobs(params, {
    query: { queryKey: getListRejectedBeautyJobsQueryKey(params), placeholderData: keepPreviousData }
  });

  const updateParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    // Reset page if filter changes
    if (Object.keys(changes).some(k => k !== "page" && k !== "pageSize")) {
      next.delete("page");
    }
    setLocation(`/admin/odbijeni-oglasi?${next.toString()}`);
  };

  const handlePageChange = (newPage: number) => {
    updateParams({ page: newPage.toString() });
  };

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Odbijeni oglasi</h1>
        <p className="text-muted-foreground">Evidencija odluka moderacije i razloga odbijanja.</p>
      </div>

      <div className="mb-6 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label id="period-label" className="mb-2 block text-sm font-medium">Period</Label>
          <Select value={period} onValueChange={(val) => updateParams({ period: val, from: "", to: "" })}>
            <SelectTrigger aria-labelledby="period-label" data-testid="filter-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {period === "custom" && (
          <>
            <div className="flex-1">
              <Label htmlFor="date-from" className="mb-2 block text-sm font-medium">Od</Label>
              <Input id="date-from" type="date" value={params.from ?? ""} onChange={(event) => updateParams({ from: event.target.value })} data-testid="filter-from" />
            </div>
            <div className="flex-1">
              <Label htmlFor="date-to" className="mb-2 block text-sm font-medium">Do</Label>
              <Input id="date-to" type="date" value={params.to ?? ""} onChange={(event) => updateParams({ to: event.target.value })} data-testid="filter-to" />
            </div>
          </>
        )}
      </div>

      {isError ? (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-destructive flex items-center gap-3">
          <AlertCircle className="w-6 h-6" />
          <div>
            <h4 className="font-bold">Greška prilikom učitavanja</h4>
            <p className="text-sm opacity-90">Pregled odbijenih oglasa trenutno nije dostupan.</p>
          </div>
        </div>
      ) : isLoading && !data ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : data?.items.length ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between text-sm text-muted-foreground gap-4">
            <p data-testid="results-range">Prikaz {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, data.total)} od {data.total} odbijenih oglasa</p>
            <div className="flex items-center gap-2">
              <Label id="page-size-label" className="whitespace-nowrap">Po strani:</Label>
              <Select value={pageSize.toString()} onValueChange={(v) => updateParams({ pageSize: v, page: "1" })}>
                <SelectTrigger aria-labelledby="page-size-label" className="w-[80px] h-8" data-testid="filter-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {data.items.map((listing) => (
            <article key={listing.id} className="rounded-xl border bg-card p-5 shadow-sm" data-testid={`rejected-card-${listing.id}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge variant="destructive" data-testid={`status-${listing.id}`}>Odbijen</Badge>
                    <Badge variant="outline">{listing.categoryName}</Badge>
                    <Badge variant="secondary">{listing.type}</Badge>
                  </div>
                  <h2 className="text-lg font-bold">{listing.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{listing.authorDisplayName} · {listing.city}</p>
                </div>
                <Link href={`/admin/poslovi/pregled/${listing.id}`} target="_blank" className="inline-flex shrink-0" data-testid={`view-job-${listing.id}`}>
                  <Button variant="outline" size="sm">Otvori oglas ↗</Button>
                </Link>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-destructive/15 bg-destructive/5 p-4 text-sm" data-testid={`public-reason-${listing.id}`}>
                  <p className="font-semibold text-destructive mb-1.5">Javni razlog odbijanja (vidljivo autoru)</p>
                  <p className="whitespace-pre-wrap text-foreground/90">{listing.moderationReason || "Razlog nije sačuvan za stariji oglas."}</p>
                </div>

                <div className="rounded-lg border border-primary/10 bg-primary/5 p-4 text-sm relative" data-testid={`internal-note-${listing.id}`}>
                  <p className="font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> Interna beleška (samo za admina)
                  </p>
                  <p className="whitespace-pre-wrap text-foreground/90">
                    {listing.internalNote || <span className="italic text-muted-foreground">Nema interne beleške.</span>}
                  </p>
                </div>
              </div>

              <p className="mt-4 text-xs text-muted-foreground flex justify-end">
                Odbijeno: {listing.moderatedAt ? format(new Date(listing.moderatedAt), "dd.MM.yyyy. 'u' HH:mm", { locale: srLatn }) : "datum nije dostupan"}
              </p>
            </article>
          ))}

          {data.total > pageSize && (
            <div className="flex items-center justify-between pt-6 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="gap-1.5"
                data-testid="pagination-prev"
              >
                <ChevronLeft className="w-4 h-4" /> Prethodna
              </Button>
              <div className="text-sm font-medium" data-testid="pagination-info">Strana {page} od {Math.ceil(data.total / pageSize)}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= Math.ceil(data.total / pageSize)}
                className="gap-1.5"
                data-testid="pagination-next"
              >
                Sledeća <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-card py-12 text-center text-muted-foreground">Nema odbijenih oglasa u izabranom periodu.</div>
      )}
    </AdminLayout>
  );
}
