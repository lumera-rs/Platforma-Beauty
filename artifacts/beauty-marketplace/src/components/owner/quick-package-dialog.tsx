import { useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useOwnerQuickCreatePackagePurchase, type Service, type QuickPackagePurchaseResult } from "@workspace/api-client-react";
import { ServiceQuotaSelector } from "@/components/ui/service-quota-selector";
import { useToast } from "@/hooks/use-toast";

interface QuickPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextId: string;
  customerId: string;
  services: Service[];
  onSuccess: (result: QuickPackagePurchaseResult, contextId: string) => void;
}

export function QuickPackageDialog({ open, onOpenChange, contextId, customerId, services, onSuccess }: QuickPackageDialogProps) {
  const { toast } = useToast();
  const createMutation = useOwnerQuickCreatePackagePurchase();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    priceInDinars: 0,
    validityDays: 180,
    serviceQuotas: {} as Record<string, number>,
    paymentStatus: "active" as "active" | "pending_payment",
    paymentMethod: "pay_at_salon" as "pay_at_salon" | "bank_transfer",
    notes: ""
  });

  const reset = () => {
    setFormData({
      name: "",
      description: "",
      priceInDinars: 0,
      validityDays: 180,
      serviceQuotas: {},
      paymentStatus: "active",
      paymentMethod: "pay_at_salon",
      notes: ""
    });
  };

  const serviceQuotas = useMemo(
    () => Object.entries(formData.serviceQuotas).map(([serviceId, quota]) => ({ serviceId, quota })),
    [formData.serviceQuotas],
  );
  const totalSessions = useMemo(
    () => serviceQuotas.reduce((total, item) => total + item.quota, 0),
    [serviceQuotas],
  );
  const validationError = useMemo(() => {
    if (!formData.name.trim()) return "Unesite naziv paketa.";
    if (!Number.isInteger(formData.priceInDinars) || formData.priceInDinars < 0) return "Cena mora biti nula ili veća.";
    if (!Number.isInteger(formData.validityDays) || formData.validityDays < 1 || formData.validityDays > 3650) return "Važenje mora biti između 1 i 3650 dana.";
    if (serviceQuotas.length === 0) return "Izaberite najmanje jednu uslugu.";
    if (serviceQuotas.some(({ quota }) => !Number.isInteger(quota) || quota < 1 || quota > 100)) return "Kvota za svaku uslugu mora biti između 1 i 100.";
    return null;
  }, [formData.name, formData.priceInDinars, formData.validityDays, serviceQuotas]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!customerId || customerId === "new") {
      toast.error("Klijent mora biti izabran iz baze.");
      return;
    }
    if (validationError) {
      toast.error(validationError);
      return;
    }

    createMutation.mutate({
      data: {
        salonCustomerId: customerId,
        name: formData.name.trim(),
        description: formData.description || undefined,
        priceInDinars: Number(formData.priceInDinars),
        validityDays: Number(formData.validityDays),
        serviceQuotas,
        paymentStatus: formData.paymentStatus,
        paymentMethod: formData.paymentMethod,
        notes: formData.notes || undefined
      }
    }, {
      onSuccess: (result) => {
        onSuccess(result, contextId);
        reset();
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error("Nije moguće sačuvati paket", { description: err instanceof Error ? err.message : "Pokušajte ponovo." });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val) reset(); onOpenChange(val); }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] min-w-0 max-w-xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-5 pt-5 sm:px-6 sm:pt-6">
          <DialogTitle>Brzi unos paketa</DialogTitle>
          <DialogDescription>Kreirajte i dodelite paket postojećem klijentu</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-5 py-4 sm:px-6">
            <div className="space-y-2">
            <Label>Naziv paketa</Label>
            <Input required data-testid="quick-package-name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Npr. 5 maderoterapija + 5 limfnih masaža" />
            </div>
            <div className="space-y-2">
              <Label>Opis (opciono)</Label>
              <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Kratak opis paketa" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cena (RSD)</Label>
              <Input required data-testid="quick-package-price" type="number" min="0" step="1" value={formData.priceInDinars} onChange={e => setFormData({ ...formData, priceInDinars: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label>Važenje (dana)</Label>
              <Input required type="number" min="1" max="3650" step="1" value={formData.validityDays} onChange={e => setFormData({ ...formData, validityDays: Number(e.target.value) })} />
            </div>
            </div>

            <div className="space-y-2 pt-2 border-t">
            <Label>Usluge i broj tretmana</Label>
            <ServiceQuotaSelector
              services={services}
              quotas={formData.serviceQuotas}
              onChange={(quotas) => setFormData({ ...formData, serviceQuotas: quotas })}
              testIdPrefix="quick-package-service"
            />
              <p className="text-sm font-medium">Ukupno tretmana: <strong>{totalSessions}</strong></p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
            <div className="space-y-2">
              <Label htmlFor="quick-package-status">Status plaćanja</Label>
              <select id="quick-package-status" data-testid="quick-package-status" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={formData.paymentStatus} onChange={e => setFormData({ ...formData, paymentStatus: e.target.value as "active" | "pending_payment" })}>
                <option value="active">Plaćeno (Aktivan)</option>
                <option value="pending_payment">Čeka uplatu</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-package-method">Način plaćanja</Label>
              <select id="quick-package-method" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={formData.paymentMethod} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value as "pay_at_salon" | "bank_transfer" })}>
                <option value="pay_at_salon">U salonu</option>
                <option value="bank_transfer">Preko računa</option>
              </select>
            </div>
            </div>
          
            <div className="space-y-2">
            <Label>Napomena (opciono)</Label>
            <Textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
            </div>
            {validationError && <p className="text-sm text-destructive" role="alert">{validationError}</p>}
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t bg-background px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Odustani</Button>
            <Button type="submit" data-testid="quick-package-save" disabled={createMutation.isPending || Boolean(validationError)}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
