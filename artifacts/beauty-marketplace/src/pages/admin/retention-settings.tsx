import { useEffect, useState } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminGetRetentionSettings,
  useAdminUpdateRetentionSettings,
  useAdminPreviewRetentionSettings,
  useAdminGetRetentionSettingsHistory,
  getAdminGetRetentionSettingsQueryKey,
  getAdminGetRetentionSettingsHistoryQueryKey,
  getOwnerListRetentionQueryKey,
} from "@workspace/api-client-react";
import type {
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
import { Loader2, Save, History, SlidersHorizontal, Info, RotateCcw, Eye, MoveRight } from "lucide-react";
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

function changedFields(entry: RetentionSettingsHistoryEntry): FieldKey[] {
  return (Object.keys(entry.thresholds) as FieldKey[]).filter(
    (k) => entry.thresholds[k] !== entry.previousThresholds[k],
  );
}

type RestoreTarget =
  | { kind: "history"; entry: RetentionSettingsHistoryEntry }
  | { kind: "defaults"; thresholds: RetentionThresholds };
export default function AdminRetentionSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useAdminGetRetentionSettings();
  const { data: history = [], isLoading: isHistoryLoading } = useAdminGetRetentionSettingsHistory();
  const updateMutation = useAdminUpdateRetentionSettings();
  const previewMutation = useAdminPreviewRetentionSettings();
  const [preview, setPreview] = useState<RetentionSettingsPreview | null>(null);

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

  useEffect(() => {
    if (settings) {
      setForm({
        newCustomerWindowDays: String(settings.thresholds.newCustomerWindowDays),
        defaultIntervalDays: String(settings.thresholds.defaultIntervalDays),
        atRiskIntervalPercent: String(settings.thresholds.atRiskIntervalPercent),
        lostIntervalPercent: String(settings.thresholds.lostIntervalPercent),
        lostMinimumDays: String(settings.thresholds.lostMinimumDays),
        vipMinCompletedVisits: String(settings.thresholds.vipMinCompletedVisits),
        vipSpendPercentOfMedian: String(settings.thresholds.vipSpendPercentOfMedian),
      });
      setFieldErrors({});
    }
  }, [settings]);

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

  const handleSave = () => {
    const values = parseForm();
    if (!values) {
      toast.error("Proverite označena polja pre čuvanja.");
      return;
    }

    updateMutation.mutate({ data: values }, {
      onSuccess: (updated) => {
        toast.success(`Pragovi retencije sačuvani (verzija ${updated.version}).`);
        setPreview(null);
        invalidateAfterSave();
      },
      onError: (err) => {
        toast.error(extractApiError(err, "Greška prilikom čuvanja pragova."));
      },
    });
  };

  const handleRestore = (target: RestoreTarget) => {
    const thresholds = target.kind === "history" ? target.entry.thresholds : target.thresholds;
    updateMutation.mutate({ data: thresholds }, {
      onSuccess: (updated) => {
        toast.success(
          target.kind === "history"
            ? `Vrednosti verzije ${target.entry.version} su vraćene kao nova verzija ${updated.version}.`
            : `Podrazumevane vrednosti platforme su vraćene kao nova verzija ${updated.version}.`,
        );
        setPreview(null);
        invalidateAfterSave();
        setRestoreTarget(null);
      },
      onError: (err) => {
        toast.error(extractApiError(err, "Greška prilikom vraćanja verzije."));
        setRestoreTarget(null);
      },
    });
  };

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

        <Card>
          <CardHeader className="pb-4 border-b border-border/50 bg-muted/30">
            <CardTitle className="text-lg flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-muted-foreground" />
              Aktivna podešavanja
              <Badge variant="secondary" data-testid="retention-settings-version">
                {settings?.isDefault ? "Podrazumevano (v0)" : `Verzija ${settings?.version}`}
              </Badge>
            </CardTitle>
            {settings && !settings.isDefault && settings.changedAt && (
              <CardDescription>
                Poslednja izmena: {format(new Date(settings.changedAt), "dd.MM.yyyy. HH:mm")}
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
                    disabled={updateMutation.isPending}
                    data-testid="restore-retention-defaults"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Vrati podrazumevane vrednosti
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handlePreview}
                  disabled={previewMutation.isPending || updateMutation.isPending}
                  data-testid="preview-retention-settings"
                >
                  {previewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                  Proveri uticaj
                </Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="save-retention-settings">
                  {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
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
                  <Badge
                    variant={preview.reclassifiedCount > 0 ? "default" : "secondary"}
                    data-testid="retention-preview-reclassified"
                  >
                    {preview.reclassifiedCount === 0
                      ? "Bez promena statusa"
                      : `${preview.reclassifiedCount} od ${preview.totalCustomers} klijenata menja status`}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Poređenje sa trenutno aktivnim pragovima{" "}
                  ({preview.currentVersion === 0 ? "podrazumevana podešavanja" : `verzija ${preview.currentVersion}`}),
                  ukupno {preview.totalCustomers} klijenata na platformi. Pregled ništa ne čuva — pragovi ostaju
                  nepromenjeni dok ne kliknete „Sačuvaj izmene“.
                </p>

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
                        return (
                          <tr key={status} className="border-b border-border/30 last:border-0" data-testid={`retention-preview-row-${status}`}>
                            <td className="py-1.5 pr-4 text-foreground">{STATUS_LABELS[status]}</td>
                            <td className="py-1.5 pr-4">{current}</td>
                            <td className="py-1.5 pr-4 font-medium text-foreground">{candidate}</td>
                            <td className={`py-1.5 font-medium ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                              {delta > 0 ? `+${delta}` : delta}
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
                          <span className="font-semibold text-foreground">{shift.count}</span>
                          {shift.count === 1 ? "klijent" : "klijenata"}
                        </li>
                      ))}
                    </ul>
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
                            disabled={updateMutation.isPending}
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
            {restoreTarget && settings && (() => {
              const targetThresholds =
                restoreTarget.kind === "history" ? restoreTarget.entry.thresholds : restoreTarget.thresholds;
              const diffKeys = (Object.keys(targetThresholds) as FieldKey[]).filter(
                (k) => targetThresholds[k] !== settings.thresholds[k],
              );
              return (
                <div className="text-sm">
                  {diffKeys.length === 0 ? (
                    <p className="text-muted-foreground italic">
                      Vrednosti su identične trenutno aktivnim — vraćanje neće promeniti ponašanje.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {diffKeys.map((key) => (
                        <li key={key} className="text-muted-foreground">
                          <span className="text-foreground">{FIELD_LABELS[key]}:</span>{" "}
                          <span className="line-through">{settings.thresholds[key]}</span>
                          {" → "}
                          <span className="font-semibold text-foreground">{targetThresholds[key]}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={updateMutation.isPending} data-testid="cancel-restore-retention">
                Otkaži
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  if (restoreTarget) handleRestore(restoreTarget);
                }}
                disabled={updateMutation.isPending}
                data-testid="confirm-restore-retention"
              >
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                {restoreTarget?.kind === "defaults" ? "Vrati podrazumevane vrednosti" : "Vrati ovu verziju"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}
