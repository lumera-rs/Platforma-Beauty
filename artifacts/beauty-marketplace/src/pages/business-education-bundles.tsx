import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListEducationCenterBundles, 
  useCreateEducationCenterBundle, 
  useUpdateEducationCenterBundle,
  useArchiveEducationCenterBundle,
   useListCourses,
   getListCoursesQueryKey,
  useGetEducationCenterStatus, 
  useGetCurrentUser 
} from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Box, Plus, Pencil, Archive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EducationFieldHelp } from "@/components/education/education-field-help";

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
  const [formData, setFormData] = useState({ name: "", price: "", description: "", courseIds: [] as string[], published: false });
  const { data: courses = [] } = useListCourses(undefined, { query: { enabled: Boolean(centerId), queryKey: getListCoursesQueryKey() } });
  const [purchases, setPurchases] = useState<any[]>([]);
  useEffect(() => { if (centerId) void fetch(`/api/education/centers/${centerId}/bundle-purchases`, { credentials: "include" }).then(r => r.ok ? r.json() : []).then(setPurchases); }, [centerId]);

  const items = bundlesResp || [];

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormData({ name: "", price: "", description: "", courseIds: [], published: false });
    setIsOpen(true);
  };

  const handleOpenEdit = (item: any) => {
    setEditingId(item.id);
    setFormData({ name: item.name, price: String(item.price), description: item.description || "", courseIds: item.courseIds || [], published: Boolean(item.published) });
    setIsOpen(true);
  };

  const handleSave = () => {
    if (!formData.name) return;
    
    const payload = {
      name: formData.name,
      price: Number(formData.price) || 0,
      description: formData.description,
      courseIds: formData.courseIds,
      published: formData.published,
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
                  {purchases.filter(purchase => purchase.bundleId === item.id).map(purchase => <p key={purchase.id} className="mt-2 text-sm text-muted-foreground">Polaznik: <span className="font-medium text-foreground">{purchase.participantName ?? "Nije dostupan"}</span> · {purchase.status === "settled" ? "aktivan" : "čeka uplatu"}</p>)}
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
                <Label htmlFor="bundle-name" className="flex items-center gap-2">
                  Naziv paketa
                  <EducationFieldHelp id="bundle-name-help" label="Naziv paketa" text="Unesite jasan komercijalni naziv po kojem će polaznici prepoznati ovu grupu edukacija." />
                </Label>
                <Input id="bundle-name" aria-describedby="bundle-name-help" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} placeholder="Npr. Master Klas Paket" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bundle-description" className="flex items-center gap-2">
                  Opis
                  <EducationFieldHelp id="bundle-description-help" label="Opis paketa" text="Ukratko objasnite kome je paket namenjen i koje znanje ili pogodnost objedinjene edukacije pružaju." />
                </Label>
                <Input id="bundle-description" aria-describedby="bundle-description-help" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} placeholder="Opis paketa..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bundle-price" className="flex items-center gap-2">
                  Cena (RSD)
                  <EducationFieldHelp id="bundle-price-help" label="Cena paketa" text="Unesite konačnu cenu celog paketa u dinarima koju polaznik plaća, uključujući sve edukacije u paketu." />
                </Label>
                <Input id="bundle-price" aria-describedby="bundle-price-help" type="number" min="0" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">Kur­sevi u paketu <EducationFieldHelp id="bundle-courses-help" label="Kursevi u paketu" text="Označite sve aktivne kurseve koje kupac dobija jednom kupovinom ovog paketa." /></Label>
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                  {(courses as any[]).filter(course => course.centerId === centerId && course.published !== false && !course.archived).map(course => (
                    <label key={course.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" aria-describedby="bundle-courses-help" checked={formData.courseIds.includes(course.id)} onChange={() => setFormData(f => ({ ...f, courseIds: f.courseIds.includes(course.id) ? f.courseIds.filter(id => id !== course.id) : [...f.courseIds, course.id] }))} />
                      <span>{course.title}</span>
                    </label>
                  ))}
                  {!courses.length && <p className="text-sm text-muted-foreground">Prvo kreirajte aktivan kurs ovog centra.</p>}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" aria-describedby="bundle-published-help" checked={formData.published} onChange={e => setFormData({ ...formData, published: e.target.checked })} /> Objavi paket u ponudi edukacija <EducationFieldHelp id="bundle-published-help" label="Objava paketa" text="Uključite tek kada su naziv, cena i izbor kurseva spremni; paket tada postaje vidljiv kupcima u ponudi edukacija." /></label>
            </div>
            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={() => setIsOpen(false)}>Otkaži</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !formData.name || (formData.published && !formData.courseIds.length)}>Sačuvaj</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </BusinessLayout>
  );
}
