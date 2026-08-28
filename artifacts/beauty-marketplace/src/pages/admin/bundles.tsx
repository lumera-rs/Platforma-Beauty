import { useState, useMemo } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useAdminListBundles,
  useAdminCreateBundle,
  useAdminUpdateBundle,
  useAdminDeactivateBundle,
  useAdminListSuppliers,
  useAdminListProducts,
  useAdminListAftercareTreatments,
  getAdminListBundlesQueryKey,
  getAdminListProductsQueryKey,
  type AdminBundle,
  type AdminProduct
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, Package, Edit, Trash2, Layers, AlertTriangle } from "lucide-react";

import { AdminLayout } from "./layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";

const bundleSchema = z.object({
  supplierId: z.string().min(1, "Izaberite dobavljača"),
  name: z.string().min(1, "Unesite naziv paketa").max(250, "Naziv je predug"),
  description: z.string().max(10000, "Opis je predug").optional(),
  imageUrl: z.string().optional(),
  market: z.enum(["B2B", "B2C", "BOTH"]),
  b2bPrice: z.coerce.number().min(1, "Cena mora biti veća od 0").nullable().optional(),
  b2cPrice: z.coerce.number().min(1, "Cena mora biti veća od 0").nullable().optional(),
  aftercareTreatmentTaxonomyId: z.string().nullable().optional(),
  components: z.array(
    z.object({
      productId: z.string().min(1, "Izaberite proizvod"),
      quantity: z.coerce.number().min(1, "Količina mora biti bar 1"),
      sortOrder: z.number().optional(),
    })
  ).min(2, "Paket mora imati bar 2 proizvoda"),
}).superRefine((data, ctx) => {
  if ((data.market === "B2B" || data.market === "BOTH") && (!data.b2bPrice || data.b2bPrice <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "B2B cena je obavezna za ovo tržište", path: ["b2bPrice"] });
  }
  if ((data.market === "B2C" || data.market === "BOTH") && (!data.b2cPrice || data.b2cPrice <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "B2C cena je obavezna za ovo tržište", path: ["b2cPrice"] });
  }
});

type BundleFormValues = z.infer<typeof bundleSchema>;

export default function AdminBundlesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBundle, setEditingBundle] = useState<AdminBundle | null>(null);

  const { data: bundles, isLoading, isError } = useAdminListBundles();
  const { data: suppliers } = useAdminListSuppliers();
  const { data: treatments } = useAdminListAftercareTreatments();
  const createBundle = useAdminCreateBundle();
  const updateBundle = useAdminUpdateBundle();
  const deactivateBundle = useAdminDeactivateBundle();

  const form = useForm<BundleFormValues>({
    resolver: zodResolver(bundleSchema),
    defaultValues: {
      supplierId: "",
      name: "",
      description: "",
      market: "BOTH",
      b2bPrice: null,
      b2cPrice: null,
      components: [{ productId: "", quantity: 1 }, { productId: "", quantity: 1 }],
    }
  });

  const selectedSupplierId = form.watch("supplierId");
  const { data: supplierProductsResp } = useAdminListProducts({ supplierId: selectedSupplierId }, { query: { enabled: !!selectedSupplierId, queryKey: ['adminListProducts', selectedSupplierId] } });
  const supplierProducts = supplierProductsResp?.items || [];

  const filteredBundles = useMemo(() => {
    if (!bundles) return [];
    if (!search.trim()) return bundles;
    const lower = search.toLowerCase();
    return bundles.filter(b => b.name.toLowerCase().includes(lower));
  }, [bundles, search]);

  const handleOpenCreate = () => {
    setEditingBundle(null);
    form.reset({
      supplierId: "",
      name: "",
      description: "",
      market: "BOTH",
      b2bPrice: null,
      b2cPrice: null,
      aftercareTreatmentTaxonomyId: null,
      components: [{ productId: "", quantity: 1 }, { productId: "", quantity: 1 }],
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (bundle: AdminBundle) => {
    setEditingBundle(bundle);
    form.reset({
      supplierId: bundle.supplierId,
      name: bundle.name,
      description: bundle.description || "",
      imageUrl: bundle.imageUrl || "",
      market: bundle.market,
      b2bPrice: bundle.b2bPrice,
      b2cPrice: bundle.b2cPrice,
      aftercareTreatmentTaxonomyId: bundle.aftercareTreatmentTaxonomyId,
      components: bundle.components.map(c => ({ productId: c.productId, quantity: c.quantity })),
    });
    setDialogOpen(true);
  };

  const onSubmit = (values: BundleFormValues) => {
    if (editingBundle) {
      updateBundle.mutate(
        { bundleId: editingBundle.id, data: { ...values, b2bPrice: values.b2bPrice ?? null, b2cPrice: values.b2cPrice ?? null, imageUrl: values.imageUrl ?? null, description: values.description ?? null, aftercareTreatmentTaxonomyId: values.aftercareTreatmentTaxonomyId ?? null } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getAdminListBundlesQueryKey() });
            toast.success("Paket je uspešno izmenjen.");
            setDialogOpen(false);
          },
          onError: (err) => toast.error("Nije uspelo čuvanje izmena", { description: extractApiError(err, "Pokušajte ponovo.") }),
        }
      );
    } else {
      createBundle.mutate(
        { data: { ...values, b2bPrice: values.b2bPrice ?? null, b2cPrice: values.b2cPrice ?? null, imageUrl: values.imageUrl ?? null, description: values.description ?? null, aftercareTreatmentTaxonomyId: values.aftercareTreatmentTaxonomyId ?? null } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getAdminListBundlesQueryKey() });
            toast.success("Paket je uspešno kreiran.");
            setDialogOpen(false);
          },
          onError: (err) => toast.error("Nije uspelo kreiranje paketa", { description: extractApiError(err, "Pokušajte ponovo.") }),
        }
      );
    }
  };

  const handleDeactivate = (id: string) => {
    if (confirm("Da li ste sigurni da želite da deaktivirate ovaj paket?")) {
      deactivateBundle.mutate({ bundleId: id }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getAdminListBundlesQueryKey() });
          toast.success("Paket je deaktiviran.");
        },
        onError: (err) => toast.error("Greška pri deaktivaciji."),
      });
    }
  };

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "components" });
  const selectedMarket = form.watch("market");

  return (
    <AdminLayout>
      <div className="flex flex-col h-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">Paketi proizvoda (Bundles)</h1>
            <p className="text-muted-foreground mt-2">Upravljajte fiksnim paketima proizvoda koji se prodaju kao celina.</p>
          </div>
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" /> Novi paket
          </Button>
        </div>

        <Card className="p-4 flex items-center gap-4 border-border/50 bg-card/50">
          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pretraga paketa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </Card>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center min-h-[400px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-center border rounded-xl border-destructive/20 bg-destructive/5">
            <p className="text-destructive font-semibold">Došlo je do greške prilikom učitavanja podataka.</p>
          </div>
        ) : filteredBundles.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-center border rounded-xl bg-card">
            <Layers className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">Nema paketa</h3>
            <p className="text-muted-foreground max-w-md">Trenutno nemate kreiranih paketa proizvoda.</p>
            <Button variant="outline" className="mt-6" onClick={handleOpenCreate}>Kreiraj prvi paket</Button>
          </div>
        ) : (
          <Card className="flex-1 overflow-hidden border-border/50">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Naziv</TableHead>
                    <TableHead>Tržište</TableHead>
                    <TableHead>Cena (B2B / B2C)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Komponente</TableHead>
                    <TableHead className="text-right">Akcije</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBundles.map((bundle) => (
                    <TableRow key={bundle.id}>
                      <TableCell className="font-medium">{bundle.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{bundle.market}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {bundle.market === "B2B" || bundle.market === "BOTH" ? (
                          <div className="flex items-center gap-2"><span className="w-8 text-muted-foreground">B2B:</span> {bundle.b2bPrice?.toLocaleString("sr-RS") || 0} RSD</div>
                        ) : null}
                        {bundle.market === "B2C" || bundle.market === "BOTH" ? (
                          <div className="flex items-center gap-2 mt-1"><span className="w-8 text-muted-foreground">B2C:</span> {bundle.b2cPrice?.toLocaleString("sr-RS") || 0} RSD</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {bundle.active ? <Badge className="bg-emerald-500">Aktivno</Badge> : <Badge variant="secondary">Neaktivno</Badge>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {bundle.components.length} stavki ({bundle.components.reduce((acc, c) => acc + c.quantity, 0)} kom)
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(bundle)}>
                            <Edit className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          {bundle.active && (
                            <Button variant="ghost" size="icon" onClick={() => handleDeactivate(bundle.id)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingBundle ? "Izmeni paket" : "Novi paket"}</DialogTitle>
            <DialogDescription>
              Kupci vide paket kao jedan artikal sa ukupnom cenom. Ne vide cene pojedinačnih komponenti.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dobavljač</FormLabel>
                      <Select onValueChange={(val) => { field.onChange(val); form.setValue("components", [{productId: "", quantity: 1}, {productId: "", quantity: 1}]); }} value={field.value} disabled={!!editingBundle}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Izaberite dobavljača" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {suppliers?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="market"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tržište (Gde se prikazuje)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Izaberite tržište" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="B2B">Samo saloni (B2B)</SelectItem>
                          <SelectItem value="B2C">Samo kupci (B2C)</SelectItem>
                          <SelectItem value="BOTH">Svi (BOTH)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Naziv paketa</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {(selectedMarket === "B2B" || selectedMarket === "BOTH") && (
                  <FormField
                    control={form.control}
                    name="b2bPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>B2B Cena (RSD)</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value || ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {(selectedMarket === "B2C" || selectedMarket === "BOTH") && (
                  <FormField
                    control={form.control}
                    name="b2cPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>B2C Cena (RSD)</FormLabel>
                        <FormControl><Input type="number" {...field} value={field.value || ""} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Opis (Opciono)</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="aftercareTreatmentTaxonomyId"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Nega posle tretmana: Povezan tretman (Opciono)</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val === "__none__" ? null : val)}
                        value={field.value || "__none__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Nije povezano sa aftercare uslugom" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">Nije povezano</SelectItem>
                          {treatments?.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.treatmentName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Komponente paketa</h3>
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ productId: "", quantity: 1 })}>
                    <Plus className="w-4 h-4 mr-2" /> Dodaj komponentu
                  </Button>
                </div>

                {fields.map((field, index) => (
                  <div key={field.id} className="flex gap-4 items-start p-4 border rounded-lg bg-muted/20">
                    <FormField
                      control={form.control}
                      name={`components.${index}.productId`}
                      render={({ field: selectField }) => (
                        <FormItem className="flex-1">
                          <FormLabel>Proizvod</FormLabel>
                          <Select onValueChange={selectField.onChange} value={selectField.value} disabled={!selectedSupplierId}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Izaberite proizvod" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {supplierProducts.map((p: AdminProduct) => (
                                <SelectItem key={p.id} value={p.id}>{p.name} (SKU: {p.sku})</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`components.${index}.quantity`}
                      render={({ field: inputField }) => (
                        <FormItem className="w-32">
                          <FormLabel>Količina</FormLabel>
                          <FormControl><Input type="number" min="1" {...inputField} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" className="mt-8 text-destructive" onClick={() => remove(index)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {form.formState.errors.components?.root && (
                  <p className="text-sm font-medium text-destructive">{form.formState.errors.components.root.message}</p>
                )}
                {!selectedSupplierId && (
                  <Alert variant="default" className="bg-muted">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>Izaberite dobavljača kako biste videli proizvode.</AlertDescription>
                  </Alert>
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Otkaži</Button>
                <Button type="submit" disabled={createBundle.isPending || updateBundle.isPending}>
                  {createBundle.isPending || updateBundle.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Sačuvaj paket
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
