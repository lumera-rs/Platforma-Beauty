import { useState } from "react";
import { AdminLayout } from "./layout";
import { Link } from "wouter";
import {
  useAdminListSuppliers,
  useAdminCreateSupplier,
  SupplierScope,
  getAdminListSuppliersQueryKey,
} from "@workspace/api-client-react";
import type { SupplierInput } from "@workspace/api-client-react";
import { extractApiError } from "@/lib/admin-form-utils";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Building2, Search, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { OptimizedImage } from "@/components/optimized-image";

export default function AdminSuppliers() {
  const { data: suppliers = [], isLoading, error } = useAdminListSuppliers();
  const createSupplier = useAdminCreateSupplier();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<SupplierInput>({
    name: "",
    slug: "",
    scope: SupplierScope.BOTH,
    logoUrl: null,
  });

  const filteredSuppliers = suppliers.filter((s) => 
    s.name.toLowerCase().includes(debouncedSearch.toLowerCase()) || 
    s.slug.toLowerCase().includes(debouncedSearch.toLowerCase())
  );

  const openNew = () => {
    setForm({ name: "", slug: "", scope: SupplierScope.BOTH, logoUrl: null });
    setModalOpen(true);
  };

  const handleNameChange = (name: string) => {
    // Generate slug from name automatically when creating
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
    setForm({ ...form, name, slug });
  };

  const handleCreate = () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error("Greška", { description: "Naziv i slug su obavezni." });
      return;
    }

    createSupplier.mutate(
      { data: form },
      {
        onSuccess: (supplier) => {
          toast.success("Kreirano", { description: `Dobavljač "${supplier.name}" je kreiran.` });
          queryClient.invalidateQueries({ queryKey: getAdminListSuppliersQueryKey() });
          setModalOpen(false);
        },
        onError: (err: unknown) => {
          toast.error("Greška", { description: extractApiError(err, "Dobavljač nije kreiran.") });
        },
      }
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif font-bold text-foreground">Dobavljači</h1>
            <p className="text-muted-foreground text-sm">Upravljanje dobavljačima i njihovim katalozima.</p>
          </div>
          <Button onClick={openNew} className="shrink-0 gap-2">
            <Plus className="w-4 h-4" /> Novi dobavljač
          </Button>
        </div>

        <div className="bg-card rounded-xl border shadow-sm p-4 flex gap-4 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Pretraži dobavljače..." 
              className="pl-9" 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
          <Badge variant="secondary" className="hidden sm:flex">{filteredSuppliers.length} ukupno</Badge>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : error ? (
          <div className="p-8 text-center text-destructive rounded-xl border bg-destructive/10">Došlo je do greške pri učitavanju dobavljača.</div>
        ) : filteredSuppliers.length === 0 ? (
          <div className="p-12 flex flex-col items-center justify-center text-muted-foreground bg-card rounded-xl border">
            <Building2 className="w-12 h-12 mb-4 opacity-20" />
            <p>Nema pronađenih dobavljača.</p>
            {search && <Button variant="link" onClick={() => setSearch("")}>Poništi pretragu</Button>}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSuppliers.map((supplier) => (
              <Link key={supplier.id} href={`/admin/dobavljaci/${supplier.id}`} className="group block">
                <article className="h-full bg-card rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col">
                  <div className="p-5 flex items-start gap-4">
                    <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center border shrink-0 overflow-hidden">
                      {supplier.logoUrl ? (
                        <OptimizedImage src={supplier.logoUrl} alt={supplier.name} className="w-full h-full object-cover" width={56} height={56} preferredSize="thumbnail" />
                      ) : (
                        <Building2 className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">{supplier.name}</h3>
                      <p className="text-xs text-muted-foreground truncate">/{supplier.slug}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {supplier.active ? (
                          <Badge variant="default" className="text-[10px] bg-emerald-600 hover:bg-emerald-700">Aktivan</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Neaktivan</Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] uppercase">{supplier.scope}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="mt-auto px-5 py-3 border-t bg-muted/20 flex items-center justify-between text-sm text-muted-foreground group-hover:text-foreground group-hover:bg-muted/40 transition-colors">
                    <span>Upravljaj profilom</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novi dobavljač</DialogTitle>
            <DialogDescription>Kreirajte novog dobavljača. Slug mora biti jedinstven i ne može se menjati kasnije.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Naziv dobavljača *</Label>
              <Input value={form.name} onChange={(e) => handleNameChange(e.target.value)} placeholder="npr. L'Oreal" autoFocus />
            </div>
            <div className="space-y-2">
              <Label>URL slug *</Label>
              <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="npr. loreal" pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$" />
              <p className="text-xs text-muted-foreground">Kisti se za URL-ove shopa (/shop/loreal). Samo mala slova, brojevi i crtice.</p>
            </div>
            <div className="space-y-2">
              <Label>Dostupnost kataloga (Scope) *</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SupplierScope.B2B}>Samo B2B (saloni)</SelectItem>
                  <SelectItem value={SupplierScope.B2C}>Samo B2C (fizička lica)</SelectItem>
                  <SelectItem value={SupplierScope.BOTH}>Oba (B2B i B2C)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Odustani</Button>
            <Button onClick={handleCreate} disabled={createSupplier.isPending}>
              {createSupplier.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Kreiraj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}