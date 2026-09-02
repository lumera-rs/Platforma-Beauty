import { useState, useEffect } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminGetAftercareSettings,
  useAdminUpdateAftercareSettings,
  getAdminGetAftercareSettingsQueryKey,
  getApiErrorDetails,
  type AftercareSettingsUpdate
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, RefreshCcw, Save } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "wouter";

export default function AdminAftercareSettings() {
  const { data: settings, isLoading, refetch } = useAdminGetAftercareSettings({
    query: {
      queryKey: getAdminGetAftercareSettingsQueryKey()
    }
  });

  const updateSettings = useAdminUpdateAftercareSettings();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState<Partial<AftercareSettingsUpdate>>({});
  const [conflictError, setConflictError] = useState(false);
  type NumericSetting =
    | "cooldownDays"
    | "secondReminderDelayDays"
    | "postTreatmentDiscountPercent"
    | "postTreatmentDiscountValidityDays"
    | "personalizedBundleDiscountPercent"
    | "combinationWindowDays";

  const setNumericSetting = (field: NumericSetting, rawValue: string) => {
    setForm((current) => ({
      ...current,
      [field]: rawValue === "" ? undefined : Number.parseInt(rawValue, 10),
    }));
  };

  useEffect(() => {
    if (settings && !conflictError) {
      setForm({
        expectedVersion: settings.version,
        firstTiming: settings.firstTiming,
        cooldownDays: settings.cooldownDays,
        secondReminderDelayDays: settings.secondReminderDelayDays,
        postTreatmentDiscountEnabled: settings.postTreatmentDiscountEnabled,
        postTreatmentDiscountPercent: settings.postTreatmentDiscountPercent,
        postTreatmentDiscountValidityDays: settings.postTreatmentDiscountValidityDays,
        personalizedBundleDiscountPercent: settings.personalizedBundleDiscountPercent,
        combinationWindowDays: settings.combinationWindowDays,
      });
    }
  }, [settings, conflictError]);

  const handleSave = () => {
    if (!form.expectedVersion || !form.firstTiming) return;

    const requiredNumbers = [
      form.cooldownDays,
      form.secondReminderDelayDays,
      form.postTreatmentDiscountPercent,
      form.postTreatmentDiscountValidityDays,
      form.personalizedBundleDiscountPercent,
      form.combinationWindowDays,
    ];
    if (requiredNumbers.some((value) => !Number.isInteger(value))) {
      toast.error("Greška", { description: "Sva brojčana polja moraju sadržati ceo broj." });
      return;
    }

    // Validate bounds based on schema
    if ((form.cooldownDays || 0) < 1) { toast.error("Greška", { description: "Cooldown period mora biti bar 1 dan." }); return; }
    if ((form.secondReminderDelayDays || 0) < 1) { toast.error("Greška", { description: "Kašnjenje drugog podsetnika mora biti bar 1 dan." }); return; }
    if ((form.combinationWindowDays || 0) < 1 || (form.combinationWindowDays || 0) > 3650) { toast.error("Greška", { description: "Prozor kombinovanja tretmana mora biti između 1 i 3650 dana." }); return; }
    if (form.postTreatmentDiscountEnabled) {
      if ((form.postTreatmentDiscountPercent || 0) < 0 || (form.postTreatmentDiscountPercent || 0) > 100) { toast.error("Greška", { description: "Popust mora biti između 0 i 100." }); return; }
      if ((form.postTreatmentDiscountValidityDays || 0) < 1) { toast.error("Greška", { description: "Period važenja popusta mora biti bar 1 dan." }); return; }
    }
    if ((form.personalizedBundleDiscountPercent || 0) < 1 || (form.personalizedBundleDiscountPercent || 0) > 100) { toast.error("Greška", { description: "Popust za personalizovani paket mora biti između 1 i 100." }); return; }

    const payload: AftercareSettingsUpdate = {
      expectedVersion: form.expectedVersion,
      firstTiming: form.firstTiming,
      cooldownDays: form.cooldownDays!,
      secondReminderDelayDays: form.secondReminderDelayDays!,
      postTreatmentDiscountEnabled: form.postTreatmentDiscountEnabled ?? false,
      postTreatmentDiscountPercent: form.postTreatmentDiscountPercent!,
      postTreatmentDiscountValidityDays: form.postTreatmentDiscountValidityDays!,
      personalizedBundleDiscountPercent: form.personalizedBundleDiscountPercent!,
      combinationWindowDays: form.combinationWindowDays!,
    };

    updateSettings.mutate({ data: payload }, {
      onSuccess: (data) => {
        setConflictError(false);
        qc.setQueryData(getAdminGetAftercareSettingsQueryKey(), data);
        toast.success("Podešavanja su uspešno sačuvana.");
      },
      onError: (err: unknown) => {
        const details = getApiErrorDetails(err);
        if (details.code === "CONFLICT") {
          setConflictError(true);
          toast.error("Greška pri čuvanju", { description: "Drugi administrator je u međuvremenu izmenio podešavanja. Osvežite stranicu." });
        } else {
          toast.error("Greška", { description: details.message || "Podešavanja nisu sačuvana." });
        }
      }
    });
  };

  const handleRebase = async () => {
    await refetch();
    setConflictError(false);
  };

  if (isLoading) {
    return <AdminLayout><div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground flex items-center gap-2">
              <Sparkles className="w-8 h-8 text-primary" /> Nega posle tretmana
            </h1>
            <p className="text-muted-foreground mt-2">
              Upravljajte globalnim postavkama za B2C preporuke nege posle tretmana.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/nega-posle-tretmana/statistika">Statistika</Link>
          </Button>
        </div>

        {conflictError && (
          <Alert variant="destructive">
            <RefreshCcw className="h-4 w-4" />
            <AlertTitle>Konflikt verzija</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              Drugi administrator je u međuvremenu ažurirao ova podešavanja. Vaše izmene nisu sačuvane kako ne bi prebrisale tuđe.
              <Button size="sm" variant="outline" onClick={handleRebase} className="bg-destructive text-destructive-foreground mt-2 border-transparent">
                Osveži najnovije podatke
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Tajming preporuka</CardTitle>
              <CardDescription>Kada se kupcima šalju preporuke nakon završenog tretmana.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Slanje prve preporuke</Label>
                <Select 
                  value={form.firstTiming ?? ""}
                  onValueChange={(v) => setForm({ ...form, firstTiming: v as any })}
                >
                  <SelectTrigger className="w-full sm:w-[400px]">
                    <SelectValue placeholder="Izaberite tajming" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMMEDIATE_AFTER_COMPLETION">Odmah nakon završenog tretmana</SelectItem>
                    <SelectItem value="NEXT_DAY">Sledećeg dana</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label>Podsetnik (dana kasnije)</Label>
                  <Input 
                    type="number" 
                    min={1} 
                    max={3650}
                    value={form.secondReminderDelayDays ?? ""} 
                    onChange={(e) => setNumericSetting("secondReminderDelayDays", e.currentTarget.value)}
                  />
                  <p className="text-xs text-muted-foreground">Broj dana nakon prve preporuke kada se šalje podsetnik ako kupac nije otvorio.</p>
                </div>

                <div className="grid gap-2">
                  <Label>Cooldown period (dana)</Label>
                  <Input 
                    type="number" 
                    min={1} 
                    max={3650}
                    value={form.cooldownDays ?? ""} 
                    onChange={(e) => setNumericSetting("cooldownDays", e.currentTarget.value)}
                  />
                  <p className="text-xs text-muted-foreground">Minimalni broj dana pre nego što kupac može ponovo dobiti preporuku za istu vrstu tretmana.</p>
                </div>

                <div className="grid gap-2">
                  <Label>Prozor kombinovanja tretmana (dana)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    value={form.combinationWindowDays ?? ""}
                    onChange={(e) => setNumericSetting("combinationWindowDays", e.currentTarget.value)}
                  />
                  <p className="text-xs text-muted-foreground">Završeni tretmani kupca u ovom periodu ulaze u jednu objedinjenu preporuku.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Popusti za negu</CardTitle>
              <CardDescription>Podešavanje popusta koji se nude isključivo preko preporuka za negu.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between border p-4 rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">Omogući post-tretman popust</Label>
                  <p className="text-sm text-muted-foreground">Automatski nudi popust na preporučene proizvode nakon tretmana.</p>
                </div>
                <Switch 
                  checked={form.postTreatmentDiscountEnabled || false}
                  onCheckedChange={(checked) => setForm({ ...form, postTreatmentDiscountEnabled: checked })}
                />
              </div>

              {form.postTreatmentDiscountEnabled && (
                <div className="grid sm:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                  <div className="grid gap-2">
                    <Label>Iznos popusta (%)</Label>
                    <Input 
                      type="number" 
                      min={0} 
                      max={100}
                      value={form.postTreatmentDiscountPercent ?? ""} 
                      onChange={(e) => setNumericSetting("postTreatmentDiscountPercent", e.currentTarget.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Važenje popusta (dana)</Label>
                    <Input 
                      type="number" 
                      min={1} 
                      max={3650}
                      value={form.postTreatmentDiscountValidityDays ?? ""} 
                      onChange={(e) => setNumericSetting("postTreatmentDiscountValidityDays", e.currentTarget.value)}
                    />
                  </div>
                </div>
              )}

              <div className="grid gap-2 border-t pt-4">
                <Label>Popust za personalizovane pakete (%)</Label>
                <Input 
                  type="number" 
                  min={1} 
                  max={100}
                  className="sm:w-48"
                  value={form.personalizedBundleDiscountPercent ?? ""} 
                  onChange={(e) => setNumericSetting("personalizedBundleDiscountPercent", e.currentTarget.value)}
                />
                <p className="text-xs text-muted-foreground">Dodatni popust ako kupac kupi sve preporučene proizvode kao personalizovani paket.</p>
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t p-6">
              <Button onClick={handleSave} disabled={updateSettings.isPending} data-testid="button-save-aftercare-settings">
                {updateSettings.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Sačuvaj podešavanja
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
