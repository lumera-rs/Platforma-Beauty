import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, BadgeCheck, Banknote, Building2, Loader2, ShieldAlert, Tag, Check, X, Megaphone, Save } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { parseStrictDecimal, parseStrictInt } from "@/lib/admin-form-utils";
import { trackFeaturedPlacementPaid } from "@/lib/analytics";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";
import { useQueryClient } from "@tanstack/react-query";
import { EducationFieldHelp } from "@/components/education/education-field-help";
import { EducationGraceAudit } from "@/components/admin/education-grace-audit";
import {
  useGetAdminEducationSettings,
  useUpdateAdminEducationSettings,
  useListAdminEducationCenters,
  useUpdateAdminEducationCenter,
  useGetAdminEducationFinance,
  useSettleAdminEducationEnrollment,
  useSettleAdminEducationFeaturedCharge,
  useListEducationDisputes,
  useResolveAdminEducationDispute,
  useListAdminEducationTaxonomyProposals,
  useUpdateAdminEducationTaxonomy,
  useGetPublicEducationTaxonomy,
  getGetPublicEducationTaxonomyQueryKey,
  useReviewAdminEducationTaxonomyProposal,
  useGetAdminEducationPlacementSettings,
  useUpdateAdminEducationPlacementSettings,
  useListAdminFeaturedPlacements,
  useConfirmAdminFeaturedPlacement,
  useAdminListEducationGiftVouchers,
  useAdminSettleEducationGiftVoucher,
  useAdminRefundEducationGiftVoucher,
  useListAdminEducationInstallments,
  useSettleAdminEducationInstallment,
  getListAdminEducationInstallmentsQueryKey,
  getAdminListEducationGiftVouchersQueryKey,
  getListEducationGiftVouchersQueryKey,
  getListEducationPurchasesQueryKey,
  getListPublicEducationCoursesQueryKey,
  getGetPublicEducationCourseQueryKey,
  type AdminEducationGiftVoucher,
  type AdminListEducationGiftVouchersStatus,
  getGetAdminEducationSettingsQueryKey,
  getListAdminEducationCentersQueryKey,
  getGetAdminEducationFinanceQueryKey,
  getListEducationDisputesQueryKey,
  getListAdminEducationTaxonomyProposalsQueryKey,
  getGetAdminEducationPlacementSettingsQueryKey,
  getListAdminFeaturedPlacementsQueryKey,
  createTargetedIdempotencyKeys,
} from "@workspace/api-client-react";

const money = (value: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);
const PLACEMENT_KINDS = ["featured_salon", "featured_center", "special_offer"] as const;
const PLACEMENT_SCOPES = ["home", "category", "subcategory"] as const;
const placementScopes = (kind: typeof PLACEMENT_KINDS[number]) =>
  kind === "featured_salon" ? (["home"] as const) : PLACEMENT_SCOPES;
const VOUCHER_PAGE_SIZE = 20;
const VOUCHER_STATUS_OPTIONS: Array<{ value: AdminListEducationGiftVouchersStatus; label: string }> = [
  { value: "all", label: "Svi statusi" },
  { value: "pending_payment", label: "Čeka uplatu" },
  { value: "active", label: "Aktivan" },
  { value: "redeemed", label: "Iskorišćen" },
  { value: "refunded", label: "Refundiran" },
  { value: "cancelled", label: "Otkazan" },
];
const placementSettingKey = (kind: string, scope: string) => `${kind}:${scope}`;
const voucherDate = (value: Date | string | null) => value ? new Date(value).toLocaleString("sr-RS") : null;

export default function AdminEducationMarketplace() {
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const queryClient = useQueryClient();
  const [voucherStatus, setVoucherStatus] = useState<AdminListEducationGiftVouchersStatus>("all");
  const [installmentStatus, setInstallmentStatus] = useState<"pending" | "settled" | "cancelled" | "all">("all");
  const { data: installmentsPage, isLoading: loadingInstallments } = useListAdminEducationInstallments({ status: installmentStatus === "all" ? undefined : installmentStatus }, { query: { queryKey: getListAdminEducationInstallmentsQueryKey({ status: installmentStatus === "all" ? undefined : installmentStatus }) } });
  const settleInstallmentMut = useSettleAdminEducationInstallment();
  // Settling an installment is a per-row list action -- several distinct
  // installments can each independently be retried, so the key is scoped per
  // installment id rather than to one component-wide slot. A retry of the
  // same installment reuses its key; a confirmed settlement retires that
  // installment's entry so a later (different) installment, or a genuinely
  // repeated attempt on this one, never collides with a stale value.
  const installmentIdempotencyKeys = useRef(createTargetedIdempotencyKeys());
  const [voucherPage, setVoucherPage] = useState(1);
  const [placementPage, setPlacementPage] = useState(1);
  const voucherParams = { status: voucherStatus, page: voucherPage, pageSize: VOUCHER_PAGE_SIZE };

  const { data: settings, isLoading: loadingSettings } = useGetAdminEducationSettings({ query: { queryKey: getGetAdminEducationSettingsQueryKey() } });
  const { data: centers, isLoading: loadingCenters } = useListAdminEducationCenters({ query: { queryKey: getListAdminEducationCentersQueryKey() } });
  const { data: finance, isLoading: loadingFinance } = useGetAdminEducationFinance({ query: { queryKey: getGetAdminEducationFinanceQueryKey() } });
  const { data: disputes, isLoading: loadingDisputes } = useListEducationDisputes({ query: { queryKey: getListEducationDisputesQueryKey() } });
  const { data: taxonomyProposals, isLoading: loadingProposals } = useListAdminEducationTaxonomyProposals({ status: 'pending' }, { query: { queryKey: getListAdminEducationTaxonomyProposalsQueryKey({ status: 'pending' }) } });
  const { data: placementSettings, isLoading: loadingPlacementSettings } = useGetAdminEducationPlacementSettings({ query: { queryKey: getGetAdminEducationPlacementSettingsQueryKey() } });
  const placementParams = { status: "pending_payment" as const, page: placementPage, pageSize: 20 };
  const { data: placementsPage, isLoading: loadingPlacements } = useListAdminFeaturedPlacements(placementParams, { query: { queryKey: getListAdminFeaturedPlacementsQueryKey(placementParams), refetchInterval: 30_000 } });
  const { data: vouchersPage, isLoading: loadingVouchers } = useAdminListEducationGiftVouchers(voucherParams, { query: { queryKey: getAdminListEducationGiftVouchersQueryKey(voucherParams) } });

  const updateSettingsMut = useUpdateAdminEducationSettings();
  const updateCenterMut = useUpdateAdminEducationCenter();
  const settleEnrollmentMut = useSettleAdminEducationEnrollment();
  const settleFeaturedMut = useSettleAdminEducationFeaturedCharge();
  const resolveDisputeMut = useResolveAdminEducationDispute();
  const reviewTaxonomyMut = useReviewAdminEducationTaxonomyProposal();
  const updateTaxonomyMut = useUpdateAdminEducationTaxonomy();
  const { data: taxonomy } = useGetPublicEducationTaxonomy({ query: { queryKey: getGetPublicEducationTaxonomyQueryKey() } });
  const updatePlacementSettingsMut = useUpdateAdminEducationPlacementSettings();
  const settlePlacementMut = useConfirmAdminFeaturedPlacement();
  const settleVoucherMut = useAdminSettleEducationGiftVoucher();
  const refundVoucherMut = useAdminRefundEducationGiftVoucher();

  const [settingsRaw, setSettingsRaw] = useState<any>({ commissionPercent: "0", reservePercent: "0", onlineRefundDays: "0", liveAppealDays: "0", featuredCoursePrice: "0", ipsAccountEnvironment: "production" });
  const [placementSettingsRaw, setPlacementSettingsRaw] = useState<Record<string, { price: string, durationDays: string, slotCount: string }>>({});
  const [pendingBundlePurchases, setPendingBundlePurchases] = useState<any[]>([]);
  const loadPendingBundles = () => void fetch("/api/admin/education/bundle-purchases/pending", { credentials: "include" }).then(r => r.ok ? r.json() : []).then(setPendingBundlePurchases);
  useEffect(() => { loadPendingBundles(); }, []);
  const settleBundlePurchase = async (id: string) => {
    const response = await fetch(`/api/admin/education/bundle-purchases/${id}/settle`, { method: "POST", credentials: "include" });
    if (!response.ok) { const body = await response.json(); toast.error("Greška", { description: body.error }); return; }
    toast.success("Paket i pristup kursevima su aktivirani."); loadPendingBundles();
  };

  const [settleVoucherOpen, setSettleVoucherOpen] = useState(false);
  const [refundVoucherOpen, setRefundVoucherOpen] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<AdminEducationGiftVoucher | null>(null);
  const [voucherRefundNote, setVoucherRefundNote] = useState("");
  const [voucherRefundDisputeId, setVoucherRefundDisputeId] = useState("");

  useEffect(() => {
    if (settings) {
      setSettingsRaw({
        commissionPercent: String(settings.commissionPercent),
        reservePercent: String(settings.reservePercent),
        onlineRefundDays: String(settings.onlineRefundDays),
        liveAppealDays: String(settings.liveAppealDays),
        featuredCoursePrice: String(settings.featuredCoursePrice),
        ipsAccountEnvironment: settings.ipsAccountEnvironment ?? "production",
      });
    }
  }, [settings]);

  useEffect(() => {
    if (placementSettings) {
      const raw: Record<string, { price: string, durationDays: string, slotCount: string }> = {};
      placementSettings.forEach((ps: any) => {
        raw[placementSettingKey(ps.kind, ps.scope)] = { price: String(ps.price), durationDays: String(ps.durationDays), slotCount: String(ps.slotCount ?? 0) };
      });
      setPlacementSettingsRaw(raw);
    }
  }, [placementSettings]);

  const saveSettings = () => {
    if (!settings) return;
    const commParsed = parseStrictDecimal(settingsRaw.commissionPercent, { label: "Provizija", allowNegative: false, allowZero: true, max: 100 });
    if (!commParsed.ok) { toast.error("Greška", { description: commParsed.message }); return; }
    const resParsed = parseStrictDecimal(settingsRaw.reservePercent, { label: "Rezerva", allowNegative: false, allowZero: true, max: 100 });
    if (!resParsed.ok) { toast.error("Greška", { description: resParsed.message }); return; }
    const onlineParsed = parseStrictInt(settingsRaw.onlineRefundDays, { label: "Online povraćaj (dani)", allowNegative: false, allowZero: true });
    if (!onlineParsed.ok) { toast.error("Greška", { description: onlineParsed.message }); return; }
    const liveParsed = parseStrictInt(settingsRaw.liveAppealDays, { label: "Žalba nakon događaja uživo (dani)", allowNegative: false, allowZero: true });
    if (!liveParsed.ok) { toast.error("Greška", { description: liveParsed.message }); return; }
    const featuredParsed = parseStrictInt(settingsRaw.featuredCoursePrice, { label: "Istaknuti kurs (RSD)", allowNegative: false, allowZero: true });
    if (!featuredParsed.ok) { toast.error("Greška", { description: featuredParsed.message }); return; }

    updateSettingsMut.mutate({ data: {
      commissionPercent: commParsed.value,
      reservePercent: resParsed.value,
      onlineRefundDays: onlineParsed.value,
      liveAppealDays: liveParsed.value,
      featuredCoursePrice: featuredParsed.value,
      ipsAccountEnvironment: settingsRaw.ipsAccountEnvironment,
    }}, {
      onSuccess: () => {
        toast.success("Pravila obračuna su sačuvana.");
        queryClient.invalidateQueries({ queryKey: getGetAdminEducationSettingsQueryKey() });
      },
      onError: (e) => toast.error("Promena nije sačuvana", { description: e.message })
    });
  };

  const savePlacementSettings = () => {
    if (!placementSettings) return;
    try {
      const items = PLACEMENT_KINDS.flatMap((kind) => placementScopes(kind).map((scope) => {
        const vals = placementSettingsRaw[placementSettingKey(kind, scope)]
          ?? { price: "0", durationDays: "30", slotCount: "4" };

        const price = parseStrictInt(vals.price, { label: `${kind} ${scope} cena`, allowNegative: false, allowZero: true });
        if (!price.ok) throw new Error(price.message);

        const durationDays = parseStrictInt(vals.durationDays, { label: `${kind} ${scope} dani`, allowNegative: false, allowZero: false });
        if (!durationDays.ok) throw new Error(durationDays.message);

        const slotCount = parseStrictInt(vals.slotCount, { label: `${kind} ${scope} slotovi`, allowNegative: false, allowZero: false });
        if (!slotCount.ok) throw new Error(slotCount.message);

        return {
          kind,
          scope,
          price: price.value,
          durationDays: durationDays.value,
          slotCount: slotCount.value
        };
      }));

      updatePlacementSettingsMut.mutate({ data: items }, {
        onSuccess: () => {
          toast.success("Cene pozicioniranja su sačuvane.");
          queryClient.invalidateQueries({ queryKey: getGetAdminEducationPlacementSettingsQueryKey() });
        },
        onError: (e) => toast.error("Promena nije sačuvana", { description: e.message })
      });
    } catch (e: any) {
      toast.error("Greška", { description: e.message });
    }
  };


  const updatePS = (kind: string, scope: string, field: string, val: string) => {
    const key = placementSettingKey(kind, scope);
    setPlacementSettingsRaw(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] || { price: "0", durationDays: "30", slotCount: "4" }),
        [field]: val
      }
    }));
  };

  const changeCenter = (center: any, verificationStatus: string) => {
    if (!actionGuard.begin(`center:${center.id}`)) return;
    updateCenterMut.mutate({ centerId: center.id, data: { verificationStatus, subscriptionStatus: verificationStatus === "verified" ? "active" : undefined } as any }, {
      onSuccess: () => {
        toast.success("Status centra je ažuriran.");
        queryClient.invalidateQueries({ queryKey: getListAdminEducationCentersQueryKey() });
      },
      onError: (e) => toast.error("Greška", { description: e.message }),
      onSettled: () => actionGuard.end(`center:${center.id}`)
    });
  };

  const settleEnrollment = (enrollment: any) => {
    if (!actionGuard.begin(`settle:${enrollment.id}`)) return;
    if (!window.confirm(`Potvrditi ručnu uplatu za "${enrollment.courseTitle}"?`)) return actionGuard.end(`settle:${enrollment.id}`);
    settleEnrollmentMut.mutate({ enrollmentId: enrollment.id }, {
      onSuccess: () => {
        toast.success("Uplata je potvrđena.");
        queryClient.invalidateQueries({ queryKey: getGetAdminEducationFinanceQueryKey() });
      },
      onError: (e) => toast.error("Greška", { description: e.message }),
      onSettled: () => actionGuard.end(`settle:${enrollment.id}`)
    });
  };

  const payout = async (centerId: string) => {
    if (!actionGuard.begin(`payout:${centerId}`)) return;
    const ref = window.prompt("Referenca isplate (opciono):");
    if (ref === null) return actionGuard.end(`payout:${centerId}`);
    try {
      const response = await fetch(`/api/admin/education/centers/${centerId}/payout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentReference: ref || null }) });
      if (!response.ok) throw new Error("Zahtev nije uspeo.");
      toast.success("Isplata je evidentirana.");
      queryClient.invalidateQueries({ queryKey: getGetAdminEducationFinanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListAdminEducationCentersQueryKey() });
    } catch (e: any) {
      toast.error("Greška", { description: e.message });
    } finally {
      actionGuard.end(`payout:${centerId}`);
    }
  };

  const settleFeatured = (charge: any) => {
    if (!actionGuard.begin(`featured-settle:${charge.id}`)) return;
    const paymentReference = window.prompt(`Referenca uplate (opciono):`);
    if (paymentReference === null) return actionGuard.end(`featured-settle:${charge.id}`);
    settleFeaturedMut.mutate({ chargeId: charge.id, data: { paymentReference: paymentReference.trim() || undefined } }, {
      onSuccess: () => {
        toast.success("Naknada za isticanje je potvrđena.");
        queryClient.invalidateQueries({ queryKey: getGetAdminEducationFinanceQueryKey() });
      },
      onError: (e) => toast.error("Greška", { description: e.message }),
      onSettled: () => actionGuard.end(`featured-settle:${charge.id}`)
    });
  };

  const settlePlacement = (placement: any) => {
    if (placement.status !== "pending_payment") {
      toast.error("Ova pozicija nije na čekanju uplate.");
      return;
    }
    if (!actionGuard.begin(`placement-settle:${placement.paymentReference}`)) return;
    if (!window.confirm(`Potvrditi uplatu za pozicioniranje "${placement.paymentReference}"?`)) return actionGuard.end(`placement-settle:${placement.paymentReference}`);
    settlePlacementMut.mutate({ placementId: placement.id }, {
      onSuccess: (confirmedPlacement) => {
        trackFeaturedPlacementPaid(confirmedPlacement);
        toast.success("Plaćanje pozicije je evidentirano i pozicija je aktivirana.");
        queryClient.invalidateQueries({ queryKey: getListAdminFeaturedPlacementsQueryKey() });
      },
      onError: (e) => toast.error("Greška", { description: e.message }),
      onSettled: () => actionGuard.end(`placement-settle:${placement.paymentReference}`)
    });
  };

  const resolveDispute = (dispute: any, action: "refund" | "release" | "reject") => {
    if (!actionGuard.begin(`dispute:${dispute.id}`)) return;
    const resolutionNote = window.prompt("Unesite obrazloženje odluke:");
    if (!resolutionNote?.trim()) return actionGuard.end(`dispute:${dispute.id}`);
    resolveDisputeMut.mutate({ disputeId: dispute.id, data: { action, resolutionNote } as any }, {
      onSuccess: () => {
        toast.success("Odluka o sporu je evidentirana.");
        queryClient.invalidateQueries({ queryKey: getListEducationDisputesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminEducationFinanceQueryKey() });
      },
      onError: (e) => toast.error("Greška", { description: e.message }),
      onSettled: () => actionGuard.end(`dispute:${dispute.id}`)
    });
  };

  const reviewProposal = (proposal: any, decision: "approved" | "rejected") => {
    const note = window.prompt("Napomena (opciono):");
    if (note === null) return;
    reviewTaxonomyMut.mutate({ proposalId: proposal.id, data: { decision, note: note || null } }, {
      onSuccess: () => {
        toast.success(`Predlog je ${decision === "approved" ? "odobren" : "odbijen"}.`);
        queryClient.invalidateQueries({ queryKey: getListAdminEducationTaxonomyProposalsQueryKey({ status: 'pending' }) });
      },
      onError: (e) => toast.error("Greška", { description: e.message })
    });
  };

  const invalidateVoucherCaches = (voucher: AdminEducationGiftVoucher, availabilityChanged = false) => {
    queryClient.invalidateQueries({ queryKey: getAdminListEducationGiftVouchersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListEducationGiftVouchersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAdminEducationFinanceQueryKey() });
    if (availabilityChanged) {
      queryClient.invalidateQueries({ queryKey: getListEducationPurchasesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListPublicEducationCoursesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPublicEducationCourseQueryKey(voucher.courseId) });
    }
  };

  const settleInstallment = async (installment: any) => {
    if (installment.status !== "pending") return;
    if (!actionGuard.begin(`settle-installment:${installment.id}`)) return;
    if (!window.confirm(`Potvrditi ručnu uplatu za ratu ${installment.paymentReference} (${money(installment.amount)})?\nIPS uplate se knjiže isključivo ručno.`)) return actionGuard.end(`settle-installment:${installment.id}`);
    settleInstallmentMut.mutate({ installmentId: installment.id, headers: { "Idempotency-Key": installmentIdempotencyKeys.current.keyFor(installment.id) } }, {
      onSuccess: () => {
        installmentIdempotencyKeys.current.clear(installment.id);
        toast.success("Rata je evidentirana kao uplaćena.");
        queryClient.invalidateQueries({ queryKey: getListAdminEducationInstallmentsQueryKey({ status: installmentStatus === "all" ? undefined : installmentStatus }) });
        queryClient.invalidateQueries({ queryKey: getGetAdminEducationFinanceQueryKey() });
      },
      onError: (e: any) => {
        if (e.status === 409) toast.error("Ova rata je već plaćena ili otkazana.");
        else toast.error("Greška", { description: e.message });
      },
      onSettled: () => actionGuard.end(`settle-installment:${installment.id}`)
    });
  };

  const openSettleVoucher = (voucher: AdminEducationGiftVoucher) => {
    setSelectedVoucher(voucher);
    setSettleVoucherOpen(true);
  };

  const confirmSettleVoucher = () => {
    if (!selectedVoucher || !actionGuard.begin(`settle-voucher:${selectedVoucher.id}`)) return;
    settleVoucherMut.mutate({ voucherId: selectedVoucher.id }, {
      onSuccess: () => {
        toast.success("Uplata za vaučer je potvrđena.");
        invalidateVoucherCaches(selectedVoucher);
        setSettleVoucherOpen(false);
      },
      onError: (e) => toast.error("Greška", { description: e.message }),
      onSettled: () => actionGuard.end(`settle-voucher:${selectedVoucher.id}`)
    });
  };

  const openRefundVoucher = (voucher: AdminEducationGiftVoucher) => {
    setSelectedVoucher(voucher);
    setVoucherRefundNote("");
    setVoucherRefundDisputeId("");
    setRefundVoucherOpen(true);
  };

  const confirmRefundVoucher = () => {
    if (!selectedVoucher || !actionGuard.begin(`refund-voucher:${selectedVoucher.id}`)) return;
    if (!voucherRefundNote.trim()) {
      toast.error("Unesite razlog za refundaciju.");
      actionGuard.end(`refund-voucher:${selectedVoucher.id}`);
      return;
    }
    refundVoucherMut.mutate({
      voucherId: selectedVoucher.id,
      data: {
        note: voucherRefundNote.trim(),
        disputeId: voucherRefundDisputeId.trim() || undefined
      }
    }, {
      onSuccess: () => {
        toast.success("Vaučer je refundiran.");
        invalidateVoucherCaches(selectedVoucher, selectedVoucher.status === "redeemed");
        setRefundVoucherOpen(false);
      },
      onError: (e) => toast.error("Greška", { description: e.message }),
      onSettled: () => actionGuard.end(`refund-voucher:${selectedVoucher.id}`)
    });
  };

  if (loadingSettings || loadingCenters || loadingFinance || loadingDisputes || loadingProposals || loadingPlacementSettings || loadingPlacements || loadingVouchers || loadingInstallments) {
    return <AdminLayout><div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AdminLayout>;
  }

  return <AdminLayout>
    <div className="space-y-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-primary">LUMERA Edukacije</p>
        <h1 className="mt-1 font-serif text-3xl font-bold">Zaštita kupovina i obračun</h1>
        <p className="mt-2 text-muted-foreground">Upravljanje edukativnim centrima, taksonomijom, isticanjem i finansijama.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Paketi edukacija na čekanju</CardTitle><CardDescription>Potvrda kreira jednu roditeljsku finansijsku evidenciju i tek tada aktivira pristup svim kursevima.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{pendingBundlePurchases.length === 0 ? <p className="text-sm text-muted-foreground">Nema paketa na čekanju.</p> : pendingBundlePurchases.map(purchase => <div key={purchase.id} className="flex flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{money(purchase.amount)} · {purchase.targetType === "salon_employee" ? "zaposleni salona" : "individualni polaznik"}</p><p className="text-xs text-muted-foreground">{purchase.id}</p></div><Button size="sm" onClick={() => settleBundlePurchase(purchase.id)}>Potvrdi uplatu</Button></div>)}</CardContent>
      </Card>

      {/* Finance Summary */}
      {finance && (
        <section className="grid gap-4 md:grid-cols-4">
          {[["Na čekanju", finance.summary.held ?? 0, "amber"], ["Spremno za isplatu", finance.summary.ready ?? 0, "emerald"], ["Zamrznuto", finance.summary.frozen ?? 0, "rose"], ["Isplaćeno", finance.summary.paidOut ?? 0, "slate"]].map(([label, amount]) =>
            <Card key={String(label)}><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-bold">{money(Number(amount))}</p></CardContent></Card>
          )}
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          {/* Taxonomy Proposals */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex gap-2"><Tag className="h-5 w-5 text-primary" />Predlozi novih tipova</CardTitle>
              <CardDescription>Edukativni centri predlažu nove tipove obuka za katalog.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {taxonomyProposals && taxonomyProposals.length > 0 ? taxonomyProposals.map((proposal: any) => (
                <div key={proposal.id} className="rounded-lg border bg-background p-4">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <p className="font-semibold text-foreground">{proposal.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Podkategorija ID: {proposal.subcategoryId}</p>
                      <p className="text-sm text-muted-foreground mt-2">Predložio centar: {proposal.proposedByCenterId}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="default" onClick={() => reviewProposal(proposal, "approved")} disabled={reviewTaxonomyMut.isPending}><Check className="mr-1 h-4 w-4" /> Odobri</Button>
                      <Button size="sm" variant="outline" onClick={() => reviewProposal(proposal, "rejected")} disabled={reviewTaxonomyMut.isPending}><X className="mr-1 h-4 w-4" /> Odbij</Button>
                    </div>
                  </div>
                </div>
              )) : <p className="text-sm text-muted-foreground py-4 text-center">Trenutno nema predloga na čekanju.</p>}
            </CardContent>
          </Card>

          {/* Taxonomy Items */}
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><Tag className="h-5 w-5 text-primary" />Upravljanje taksonomijom</CardTitle></CardHeader>
            <CardContent className="space-y-4 max-h-[400px] overflow-y-auto">
              {taxonomy && taxonomy.map((section: any) => (
                <div key={section.id} className="space-y-2 border-b pb-4 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-lg">{section.name}</span>
                  </div>
                  <div className="pl-4 space-y-2 border-l-2">
                    {section.categories.map((cat: any) => (
                      <div key={cat.id} className="space-y-2">
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span>{cat.name}</span>
                        </div>
                        <div className="pl-4 space-y-1">
                          {cat.subcategories.map((sub: any) => (
                            <div key={sub.id} className="flex items-center justify-between text-xs py-1 hover:bg-muted/50 px-2 rounded">
                              <span className="text-muted-foreground">{sub.name}</span>
                              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => {
                                const newName = window.prompt("Novi naziv (otkaži za prekid):", sub.name);
                                if (!newName) return;
                                updateTaxonomyMut.mutate({ kind: "subcategories", taxonomyId: sub.id, data: { name: newName } }, {
                                  onSuccess: () => {
                                    toast.success("Izmenjeno");
                                    queryClient.invalidateQueries({ queryKey: getGetPublicEducationTaxonomyQueryKey() });
                                  }
                                });
                              }}>Izmeni</Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Pending Enrollments */}
          <Card>
            <CardHeader><CardTitle>Čeka potvrdu uplate (Kursevi)</CardTitle><CardDescription>Kupovine čekaju manuelnu potvrdu.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {(finance as any) && (finance as any).pendingEnrollments.length ? (finance as any).pendingEnrollments.map((enrollment: any) => (
                <div key={enrollment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <div><p className="font-semibold">{enrollment.courseTitle}</p><p className="text-sm text-muted-foreground">{money(enrollment.amount)} · zahtev {new Date(enrollment.createdAt).toLocaleDateString("sr-RS")}</p></div>
                  <Button size="sm" onClick={() => settleEnrollment(enrollment)} disabled={actionGuard.isActive(`settle:${enrollment.id}`)}>Potvrdi uplatu</Button>
                </div>
              )) : <p className="py-4 text-sm text-muted-foreground">Nema zahteva koji čekaju potvrdu.</p>}
            </CardContent>
          </Card>

          {/* Legacy Featured Charges */}
          <Card>
            <CardHeader><CardTitle>Isticanje (Stari sistem)</CardTitle><CardDescription>Potvrda uplate za isticanje kurseva.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {(finance as any) && (finance as any).featuredCharges.filter((c: any) => c.status === "pending").length ? (finance as any).featuredCharges.filter((c: any) => c.status === "pending").map((charge: any) => (
                <div key={charge.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <div><p className="font-semibold">{charge.courseTitle}</p><p className="text-sm text-muted-foreground">{money(charge.amount)} · centar: {charge.centerName}</p></div>
                  <Button size="sm" onClick={() => settleFeatured(charge)} disabled={actionGuard.isActive(`featured-settle:${charge.id}`)}>Potvrdi uplatu</Button>
                </div>
              )) : <p className="py-4 text-sm text-muted-foreground">Nema zahteva koji čekaju potvrdu.</p>}
            </CardContent>
          </Card>

          {/* Sponsored Placements Payments */}
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><Megaphone className="h-5 w-5 text-primary" />Plaćanje pozicija (Novi sistem)</CardTitle><CardDescription>Aktivacija pozicija nakon uplate naknade.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {placementsPage && placementsPage.items.length > 0 ? placementsPage.items.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{p.paymentReference}</p><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></div>
                    <p className="mt-1 text-sm text-muted-foreground">{p.kind} · {p.scope} · {money(p.priceSnapshot)} · {p.durationDaysSnapshot} dana</p>
                  </div>
                  {p.status === "pending_payment" && <Button size="sm" onClick={() => settlePlacement(p)} disabled={actionGuard.isActive(`placement-settle:${p.paymentReference}`)}>Aktiviraj / Potvrdi</Button>}
                </div>
              )) : <p className="py-4 text-sm text-muted-foreground">Nema uplata koje čekaju potvrdu.</p>}
              {placementsPage && placementsPage.total > placementsPage.pageSize ? (
                <div className="flex items-center justify-between border-t pt-3">
                  <Button variant="outline" size="sm" disabled={placementPage === 1} onClick={() => setPlacementPage((page) => page - 1)}>Prethodna</Button>
                  <span className="text-xs text-muted-foreground">Strana {placementPage} · ukupno {placementsPage.total}</span>
                  <Button variant="outline" size="sm" disabled={placementPage * placementsPage.pageSize >= placementsPage.total} onClick={() => setPlacementPage((page) => page + 1)}>Sledeća</Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Installments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex gap-2"><Banknote className="h-5 w-5 text-primary" />Rate i IPS uplate</CardTitle>
              <CardDescription>Upravljanje ratama za kurseve (IPS skeniranje / nalog za uplatu). NAPOMENA: Sve IPS uplate se knjiže isključivo manuelno.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="installment-status">Status rate</Label>
                    <EducationFieldHelp id="installment-status-filter-help" label="Status rate" text="Izaberite status da biste suzili administrativni pregled rata na neplaćene, plaćene, otkazane ili sve rate." />
                  </div>
                  <select
                    id="installment-status"
                    aria-describedby="installment-status-filter-help"
                    value={installmentStatus}
                    onChange={(e: any) => setInstallmentStatus(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-52"
                  >
                    <option value="all">Svi statusi</option>
                    <option value="pending">Na čekanju (Dospeva)</option>
                    <option value="settled">Plaćena</option>
                    <option value="cancelled">Otkazana</option>
                  </select>
                </div>
              </div>
              {installmentsPage && installmentsPage.length > 0 ? installmentsPage.map((ins: any) => (
                <div key={ins.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{ins.courseTitle}</p>
                      <Badge variant={ins.status === "settled" ? "default" : ins.status === "pending" ? "secondary" : "outline"}>{ins.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">Polaznik: {ins.customerName} · Poziv na broj: <span className="font-mono">{ins.paymentReference}</span></p>
                    <p className="text-sm text-muted-foreground">Iznos: {money(ins.amount)} · Dospeće: {ins.dueAt ? new Date(ins.dueAt).toLocaleDateString("sr-RS") : "Nema roka"}</p>
                  </div>
                  {ins.status === "pending" && (
                    <Button onClick={() => settleInstallment(ins)} disabled={actionGuard.isActive(`settle-installment:${ins.id}`)}>
                      Potvrdi uplatu
                    </Button>
                  )}
                </div>
              )) : <p className="py-4 text-sm text-muted-foreground">Nema pronađenih rata za izabrani status.</p>}
            </CardContent>
          </Card>

          {/* Gift Vouchers */}
          <Card>
            <CardHeader><CardTitle className="flex gap-2">Poklon vaučeri</CardTitle><CardDescription>Upravljanje uplatama i refundacijama vaučera.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="voucher-status">Status vaučera</Label>
                    <EducationFieldHelp id="voucher-status-filter-help" label="Status vaučera" text="Izaberite status da biste prikazali samo vaučere u odgovarajućoj fazi plaćanja, korišćenja ili refundacije." />
                  </div>
                  <select
                    id="voucher-status"
                    aria-describedby="voucher-status-filter-help"
                    value={voucherStatus}
                    onChange={(event) => {
                      const nextStatus = VOUCHER_STATUS_OPTIONS.find((option) => option.value === event.target.value)?.value;
                      if (nextStatus) {
                        setVoucherStatus(nextStatus);
                        setVoucherPage(1);
                      }
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-52"
                  >
                    {VOUCHER_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                {vouchersPage && <p className="text-sm text-muted-foreground">Ukupno: {vouchersPage.total}</p>}
              </div>
              {vouchersPage && vouchersPage.items.length > 0 ? vouchersPage.items.map((v) => (
                <div key={v.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{v.courseTitle}</p>
                      <Badge variant={v.status === "active" ? "default" : v.status === "pending_payment" ? "secondary" : v.status === "refunded" ? "destructive" : "outline"}>{v.status}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>Kod: {v.maskedCode} · Ref: {v.paymentReference} · {money(v.amount)}</p>
                      <p>Kreiran: {voucherDate(v.createdAt)}</p>
                    </div>
                    {v.settledAt && <p className="text-xs text-muted-foreground">Uplata potvrđena: {voucherDate(v.settledAt)}</p>}
                    {v.redeemedAt && <p className="text-xs text-muted-foreground">Iskorišćen: {voucherDate(v.redeemedAt)}</p>}
                    {v.refundedAt && <p className="text-xs text-muted-foreground">Refundiran: {voucherDate(v.refundedAt)}{v.refundNote ? ` · ${v.refundNote}` : ""}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {v.status === "pending_payment" && <Button size="sm" onClick={() => openSettleVoucher(v)} disabled={actionGuard.isActive(`settle-voucher:${v.id}`)}>Potvrdi uplatu</Button>}
                    {(v.status === "active" || v.status === "redeemed") && <Button size="sm" variant="destructive" onClick={() => openRefundVoucher(v)} disabled={actionGuard.isActive(`refund-voucher:${v.id}`)}>Refundiraj</Button>}
                  </div>
                </div>
              )) : <p className="py-4 text-sm text-muted-foreground">Nema vaučera.</p>}
              {vouchersPage && vouchersPage.total > VOUCHER_PAGE_SIZE && <div className="flex items-center justify-between pt-1">
                <p className="text-sm text-muted-foreground">Stranica {vouchersPage.page} od {Math.max(1, Math.ceil(vouchersPage.total / vouchersPage.pageSize))}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setVoucherPage((page) => Math.max(1, page - 1))} disabled={vouchersPage.page <= 1}>Prethodna</Button>
                  <Button size="sm" variant="outline" onClick={() => setVoucherPage((page) => page + 1)} disabled={vouchersPage.page >= Math.ceil(vouchersPage.total / vouchersPage.pageSize)}>Sledeća</Button>
                </div>
              </div>}
            </CardContent>
          </Card>

          {/* Escrow */}
          <Card>
            <CardHeader><CardTitle>Escrow i ručne isplate</CardTitle><CardDescription>Net iznos postaje podoban po isteku roka.</CardDescription></CardHeader>
            <CardContent className="space-y-3">{(finance as any) && (finance as any).escrows.map((escrow: any) => <div key={escrow.id} className="flex flex-col gap-3 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between">
              <div><div className="flex gap-2"><p className="font-semibold">{escrow.courseTitle}</p><Badge variant={escrow.status === "frozen" ? "destructive" : "secondary"}>{escrow.status}</Badge>{escrow.disputeOpen && <Badge variant="destructive">spor</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{escrow.centerName} · neto {money(escrow.netAmount)} · rezerva {money(escrow.reserveAmount)} · oslobađanje {new Date(escrow.releaseAt).toLocaleDateString("sr-RS")}</p></div>
              {escrow.status === "ready_for_payout" && !escrow.netPaidAt ? <Button size="sm" onClick={() => payout(escrow.centerId)} disabled={actionGuard.isActive(`payout:${escrow.centerId}`)}>Evidentiraj isplatu</Button> : null}
            </div>)}</CardContent>
          </Card>

          {/* Disputes */}
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><ShieldAlert className="h-5 w-5 text-destructive" />Sporovi</CardTitle></CardHeader>
            <CardContent className="space-y-3">{disputes && disputes.length ? disputes.map((dispute: any) => <div key={dispute.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{dispute.courseTitle}</p><Badge variant="destructive">{dispute.status}</Badge></div><p className="mt-2 text-sm"><b>{dispute.reason}:</b> {dispute.details}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="destructive" onClick={() => resolveDispute(dispute, "refund")} disabled={actionGuard.isActive(`dispute:${dispute.id}`)}>Odobri povraćaj</Button><Button size="sm" onClick={() => resolveDispute(dispute, "release")} disabled={actionGuard.isActive(`dispute:${dispute.id}`)}>Oslobodi isplatu</Button><Button size="sm" variant="outline" onClick={() => resolveDispute(dispute, "reject")} disabled={actionGuard.isActive(`dispute:${dispute.id}`)}>Odbij spor</Button></div></div>) : <p className="py-6 text-center text-sm text-muted-foreground"><AlertTriangle className="mx-auto mb-2 h-5 w-5" />Nema otvorenih sporova.</p>}</CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Settings */}
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><Banknote className="h-5 w-5 text-primary" />Pravila obračuna i cene pozicija</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                {([["Provizija %", "commissionPercent"], ["Rezerva %", "reservePercent"], ["Povraćaj za onlajn kurs (dani)", "onlineRefundDays"], ["Žalba nakon događaja uživo (dani)", "liveAppealDays"], ["Istaknuti kurs (RSD)", "featuredCoursePrice"]] as [string, string][]).map(([label, key]) => (
                  <div key={key as string} className="space-y-2 text-sm font-medium">
                    <div className="flex items-center gap-1">
                      {/* Sibling Label/Input pairs are not associated, which
                          leaves the field with no accessible name: the only
                          thing carrying this label text is the help button's
                          aria-label, so assistive technology announces the
                          number field as unlabelled. Pair htmlFor with id, as
                          the bank-account select below already does. */}
                      <Label htmlFor={`marketplace-setting-${key}`}>{label}</Label>
                      <EducationFieldHelp id={`marketplace-setting-help-${key}`} label={label} text={`Ova vrednost određuje globalno pravilo „${label}” koje se primenjuje kada centar nema posebno podešavanje.`} />
                    </div>
                    <Input id={`marketplace-setting-${key}`} type="number" min="0" value={settingsRaw[key]} onChange={(e) => setSettingsRaw({ ...settingsRaw, [key]: e.target.value })} aria-describedby={`marketplace-setting-help-${key}`} />
                  </div>
                ))}
              </div>
              <div className="space-y-2 text-sm font-medium">
                <div className="flex items-center gap-1">
                  <Label htmlFor="ips-account-environment">Okruženje bankovnog računa</Label>
                  <EducationFieldHelp id="ips-account-environment-help" label="Okruženje bankovnog računa" text="Produkcioni račun radi samo na objavljenoj produkciji. Za razvoj i testiranje izaberite posebno označen test račun." />
                </div>
                <select id="ips-account-environment" value={settingsRaw.ipsAccountEnvironment} onChange={(event) => setSettingsRaw({ ...settingsRaw, ipsAccountEnvironment: event.target.value })} aria-describedby="ips-account-environment-help" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="production">Produkcioni račun</option>
                  <option value="test">Test račun</option>
                </select>
              </div>
              <Button onClick={saveSettings} disabled={updateSettingsMut.isPending} className="w-full">Sačuvaj pravila</Button>

              <Separator />
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider mt-4">Sponzorisane pozicije</h3>

              {PLACEMENT_KINDS.map((kind) => (
                <div key={kind} className="space-y-4">
                  <h4 className="font-medium text-foreground">{kind === "featured_center" ? "Istaknuti centri" : "Specijalne ponude (Kursevi)"}</h4>
                  {placementScopes(kind).map((scope) => {
                    const rowKey = placementSettingKey(kind, scope);
                    const row = placementSettingsRaw[rowKey] || { price: "0", durationDays: "30", slotCount: "4" };
                    const priceId = `ps-price-${rowKey}`;
                    const durationId = `ps-duration-${rowKey}`;
                    const slotsId = `ps-slots-${rowKey}`;
                    return (
                      <div key={scope} className="grid grid-cols-3 gap-2 items-end bg-muted/30 p-2 rounded-md border">
                        <div>
                          <div className="flex items-center gap-1"><Label htmlFor={priceId} className="text-xs text-muted-foreground">{scope} - Cena</Label><EducationFieldHelp id={`ps-price-help-${rowKey}`} label={`Cena pozicije ${scope}`} text="Cena u dinarima koju centar plaća za ovu vrstu i obim sponzorisane pozicije." /></div>
                          <Input id={priceId} data-testid={priceId} size={1} type="number" min="1" value={row.price} onChange={e => updatePS(kind, scope, "price", e.target.value)} aria-describedby={`ps-price-help-${rowKey}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-1"><Label htmlFor={durationId} className="text-xs text-muted-foreground">Dani</Label><EducationFieldHelp id={`ps-duration-help-${rowKey}`} label={`Trajanje pozicije ${scope}`} text="Broj dana tokom kojih kupljena sponzorisana pozicija ostaje aktivna." /></div>
                          <Input id={durationId} data-testid={durationId} size={1} type="number" min="1" value={row.durationDays} onChange={e => updatePS(kind, scope, "durationDays", e.target.value)} aria-describedby={`ps-duration-help-${rowKey}`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-1"><Label htmlFor={slotsId} className="text-xs text-muted-foreground">Slotovi</Label><EducationFieldHelp id={`ps-slots-help-${rowKey}`} label={`Broj slotova ${scope}`} text="Maksimalan broj istovremeno dostupnih sponzorisanih mesta za ovu poziciju." /></div>
                          <Input id={slotsId} data-testid={slotsId} size={1} type="number" min="1" value={row.slotCount} onChange={e => updatePS(kind, scope, "slotCount", e.target.value)} aria-describedby={`ps-slots-help-${rowKey}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <Button data-testid="save-placement-settings" onClick={savePlacementSettings} disabled={updatePlacementSettingsMut.isPending} variant="secondary" className="w-full">Primeni cene pozicioniranja</Button>
            </CardContent>
          </Card>

          {/* Centers */}
          <Card>
            <CardHeader><CardTitle className="flex gap-2"><Building2 className="h-5 w-5 text-primary" />Edukativni centri</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {centers && centers.map((center: any) => (
                <div key={center.id} className="flex flex-col gap-3 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between hover:bg-muted/5 transition-colors">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/edukacije/centri/${center.id}`} className="font-semibold text-primary hover:underline">{center.name}</Link>
                      <Badge variant={center.verificationStatus === "verified" ? "default" : "secondary"}>{center.verificationStatus}</Badge>
                      <Badge variant={center.subscriptionStatus === "active" ? "outline" : "secondary"}>{center.subscriptionStatus ?? "bez pretplate"}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{center.city} · zadržano: {money(center.heldAmount)}</p>
                  </div>
                  <div className="flex gap-2">
                    {center.verificationStatus !== "verified" ?
                      <Button size="sm" onClick={() => changeCenter(center, "verified")} disabled={actionGuard.isActive(`center:${center.id}`)}><BadgeCheck className="mr-2 h-4 w-4" />Aktiviraj</Button>
                      :
                      <Button size="sm" variant="outline" onClick={() => changeCenter(center, "suspended")} disabled={actionGuard.isActive(`center:${center.id}`)}>Obustavi</Button>
                    }
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <EducationGraceAudit />
    </div>

    <Dialog open={settleVoucherOpen} onOpenChange={setSettleVoucherOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Potvrda uplate vaučera</DialogTitle></DialogHeader>
        <div className="py-4">
          <p>Da li ste sigurni da želite da potvrdite uplatu za poklon vaučer?</p>
          {selectedVoucher && <p className="font-semibold mt-2">Referenca: {selectedVoucher.paymentReference}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSettleVoucherOpen(false)}>Otkaži</Button>
          <Button onClick={confirmSettleVoucher} disabled={!selectedVoucher || settleVoucherMut.isPending}>Potvrdi uplatu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={refundVoucherOpen} onOpenChange={setRefundVoucherOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Refundacija vaučera</DialogTitle></DialogHeader>
        <div className="py-4 space-y-4">
          {selectedVoucher && <p className="font-medium text-sm text-muted-foreground mb-4">Referenca: {selectedVoucher.paymentReference}</p>}
          <div className="space-y-2">
            <div className="flex items-center gap-1"><Label>Razlog za refundaciju *</Label><EducationFieldHelp id="voucher-refund-note-help" label="Razlog za refundaciju vaučera" text="Unesite obavezno kratko obrazloženje koje će biti evidentirano uz refundaciju vaučera." /></div>
            <Textarea
              aria-describedby="voucher-refund-note-help"
              value={voucherRefundNote}
              onChange={(e) => setVoucherRefundNote(e.target.value)}
              placeholder="Kratko obrazloženje..."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1"><Label>ID spora (opciono)</Label><EducationFieldHelp id="voucher-refund-dispute-help" label="ID spora za refundaciju" text="Ako je refundacija posledica otvorenog spora, unesite njegov tačan sistemski identifikator radi povezivanja evidencije." /></div>
            <Input
              aria-describedby="voucher-refund-dispute-help"
              value={voucherRefundDisputeId}
              onChange={(e) => setVoucherRefundDisputeId(e.target.value)}
              placeholder="Ako postoji otvoren spor..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRefundVoucherOpen(false)}>Otkaži</Button>
          <Button variant="destructive" onClick={confirmRefundVoucher} disabled={!selectedVoucher || refundVoucherMut.isPending || !voucherRefundNote.trim()}>Refundiraj</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </AdminLayout>;
}
