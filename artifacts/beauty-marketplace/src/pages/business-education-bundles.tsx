import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListEducationCenterBundles, 
  useCreateEducationCenterBundle, 
  useUpdateEducationCenterBundle,
  useArchiveEducationCenterBundle,
  useGetEducationCenterStatus, 
  useGetCurrentUser 
} from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Box, Plus, Info, Pencil, Archive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

export default function BusinessEducationBundles() {
  const { data: userResp } = useGetCurrentUser();
  const { data: statusList, isLoading: isStatusLoading } = useGetEducationCenterStatus({ 
    query: { enabled: Boolean(userResp?.user), queryKey: ["educationCenterStatus"] } 
  });
  const centerId = statusList?.[0]?.id || "";
  
  const { data: bundlesResp, isLoading } = useListEducationCenterBundles(centerId, { 
    query: { enabled: Boolean(centerId), queryKey: ["query", centerId] } 
  });
  
  const createMut = useCreateEducationCenterBundle();
  const updateMut = useUpdateEducationCenterBundle();
  const archiveMut = useArchiveEducationCenterBundle();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", price: "", description: "" });

  const items = bundlesResp || [];

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormData({ name: "", price: "", description: "" });
    setIsOpen(true);
  };

  const handleOpenEdit = (item: any) => {
    setEditingId(item.id);
    setFormData({ name: item.name, price: String(item.price), description: item.description || "" });
    setIsOpen(true);
  };

  const handleSave = () => {
    if (!formData.name) return;
    
    const payload = {
      name: formData.name,
      price: Number(formData.price) || 0,
      description: formData.description,
      courseIds: [] // Moguće dodavanje kurseva u budućnosti
    };

    if (editingId) {
      updateMut.mutate({
        centerId,
        id: editingId,
        data: payload
      }, {
        onSuccess: () => {
          toast.success("Paket izmenjen");
          setIsOpen(false);
          queryClient.invalidateQueries({ queryKey: [`/api/education/centers/${centerId}/bundles`] });
        },
        onError: () => toast.error("Greška pri izmeni")
      });
    } else {
      createMut.mutate({
        centerId,
        data: payload
      }, {
        onSuccess: () => {
          toast.success("Paket kreiran");
          setIsOpen(false);
          queryClient.invalidateQueries({ queryKey: [`/api/education/centers/${centerId}/bundles`] });
        },
        onError: () => toast.error("Greška pri kreiranju")
      });
    }
  };

  const handleArchive = (bundleId: string) => {
    if (confirm("Da li ste sigurni da želite da arhivirate ovaj paket?")) {
      archiveMut.mutate({ centerId, id: bundleId }, {
        onSuccess: () => {
          toast.success("Paket arhiviran");
          queryClient.invalidateQueries({ queryKey: [`/api/education/centers/${centerId}/bundles`] });
        },
        onError: () => toast.error("Greška pri arhiviranju")
      });
    }
  };

  if (isStatusLoading || isLoading) {
    return <BusinessLayout><div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div></BusinessLayout>;
  }

  const formatMoney = (val: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(val);

  return (
    <BusinessLayout>
      <TooltipProvider>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Paketi edukacija</h1>
              <p className="text-muted-foreground mt-1">Grupišite kurseve i ponudite ih kao paket</p>
            </div>
            <Button onClick={handleOpenCreate}>
              <Plus className="w-4 h-4 mr-2" /> Kreiraj paket
            </Button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {items.map((item, idx) => (
              <Card key={item.id || idx}>
                <CardHeader>
                  <CardTitle className="text-xl flex justify-between items-start">
                    <span>{item.name}</span>
                    {!item.active && <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground font-normal">Arhivirano</span>}
                  </CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center py-3 border-t">
                    <span className="text-muted-foreground">Cena paketa</span>
                    <span className="font-bold text-xl text-primary">{formatMoney(item.price)}</span>
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/30 pt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => handleOpenEdit(item)}>
                    <Pencil className="w-4 h-4 mr-2" /> Izmeni
                  </Button>
                  {item.active && (
                    <Button variant="outline" size="sm" className="flex-1 text-destructive hover:text-destructive" onClick={() => handleArchive(item.id)}>
                      <Archive className="w-4 h-4 mr-2" /> Arhiviraj
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
            {items.length === 0 && (
              <div className="col-span-full py-16 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                <Box className="w-16 h-16 mx-auto mb-4 opacity-40" />
                <h3 className="text-lg font-medium mb-1 text-foreground">Nema kreiranih paketa</h3>
                <p>Napravite paket koji uključuje više kurseva po povoljnijoj ceni.</p>
              </div>
            )}
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Izmeni paket" : "Novi paket edukacija"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Naziv paketa
                  <Tooltip><TooltipTrigger><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger><TooltipContent>Komercijalni naziv paketa</TooltipContent></Tooltip>
                </Label>
                <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Npr. Master Klas Paket" />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Opis
                  <Tooltip><TooltipTrigger><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger><TooltipContent>Kratak opis šta paket obuhvata</TooltipContent></Tooltip>
                </Label>
                <Input value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Opis paketa..." />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Cena (RSD)
                  <Tooltip><TooltipTrigger><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger><TooltipContent>Konačna cena za polaznika</TooltipContent></Tooltip>
                </Label>
                <Input type="number" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} placeholder="0" />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => setIsOpen(false)}>Otkaži</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !formData.name}>Sačuvaj</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </BusinessLayout>
  );
}
