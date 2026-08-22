import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle2, Copy, PlugZap, Send, ShieldCheck } from "lucide-react";

type Integration = "sms" | "brevo" | "google_oauth" | "facebook_oauth";
type Card = { enabled: boolean; configuredInDatabase: boolean; complete: boolean; values: Record<string, string | null> };
type Data = { integrations: Record<Integration, Card>; redirectUris: { google: string; facebook: string }; smsReminder: { command: string; active: boolean; instructions: string[] } };

const fields: Record<Integration, Array<{ key: string; label: string; placeholder: string; secret?: boolean }>> = {
  sms: [{ key: "apiKey", label: "Infobip API ključ", placeholder: "Unesite novi API ključ", secret: true }, { key: "senderName", label: "Naziv pošiljaoca", placeholder: "LUMERA" }, { key: "baseUrl", label: "Base URL (opciono)", placeholder: "https://api.infobip.com" }],
  brevo: [{ key: "apiKey", label: "Brevo API ključ", placeholder: "Unesite novi API ključ", secret: true }, { key: "senderEmail", label: "E-mail pošiljaoca", placeholder: "noreply@vasdomen.rs" }, { key: "senderName", label: "Ime pošiljaoca", placeholder: "LUMERA" }],
  google_oauth: [{ key: "clientId", label: "Client ID", placeholder: "Google Client ID" }, { key: "clientSecret", label: "Client Secret", placeholder: "Unesite novi Client Secret", secret: true }],
  facebook_oauth: [{ key: "clientId", label: "App ID", placeholder: "Facebook App ID" }, { key: "clientSecret", label: "App Secret", placeholder: "Unesite novi App Secret", secret: true }],
};
const titles: Record<Integration, string> = { sms: "SMS · Infobip", brevo: "E-mail · Brevo", google_oauth: "Google prijava", facebook_oauth: "Facebook prijava" };

export default function AdminIntegrations() {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Record<Integration, Record<string, string>>>({ sms: {}, brevo: {}, google_oauth: {}, facebook_oauth: {} });
  const [testRecipient, setTestRecipient] = useState<Record<Integration, string>>({ sms: "", brevo: "", google_oauth: "", facebook_oauth: "" });
  const load = async () => {
    const response = await fetch("/api/admin/integrations", { credentials: "include" });
    if (!response.ok) throw new Error("Podešavanja integracija nisu učitana.");
    setData(await response.json());
  };
  useEffect(() => { load().catch((error) => toast.error(error.message)); }, []);
  const status = (card: Card) => !card.enabled ? ["Neaktivno", "bg-slate-100 text-slate-600"] : card.complete ? ["Aktivno", "bg-emerald-100 text-emerald-700"] : ["Nepotpuno", "bg-amber-100 text-amber-700"];
  const save = async (integration: Integration) => {
    const trimmedValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(form[integration])) {
      if (v.trim()) trimmedValues[k] = v.trim();
    }
    const response = await fetch(`/api/admin/integrations/${integration}`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: data!.integrations[integration].enabled, values: trimmedValues }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Čuvanje nije uspelo.");
    setData({ ...data!, integrations: { ...data!.integrations, [integration]: result } });
    setForm({ ...form, [integration]: {} });
    toast.success("Podešavanja su sačuvana i odmah aktivna.");
  };
  const test = async (integration: Integration) => {
    const recipient = testRecipient[integration].trim();
    if (!recipient) { toast.error("Unesite primaoca za test poruku."); return; }
    const response = await fetch(`/api/admin/integrations/${integration}/test`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Test nije uspeo.");
    toast.success(result.message);
  };
  const redirectUri = (integration: Integration) => integration === "google_oauth" ? data?.redirectUris.google : data?.redirectUris.facebook;

  return <AdminLayout><div className="space-y-6">
    <header><div className="flex items-center gap-3"><PlugZap className="h-7 w-7 text-primary" /><h1 className="font-serif text-3xl font-bold">Integracije i konektori</h1></div><p className="mt-2 text-muted-foreground">Sačuvane vrednosti su šifrovane u bazi i primenjuju se odmah, bez restarta aplikacije.</p></header>
    {!data ? <p className="text-muted-foreground">Učitavanje integracija…</p> : <>
      <div className="grid gap-6 xl:grid-cols-2">{(Object.keys(fields) as Integration[]).map((integration) => {
        const card = data.integrations[integration]; const [label, color] = status(card);
        return <section key={integration} className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{titles[integration]}</h2><p className="text-sm text-muted-foreground">{card.configuredInDatabase ? "Baza je izvor konfiguracije." : "Koristi environment fallback dok ne sačuvate vrednosti."}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{label}</span></div>
          <label className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm font-medium">Omogući integraciju <input type="checkbox" checked={card.enabled} onChange={(event) => setData({ ...data, integrations: { ...data.integrations, [integration]: { ...card, enabled: event.target.checked } } })} /></label>
          {fields[integration].map((field) => <div key={field.key} className="space-y-1.5"><Label>{field.label}</Label>{card.values[field.key] && <p className="text-xs text-muted-foreground">Sačuvano: {card.values[field.key]}</p>}{field.secret ? <PasswordInput value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} /> : <Input type="text" value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} />}</div>)}
          {(integration === "google_oauth" || integration === "facebook_oauth") && <div className="rounded-lg border bg-muted/30 p-3"><Label>Redirect URI</Label><div className="mt-2 flex gap-2"><Input readOnly value={redirectUri(integration)} /><Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(redirectUri(integration) ?? "").then(() => toast.success("Redirect URI je kopiran."))}><Copy className="h-4 w-4" /></Button></div></div>}
          {(integration === "sms" || integration === "brevo") && <div className="rounded-lg bg-muted/30 p-3 space-y-2"><Label>{integration === "sms" ? "Broj za test SMS" : "E-mail za test poruku"}</Label><Input value={testRecipient[integration]} onChange={(event) => setTestRecipient({ ...testRecipient, [integration]: event.target.value })} placeholder={integration === "sms" ? "+381..." : "admin@vasdomen.rs"} /></div>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => save(integration).catch((error) => toast.error(error instanceof Error ? error.message : "Čuvanje nije uspelo."))}><CheckCircle2 className="mr-2 h-4 w-4" />Sačuvaj</Button><Button variant="outline" onClick={() => test(integration).catch((error) => toast.error(error instanceof Error ? error.message : "Test nije uspeo."))}><Send className="mr-2 h-4 w-4" />{integration === "sms" ? "Pošalji test SMS" : integration === "brevo" ? "Pošalji test e-mail" : "Testiraj konfiguraciju"}</Button></div>
        </section>;
      })}</div>
      <section className="rounded-xl border bg-card p-6 shadow-sm"><div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-primary" /><div><h2 className="text-xl font-semibold">SMS podsetnik · Scheduled Job</h2><p className="text-sm text-muted-foreground">Status: <span className="font-medium text-slate-600">Platforma ne prijavljuje ovaj status aplikaciji</span></p></div></div><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">{data.smsReminder.instructions.map((item) => <li key={item}>{item}</li>)}</ol><div className="mt-4 rounded-lg bg-muted p-3 font-mono text-sm">{data.smsReminder.command}</div></section>
    </>}</div></AdminLayout>;
}