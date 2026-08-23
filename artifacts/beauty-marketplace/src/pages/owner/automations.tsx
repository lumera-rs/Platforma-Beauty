import { useState, useMemo } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useOwnerListAutomations, 
  useOwnerGetAutomationStats,
  useOwnerListAutomationStats,
  useOwnerListAutomationAttributedAppointments,
  useOwnerCreateAutomation, 
  useOwnerUpdateAutomation, 
  useOwnerDeleteAutomation,
  useOwnerActivateAutomation,
  useOwnerPauseAutomation,
  useOwnerTestRunAutomation,
  useGetCurrentUser,
  getOwnerListAutomationsQueryKey,
  getOwnerListAutomationStatsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Zap, Play, Pause, Trash2, Mail, MessageSquare, Plus, Activity, CheckCircle2, XCircle, BarChart3, CalendarCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function rate(part: number, total: number) {
  if (!total) return null;
  return `${Math.round((part / total) * 100)}%`;
}

type StatsPeriod = "7d" | "30d" | "90d" | "all";

const periodOptions: { value: StatsPeriod; label: string }[] = [
  { value: "7d", label: "7 dana" },
  { value: "30d", label: "30 dana" },
  { value: "90d", label: "90 dana" },
  { value: "all", label: "Sve vreme" },
];

const periodDescriptionLabels: Record<StatsPeriod, string> = {
  "7d": "poslednjih 7 dana",
  "30d": "poslednjih 30 dana",
  "90d": "poslednjih 90 dana",
  all: "sve vreme",
};

/**
 * Live per-channel delivery funnel: sent → delivered → opened, fed by verified
 * provider webhook events. `opened: null` marks a channel whose provider does
 * not expose open tracking (SMS) — the opened step is replaced by a note.
 */
function DeliveryFunnel({ icon, label, sent, delivered, opened, failed, noOpensNote }: {
  icon: React.ReactNode;
  label: string;
  sent: number;
  delivered: number;
  opened: number | null;
  failed: number;
  noOpensNote?: string;
}) {
  return (
    <div className="border rounded-lg p-3 bg-muted/20" data-testid={`funnel-${label.toLowerCase()}`}>
      <div className="flex items-center gap-2 text-sm font-semibold mb-2">{icon} {label}</div>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="px-2 py-1 rounded bg-muted/60">Poslato: <strong>{sent}</strong></span>
        <span className="text-muted-foreground">→</span>
        <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-900">
          Isporučeno: <strong>{delivered}</strong>{rate(delivered, sent) ? <span className="text-emerald-700 ml-1">({rate(delivered, sent)})</span> : null}
        </span>
        {opened !== null && (
          <>
            <span className="text-muted-foreground">→</span>
            <span className="px-2 py-1 rounded bg-indigo-50 text-indigo-900">
              Otvoreno: <strong>{opened}</strong>{rate(opened, sent) ? <span className="text-indigo-700 ml-1">({rate(opened, sent)})</span> : null}
            </span>
          </>
        )}
      </div>
      {failed > 0 && (
        <p className="text-xs text-red-700 mt-2">Neisporučeno (provajder prijavio grešku): {failed}</p>
      )}
      {noOpensNote && <p className="text-xs text-muted-foreground mt-2">{noOpensNote}</p>}
    </div>
  );
}

/**
 * At-a-glance performance comparison across every automation rule: per-channel
 * sent → delivered → opened rates plus attributed appointments, from the same
 * verified provider-event counts as the per-rule stats dialog. SMS providers
 * do not report opens, so the SMS column shows delivery only.
 */
function CampaignOverview({ items, period, onPeriodChange, onShowStats }: {
  items: any[];
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  onShowStats: (ruleId: string) => void;
}) {
  const anySms = items.some((i) => i.smsSentCount > 0);
  return (
    <Card data-testid="campaign-overview">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" /> Pregled performansi kampanja
            </CardTitle>
            <CardDescription className="mt-1.5">
              Uporedni prikaz svih pravila — isporuka i otvaranja prema podacima provajdera, uz termine i prihod ostvarene kampanjama. Otkazani termini se ne računaju.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1 shrink-0" role="group" aria-label="Period prikaza" data-testid="overview-period-selector">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onPeriodChange(opt.value)}
                aria-pressed={period === opt.value}
                data-testid={`period-${opt.value}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === opt.value
                    ? "bg-background text-foreground shadow-sm border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-4 font-semibold">Kampanja</th>
                <th className="py-2 pr-4 font-semibold"><span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</span></th>
                <th className="py-2 pr-4 font-semibold"><span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> SMS</span></th>
                <th className="py-2 font-semibold text-right"><span className="inline-flex items-center gap-1"><CalendarCheck className="w-3.5 h-3.5" /> Termini</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.ruleId} className="border-b last:border-b-0 align-top" data-testid={`overview-row-${item.ruleId}`}>
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      className="font-medium text-foreground hover:underline text-left"
                      onClick={() => onShowStats(item.ruleId)}
                      title="Otvori detaljnu statistiku"
                    >
                      {item.ruleName}
                    </button>
                    <div className="mt-1 flex items-center gap-2">
                      {item.ruleStatus === 'active'
                        ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none">Aktivno</Badge>
                        : <Badge variant="secondary">{item.ruleStatus === 'paused' ? 'Pauzirano' : 'Nacrt'}</Badge>}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {item.emailSentCount > 0 ? (
                      <div className="space-y-0.5">
                        <div>Poslato: <strong>{item.emailSentCount}</strong></div>
                        <div className="text-emerald-800">
                          Isporučeno: <strong>{item.emailDeliveredCount}</strong>
                          {rate(item.emailDeliveredCount, item.emailSentCount) && <span className="text-emerald-700"> ({rate(item.emailDeliveredCount, item.emailSentCount)})</span>}
                        </div>
                        <div className="text-indigo-800">
                          Otvoreno: <strong>{item.emailOpenedCount}</strong>
                          {rate(item.emailOpenedCount, item.emailSentCount) && <span className="text-indigo-700"> ({rate(item.emailOpenedCount, item.emailSentCount)})</span>}
                        </div>
                        {item.emailFailedCount > 0 && <div className="text-xs text-red-700">Neisporučeno: {item.emailFailedCount}</div>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {item.smsSentCount > 0 ? (
                      <div className="space-y-0.5">
                        <div>Poslato: <strong>{item.smsSentCount}</strong></div>
                        <div className="text-emerald-800">
                          Isporučeno: <strong>{item.smsDeliveredCount}</strong>
                          {rate(item.smsDeliveredCount, item.smsSentCount) && <span className="text-emerald-700"> ({rate(item.smsDeliveredCount, item.smsSentCount)})</span>}
                        </div>
                        {item.smsFailedCount > 0 && <div className="text-xs text-red-700">Neisporučeno: {item.smsFailedCount}</div>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <span className="text-lg font-bold text-primary">{item.attributedAppointments}</span>
                    <div className="text-xs font-semibold text-emerald-800 whitespace-nowrap" data-testid={`overview-revenue-${item.ruleId}`}>
                      {(item.attributedRevenue ?? 0).toLocaleString("sr-RS")} RSD
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {anySms && (
          <p className="text-xs text-muted-foreground mt-3">Provajder ne prati otvaranja SMS poruka, pa se za SMS prikazuje samo isporuka.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function OwnerAutomations() {
  const { data: userResp } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: rules, isLoading } = useOwnerListAutomations({
    query: {
      enabled: !!userResp?.user,
      queryKey: getOwnerListAutomationsQueryKey()
    }
  });

  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>("all");

  const { data: overviewStats } = useOwnerListAutomationStats({ period: statsPeriod }, {
    query: {
      enabled: !!userResp?.user,
      queryKey: getOwnerListAutomationStatsQueryKey({ period: statsPeriod })
    }
  });

  const createMutation = useOwnerCreateAutomation();
  const updateMutation = useOwnerUpdateAutomation();
  const deleteMutation = useOwnerDeleteAutomation();
  const activateMutation = useOwnerActivateAutomation();
  const pauseMutation = useOwnerPauseAutomation();
  const testMutation = useOwnerTestRunAutomation();

  const [isEditing, setIsEditing] = useState(false);
  const [currentRuleId, setCurrentRuleId] = useState<string | null>(null);
  const [statsRuleId, setStatsRuleId] = useState<string | null>(null);

  const { data: statsData, isLoading: isStatsLoading } = useOwnerGetAutomationStats(
    statsRuleId ?? "",
    { period: statsPeriod },
    {
      query: {
        enabled: !!statsRuleId,
        queryKey: ['owner-automation-stats', statsRuleId, statsPeriod]
      }
    }
  );

  const { data: attributedAppointments, isLoading: isAttributedLoading } = useOwnerListAutomationAttributedAppointments(
    statsRuleId ?? "",
    {
      query: {
        enabled: !!statsRuleId,
        queryKey: ['owner-automation-attributed-appointments', statsRuleId]
      }
    }
  );

  const [formData, setFormData] = useState({
    name: "",
    trigger: "inactive_days" as any,
    triggerValue: 30,
    action: "send_email" as any,
    emailSubject: "",
    emailBody: "",
    smsBody: "",
    voucherCode: "",
  });

  const resetForm = () => {
    setFormData({
      name: "",
      trigger: "inactive_days",
      triggerValue: 30,
      action: "send_email",
      emailSubject: "",
      emailBody: "",
      smsBody: "",
      voucherCode: "",
    });
    setCurrentRuleId(null);
  };

  const handleEdit = (rule: any) => {
    let tVal = 30;
    if (rule.trigger === 'inactive_days') tVal = rule.triggerConfig?.inactiveDays || 30;
    else if (rule.trigger === 'visit_count') tVal = rule.triggerConfig?.visitCount || 5;
    else if (rule.trigger === 'expected_return_overdue') tVal = rule.triggerConfig?.overdueDays || 14;
    
    setFormData({
      name: rule.name,
      trigger: rule.trigger,
      triggerValue: tVal,
      action: rule.action,
      emailSubject: rule.emailSubject || "",
      emailBody: rule.emailBody || "",
      smsBody: rule.smsBody || "",
      voucherCode: rule.voucherCode || "",
    });
    setCurrentRuleId(rule.id);
    setIsEditing(true);
  };

  const handleSave = () => {
    let tConfig = {};
    if (formData.trigger === 'inactive_days') tConfig = { inactiveDays: formData.triggerValue };
    else if (formData.trigger === 'visit_count') tConfig = { visitCount: formData.triggerValue };
    else if (formData.trigger === 'expected_return_overdue') tConfig = { overdueDays: formData.triggerValue };

    const payload = {
      name: formData.name,
      trigger: formData.trigger,
      triggerConfig: tConfig,
      action: formData.action,
      emailSubject: formData.emailSubject || null,
      emailBody: formData.emailBody || null,
      smsBody: formData.smsBody || null,
      voucherCode: formData.voucherCode || null,
    };

    const callbacks = {
      onSuccess: () => {
        toast.success("Automatizacija sačuvana.");
        setIsEditing(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationStatsQueryKey() });
      },
      onError: (err: any) => {
        toast.error(err.message || "Greška pri čuvanju.");
      }
    };

    if (currentRuleId) {
      updateMutation.mutate({ automationId: currentRuleId, data: payload }, callbacks);
    } else {
      createMutation.mutate({ data: payload }, callbacks);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm("Trajno obrisati ovu automatizaciju?")) return;
    deleteMutation.mutate({ automationId: id }, {
      onSuccess: () => {
        toast.success("Automatizacija obrisana.");
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationStatsQueryKey() });
      }
    });
  };

  const toggleStatus = (rule: any) => {
    const callbacks = {
      onSuccess: () => {
        toast.success(`Automatizacija je ${rule.status === 'active' ? 'pauzirana' : 'aktivirana'}.`);
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationStatsQueryKey() });
      }
    };

    if (rule.status === 'active') {
      pauseMutation.mutate({ automationId: rule.id }, callbacks);
    } else {
      activateMutation.mutate({ automationId: rule.id }, callbacks);
    }
  };

  const handleTestRun = (id: string) => {
    toast.success("Pokrećem probno izvršavanje...");
    testMutation.mutate({ automationId: id }, {
      onSuccess: (res) => {
        toast.success(`Probni mod: ${res.eligibleCustomers} klijenata ispunjava uslov.`);
      }
    });
  };

  const triggerLabels: Record<string, string> = {
    inactive_days: "Neaktivnost (N dana)",
    birthday: "Rođendan",
    visit_count: "Broj poseta dostigao",
    first_visit_completed: "Završena prva poseta",
    package_completed: "Paket iskorišćen",
    appointment_cancelled: "Termin otkazan",
    expected_return_overdue: "Kasni na očekivani termin",
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/automatizacije" />
        
        <div className="flex-1 space-y-6 w-full min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Marketing Automatizacije</h1>
              <p className="text-muted-foreground mt-1">Automatski šaljite poruke klijentima prema postavljenim pravilima.</p>
            </div>
            <Button onClick={() => { resetForm(); setIsEditing(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Novo pravilo
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
            <span className="font-semibold flex items-center gap-2 mb-1"><Zap className="w-4 h-4" /> AI Nikada ne šalje sam.</span>
            Sve kampanje koje predloži AI Asistent biće kreirane u stanju "Pauzirano". Samo vi možete aktivirati slanje.
          </div>

          {overviewStats && overviewStats.length > 0 && (
            <CampaignOverview items={overviewStats} period={statsPeriod} onPeriodChange={setStatsPeriod} onShowStats={setStatsRuleId} />
          )}

          <div className="space-y-4">
            {isLoading ? (
              <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : rules?.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground flex flex-col items-center">
                  <Zap className="w-12 h-12 mb-4 opacity-20" />
                  <p>Nemate aktivnih automatizacija.</p>
                  <Button variant="outline" className="mt-4" onClick={() => { resetForm(); setIsEditing(true); }}>Kreirajte prvu automatizaciju</Button>
                </CardContent>
              </Card>
            ) : (
              rules?.map((rule: any) => (
                <Card key={rule.id} className={`transition-all ${rule.status === 'paused' ? 'opacity-70 bg-muted/30' : ''}`}>
                  <CardHeader className="pb-3 border-b">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {rule.name}
                          {rule.status === 'active' ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none">Aktivno</Badge> : <Badge variant="secondary">Pauzirano</Badge>}
                          {rule.aiProposed && <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">AI Predlog</Badge>}
                        </CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-4">
                          <span className="font-medium text-foreground">
                            Okidač: {triggerLabels[rule.trigger] || rule.trigger} {rule.trigger === 'inactive_days' && rule.triggerConfig?.inactiveDays ? `(${rule.triggerConfig.inactiveDays} dana)` : rule.trigger === 'visit_count' && rule.triggerConfig?.visitCount ? `(${rule.triggerConfig.visitCount})` : rule.trigger === 'expected_return_overdue' && rule.triggerConfig?.overdueDays ? `(${rule.triggerConfig.overdueDays} dana)` : ''}
                          </span>
                          <span>Akcija: {rule.action === 'send_email' ? 'Email' : rule.action === 'send_sms' ? 'SMS' : 'Email + SMS'}</span>
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleTestRun(rule.id)} title="Proveri koliko klijenata ispunjava uslov (Dry-run)">
                          <Play className="w-4 h-4 mr-2" /> Probni run
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setStatsRuleId(rule.id)}>
                          <Activity className="w-4 h-4 mr-2" /> Statistika
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleEdit(rule)}>Izmeni</Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="py-3 flex justify-between items-center bg-muted/10">
                    <div className="flex gap-2">
                      <Button variant={rule.status === 'active' ? "outline" : "default"} size="sm" onClick={() => toggleStatus(rule)}>
                        {rule.status === 'active' ? <><Pause className="w-4 h-4 mr-2" /> Pauziraj</> : <><Play className="w-4 h-4 mr-2" /> Aktiviraj</>}
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(rule.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </div>

      <Dialog open={isEditing} onOpenChange={(open) => !open && setIsEditing(false)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{currentRuleId ? "Izmeni automatizaciju" : "Nova automatizacija"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Naziv pravila</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Npr. Podsetnik za 30 dana neaktivnosti" />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Okidač (Trigger)</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formData.trigger} onChange={e => setFormData({...formData, trigger: e.target.value})}>
                  {Object.entries(triggerLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              {(formData.trigger === 'inactive_days' || formData.trigger === 'expected_return_overdue') && (
                <div className="space-y-2">
                  <Label>Broj dana</Label>
                  <Input type="number" min="1" value={formData.triggerValue} onChange={e => setFormData({...formData, triggerValue: Number(e.target.value)})} />
                </div>
              )}
              {formData.trigger === 'visit_count' && (
                <div className="space-y-2">
                  <Label>Broj poseta</Label>
                  <Input type="number" min="1" value={formData.triggerValue} onChange={e => setFormData({...formData, triggerValue: Number(e.target.value)})} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Akcija (Šta se šalje)</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formData.action} onChange={e => setFormData({...formData, action: e.target.value})}>
                <option value="send_email">Samo Email</option>
                <option value="send_sms">Samo SMS</option>
                <option value="send_email_and_sms">Email i SMS</option>
              </select>
            </div>

            {(formData.action === 'send_email' || formData.action === 'send_email_and_sms') && (
              <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="w-4 h-4" /> Email podešavanja</div>
                <div className="space-y-2">
                  <Label>Naslov email-a</Label>
                  <Input value={formData.emailSubject} onChange={e => setFormData({...formData, emailSubject: e.target.value})} placeholder="Nedostajete nam!" />
                </div>
                <div className="space-y-2">
                  <Label>Sadržaj email-a (HTML dozvoljen)</Label>
                  <Textarea value={formData.emailBody} onChange={e => setFormData({...formData, emailBody: e.target.value})} rows={5} placeholder="Zdravo {{firstName}}, nismo se dugo videli..." />
                  <p className="text-xs text-muted-foreground">Podržani tagovi: {"{{firstName}}, {{lastName}}, {{salonName}}, {{voucherCode}}"}</p>
                </div>
              </div>
            )}

            {(formData.action === 'send_sms' || formData.action === 'send_email_and_sms') && (
              <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="w-4 h-4" /> SMS podešavanja</div>
                <div className="space-y-2">
                  <Label>Tekst poruke (do 160 karaktera)</Label>
                  <Textarea value={formData.smsBody} onChange={e => setFormData({...formData, smsBody: e.target.value})} rows={3} placeholder="Zdravo {{firstName}}, posetite nas opet. Vaš {{salonName}}." />
                  <p className="text-xs text-muted-foreground">Podržani tagovi: {"{{firstName}}, {{salonName}}, {{voucherCode}}"}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Promo kod (opciono)</Label>
              <Input value={formData.voucherCode} onChange={e => setFormData({...formData, voucherCode: e.target.value})} placeholder="Npr. POPUST10" />
              <p className="text-xs text-muted-foreground">Ovaj kod će biti ubačen umesto {"{{voucherCode}}"} taga u porukama.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj pravilo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statsRuleId} onOpenChange={(open) => !open && setStatsRuleId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Statistika automatizacije</DialogTitle>
            <DialogDescription>Pregled uspešnosti ovog pravila — {periodDescriptionLabels[statsPeriod]}.</DialogDescription>
          </DialogHeader>
          {isStatsLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : statsData ? (
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="bg-muted/30 p-4 rounded-lg text-center">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Ukupno pokretanja</p>
                <p className="text-2xl font-bold mt-1">{statsData.totalRuns}</p>
              </div>
              <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg text-center">
                <p className="text-xs text-primary uppercase font-semibold">Prihodovani termini</p>
                <p className="text-2xl font-bold mt-1 text-primary">{statsData.attributedAppointments}</p>
                <p className="text-sm font-semibold text-emerald-800 mt-1" data-testid="stats-attributed-revenue">
                  {(statsData.attributedRevenue ?? 0).toLocaleString("sr-RS")} RSD prihoda
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">Bez otkazanih termina</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg text-center col-span-2 sm:col-span-1">
                <p className="text-xs text-emerald-700 uppercase font-semibold flex items-center justify-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uspešno poslato</p>
                <p className="text-2xl font-bold mt-1 text-emerald-900">{statsData.sentCount}</p>
              </div>
              <div className="bg-red-50 border border-red-100 p-4 rounded-lg text-center col-span-2 sm:col-span-1">
                <p className="text-xs text-red-700 uppercase font-semibold flex items-center justify-center gap-1"><XCircle className="w-3 h-3" /> Neuspešno (Greške)</p>
                <p className="text-2xl font-bold mt-1 text-red-900">{statsData.failedCount}</p>
              </div>
              <div className="col-span-2 space-y-3">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Isporuka poruka (podaci provajdera)</p>
                {statsData.emailSentCount === 0 && statsData.smsSentCount === 0 ? (
                  <p className="text-sm text-muted-foreground">Podaci o isporuci se prikazuju nakon prvog slanja.</p>
                ) : (
                  <div className="space-y-2">
                    {statsData.emailSentCount > 0 && (
                      <DeliveryFunnel
                        icon={<Mail className="w-4 h-4" />}
                        label="Email"
                        sent={statsData.emailSentCount}
                        delivered={statsData.emailDeliveredCount}
                        opened={statsData.emailOpenedCount}
                        failed={statsData.emailFailedCount}
                      />
                    )}
                    {statsData.smsSentCount > 0 && (
                      <DeliveryFunnel
                        icon={<MessageSquare className="w-4 h-4" />}
                        label="SMS"
                        sent={statsData.smsSentCount}
                        delivered={statsData.smsDeliveredCount}
                        opened={null}
                        failed={statsData.smsFailedCount}
                        noOpensNote="Provajder ne prati otvaranja SMS poruka."
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="col-span-2 space-y-3">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Termini ostvareni ovom kampanjom</p>
                {isAttributedLoading ? (
                  <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                ) : !attributedAppointments || attributedAppointments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Još uvek nema termina pripisanih ovoj kampanji.</p>
                ) : (
                  <div className="border rounded-lg divide-y max-h-56 overflow-y-auto" data-testid="attributed-appointments-list">
                    {attributedAppointments.map((appt) => (
                      <div key={appt.appointmentId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`attributed-appointment-${appt.appointmentId}`}>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{appt.serviceName}</p>
                          <p className="text-xs text-muted-foreground">{new Date(appt.date).toLocaleDateString("sr-RS")}</p>
                        </div>
                        <span className="font-semibold text-emerald-800 whitespace-nowrap">{appt.price.toLocaleString("sr-RS")} RSD</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-span-2 text-center mt-2 text-sm text-muted-foreground">
                <p>Preskočeno (npr. nema kontakt podataka): {statsData.skippedCount}</p>
                <p className="mt-1">Poslednje pokretanje: {statsData.lastRunAt ? new Date(statsData.lastRunAt).toLocaleString("sr-RS") : "Nikad"}</p>
              </div>
            </div>
          ) : (
            <p className="p-4 text-center text-muted-foreground">Podaci nisu dostupni.</p>
          )}
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
