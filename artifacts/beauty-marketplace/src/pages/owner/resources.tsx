import { useState } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useListSalonResources, 
  useCreateSalonResource, 
  useUpdateSalonResource, 
  useDeleteSalonResource,
  useGetCurrentUser, 
  getListSalonResourcesQueryKey,
  type SalonResourceType,
  type SalonResource
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Trash2, Loader2, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const resourceTypeLabels: Record<SalonResourceType, string> = {
  chair: "Radna stolica",
  booth: "Kabina",
  bed: "Krevet / Ležaj",
  room: "Soba",
  equipment: "Aparat / Oprema",
  other: "Ostalo",
};

export default function OwnerResources() {
  const { data: userResp } = useGetCurrentUser();
  const { data: resources, isLoading, refetch } = useListSalonResources({ query: { enabled: !!userResp?.user, queryKey: getListSalonResourcesQueryKey() } });
  
  const createMutation = useCreateSalonResource();
  const updateMutation = useUpdateSalonResource();
  const deleteMutation = useDeleteSalonResource();
  const { toast } = useToast();
  
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalonResource | null>(null);
  
  const [formData, setFormData] = useState<{ name: string; type: SalonResourceType; capacity: number; active: boolean }>({
    name: "",
    type: "chair",
    capacity: 1,
    active: true
  });

  const resetForm = () => {
    setEditingId(null);
    setFormData({ name: "", type: "chair", capacity: 1, active: true });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...formData, name: formData.name.trim(), capacity: Number(formData.capacity) };
    
    const callbacks = {
      onSuccess: () => {
        toast.success(editingId ? "Resurs izmenjen" : "Resurs dodat");
        setOpen(false);
        resetForm();
        refetch();
      },
      onError: (error: unknown) => {
        const message = error instanceof Error
          ? error.message.replace(/^HTTP \d+[^:]*:\s*/, "")
          : "Pokušajte ponovo.";
        toast.error("Greška", { description: message });
      }
    };
    
    if (editingId) {
      updateMutation.mutate({ resourceId: editingId, data: payload }, callbacks);
    } else {
      createMutation.mutate({ data: payload }, callbacks);
    }
  };

  const editResource = (resource: SalonResource) => {
    setEditingId(resource.id);
    setFormData({ 
      name: resource.name, 
      type: resource.type, 
      capacity: resource.capacity, 
      active: resource.active 
    });
    setOpen(true);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate({ resourceId: deleteTarget.id }, {
      onSuccess: () => {
        toast.success("Resurs obrisan");
        setDeleteTarget(null);
        refetch();
      },
      onError: (error) => {
        toast.error("Brisanje nije uspelo", { 
          description: error instanceof Error
            ? error.message.replace(/^HTTP \d+[^:]*:\s*/, "")
            : "Pokušajte ponovo." 
        });
        setDeleteTarget(null);
      }
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/resursi" />
        
        <div className="flex-1 space-y-6 w-full min-w-0">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Upravljanje resursima</h1>
              <p className="text-muted-foreground mt-1">Definišite stolice, kabine i opremu za ograničenje kapaciteta</p>
            </div>
            
            <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm(); }}>
              <DialogTrigger asChild>
                <Button onClick={resetForm}><Plus className="w-4 h-4 mr-2" /> Novi resurs</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingId ? "Izmeni resurs" : "Dodaj novi resurs"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Naziv resursa</Label>
                    <Input 
                      value={formData.name} 
                      onChange={e => setFormData({...formData, name: e.target.value})} 
                      placeholder="npr. Radna stanica 1, Laser uređaj..."
                      required 
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Tip resursa</Label>
                      <select 
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" 
                        value={formData.type} 
                        onChange={e => setFormData({...formData, type: e.target.value as SalonResourceType})}
                      >
                        {Object.entries(resourceTypeLabels).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Kapacitet</Label>
                      <Input 
                        type="number" 
                        value={formData.capacity} 
                        onChange={e => setFormData({...formData, capacity: Number(e.target.value)})} 
                        required min="1" max="1000"
                      />
                      <p className="text-xs text-muted-foreground">Koliko klijenata istovremeno?</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <Label className="cursor-pointer">Resurs je dostupan</Label>
                    <Switch checked={formData.active} onCheckedChange={(checked) => setFormData({ ...formData, active: checked })} />
                  </div>
                  
                  <Button type="submit" className="w-full mt-6" disabled={!formData.name.trim() || createMutation.isPending || updateMutation.isPending}>
                    {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {editingId ? "Sačuvaj izmene" : "Sačuvaj resurs"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <div className="divide-y">
              {isLoading ? (
                <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>
              ) : !resources || resources.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                  <FileText className="w-12 h-12 mb-4 opacity-20" />
                  <p>Niste dodali nijedan resurs.</p>
                  <p className="text-sm mt-1">Resursi omogućavaju precizno praćenje kapaciteta salona.</p>
                </div>
              ) : resources.map((resource) => (
                <div key={resource.id} className={`p-4 sm:p-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between hover:bg-muted/10 transition-colors ${!resource.active ? 'opacity-60 grayscale-[30%]' : ''}`}>
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-bold text-lg text-foreground truncate">{resource.name}</h4>
                        {!resource.active && <Badge variant="secondary" className="text-xs">Neaktivno</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{resourceTypeLabels[resource.type]} • Kapacitet: {resource.capacity}</p>
                    </div>
                  </div>
                  
                  <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                    <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => editResource(resource)}>
                      <Edit2 className="w-4 h-4 mr-2" /> Izmeni
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive sm:flex-none"
                      onClick={() => setDeleteTarget(resource)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Obriši
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(next) => !next && !deleteMutation.isPending && setDeleteTarget(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Da li ste sigurni?</AlertDialogTitle>
                <AlertDialogDescription>
                  Resurs „{deleteTarget?.name}“ će biti trajno obrisan. Ukoliko je resurs povezan sa postojećim uslugama ili istorijom termina, brisanje neće biti dozvoljeno. U tom slučaju, preporučujemo da isključite opciju „Resurs je dostupan“ umesto brisanja.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>Otkaži</AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive" disabled={deleteMutation.isPending} onClick={handleDelete}>
                    {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Obriši resurs
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </BusinessLayout>
  );
}