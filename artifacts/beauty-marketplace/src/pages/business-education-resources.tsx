import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListEducationCenterResources, useCreateEducationCenterResource, useGetEducationCenterStatus, useGetCurrentUser } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, LayoutGrid, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EducationFieldHelp } from "@/components/education/education-field-help";

export default function BusinessEducationResources() {
  const { data: userResp } = useGetCurrentUser();
  const { data: statusList, isLoading: isStatusLoading } = useGetEducationCenterStatus({ 
    query: { enabled: Boolean(userResp?.user), queryKey: ["educationCenterStatus"] } 
  });
  const centerId = statusList?.[0]?.id || "";
  
  const { data: resourcesResp, isLoading } = useListEducationCenterResources(centerId, { 
    query: { enabled: Boolean(centerId), queryKey: ["query", centerId] } 
  });
  
  const createResourceMut = useCreateEducationCenterResource();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", type: "room", capacity: "" });

  const resources = Array.isArray(resourcesResp) ? resourcesResp : [];

  const handleCreate = () => {
    if (!formData.name) return;
    createResourceMut.mutate({
      centerId,
      data: {
        name: formData.name,
        type: formData.type,
        capacity: Number(formData.capacity) || 0
      }
    }, {
      onSuccess: () => {
        toast.success("Resurs dodat");
        setIsOpen(false);
        setFormData({ name: "", type: "room", capacity: "" });
        queryClient.invalidateQueries({ queryKey: [`/api/education/centers/${centerId}/resources`] });
      },
      onError: () => toast.error("Greška pri dodavanju")
    });
  };

  if (isStatusLoading || isLoading) {
    return <BusinessLayout><div className="flex justify-center p-12"><Loader2 className="animate-spin text-primary" /></div></BusinessLayout>;
  }

  return (
    <BusinessLayout>
      <TooltipProvider>
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Resursi centra</h1>
              <p className="text-muted-foreground mt-1">Upravljanje prostorijama i opremom za edukacije</p>
            </div>
            <Button onClick={() => setIsOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Dodaj resurs
            </Button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {resources.map((res, idx) => (
              <Card key={res.id || idx}>
                <CardHeader>
                  <CardTitle className="text-lg">{res.name}</CardTitle>
                  <CardDescription>{res.type === 'room' ? 'Prostorija' : 'Oprema'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Kapacitet: </span>
                    <span className="font-medium">{res.capacity || 'Nije definisano'}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {resources.length === 0 && (
              <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed rounded-xl">
                <LayoutGrid className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Nema dodatih resursa.</p>
              </div>
            )}
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dodaj novi resurs</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="resource-name" className="flex items-center gap-2">
                  Naziv resursa
                  <EducationFieldHelp id="resource-name-help" label="Naziv resursa" text="Unesite interni, prepoznatljiv naziv prostorije ili opreme koji će osoblje videti pri planiranju termina." />
                </Label>
                <Input id="resource-name" aria-describedby="resource-name-help" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Npr. Sala A" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="resource-type" className="flex items-center gap-2">
                  Tip
                  <EducationFieldHelp id="resource-type-help" label="Tip resursa" text="Izaberite prostoriju za sale i kabinete, a opremu za uređaje i druga sredstva koja se rezervišu." />
                </Label>
                <Select value={formData.type} onValueChange={(val) => setFormData({...formData, type: val})}>
                  <SelectTrigger id="resource-type" aria-describedby="resource-type-help"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="room">Prostorija</SelectItem>
                    <SelectItem value="equipment">Oprema</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="resource-capacity" className="flex items-center gap-2">
                  Kapacitet
                  <EducationFieldHelp id="resource-capacity-help" label="Kapacitet" text="Unesite najveći broj polaznika koji resurs bezbedno podržava; vrednost se koristi pri planiranju grupa." />
                </Label>
                <Input id="resource-capacity" aria-describedby="resource-capacity-help" type="number" min="0" value={formData.capacity} onChange={(e) => setFormData({...formData, capacity: e.target.value})} placeholder="Npr. 20" />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => setIsOpen(false)}>Otkaži</Button>
              <Button onClick={handleCreate} disabled={createResourceMut.isPending || !formData.name}>Sačuvaj</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </BusinessLayout>
  );
}