import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "./layout";
import { armHistoryTraversalGuard } from "@/lib/unsaved-changes-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Loader2, PlugZap, Send, ShieldCheck, UsersRound, Webhook } from "lucide-react";

type Integration = "sms" | "brevo" | "google_oauth" | "facebook_oauth";
type Card = { enabled: boolean; configuredInDatabase: boolean; complete: boolean; values: Record<string, string | null>; webhookSecretPendingReconfirmation?: boolean; webhookVerifiedAt?: string | null; webhookVerificationStale?: boolean; webhookConfirmationMaxAgeDays?: number };
type DeliveryReportProvider = "brevo" | "infobip";
type DeliveryReportStatus = { lastEventAt: string | null; lastAutomationSentAt: string | null; recentSendCount: number; warning: boolean };
type DeliveryReports = { providers: Record<DeliveryReportProvider, DeliveryReportStatus>; windowHours: number; graceMinutes: number };

type SmsWebhookRegistrationState = "no_secret" | "confirmed" | "misconfigured" | "stale_secret" | "unconfirmed";

type SmsFallbackReachableAdmin = { firstName: string; lastName: string };
type Data = { integrations: Record<Integration, Card>; deliveryReports?: DeliveryReports; smsFallback?: { reachableAdminCount: number; reachableAdmins: SmsFallbackReachableAdmin[] }; smsWebhookRegistration?: SmsWebhookRegistration; redirectUris: { google: string; facebook: string }; redirectUriWarning?: string; smsReminder: { command: string; active: boolean; instructions: string[] } };

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
  const [savedEnabled, setSavedEnabled] = useState<Record<Integration, boolean> | null>(null);
  const load = async () => {
    const response = await fetch("/api/admin/integrations", { credentials: "include" });
    if (!response.ok) throw new Error("Podešavanja integracija nisu učitana.");
    const payload: Data = await response.json();
    setData(payload);
    setSavedEnabled({ sms: payload.integrations.sms.enabled, brevo: payload.integrations.brevo.enabled, google_oauth: payload.integrations.google_oauth.enabled, facebook_oauth: payload.integrations.facebook_oauth.enabled });
  };
  useEffect(() => { load().catch((error) => toast.error(error.message)); }, []);
  const status = (card: Card) => !card.enabled ? ["Neaktivno", "bg-slate-100 text-slate-600"] : card.complete ? ["Aktivno", "bg-emerald-100 text-emerald-700"] : ["Nepotpuno", "bg-amber-100 text-amber-700"];
  // Unsaved-changes guard: generated or typed values and toggled "enabled" switches take
  // effect only after "Sačuvaj", so leaving the page with a dirty form (e.g. a freshly
  // generated webhook secret) would silently discard it. Saving an integration clears its
  // form fields and re-baselines its enabled flag, which removes the guard.
  const hasUnsavedChanges = useMemo(() => {
    if (Object.values(form).some((values) => Object.values(values).some((value) => value.trim() !== ""))) return true;
    if (!data || !savedEnabled) return false;
    return (Object.keys(savedEnabled) as Integration[]).some((integration) => data.integrations[integration].enabled !== savedEnabled[integration]);
  }, [form, data, savedEnabled]);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const message = "Imate nesačuvane izmene u podešavanjima integracija (npr. generisanu webhook tajnu ili promenjen prekidač). One važe tek kada kliknete „Sačuvaj“. Da li ipak želite da napustite stranicu?";
    // Reload / tab close / external navigation.
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = message; return message; };
    // In-app link navigation (wouter <Link> renders plain anchors).
    const onClickCapture = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      const target = anchor.getAttribute("target");
      if (!href || href.startsWith("#") || (target && target !== "_self")) return;
      const destination = new URL(href, window.location.href);
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
    };
    // Browser Back/Forward is guarded by the module-level popstate listener
    // (see lib/unsaved-changes-guard.ts): a page-local listener would be
    // removed by React's cleanup mid-dispatch when the router unmounts this
    // component, so it must run ahead of the router's subscription instead.
    const disarmHistoryGuard = armHistoryTraversalGuard(message);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      disarmHistoryGuard();
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [hasUnsavedChanges]);
  // The "secret changed, registration not re-confirmed" state is persisted
  // server-side (webhookSecretPendingReconfirmation on each card), so the
  // reminder survives reloads; a successful re-confirmation clears it there
  // and this helper mirrors that in the already-loaded data.
  const clearPendingReconfirmation = (integration: Integration) => setData((previous) => previous
    ? { ...previous, integrations: { ...previous.integrations, [integration]: { ...previous.integrations[integration], webhookSecretPendingReconfirmation: false } } }
    : previous);
  const updateWebhookVerifiedAt = (integration: Integration, value: unknown, stale: unknown = false) => {
    if (typeof value !== "string" && value !== null) return;
    if (typeof stale !== "boolean") return;
    setData((previous) => previous
      ? { ...previous, integrations: { ...previous.integrations, [integration]: { ...previous.integrations[integration], webhookVerifiedAt: value, webhookVerificationStale: stale } } }
      : previous);
  };
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
    setSavedEnabled((previous) => previous ? { ...previous, [integration]: (result as Card).enabled } : previous);
    // The server marks the change only when the saved secret actually differs
    // from the effective one — re-saving an identical secret stays a plain save.
    if ("webhookSecret" in trimmedValues && result.webhookSecretPendingReconfirmation) {
      const smsSecret = integration === "sms";
      toast.warning(
        smsSecret
          ? "Sačuvano — naredna SMS poruka automatski nosi novu webhook tajnu i aktuelni report URL."
          : "Sačuvano — nova webhook tajna važi odmah, pa stara registracija kod provajdera više ne radi.",
        {
          description: smsSecret
            ? "Pošaljite novu SMS poruku, zatim proverite da li je stvarni izveštaj potvrđen. Portal-level URL možete ažurirati opciono."
            : "Kliknite „Kopiraj kompletan URL“, ponovo registrujte URL kod provajdera, pa pokrenite „Proveri webhook“.",
          duration: 12000,
        },
      );
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
      clearPendingReconfirmation(integration);
      updateWebhookVerifiedAt(integration, result.webhookVerifiedAt, result.webhookVerificationStale);
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
      // From the development preview the copied URL carries the dev address;
      // the server flags it so the admin never registers it for production.
      if (typeof result.warning === "string" && result.warning) toast.warning(result.warning, { duration: 12000 });
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
      if (Array.isArray(result.staleWebhooks)) setStaleBrevoWebhooks(result.staleWebhooks);
      if (!response.ok) throw new Error(result.error ?? "Provera registracije na Brevo nije uspela.");
      // A development/preview verdict may be successful only in the softened
      // sense that it found the current secret elsewhere (likely production).
      // The server marks only a strict production-origin verdict as a
      // re-confirmation, so mirror that explicit result instead of clearing
      // on every 200 response.
      if (result.reconfirmed === true) clearPendingReconfirmation("brevo");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provera registracije na Brevo nije uspela.");
    } finally {
      setVerifyingRegistration(false);
    }
  };
  const [verifyingSmsRegistration, setVerifyingSmsRegistration] = useState(false);
  const verifySmsRegistration = async () => {
    setVerifyingSmsRegistration(true);
    try {
      const response = await fetch("/api/admin/integrations/sms/verify-registration", { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Provera registracije nije uspela.");
      if (result.verified) toast.success(result.message);
      else toast.info(result.message, { duration: 15000 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provera registracije nije uspela.", { duration: 15000 });
    } finally {
      // Refresh the standing verdict for both successful checks and actionable
      // 409 responses. A failed provider-side check can change the panel from
      // "Još nepotvrđena" to "Verovatno nije registrovan" when traffic arrived
      // while the check was running.
      await load().catch(() => undefined);
      setVerifyingSmsRegistration(false);
    }
  };
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [staleBrevoWebhooks, setStaleBrevoWebhooks] = useState<Array<{ id: number; maskedUrl: string }>>([]);
  const [selectedStaleBrevoWebhookIds, setSelectedStaleBrevoWebhookIds] = useState<number[]>([]);
  const updateStaleBrevoWebhooks = (
    webhooks: Array<{ id: number; maskedUrl: string }>,
    selectedIds: number[] = webhooks.map((hook) => hook.id),
  ) => {
    setStaleBrevoWebhooks(webhooks);
    setSelectedStaleBrevoWebhookIds(webhooks.filter((hook) => selectedIds.includes(hook.id)).map((hook) => hook.id));
  };
  const registerBrevoWebhook = async () => {
    setRegisteringWebhook(true);
    try {
      const response = await fetch("/api/admin/integrations/brevo/register-webhook", { method: "POST", credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Registracija webhook-a na Brevo nije uspela.");
      // One-click registration re-verified the provider registration with the
      // current secret — the server cleared the reminder; mirror it here.
      clearPendingReconfirmation("brevo");
      updateWebhookVerifiedAt("brevo", result.webhookVerifiedAt, result.webhookVerificationStale);
      // The server lists stale LUMERA-format duplicates (masked URLs) still
      // registered at Brevo after a successful repair; render them with the
      // cleanup action below.
      updateStaleBrevoWebhooks(Array.isArray(result.staleWebhooks) ? result.staleWebhooks : []);
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registracija webhook-a na Brevo nije uspela.");
    } finally {
      setRegisteringWebhook(false);
    }
  };
  const [cleaningStaleWebhooks, setCleaningStaleWebhooks] = useState(false);
  const cleanupStaleBrevoWebhooks = async () => {
    const selectedIds = staleBrevoWebhooks.filter((hook) => selectedStaleBrevoWebhookIds.includes(hook.id)).map((hook) => hook.id);
    if (!selectedIds.length) return;
    if (!window.confirm(`Ukloniti izabrane zaostale LUMERA registracije sa Brevo (${selectedIds.length})? Neoznačene registracije ostaju registrovane. Sveža registracija i webhook-ovi koji nisu u LUMERA formatu neće biti dirani.`)) return;
    setCleaningStaleWebhooks(true);
    try {
      const response = await fetch("/api/admin/integrations/brevo/cleanup-webhooks", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selectedIds }) });
      const result = await response.json();
      if (Array.isArray(result.staleWebhooks)) updateStaleBrevoWebhooks(result.staleWebhooks, selectedIds);
      if (!response.ok) throw new Error(result.error ?? "Uklanjanje zaostalih registracija nije uspelo.");
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Uklanjanje zaostalih registracija nije uspelo.");
    } finally {
      setCleaningStaleWebhooks(false);
    }
  };
  const generateWebhookSecret = (integration: Integration) => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setForm((previous) => ({ ...previous, [integration]: { ...previous[integration], webhookSecret: secret } }));
    toast.success(
      integration === "sms"
        ? "Jaka tajna je generisana. Kliknite „Sačuvaj“ da bi počela da važi; svaka naredna SMS poruka tada automatski nosi aktuelni report URL."
        : "Jaka tajna je generisana. Kliknite „Sačuvaj“ da bi počela da važi, zatim kopirajte kompletan URL i ponovo registrujte webhook kod provajdera.",
    );
  };
  const redirectUri = (integration: Integration) => integration === "google_oauth" ? data?.redirectUris.google : data?.redirectUris.facebook;
  const isDevelopmentPreview = window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1"
    || window.location.hostname.endsWith(".replit.dev");
  const deliveryReport = (integration: Integration): DeliveryReportStatus | null => {
    if (!data?.deliveryReports) return null;
    if (integration === "brevo") return data.deliveryReports.providers.brevo;
    if (integration === "sms") return data.deliveryReports.providers.infobip;
    return null;
  };
  const formatTimestamp = (iso: string | null) => iso ? new Date(iso).toLocaleString("sr-RS") : null;

  return <AdminLayout><div className="space-y-6">
    <header><div className="flex items-center gap-3"><PlugZap className="h-7 w-7 text-primary" /><h1 className="font-serif text-3xl font-bold">Integracije i konektori</h1></div><p className="mt-2 text-muted-foreground">Sačuvane vrednosti su šifrovane u bazi i primenjuju se odmah, bez restarta aplikacije.</p></header>
    {isDevelopmentPreview && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="alert" data-testid="development-preview-notice">
      <p className="font-semibold text-amber-800"><AlertTriangle className="mr-1.5 inline h-4 w-4" />Otvoreno je razvojno okruženje</p>
      <p className="mt-1 text-sm text-amber-800">Webhook i redirect URL-ovi prikazani na ovoj stranici sadrže adresu razvojne probe. Provera i kopiranje odnose se na ovu adresu; registraciju kod provajdera obavite iz objavljene aplikacije, a ne iz preview-a.</p>
    </div>}
    {!data ? <p className="text-muted-foreground">Učitavanje integracija…</p> : <>
      {data.smsFallback?.reachableAdminCount === 0 && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4" role="alert" data-testid="sms-fallback-no-admin-phone">
        <p className="font-semibold text-destructive"><AlertTriangle className="mr-1.5 inline h-4 w-4" />Hitna SMS upozorenja trenutno ne mogu nikoga da dosegnu</p>
        <p className="mt-1 text-sm text-destructive">Nijedan aktivan administrator nema broj telefona na nalogu. Ako slanje e-pošte potpuno otkaže, rezervni SMS je jedini kanal kojim biste saznali za prekid — bez broja telefona upozorenje završava samo u logovima servera.</p>
        <p className="mt-1 text-sm text-destructive">Neka bar jedan administrator doda i verifikuje broj telefona na svom nalogu; ovo obaveštenje nestaje čim prvi broj bude sačuvan. <Link href="/admin/profil" className="font-semibold underline underline-offset-2" data-testid="sms-fallback-no-admin-phone-link">Dodajte broj telefona u svom profilu</Link>.</p>
      </div>}
      {data.smsFallback?.reachableAdminCount === 1 && <div className="rounded-xl border border-sky-300 bg-sky-50 p-4" role="status" data-testid="sms-fallback-single-admin-phone">
        <p className="font-semibold text-sky-800"><ShieldCheck className="mr-1.5 inline h-4 w-4" />Hitna SMS upozorenja trenutno zavise od samo jednog administratora</p>
        <p className="mt-1 text-sm text-sky-800">Samo jedan aktivan administrator ima broj telefona za rezervna SMS upozorenja. Ako ta osoba nije dostupna ili bude deaktivirana, potpuni prekid slanja e-pošte mogao bi ponovo proći neprimećeno.</p>
        <p className="mt-1 text-sm text-sky-800">Preporučujemo da još jedan aktivan administrator doda i verifikuje broj telefona.</p>
      </div>}
      {data.smsFallback && <section className="rounded-xl border bg-card p-4 shadow-sm" data-testid="sms-fallback-audience">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <UsersRound className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Administratori za hitni SMS</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Ovo su aktivni administratori sa sačuvanim brojem telefona koji bi primili rezervno SMS upozorenje ako slanje e-pošte potpuno otkaže.</p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold" data-testid="sms-fallback-audience-count">{data.smsFallback.reachableAdminCount}</span>
        </div>
        {data.smsFallback.reachableAdmins.length > 0 ? <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="sms-fallback-audience-list">
          {data.smsFallback.reachableAdmins.map((admin, index) => <li key={`${admin.firstName}-${admin.lastName}-${index}`} className="rounded-lg border bg-muted/30 px-3 py-2 text-sm font-medium">
            {admin.firstName} {admin.lastName}
          </li>)}
        </ul> : <p className="mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="sms-fallback-audience-empty">Trenutno nema aktivnog administratora koji može da primi rezervni SMS.</p>}
      </section>}
      <div className="grid gap-6 xl:grid-cols-2">{(Object.keys(fields) as Integration[]).map((integration) => {
        const card = data.integrations[integration]; const [label, color] = status(card);
        return <section key={integration} className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{titles[integration]}</h2><p className="text-sm text-muted-foreground">{card.configuredInDatabase ? "Baza je izvor konfiguracije." : "Koristi environment fallback dok ne sačuvate vrednosti."}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{label}</span></div>
          <label className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm font-medium">Omogući integraciju <input type="checkbox" data-testid={`toggle-enabled-${integration}`} checked={card.enabled} onChange={(event) => setData({ ...data, integrations: { ...data.integrations, [integration]: { ...card, enabled: event.target.checked } } })} /></label>
          {fields[integration].map((field) => <div key={field.key} className="space-y-1.5"><Label>{field.label}</Label>{card.values[field.key] && <p className="text-xs text-muted-foreground">Sačuvano: {card.values[field.key]}</p>}{field.key === "webhookSecret" && (integration === "sms" || integration === "brevo") ? <>
            <div className="flex gap-2">
              <div className="flex-1"><PasswordInput data-testid={`input-webhook-secret-${integration}`} value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} /></div>
              <Button type="button" variant="outline" data-testid={`generate-webhook-secret-${integration}`} onClick={() => generateWebhookSecret(integration)}><KeyRound className="mr-2 h-4 w-4" />Generiši tajnu</Button>
            </div>
            <p className="text-xs text-muted-foreground">Generisana tajna počinje da važi tek kada kliknete „Sačuvaj“.</p>
          </> : field.secret ? <PasswordInput value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} /> : <Input type="text" value={form[integration][field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setForm({ ...form, [integration]: { ...form[integration], [field.key]: event.target.value } })} />}</div>)}
          {(integration === "google_oauth" || integration === "facebook_oauth") && <div className="rounded-lg border bg-muted/30 p-3"><Label>Redirect URI</Label>{data.redirectUriWarning && <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-800" role="alert" data-testid="oauth-redirect-development-warning"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{data.redirectUriWarning}</p>}<div className="mt-2 flex gap-2"><Input readOnly value={redirectUri(integration)} /><Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(redirectUri(integration) ?? "").then(() => toast.success("Redirect URI je kopiran."))}><Copy className="h-4 w-4" /></Button></div></div>}
          {(integration === "sms" || integration === "brevo") && <div className="rounded-lg border bg-muted/30 p-3">
            <Label>Webhook URL za statuse isporuke</Label>
            {card.webhookSecretPendingReconfirmation && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{integration === "sms" ? "Webhook tajna je promenjena — naredna SMS poruka automatski nosi novi report URL." : "Webhook tajna je promenjena — URL registrovan kod provajdera više ne važi."}</p>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-xs text-amber-800">
                {integration === "sms" ? <>
                  <li>Pošaljite novu SMS poruku da Infobip dobije aktuelni URL i tajnu.</li>
                  <li>Sačekajte stvarni izveštaj o isporuci, pa pokrenite „Proveri registraciju (Infobip)“.</li>
                  <li>Po želji ažurirajte portal-level URL preko „Kopiraj kompletan URL“.</li>
                </> : <>
                  <li>Kliknite „Kopiraj kompletan URL“ da dobijete URL sa novom tajnom.</li>
                  <li>Ponovo registrujte taj URL kod provajdera (Brevo — ili upotrebite „Registruj webhook“ ispod).</li>
                  <li>Pokrenite „Proveri webhook“ da potvrdite da sve radi.</li>
                </>}
              </ol>
            </div>}
            <p className="mt-1 text-xs text-muted-foreground">{integration === "sms" ? "Svaka SMS poruka sa sačuvanom webhook tajnom automatski nosi aktuelni Infobip delivery-report URL. Portal-level registracija je i dalje podržana; za nju" : "Registrujte kod provajdera (Brevo transactional webhooks); za nju"} zamenite {"<tajna>"} sačuvanom webhook tajnom:</p>
            <div className="mt-2 rounded bg-muted p-2 font-mono text-xs break-all">{`${window.location.origin}/api/webhooks/${integration === "sms" ? "infobip" : "brevo"}/<tajna>`}</div>
             {isDevelopmentPreview && <p className="mt-1.5 text-xs font-medium text-amber-700" data-testid={`development-webhook-url-caveat-${integration}`}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Ovo je URL razvojne probe. Nemojte ga registrovati kod provajdera za produkciju.</p>}
            <div className={`mt-2 rounded-lg border p-3 ${card.webhookVerifiedAt && card.webhookVerificationStale ? "border-amber-300 bg-amber-50" : "bg-muted/30"}`} data-testid={`webhook-confirmation-status-${integration}`}>
              <p className={`text-xs ${card.webhookVerificationStale ? "font-semibold text-amber-800" : "text-muted-foreground"}`}>
                {card.webhookVerificationStale && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                Poslednja uspešna potvrda: <span className="font-medium">{formatTimestamp(card.webhookVerifiedAt ?? null) ?? "nikada potvrđeno"}</span>
                {card.webhookVerifiedAt && !card.webhookVerificationStale && <span className="ml-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">sveža potvrda</span>}
                {card.webhookVerifiedAt && card.webhookVerificationStale && <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">potvrda je zastarela</span>}
              </p>
              {card.webhookVerifiedAt && card.webhookVerificationStale && <p className="mt-1 text-xs font-medium text-amber-800" role="alert" data-testid={`stale-webhook-confirmation-${integration}`}>
                Ova potvrda je starija od {card.webhookConfirmationMaxAgeDays ?? 7} dana. Pokrenite {integration === "sms" ? "„Proveri webhook“ da potvrdite da endpoint i sačuvana tajna i dalje rade" : "„Proveri registraciju na Brevo“ da potvrdite da Brevo koristi aktuelni URL, tajnu i sve potrebne događaje"}.
              </p>}
            </div>
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
              {integration === "sms" && <Button variant="outline" size="sm" disabled={verifyingSmsRegistration} onClick={verifySmsRegistration}>
                {verifyingSmsRegistration ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {verifyingSmsRegistration ? "Proveravam…" : "Proveri registraciju (Infobip)"}
              </Button>}
            </div>
            {integration === "brevo" && staleBrevoWebhooks.length > 0 && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Zaostale LUMERA registracije na Brevo ({staleBrevoWebhooks.length})</p>
              <p className="mt-1 text-xs text-amber-800">Ove registracije pokazuju na stare domene ili nose stare tajne, pa primaju događaje koji se odbacuju ili gube. Uklanjanje ne dira sveže registrovan webhook niti webhook-ove koji nisu u LUMERA formatu.</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 font-mono text-xs text-amber-800 break-all">
                {staleBrevoWebhooks.map((hook) => <li key={hook.id}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      data-testid={`stale-brevo-webhook-checkbox-${hook.id}`}
                      checked={selectedStaleBrevoWebhookIds.includes(hook.id)}
                      onChange={() => setSelectedStaleBrevoWebhookIds((previous) => previous.includes(hook.id) ? previous.filter((id) => id !== hook.id) : [...previous, hook.id])}
                      className="mt-0.5 shrink-0"
                    />
                    <span>{hook.maskedUrl}</span>
                  </label>
                </li>)}
              </ul>
               <Button variant="outline" size="sm" className="mt-2 border-amber-300 text-amber-800 hover:bg-amber-100" disabled={cleaningStaleWebhooks || selectedStaleBrevoWebhookIds.length === 0} onClick={cleanupStaleBrevoWebhooks}>
                {cleaningStaleWebhooks ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                {cleaningStaleWebhooks ? "Uklanjam…" : "Ukloni zaostale registracije"}
              </Button>
            </div>}
            {integration === "sms" && data.smsWebhookRegistration && (() => {
              const registration = data.smsWebhookRegistration;
              const panels: Record<SmsWebhookRegistrationState, { tone: "ok" | "warn" | "neutral"; badge: string; text: string }> = {
                confirmed: { tone: "ok", badge: "Registracija potvrđena", text: `Infobip zaista dostavlja izveštaje o isporuci na ovaj endpoint sa aktuelnom tajnom — poslednji stvarni izveštaj: ${formatTimestamp(registration.lastReportAt) ?? "—"}.` },
                unconfirmed: { tone: "neutral", badge: "Još nepotvrđena", text: "Nema nedavnih automatskih SMS poruka po kojima bi se registracija potvrdila — to NIJE znak greške. Kada je webhook tajna sačuvana, svaka nova poruka sama nosi aktuelni delivery-report URL, pa prvi stvarni izveštaj potvrđuje da sve radi. Portal-level delivery-report URL je i dalje podržan ako ga želite podesiti unapred. Infobip API ne omogućava očitavanje registrovanog report URL-a." },
                no_secret: { tone: "warn", badge: "Tajna nije sačuvana", text: "Webhook tajna nije sačuvana, pa endpoint odbija sve Infobip izveštaje i nove poruke ne mogu automatski da prijave report URL. Generišite i sačuvajte tajnu; svaka naredna SMS poruka tada nosi aktuelni URL. Portal-level URL možete podesiti opciono." },
                stale_secret: { tone: "warn", badge: "Verovatno stara tajna", text: `Tajna je promenjena ${formatTimestamp(registration.secretSavedAt) ?? "—"}, a poslednji potvrđeni izveštaj je stariji (${formatTimestamp(registration.lastReportAt) ?? "—"}) — starija portal registracija kod Infobip-a najverovatnije još nosi staru tajnu. Naredna SMS poruka sačuvanu novu tajnu i aktuelni report URL nosi automatski; portal URL možete ažurirati za buduće portal-level izveštaje.` },
                misconfigured: { tone: "warn", badge: "Izveštaji još ne stižu", text: "Automatske SMS poruke se šalju, ali Infobip ne dostavlja izveštaje iz očekivanog saobraćaja — portal webhook može biti pogrešan ili nositi staru tajnu. Sa sačuvanom webhook tajnom naredna poruka automatski nosi aktuelni delivery-report URL; pošaljite novu poruku ili podesite report URL u Infobip portalu (koristite „Kopiraj kompletan URL“)." },
              };
              const panel = panels[registration.state];
              const boxClass = panel.tone === "ok" ? "border-emerald-300 bg-emerald-50" : panel.tone === "warn" ? "border-amber-300 bg-amber-50" : "bg-muted/30";
              const textClass = panel.tone === "ok" ? "text-emerald-800" : panel.tone === "warn" ? "text-amber-800" : "text-muted-foreground";
              const badgeClass = panel.tone === "ok" ? "bg-emerald-100 text-emerald-700" : panel.tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
              return <div className={`mt-3 rounded-lg border p-3 ${boxClass}`} data-testid="sms-webhook-registration-panel">
                <div className="flex items-center justify-between gap-2">
                  <Label className={panel.tone === "warn" ? "text-amber-800" : panel.tone === "ok" ? "text-emerald-800" : undefined}>Registracija na Infobip</Label>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}>
                    {panel.tone === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : panel.tone === "warn" ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    {panel.badge}
                  </span>
                </div>
                <p className={`mt-1.5 text-xs ${textClass}`}>{panel.text}</p>
              </div>;
            })()}
            <p className="mt-1.5 text-xs text-muted-foreground">Kopiranje ubacuje sačuvanu tajnu umesto {"<tajna>"} — nalepite kopirani URL direktno kod provajdera, bez ručnog sklapanja.</p>
            <p className="mt-1.5 text-xs text-muted-foreground">Šalje probni događaj na sopstveni endpoint sa sačuvanom tajnom — potvrđuje da se tajna poklapa i da endpoint prima događaje, bez uticaja na isporuke.</p>
            {integration === "sms" && <p className="mt-1 text-xs text-muted-foreground">Provera registracije: Infobip API ne omogućava očitavanje registrovanog report URL-a, pa provera kombinuje probni događaj na sopstveni endpoint sa dokazima iz stvarnog saobraćaja — svaka nova poruka automatski pokušava da prijavi aktuelni URL, a stvarni izveštaj primljen posle poslednje promene tajne potvrđuje da izveštaji stižu. Portal-level registracija ostaje podržana za naloge koji je koriste. Tajna se nikada ne prikazuje.</p>}
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

type SmsWebhookRegistration = { state: SmsWebhookRegistrationState; secretSavedAt: string | null; lastReportAt: string | null };
