import { useState, useMemo } from "react";
import {
  useAdminListProductWaitlist,
  type AdminListProductWaitlistAudience,
  type AdminListProductWaitlistParams,
  type AdminListProductWaitlistStatus,
  type AdminProductWaitlistPageItemsItem,
} from "@workspace/api-client-react";
import { Loader2, Search, Package, ListFilter, Calendar } from "lucide-react";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";

import { AdminLayout } from "./layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useDebouncedSearch } from "@/hooks/use-debounce";

export default function AdminWaitlistPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [audience, setAudience] = useState<AdminListProductWaitlistAudience | "all">("all");
  const [status, setStatus] = useState<AdminListProductWaitlistStatus | "all">("all");
  const [page, setPage] = useState(1);

  const queryParams = useMemo<AdminListProductWaitlistParams>(() => ({
    page,
    pageSize: 20,
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    ...(audience !== "all" ? { audience } : {}),
    ...(status !== "all" ? { status } : {}),
  }), [page, debouncedSearch, audience, status]);

  const { data, isLoading, isError } = useAdminListProductWaitlist(queryParams);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return format(new Date(dateStr), "dd.MM.yyyy. HH:mm", { locale: srLatn });
  };

  const getStatusBadge = (itemStatus: string) => {
    switch (itemStatus) {
      case "ACTIVE":
        return <Badge variant="default" className="bg-emerald-500">Aktivno</Badge>;
      case "NOTIFIED":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-700">Obavešten</Badge>;
      case "UNSUBSCRIBED":
        return <Badge variant="outline" className="text-muted-foreground">Odjavljen</Badge>;
      default:
        return <Badge variant="outline">{itemStatus}</Badge>;
    }
  };

  return (
    <AdminLayout>
      <div className="flex flex-col h-full space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">Lista čekanja</h1>
          <p className="text-muted-foreground mt-2">Upravljanje prijavama za obaveštenja o dostupnosti proizvoda.</p>
        </div>

        <Card className="p-4 flex flex-col md:flex-row gap-4 items-center justify-between border-border/50 bg-card/50">
          <div className="flex-1 w-full relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pretraga po proizvodu, kupcu ili salonu..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 w-full md:max-w-md"
            />
          </div>
          <div className="flex w-full md:w-auto items-center gap-4">
            <div className="flex items-center gap-2">
              <ListFilter className="h-4 w-4 text-muted-foreground" />
              <Select value={audience} onValueChange={(value: AdminListProductWaitlistAudience | "all") => { setAudience(value); setPage(1); }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Publika" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Svi</SelectItem>
                  <SelectItem value="B2B">B2B (Saloni)</SelectItem>
                  <SelectItem value="B2C">B2C (Kupci)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Select value={status} onValueChange={(value: AdminListProductWaitlistStatus | "all") => { setStatus(value); setPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Svi statusi</SelectItem>
                <SelectItem value="ACTIVE">Aktivno</SelectItem>
                <SelectItem value="NOTIFIED">Obavešteno</SelectItem>
                <SelectItem value="UNSUBSCRIBED">Odjavljeno</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-center border rounded-xl border-destructive/20 bg-destructive/5">
            <p className="text-destructive font-semibold">Došlo je do greške prilikom učitavanja podataka.</p>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-center border rounded-xl bg-card">
            <Package className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">Nema rezultata</h3>
            <p className="text-muted-foreground max-w-md">Trenutno nema prijava na listi čekanja za zadate filtere.</p>
          </div>
        ) : (
          <Card className="flex-1 flex flex-col overflow-hidden border-border/50">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Proizvod</TableHead>
                    <TableHead>Korisnik</TableHead>
                    <TableHead>Publika</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Datum prijave</TableHead>
                    <TableHead>Obavešten(a)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item: AdminProductWaitlistPageItemsItem) => (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm line-clamp-1">{item.product.name}</span>
                          <span className="text-xs text-muted-foreground font-mono mt-1">SKU: {item.product.sku}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.audience === "B2B" && item.salon ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{item.salon.name}</span>
                            <span className="text-xs text-muted-foreground">Salon</span>
                          </div>
                        ) : item.audience === "B2C" && item.customer ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {item.customer.firstName} {item.customer.lastName}
                            </span>
                            <span className="text-xs text-muted-foreground">Retail kupac</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground italic">Anonimni/Obrisani</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={item.audience === "B2B" ? "bg-purple-100 text-purple-700 border-purple-200" : "bg-sky-100 text-sky-700 border-sky-200"}>
                          {item.audience}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {formatDate(item.createdAt)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.notifiedAt ? formatDate(item.notifiedAt) : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20">
                <span className="text-sm text-muted-foreground">
                  Prikazano {(page - 1) * data.pageSize + 1} - {Math.min(page * data.pageSize, data.total)} od {data.total}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                    Prethodna
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}>
                    Sledeća
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
