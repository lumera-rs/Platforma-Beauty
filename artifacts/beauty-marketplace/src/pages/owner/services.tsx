import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { useListSalonServices, useCreateSalonService, useGetCurrentUser, getListSalonServicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Edit2, Loader2, Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export default function OwnerServices() {
  const { data: userResp } = useGetCurrentUser();
  const { data: services, isLoading, refetch } = useListSalonServices({ query: { enabled: !!userResp?.user, queryKey: getListSalonServicesQueryKey() }});
  const createMutation = useCreateSalonService();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    category: "Frizura",
    durationMinutes: 30,
    price: 1500,
    description: "",
    imageUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=200",
    active: true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({ data: { ...formData, durationMinutes: Number(formData.durationMinutes), price: Number(formData.price) } }, {
      onSuccess: () => {
        toast.success("Usluga dodata");
        setOpen(false);
        refetch();
      }
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/usluge" />
        
        <div className="flex-1 space-y-6 w-full">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-serif font-bold">Usluge salona</h1>
              <p className="text-muted-foreground">Upravljajte tretmanima i cenovnikom</p>
            </div>
            
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" /> Dodaj uslugu</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Nova usluga</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>Naziv usluge</Label>
                    <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Trajanje (min)</Label>
                      <Input type="number" value={formData.durationMinutes} onChange={e => setFormData({...formData, durationMinutes: Number(e.target.value)})} required min="5" />
                    </div>
                    <div className="space-y-2">
                      <Label>Cena (RSD)</Label>
                      <Input type="number" value={formData.price} onChange={e => setFormData({...formData, price: Number(e.target.value)})} required min="0" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Kategorija</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                      <option>Frizura</option>
                      <option>Kozmetika</option>
                      <option>Masaža</option>
                      <option>Nokti</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Kratak opis</Label>
                    <Input value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
                  </div>
                  <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Sačuvaj
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <div className="divide-y">
              {isLoading ? (
                <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>
              ) : services?.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">Još niste dodali nijednu uslugu.</div>
              ) : services?.map(service => (
                <div key={service.id} className="p-4 sm:p-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between hover:bg-muted/20 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {service.imageUrl ? <img src={service.imageUrl} className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-bold text-lg">{service.name}</h4>
                        {!service.active && <Badge variant="secondary" className="text-xs">Neaktivno</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">{service.category} • {service.durationMinutes} min</p>
                      <p className="font-semibold text-primary">{service.price} RSD</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0"><Edit2 className="w-4 h-4 mr-2" /> Izmeni</Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </BusinessLayout>
  );
}
