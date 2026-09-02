import { useState, useEffect } from "react";
import { AdminLayout } from "./layout";
import { useAdminGetReviewRewardSettings, useAdminUpdateReviewRewardSettings, AdminUpdateReviewRewardSettingsBody } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Gift, Trophy } from "lucide-react";
import { extractApiError } from "@/lib/admin-form-utils";

export default function AdminReviewRewards() {
  
  const { data: response, isLoading, refetch } = useAdminGetReviewRewardSettings();
  const settings = response?.settings;

  const updateSettings = useAdminUpdateReviewRewardSettings();
  const { toast } = useToast();

  const [form, setForm] = useState<AdminUpdateReviewRewardSettingsBody>({
    enabled: false, version: 0,
    invitationDelayDays: 7,
    percent: 10,
    validityDays: 30,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        enabled: settings.enabled, version: settings.version,
        invitationDelayDays: settings.invitationDelayDays,
        percent: settings.percent,
        validityDays: settings.validityDays,
      });
    }
  }, [settings]);

  const handleSave = () => {
    updateSettings.mutate({ data: form }, {
      onSuccess: () => {
        toast.success("Podešavanja su uspešno sačuvana.");
        refetch();
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err, "Nije moguće sačuvati podešavanja.") })
    });
  };

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-bold text-foreground">Nagrade za recenzije</h1>
        <p className="text-muted-foreground">Upravljajte automatskim slanjem kupona za ostavljene recenzije proizvoda (B2C).</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5 text-primary" /> Podešavanja programa</CardTitle>
              <CardDescription>Kupci će automatski dobijati email poziv da ostave recenziju nakon isporuke. Ukoliko ostave recenziju sa slikom ili dovoljno teksta, dobiće automatski promo kod.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <>
                  <div className="flex items-center justify-between p-4 bg-muted/20 border rounded-xl">
                    <div className="space-y-0.5">
                      <Label className="text-base">Program nagrađivanja aktiviran</Label>
                      <p className="text-sm text-muted-foreground">Uključuje automatsko slanje emailova i dodelu kupona.</p>
                    </div>
                    <Switch checked={form.enabled} onCheckedChange={(c) => setForm({ ...form, enabled: c })} />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Dani nakon isporuke za slanje poziva</Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" min="1" max="30" value={form.invitationDelayDays} onChange={(e) => setForm({ ...form, invitationDelayDays: Number(e.target.value) })} disabled={!form.enabled} />
                        <span className="text-sm text-muted-foreground">dana</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Kada kupac primi porudžbinu, posle ovoliko dana će dobiti email da oceni proizvod.</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Procenat popusta za kupon</Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" min="1" max="99" value={form.percent} onChange={(e) => setForm({ ...form, percent: Number(e.target.value) })} disabled={!form.enabled} />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Popust koji će se primeniti na sledeću B2C porudžbinu.</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Važenje kupona (u danima)</Label>
                      <div className="flex items-center gap-2">
                        <Input type="number" min="1" max="365" value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: Number(e.target.value) })} disabled={!form.enabled} />
                        <span className="text-sm text-muted-foreground">dana</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Koliko dana kupac ima da iskoristi dobijeni kod pre isteka.</p>
                    </div>
                  </div>

                  <div className="pt-4 border-t flex justify-end">
                    <Button onClick={handleSave} disabled={updateSettings.isPending}>
                      {updateSettings.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Sačuvaj podešavanja
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="bg-primary/5 border-b">
              <CardTitle className="text-lg flex items-center gap-2 text-primary"><Trophy className="w-5 h-5" /> Statistika</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {isLoading || !response ? (
                <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : (
                <div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Dodeljeni reward kuponi</p>
                    <p className="text-3xl font-bold text-emerald-600">{response.stats.issued}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}