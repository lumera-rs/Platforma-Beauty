import { useMemo, useState } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useOwnerListPackages,
  useOwnerCreatePackage,
  useOwnerUpdatePackage,
  useOwnerListCustomerPackages,
  useOwnerConfirmPackagePayment,
  useGetCurrentUser,
  getOwnerListPackagesQueryKey,
  useListSalonServices,
  getListSalonServicesQueryKey,
  type CreateTreatmentPackageBody,
  type PackagePurchase,
  type TreatmentPackage,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Box, Users, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

export default function OwnerPackages() {
  const { data: userResp } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const salonId = userResp?.user?.id; // Note: In a real app we'd get the exact salon ID, but the generated hook handles it via endpoint.

  const { data: packages, isLoading } = useOwnerListPackages({
    query: {
      enabled: !!userResp?.user,
      queryKey: getOwnerListPackagesQueryKey()
    }
  });

  const { data: services } = useListSalonServices({
    query: {
      enabled: !!userResp?.user,
      queryKey: getListSalonServicesQueryKey()
    }
  });

  const { data: customerPackages, isLoading: isCustPackagesLoading } = useOwnerListCustomerPackages(
    
    {},
    {
      query: {
        enabled: !!userResp?.user,
        queryKey: ['owner-customer-packages']
      }
    }
  );

  const createMutation = useOwnerCreatePackage();
  const updateMutation = useOwnerUpdatePackage();
  const confirmPaymentMutation = useOwnerConfirmPackagePayment();

  const [activeTab, setActiveTab] = useState("definitions");
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    priceInDinars: 0,
    validityDays: 180,
    active: true,
    serviceQuotas: {} as Record<string, number>,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      priceInDinars: 0,
      validityDays: 180,
      active: true,
      serviceQuotas: {},
    });
    setCurrentId(null);
  };

  const handleEdit = (pkg: TreatmentPackage) => {
    setFormData({
      name: pkg.name,
      description: pkg.description || "",
      priceInDinars: pkg.priceInDinars,
      validityDays: pkg.validityDays,
      active: pkg.active,
      serviceQuotas: Object.fromEntries(
        pkg.serviceQuotas.map(({ serviceId, quota }) => [serviceId, quota]),
      ),
    });
    setCurrentId(pkg.id);
    setIsEditing(true);
  };

  const serviceQuotas = useMemo(
    () => Object.entries(formData.serviceQuotas).map(([serviceId, quota]) => ({ serviceId, quota: Number(quota) })),
    [formData.serviceQuotas],
  );
  const totalSessions = useMemo(
    () => serviceQuotas.reduce((total, { quota }) => total + quota, 0),
    [serviceQuotas],
  );
  const validationError = useMemo(() => {
    if (!formData.name.trim()) return "Unesite naziv paketa.";
    if (!Number.isFinite(formData.priceInDinars) || formData.priceInDinars < 0) return "Cena mora biti nula ili veća.";
    if (!Number.isInteger(formData.validityDays) || formData.validityDays < 1) return "Važenje mora biti najmanje jedan dan.";
    if (serviceQuotas.length === 0) return "Izaberite najmanje jednu uslugu.";
    if (serviceQuotas.some(({ quota }) => !Number.isInteger(quota) || quota < 1)) return "Kvota za svaku uslugu mora biti pozitivan ceo broj.";
    return null;
  }, [formData.name, formData.priceInDinars, formData.validityDays, serviceQuotas]);

  const handleSave = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const payload: CreateTreatmentPackageBody = {
      name: formData.name,
      description: formData.description,
      priceInDinars: Number(formData.priceInDinars),
      validityDays: Number(formData.validityDays),
      active: formData.active,
      serviceQuotas,
    };

    const callbacks = {
      onSuccess: () => {
        toast.success("Paket sačuvan.");
        setIsEditing(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: getOwnerListPackagesQueryKey() });
      }
    };

    if (currentId) {
      updateMutation.mutate({ packageId: currentId, data: payload }, callbacks);
    } else {
      createMutation.mutate({ data: payload }, callbacks);
    }
  };

  const toggleService = (id: string) => {
    setFormData(prev => ({
      ...prev,
      serviceQuotas: Object.prototype.hasOwnProperty.call(prev.serviceQuotas, id)
        ? Object.fromEntries(Object.entries(prev.serviceQuotas).filter(([serviceId]) => serviceId !== id))
        : { ...prev.serviceQuotas, [id]: 1 },
    }));
  };

  const setServiceQuota = (id: string, quota: number) => {
    setFormData(prev => ({ ...prev, serviceQuotas: { ...prev.serviceQuotas, [id]: quota } }));
  };

  const handleConfirmPayment = (packageId: string, purchaseId: string) => {
    confirmPaymentMutation.mutate({ packageId, purchaseId }, {
      onSuccess: () => {
        toast.success("Uplata potvrđena, paket je aktiviran.");
        queryClient.invalidateQueries({ queryKey: ['owner-customer-packages'] });
      }
    });
  };

  const activeServices = services?.filter(s => s.active) || [];

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/paketi" />
        
        <div className="flex-1 space-y-6 w-full min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Paketi tretmana</h1>
              <p className="text-muted-foreground mt-1">Prodajte vezane usluge unapred po povoljnijoj ceni.</p>
            </div>
            {activeTab === "definitions" && (
              <Button onClick={() => { resetForm(); setIsEditing(true); }}>
                <Plus className="w-4 h-4 mr-2" /> Novi paket
              </Button>
            )}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="definitions" className="flex items-center gap-2"><Box className="w-4 h-4" /> Ponuda paketa</TabsTrigger>
              <TabsTrigger value="purchases" className="flex items-center gap-2"><Users className="w-4 h-4" /> Prodati paketi</TabsTrigger>
            </TabsList>

            <TabsContent value="definitions" className="mt-0 space-y-4">
              {isLoading ? (
                <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : packages?.length === 0 ? (
                <Card>
                  <CardContent className="p-12 text-center text-muted-foreground flex flex-col items-center">
                    <Box className="w-12 h-12 mb-4 opacity-20" />
                    <p>Još niste kreirali nijedan paket tretmana.</p>
                    <Button variant="outline" className="mt-4" onClick={() => { resetForm(); setIsEditing(true); }}>Kreiraj prvi paket</Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {packages?.map((pkg: TreatmentPackage) => (
                    <Card key={pkg.id} className={!pkg.active ? "opacity-60" : ""}>
                      <CardHeader className="pb-3 border-b">
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <CardTitle className="text-lg flex items-center gap-2">
                              {pkg.name}
                              {!pkg.active && <Badge variant="secondary">Neaktivno</Badge>}
                            </CardTitle>
                            <CardDescription className="mt-1 font-semibold text-primary">
                              {pkg.priceInDinars.toLocaleString()} RSD za {pkg.sessionCount} tretmana
                            </CardDescription>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => handleEdit(pkg)}>Izmeni</Button>
                        </div>
                      </CardHeader>
                      <CardContent className="py-4 space-y-3">
                        <p className="text-sm text-muted-foreground">{pkg.description}</p>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Važi za usluge:</p>
                          <div className="flex flex-wrap gap-1">
                            {pkg.serviceQuotas.map(({ serviceId, quota }) => {
                              const srv = services?.find(s => s.id === serviceId);
                              return srv ? <Badge key={serviceId} variant="secondary" className="text-xs">{srv.name} × {quota}</Badge> : null;
                            })}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground pt-2 border-t">Validnost: {pkg.validityDays} dana od kupovine</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="purchases" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Klijentski paketi</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {isCustPackagesLoading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                  ) : customerPackages?.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground">Još nema prodatih paketa.</div>
                  ) : (
                    <div className="divide-y">
                      {customerPackages?.map((purchase: PackagePurchase) => (
                        <div key={purchase.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-bold">{purchase.packageName}</h4>
                              {purchase.status === 'active' && <Badge className="bg-emerald-100 text-emerald-800 border-none">Aktivan</Badge>}
                              {purchase.status === 'pending_payment' && <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-none">Čeka uplatu</Badge>}
                              {purchase.status === 'completed' && <Badge variant="outline">Iskorišćen</Badge>}
                              {purchase.status === 'expired' && <Badge variant="destructive">Istekao</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground">Kupljeno: {format(parseISO(purchase.createdAt), 'dd.MM.yyyy')} · Važi do: {format(parseISO(purchase.expiresAt), 'dd.MM.yyyy')}</p>
                            {purchase.quotaPolicy === "shared_pool" ? (
                              <p className="text-sm mt-1">Preostalo: <strong>{purchase.remainingSessions} / {purchase.totalSessions}</strong> tretmana <span className="text-muted-foreground">(zajednički fond)</span></p>
                            ) : (
                              <div className="text-sm mt-1">
                                <span className="text-muted-foreground">Preostalo po usluzi:</span>
                                <ul className="mt-1 space-y-0.5">
                                  {purchase.serviceQuotas.map(({ serviceId, remainingQuota, totalQuota }) => (
                                    <li key={serviceId}><strong>{services?.find(service => service.id === serviceId)?.name ?? "Usluga"}: {remainingQuota} / {totalQuota}</strong></li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className="font-bold text-lg">{purchase.priceInDinars.toLocaleString()} RSD</span>
                            {purchase.status === 'pending_payment' && (
                              <Button size="sm" onClick={() => handleConfirmPayment(purchase.packageId, purchase.id)} disabled={confirmPaymentMutation.isPending}>
                                <Check className="w-4 h-4 mr-2" /> Potvrdi uplatu
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={isEditing} onOpenChange={(open) => !open && setIsEditing(false)}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{currentId ? "Izmeni paket" : "Novi paket tretmana"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Naziv paketa</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Npr. Paket 5 Masaža" />
            </div>
            
            <div className="space-y-2">
              <Label>Opis</Label>
              <Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} placeholder="Kratak opis benefita" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Ukupna cena (RSD)</Label>
                <Input type="number" min="1" value={formData.priceInDinars} onChange={e => setFormData({...formData, priceInDinars: Number(e.target.value)})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Važenje paketa (u danima)</Label>
              <Input type="number" min="1" value={formData.validityDays} onChange={e => setFormData({...formData, validityDays: Number(e.target.value)})} />
              <p className="text-xs text-muted-foreground">Paket ističe nakon ovoliko dana od datuma kupovine/potvrde.</p>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <Label>Usluge na koje se paket može primeniti</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-48 overflow-y-auto p-2 border rounded-md bg-muted/10">
                {activeServices.length === 0 ? (
                  <p className="text-sm text-muted-foreground col-span-2">Nema aktivnih usluga u salonu.</p>
                ) : (
                  activeServices.map(srv => (
                    <label key={srv.id} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 hover:bg-muted/30 rounded">
                      <input
                        type="checkbox" 
                        className="rounded border-gray-300"
                        checked={Object.prototype.hasOwnProperty.call(formData.serviceQuotas, srv.id)}
                        onChange={() => toggleService(srv.id)}
                      />
                      <span className="truncate">{srv.name}</span>
                      {Object.prototype.hasOwnProperty.call(formData.serviceQuotas, srv.id) && (
                        <Input
                          aria-label={`Kvota za ${srv.name}`}
                          className="ml-auto h-8 w-20"
                          type="number"
                          min="1"
                          value={formData.serviceQuotas[srv.id]}
                          onChange={event => setServiceQuota(srv.id, Number(event.target.value))}
                        />
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
            <p className="text-sm font-medium">Ukupno tretmana: <strong>{totalSessions}</strong></p>
            {validationError && <p className="text-sm text-destructive">{validationError}</p>}

            <div className="flex items-center gap-2 pt-2">
              <input type="checkbox" id="pkg-active" checked={formData.active} onChange={e => setFormData({...formData, active: e.target.checked})} className="rounded border-gray-300" />
              <Label htmlFor="pkg-active" className="cursor-pointer">Paket je aktivan za kupovinu</Label>
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending || Boolean(validationError)}>
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj paket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
