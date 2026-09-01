import React, { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListEducationCenterInventory, useCreateEducationCenterInventoryItem, useGetEducationCenterStatus, useGetCurrentUser } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Package, Plus, Info, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

export default function BusinessEducationInventory() {
  const { data: userResp } = useGetCurrentUser();
  const { data: statusList, isLoading: isStatusLoading } = useGetEducationCenterStatus({ 
    query: { enabled: Boolean(userResp?.user), queryKey: ["educationCenterStatus"] } 
  });
  const centerId = statusList?.[0]?.id || "";
  
  const { data: inventoryResp, isLoading } = useListEducationCenterInventory(centerId, { 
    query: { enabled: Boolean(centerId), queryKey: ["query", centerId] } 
  });
  
  const createMut = useCreateEducationCenterInventoryItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", quantity: "", unit: "kom" });

  const items = Array.isArray(inventoryResp) ? inventoryResp : [];

  const handleCreate = () => {
    if (!formData.name) return;
    createMut.mutate({
      centerId,
      data: {
        name: formData.name,
        quantity: Number(formData.quantity) || 0,
        unit: formData.unit
      }
    }, {
      onSuccess: () => {
        toast.success("Stavka dodata");
        setIsOpen(false);
        setFormData({ name: "", quantity: "", unit: "kom" });
        queryClient.invalidateQueries({ queryKey: [`/api/education/centers/${centerId}/inventory`] });
      },
      onError: () => toast.error("Greška")
    });
  };

  if (isStatusLoading || isLoading) {
    return <BusinessLayout><div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div></BusinessLayout>;
  }

  return (
    <BusinessLayout>
      <TooltipProvider>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Zalihe i materijali</h1>
              <p className="text-muted-foreground mt-1">Potrošni materijal za kurseve i B2B nabavka</p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" asChild className="border-accent text-accent hover:bg-accent hover:text-accent-foreground">
                <Link href="/biznis/b2b">
                  B2B nabavka <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
              <Button onClick={() => setIsOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Dodaj stavku
              </Button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item, idx) => (
              <Card key={item.id || idx}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{item.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center py-2 border-t mt-2">
                    <span className="text-muted-foreground text-sm">Na stanju:</span>
                    <span className="font-semibold text-lg">{item.quantity} {item.unit}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {items.length === 0 && (
              <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Nema unetih materijala.</p>
              </div>
            )}
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dodaj materijal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Naziv materijala
                  <Tooltip><TooltipTrigger><Info className="w-4 h-4 text-muted-foreground" /></TooltipTrigger><TooltipContent>Npr. Pribor za crtanje, Rukavice</TooltipContent></Tooltip>
                </Label>
                <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Naziv" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">Količina</Label>
                  <Input type="number" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: e.target.value})} placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">Merna jedinica</Label>
                  <Input value={formData.unit} onChange={(e) => setFormData({...formData, unit: e.target.value})} placeholder="kom, ml, g..." />
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => setIsOpen(false)}>Otkaži</Button>
              <Button onClick={handleCreate} disabled={createMut.isPending || !formData.name}>Sačuvaj</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </BusinessLayout>
  );
}