import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import { Link, useLocation, useSearch } from "wouter";
import { useListRejectedBeautyJobs, getListRejectedBeautyJobsQueryKey, type ListRejectedBeautyJobsParams } from "@workspace/api-client-react";
import { AdminLayout } from "@/pages/admin/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const periods = [
  ["week", "Ova nedelja"],
  ["month", "Ovaj mesec"],
  ["last_30_days", "Poslednjih 30 dana"],
  ["custom", "Prilagođeni datum"],
  ["all", "Sve vreme"],
] as const;

export default function AdminRejectedBeautyJobsPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const searchParams = new URLSearchParams(search);
  const period = periods.some(([value]) => value === searchParams.get("period"))
    ? searchParams.get("period") as NonNullable<ListRejectedBeautyJobsParams["period"]>
    : "month";
  const params: ListRejectedBeautyJobsParams = {
    period,
    from: period === "custom" ? searchParams.get("from") || undefined : undefined,
    to: period === "custom" ? searchParams.get("to") || undefined : undefined,
    page: 1,
    pageSize: 50,
  };
  const { data, isLoading, error } = useListRejectedBeautyJobs(params, {
    query: { queryKey: getListRejectedBeautyJobsQueryKey(params) },
  });
  const updateParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    setLocation(`/admin/odbijeni-oglasi?${next.toString()}`);
  };

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Odbijeni oglasi</h1>
        <p className="text-muted-foreground">Evidencija odluka moderacije i razloga odbijanja.</p>
      </div>

      <div className="mb-6 flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-2 block text-sm font-medium">Period</label>
          <select value={period} onChange={(event) => updateParams({ period: event.target.value, from: "", to: "" })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            {periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {period === "custom" && (
          <>
            <div className="flex-1"><label className="mb-2 block text-sm font-medium">Od</label><Input type="date" value={params.from ?? ""} onChange={(event) => updateParams({ from: event.target.value })} /></div>
            <div className="flex-1"><label className="mb-2 block text-sm font-medium">Do</label><Input type="date" value={params.to ?? ""} onChange={(event) => updateParams({ to: event.target.value })} /></div>
          </>
        )}
      </div>

      {isLoading ? <Skeleton className="h-48 w-full rounded-xl" /> : error ? (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-destructive">Pregled odbijenih oglasa trenutno nije dostupan.</div>
      ) : data?.items.length ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Pronađeno: {data.total}</p>
          {data.items.map((listing) => (
            <article key={listing.id} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2"><Badge variant="destructive">Odbijen</Badge><Badge variant="outline">{listing.categoryName}</Badge></div>
                  <h2 className="text-lg font-bold">{listing.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{listing.authorDisplayName} · {listing.city}</p>
                </div>
                <Link href={`/admin/poslovi/pregled/${listing.id}`} target="_blank"><Button variant="outline" size="sm">Otvori oglas</Button></Link>
              </div>
              <div className="mt-4 rounded-lg border border-destructive/15 bg-destructive/5 p-4 text-sm">
                <p className="font-semibold text-destructive">Razlog odbijanja</p>
                <p className="mt-1 whitespace-pre-wrap">{listing.moderationReason || "Razlog nije sačuvan za stariji oglas."}</p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Odbijeno {listing.moderatedAt ? format(new Date(listing.moderatedAt), "dd.MM.yyyy. HH:mm", { locale: srLatn }) : "datum nije dostupan"}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed bg-card py-12 text-center text-muted-foreground">Nema odbijenih oglasa u izabranom periodu.</div>
      )}
    </AdminLayout>
  );
}