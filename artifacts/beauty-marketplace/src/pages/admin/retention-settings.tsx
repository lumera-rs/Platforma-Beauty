import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminGetRetentionSettings,
  adminGetRetentionSettings,
  useAdminUpdateRetentionSettings,
  useAdminPreviewRetentionSettings,
  useAdminGetRetentionSettingsHistory,
  getAdminGetRetentionSettingsQueryKey,
  getAdminGetRetentionSettingsHistoryQueryKey,
  getOwnerListRetentionQueryKey,
} from "@workspace/api-client-react";
import type {
  RetentionSettings,
  RetentionThresholds,
  RetentionSettingsHistoryEntry,
  RetentionSettingsPreview,
  RetentionStatusCounts,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Save, History, SlidersHorizontal, Info, RotateCcw, Eye, MoveRight, Store, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { format } from "date-fns";

type FieldKey = keyof RetentionThresholds;

const FIELDS: {
  key: FieldKey;
  label: string;
  hint: string;
  min: number;
  max: number;
}[] = [
  { key: "newCustomerWindowDays", label: "Prozor za nove klijente (dana)", hint: "Jedna završena poseta unutar ovog broja dana i dalje se računa kao „Novi“.", min: 1, max: 365 },
  { key: "defaultIntervalDays", label: "Podrazumevani interval poseta (dana)", hint: "Pretpostavljeni ritam poseta kada klijent ima manje od 2 završene posete.", min: 1, max: 365 },
  { key: "atRiskIntervalPercent", label: "Prag rizika (% intervala)", hint: "„Rizik od odlaska“ kada kašnjenje pređe uobičajeni interval × ovaj procenat (150 = 1,5×).", min: 100, max: 1000 },
  { key: "lostIntervalPercent", label: "Prag gubitka (% intervala)", hint: "„Izgubljen“ kada kašnjenje pređe uobičajeni interval × ovaj procenat (250 = 2,5×). Mora biti veći od praga rizika.", min: 100, max: 2000 },
  { key: "lostMinimumDays", label: "Minimum dana za status „Izgubljen“", hint: "Status „Izgubljen“ se nikad ne dodeljuje pre isteka ovog broja dana od poslednje posete.", min: 1, max: 1095 },
  { key: "vipMinCompletedVisits", label: "VIP: minimum završenih poseta", hint: "Klijent postaje VIP sa ovoliko završenih poseta.", min: 1, max: 100 },
  { key: "vipSpendPercentOfMedian", label: "VIP: potrošnja (% medijane salona)", hint: "Klijent postaje VIP kada ukupna potrošnja pređe medijanu salona × ovaj procenat (200 = 2×).", min: 100, max: 1000 },
];

const FIELD_LABELS = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

type StatusKey = keyof RetentionStatusCounts;

const STATUS_ORDER: StatusKey[] = ["NEW", "ACTIVE", "VIP", "AT_RISK", "LOST"];

const STATUS_LABELS: Record<StatusKey, string> = {
  NEW: "Novi",
  ACTIVE: "Aktivni",
  VIP: "VIP",
  AT_RISK: "U riziku",
  LOST: "Izgubljeni",
};

function formatEstimatedStatusRange(
  estimate: number,
  marginOfError: number,
  totalCustomers: number,
): string {
  const lower = Math.max(0, estimate - marginOfError);
  const upper = Math.min(totalCustomers, estimate + marginOfError);
  const locale = "sr-Latn-RS";
  return `${lower.toLocaleString(locale)}–${upper.toLocaleString(locale)}`;
}

function changedFields(entry: RetentionSettingsHistoryEntry): FieldKey[] {
  return (Object.keys(entry.thresholds) as FieldKey[]).filter(
    (k) => entry.thresholds[k] !== entry.previousThresholds[k],
  );
}

type RestoreTarget =
  | { kind: "history"; entry: RetentionSettingsHistoryEntry }
  | { kind: "defaults"; thresholds: RetentionThresholds };

/** Restore provenance sent alongside an update (audit labels for the history). */
type UpdateOrigin =
  | { changeSource: "manual" }
  | { changeSource: "restore_version"; restoredFromVersion: number }
  | { changeSource: "restore_defaults" };
export default function AdminRetentionSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Poll for a newer active version while the page is open (and re-check on
  // window focus), so an admin learns the page went stale before investing
  // time in edits — the save-time 409 stays the hard guarantee.
  const { data: settings, isLoading } = useAdminGetRetentionSettings({
    query: {
      queryKey: getAdminGetRetentionSettingsQueryKey(),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });
  const { data: history = [], isLoading: isHistoryLoading } = useAdminGetRetentionSettingsHistory();
  const updateMutation = useAdminUpdateRetentionSettings();
  const updateRequestInFlight = useRef(false);
  const [isUpdateSubmitting, setIsUpdateSubmitting] = useState(false);
  const isUpdatePending = isUpdateSubmitting || updateMutation.isPending;
  const previewMutation = useAdminPreviewRetentionSettings();
  const [preview, setPreview] = useState<RetentionSettingsPreview | null>(null);
  // How the "most affected salons" list is ranked: by absolute reclassified
  // count, or by the share of the salon's customers that flips (small salons
  // that feel the change hardest).
  const [salonRanking, setSalonRanking] = useState<"count" | "share">("count");

  const [form, setForm] = useState<Record<FieldKey, string>>({
    newCustomerWindowDays: "",
    defaultIntervalDays: "",
    atRiskIntervalPercent: "",
    lostIntervalPercent: "",
    lostMinimumDays: "",
    vipMinCompletedVisits: "",
    vipSpendPercentOfMedian: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [isDiscardingConflict, setIsDiscardingConflict] = useState(false);
  const conflictDismissalInFlight = useRef(false);
  const conflictRefreshController = useRef<AbortController | null>(null);

  /**
   * Parsed values held while the "these values change nothing" confirmation is
   * open. Unlike restores (which the server rejects as no-ops), a deliberate
   * manual re-confirmation stays allowed — the dialog only prevents accidental
   * audit noise.
   */
  const [identicalSavePending, setIdenticalSavePending] = useState<RetentionThresholds | null>(null);

  /**
   * Version the form values were loaded from. Saves send this as
   * `expectedVersion` — NOT the live `settings.version`, which the staleness
   * poll may silently advance past the values the admin is actually editing.
   */
  const [formBaseVersion, setFormBaseVersion] = useState<number | null>(null);

  /** Reset the form (and its concurrency base) from a settings payload. */
  const loadFormFromSettings = (source: RetentionSettings) => {
    setForm({
      newCustomerWindowDays: String(source.thresholds.newCustomerWindowDays),
      defaultIntervalDays: String(source.thresholds.defaultIntervalDays),
      atRiskIntervalPercent: String(source.thresholds.atRiskIntervalPercent),
      lostIntervalPercent: String(source.thresholds.lostIntervalPercent),
      lostMinimumDays: String(source.thresholds.lostMinimumDays),
      vipMinCompletedVisits: String(source.thresholds.vipMinCompletedVisits),
      vipSpendPercentOfMedian: String(source.thresholds.vipSpendPercentOfMedian),
    });
    setFieldErrors({});
    setPreview(null);
    setFormBaseVersion(source.version);
  };

  useEffect(() => {
    if (!settings) return;
    // Load the form on first fetch, and during a save-time conflict (where
    // the refreshed values must replace the form so the admin can compare).
    // A background poll refetch never resets the form — it only feeds the
    // staleness banner, so in-progress edits are never silently overwritten.
    if (formBaseVersion === null || (conflict !== null && settings.version !== formBaseVersion)) {
      loadFormFromSettings(settings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, conflict, formBaseVersion]);

  // The page is stale when the poll saw a newer active version than the one
  // the form was loaded from (the conflict dialog already covers save time).
  const isStale =
    !!settings &&
    formBaseVersion !== null &&
    settings.version !== formBaseVersion &&
    conflict === null;

  const invalidateAfterSave = () => {
    queryClient.invalidateQueries({ queryKey: getAdminGetRetentionSettingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getAdminGetRetentionSettingsHistoryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getOwnerListRetentionQueryKey() });
  };

  /** Parse + validate the form; returns null (and sets field errors) when invalid. */
  const parseForm = (): RetentionThresholds | null => {
    const errors: Partial<Record<FieldKey, string>> = {};
    const values = {} as RetentionThresholds;
    for (const field of FIELDS) {
      const parsed = parseStrictInt(form[field.key], {
        min: field.min,
        max: field.max,
        label: field.label,
      });
      if (!parsed.ok) {
        errors[field.key] = parsed.message;
      } else {
        values[field.key] = parsed.value;
      }
    }
    if (
      !errors.atRiskIntervalPercent &&
      !errors.lostIntervalPercent &&
      values.lostIntervalPercent <= values.atRiskIntervalPercent
    ) {
      errors.lostIntervalPercent = "Prag gubitka mora biti veći od praga rizika.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length > 0 ? null : values;
  };

  const handlePreview = () => {
    const values = parseForm();
    if (!values) {
      toast.error("Proverite označena polja pre pregleda uticaja.");
      return;
    }
    previewMutation.mutate({ data: values }, {
      onSuccess: (result) => setPreview(result),
      onError: (err) => {
        toast.error(extractApiError(err, "Greška prilikom pregleda uticaja."));
      },
    });
  };

  /**
   * Refresh the active settings after a version conflict without allowing an
   * older query response to refill the cache after a later cancellation read.
   */
  const refreshAfterConflict = async () => {
    conflictRefreshController.current?.abort();
    const controller = new AbortController();
    conflictRefreshController.current = controller;
    await queryClient.cancelQueries({ queryKey: getAdminGetRetentionSettingsQueryKey() });
    try {
      const activeSettings = await adminGetRetentionSettings({ signal: controller.signal });
      if (controller.signal.aborted) return;
      queryClient.setQueryData(getAdminGetRetentionSettingsQueryKey(), activeSettings);
      await queryClient.invalidateQueries({
        queryKey: getAdminGetRetentionSettingsHistoryQueryKey(),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    } finally {
      if (conflictRefreshController.current === controller) {
        conflictRefreshController.current = null;
      }
    }
  };

  /**
   * Single write path for save, restore, and conflict re-confirmation.
   * Sends the version the edit was based on; a 409 means another admin saved
   * a newer version in the meantime — refetch and ask the admin to re-confirm.
   * `origin` labels restores in the audit history.
   */
  const performUpdate = (thresholds: RetentionThresholds, origin: UpdateOrigin) => {
    // React may not have committed the disabled state yet when two click
    // events arrive in the same turn. Keep the write boundary synchronous so
    // an identical-save confirmation can never append two versions.
    if (!settings || formBaseVersion === null || updateRequestInFlight.current) return;
    updateRequestInFlight.current = true;
    setIsUpdateSubmitting(true);
    const body = {
      ...thresholds,
      expectedVersion: formBaseVersion,
      ...(origin.changeSource === "restore_version"
        ? { changeSource: origin.changeSource, restoredFromVersion: origin.restoredFromVersion }
        : origin.changeSource === "restore_defaults"
          ? { changeSource: origin.changeSource }
          : {}),
    };
    updateMutation.mutate({ data: body }, {
      onSuccess: (updated) => {
        toast.success(
          origin.changeSource === "restore_version"
            ? `Vrednosti verzije ${origin.restoredFromVersion} su vraćene kao nova verzija ${updated.version}.`
            : origin.changeSource === "restore_defaults"
              ? `Podrazumevane vrednosti platforme su vraćene kao nova verzija ${updated.version}.`
              : `Pragovi retencije sačuvani (verzija ${updated.version}).`,
        );
        setRestoreTarget(null);
        setConflict(null);
        setIdenticalSavePending(null);
        // Rebase the form on the version we just created, so the refetch
        // below neither re-triggers the staleness banner nor loses the state.
        loadFormFromSettings(updated);
        invalidateAfterSave();
      },
      onError: (err) => {
        setRestoreTarget(null);
        setIdenticalSavePending(null);
        if (isVersionConflict(err)) {
          setPreview(null);
          const conflictDetails = getVersionConflictDetails(err);
          setConflict({
            pending: thresholds,
            origin,
            changedByName: conflictDetails.changedByName,
            changedAt: conflictDetails.changedAt,
          });
          void refreshAfterConflict().catch((refreshError) => {
            toast.error(extractApiError(refreshError, "Nove vrednosti nisu mogle da se učitaju."));
          });
          toast.error("Drugi administrator je u međuvremenu sačuvao izmene. Proverite nove vrednosti i potvrdite ponovo.");
          return;
        }
        // The server blocks restores whose values equal the active thresholds
        // (e.g. another admin already made them active while the dialog was
        // open). Explain why nothing was recorded and refresh the stale view.
        const code =
          (err as { response?: { data?: { code?: string } }; data?: { code?: string } })
            ?.response?.data?.code ??
          (err as { data?: { code?: string } })?.data?.code;
        if (code === "NO_OP_RESTORE") {
          toast.info(
            "Vrednosti su identične trenutno aktivnim pragovima — nova verzija nije zabeležena.",
          );
          setConflict(null);
          invalidateAfterSave();
          return;
        }
        toast.error(extractApiError(
          err,
          origin.changeSource === "manual"
            ? "Greška prilikom čuvanja pragova."
            : "Greška prilikom vraćanja verzije.",
        ));
      },
      onSettled: () => {
        updateRequestInFlight.current = false;
        setIsUpdateSubmitting(false);
      },
    });
  };

  const handleSave = () => {
    const values = parseForm();
    if (!values) {
      toast.error("Proverite označena polja pre čuvanja.");
      return;
    }
    // A manual save identical to the active thresholds would record a version
    // showing "Bez promene vrednosti" in the history. That stays allowed
    // (deliberate re-confirmation), but ask first so it never happens by
    // accident — same comparison the restore dialog uses for isNoOpRestore.
    if (
      settings &&
      FIELDS.every((f) => values[f.key] === settings.thresholds[f.key])
    ) {
      setIdenticalSavePending(values);
      return;
    }
    performUpdate(values, { changeSource: "manual" });
  };

  const handleRestore = (target: RestoreTarget) => {
    // Label the new version as a restore so the audit history can tell
    // deliberate rollbacks apart from hand-tuned edits.
    if (target.kind === "history") {
      performUpdate(target.entry.thresholds, {
        changeSource: "restore_version",
        restoredFromVersion: target.entry.version,
      });
    } else {
      performUpdate(target.thresholds, { changeSource: "restore_defaults" });
    }
  };

  const handleConfirmConflict = () => {
    if (!conflict) return;
    // Re-confirm against the refreshed version. A restore label is only kept
    // when it is still truthful (restoring version N is unaffected by the
    // concurrent change; restoring defaults still matches the defaults).
    performUpdate(conflict.pending, conflict.origin);
  };

  /**
   * Discard pending values only after loading the latest active version.
   * The 409 refresh starts in the background, so a dialog may be dismissed
   * before it reaches the cache; fetching directly here keeps stale form
   * values from surviving that timing window.
   */
  const handleCancelConflict = async () => {
    if (conflictDismissalInFlight.current) return;
    conflictDismissalInFlight.current = true;
    setIsDiscardingConflict(true);
    try {
      conflictRefreshController.current?.abort();
      await queryClient.cancelQueries({ queryKey: getAdminGetRetentionSettingsQueryKey() });
      const activeSettings = await adminGetRetentionSettings();
      queryClient.setQueryData(getAdminGetRetentionSettingsQueryKey(), activeSettings);
      loadFormFromSettings(activeSettings);
      setConflict(null);
      await queryClient.invalidateQueries({
        queryKey: getAdminGetRetentionSettingsHistoryQueryKey(),
      });
    } catch (err) {
      toast.error(extractApiError(err, "Nove vrednosti nisu mogle da se učitaju. Pokušajte ponovo."));
    } finally {
      conflictDismissalInFlight.current = false;
      setIsDiscardingConflict(false);
    }
  };

  // A restore whose values equal the active thresholds would only clutter the
  // history ("no values changed"), so the confirm button is disabled and the
  // dialog explains why — the server rejects such restores as a backstop.
  const restoreTargetThresholds = restoreTarget
    ? restoreTarget.kind === "history"
      ? restoreTarget.entry.thresholds
      : restoreTarget.thresholds
    : null;
  const restoreDiffKeys: FieldKey[] =
    restoreTargetThresholds && settings
      ? (Object.keys(restoreTargetThresholds) as FieldKey[]).filter(
          (k) => restoreTargetThresholds[k] !== settings.thresholds[k],
        )
      : [];
  const isNoOpRestore = !!restoreTargetThresholds && !!settings && restoreDiffKeys.length === 0;

  const isAtDefaults =
    !!settings &&
    FIELDS.every((f) => settings.thresholds[f.key] === settings.defaults[f.key]);

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold mb-2 text-foreground">Pragovi Retencije</h1>
          <p className="text-muted-foreground">
            Podesite šta se na nivou platforme računa kao VIP klijent, klijent u riziku ili izgubljen klijent.
            Svaka izmena se beleži sa autorom, vremenom i prethodnim vrednostima.
          </p>
        </div>

        {isStale && settings && (
          <Alert
            className="border-amber-500/50 bg-amber-500/10 [&>svg]:text-amber-600"
            data-testid="retention-stale-banner"
          >
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>
              {settings.isDefault
                ? "Podrazumevane vrednosti su u međuvremenu vraćene — osvežite vrednosti"
                : `Verzija ${settings.version} je u međuvremenu aktivirana — osvežite vrednosti`}
            </AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Drugi administrator je sačuvao novije pragove dok je ova stranica bila otvorena.
                Učitajte nove vrednosti pre daljih izmena — učitavanje zamenjuje vrednosti u poljima.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  loadFormFromSettings(settings);
                  // The history list is missing the newer entries too.
                  queryClient.invalidateQueries({ queryKey: getAdminGetRetentionSettingsHistoryQueryKey() });
                }}
                disabled={isUpdatePending}
                data-testid="load-stale-retention-settings"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Učitaj nove vrednosti
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="pb-4 border-b border-border/50 bg-muted/30">
            <CardTitle className="text-lg flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-muted-foreground" />
              Aktivna podešavanja
              <Badge variant="secondary" data-testid="retention-settings-version">
                {settings?.isDefault ? "Podrazumevano (v0)" : `Verzija ${settings?.version}`}
              </Badge>
              {settings?.changeSource === "restore_version" && (
                <Badge variant="outline" className="gap-1" data-testid="retention-settings-source">
                  <RotateCcw className="w-3 h-3" />
                  Vraćeno iz verzije {settings.restoredFromVersion}
                </Badge>
              )}
              {settings?.changeSource === "restore_defaults" && (
                <Badge variant="outline" className="gap-1" data-testid="retention-settings-source">
                  <RotateCcw className="w-3 h-3" />
                  Vraćene podrazumevane vrednosti
                </Badge>
              )}
            </CardTitle>
            {settings && !settings.isDefault && settings.changedAt && (
              <CardDescription data-testid="retention-settings-last-change">
                Poslednja izmena: {format(new Date(settings.changedAt), "dd.MM.yyyy. HH:mm")}
                {" — "}
                {settings.changedByName ?? "Nepoznat administrator"}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="pt-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`retention-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`retention-${field.key}`}
                    data-testid={`input-${field.key}`}
                    inputMode="numeric"
                    value={form[field.key]}
                    onChange={(e) => {
                      setForm((prev) => ({ ...prev, [field.key]: e.target.value }));
                      // Any edit invalidates a previously computed preview.
                      setPreview(null);
                    }}
                  />
                  {fieldErrors[field.key] ? (
                    <p className="text-xs text-destructive" data-testid={`error-${field.key}`}>{fieldErrors[field.key]}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{field.hint} (od {field.min} do {field.max})</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0" />
                Nova podešavanja odmah važe za sve salone — CRM objašnjenja vlasnika koriste aktivnu verziju pragova.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {settings && !isAtDefaults && (
                  <Button
                    variant="outline"
                    onClick={() => setRestoreTarget({ kind: "defaults", thresholds: settings.defaults })}
                    disabled={isUpdatePending}
                    data-testid="restore-retention-defaults"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Vrati podrazumevane vrednosti
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handlePreview}
                  disabled={previewMutation.isPending || isUpdatePending}
                  data-testid="preview-retention-settings"
                >
                  {previewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                  Proveri uticaj
                </Button>
                <Button onClick={handleSave} disabled={isUpdatePending} data-testid="save-retention-settings">
                  {isUpdatePending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Sačuvaj izmene
                </Button>
              </div>
            </div>

            {preview && (
              <div
                className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4"
                data-testid="retention-preview-panel"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Eye className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">Pregled uticaja</span>
                  {preview.isEstimate && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/60 text-amber-600 dark:text-amber-500"
                      data-testid="retention-preview-estimate"
                    >
                      ~ Procena
                    </Badge>
                  )}
                  <Badge
                    variant={preview.reclassifiedCount > 0 ? "default" : "secondary"}
                    data-testid="retention-preview-reclassified"
                  >
                    {preview.reclassifiedCount === 0
                      ? preview.isEstimate
                        ? `~0${preview.reclassifiedCountMarginOfError !== null ? ` ±${preview.reclassifiedCountMarginOfError}` : ""} klijenata menja status (procena)`
                        : "Bez promena statusa"
                      : `${preview.isEstimate ? "~" : ""}${preview.reclassifiedCount}${preview.isEstimate && preview.reclassifiedCountMarginOfError !== null ? ` ±${preview.reclassifiedCountMarginOfError}` : ""} od ${preview.totalCustomers} klijenata menja status`}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Poređenje sa trenutno aktivnim pragovima{" "}
                  ({preview.currentVersion === 0 ? "podrazumevana podešavanja" : `verzija ${preview.currentVersion}`}),
                  ukupno {preview.totalCustomers} klijenata na platformi. Pregled ništa ne čuva — pragovi ostaju
                  nepromenjeni dok ne kliknete „Sačuvaj izmene“.
                </p>
                {preview.isEstimate && (
                  <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="retention-preview-estimate-note">
                    Platforma je prevelika za tačan pregled, pa su brojevi procena na osnovu nasumičnog
                    uzorka od {preview.sampleSize?.toLocaleString("sr-Latn-RS")} klijenata — vrednosti
                    označene znakom „~“ su približne, ne tačne. Margina greške je približno ±
                    {preview.reclassifiedCountMarginOfError?.toLocaleString("sr-Latn-RS")} klijenata
                    (95% pouzdanost), pa stvarni broj može biti niži ili viši.
                  </p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                        <th className="py-1.5 pr-4 font-medium">Status</th>
                        <th className="py-1.5 pr-4 font-medium">Trenutno</th>
                        <th className="py-1.5 pr-4 font-medium">Sa novim pragovima</th>
                        <th className="py-1.5 font-medium">Razlika</th>
                      </tr>
                    </thead>
                    <tbody>
                      {STATUS_ORDER.map((status) => {
                        const current = preview.currentCounts[status];
                        const candidate = preview.candidateCounts[status];
                        const delta = candidate - current;
                        const currentMargin = preview.isEstimate
                          ? preview.currentCountMarginsOfError?.[status]
                          : undefined;
                        const candidateMargin = preview.isEstimate
                          ? preview.candidateCountMarginsOfError?.[status]
                          : undefined;
                        // Estimates are never rendered as exact numbers.
                        const approx = preview.isEstimate ? "~" : "";
                        return (
                          <tr key={status} className="border-b border-border/30 last:border-0" data-testid={`retention-preview-row-${status}`}>
                            <td className="py-1.5 pr-4 text-foreground">{STATUS_LABELS[status]}</td>
                            <td className="py-1.5 pr-4 align-top">
                              <span>{approx}{current}</span>
                              {currentMargin !== undefined && (
                                <span
                                  className="block text-xs text-amber-600 dark:text-amber-500"
                                  data-testid={`retention-preview-range-current-${status}`}
                                >
                                  Raspon: {formatEstimatedStatusRange(current, currentMargin, preview.totalCustomers)}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 pr-4 align-top font-medium text-foreground">
                              <span>{approx}{candidate}</span>
                              {candidateMargin !== undefined && (
                                <span
                                  className="block text-xs font-normal text-amber-600 dark:text-amber-500"
                                  data-testid={`retention-preview-range-candidate-${status}`}
                                >
                                  Raspon: {formatEstimatedStatusRange(candidate, candidateMargin, preview.totalCustomers)}
                                </span>
                              )}
                            </td>
                            <td className={`py-1.5 font-medium ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {approx}{delta > 0 ? `+${delta}` : delta}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {preview.shifts.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Najveća pomeranja:</p>
                    <ul className="space-y-1">
                      {preview.shifts.map((shift) => (
                        <li
                          key={`${shift.fromStatus}-${shift.toStatus}`}
                          className="text-sm text-muted-foreground flex items-center gap-1.5"
                          data-testid={`retention-preview-shift-${shift.fromStatus}-${shift.toStatus}`}
                        >
                          <span className="text-foreground">{STATUS_LABELS[shift.fromStatus]}</span>
                          <MoveRight className="w-3.5 h-3.5 shrink-0" />
                          <span className="text-foreground">{STATUS_LABELS[shift.toStatus]}</span>
                          <span className="font-semibold text-foreground">
                            {preview.isEstimate ? "~" : ""}{shift.count}
                          </span>
                          {shift.count === 1 && !preview.isEstimate ? "klijent" : "klijenata"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.isEstimate && (
                  <p className="text-xs text-muted-foreground italic" data-testid="retention-preview-no-salons-note">
                    {preview.shareRankingMinCustomers !== undefined && preview.shareRankingMinCustomers !== null
                      ? `Podešeni prag od najmanje ${preview.shareRankingMinCustomers.toLocaleString("sr-Latn-RS")} klijenata i dalje važi za tačna rangiranja po salonu, ali uzorkovani pregled ne prikazuje rangiranja po salonima — uzorak je premali za pouzdane brojeve po pojedinačnom salonu.`
                      : "Rangiranja po salonima nisu dostupna u uzorkovanoj proceni — uzorak je premali za pouzdane brojeve po pojedinačnom salonu."}
                  </p>
                )}
                {preview.topAffectedSalons.length > 0 && (
                  <div className="space-y-1.5" data-testid="retention-preview-affected-salons">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                        <Store className="w-3.5 h-3.5 shrink-0" />
                        Najviše pogođeni saloni:
                      </p>
                      <div className="flex items-center gap-1" role="group" aria-label="Rangiranje pogođenih salona">
                        <Button
                          type="button"
                          size="sm"
                          variant={salonRanking === "count" ? "secondary" : "ghost"}
                          className="h-7 px-2 text-xs"
                          aria-pressed={salonRanking === "count"}
                          onClick={() => setSalonRanking("count")}
                          data-testid="retention-preview-ranking-count"
                        >
                          Po broju
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={salonRanking === "share" ? "secondary" : "ghost"}
                          className="h-7 px-2 text-xs"
                          aria-pressed={salonRanking === "share"}
                          onClick={() => setSalonRanking("share")}
                          data-testid="retention-preview-ranking-share"
                        >
                          Po udelu (%)
                        </Button>
                      </div>
                    </div>
                    {salonRanking === "share" && (
                      <p className="text-xs text-muted-foreground" data-testid="retention-preview-share-floor-note">
                        Saloni sa najvećim procentom pogođenih klijenata — mali saloni koji promenu
                        osećaju najjače. Računaju se samo saloni sa najmanje {preview.shareRankingMinCustomers}{" "}
                        klijenata.
                      </p>
                    )}
                    {(salonRanking === "share" ? preview.topShareAffectedSalons : preview.topAffectedSalons).length === 0 ? (
                      <p className="text-sm text-muted-foreground" data-testid="retention-preview-share-empty">
                        Nijedan pogođeni salon nema najmanje {preview.shareRankingMinCustomers} klijenata.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {(salonRanking === "share" ? preview.topShareAffectedSalons : preview.topAffectedSalons).map((salon) => (
                          <li
                            key={salon.salonId}
                            className="text-sm text-muted-foreground flex items-center gap-1.5"
                            data-testid={`retention-preview-salon-${salon.salonId}`}
                          >
                            <a
                              href={`${import.meta.env.BASE_URL}admin/saloni/${salon.salonId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-foreground hover:text-primary hover:underline inline-flex items-center gap-1"
                              data-testid={`retention-preview-salon-link-${salon.salonId}`}
                            >
                              {salon.salonName}
                              <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                            </a>
                            <span className="font-semibold text-foreground">{salon.reclassifiedCount}</span>
                            {`od ${salon.totalCustomers} ${salon.totalCustomers === 1 ? "klijenta" : "klijenata"}`}
                            {salon.totalCustomers > 0 && (
                              <span className="text-foreground">
                                ({Math.round((salon.reclassifiedCount / salon.totalCustomers) * 100)}%)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4 border-b border-border/50 bg-muted/30">
            <CardTitle className="text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-muted-foreground" />
              Istorija izmena
            </CardTitle>
            <CardDescription>Ko je, kada i kako menjao pragove — sa prethodnim vrednostima.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isHistoryLoading ? (
              <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : history.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground" data-testid="retention-history-empty">
                Još nema izmena — važe podrazumevana podešavanja platforme.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {history.map((entry) => {
                  const diffs = changedFields(entry);
                  const isActiveVersion = entry.version === settings?.version;
                  return (
                    <div key={entry.version} className="p-4" data-testid={`retention-history-v${entry.version}`}>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant="secondary">Verzija {entry.version}</Badge>
                        {entry.changeSource === "restore_version" && (
                          <Badge variant="outline" className="gap-1" data-testid={`retention-source-v${entry.version}`}>
                            <RotateCcw className="w-3 h-3" />
                            Vraćeno iz verzije {entry.restoredFromVersion}
                          </Badge>
                        )}
                        {entry.changeSource === "restore_defaults" && (
                          <Badge variant="outline" className="gap-1" data-testid={`retention-source-v${entry.version}`}>
                            <RotateCcw className="w-3 h-3" />
                            Vraćene podrazumevane vrednosti
                          </Badge>
                        )}
                        <span className="text-sm font-medium text-foreground">{entry.changedByName ?? "Nepoznat administrator"}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(entry.changedAt), "dd.MM.yyyy. HH:mm")}</span>
                        {isActiveVersion ? (
                          <Badge variant="outline" className="ml-auto" data-testid={`retention-active-v${entry.version}`}>
                            Aktivna verzija
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-auto"
                            onClick={() => setRestoreTarget({ kind: "history", entry })}
                            disabled={isUpdatePending}
                            data-testid={`restore-retention-v${entry.version}`}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                            Vrati ovu verziju
                          </Button>
                        )}
                      </div>
                      {diffs.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">Bez promene vrednosti.</p>
                      ) : (
                        <ul className="space-y-1">
                          {diffs.map((key) => (
                            <li key={key} className="text-sm text-muted-foreground">
                              <span className="text-foreground">{FIELD_LABELS[key]}:</span>{" "}
                              <span className="line-through">{entry.previousThresholds[key]}</span>
                              {" → "}
                              <span className="font-semibold text-foreground">{entry.thresholds[key]}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={restoreTarget !== null} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
          <AlertDialogContent data-testid="restore-retention-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>
                {restoreTarget?.kind === "defaults"
                  ? "Vrati podrazumevane vrednosti platforme?"
                  : `Vrati vrednosti verzije ${restoreTarget?.kind === "history" ? restoreTarget.entry.version : ""}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {restoreTarget?.kind === "defaults"
                  ? "Biće kreirana nova verzija sa podrazumevanim vrednostima platforme — istorija izmena ostaje netaknuta, a promena se beleži sa vašim imenom."
                  : "Biće kreirana nova verzija sa vrednostima izabrane verzije — istorija izmena ostaje netaknuta, a promena se beleži sa vašim imenom."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {restoreTargetThresholds && settings && (
              <div className="text-sm">
                {isNoOpRestore ? (
                  <p className="text-muted-foreground italic" data-testid="restore-retention-noop-notice">
                    Vrednosti su identične trenutno aktivnim — nova verzija ne bi ništa promenila,
                    pa se vraćanje ne beleži u istoriju.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {restoreDiffKeys.map((key) => (
                      <li key={key} className="text-muted-foreground">
                        <span className="text-foreground">{FIELD_LABELS[key]}:</span>{" "}
                        <span className="line-through">{settings.thresholds[key]}</span>
                        {" → "}
                        <span className="font-semibold text-foreground">{restoreTargetThresholds[key]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isUpdatePending} data-testid="cancel-restore-retention">
                Otkaži
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  if (restoreTarget) handleRestore(restoreTarget);
                }}
                disabled={isUpdatePending || isNoOpRestore}
                data-testid="confirm-restore-retention"
              >
                {isUpdatePending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                {restoreTarget?.kind === "defaults" ? "Vrati podrazumevane vrednosti" : "Vrati ovu verziju"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={identicalSavePending !== null}
          onOpenChange={(open) => { if (!open) setIdenticalSavePending(null); }}
        >
          <AlertDialogContent data-testid="identical-retention-save-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Vrednosti su identične aktivnoj verziji</AlertDialogTitle>
              <AlertDialogDescription>
                Ništa se ne bi promenilo u ponašanju platforme — u istoriji bi bila zabeležena
                nova verzija sa napomenom „Bez promene vrednosti“. Sačuvajte samo ako želite
                namernu ponovnu potvrdu važećih pragova sa vašim imenom i vremenom.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isUpdatePending} data-testid="cancel-identical-retention-save">
                Otkaži
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  if (identicalSavePending) performUpdate(identicalSavePending, { changeSource: "manual" });
                }}
                disabled={isUpdatePending}
                data-testid="confirm-identical-retention-save"
              >
                {isUpdatePending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Ipak sačuvaj
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={conflict !== null}
          onOpenChange={(open) => {
            if (!open && conflict) void handleCancelConflict();
          }}
        >
          <AlertDialogContent data-testid="retention-conflict-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Drugi administrator je sačuvao novije izmene</AlertDialogTitle>
              <AlertDialogDescription>
                Dok ste uređivali pragove, sačuvana je novija verzija
                {settings && !settings.isDefault ? ` (verzija ${settings.version})` : ""}.
                Ispod je poređenje trenutno aktivnih vrednosti i vrednosti koje ste pokušali da sačuvate —
                potvrdite ponovo ako i dalje želite svoje vrednosti.
              </AlertDialogDescription>
            {conflict && (conflict.changedByName || conflict.changedAt) && (
              <p className="text-sm text-muted-foreground" data-testid="retention-conflict-changed-by">
                Izmenio: {conflict.changedByName ?? "Nepoznat administrator"}
                {conflict.changedAt ? `, ${format(new Date(conflict.changedAt), "dd.MM.yyyy. HH:mm")}` : ""}
              </p>
            )}
            </AlertDialogHeader>
            {conflict && settings && (() => {
              const diffKeys = (Object.keys(conflict.pending) as FieldKey[]).filter(
                (k) => conflict.pending[k] !== settings.thresholds[k],
              );
              return (
                <div className="text-sm" data-testid="retention-conflict-diff">
                  {diffKeys.length === 0 ? (
                    <p className="text-muted-foreground italic">
                      Vaše vrednosti su identične novoj aktivnoj verziji — ponovno čuvanje neće promeniti ponašanje.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {diffKeys.map((key) => (
                        <li key={key} className="text-muted-foreground">
                          <span className="text-foreground">{FIELD_LABELS[key]}:</span>{" "}
                          <span className="line-through">{settings.thresholds[key]}</span>
                          {" → "}
                          <span className="font-semibold text-foreground">{conflict.pending[key]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
            <AlertDialogFooter>
              <AlertDialogCancel
                disabled={isUpdatePending || isDiscardingConflict}
                data-testid="cancel-retention-conflict"
              >
                {isDiscardingConflict && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Zadrži novije vrednosti
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleConfirmConflict();
                }}
                disabled={isUpdatePending || isDiscardingConflict}
                data-testid="confirm-retention-conflict"
              >
                {isUpdatePending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Sačuvaj moje vrednosti
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}

/** True when the server rejected the update because a newer version exists (409). */
function isVersionConflict(err: unknown): boolean {
  const e = err as { status?: number; data?: { code?: string } } | null;
  return e?.status === 409 || e?.data?.code === "VERSION_CONFLICT";
}

/** Values the admin tried to save when another admin's newer version was found. */
interface VersionConflict {
  pending: RetentionThresholds;
  origin: UpdateOrigin;
  changedByName: string | null;
  changedAt: string | null;
}

function getVersionConflictDetails(err: unknown): Pick<VersionConflict, "changedByName" | "changedAt"> {
  const e = err as {
    response?: { data?: { changedByName?: unknown; changedAt?: unknown } };
    data?: { changedByName?: unknown; changedAt?: unknown };
  } | null;
  const data = e?.response?.data ?? e?.data;
  return {
    changedByName: typeof data?.changedByName === "string" ? data.changedByName : null,
    changedAt: typeof data?.changedAt === "string" ? data.changedAt : null,
  };
}
