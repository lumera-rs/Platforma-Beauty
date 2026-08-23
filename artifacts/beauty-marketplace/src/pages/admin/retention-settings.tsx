import { useEffect, useState } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminGetRetentionSettings,
  useAdminUpdateRetentionSettings,
  useAdminGetRetentionSettingsHistory,
  getAdminGetRetentionSettingsQueryKey,
  getAdminGetRetentionSettingsHistoryQueryKey,
  getOwnerListRetentionQueryKey,
} from "@workspace/api-client-react";
import type { RetentionThresholds, RetentionSettingsHistoryEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, History, SlidersHorizontal, Info } from "lucide-react";
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

function changedFields(entry: RetentionSettingsHistoryEntry): FieldKey[] {
  return (Object.keys(entry.thresholds) as FieldKey[]).filter(
    (k) => entry.thresholds[k] !== entry.previousThresholds[k],
  );
}

export default function AdminRetentionSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useAdminGetRetentionSettings();
  const { data: history = [], isLoading: isHistoryLoading } = useAdminGetRetentionSettingsHistory();
  const updateMutation = useAdminUpdateRetentionSettings();

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

  const handleSave = () => {
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
    if (Object.keys(errors).length > 0) {
      toast.error("Proverite označena polja pre čuvanja.");
      return;
    }

    updateMutation.mutate({ data: values }, {
      onSuccess: (updated) => {
        toast.success(`Pragovi retencije sačuvani (verzija ${updated.version}).`);
        queryClient.invalidateQueries({ queryKey: getAdminGetRetentionSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetRetentionSettingsHistoryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerListRetentionQueryKey() });
      },
      onError: (err) => {
        toast.error(extractApiError(err, "Greška prilikom čuvanja pragova."));
      },
    });
  };

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
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                  {fieldErrors[field.key] ? (
                    <p className="text-xs text-destructive" data-testid={`error-${field.key}`}>{fieldErrors[field.key]}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{field.hint} (od {field.min} do {field.max})</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0" />
                Nova podešavanja odmah važe za sve salone — CRM objašnjenja vlasnika koriste aktivnu verziju pragova.
              </p>
              <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="save-retention-settings">
                {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Sačuvaj izmene
              </Button>
            </div>
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
                  return (
                    <div key={entry.version} className="p-4" data-testid={`retention-history-v${entry.version}`}>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant="secondary">Verzija {entry.version}</Badge>
                        <span className="text-sm font-medium text-foreground">{entry.changedByName ?? "Nepoznat administrator"}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(entry.changedAt), "dd.MM.yyyy. HH:mm")}</span>
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
      </div>
    </AdminLayout>
  );
}
