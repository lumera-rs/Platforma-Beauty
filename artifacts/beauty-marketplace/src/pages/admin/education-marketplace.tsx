import { useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, Banknote, Building2, Loader2, Save, ShieldAlert } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { parseStrictDecimal, parseStrictInt } from "@/lib/admin-form-utils";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

type Center = { id: string; name: string; city: string; verificationStatus: string; verificationNote: string | null; subscriptionStatus: string | null; subscriptionPlan: string | null; heldAmount: number };
type Escrow = { id: string; centerId: string; centerName: string; courseTitle: string; grossAmount: number; platformFee: number; reserveAmount: number; netAmount: number; status: string; releaseAt: string; disputeOpen: boolean; netPaidAt: string | null; reservePaidAt: string | null };
type Dispute = { id: string; enrollmentId: string; courseTitle: string; reason: string; details: string; status: string; resolutionNote: string | null; createdAt: string };
type Settings = { commissionPercent: number; reservePercent: number; onlineRefundDays: number; liveAppealDays: number; featuredCoursePrice: number };
type PendingEnrollment = { id: string; courseTitle: string; amount: number; createdAt: string };
type FeaturedCharge = { id: string; courseId: string; courseTitle: string; centerName: string | null; amount: number; status: string; paymentReference: string | null; activatedAt: string; settledAt: string | null };

const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);
const api = async <T,>(url: string, options?: RequestInit) => {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Zahtev nije uspeo.");
  return body as T;
};

export default function AdminEducationMarketplace() {
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const [settings, setSettings] = useState<Settings | null>(null);
  // Raw string state for settings inputs — validated strictly on save
  const [settingsRaw, setSettingsRaw] = useState<Record<keyof Settings, string>>({ commissionPercent: "0", reservePercent: "0", onlineRefundDays: "0", liveAppealDays: "0", featuredCoursePrice: "0" });
  const [savingSettings, setSavingSettings] = useState(false);
  const [centers, setCenters] = useState<Center[]>([]);
  const [finance, setFinance] = useState<{ summary: Record<string, number>; escrows: Escrow[]; pendingEnrollments: PendingEnrollment[]; featuredCharges: FeaturedCharge[] }>({ summary: {}, escrows: [], pendingEnrollments: [], featuredCharges: [] });
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [nextSettings, nextCenters, nextFinance, nextDisputes] = await Promise.all([
        api<Settings>("/api/admin/education/settings"),
        api<Center[]>("/api/admin/education/centers"),
        api<{ summary: Record<string, number>; escrows: Escrow[]; pendingEnrollments: PendingEnrollment[]; featuredCharges: FeaturedCharge[] }>("/api/admin/education/finance"),
        api<Dispute[]>("/api/education/disputes"),
      ]);
      setSettings(nextSettings);
      setSettingsRaw({
        commissionPercent: String(nextSettings.commissionPercent),
        reservePercent: String(nextSettings.reservePercent),
        onlineRefundDays: String(nextSettings.onlineRefundDays),
        liveAppealDays: String(nextSettings.liveAppealDays),
        featuredCoursePrice: String(nextSettings.featuredCoursePrice),
      });
      setCenters(nextCenters); setFinance(nextFinance); setDisputes(nextDisputes);
    } catch (error) { toast.error("Edukacije nisu učitane", { description: error instanceof Error ? error.message : undefined }); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const saveSettings = async () => {
    if (!settings || savingSettings) return;
    // Validate raw inputs before sending
    const commParsed = parseStrictDecimal(settingsRaw.commissionPercent, { label: "Provizija", allowNegative: false, allowZero: true, max: 100 });
    if (!commParsed.ok) { toast.error("Greška", { description: commParsed.message }); return; }
    const resParsed = parseStrictDecimal(settingsRaw.reservePercent, { label: "Rezerva", allowNegative: false, allowZero: true, max: 100 });
    if (!resParsed.ok) { toast.error("Greška", { description: resParsed.message }); return; }
    const onlineParsed = parseStrictInt(settingsRaw.onlineRefundDays, { label: "Online povraćaj (dani)", allowNegative: false, allowZero: true });
    if (!onlineParsed.ok) { toast.error("Greška", { description: onlineParsed.message }); return; }
    const liveParsed = parseStrictInt(settingsRaw.liveAppealDays, { label: "Live žalba (dani)", allowNegative: false, allowZero: true });
    if (!liveParsed.ok) { toast.error("Greška", { description: liveParsed.message }); return; }
    const featuredParsed = parseStrictInt(settingsRaw.featuredCoursePrice, { label: "Istaknuti kurs (RSD)", allowNegative: false, allowZero: true });
    if (!featuredParsed.ok) { toast.error("Greška", { description: featuredParsed.message }); return; }

    const payload: Settings = {
      commissionPercent: commParsed.value,
      reservePercent: resParsed.value,
      onlineRefundDays: onlineParsed.value,
      liveAppealDays: liveParsed.value,
      featuredCoursePrice: featuredParsed.value,
    };
    if (!actionGuard.begin("save-settings")) return;
    setSavingSettings(true);
    try {
      const updated = await api<Settings>("/api/admin/education/settings", { method: "PATCH", body: JSON.stringify(payload) });
      setSettings(updated);
      setSettingsRaw({
        commissionPercent: String(updated.commissionPercent),
        reservePercent: String(updated.reservePercent),
        onlineRefundDays: String(updated.onlineRefundDays),
        liveAppealDays: String(updated.liveAppealDays),
        featuredCoursePrice: String(updated.featuredCoursePrice),
      });
      toast.success("Pravila obračuna su sačuvana.");
    }
    catch (error) { toast.error("Promena nije sačuvana", { description: error instanceof Error ? error.message : undefined }); }
    finally {
      setSavingSettings(false);
      actionGuard.end("save-settings");
    }
  };
  const changeCenter = async (center: Center, verificationStatus: string) => {
    const actionKey = `center:${center.id}`;
    if (!actionGuard.begin(actionKey)) return;
    try {
      await api(`/api/admin/education/centers/${center.id}`, { method: "PATCH", body: JSON.stringify({ verificationStatus, subscriptionStatus: verificationStatus === "verified" ? "active" : undefined }) });
      toast.success("Status centra je ažuriran."); await load();
    } catch (error) { toast.error("Status nije promenjen", { description: error instanceof Error ? error.message : undefined }); }
    finally { actionGuard.end(actionKey); }
  };
  const settle = async (enrollment: PendingEnrollment) => {
    const actionKey = `settle:${enrollment.id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm(`Potvrditi ručnu uplatu za “${enrollment.courseTitle}”? Tek tada se kreiraju escrow i pristup kursu.`)) {
      actionGuard.end(actionKey);
      return;
    }
    try { await api(`/api/admin/education/enrollments/${enrollment.id}/settle`, { method: "POST" }); toast.success("Uplata je potvrđena i pristup je aktiviran."); await load(); }
    catch (error) { toast.error("Uplata nije potvrđena", { description: error instanceof Error ? error.message : undefined }); }
    finally { actionGuard.end(actionKey); }
  };
  const settleFeatured = async (charge: FeaturedCharge) => {
    const actionKey = `featured-settle:${charge.id}`;
    if (!actionGuard.begin(actionKey)) return;
    const paymentReference = window.prompt(`Potvrditi uplatu naknade za isticanje “${charge.courseTitle}” (${money(charge.amount)})? Unesite referencu uplate (opciono):`);
    if (paymentReference === null) {
      actionGuard.end(actionKey);
      return;
    }
    try { await api(`/api/admin/education/featured-charges/${charge.id}/settle`, { method: "POST", body: JSON.stringify({ paymentReference: paymentReference.trim() || undefined }) }); toast.success("Naknada za isticanje je evidentirana kao plaćena."); await load(); }
    catch (error) { toast.error("Naknada nije potvrđena", { description: error instanceof Error ? error.message : undefined }); }
    finally { actionGuard.end(actionKey); }
  };
  const resolveDispute = async (dispute: Dispute, action: "refund" | "release" | "reject") => {
    const actionKey = `dispute:${dispute.id}`;
    if (!actionGuard.begin(actionKey)) return;
    const resolutionNote = window.prompt("Unesite obrazloženje odluke:");
    if (!resolutionNote?.trim()) {
      actionGuard.end(actionKey);
      return;
    }
    try {
      await api(`/api/admin/education/disputes/${dispute.id}`, { method: "PATCH", body: JSON.stringify({ action, resolutionNote }) });
      toast.success("Odluka o sporu je evidentirana."); await load();
    } catch (error) { toast.error("Odluka nije sačuvana", { description: error instanceof Error ? error.message : undefined }); }
    finally { actionGuard.end(actionKey); }
  };
  const payout = async (centerId: string) => {
    const actionKey = `payout:${centerId}`;
    if (!actionGuard.begin(actionKey)) return;
    try { await api("/api/admin/education/payouts", { method: "POST", body: JSON.stringify({ centerId }) }); toast.success("Ručna isplata neto iznosa je evidentirana."); await load(); }
    catch (error) { toast.error("Isplata nije moguća", { description: error instanceof Error ? error.message : undefined }); }
    finally { actionGuard.end(actionKey); }
  };

  return <AdminLayout>
    <div className="space-y-7">
      <div><p className="text-sm font-semibold uppercase tracking-[.16em] text-primary">LUMERA Edukacije</p><h1 className="mt-1 font-serif text-3xl font-bold">Zaštita kupovina i obračun</h1><p className="mt-2 text-muted-foreground">Interna escrow evidencija — bez automatskog procesiranja kartica ili bankovnih transfera.</p></div>
      {loading || !settings ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : <>
        <section className="grid gap-4 md:grid-cols-4">
          {[["Na čekanju", finance.summary.held ?? 0, "amber"], ["Spremno za isplatu", finance.summary.ready ?? 0, "emerald"], ["Zamrznuto", finance.summary.frozen ?? 0, "rose"], ["Isplaćeno", finance.summary.paidOut ?? 0, "slate"]].map(([label, amount]) =>
            <Card key={String(label)}><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{money(Number(amount))}</p></CardContent></Card>
          )}
        </section>
        <Card>
          <CardHeader><CardTitle>Čeka potvrdu uplate</CardTitle><CardDescription>Ovi zahtevi ne stvaraju escrow niti pristup kursu dok administrator ručno ne potvrdi uplatu.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{finance.pendingEnrollments.length ? finance.pendingEnrollments.map((enrollment) => <div key={enrollment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-semibold">{enrollment.courseTitle}</p><p className="text-sm text-muted-foreground">{money(enrollment.amount)} · zahtev {new Date(enrollment.createdAt).toLocaleDateString("sr-RS")}</p></div><Button size="sm" onClick={() => settle(enrollment)} disabled={actionGuard.isActive(`settle:${enrollment.id}`)}>Potvrdi uplatu</Button></div>) : <p className="py-4 text-sm text-muted-foreground">Nema zahteva koji čekaju potvrdu.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Naknade za isticanje edukacija</CardTitle><CardDescription>Aktiviranje isticanja stvara evidentiranu naknadu platforme. Isticanje je naplaćeno tek kada administrator potvrdi uplatu.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{finance.featuredCharges.length ? finance.featuredCharges.map((charge) => <div key={charge.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{charge.courseTitle}</p><Badge variant={charge.status === "paid" ? "default" : charge.status === "pending" ? "secondary" : "outline"}>{charge.status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{money(charge.amount)}{charge.centerName ? ` · ${charge.centerName}` : ""} · zahtev {new Date(charge.activatedAt).toLocaleDateString("sr-RS")}{charge.paymentReference ? ` · ref: ${charge.paymentReference}` : ""}</p></div>
            {charge.status === "pending" ? <Button size="sm" onClick={() => settleFeatured(charge)} disabled={actionGuard.isActive(`featured-settle:${charge.id}`)}>Potvrdi uplatu</Button> : null}
          </div>) : <p className="py-4 text-sm text-muted-foreground">Nema evidentiranih naknada za isticanje.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex gap-2"><Banknote className="h-5 w-5 text-primary" />Pravila obračuna</CardTitle><CardDescription>Ova pravila se primenjuju na sledeće potvrđene kupovine.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {([["Provizija %", "commissionPercent"], ["Rezerva %", "reservePercent"], ["Online povraćaj (dani)", "onlineRefundDays"], ["Live žalba (dani)", "liveAppealDays"], ["Istaknuti kurs (RSD)", "featuredCoursePrice"]] as [string, keyof Settings][]).map(([label, key]) => <label key={key} className="space-y-2 text-sm font-medium">{label}<Input type="number" min="0" value={settingsRaw[key]} onChange={(event) => setSettingsRaw({ ...settingsRaw, [key]: event.target.value })} /></label>)}
            <div className="flex items-end"><Button onClick={() => void saveSettings()} disabled={savingSettings || actionGuard.isActive("save-settings")} className="w-full">{savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Sačuvaj</Button></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex gap-2"><Building2 className="h-5 w-5 text-primary" />Edukativni centri</CardTitle><CardDescription>Kurs je javno vidljiv i dostupan za kupovinu samo kada je centar verifikovan i pretplata aktivna.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{centers.map((center) => <div key={center.id} className="flex flex-col gap-3 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{center.name}</p><Badge variant={center.verificationStatus === "verified" ? "default" : "secondary"}>{center.verificationStatus}</Badge><Badge variant={center.subscriptionStatus === "active" ? "outline" : "secondary"}>{center.subscriptionStatus ?? "bez pretplate"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{center.city} · zadržano: {money(center.heldAmount)}</p>{center.verificationNote ? <p className="mt-1 text-xs text-muted-foreground">{center.verificationNote}</p> : null}</div>
            <div className="flex gap-2">{center.verificationStatus !== "verified" ? <Button size="sm" onClick={() => changeCenter(center, "verified")} disabled={actionGuard.isActive(`center:${center.id}`)}><BadgeCheck className="mr-2 h-4 w-4" />Verifikuj i aktiviraj</Button> : <Button size="sm" variant="outline" onClick={() => changeCenter(center, "suspended")} disabled={actionGuard.isActive(`center:${center.id}`)}>Obustavi</Button>}</div>
          </div>)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Escrow i ručne isplate</CardTitle><CardDescription>Net iznos postaje podoban po isteku roka; rezerva ostaje odvojena do kvartalne isplate.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{finance.escrows.map((escrow) => <div key={escrow.id} className="flex flex-col gap-3 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between">
            <div><div className="flex gap-2"><p className="font-semibold">{escrow.courseTitle}</p><Badge variant={escrow.status === "frozen" ? "destructive" : "secondary"}>{escrow.status}</Badge>{escrow.disputeOpen && <Badge variant="destructive">spor</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{escrow.centerName} · neto {money(escrow.netAmount)} · rezerva {money(escrow.reserveAmount)} · oslobađanje {new Date(escrow.releaseAt).toLocaleDateString("sr-RS")}</p></div>
            {escrow.status === "ready_for_payout" && !escrow.netPaidAt ? <Button size="sm" onClick={() => payout(escrow.centerId)} disabled={actionGuard.isActive(`payout:${escrow.centerId}`)}>Evidentiraj isplatu</Button> : null}
          </div>)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex gap-2"><ShieldAlert className="h-5 w-5 text-destructive" />Sporovi</CardTitle><CardDescription>Otvoren spor automatski zamrzava povezani escrow. Admin odluka ostaje u finansijskom auditu.</CardDescription></CardHeader>
          <CardContent className="space-y-3">{disputes.length ? disputes.map((dispute) => <div key={dispute.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{dispute.courseTitle}</p><Badge variant="destructive">{dispute.status}</Badge></div><p className="mt-2 text-sm"><b>{dispute.reason}:</b> {dispute.details}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="destructive" onClick={() => resolveDispute(dispute, "refund")} disabled={actionGuard.isActive(`dispute:${dispute.id}`)}>Odobri povraćaj</Button><Button size="sm" onClick={() => resolveDispute(dispute, "release")} disabled={actionGuard.isActive(`dispute:${dispute.id}`)}>Oslobodi isplatu</Button><Button size="sm" variant="outline" onClick={() => resolveDispute(dispute, "reject")} disabled={actionGuard.isActive(`dispute:${dispute.id}`)}>Odbij spor</Button></div></div>) : <p className="py-6 text-center text-sm text-muted-foreground"><AlertTriangle className="mx-auto mb-2 h-5 w-5" />Nema otvorenih sporova.</p>}</CardContent>
        </Card>
      </>}
    </div>
  </AdminLayout>;
}