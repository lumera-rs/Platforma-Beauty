// @ts-nocheck
import { useState } from "react";
import { AdminLayout } from "./layout";
import { 
  useAdminListB2cProductTypes,
  useAdminCreateB2cProductType,
  useAdminUpdateB2cProductType,
  useAdminDeleteB2cProductType,
  useAdminReorderB2cProductTypes,
  useAdminListB2cNeedTags,
  useAdminCreateB2cNeedTag,
  useAdminUpdateB2cNeedTag,
  useAdminDeleteB2cNeedTag,
  useAdminReorderB2cNeedTags,
  getAdminListB2cProductTypesQueryKey,
  getAdminListB2cNeedTagsQueryKey,
  B2cDictionaryValue
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, GripVertical, Trash2, Edit2, Check, X, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";

function ProductTypesTab() {
  const { data: items = [], isLoading } = useAdminListB2cProductTypes();
  const createReq = useAdminCreateB2cProductType();
  const updateReq = useAdminUpdateB2cProductType();
  const deleteReq = useAdminDeleteB2cProductType();
  const reorderReq = useAdminReorderB2cProductTypes();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [newLabel, setNewLabel] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div>;

  const handleCreate = () => {
    if (!newLabel.trim() || !newSlug.trim()) return;
    createReq.mutate({ data: { slug: newSlug.trim(), label: newLabel.trim(), active: true, sortOrder: items.length } }, {
      onSuccess: () => {
        toast.success("Tip kreiran");
        setNewLabel("");
        setNewSlug("");
        qc.invalidateQueries({ queryKey: getAdminListB2cProductTypesQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleUpdateActive = (item: B2cDictionaryValue, active: boolean) => {
    updateReq.mutate({ id: item.id, data: { active, expectedVersion: item.version } }, {
      onSuccess: () => {
        toast.success(active ? "Aktivirano" : "Deaktivirano");
        qc.invalidateQueries({ queryKey: getAdminListB2cProductTypesQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleUpdateLabel = (item: B2cDictionaryValue) => {
    if (!editLabel.trim()) return;
    updateReq.mutate({ id: item.id, data: { label: editLabel.trim(), expectedVersion: item.version } }, {
      onSuccess: () => {
        toast.success("Ažurirano");
        setEditingId(null);
        qc.invalidateQueries({ queryKey: getAdminListB2cProductTypesQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleDelete = (item: B2cDictionaryValue) => {
    if (!window.confirm(`Brisanje "${item.label}"?`)) return;
    deleteReq.mutate({ id: item.id, params: { expectedVersion: item.version } }, {
      onSuccess: () => {
        toast.success("Obrisano");
        qc.invalidateQueries({ queryKey: getAdminListB2cProductTypesQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === items.length - 1) return;
    const newItems = [...items];
    const target = direction === 'up' ? index - 1 : index + 1;
    [newItems[index], newItems[target]] = [newItems[target], newItems[index]];
    
    reorderReq.mutate({
      data: {
        items: newItems.map((it, i) => ({ id: it.id, expectedVersion: it.version, sortOrder: i }))
      }
    }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAdminListB2cProductTypesQueryKey() }),
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="flex gap-4 items-end bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex-1 space-y-1">
          <label className="text-sm font-medium">Naziv</label>
          <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="npr. Šampon" />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-sm font-medium">Slug (za URL)</label>
          <Input value={newSlug} onChange={e => setNewSlug(e.target.value)} placeholder="npr. sampon" />
        </div>
        <Button onClick={handleCreate} disabled={!newLabel.trim() || !newSlug.trim() || createReq.isPending}>
          {createReq.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Dodaj Tip
        </Button>
      </div>

      <div className="bg-card rounded-xl border shadow-sm divide-y">
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-4 p-4">
            <div className="flex flex-col gap-1">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(idx, 'up')} disabled={idx === 0}><GripVertical className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(idx, 'down')} disabled={idx === items.length - 1}><GripVertical className="w-4 h-4" /></Button>
            </div>
            
            <div className="flex-1">
              {editingId === item.id ? (
                <div className="flex items-center gap-2">
                  <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus className="max-w-xs" />
                  <Button size="icon" variant="ghost" onClick={() => handleUpdateLabel(item)} disabled={updateReq.isPending}><Check className="w-4 h-4 text-green-600" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                </div>
              ) : (
                <div className="font-medium flex items-center gap-2">
                  {item.label}
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingId(item.id); setEditLabel(item.label); }}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                </div>
              )}
              <div className="text-sm text-muted-foreground">slug: {item.slug}</div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{item.active ? 'Aktivno' : 'Neaktivno'}</span>
                <Switch checked={item.active} onCheckedChange={(v) => handleUpdateActive(item, v)} disabled={updateReq.isPending} />
              </div>
              <Button size="icon" variant="destructive" onClick={() => handleDelete(item)} disabled={deleteReq.isPending}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="p-8 text-center text-muted-foreground">Nema unetih tipova proizvoda.</div>}
      </div>
    </div>
  );
}

function NeedTagsTab() {
  const { data: items = [], isLoading } = useAdminListB2cNeedTags();
  const createReq = useAdminCreateB2cNeedTag();
  const updateReq = useAdminUpdateB2cNeedTag();
  const deleteReq = useAdminDeleteB2cNeedTag();
  const reorderReq = useAdminReorderB2cNeedTags();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div>;

  const handleCreate = () => {
    if (!newLabel.trim() || !newKey.trim()) return;
    createReq.mutate({ data: { key: newKey.trim(), label: newLabel.trim(), active: true, sortOrder: items.length } }, {
      onSuccess: () => {
        toast.success("Oznaka kreirana");
        setNewLabel("");
        setNewKey("");
        qc.invalidateQueries({ queryKey: getAdminListB2cNeedTagsQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleUpdateActive = (item: B2cDictionaryValue, active: boolean) => {
    updateReq.mutate({ id: item.id, data: { active, expectedVersion: item.version } }, {
      onSuccess: () => {
        toast.success(active ? "Aktivirano" : "Deaktivirano");
        qc.invalidateQueries({ queryKey: getAdminListB2cNeedTagsQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleUpdateLabel = (item: B2cDictionaryValue) => {
    if (!editLabel.trim()) return;
    updateReq.mutate({ id: item.id, data: { label: editLabel.trim(), expectedVersion: item.version } }, {
      onSuccess: () => {
        toast.success("Ažurirano");
        setEditingId(null);
        qc.invalidateQueries({ queryKey: getAdminListB2cNeedTagsQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleDelete = (item: B2cDictionaryValue) => {
    if (!window.confirm(`Brisanje "${item.label}"?`)) return;
    deleteReq.mutate({ id: item.id, params: { expectedVersion: item.version } }, {
      onSuccess: () => {
        toast.success("Obrisano");
        qc.invalidateQueries({ queryKey: getAdminListB2cNeedTagsQueryKey() });
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === items.length - 1) return;
    const newItems = [...items];
    const target = direction === 'up' ? index - 1 : index + 1;
    [newItems[index], newItems[target]] = [newItems[target], newItems[index]];
    
    reorderReq.mutate({
      data: {
        items: newItems.map((it, i) => ({ id: it.id, expectedVersion: it.version, sortOrder: i }))
      }
    }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getAdminListB2cNeedTagsQueryKey() }),
      onError: (err) => toast.error("Greška", { description: extractApiError(err) })
    });
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="flex gap-4 items-end bg-card p-4 rounded-xl border shadow-sm">
        <div className="flex-1 space-y-1">
          <label className="text-sm font-medium">Naziv</label>
          <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="npr. Suva kosa" />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-sm font-medium">Ključ (interno)</label>
          <Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="npr. suva-kosa" />
        </div>
        <Button onClick={handleCreate} disabled={!newLabel.trim() || !newKey.trim() || createReq.isPending}>
          {createReq.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Dodaj Oznaku
        </Button>
      </div>

      <div className="bg-card rounded-xl border shadow-sm divide-y">
        {items.map((item, idx) => (
          <div key={item.id} className="flex items-center gap-4 p-4">
            <div className="flex flex-col gap-1">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(idx, 'up')} disabled={idx === 0}><GripVertical className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(idx, 'down')} disabled={idx === items.length - 1}><GripVertical className="w-4 h-4" /></Button>
            </div>
            
            <div className="flex-1">
              {editingId === item.id ? (
                <div className="flex items-center gap-2">
                  <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} autoFocus className="max-w-xs" />
                  <Button size="icon" variant="ghost" onClick={() => handleUpdateLabel(item)} disabled={updateReq.isPending}><Check className="w-4 h-4 text-green-600" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                </div>
              ) : (
                <div className="font-medium flex items-center gap-2">
                  {item.label}
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingId(item.id); setEditLabel(item.label); }}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                </div>
              )}
              <div className="text-sm text-muted-foreground">ključ: {item.key}</div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{item.active ? 'Aktivno' : 'Neaktivno'}</span>
                <Switch checked={item.active} onCheckedChange={(v) => handleUpdateActive(item, v)} disabled={updateReq.isPending} />
              </div>
              <Button size="icon" variant="destructive" onClick={() => handleDelete(item)} disabled={deleteReq.isPending}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="p-8 text-center text-muted-foreground">Nema unetih oznaka.</div>}
      </div>
    </div>
  );
}

export default function AdminCatalogAttributesPage() {
  return (
    <AdminLayout>
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">Katalog Atributi</h1>
          <p className="text-muted-foreground mt-2">Upravljajte tipovima proizvoda i oznakama potreba/problema za B2C kupce.</p>
        </div>

        <Tabs defaultValue="product-types" className="w-full">
          <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
            <TabsTrigger value="product-types" className="data-[state=active]:border-primary data-[state=active]:text-primary border-b-2 border-transparent rounded-none px-6 py-3">Tipovi proizvoda</TabsTrigger>
            <TabsTrigger value="need-tags" className="data-[state=active]:border-primary data-[state=active]:text-primary border-b-2 border-transparent rounded-none px-6 py-3">Oznake (Potrebe/Problemi)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="product-types">
            <ProductTypesTab />
          </TabsContent>
          
          <TabsContent value="need-tags">
            <NeedTagsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
