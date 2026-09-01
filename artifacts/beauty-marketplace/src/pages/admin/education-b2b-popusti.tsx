import React, { useState, useEffect } from "react";
import {
  getApiErrorDetails,
  useAdminGetEducationB2bDiscountTiers,
  useAdminReplaceEducationB2bDiscountTiers,
} from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Trash2, Plus, Info, AlertTriangle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQueryClient } from "@tanstack/react-query";

type TierRow = { minSpend: string; maxSpend: string; percent: string };

export default function AdminEducationB2bTiers() {
  const { data: tiersData, isLoading, error, refetch } = useAdminGetEducationB2bDiscountTiers();
  const replaceMut = useAdminReplaceEducationB2bDiscountTiers();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    if (tiersData) {
      const apiTiers = tiersData.tiers || [];
      const formatted = apiTiers.map((t) => ({
        minSpend: String(t.minSpendRsd || 0),
        maxSpend: t.maxSpendRsd ? String(t.maxSpendRsd) : "",
        percent: String(t.discountPercent || 0)
      }));
      setTiers(formatted);
      setVersion(String(tiersData.version || ""));
    }
  }, [tiersData]);

  const handleAdd = () => {
    setTiers([...tiers, { minSpend: "0", maxSpend: "", percent: "0" }]);
  };

  const handleRemove = (index: number) => {
    const newTiers = [...tiers];
    newTiers.splice(index, 1);
    setTiers(newTiers);
  };

  const handleChange = (index: number, field: keyof TierRow, value: string) => {
    const newTiers = [...tiers];
    newTiers[index][field] = value;
    setTiers(newTiers);
  };

  const handleSave = () => {
    const parsedTiers = tiers.map((t, idx) => ({
      name: "Nivo " + (idx + 1),
      minSpendRsd: Number(t.minSpend),
      maxSpendRsd: t.maxSpend ? Number(t.maxSpend) : null,
      discountPercent: Number(t.percent),
      sortOrder: idx
    })).filter(t => !isNaN(t.minSpendRsd) && !isNaN(t.discountPercent));

    // Validacija na klijentu: provera rastućih pragova i praznina
    for (let i = 0; i < parsedTiers.length - 1; i++) {
      if (parsedTiers[i].maxSpendRsd === null) {
        toast.error("Validacija", { description: `Nivo ${i + 1} mora imati maksimalan iznos, jer nije poslednji.` });
        return;
      }
      if (parsedTiers[i].maxSpendRsd !== parsedTiers[i + 1].minSpendRsd) {
        toast.error("Validacija", { description: `Maksimalan iznos nivoa ${i + 1} mora biti jednak minimalnom iznosu nivoa ${i + 2}.` });
        return;
      }
    }

    replaceMut.mutate({
      data: {
        tiers: parsedTiers,
        expectedVersion: Number(version) || 0
      }
    }, {
      onSuccess: () => {
        toast.success("Pragovi sačuvani");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/education/b2b/discount-tiers"] });
      },
      onError: (err) => {
        const { status, code } = getApiErrorDetails(err);
        if (status === 409 || code === "INTEGRATION_SETTINGS_VERSION_CONFLICT") {
          toast.error("Konflikt verzija", { description: "Neko drugi je u međuvremenu izmenio pragove. Osvežite podatke." });
        } else {
          toast.error("Greška", { description: "Čuvanje nije uspelo." });
        }
      }
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div>;
  }

  return (
    <TooltipProvider>
      <div className="max-w-4xl space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">B2B Pragovi (Edukacija)</h1>
            <p className="text-muted-foreground mt-1">Definišite pragove mesečne potrošnje i pripadajuće popuste.</p>
          </div>
          <Button variant="outline" onClick={() => refetch()} title="Osveži podatke">
            <RefreshCw className="w-4 h-4 mr-2" /> Osveži
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Nije moguće učitati trenutne pragove.</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Nivoi popusta</CardTitle>
            <CardDescription>
              Popust se automatski dodeljuje na osnovu potrošnje u prethodnom mesecu. Nivoi moraju biti povezani (Maksimum prethodnog jednak minimumu narednog). Poslednji nivo treba ostaviti bez maksimalnog iznosa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {tiers.map((tier, index) => (
                <div key={index} className="flex items-end gap-4 bg-muted/20 p-4 rounded-lg border">
                  <div className="flex-1 space-y-2">
                    <Label className="flex items-center gap-2">
                      Minimum (RSD)
                      <Tooltip><TooltipTrigger type="button"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Donji prag potrošnje za ovaj nivo</TooltipContent></Tooltip>
                    </Label>
                    <Input 
                      type="number" 
                      value={tier.minSpend} 
                      onChange={(e) => handleChange(index, "minSpend", e.target.value)} 
                    />
                  </div>
                  <div className="flex-1 space-y-2">
                    <Label className="flex items-center gap-2">
                      Maksimum (RSD)
                      <Tooltip><TooltipTrigger type="button"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Gornji prag potrošnje (ostavite prazno za poslednji nivo)</TooltipContent></Tooltip>
                    </Label>
                    <Input 
                      type="number" 
                      value={tier.maxSpend} 
                      placeholder="Neograničeno"
                      onChange={(e) => handleChange(index, "maxSpend", e.target.value)} 
                    />
                  </div>
                  <div className="flex-1 space-y-2">
                    <Label className="flex items-center gap-2">
                      Popust (%)
                      <Tooltip><TooltipTrigger type="button"><Info className="w-3.5 h-3.5 text-muted-foreground" /></TooltipTrigger><TooltipContent>Procenat popusta koji se odobrava</TooltipContent></Tooltip>
                    </Label>
                    <Input 
                      type="number" 
                      value={tier.percent} 
                      onChange={(e) => handleChange(index, "percent", e.target.value)} 
                    />
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => handleRemove(index)} className="text-destructive shrink-0 mb-0.5">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              
              {tiers.length === 0 && (
                <div className="text-center text-muted-foreground py-6 text-sm">
                  Nema definisanih pragova.
                </div>
              )}
            </div>

            <Button type="button" variant="outline" onClick={handleAdd} className="w-full border-dashed">
              <Plus className="w-4 h-4 mr-2" /> Dodaj nivo
            </Button>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={replaceMut.isPending} size="lg">
            {replaceMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Sačuvaj izmene
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
