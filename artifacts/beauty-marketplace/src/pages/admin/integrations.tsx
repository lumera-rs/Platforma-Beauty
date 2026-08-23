import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Loader2, PlugZap, Send, ShieldCheck, Webhook } from "lucide-react";

type Integration = "sms" | "brevo" | "google_oauth" | "facebook_oauth";
type Card = { enabled: boolean; configuredInDatabase: boolean; complete: boolean; values: Record<string, string | null> };
type DeliveryReportProvider = "brevo" | "infobip";
type DeliveryReportStatus = { lastEventAt: string | null; lastAutomationSentAt: string | null; recentSendCount: number; warning: boolean };
type DeliveryReports = { providers: Record<DeliveryReportProvider, DeliveryReportStatus>; windowHours: number; graceMinutes: number };
type Data = { integrations: Record<Integration, Card>; deliveryReports?: DeliveryReports; redirectUris: { google: string; facebook: string }; smsReminder: { command: string; active: boolean; instructions: string[] } };

const fields: Record<Integration, Array<{ key: string; label: string; placeholder: string; secret?: boolean }>> = {
  sms: [{ key: "apiKey", label: "Infobip API ključ", placeholder: "Unesite novi API ključ", secret: true }, { key: "senderName", label: "Naziv pošiljaoca", placeholder: "LUMERA" }, { key: "baseUrl", label: "Base URL (opciono)", placeholder: "https://api.infobip.com" }, { key: "webhookSecret", label: "Webhook tajna (izveštaji o isporuci)", placeholder: "Unesite tajnu za webhook URL", secret: true }],
  brevo: [{ key: "apiKey", label: "Brevo API ključ", placeholder: "Unesite novi API ključ", secret: true }, { key: "senderEmail", label: "E-mail pošiljaoca", placeholder: "noreply@vasdomen.rs" }, { key: "senderName", label: "Ime pošiljaoca", placeholder: "LUMERA" }, { key: "webhookSecret", label: "Webhook tajna (isporuka/otvaranja)", placeholder: "Unesite tajnu za webhook URL", secret: true }],
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
  const [webhookSecretChanged, setWebhookSecretChanged] = useState<Record<Integration, boolean>>({ sms: false, brevo: false, google_oauth: false, facebook_oauth: false });
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
    const changedWebhookSecret = (integration === "sms" || integration === "brevo") && "webhookSecret" in trimmedValues;
    if (changedWebhookSecret) {
      setWebhookSecretChanged((previous) => ({ ...previous, [integration]: true }));
      toast.warning("Sačuvano — nova webhook tajna važi odmah, pa stara registracija kod provajdera više ne radi.", { description: "Kliknite „Kopiraj kompletan URL“, ponovo registrujte URL kod provajdera, pa pokrenite „Proveri webhook“.", duration: 12000 });
    } else {
      toast.success("Podešavanja su sačuvana i odmah aktivna.");
    }
  };
  const test = async (integration: Integration) => {
    const recipient = testRecipient[integration].trim();
    if (!recipient) { toast.error("Unesite primaoca za test poruku."); return; }
    const response = await fetch(`/api/admin/integrations/${integration}/test`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Test nije uspeo.");
    toast.success(result.message);
  };
  const [verifyingWebhook, setVerifyingWebhook] = useState<Record<Integration, boolean>>({ sms: false, brevo: false, google_oauth: false, facebook_oauth: false });
  const verifyWebhook = async (integration: Integration) => {
    setVerifyingWebhook((previous) => ({ ...previous, [integration]: true }));
    try {
      const response = await fetch(`/api/admin/integrations/${integration}/verify-webhook`, { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Provera webhook-a nije uspela.");
      setWebhookSecretChanged((previous) => ({ ...previous, [integration]: false }));
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provera webhook-a nije uspela.");
    } finally {
      setVerifyingWebhook((previous) => ({ ...previous, [integration]: false }));
    }
  };
  const [copyingWebhookUrl, setCopyingWebhookUrl] = useState<Record<Integration, boolean>>({ sms: false, brevo: false, google_oauth: false, facebook_oauth: false });
  const copyWebhookUrl = async (integration: Integration) => {
    setCopyingWebhookUrl((previous) => ({ ...previous, [integration]: true }));
    try {
      const response = await fetch(`/api/admin/integrations/${integration}/webhook-url`, { credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Webhook URL nije učitan.");
      await navigator.clipboard.writeText(result.url);
      toast.success("Kompletan webhook URL sa sačuvanom tajnom je kopiran.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kopiranje webhook URL-a nije uspelo.");
    } finally {
      setCopyingWebhookUrl((previous) => ({ ...previous, [integration]: false }));
    }
  };
  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  const verifyBrevoRegistration = async () => {
    setVerifyingRegistration(true);
    try {
      const response = await fetch("/api/admin/integrations/brevo/verify-registration", { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Provera registracije na Brevo nije uspela.");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provera registracije na Brevo nije uspela.");
    } finally {
      setVerifyingRegistration(false);
    }
  };
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const registerBrevoWebhook = async () => {
    setRegisteringWebhook(true);
    try {
      const response = await fetch("/api/admin/integrations/brevo/register-webhook", { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Registracija webhook-a na Brevo nije uspela.");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registracija webhook-a na Brevo nije uspela.");
    } finally {
      setRegisteringWebhook(false);
    }
  };
  const generateWebhookSecret = (integration: Integration) => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setForm((previous) => ({ ...previous, [integration]: { ...previous[integration], webhookSecret: secret } }));
    toast.success("Jaka tajna je generisana. Kliknite „Sačuvaj“ da bi počela da važi, zatim kopirajte kompletan URL i ponovo registrujte webhook kod provajdera.");
  };
  const redirectUri = (integration: Integration) => integration === "google_oauth" ? data?.redirectUris.google : data?.redirectUris.facebook;
  const deliveryReport = (integration: Integration): DeliveryReportStatus | null => {
    if (!data?.deliveryReports) return null;
    if (integration === "brevo") return data.deliveryReports.providers.brevo;
    if (integration === "sms") return data.deliveryReports.providers.infobip;
    return null;
  };
  const formatTimestamp = (iso: string | null) => iso ? new Date(iso).toLocaleString("sr-RS") : null;

  return <AdminLayout><div className="space-y-6">
    <header><div className="flex items-center gap-3"><PlugZap className="h-7 w-7 text-primary" /><h1 className="font-serif text-3xl font-bold">Integracije i konektori</h1></div><p className="mt-2 text-muted-foreground">Sačuvane vrednosti su šifrovane u bazi i primenjuju se odmah, bez restarta aplikacije.</p></header>
    {!data ? <p className="text-muted-foreground">Učitavanje integracija…</p> : <>
      <div className="grid gap-6 xl:grid-cols-2">{(Object.keys(fields) as Integration[]).map((integration) => {
        const card = data.integrations[integration]; const [label, color] = status(card);
        return <section key={integration} className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{titles[integration]}</h2><p className="text-sm text-muted-foreground">{card.configuredInDatabase ? "Baza je izvor konfiguracije." : "Koristi environment fallback dok ne sačuvate vrednosti."}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{label}</span></div>
          <label className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm font-medium">Omogući integraciju <input type="checkbox" checked={card.enabled} onChange={(event) => setData({ ...data, integrations: { ...data.integrations, [integration]: { ...card, enabled: event.target.checked } } })} /></label>
          {fields[integration].map((field) => <div key={field.key} className="space-y-1.5"><Label>{field.label}</Label>{card.values[field.key] && <p className="text-xs text-muted-foreground">Sačuvano: {card.values[field.key]}</p>}{field.key === "webhookSecret" && (integration === "sms" || integration === "brevo") ? <>
            <div className="flex gap-2">
              <div className="flex-1"><PasswordInput value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} /></div>
              <Button type="button" variant="outline" onClick={() => generateWebhookSecret(integration)}><KeyRound className="mr-2 h-4 w-4" />Generiši tajnu</Button>
            </div>
            <p className="text-xs text-muted-foreground">Generisana tajna počinje da važi tek kada kliknete „Sačuvaj“.</p>
          </> : field.secret ? <PasswordInput value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} /> : <Input type="text" value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} />}</div>)}
          {(integration === "google_oauth" || integration === "facebook_oauth") && <div className="rounded-lg border bg-muted/30 p-3"><Label>Redirect URI</Label><div className="mt-2 flex gap-2"><Input readOnly value={redirectUri(integration)} /><Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(redirectUri(integration) ?? "").then(() => toast.success("Redirect URI je kopiran."))}><Copy className="h-4 w-4" /></Button></div></div>}
          {(integration === "sms" || integration === "brevo") && <div className="rounded-lg border bg-muted/30 p-3">
            <Label>Webhook URL za statuse isporuke</Label>
            {webhookSecretChanged[integration] && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Webhook tajna je promenjena — URL registrovan kod provajdera više ne važi.</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-amber-800">
                <li>Kliknite „Kopiraj kompletan URL“ da dobijete URL sa novom tajnom.</li>
                <li>Ponovo registrujte taj URL kod provajdera ({integration === "sms" ? "Infobip delivery reports" : "Brevo — ili upotrebite „Registruj webhook“ ispod"}).</li>
                <li>Pokrenite „Proveri webhook“ da potvrdite da sve radi.</li>
              </ol>
            </div>}
            <p className="mt-1 text-xs text-muted-foreground">Registrujte kod provajdera ({integration === "sms" ? "Infobip delivery reports" : "Brevo transactional webhooks"}); zamenite {"<tajna>"} sačuvanom webhook tajnom:</p>
            <div className="mt-2 rounded bg-muted p-2 font-mono text-xs break-all">{`${window.location.origin}/api/webhooks/${integration === "sms" ? "infobip" : "brevo"}/<tajna>`}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={copyingWebhookUrl[integration]} onClick={() => copyWebhookUrl(integration)}>
                {copyingWebhookUrl[integration] ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                {copyingWebhookUrl[integration] ? "Kopiram…" : "Kopiraj kompletan URL"}
              </Button>
              <Button variant="outline" size="sm" disabled={verifyingWebhook[integration]} onClick={() => verifyWebhook(integration)}>
                {verifyingWebhook[integration] ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Webhook className="mr-2 h-4 w-4" />}
                {verifyingWebhook[integration] ? "Proveravam…" : "Proveri webhook"}
              </Button>
              {integration === "brevo" && <Button variant="outline" size="sm" disabled={verifyingRegistration} onClick={verifyBrevoRegistration}>
                {verifyingRegistration ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {verifyingRegistration ? "Proveravam…" : "Proveri registraciju na Brevo"}
              </Button>}
              {integration === "brevo" && <Button variant="outline" size="sm" disabled={registeringWebhook} onClick={registerBrevoWebhook}>
                {registeringWebhook ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
                {registeringWebhook ? "Registrujem…" : "Registruj webhook"}
              </Button>}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Kopiranje ubacuje sačuvanu tajnu umesto {"<tajna>"} — nalepite kopirani URL direktno kod provajdera, bez ručnog sklapanja.</p>
            <p className="mt-1.5 text-xs text-muted-foreground">Šalje probni događaj na sopstveni endpoint sa sačuvanom tajnom — potvrđuje da se tajna poklapa i da endpoint prima događaje, bez uticaja na isporuke.</p>
            {integration === "brevo" && <p className="mt-1 text-xs text-muted-foreground">Provera registracije pita Brevo API da li je webhook zaista registrovan kod provajdera: da li URL pokazuje na ovaj domen, nosi aktuelnu tajnu i prati sve potrebne događaje (isporuke, otvaranja, odbijanja i greške). Poređenje se obavlja na serveru; tajna se nikada ne prikazuje.</p>}
            {integration === "brevo" && <p className="mt-1 text-xs text-muted-foreground">„Registruj webhook“ jednim klikom kreira ili ažurira transakcioni webhook direktno preko Brevo API-ja — URL ove aplikacije sa sačuvanom tajnom i pretplatom na događaje isporuke, otvaranja, bounce-ova, blokada i grešaka — a zatim ponovo proverava registraciju. Tajna se koristi samo na serveru.</p>}
          </div>}
          {(integration === "sms" || integration === "brevo") && (() => {
            const report = deliveryReport(integration);
            if (!report) return null;
            return <div className={`rounded-lg border p-3 space-y-2 ${report.warning ? "border-amber-300 bg-amber-50" : "bg-muted/30"}`}>
              <div className="flex items-center justify-between gap-2">
                <Label className={report.warning ? "text-amber-800" : undefined}>Izveštaji o isporuci</Label>
                {report.warning && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Ne stižu</span>}
              </div>
              <p className={`text-xs ${report.warning ? "text-amber-800" : "text-muted-foreground"}`}>Poslednji primljen izveštaj: <span className="font-medium">{formatTimestamp(report.lastEventAt) ?? "nijedan do sada"}</span></p>
              {report.lastAutomationSentAt && <p className={`text-xs ${report.warning ? "text-amber-800" : "text-muted-foreground"}`}>Poslednja automatska poruka poslata: <span className="font-medium">{formatTimestamp(report.lastAutomationSentAt)}</span> ({report.recentSendCount} u poslednja {data.deliveryReports?.windowHours ?? 24} h)</p>}
              {report.warning && <p className="text-xs font-medium text-amber-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Automatske poruke su nedavno poslate, ali provajder nije javio nijedan izveštaj o isporuci u očekivanom roku ({data.deliveryReports?.graceMinutes ?? 30} min). Proverite da li je webhook URL registrovan kod provajdera i da li se webhook tajna poklapa sa sačuvanom.</p>}
            </div>;
          })()}
          {(integration === "sms" || integration === "brevo") && <div className="rounded-lg bg-muted/30 p-3 space-y-2"><Label>{integration === "sms" ? "Broj za test SMS" : "E-mail za test poruku"}</Label><Input value={testRecipient[integration]} onChange={(event) => setTestRecipient({ ...testRecipient, [integration]: event.target.value })} placeholder={integration === "sms" ? "+381..." : "admin@vasdomen.rs"} /></div>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => save(integration).catch((error) => toast.error(error instanceof Error ? error.message : "Čuvanje nije uspelo."))}><CheckCircle2 className="mr-2 h-4 w-4" />Sačuvaj</Button><Button variant="outline" onClick={() => test(integration).catch((error) => toast.error(error instanceof Error ? error.message : "Test nije uspeo."))}><Send className="mr-2 h-4 w-4" />{integration === "sms" ? "Pošalji test SMS" : integration === "brevo" ? "Pošalji test e-mail" : "Testiraj konfiguraciju"}</Button></div>
        </section>;
      })}</div>
      <section className="rounded-xl border bg-card p-6 shadow-sm"><div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-primary" /><div><h2 className="text-xl font-semibold">SMS podsetnik · Scheduled Job</h2><p className="text-sm text-muted-foreground">Status: <span className="font-medium text-slate-600">Platforma ne prijavljuje ovaj status aplikaciji</span></p></div></div><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">{data.smsReminder.instructions.map((item) => <li key={item}>{item}</li>)}</ol><div className="mt-4 rounded-lg bg-muted p-3 font-mono text-sm">{data.smsReminder.command}</div></section>
    </>}</div></AdminLayout>;
}
