import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowLeft, BadgeCheck, Building2, Save, Loader2, Landmark, Settings2, FileText, Ban } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

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
  billingSettings: {
    commissionPercent: BillingSetting;
    reservePercent: BillingSetting;
    onlineRefundDays: BillingSetting;
    liveAppealDays: BillingSetting;
    featuredCoursePrice: BillingSetting;
  };
};

type OverrideKey = keyof CenterDetail["billingSettings"];

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
  
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  
  const [center, setCenter] = useState<CenterDetail | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Local state for edits
  const [pib, setPib] = useState("");
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
      const data = await api<CenterDetail>(`/api/admin/education/centers/${centerId}`);
      setCenter(data);
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
          verificationStatus, 
          subscriptionStatus: verificationStatus === "verified" ? "active" : undefined 
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

  const labels: Record<OverrideKey, { title: string; suffix: string; desc: string }> = {
    commissionPercent: { title: "Provizija", suffix: "%", desc: "Zadržano od svake transakcije." },
    reservePercent: { title: "Rezerva", suffix: "%", desc: "Zadržano do isteka perioda oslobađanja." },
    onlineRefundDays: { title: "Rok za online povraćaj", suffix: " dana", desc: "Period za prigovor na online sadržaj." },
    liveAppealDays: { title: "Rok za live žalbu", suffix: " dana", desc: "Period nakon događaja za prigovor." },
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
                    <label className="text-sm font-medium text-foreground">PIB (Poreski identifikacioni broj)</label>
                    <Input 
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
                      Verifikuj i aktiviraj
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
            </div>

            {/* Right Column: Billing overrides */}
            <div className="md:col-span-8 space-y-6">
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
                                <Switch 
                                  checked={isCustom} 
                                  onCheckedChange={(c) => toggleOverride(key, c)} 
                                  aria-label={`Prilagođeno pravilo za ${label.title}`}
                                />
                                <span className="text-sm font-medium text-muted-foreground">
                                  {isCustom ? "Zameni" : "Nasledi"}
                                </span>
                              </div>
                              
                              <div className="w-[100px] relative">
                                <Input 
                                  type="number" 
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
      </div>
    </AdminLayout>
  );
}
