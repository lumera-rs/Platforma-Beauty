import { Link, useRoute } from "wouter";
import { getAdminGetSalonQueryKey, getAdminListSalonsQueryKey, useAdminGetSalon, useAdminUpdateSalon } from "@workspace/api-client-react";
import { AdminLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BadgeCheck, Building2, Crown, Loader2, ReceiptText, Save, Store, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

const money = (amount: number) => `${amount.toLocaleString("sr-RS")} RSD`;
const statusLabel: Record<string, string> = {
  pending: "Novo", confirmed: "Potvrđeno", paid: "Plaćeno", processing: "U obradi",
  shipped: "Poslato", delivered: "Isporućeno", cancelled: "Otkazano",
  unpaid: "Neplaćeno", refunded: "Refundirano", failed: "Neuspešno",
};

export default function AdminSalonDetail() {
  const [, params] = useRoute("/admin/saloni/:salonId");
  const salonId = params?.salonId ?? "";
  const { data: salon, isLoading } = useAdminGetSalon(salonId, { query: { enabled: Boolean(salonId), queryKey: getAdminGetSalonQueryKey(salonId) } });
  const updateSalon = useAdminUpdateSalon();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const [videoUrl, setVideoUrl] = useState("");

  useEffect(() => {
    setVideoUrl(salon?.videoUrl ?? "");
  }, [salon?.videoUrl]);

  const update = (key: string, data: { isVerified?: boolean; featured?: boolean; topSalon?: boolean; videoUrl?: string | null }) => {
    if (!actionGuard.begin(key)) return;
    updateSalon.mutate({ salonId, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminGetSalonQueryKey(salonId) });
        queryClient.invalidateQueries({ queryKey: getAdminListSalonsQueryKey() });
        toast.success("Podaci salona su ažurirani.");
        actionGuard.end(key);
      },
      onError: () => { toast.error("Podaci salona nisu ažurirani."); actionGuard.end(key); },
    });
  };

  return <AdminLayout>
    {isLoading ? <div className="p-10 text-center"><Loader2 className="inline animate-spin" /></div>
      : !salon ? <p className="p-10 text-muted-foreground">Salon nije pronađen.</p>
        : <div className="space-y-5">
          <Button asChild variant="ghost"><Link href="/admin/saloni"><ArrowLeft className="mr-2 h-4 w-4" />Nazad na salone</Link></Button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h1 className="text-3xl font-serif font-bold">{salon.name}</h1><p className="text-muted-foreground">Administrativni profil salona i B2B porudžbine.</p></div>
            <div className="flex gap-2"><Badge variant={salon.active ? "default" : "secondary"}>{salon.active ? "Aktivan" : "Neaktivan"}</Badge>{salon.featured && <Badge variant="outline">Izdvojen</Badge>}{salon.topSalon && <Badge variant="outline">Top Salon</Badge>}{salon.isVerified && <Badge className="gap-1"><BadgeCheck className="h-3.5 w-3.5" />Verifikovan</Badge>}</div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Ukupno porudžbina</p><p className="mt-1 text-3xl font-bold">{salon.orderCount}</p></CardContent></Card>
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Ukupna vrednost</p><p className="mt-1 text-2xl font-bold">{money(salon.orderTotal)}</p></CardContent></Card>
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Pretplata</p><p className="mt-1 font-semibold">{salon.subscriptionPlan ?? "Bez pretplate"}</p><p className="text-xs text-muted-foreground">{salon.subscriptionStatus ?? "—"}</p></CardContent></Card>
            <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">Loyalty nivo</p><p className="mt-1 font-semibold">{salon.loyaltyTier ?? "Nije dodeljen"}</p><p className="text-xs text-muted-foreground">Potrošnja: {money(salon.loyaltySpend)}</p></CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Store className="h-5 w-5" />Osnovni podaci</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p><b>Kontakt:</b> {salon.phone} · {salon.email}</p><p><b>Adresa:</b> {salon.address}, {salon.postalCode} {salon.city}</p><p><b>Ocena:</b> {salon.rating.toLocaleString("sr-RS")} ({salon.reviewCount} recenzija)</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Building2 className="h-5 w-5" />Status partnerstva</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p><b>Pretplata:</b> {salon.subscriptionPlan ?? "Bez aktivnog paketa"}</p><p><b>Status:</b> {salon.subscriptionStatus ?? "—"}</p><p className="flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /><b>Loyalty:</b> {salon.loyaltyTier ?? "Nije dodeljen"}</p>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Video className="h-5 w-5" />Javni profil</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div><p className="font-medium">Verifikovan salon</p><p className="text-sm text-muted-foreground">Bedž je vidljiv klijentima tek kada ga administracija potvrdi.</p></div>
                <Switch checked={salon.isVerified} onCheckedChange={(checked) => update("verified", { isVerified: checked })} disabled={actionGuard.isActive("verified")} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div><p className="font-medium">Istaknuti salon</p><p className="text-sm text-muted-foreground">Administracija odlučuje da li je salon prikazan u istaknutoj kolekciji.</p></div>
                <Switch checked={salon.featured} onCheckedChange={(checked) => update("featured", { featured: checked })} disabled={actionGuard.isActive("featured")} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div><p className="font-medium">Top Salon</p><p className="text-sm text-muted-foreground">Administrativni bedž za preporučene salone na platformi.</p></div>
                <Switch checked={salon.topSalon} onCheckedChange={(checked) => update("top", { topSalon: checked })} disabled={actionGuard.isActive("top")} />
              </div>
              <div className="space-y-2">
                <label htmlFor="admin-video-url" className="text-sm font-medium">Video URL</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input id="admin-video-url" type="url" placeholder="https://..." value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} />
                  <Button type="button" disabled={actionGuard.isActive("video")} onClick={() => update("video", { videoUrl: videoUrl.trim() || null })}><Save className="mr-2 h-4 w-4" />Sačuvaj</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><ReceiptText className="h-5 w-5" />Porudžbine</CardTitle></CardHeader><CardContent>
            {salon.orders.length === 0 ? <p className="text-sm text-muted-foreground">Salon još nema B2B porudžbine.</p> : <div className="space-y-2">
              {salon.orders.map((order) => <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div><Link href={`/admin/porudzbine/${order.id}`} className="font-semibold text-primary hover:underline">#{order.id.slice(0, 8).toUpperCase()}</Link><p className="text-muted-foreground">{new Date(order.createdAt).toLocaleString("sr-RS")} · {order.itemCount} stavki</p></div>
                <div className="flex items-center gap-2"><Badge variant="outline">{statusLabel[order.status] ?? order.status}</Badge><Badge variant="secondary">{statusLabel[order.paymentStatus] ?? order.paymentStatus}</Badge><b>{money(order.total)}</b></div>
              </div>)}
            </div>}
          </CardContent></Card>
        </div>}
  </AdminLayout>;
}