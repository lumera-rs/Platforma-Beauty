import { useEffect, useState } from "react";
import { Link, useRoute, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, BadgeCheck, Building2, Save, Loader2, Landmark, Settings2, FileText, Ban, RefreshCw } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListEducationCenterReviews,
  getAdminListEducationCenterReviewsQueryKey,
  getListPublicEducationCenterReviewsQueryKey,
  useAdminModerateEducationCenterReview,
  useConfigureEducationCustomContract,
  useGetCurrentUser,
  useReactivateEducationCenter,
  useSettleEducationPaymentObligation,
  getListAdminEducationCustomPlanRequestsQueryKey,
  getApiErrorDetails,
  type AdminListEducationCenterReviewsStatus
} from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EducationFieldHelp } from "@/components/education/education-field-help";

// Types
type BillingSetting = {
  override: number | null;
  globalDefault: number;
  effectiveValue: number;
  source: "global" | "custom";
};

type CenterDetail = {
  id: string;
  name: string;
  city: string;
  pib: string | null;
  verificationStatus: string;
  verificationNote: string | null;
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  deactivatedAt: string | null;
  reactivation: {
    state: "not_needed" | "payment_required" | "selection_required" | "ready";
    paymentReady: boolean;
    courseLimit: number;
    candidateCourses: Array<{ id: string; title: string }>;
    requiredKeepCount: number;
    selectionRequired: boolean;
    selectionComplete: boolean;
  } | null;
  billingSettings: {
    commissionPercent: BillingSetting;
    reservePercent: BillingSetting;
    onlineRefundDays: BillingSetting;
    liveAppealDays: BillingSetting;
    featuredCoursePrice: BillingSetting;
  };
};

type OverrideKey = keyof CenterDetail["billingSettings"];
type PaymentObligation = {
  id: string; centerId: string | null; kind: string; status: string; expectedAmount: number;
  referenceSnapshot: string; servicePeriodStart: string | null; servicePeriodEnd: string | null;
};

const overrideLimits: Record<OverrideKey, number> = {
  commissionPercent: 100,
  reservePercent: 100,
  onlineRefundDays: 365,
  liveAppealDays: 365,
  featuredCoursePrice: 100_000_000,
};

const api = async <T,>(url: string, options?: RequestInit) => {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Zahtev nije uspeo.");
  return body as T;
};

export default function AdminEducationCenterDetail() {
  const [, params] = useRoute("/admin/edukacije/centri/:centerId");
  const centerId = params?.centerId ?? "";

  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const initialRequestId = searchParams.get("requestId") || undefined;
  const initialLimit = searchParams.get("limit") || "10";

  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const queryClient = useQueryClient();
  const { data: currentUserResponse } = useGetCurrentUser();
  const currentUser = currentUserResponse?.user;

  const [center, setCenter] = useState<CenterDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Reviews
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewFilter, setReviewFilter] = useState<AdminListEducationCenterReviewsStatus | "">("");

  const { data: reviewsData, isLoading: loadingReviews } = useAdminListEducationCenterReviews(
    { centerId, status: reviewFilter || undefined, page: reviewPage, pageSize: 10 },
    { query: { enabled: !!centerId, queryKey: getAdminListEducationCenterReviewsQueryKey({ centerId, status: reviewFilter || undefined, page: reviewPage, pageSize: 10 }) } }
  );

  const moderateReviewMut = useAdminModerateEducationCenterReview();

  // Local state for edits
  const [pib, setPib] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [customCycle, setCustomCycle] = useState<"monthly" | "yearly">("monthly");
  const [customEndsAt, setCustomEndsAt] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [customLimit, setCustomLimit] = useState(initialLimit);
  const [customAutoRenew, setCustomAutoRenew] = useState(false);
  const [obligations, setObligations] = useState<PaymentObligation[]>([]);
  const [selectedObligation, setSelectedObligation] = useState<PaymentObligation | null>(null);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [settlementReason, setSettlementReason] = useState("");
  const [reactivationReason, setReactivationReason] = useState("");
  const [overrides, setOverrides] = useState<Record<OverrideKey, { enabled: boolean; value: string }>>({
    commissionPercent: { enabled: false, value: "" },
    reservePercent: { enabled: false, value: "" },
    onlineRefundDays: { enabled: false, value: "" },
    liveAppealDays: { enabled: false, value: "" },
    featuredCoursePrice: { enabled: false, value: "" },
  });

  const load = async () => {
    setLoading(true);
    try {
      const [data, paymentRows] = await Promise.all([
        api<CenterDetail>(`/api/admin/education/centers/${centerId}`),
        api<PaymentObligation[]>("/api/admin/education/payment-obligations"),
      ]);
      setCenter(data);
      setObligations(paymentRows.filter((row) => row.centerId === centerId));
      setPib(data.pib || "");

      const newOverrides = { ...overrides };
      (Object.keys(data.billingSettings) as OverrideKey[]).forEach((key) => {
        const setting = data.billingSettings[key];
        newOverrides[key] = {
          enabled: setting.source === "custom",
          value: setting.source === "custom" ? String(setting.override ?? 0) : String(setting.globalDefault),
        };
      });
      setOverrides(newOverrides);
    } catch (error) {
      toast.error("Greška pri učitavanju", { description: error instanceof Error ? error.message : "Centar nije pronađen." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (centerId) {
      void load();
    }
  }, [centerId]);

  const updateStatus = async (verificationStatus: string) => {
    const actionKey = `status:${centerId}`;
    if (!actionGuard.begin(actionKey)) return;
    try {
      const updated = await api<CenterDetail>(`/api/admin/education/centers/${centerId}`, {
        method: "PATCH",
        body: JSON.stringify({
          verificationStatus
        })
      });
      setCenter(updated);
      toast.success("Status centra je ažuriran.");
    } catch (error) {
      toast.error("Status nije promenjen", { description: error instanceof Error ? error.message : undefined });
    } finally {
      actionGuard.end(actionKey);
    }
  };

  const configureContractMut = useConfigureEducationCustomContract();
  const reactivateMut = useReactivateEducationCenter();
  const settleObligationMut = useSettleEducationPaymentObligation();

  const configureCustomContract = async () => {
    const amountRsd = Number(customAmount);
    const limitNum = Number(customLimit);
    if (!Number.isInteger(amountRsd) || amountRsd <= 0 || !Number.isInteger(limitNum) || limitNum < 1 || !customEndsAt || customReason.trim().length < 3) {
      toast.error("Popunite iznos, ciklus, ograničenje, datum isteka i razlog ugovora."); return;
    }
    const actionKey = `custom-contract:${centerId}`;
    if (!actionGuard.begin(actionKey)) return;

    try {
      await configureContractMut.mutateAsync({
        centerId,
        data: {
          amountRsd,
          billingCycle: customCycle,
          contractEndsAt: new Date(customEndsAt).toISOString(),
          reason: customReason,
          courseLimit: limitNum,
          autoRenew: customAutoRenew,
          requestId: initialRequestId
        }
      });
      queryClient.invalidateQueries({ queryKey: getListAdminEducationCustomPlanRequestsQueryKey() });
      toast.success("Ugovoreni plan je sačuvan. Aktiviraće se tek nakon evidentirane uplate.");
      await load();
    } catch (error) {
      toast.error("Ugovor nije sačuvan", { description: error instanceof Error ? error.message : undefined });
    } finally { actionGuard.end(actionKey); }
  };

  const openSettlementDialog = (obligation: PaymentObligation) => {
    setSelectedObligation(obligation);
    setReceivedAmount("");
    setSettlementReason("");
  };

  const closeSettlementDialog = () => {
    if (settleObligationMut.isPending) return;
    setSelectedObligation(null);
    setReceivedAmount("");
    setSettlementReason("");
  };

  const receivedAmountResult = parseStrictInt(receivedAmount, {
    label: "Primljeni iznos",
    allowNegative: false,
    allowZero: true,
  });
  const amountMatches = Boolean(
    selectedObligation
    && receivedAmountResult.ok
    && receivedAmountResult.value === selectedObligation.expectedAmount,
  );
  const amountDifference = selectedObligation && receivedAmountResult.ok
    ? receivedAmountResult.value - selectedObligation.expectedAmount
    : null;
  const settlementReasonValid = settlementReason.trim().length >= 3;

  const settleObligation = async () => {
    const obligation = selectedObligation;
    if (!obligation) return;
    if (!receivedAmountResult.ok) {
      toast.error("Primljeni iznos nije ispravan", { description: receivedAmountResult.message });
      return;
    }
    if (!amountMatches) {
      toast.error("Iznosi se ne poklapaju", { description: "Settlement je dozvoljen samo kada je primljeni iznos jednak očekivanom." });
      return;
    }
    if (!settlementReasonValid) { toast.error("Unesite razlog ručne potvrde uplate."); return; }
    const actionKey = `settle:${obligation.id}`;
    if (!actionGuard.begin(actionKey)) return;
    try {
      await settleObligationMut.mutateAsync({
        obligationId: obligation.id,
        data: {
          confirmedAmountRsd: receivedAmountResult.value,
          reason: settlementReason.trim(),
        },
      });
      toast.success(center?.subscriptionStatus === "suspended"
        ? "Uplata je evidentirana. Reaktivacija ostaje zaključana do završne provere."
        : "Uplata je evidentirana i primenjena.");
      setSelectedObligation(null);
      setReceivedAmount("");
      setSettlementReason("");
      await load();
    } catch (error) {
      toast.error("Uplata nije evidentirana", { description: extractApiError(error) });
      if (getApiErrorDetails(error).status === 409) {
        setSelectedObligation(null);
        setReceivedAmount("");
        setSettlementReason("");
        await load();
      }
    } finally { actionGuard.end(actionKey); }
  };

  const reactivateCenter = async () => {
    if (reactivationReason.trim().length < 3) {
      toast.error("Unesite obavezan razlog reaktivacije.");
      return;
    }
    const actionKey = `reactivate:${centerId}`;
    if (!actionGuard.begin(actionKey)) return;
    try {
      await reactivateMut.mutateAsync({ centerId, data: { reason: reactivationReason.trim() } });
      toast.success("Nalog centra je reaktiviran.");
      setReactivationReason("");
      await load();
    } catch (error) {
      toast.error("Nalog nije reaktiviran", { description: error instanceof Error ? error.message : undefined });
      await load();
    } finally {
      actionGuard.end(actionKey);
    }
  };

  const saveDetails = async () => {
    if (!center) return;
    const actionKey = `details:${centerId}`;
    if (!actionGuard.begin(actionKey)) return;

    // Validate overrides
    const parsedOverrides: Record<string, number | null> = {};
    let hasError = false;

    (Object.keys(overrides) as OverrideKey[]).forEach((key) => {
      if (overrides[key].enabled) {
        const rawValue = overrides[key].value.trim();
        const val = Number(rawValue);
        if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(val) || val > overrideLimits[key]) {
          toast.error("Neispravan unos", { description: "Unesite ceo broj u dozvoljenom opsegu ili nulu." });
          hasError = true;
          return;
        }
        parsedOverrides[key] = val;
      } else {
        parsedOverrides[key] = null;
      }
    });

    if (hasError) {
      actionGuard.end(actionKey);
      return;
    }

    // Commission + Reserve check
    const comm = parsedOverrides.commissionPercent !== undefined && parsedOverrides.commissionPercent !== null
      ? parsedOverrides.commissionPercent
      : center.billingSettings.commissionPercent.globalDefault;
    const res = parsedOverrides.reservePercent !== undefined && parsedOverrides.reservePercent !== null
      ? parsedOverrides.reservePercent
      : center.billingSettings.reservePercent.globalDefault;

    if (comm + res > 100) {
      toast.error("Nevažeća pravila", { description: "Zbir provizije i rezerve ne sme preći 100%." });
      actionGuard.end(actionKey);
      return;
    }

    try {
      const payload = {
        pib: pib.trim() || null,
        billingOverrides: parsedOverrides,
      };

      const updated = await api<CenterDetail>(`/api/admin/education/centers/${centerId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      setCenter(updated);
      setPib(updated.pib || "");

      const newOverrides = { ...overrides };
      (Object.keys(updated.billingSettings) as OverrideKey[]).forEach((key) => {
        const setting = updated.billingSettings[key];
        newOverrides[key] = {
          enabled: setting.source === "custom",
          value: setting.source === "custom" ? String(setting.override ?? 0) : String(setting.globalDefault),
        };
      });
      setOverrides(newOverrides);

      toast.success("Podaci centra su sačuvani.");
    } catch (error) {
      toast.error("Promene nisu sačuvane", { description: error instanceof Error ? error.message : undefined });
    } finally {
      actionGuard.end(actionKey);
    }
  };

  const toggleOverride = (key: OverrideKey, enabled: boolean) => {
    setOverrides(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        enabled,
        // Reset to global default visually when disabling
        value: enabled ? prev[key].value : String(center?.billingSettings[key].globalDefault ?? 0)
      }
    }));
  };

  const updateOverrideValue = (key: OverrideKey, value: string) => {
    setOverrides(prev => ({
      ...prev,
      [key]: { ...prev[key], value }
    }));
  };

  const moderateReview = (review: any, status: "published" | "rejected") => {
    if (!actionGuard.begin(`moderate-review:${review.id}`)) return;
    const adminNote = window.prompt("Interna napomena za moderaciju (opciono):");
    if (adminNote === null) return actionGuard.end(`moderate-review:${review.id}`);

    moderateReviewMut.mutate({ reviewId: review.id, data: { status, adminNote: adminNote || null } as any }, {
      onSuccess: () => {
        toast.success(`Recenzija je ${status === 'published' ? 'odobrena' : 'odbijena'}.`);
        queryClient.invalidateQueries({ queryKey: getAdminListEducationCenterReviewsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPublicEducationCenterReviewsQueryKey(centerId) });
      },
      onError: (e: any) => toast.error("Greška pri moderaciji", { description: e.message }),
      onSettled: () => actionGuard.end(`moderate-review:${review.id}`)
    });
  };

  const labels: Record<OverrideKey, { title: string; suffix: string; desc: string }> = {
    commissionPercent: { title: "Provizija", suffix: "%", desc: "Zadržano od svake transakcije." },
    reservePercent: { title: "Rezerva", suffix: "%", desc: "Zadržano do isteka perioda oslobađanja." },
    onlineRefundDays: { title: "Rok za online povraćaj", suffix: " dana", desc: "Period za prigovor na online sadržaj." },
    liveAppealDays: { title: "Rok za žalbu nakon događaja uživo", suffix: " dana", desc: "Period nakon događaja za prigovor." },
    featuredCoursePrice: { title: "Isticanje kursa", suffix: " RSD", desc: "Cena za isticanje edukacije." }
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Button asChild variant="ghost" className="mb-2 -ml-4 text-muted-foreground hover:text-foreground">
              <Link href="/admin/edukacije"><ArrowLeft className="mr-2 h-4 w-4" />Nazad na obračun</Link>
            </Button>
            <h1 className="font-serif text-3xl font-bold text-foreground">
              {loading ? "Učitavanje..." : center?.name}
            </h1>
            <p className="mt-1 text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Edukativni centar {center?.city ? `· ${center.city}` : ""}
            </p>
          </div>

          {center && (
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Badge variant={center.verificationStatus === "verified" ? "default" : center.verificationStatus === "pending" ? "secondary" : "destructive"} className="text-sm px-3 py-1">
                {center.verificationStatus === "verified" ? "Verifikovan" : center.verificationStatus === "pending" ? "Na čekanju" : "Obustavljen"}
              </Badge>
              <Badge variant={center.subscriptionStatus === "active" ? "outline" : "secondary"} className="text-sm px-3 py-1 border-primary/20">
                {center.subscriptionStatus === "active" ? "Aktivan plan" : "Neaktivan"}
              </Badge>
            </div>
          )}
        </div>

        {loading || !center ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-12">

            {/* Left Column: Basic Info & Actions */}
            <div className="md:col-span-4 space-y-6">
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    Osnovni podaci
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <label className="text-sm font-medium text-foreground">PIB (Poreski identifikacioni broj)</label>
                      <EducationFieldHelp id="center-pib-help" label="PIB centra" text="Unesite poreski identifikacioni broj centra koji će biti sačuvan u administrativnoj evidenciji." />
                    </div>
                    <Input
                      aria-describedby="center-pib-help"
                      value={pib}
                      onChange={(e) => setPib(e.target.value)}
                       maxLength={50}
                      placeholder="Nije uneto"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">Postojeći centri mogu ostati bez PIB-a dok ga administrator ne evidentira.</p>
                  </div>

                  {center.verificationNote && (
                    <div className="pt-4 mt-4 border-t border-border">
                      <p className="text-sm font-medium mb-1">Napomena o verifikaciji:</p>
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">{center.verificationNote}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 shadow-sm bg-muted/20">
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BadgeCheck className="h-5 w-5 text-primary" />
                    Status i prisustvo
                  </CardTitle>
                  <CardDescription>
                    Centar mora biti verifikovan da bi njegovi kursevi bili javno vidljivi.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {center.verificationStatus !== "verified" ? (
                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => updateStatus("verified")}
                      disabled={actionGuard.isActive(`status:${center.id}`)}
                    >
                      <BadgeCheck className="mr-2 h-4 w-4" />
                      Verifikuj centar
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant="destructive"
                      onClick={() => updateStatus("suspended")}
                      disabled={actionGuard.isActive(`status:${center.id}`)}
                    >
                      <Ban className="mr-2 h-4 w-4" />
                      Obustavi centar
                    </Button>
                  )}
                </CardContent>
              </Card>

              {currentUser?.role === "SUPER_ADMIN" && center.subscriptionStatus === "suspended" && (
                <Card className="border-destructive/30 shadow-sm">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <RefreshCw className="h-5 w-5 text-primary" />
                      Reaktivacija naloga
                    </CardTitle>
                    <CardDescription>
                      Reaktivacija je dozvoljena tek nakon evidentirane uplate i izbora kurseva kada aktuelni limit to zahteva.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border bg-background p-3 text-sm">
                      {center.reactivation?.state === "payment_required" && "Nije evidentirana uplata za važeći novi period."}
                      {center.reactivation?.state === "selection_required" && `Centar još mora da izabere ${center.reactivation.requiredKeepCount} kurseva koji ostaju aktivni.`}
                      {center.reactivation?.state === "ready" && "Uplata i eventualni izbor kurseva su potvrđeni. Reaktivacija je spremna."}
                    </div>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>Obavezan razlog reaktivacije</span>
                      <Input
                        value={reactivationReason}
                        onChange={(event) => setReactivationReason(event.target.value)}
                        maxLength={1000}
                        placeholder="Npr. uplata proverena i uslovi plana potvrđeni"
                      />
                    </label>
                    <Button
                      className="w-full"
                      onClick={reactivateCenter}
                      disabled={reactivationReason.trim().length < 3 || actionGuard.isActive(`reactivate:${centerId}`) || reactivateMut.isPending}
                    >
                      {(actionGuard.isActive(`reactivate:${centerId}`) || reactivateMut.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Reaktiviraj nalog
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right Column: Billing overrides */}
            <div className="md:col-span-8 space-y-6">
              <Card className="border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />Ugovorena pretplata i ručne uplate</CardTitle>
                  <CardDescription>Ugovor samo definiše obavezu. Pristup se aktivira isključivo evidentiranjem tačnog iznosa uplate.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-sm font-medium">
                      <span className="flex items-center gap-2">Ugovoreni iznos u RSD <EducationFieldHelp id="custom-contract-amount-help" label="Ugovoreni iznos" text="Pun iznos koji centar plaća za ugovoreni period. Mora odgovarati potvrđenoj uplati." /></span>
                      <Input aria-describedby="custom-contract-amount-help" inputMode="numeric" value={customAmount} onChange={(event) => setCustomAmount(event.target.value)} />
                    </label>
                    <label className="space-y-2 text-sm font-medium">
                      <span className="flex items-center gap-2">Ciklus <EducationFieldHelp id="custom-contract-cycle-help" label="Ciklus ugovora" text="Određuje da li je ugovoreni obračun mesečni ili godišnji." /></span>
                      <select aria-describedby="custom-contract-cycle-help" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={customCycle} onChange={(event) => setCustomCycle(event.target.value as "monthly" | "yearly")}>
                        <option value="monthly">Mesečno</option><option value="yearly">Godišnje</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-sm font-medium">
                      <span className="flex items-center gap-2">Ograničenje broja kurseva <EducationFieldHelp id="custom-contract-limit-help" label="Ograničenje kurseva" text="Maksimalan broj edukacija koje centar može da objavi tokom ovog ugovora." /></span>
                      <Input aria-describedby="custom-contract-limit-help" type="number" min="1" value={customLimit} onChange={(event) => setCustomLimit(event.target.value)} />
                    </label>
                    <label className="space-y-2 text-sm font-medium">
                      <span className="flex items-center gap-2">Važi do <EducationFieldHelp id="custom-contract-end-help" label="Datum isteka ugovora" text="Krajnji datum plaćenog ugovornog perioda; mora biti u budućnosti." /></span>
                      <Input aria-describedby="custom-contract-end-help" type="datetime-local" value={customEndsAt} onChange={(event) => setCustomEndsAt(event.target.value)} />
                    </label>
                    <label className="space-y-2 text-sm font-medium">
                      <span className="flex items-center gap-2">Razlog i napomena <EducationFieldHelp id="custom-contract-reason-help" label="Razlog ugovora" text="Unesite osnov za posebne uslove radi finansijskog traga i kasnije kontrole." /></span>
                      <Input aria-describedby="custom-contract-reason-help" value={customReason} onChange={(event) => setCustomReason(event.target.value)} />
                    </label>
                    <div className="flex items-center justify-between sm:col-span-2 pt-2 pb-1">
                      <div className="space-y-0.5">
                        <span className="flex items-center gap-2 font-medium text-sm">Automatsko obnavljanje <EducationFieldHelp id="custom-contract-renew-help" label="Automatsko obnavljanje" text="Da li će se ugovor automatski obnoviti kada istekne period." /></span>
                      </div>
                      <Switch checked={customAutoRenew} onCheckedChange={setCustomAutoRenew} aria-describedby="custom-contract-renew-help" />
                    </div>
                  </div>
                  <Button onClick={configureCustomContract} disabled={actionGuard.isActive(`custom-contract:${centerId}`)}>Sačuvaj ugovorene uslove</Button>
                  {obligations.some((row) => row.status === "pending") ? (
                    <div className="space-y-3 border-t pt-5">
                      {obligations.filter((row) => row.status === "pending").map((row) => (
                        <div key={row.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div><p className="font-medium">Očekivano: {row.expectedAmount.toLocaleString("sr-RS")} RSD</p><p className="text-xs text-muted-foreground">{row.referenceSnapshot} · {row.kind}</p></div>
                          <Button size="sm" onClick={() => openSettlementDialog(row)} disabled={actionGuard.isActive(`settle:${row.id}`)}>Proveri i evidentiraj</Button>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">Nema otvorenih obaveza za ručnu potvrdu.</p>}
                </CardContent>
              </Card>
              <Card className="border-border/60 shadow-sm">
                <CardHeader className="pb-2 border-b border-border/40">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        <Landmark className="h-5 w-5 text-primary" />
                        Finansijska pravila centra
                      </CardTitle>
                      <CardDescription className="mt-1.5">
                        Konfigurišite prilagođena pravila za ovaj centar. Ako su isključena, primenjuju se globalna pravila.
                      </CardDescription>
                    </div>
                    <Button
                      onClick={saveDetails}
                      disabled={actionGuard.isActive(`details:${center.id}`)}
                      className="w-full shrink-0 sm:w-auto"
                    >
                      {actionGuard.isActive(`details:${center.id}`) ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Sačuvaj pravila i podatke
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="p-0">
                  <div className="divide-y divide-border/40">
                    {(Object.keys(overrides) as OverrideKey[]).map((key) => {
                      const label = labels[key];
                      const setting = center.billingSettings[key];
                      const isCustom = overrides[key].enabled;

                      return (
                        <div key={key} className={`p-5 transition-colors ${isCustom ? "bg-primary/5" : ""}`}>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">

                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-foreground">{label.title}</h3>
                                {isCustom ? (
                                  <Badge variant="default" className="bg-primary/20 text-primary hover:bg-primary/30 border-0 h-5 px-1.5 text-[10px] uppercase tracking-wider">Custom</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground border-border h-5 px-1.5 text-[10px] uppercase tracking-wider">Globalno</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">{label.desc}</p>
                            </div>

                            <div className="flex items-center gap-4 shrink-0 bg-background rounded-lg border border-border p-2 shadow-sm">
                              <div className="flex items-center gap-2 min-w-[120px]">
                                 <EducationFieldHelp id={`center-override-toggle-help-${key}`} label={`Prilagođeno pravilo za ${label.title}`} text="Uključite da ovaj centar koristi sopstvenu vrednost umesto trenutno važećeg globalnog pravila." />
                                <Switch
                                  checked={isCustom}
                                  onCheckedChange={(c) => toggleOverride(key, c)}
                                  aria-label={`Prilagođeno pravilo za ${label.title}`}
                                   aria-describedby={`center-override-toggle-help-${key}`}
                                />
                                <span className="text-sm font-medium text-muted-foreground">
                                  {isCustom ? "Zameni" : "Nasledi"}
                                </span>
                              </div>

                              <div className="flex items-center gap-1">
                                 <EducationFieldHelp id={`center-override-value-help-${key}`} label={`Vrednost za ${label.title}`} text={`Unesite prilagođenu celobrojnu vrednost za pravilo „${label.title}”; dozvoljeni opseg je od 0 do ${overrideLimits[key]}.`} />
                                 <div className="w-[100px] relative">
                                   <Input
                                     type="number"
                                     aria-describedby={`center-override-value-help-${key}`}
                                     min="0"
                                     max={overrideLimits[key]}
                                     step="1"
                                     disabled={!isCustom}
                                     value={overrides[key].value}
                                     onChange={(e) => updateOverrideValue(key, e.target.value)}
                                     className={`text-right pr-8 font-mono ${!isCustom ? "opacity-60 bg-muted" : "border-primary/50 focus-visible:ring-primary/30"}`}
                                   />
                                   <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                                     {label.suffix.trim()}
                                   </span>
                                 </div>
                              </div>
                            </div>

                          </div>

                          {/* Hint showing what the global value is if custom is applied */}
                          {isCustom && (
                            <div className="mt-3 text-xs text-primary/70 flex items-center gap-1.5 bg-primary/10 w-fit px-2 py-1 rounded-md">
                              <Settings2 className="w-3.5 h-3.5" />
                              Globalno pravilo je <strong>{setting.globalDefault}{label.suffix}</strong>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Center Reviews Moderation */}
        {center && (
          <div className="mt-8">
            <Card className="border-border/60 shadow-sm">
              <CardHeader className="pb-0 border-b border-border/40">
                <div className="flex flex-col sm:flex-row justify-between sm:items-end pb-4">
                  <div>
                    <CardTitle className="text-xl flex items-center gap-2">Recenzije i ocene</CardTitle>
                    <CardDescription className="mt-1">
                      Pregled i moderacija svih recenzija ovog centra.
                    </CardDescription>
                  </div>
                </div>
                <Tabs value={reviewFilter} onValueChange={(val) => { setReviewFilter(val as any); setReviewPage(1); }} className="w-full">
                  <TabsList className="mb-[-1px] rounded-none border-b border-border bg-transparent p-0 justify-start flex-wrap h-auto">
                    <TabsTrigger value="" className="rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2">Sve</TabsTrigger>
                    <TabsTrigger value="pending" className="rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2">Na čekanju</TabsTrigger>
                    <TabsTrigger value="published" className="rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2">Objavljene</TabsTrigger>
                    <TabsTrigger value="rejected" className="rounded-b-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2">Odbijene</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent className="pt-6">
                {loadingReviews ? (
                  <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary/40" /></div>
                ) : reviewsData?.items && reviewsData.items.length > 0 ? (
                  <div className="space-y-4">
                    {reviewsData.items.map((r: any) => (
                      <div key={r.id} className="p-4 border rounded-xl bg-card">
                        <div className="flex flex-col md:flex-row gap-4 md:items-start md:justify-between">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{r.rating} / 5</span>
                              <Badge variant={r.status === "published" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>{r.status}</Badge>
                            </div>
                            {r.comment && <p className="text-sm mt-2">"{r.comment}"</p>}
                            <p className="text-xs text-muted-foreground mt-2">ID ugovora: {r.enrollmentId} · Kreirano: {new Date(r.createdAt).toLocaleDateString("sr-RS")}</p>
                            {r.adminNote && (
                              <div className="mt-2 p-2 bg-muted rounded-md border border-border/50">
                                <p className="text-xs font-semibold">Interna napomena:</p>
                                <p className="text-xs text-muted-foreground">{r.adminNote}</p>
                                {r.moderatedAt && <p className="text-[10px] text-muted-foreground/70 mt-1">Moderator akcija: {new Date(r.moderatedAt).toLocaleString("sr-RS")}</p>}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2 shrink-0">
                            {r.status === "pending" && (
                              <>
                                <Button size="sm" onClick={() => moderateReview(r, "published")} disabled={actionGuard.isActive(`moderate-review:${r.id}`)}>Odobri</Button>
                                <Button size="sm" variant="destructive" onClick={() => moderateReview(r, "rejected")} disabled={actionGuard.isActive(`moderate-review:${r.id}`)}>Odbij</Button>
                              </>
                            )}
                            {r.status === "published" && (
                              <Button size="sm" variant="outline" onClick={() => moderateReview(r, "rejected")} disabled={actionGuard.isActive(`moderate-review:${r.id}`)}>Povući (Odbij)</Button>
                            )}
                            {r.status === "rejected" && (
                              <Button size="sm" variant="outline" onClick={() => moderateReview(r, "published")} disabled={actionGuard.isActive(`moderate-review:${r.id}`)}>Vrati (Odobri)</Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {Math.ceil(reviewsData.total / reviewsData.pageSize) > 1 && (
                      <div className="flex justify-center gap-2 mt-6">
                        <Button variant="outline" size="sm" onClick={() => setReviewPage(p => Math.max(1, p - 1))} disabled={reviewPage === 1}>Prethodna</Button>
                        <span className="text-sm py-1">Strana {reviewPage} od {Math.ceil(reviewsData.total / reviewsData.pageSize)}</span>
                        <Button variant="outline" size="sm" onClick={() => setReviewPage(p => Math.min(Math.ceil(reviewsData.total / reviewsData.pageSize), p + 1))} disabled={reviewPage === Math.ceil(reviewsData.total / reviewsData.pageSize)}>Sledeća</Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="py-8 text-center text-muted-foreground text-sm">Nema recenzija po izabranom filteru.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
        <Dialog open={Boolean(selectedObligation)} onOpenChange={(open) => { if (!open) closeSettlementDialog(); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Provera primljene uplate</DialogTitle>
              <DialogDescription>
                Uporedite iznos sa bankovnim prometom. Uplata se ne može evidentirati dok se obe vrednosti ne poklope.
              </DialogDescription>
            </DialogHeader>
            {selectedObligation && (
              <div className="space-y-5">
                <div className="rounded-lg border bg-muted/40 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Očekivani iznos</p>
                  <p className="mt-1 text-2xl font-bold">{selectedObligation.expectedAmount.toLocaleString("sr-RS")} RSD</p>
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    {selectedObligation.referenceSnapshot} · {selectedObligation.kind}
                  </p>
                </div>
                <label className="block space-y-2 text-sm font-medium">
                  <span>Stvarno primljeni iznos (RSD)</span>
                  <Input
                    autoFocus
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={receivedAmount}
                    onChange={(event) => setReceivedAmount(event.target.value)}
                    placeholder="Unesite iznos sa izvoda"
                    aria-invalid={receivedAmount.trim() !== "" && (!receivedAmountResult.ok || !amountMatches)}
                    aria-describedby="received-amount-status"
                  />
                </label>
                <div id="received-amount-status" aria-live="polite">
                  {receivedAmount.trim() !== "" && !receivedAmountResult.ok && (
                    <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{receivedAmountResult.message}</span>
                    </div>
                  )}
                  {amountDifference !== null && amountDifference !== 0 && (
                    <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Primljeni iznos je {amountDifference < 0 ? "manji" : "veći"} za {Math.abs(amountDifference).toLocaleString("sr-RS")} RSD.
                        Settlement je blokiran.
                      </span>
                    </div>
                  )}
                  {amountMatches && (
                    <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                      Iznosi se poklapaju.
                    </div>
                  )}
                </div>
                <label className="block space-y-2 text-sm font-medium">
                  <span className="flex items-center gap-2">
                    Obavezan razlog potvrde
                    <EducationFieldHelp id="manual-settlement-reason-help" label="Razlog potvrde uplate" text="Ova napomena ulazi u finansijski audit. Sistem ponovo proverava iznos i zaključava uplatu kako se ne bi evidentirala dvaput." />
                  </span>
                  <Textarea
                    aria-describedby="manual-settlement-reason-help"
                    value={settlementReason}
                    onChange={(event) => setSettlementReason(event.target.value)}
                    maxLength={1000}
                    placeholder="Npr. uplata proverena na bankovnom izvodu"
                    rows={3}
                  />
                  {settlementReason.length > 0 && !settlementReasonValid && (
                    <span className="text-xs text-destructive">Razlog mora imati najmanje 3 znaka.</span>
                  )}
                </label>
              </div>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeSettlementDialog} disabled={settleObligationMut.isPending}>
                Otkaži
              </Button>
              <Button
                type="button"
                onClick={() => void settleObligation()}
                disabled={!selectedObligation || !amountMatches || !settlementReasonValid || settleObligationMut.isPending || actionGuard.isActive(`settle:${selectedObligation?.id ?? ""}`)}
              >
                {settleObligationMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Potvrdi settlement
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
