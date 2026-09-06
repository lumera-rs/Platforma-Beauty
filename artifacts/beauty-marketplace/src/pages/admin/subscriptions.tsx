import { useState } from "react";
import { Link } from "wouter";
import { AdminLayout } from "./layout";
import {
  useAdminListSubscriptionPlans,
  useAdminCreateSubscriptionPlan,
  useAdminUpdateSubscriptionPlan,
  useAdminDeleteSubscriptionPlan,
  getAdminListSubscriptionPlansQueryKey,
  useListAdminEducationSubscriptionPlans,
  getListAdminEducationSubscriptionPlansQueryKey,
  useCreateAdminEducationSubscriptionPlan,
  useUpdateAdminEducationSubscriptionPlan,
  useArchiveAdminEducationSubscriptionPlan,
  useListAdminEducationCustomPlanRequests,
  getListAdminEducationCustomPlanRequestsQueryKey,
  useRejectAdminEducationCustomPlanRequest,
  useGetCurrentUser
} from "@workspace/api-client-react";
import type { SubscriptionPlan, SubscriptionPlanInput, EducationSubscriptionPlanInput, EducationSubscriptionPlan } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit2, Trash2, CreditCard, Check, X, Building2, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

export default function AdminSubscriptions() {
  const { data: currentUserResponse } = useGetCurrentUser();
  const canManagePlans = currentUserResponse?.user?.role === "SUPER_ADMIN";

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-serif font-bold text-foreground">Pretplatnički Planovi</h1>
          <p className="text-muted-foreground text-sm">
            {canManagePlans
              ? "Upravljajte SaaS paketima za salone i edukativne centre."
              : "Pregled SaaS paketa. Izmene su dostupne samo super administratorima."}
          </p>
        </div>

        <Tabs defaultValue="salon" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-2xl">
            <TabsTrigger value="salon">Saloni</TabsTrigger>
            <TabsTrigger value="education">Edukativni Centri</TabsTrigger>
            <TabsTrigger value="requests">Zahtevi za ugovor</TabsTrigger>
          </TabsList>

          <TabsContent value="salon" className="pt-6">
            <SalonPlansTab canManagePlans={canManagePlans} />
          </TabsContent>

          <TabsContent value="education" className="pt-6">
            <EducationPlansTab canManagePlans={canManagePlans} />
          </TabsContent>

          <TabsContent value="requests" className="pt-6">
            <EducationRequestsTab canManagePlans={canManagePlans} />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

function SalonPlansTab({ canManagePlans }: { canManagePlans: boolean }) {
  const { data: plans, isLoading, error } = useAdminListSubscriptionPlans();
  const createPlan = useAdminCreateSubscriptionPlan();
  const updatePlan = useAdminUpdateSubscriptionPlan();
  const deletePlan = useAdminDeleteSubscriptionPlan();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [formData, setFormData] = useState<SubscriptionPlanInput>({
    name: "", price: 0, trialDays: 14, features: [], limits: { employees: 1, services: 10 }, active: true
  });
  const [rawNums, setRawNums] = useState({ price: "0", trialDays: "14", employees: "1", services: "10" });
  const [featureInput, setFeatureInput] = useState("");

  const handleOpenNew = () => {
    if (!canManagePlans) return;
    setEditingPlan(null);
    setFormData({ name: "", price: 0, trialDays: 14, features: [], limits: { employees: 1, services: 10 }, active: true });
    setRawNums({ price: "0", trialDays: "14", employees: "1", services: "10" });
    setFeatureInput("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (plan: SubscriptionPlan) => {
    if (!canManagePlans) return;
    setEditingPlan(plan);
    setFormData({ name: plan.name, price: plan.price, trialDays: plan.trialDays, features: plan.features || [], limits: plan.limits || {}, active: plan.active });
    setRawNums({ price: String(plan.price), trialDays: String(plan.trialDays), employees: String(plan.limits?.employees ?? 1), services: String(plan.limits?.services ?? 10) });
    setFeatureInput("");
    setIsModalOpen(true);
  };

  const handleAddFeature = () => {
    if (!featureInput.trim()) return;
    setFormData(prev => ({ ...prev, features: [...(prev.features || []), featureInput.trim()] }));
    setFeatureInput("");
  };

  const handleRemoveFeature = (idx: number) => {
    setFormData(prev => ({ ...prev, features: (prev.features || []).filter((_, i) => i !== idx) }));
  };

  const handleSave = () => {
    if (!canManagePlans || createPlan.isPending || updatePlan.isPending) return;
    if (!formData.name?.trim()) { toast.error("Ime je obavezno."); return; }

    const priceParsed = parseStrictInt(rawNums.price, { label: "Cena", allowNegative: false, allowZero: true });
    if (!priceParsed.ok) { toast.error(priceParsed.message); return; }
    const trialParsed = parseStrictInt(rawNums.trialDays, { label: "Probni period", allowNegative: false, allowZero: true });
    if (!trialParsed.ok) { toast.error(trialParsed.message); return; }
    const empParsed = parseStrictInt(rawNums.employees, { label: "Zaposleni", allowNegative: true, allowZero: true, min: -1 });
    if (!empParsed.ok) { toast.error(empParsed.message); return; }
    const srvParsed = parseStrictInt(rawNums.services, { label: "Usluge", allowNegative: true, allowZero: true, min: -1 });
    if (!srvParsed.ok) { toast.error(srvParsed.message); return; }

    const payload: SubscriptionPlanInput = {
      ...formData, price: priceParsed.value, trialDays: trialParsed.value, limits: { ...formData.limits, employees: empParsed.value, services: srvParsed.value },
    };
    if (!actionGuard.begin("save-salon")) return;

    const onSuccess = () => {
      toast.success("Sačuvano");
      queryClient.invalidateQueries({ queryKey: getAdminListSubscriptionPlansQueryKey() });
      setIsModalOpen(false);
      actionGuard.end("save-salon");
    };
    const onError = (err: unknown) => {
      toast.error(extractApiError(err, "Greška"));
      actionGuard.end("save-salon");
    };

    if (editingPlan) updatePlan.mutate({ planId: editingPlan.id, data: payload }, { onSuccess, onError });
    else createPlan.mutate({ data: payload }, { onSuccess, onError });
  };

  const handleDelete = (id: string) => {
    if (!canManagePlans) return;
    const actionKey = `delete:${id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm("Da li ste sigurni da želite obrisati ovaj plan?")) { actionGuard.end(actionKey); return; }
    deletePlan.mutate({ planId: id }, {
      onSuccess: () => { toast.success("Obrisano"); queryClient.invalidateQueries({ queryKey: getAdminListSubscriptionPlansQueryKey() }); actionGuard.end(actionKey); },
      onError: () => { toast.error("Greška"); actionGuard.end(actionKey); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleOpenNew} disabled={!canManagePlans} className="gap-2"><Plus className="w-4 h-4" /> Novi Salon Plan</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? <div className="col-span-full flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
        : error ? <div className="col-span-full p-8 text-destructive">Došlo je do greške pri učitavanju.</div>
        : plans?.map(plan => (
          <div key={plan.id} className={`flex flex-col bg-card border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow relative ${!plan.active ? 'opacity-70 grayscale-[0.3]' : ''}`}>
            {!plan.active && <div className="absolute top-4 right-4 bg-muted text-xs font-bold px-2 py-1 rounded-md z-10">Neaktivno</div>}
            <div className="p-6 bg-muted/20 border-b">
              <h3 className="font-serif font-bold text-xl">{plan.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold">{plan.price === 0 ? "Besplatno" : plan.price.toLocaleString()}</span>
                {plan.price > 0 && <span className="text-muted-foreground font-medium"> RSD/mes</span>}
              </div>
              {plan.trialDays > 0 && <p className="text-sm text-primary mt-2 font-medium">{plan.trialDays} dana besplatno</p>}
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <div className="space-y-4 flex-1 mb-6">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Resursi</p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between border-b pb-1"><span className="text-muted-foreground">Zaposleni:</span><span className="font-semibold">{plan.limits?.employees === -1 ? 'Neograničeno' : plan.limits?.employees}</span></li>
                    <li className="flex justify-between border-b pb-1"><span className="text-muted-foreground">Usluge:</span><span className="font-semibold">{plan.limits?.services === -1 ? 'Neograničeno' : plan.limits?.services}</span></li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Mogućnosti</p>
                  <ul className="space-y-2 text-sm">
                    {(plan.features || []).map((feat, i) => <li key={i} className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /><span>{feat}</span></li>)}
                  </ul>
                </div>
              </div>
              <div className="flex gap-2 mt-auto">
                <Button variant="outline" className="flex-1 bg-background" onClick={() => handleOpenEdit(plan)} disabled={!canManagePlans} data-testid={`btn-edit-${plan.id}`}><Edit2 className="w-4 h-4 mr-2" /> Izmeni</Button>
                <Button variant="outline" size="icon" className="shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground border-border" onClick={() => handleDelete(plan.id)} disabled={!canManagePlans || actionGuard.isActive(`delete:${plan.id}`)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={canManagePlans && isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editingPlan ? "Izmeni Plan" : "Novi Plan"}</DialogTitle></DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="space-y-2"><Label>Naziv</Label><Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label htmlFor="salon-plan-price">Cena (RSD/mes)</Label><Input id="salon-plan-price" type="number" value={rawNums.price} onChange={e => setRawNums({ ...rawNums, price: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="salon-plan-trial-days">Probni period (dana)</Label><Input id="salon-plan-trial-days" type="number" value={rawNums.trialDays} onChange={e => setRawNums({ ...rawNums, trialDays: e.target.value })} /></div>
            </div>
            <div className="space-y-4 border p-4 bg-muted/10 rounded-xl">
              <h4 className="text-sm font-medium">Ograničenja (-1 za neograničeno)</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Zaposleni</Label><Input type="number" value={rawNums.employees} onChange={e => setRawNums({ ...rawNums, employees: e.target.value })} /></div>
                <div className="space-y-2"><Label>Usluge</Label><Input type="number" value={rawNums.services} onChange={e => setRawNums({ ...rawNums, services: e.target.value })} /></div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mogućnosti (features)</Label>
              <div className="flex gap-2">
                <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddFeature())} />
                <Button type="button" variant="secondary" onClick={handleAddFeature}>Dodaj</Button>
              </div>
              <ul className="mt-3 space-y-2">
                {formData.features?.map((f, i) => <li key={i} className="flex justify-between items-center text-sm border rounded-md px-3 py-2"><span className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-500" /> {f}</span><Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleRemoveFeature(i)}><X className="w-4 h-4" /></Button></li>)}
              </ul>
            </div>
            <div className="flex justify-between pt-4 border-t">
              <Label className="cursor-pointer font-bold">Plan aktivan</Label><Switch checked={formData.active} onCheckedChange={c => setFormData({...formData, active: c})} />
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setIsModalOpen(false)}>Odustani</Button><Button onClick={handleSave} disabled={createPlan.isPending || updatePlan.isPending}>Sačuvaj</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EducationPlansTab({ canManagePlans }: { canManagePlans: boolean }) {
  const { data: plans, isLoading, error } = useListAdminEducationSubscriptionPlans();
  const createPlan = useCreateAdminEducationSubscriptionPlan();
  const updatePlan = useUpdateAdminEducationSubscriptionPlan();
  const archivePlan = useArchiveAdminEducationSubscriptionPlan();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<EducationSubscriptionPlan | null>(null);
  const [formData, setFormData] = useState<EducationSubscriptionPlanInput>({
    name: "", price: 0, courseLimit: 10, trialDays: 30, features: [], vatIncluded: true, priceCopy: "Mesečno", active: true
  });
  const [rawNums, setRawNums] = useState({ price: "0", courseLimit: "10" });
  const [featureInput, setFeatureInput] = useState("");

  const handleOpenNew = () => {
    if (!canManagePlans) return;
    setEditingPlan(null);
    setFormData({ name: "", price: 0, courseLimit: 10, trialDays: 30, features: [], vatIncluded: true, priceCopy: "Mesečno", active: true });
    setRawNums({ price: "0", courseLimit: "10" });
    setFeatureInput("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (plan: EducationSubscriptionPlan) => {
    if (!canManagePlans) return;
    setEditingPlan(plan);
    setFormData({ name: plan.name, price: plan.price, courseLimit: plan.courseLimit, trialDays: 30, features: plan.features || [], vatIncluded: plan.vatIncluded, priceCopy: plan.priceCopy, active: plan.active });
    setRawNums({ price: String(plan.price), courseLimit: String(plan.courseLimit) });
    setFeatureInput("");
    setIsModalOpen(true);
  };

  const handleAddFeature = () => {
    if (!featureInput.trim()) return;
    setFormData(prev => ({ ...prev, features: [...(prev.features || []), featureInput.trim()] }));
    setFeatureInput("");
  };

  const handleRemoveFeature = (idx: number) => {
    setFormData(prev => ({ ...prev, features: (prev.features || []).filter((_, i) => i !== idx) }));
  };

  const handleSave = () => {
    if (!canManagePlans || createPlan.isPending || updatePlan.isPending) return;
    if (!formData.name?.trim()) { toast.error("Ime je obavezno."); return; }

    const priceParsed = parseStrictInt(rawNums.price, { label: "Cena", allowNegative: false, allowZero: false, min: 1 });
    if (!priceParsed.ok) { toast.error(priceParsed.message); return; }
    const limitParsed = parseStrictInt(rawNums.courseLimit, { label: "Kursevi", allowNegative: false, allowZero: false, min: 1 });
    if (!limitParsed.ok) { toast.error(limitParsed.message); return; }

    const payload: EducationSubscriptionPlanInput = {
      ...formData, price: priceParsed.value, courseLimit: limitParsed.value, trialDays: 30,
    };

    if (!actionGuard.begin("save-edu")) return;

    const onSuccess = () => {
      toast.success("Sačuvano");
      queryClient.invalidateQueries({ queryKey: getListAdminEducationSubscriptionPlansQueryKey() });
      setIsModalOpen(false);
      actionGuard.end("save-edu");
    };
    const onError = (err: unknown) => {
      toast.error(extractApiError(err, "Greška"));
      actionGuard.end("save-edu");
    };

    if (editingPlan) updatePlan.mutate({ planId: editingPlan.id, data: payload }, { onSuccess, onError });
    else createPlan.mutate({ data: payload }, { onSuccess, onError });
  };

  const handleArchive = (id: string) => {
    if (!canManagePlans) return;
    const actionKey = `archive:${id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm("Da li ste sigurni da želite arhivirati ovaj plan? Stari ugovori ostaju.")) { actionGuard.end(actionKey); return; }
    archivePlan.mutate({ planId: id }, {
      onSuccess: () => { toast.success("Arhivirano"); queryClient.invalidateQueries({ queryKey: getListAdminEducationSubscriptionPlansQueryKey() }); actionGuard.end(actionKey); },
      onError: () => { toast.error("Greška"); actionGuard.end(actionKey); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleOpenNew} disabled={!canManagePlans} className="gap-2"><Plus className="w-4 h-4" /> Novi Edukativni Plan</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? <div className="col-span-full flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
        : error ? <div className="col-span-full p-8 text-destructive">Došlo je do greške pri učitavanju.</div>
        : plans?.map(plan => (
          <div key={plan.id} className={`flex flex-col bg-card border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow relative ${!plan.active ? 'opacity-70 grayscale-[0.3]' : ''}`}>
            {!plan.active && <div className="absolute top-4 right-4 bg-muted text-xs font-bold px-2 py-1 rounded-md z-10">Neaktivno</div>}
            <div className="p-6 bg-muted/20 border-b">
              <h3 className="font-serif font-bold text-xl">{plan.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold">{plan.price === 0 ? "Besplatno" : plan.price.toLocaleString()}</span>
                {plan.price > 0 && <span className="text-muted-foreground font-medium"> RSD/mes</span>}
              </div>
              <p className="text-xs text-muted-foreground mb-2">{plan.vatIncluded ? "PDV uključen" : "PDV nije uključen"}</p>
              <p className="text-sm text-primary font-medium">{plan.trialDays} dana besplatno</p>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <div className="space-y-4 flex-1 mb-6">
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Ograničenja</p>
                  <ul className="space-y-2 text-sm">
                    <li className="flex justify-between border-b pb-1"><span className="text-muted-foreground">Maksimalno kurseva:</span><span className="font-semibold">{plan.courseLimit}</span></li>
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Mogućnosti</p>
                  <ul className="space-y-2 text-sm">
                    {(plan.features || []).map((feat, i) => <li key={i} className="flex items-start gap-2"><Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /><span>{feat}</span></li>)}
                  </ul>
                </div>
              </div>
              <div className="flex gap-2 mt-auto">
                <Button variant="outline" className="flex-1 bg-background" onClick={() => handleOpenEdit(plan)} disabled={!canManagePlans}><Edit2 className="w-4 h-4 mr-2" /> Izmeni</Button>
                <Button variant="outline" size="icon" className="shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground border-border" onClick={() => handleArchive(plan.id)} disabled={!canManagePlans || actionGuard.isActive(`archive:${plan.id}`)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={canManagePlans && isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editingPlan ? "Izmeni Edukativni Plan" : "Novi Edukativni Plan"}</DialogTitle></DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="space-y-2"><Label>Naziv</Label><Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Cena (RSD/mes)</Label><Input type="number" value={rawNums.price} onChange={e => setRawNums({ ...rawNums, price: e.target.value })} /></div>
              <div className="space-y-2"><Label>Maksimalno kurseva</Label><Input type="number" min="1" value={rawNums.courseLimit} onChange={e => setRawNums({ ...rawNums, courseLimit: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Opis (ispod cene)</Label><Input value={formData.priceCopy} onChange={e => setFormData({...formData, priceCopy: e.target.value})} placeholder="Mesečno" /></div>
              <div className="flex items-center gap-2 pt-8"><Switch checked={formData.vatIncluded} onCheckedChange={c => setFormData({...formData, vatIncluded: c})} /><Label>PDV Uključen</Label></div>
            </div>

            <div className="space-y-2">
              <Label>Mogućnosti (features)</Label>
              <div className="flex gap-2">
                <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddFeature())} />
                <Button type="button" variant="secondary" onClick={handleAddFeature}>Dodaj</Button>
              </div>
              <ul className="mt-3 space-y-2">
                {formData.features?.map((f, i) => <li key={i} className="flex justify-between items-center text-sm border rounded-md px-3 py-2"><span className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-500" /> {f}</span><Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleRemoveFeature(i)}><X className="w-4 h-4" /></Button></li>)}
              </ul>
            </div>
            <div className="flex justify-between pt-4 border-t">
              <Label className="cursor-pointer font-bold">Plan aktivan</Label><Switch checked={formData.active} onCheckedChange={c => setFormData({...formData, active: c})} />
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setIsModalOpen(false)}>Odustani</Button><Button onClick={handleSave} disabled={createPlan.isPending || updatePlan.isPending}>Sačuvaj</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EducationRequestsTab({ canManagePlans }: { canManagePlans: boolean }) {
  const { data: requests, isLoading } = useListAdminEducationCustomPlanRequests();
  const rejectMut = useRejectAdminEducationCustomPlanRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();

  const handleReject = (id: string) => {
    const reason = window.prompt("Razlog odbijanja:");
    if (!reason || reason.trim().length < 3) return;
    if (!actionGuard.begin(`reject:${id}`)) return;
    rejectMut.mutate({ requestId: id, data: { status: "rejected", reason } }, {
      onSuccess: () => { toast.success("Odbijeno"); queryClient.invalidateQueries({ queryKey: getListAdminEducationCustomPlanRequestsQueryKey() }); actionGuard.end(`reject:${id}`); },
      onError: () => { toast.error("Greška"); actionGuard.end(`reject:${id}`); }
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-2xl overflow-hidden">
        {isLoading ? <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
        : !requests || requests.filter(r => r.status === "pending").length === 0 ? <div className="p-12 text-center text-muted-foreground">Nema otvorenih zahteva.</div>
        : (
          <div className="divide-y divide-border">
            {requests.filter(r => r.status === "pending").map(req => (
              <div key={req.id} className="p-6 flex flex-col md:flex-row gap-6 justify-between items-start md:items-center hover:bg-muted/10">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="w-5 h-5 text-primary" />
                    <span className="font-medium text-lg">Novi zahtev (Centar ID: {req.centerId.slice(0, 8)}...)</span>
                  </div>
                  <p className="text-sm text-foreground/80 mb-1 font-medium">Traženi limit kurseva: {req.requestedCourseLimit}</p>
                  <p className="text-sm text-muted-foreground italic bg-muted/30 p-3 rounded-md mt-2">"{req.message}"</p>
                </div>
                <div className="flex gap-3 shrink-0">
                  <Button variant="outline" className="text-destructive hover:bg-destructive hover:text-destructive-foreground" onClick={() => handleReject(req.id)} disabled={!canManagePlans || actionGuard.isActive(`reject:${req.id}`)}>
                    <XCircle className="w-4 h-4 mr-2" /> Odbij
                  </Button>
                  <Button asChild disabled={!canManagePlans}>
                    <Link href={`/admin/edukacije/centri/${req.centerId}?requestId=${req.id}&limit=${req.requestedCourseLimit}`}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Ugovori plan
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
