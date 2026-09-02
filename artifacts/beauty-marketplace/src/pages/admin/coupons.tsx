import { useState, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, Plus, Search, Edit, Trash2, Ticket, Settings2, Calendar, Tag, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

import { AdminLayout } from "./layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";

import {
  useAdminListProducts,
  useAdminListBundles,
  useAdminListProductCategories,
} from "@workspace/api-client-react";
import {
  useAdminListCoupons,
  useAdminCreateCoupon,
  useAdminUpdateCoupon,
  useAdminDeactivateCoupon,
} from "@/hooks/use-coupons";
import type { Coupon } from "@/types/coupon";

const couponSchema = z.object({
  code: z.string().min(3, "Minimalno 3 karaktera").toUpperCase(),
  active: z.boolean(),
  audience: z.enum(["B2B", "B2C", "ALL"]), // We will map "ALL" to null before sending
  discountType: z.enum(["PERCENTAGE", "FIXED_RSD"]),
  discountValue: z.coerce.number().min(1, "Vrednost mora biti bar 1"),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  minimumSpendRsd: z.coerce.number().min(0, "Ne može biti negativno"),
  maximumSpendRsd: z.coerce.number().min(0).nullable().optional(),
  freeShipping: z.boolean(),
  includeProductIds: z.array(z.string()),
  excludeProductIds: z.array(z.string()),
  includeCategoryIds: z.array(z.string()),
  excludeCategoryIds: z.array(z.string()),
  includeBundleIds: z.array(z.string()),
  excludeBundleIds: z.array(z.string()),
  usageLimit: z.coerce.number().min(1).nullable().optional(),
  perCustomerUsageLimit: z.coerce.number().min(1).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.discountType === "PERCENTAGE" && data.discountValue > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Procenat ne može biti veći od 100",
      path: ["discountValue"],
    });
  }
  if (data.maximumSpendRsd && data.maximumSpendRsd > 0 && data.maximumSpendRsd < data.minimumSpendRsd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Maksimalna potrošnja mora biti veća od minimalne",
      path: ["maximumSpendRsd"],
    });
  }
  if (data.startsAt && data.endsAt && new Date(data.startsAt) >= new Date(data.endsAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Krajnji datum mora biti nakon početnog",
      path: ["endsAt"],
    });
  }
});

type CouponFormValues = z.infer<typeof couponSchema>;

export default function AdminCouponsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);

  const { data: coupons, isLoading, isError } = useAdminListCoupons();
  const createCoupon = useAdminCreateCoupon();
  const updateCoupon = useAdminUpdateCoupon();
  const deactivateCoupon = useAdminDeactivateCoupon();

  // Load dropdown data
  const { data: categoriesResp } = useAdminListProductCategories();
  const { data: productsResp } = useAdminListProducts({ page: 1, pageSize: 1000 });
  const { data: bundlesResp } = useAdminListBundles();

  const categories = categoriesResp || [];
  const products = productsResp?.items || [];
  const bundles = bundlesResp || [];

  const categoryOptions = categories.map(c => ({ value: c.id, label: c.name }));
  const productOptions = products.map(p => ({ value: p.id, label: p.name, keywords: p.sku }));
  const bundleOptions = bundles.map(b => ({ value: b.id, label: b.name }));

  const form = useForm<CouponFormValues>({
    resolver: zodResolver(couponSchema),
    defaultValues: {
      code: "",
      active: true,
      audience: "ALL",
      discountType: "PERCENTAGE",
      discountValue: 10,
      startsAt: "",
      endsAt: "",
      minimumSpendRsd: 0,
      maximumSpendRsd: null,
      freeShipping: false,
      includeProductIds: [],
      excludeProductIds: [],
      includeCategoryIds: [],
      excludeCategoryIds: [],
      includeBundleIds: [],
      excludeBundleIds: [],
      usageLimit: null,
      perCustomerUsageLimit: null,
    }
  });

  const filteredCoupons = useMemo(() => {
    if (!coupons) return [];
    if (!search.trim()) return coupons;
    const lower = search.toLowerCase();
    return coupons.filter(c => c.code.toLowerCase().includes(lower));
  }, [coupons, search]);

  const handleOpenCreate = () => {
    setEditingCoupon(null);
    form.reset({
      code: "",
      active: true,
      audience: "ALL",
      discountType: "PERCENTAGE",
      discountValue: 10,
      startsAt: "",
      endsAt: "",
      minimumSpendRsd: 0,
      maximumSpendRsd: null,
      freeShipping: false,
      includeProductIds: [],
      excludeProductIds: [],
      includeCategoryIds: [],
      excludeCategoryIds: [],
      includeBundleIds: [],
      excludeBundleIds: [],
      usageLimit: null,
      perCustomerUsageLimit: null,
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    form.reset({
      code: coupon.code,
      active: coupon.active,
      audience: coupon.audience || "ALL",
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      startsAt: coupon.startsAt ? coupon.startsAt.slice(0, 16) : "",
      endsAt: coupon.endsAt ? coupon.endsAt.slice(0, 16) : "",
      minimumSpendRsd: coupon.minimumSpendRsd,
      maximumSpendRsd: coupon.maximumSpendRsd,
      freeShipping: coupon.freeShipping,
      includeProductIds: coupon.includeProductIds || [],
      excludeProductIds: coupon.excludeProductIds || [],
      includeCategoryIds: coupon.includeCategoryIds || [],
      excludeCategoryIds: coupon.excludeCategoryIds || [],
      includeBundleIds: coupon.includeBundleIds || [],
      excludeBundleIds: coupon.excludeBundleIds || [],
      usageLimit: coupon.usageLimit,
      perCustomerUsageLimit: coupon.perCustomerUsageLimit,
    });
    setDialogOpen(true);
  };

  const onSubmit = (values: CouponFormValues) => {
    const payload = {
      ...values,
      audience: values.audience === "ALL" ? null : values.audience,
      startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : null,
      endsAt: values.endsAt ? new Date(values.endsAt).toISOString() : null,
      maximumSpendRsd: values.maximumSpendRsd || null,
      usageLimit: values.usageLimit || null,
      perCustomerUsageLimit: values.perCustomerUsageLimit || null,
    };

    if (editingCoupon) {
      updateCoupon.mutate(
        { couponId: editingCoupon.id, data: payload },
        {
          onSuccess: () => {
            toast.success("Kupon je uspešno izmenjen.");
            setDialogOpen(false);
          },
          onError: (err) => toast.error(extractApiError(err, "Nije uspelo čuvanje izmena.")),
        }
      );
    } else {
      createCoupon.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast.success("Kupon je uspešno kreiran.");
            setDialogOpen(false);
          },
          onError: (err) => toast.error(extractApiError(err, "Nije uspelo kreiranje kupona.")),
        }
      );
    }
  };

  const handleDeactivate = (id: string) => {
    if (confirm("Da li ste sigurni da želite da deaktivirate ovaj kupon?")) {
      deactivateCoupon.mutate(
        { couponId: id },
        {
          onSuccess: () => toast.success("Kupon je deaktiviran."),
          onError: (err) => toast.error(extractApiError(err, "Greška pri deaktivaciji.")),
        }
      );
    }
  };

  const discountType = form.watch("discountType");
  const isPercentage = discountType === "PERCENTAGE";

  return (
    <AdminLayout>
      <div className="flex flex-col h-full space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">Kuponi i popusti</h1>
            <p className="text-muted-foreground mt-2">Upravljajte promotivnim kodovima, popustima i besplatnom dostavom.</p>
          </div>
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" /> Novi kupon
          </Button>
        </div>

        <Card className="p-4 flex items-center gap-4 border-border/50 bg-card/50">
          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Pretraga kupona po kodu..."
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
            <p className="text-destructive font-semibold">Došlo je do greške prilikom učitavanja kupona.</p>
          </div>
        ) : filteredCoupons.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[400px] text-center border rounded-xl bg-card">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">Nema kupona</h3>
            <p className="text-muted-foreground max-w-md">Trenutno nemate aktivnih promotivnih kodova.</p>
            <Button variant="outline" className="mt-6" onClick={handleOpenCreate}>Kreiraj prvi kupon</Button>
          </div>
        ) : (
          <Card className="flex-1 overflow-hidden border-border/50">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Kod</TableHead>
                    <TableHead>Popust</TableHead>
                    <TableHead>Ciljna grupa</TableHead>
                    <TableHead>Validnost</TableHead>
                    <TableHead>Iskorišćeno</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Akcije</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCoupons.map((coupon) => (
                    <TableRow key={coupon.id}>
                      <TableCell className="font-bold tracking-wider">{coupon.code}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {coupon.discountType === "PERCENTAGE" 
                              ? `${coupon.discountValue}%` 
                              : `${coupon.discountValue.toLocaleString("sr-RS")} RSD`}
                          </span>
                          {coupon.freeShipping && (
                            <Badge variant="outline" className="w-fit text-[10px] bg-primary/10">Besplatna dostava</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {coupon.audience === "B2B" ? "Samo saloni" : coupon.audience === "B2C" ? "Samo kupci" : "Svi korisnici"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {coupon.startsAt || coupon.endsAt ? (
                          <div className="flex flex-col gap-0.5 text-muted-foreground">
                            {coupon.startsAt && <span>Od: {format(new Date(coupon.startsAt), "dd.MM.yyyy. HH:mm")}</span>}
                            {coupon.endsAt && <span>Do: {format(new Date(coupon.endsAt), "dd.MM.yyyy. HH:mm")}</span>}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Neograničeno</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {coupon.usageCount} {coupon.usageLimit ? `/ ${coupon.usageLimit}` : ""}
                      </TableCell>
                      <TableCell>
                        {coupon.active ? (
                          <Badge className="bg-emerald-500">Aktivno</Badge>
                        ) : (
                          <Badge variant="secondary">Neaktivno</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(coupon)}>
                            <Edit className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          {coupon.active && (
                            <Button variant="ghost" size="icon" onClick={() => handleDeactivate(coupon.id)}>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCoupon ? "Izmeni kupon" : "Novi kupon"}</DialogTitle>
            <DialogDescription>
              Definišite pravila i uslove korišćenja promotivnog koda.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              {/* OSNOVNI PODACI */}
              <div className="space-y-4 border rounded-xl p-4 bg-muted/10">
                <h3 className="font-semibold flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" /> Osnovni podaci
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Promotivni kod *</FormLabel>
                        <FormControl>
                          <Input placeholder="npr. POPUST20" className="uppercase" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="active"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-background">
                        <div className="space-y-0.5">
                          <FormLabel>Status kupona</FormLabel>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="discountType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tip popusta *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Izaberite tip" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="PERCENTAGE">Procenat (%)</SelectItem>
                            <SelectItem value="FIXED_RSD">Fiksni iznos (RSD)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="discountValue"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vrednost popusta *</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input type="number" {...field} value={field.value || ""} />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                              {isPercentage ? "%" : "RSD"}
                            </div>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="freeShipping"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm bg-background sm:col-span-2">
                        <div className="space-y-0.5">
                          <FormLabel>Besplatna dostava</FormLabel>
                          <FormDescription>Da li ovaj kupon takođe omogućava besplatnu dostavu?</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* PRAVILA KORIŠĆENJA */}
              <div className="space-y-4 border rounded-xl p-4 bg-muted/10">
                <h3 className="font-semibold flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-primary" /> Pravila i ograničenja
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="audience"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Ciljna grupa korisnika</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Izaberite publiku" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="ALL">Svi korisnici</SelectItem>
                            <SelectItem value="B2B">Samo saloni (B2B)</SelectItem>
                            <SelectItem value="B2C">Samo fizička lica (B2C)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="minimumSpendRsd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Minimalna potrošnja (RSD)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || 0} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="maximumSpendRsd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Maksimalna potrošnja (RSD)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || ""} placeholder="Bez ograničenja" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="usageLimit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ukupno ograničenje (kom)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || ""} placeholder="Bez ograničenja" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="perCustomerUsageLimit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ograničenje po korisniku</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} value={field.value || ""} placeholder="Bez ograničenja" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="startsAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Počinje od</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endsAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Završava se</FormLabel>
                        <FormControl>
                          <Input type="datetime-local" {...field} value={field.value || ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* SELEKCIJA PROIZVODA */}
              <div className="space-y-4 border rounded-xl p-4 bg-muted/10">
                <h3 className="font-semibold flex items-center gap-2">
                  <Ticket className="w-4 h-4 text-primary" /> Primenljivost
                </h3>
                <p className="text-xs text-muted-foreground">
                  Bez izbora kupon važi za sve pojedinačne proizvode. Paketi se uključuju samo eksplicitnim izborom.
                  Pravila isključivanja uvek imaju prednost.
                </p>
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="includeCategoryIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Važi za kategorije</FormLabel>
                        <FormControl>
                          <SearchableMultiSelect
                            options={categoryOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Izaberite kategorije"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="excludeCategoryIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Isključuje kategorije</FormLabel>
                        <FormControl>
                          <SearchableMultiSelect
                            options={categoryOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Isključite kategorije"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="includeProductIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Važi za proizvode</FormLabel>
                        <FormControl>
                          <SearchableMultiSelect
                            options={productOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Izaberite proizvode"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="excludeProductIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Isključuje proizvode</FormLabel>
                        <FormControl>
                          <SearchableMultiSelect
                            options={productOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Isključite proizvode"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="includeBundleIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Važi za pakete</FormLabel>
                        <FormControl>
                          <SearchableMultiSelect
                            options={bundleOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Izaberite pakete"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="excludeBundleIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Isključuje pakete</FormLabel>
                        <FormControl>
                          <SearchableMultiSelect
                            options={bundleOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Isključite pakete"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Otkaži</Button>
                <Button type="submit" disabled={createCoupon.isPending || updateCoupon.isPending}>
                  {(createCoupon.isPending || updateCoupon.isPending) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Sačuvaj kupon
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
