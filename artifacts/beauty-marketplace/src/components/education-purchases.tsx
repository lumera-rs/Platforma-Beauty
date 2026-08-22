import { useEffect, useState } from "react";
import { BookOpen, Loader2, MessageCircle, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type Purchase = { id: string; courseTitle: string; learnerName: string; status: string; paymentStatus: string; progress: number; purchasedAt: string; escrowStatus: string | null; escrowReleaseAt: string | null };
type Thread = { messages: { id: string; body: string; senderName: string; createdAt: string }[] };
const call = async <T,>(path: string, init?: RequestInit) => {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Zahtev nije uspeo.");
  return result as T;
};

export function EducationPurchases() {
  const { toast } = useToast();
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    try { setPurchases(await call<Purchase[]>("/api/education/purchases")); }
    catch (error) { toast.error("Edukacije nisu učitane", { description: error instanceof Error ? error.message : undefined }); setPurchases([]); }
  };
  useEffect(() => { void load(); }, []);
  const showMessages = async (purchase: Purchase) => {
    try {
      const thread = await call<Thread>(`/api/education/purchases/${purchase.id}/messages`);
      const history = thread.messages.map((message) => `${message.senderName}: ${message.body}`).join("\n\n") || "Još nema poruka.";
      const body = window.prompt(`Poruke za “${purchase.courseTitle}”\n\n${history}\n\nNova poruka:`);
      if (!body?.trim()) return;
      setBusy(purchase.id);
      await call(`/api/education/purchases/${purchase.id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      toast.success("Poruka je poslata centru.");
    } catch (error) { toast.error("Poruka nije poslata", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(null); }
  };
  const report = async (purchase: Purchase) => {
    const reason = window.prompt("Kratak razlog prijave problema:");
    if (!reason?.trim()) return;
    const details = window.prompt("Opišite problem i očekivano rešenje:");
    if (!details?.trim()) return;
    try {
      setBusy(purchase.id);
      await call(`/api/education/purchases/${purchase.id}/disputes`, { method: "POST", body: JSON.stringify({ reason, details }) });
      toast.success("Problem je prijavljen. Escrow je zamrznut dok admin ne donese odluku.");
      await load();
    } catch (error) { toast.error("Problem nije prijavljen", { description: error instanceof Error ? error.message : undefined }); }
    finally { setBusy(null); }
  };
  if (!purchases) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  if (!purchases.length) return <Card><CardContent className="py-12 text-center"><BookOpen className="mx-auto mb-3 h-7 w-7 text-primary" /><p className="font-semibold">Još nemate kupljene edukacije</p><p className="mt-1 text-sm text-muted-foreground">Nakon potvrđene kupovine, ovde dobijate pristup sadržaju, porukama i podršci.</p></CardContent></Card>;
  return <div className="space-y-4">{purchases.map((purchase) => <Card key={purchase.id} className="overflow-hidden">
    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-serif text-lg font-bold">{purchase.courseTitle}</h3><Badge>{purchase.paymentStatus === "paid" ? "kupovina potvrđena" : purchase.paymentStatus}</Badge>{purchase.escrowStatus === "frozen" ? <Badge variant="destructive">spor u obradi</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">Polaznik: {purchase.learnerName} · Napredak: {purchase.progress}%</p>{purchase.escrowReleaseAt ? <p className="mt-1 text-xs text-muted-foreground">Zaštita kupovine traje do {new Date(purchase.escrowReleaseAt).toLocaleDateString("sr-RS")}.</p> : null}</div>
      <div className="flex flex-wrap gap-2">{purchase.paymentStatus === "paid" ? <><Button size="sm" onClick={() => window.location.assign(`/moj-nalog/edukacije/lms/${purchase.id}`)}><BookOpen className="mr-2 h-4 w-4" />Otvori kurs</Button><Button size="sm" variant="outline" disabled={busy === purchase.id} onClick={() => void showMessages(purchase)}><MessageCircle className="mr-2 h-4 w-4" />Poruke</Button>{(!purchase.escrowReleaseAt || new Date(purchase.escrowReleaseAt) > new Date()) ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy === purchase.id || purchase.escrowStatus === "frozen"} onClick={() => void report(purchase)}><ShieldAlert className="mr-2 h-4 w-4" />Prijavi problem</Button> : null}</> : <p className="text-sm text-muted-foreground">Čeka se ručna potvrda uplate. Pristup se aktivira nakon potvrde.</p>}</div>
    </CardContent>
  </Card>)}</div>;
}