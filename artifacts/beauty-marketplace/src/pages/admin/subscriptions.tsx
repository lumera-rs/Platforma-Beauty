import { useState } from "react";
import { AdminLayout } from "./layout";
import { 
  useAdminListSubscriptionPlans, 
  useAdminCreateSubscriptionPlan, 
  useAdminUpdateSubscriptionPlan, 
  useAdminDeleteSubscriptionPlan,
  getAdminListSubscriptionPlansQueryKey,
  useGetCurrentUser
} from "@workspace/api-client-react";
import type { SubscriptionPlan, SubscriptionPlanInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Edit2, Trash2, CreditCard, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { extractApiError, parseStrictInt } from "@/lib/admin-form-utils";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

export default function AdminSubscriptions() {
  const { data: plans, isLoading, error } = useAdminListSubscriptionPlans();
  const createPlan = useAdminCreateSubscriptionPlan();
  const updatePlan = useAdminUpdateSubscriptionPlan();
  const deletePlan = useAdminDeleteSubscriptionPlan();
  const { data: currentUserResponse } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const actionGuard = useImmediateActionGuard();
  const canManagePlans = currentUserResponse?.user?.role === "SUPER_ADMIN";
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [formData, setFormData] = useState<SubscriptionPlanInput>({
    name: "",
    price: 0,
    trialDays: 14,
    features: [],
    limits: { employees: 1, services: 10 },
    active: true
  });
  // Raw string state so number inputs aren't clobbered while typing
  const [rawNums, setRawNums] = useState({ price: "0", trialDays: "14", employees: "1", services: "10" });
  const [featureInput, setFeatureInput] = useState("");

  const handleOpenNew = () => {
    if (!canManagePlans) return;
    setEditingPlan(null);
    setFormData({
      name: "", price: 0, trialDays: 14, features: [], limits: { employees: 1, services: 10 }, active: true
    });
    setRawNums({ price: "0", trialDays: "14", employees: "1", services: "10" });
    setFeatureInput("");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (plan: SubscriptionPlan) => {
    if (!canManagePlans) return;
    setEditingPlan(plan);
    setFormData({
      name: plan.name, price: plan.price, trialDays: plan.trialDays,
      features: plan.features || [], limits: plan.limits || {}, active: plan.active
    });
    setRawNums({
      price: String(plan.price),
      trialDays: String(plan.trialDays),
      employees: String(plan.limits?.employees ?? 1),
      services: String(plan.limits?.services ?? 10),
    });
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
    if (!canManagePlans) return;
    if (createPlan.isPending || updatePlan.isPending) return;
    if (!formData.name?.trim()) {
      toast.error("Greška", { description: "Ime je obavezno." });
      return;
    }
    const priceParsed = parseStrictInt(rawNums.price, { label: "Cena", allowNegative: false, allowZero: true });
    if (!priceParsed.ok) { toast.error("Greška", { description: priceParsed.message }); return; }
    const trialParsed = parseStrictInt(rawNums.trialDays, { label: "Probni period", allowNegative: false, allowZero: true });
    if (!trialParsed.ok) { toast.error("Greška", { description: trialParsed.message }); return; }
    // Limits allow -1 for unlimited
    const empParsed = parseStrictInt(rawNums.employees, { label: "Zaposleni", allowNegative: true, allowZero: true, min: -1 });
    if (!empParsed.ok) { toast.error("Greška", { description: empParsed.message }); return; }
    const srvParsed = parseStrictInt(rawNums.services, { label: "Usluge", allowNegative: true, allowZero: true, min: -1 });
    if (!srvParsed.ok) { toast.error("Greška", { description: srvParsed.message }); return; }

    const payload: SubscriptionPlanInput = {
      ...formData,
      price: priceParsed.value,
      trialDays: trialParsed.value,
      limits: { ...(formData.limits || {}), employees: empParsed.value, services: srvParsed.value },
    };
    if (!actionGuard.begin("save")) return;

    if (editingPlan) {
      updatePlan.mutate({ planId: editingPlan.id, data: payload }, {
        onSuccess: () => {
          toast.success("Sačuvano", { description: "Pretplatnički plan je ažuriran." });
          queryClient.invalidateQueries({ queryKey: getAdminListSubscriptionPlansQueryKey() });
          setIsModalOpen(false);
          actionGuard.end("save");
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Pretplatnički plan nije sačuvan.") });
          actionGuard.end("save");
        },
      });
    } else {
      createPlan.mutate({ data: payload }, {
        onSuccess: () => {
          toast.success("Kreirano", { description: "Novi plan je uspešno kreiran." });
          queryClient.invalidateQueries({ queryKey: getAdminListSubscriptionPlansQueryKey() });
          setIsModalOpen(false);
          actionGuard.end("save");
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Pretplatnički plan nije kreiran.") });
          actionGuard.end("save");
        },
      });
    }
  };

  const handleDelete = (id: string) => {
    if (!canManagePlans) return;
    const actionKey = `delete:${id}`;
    if (!actionGuard.begin(actionKey)) return;
    if (!window.confirm("Da li ste sigurni da želite obrisati ovaj plan? Saloni na ovom planu će izgubiti pristup.")) {
      actionGuard.end(actionKey);
      return;
    }
    
    deletePlan.mutate({ planId: id }, {
      onSuccess: () => {
        toast.success("Obrisano", { description: "Plan je uklonjen." });
        queryClient.invalidateQueries({ queryKey: getAdminListSubscriptionPlansQueryKey() });
        actionGuard.end(actionKey);
      },
      onError: () => {
        toast.error("Greška", { description: "Pretplatnički plan nije uklonjen." });
        actionGuard.end(actionKey);
      },
    });
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Pretplatnički Planovi</h1>
            <p className="text-muted-foreground text-sm">
              {canManagePlans
                ? "SaaS paketi za salone i edukativne centre."
                : "Pregled SaaS paketa. Izmene su dostupne samo super administratorima."}
            </p>
          </div>
          <Button onClick={handleOpenNew} disabled={!canManagePlans} className="shrink-0 gap-2" data-testid="btn-new-plan">
            <Plus className="w-4 h-4" /> Novi Plan
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : error ? (
            <div className="col-span-full p-8 text-center text-destructive">Došlo je do greške pri učitavanju planova.</div>
          ) : !plans || plans.length === 0 ? (
            <div className="col-span-full p-12 flex flex-col items-center justify-center bg-card rounded-xl border border-dashed border-border text-muted-foreground">
              <CreditCard className="w-12 h-12 mb-4 opacity-20" />
              <p>Nema definisanih pretplatničkih planova.</p>
              <Button variant="outline" className="mt-4" onClick={handleOpenNew} disabled={!canManagePlans}>Kreiraj prvi plan</Button>
            </div>
          ) : (
            plans.sort((a,b) => a.price - b.price).map(plan => (
              <div key={plan.id} className={`flex flex-col bg-card border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow relative ${!plan.active ? 'opacity-70 grayscale-[0.3]' : ''}`} data-testid={`plan-card-${plan.id}`}>
                {!plan.active && (
                  <div className="absolute top-4 right-4 bg-muted text-muted-foreground text-xs font-bold px-2 py-1 rounded-md z-10">
                    Neaktivno
                  </div>
                )}
                
                <div className="p-6 bg-muted/20 border-b">
                  <h3 className="font-serif font-bold text-xl text-foreground">{plan.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1 text-foreground">
                    <span className="text-3xl font-extrabold tracking-tight">{plan.price === 0 ? "Besplatno" : `${plan.price.toLocaleString()}`}</span>
                    {plan.price > 0 && <span className="text-muted-foreground font-medium"> RSD/mes</span>}
                  </div>
                  {plan.trialDays > 0 && <p className="text-sm text-primary mt-2 font-medium">{plan.trialDays} dana besplatno</p>}
                </div>
                
                <div className="p-6 flex-1 flex flex-col">
                  <div className="space-y-4 flex-1 mb-6">
                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Ograničenja resursa</p>
                      <ul className="space-y-2 text-sm">
                        <li className="flex justify-between border-b pb-1 border-border/50">
                          <span className="text-muted-foreground">Zaposleni:</span>
                          <span className="font-semibold">{plan.limits?.employees === -1 ? 'Neograničeno' : plan.limits?.employees || 0}</span>
                        </li>
                        <li className="flex justify-between border-b pb-1 border-border/50">
                          <span className="text-muted-foreground">Usluge:</span>
                          <span className="font-semibold">{plan.limits?.services === -1 ? 'Neograničeno' : plan.limits?.services || 0}</span>
                        </li>
                      </ul>
                    </div>

                    <div>
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Mogućnosti</p>
                      <ul className="space-y-2 text-sm">
                        {(plan.features || []).map((feat, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                            <span className="text-foreground/90">{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-auto">
                    <Button variant="outline" className="flex-1 bg-background hover:bg-muted" onClick={() => handleOpenEdit(plan)} disabled={!canManagePlans} data-testid={`btn-edit-${plan.id}`}>
                      <Edit2 className="w-4 h-4 mr-2" /> Izmeni
                    </Button>
                    <Button variant="outline" size="icon" className="shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground border-border" onClick={() => handleDelete(plan.id)} disabled={!canManagePlans || actionGuard.isActive(`delete:${plan.id}`)} data-testid={`btn-delete-${plan.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog open={canManagePlans && isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Izmeni Plan" : "Novi Pretplatnički Plan"}</DialogTitle>
            <DialogDescription>
              Kreirajte paket usluga sa cenom i ograničenjima. Koristite -1 za neograničene resurse.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Naziv Plana</Label>
              <Input id="name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="npr. Pro Paket" />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Cena (RSD mesečno)</Label>
                <Input id="price" type="number" min="0" value={rawNums.price} onChange={e => setRawNums({ ...rawNums, price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="trial">Probni period (dana)</Label>
                <Input id="trial" type="number" min="0" value={rawNums.trialDays} onChange={e => setRawNums({ ...rawNums, trialDays: e.target.value })} />
              </div>
            </div>

            <div className="space-y-4 border rounded-xl p-4 bg-muted/10">
              <h4 className="text-sm font-medium border-b pb-2">Ograničenja (-1 za neograničeno)</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lim_emp" className="text-xs">Maksimalno zaposlenih</Label>
                  <Input id="lim_emp" type="number" value={rawNums.employees} onChange={e => setRawNums({ ...rawNums, employees: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lim_srv" className="text-xs">Maksimalno usluga</Label>
                  <Input id="lim_srv" type="number" value={rawNums.services} onChange={e => setRawNums({ ...rawNums, services: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Mogućnosti (features)</Label>
              <div className="flex gap-2">
                <Input value={featureInput} onChange={e => setFeatureInput(e.target.value)} placeholder="Dodaj mogućnost..." onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddFeature())} />
                <Button type="button" variant="secondary" onClick={handleAddFeature}>Dodaj</Button>
              </div>
              {formData.features && formData.features.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {formData.features.map((f, i) => (
                    <li key={i} className="flex justify-between items-center text-sm bg-card border rounded-md px-3 py-2">
                      <span className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-500" /> {f}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveFeature(i)}><X className="w-4 h-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t">
              <Label htmlFor="activePlan" className="cursor-pointer font-bold">Plan je dostupan za kupovinu</Label>
              <Switch id="activePlan" checked={formData.active} onCheckedChange={c => setFormData({...formData, active: c})} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={!canManagePlans || createPlan.isPending || updatePlan.isPending || actionGuard.isActive("save")}>
              {(createPlan.isPending || updatePlan.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
