import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getApiErrorDetails, useAdminGetShopSettings, useAdminUpdateShopSettings, getAdminGetShopSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Store, Truck, Bell, Award, Settings2, Building } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const sellerFieldNames = [
  "sellerCompanyName",
  "sellerTaxId",
  "sellerRegistrationNumber",
  "sellerAddress",
  "sellerCity",
  "sellerPostalCode",
  "sellerBankAccount",
  "sellerContactEmail",
  "sellerContactPhone",
] as const;

const shopSettingsSchema = z.object({
  freeShippingThreshold: z.coerce.number().min(0, "Prag ne može biti negativan"),
  showLoyaltyPoints: z.boolean(),
  pointsPer100Rsd: z.coerce.number().min(0, "Bodovi ne mogu biti negativni"),
  lowStockThreshold: z.coerce.number().min(1, "Prag mora biti bar 1"),
  defaultDeliveryBusinessDays: z.coerce.number().min(1, "Najmanje 1 dan").max(365, "Najviše 365 dana"),
  retailCartReminderEnabled: z.boolean().default(false),
  retailCartReminderDelayHours: z.coerce.number().min(1).max(720).optional().nullable(),
  retailCartReminderBrevoTemplateId: z.coerce.number().optional().nullable(),
  sellerCompanyName: z.string().optional().nullable(),
  sellerTaxId: z.string().optional().nullable(),
  sellerRegistrationNumber: z.string().optional().nullable(),
  sellerAddress: z.string().optional().nullable(),
  sellerCity: z.string().optional().nullable(),
  sellerPostalCode: z.string().optional().nullable(),
  sellerBankAccount: z.string().optional().nullable(),
  sellerContactEmail: z.union([z.string().email("Neispravna email adresa"), z.literal(""), z.null()]).optional(),
  sellerContactPhone: z.string().optional().nullable(),
  version: z.number().min(1),
}).superRefine((values, ctx) => {
  const sellerValues = sellerFieldNames.map((field) => values[field]?.trim() ?? "");
  if (!sellerValues.some(Boolean) || sellerValues.every(Boolean)) return;
  sellerFieldNames.forEach((field, index) => {
    if (!sellerValues[index]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Obavezno za B2B fakture" });
    }
  });
});

type ShopSettingsFormValues = z.infer<typeof shopSettingsSchema>;

export default function AdminShopSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading, isError } = useAdminGetShopSettings();
  const updateSettings = useAdminUpdateShopSettings();

  const form = useForm<ShopSettingsFormValues>({
    resolver: zodResolver(shopSettingsSchema),
    defaultValues: {
      freeShippingThreshold: 0,
      showLoyaltyPoints: false,
      pointsPer100Rsd: 0,
      lowStockThreshold: 1,
      defaultDeliveryBusinessDays: 1,
      retailCartReminderEnabled: false,
      sellerCompanyName: "",
      sellerTaxId: "",
      sellerRegistrationNumber: "",
      sellerAddress: "",
      sellerCity: "",
      sellerPostalCode: "",
      sellerBankAccount: "",
      sellerContactEmail: "",
      sellerContactPhone: "",
      version: 1,
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        freeShippingThreshold: settings.freeShippingThreshold,
        showLoyaltyPoints: settings.showLoyaltyPoints,
        pointsPer100Rsd: settings.pointsPer100Rsd,
        lowStockThreshold: settings.lowStockThreshold,
        defaultDeliveryBusinessDays: settings.defaultDeliveryBusinessDays,
        retailCartReminderEnabled: settings.retailCartReminderEnabled ?? false,
        retailCartReminderDelayHours: settings.retailCartReminderDelayHours,
        retailCartReminderBrevoTemplateId: settings.retailCartReminderBrevoTemplateId,
        sellerCompanyName: settings.seller.companyName,
        sellerTaxId: settings.seller.taxId,
        sellerRegistrationNumber: settings.seller.registrationNumber,
        sellerAddress: settings.seller.address,
        sellerCity: settings.seller.city,
        sellerPostalCode: settings.seller.postalCode,
        sellerBankAccount: settings.seller.bankAccount,
        sellerContactEmail: settings.seller.contactEmail,
        sellerContactPhone: settings.seller.contactPhone,
        version: settings.version,
      });
    }
  }, [settings, form]);

  const onSubmit = (values: ShopSettingsFormValues) => {
    const text = (value: string | null | undefined) => (value ?? "").trim();
    const seller = {
      companyName: text(values.sellerCompanyName),
      taxId: text(values.sellerTaxId),
      registrationNumber: text(values.sellerRegistrationNumber),
      address: text(values.sellerAddress),
      city: text(values.sellerCity),
      postalCode: text(values.sellerPostalCode),
      bankAccount: text(values.sellerBankAccount),
      contactEmail: text(values.sellerContactEmail),
      contactPhone: text(values.sellerContactPhone),
    };
    const data = {
      freeShippingThreshold: values.freeShippingThreshold,
      showLoyaltyPoints: values.showLoyaltyPoints,
      pointsPer100Rsd: values.pointsPer100Rsd,
      lowStockThreshold: values.lowStockThreshold,
      defaultDeliveryBusinessDays: values.defaultDeliveryBusinessDays,
      retailCartReminderEnabled: values.retailCartReminderEnabled,
      retailCartReminderDelayHours: values.retailCartReminderDelayHours ?? undefined,
      retailCartReminderBrevoTemplateId: values.retailCartReminderBrevoTemplateId ?? null,
      version: values.version,
      ...(Object.values(seller).some(Boolean) ? { seller } : {}),
    };
    updateSettings.mutate(
      { data },
      {
        onSuccess: (newSettings) => {
          qc.setQueryData(getAdminGetShopSettingsQueryKey(), newSettings);
          toast.success("Podešavanja prodavnice su uspešno sačuvana.");
        },
        onError: (error: unknown) => {
          const isConflict = getApiErrorDetails(error).status === 409;
          toast.error(
            isConflict ? "Neko je već izmenio podešavanja u međuvremenu. Osvežite stranicu." : extractApiError(error, "Nije uspelo čuvanje podešavanja.")
          );
        }
      }
    );
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  if (isError || !settings) {
    return (
      <AdminLayout>
        <Alert variant="destructive" className="m-8 max-w-xl mx-auto">
          <AlertTitle>Greška</AlertTitle>
          <AlertDescription>Nismo uspeli da učitamo podešavanja prodavnice.</AlertDescription>
        </Alert>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">Podešavanja prodavnice</h1>
          <p className="text-muted-foreground mt-2">Upravljajte opštim parametrima e-commerce modula.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-primary" /> Dostava
                </CardTitle>
                <CardDescription>Podešavanja vezana za isporuku pošiljki</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="freeShippingThreshold"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prag za besplatnu dostavu (RSD)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormDescription>Minimalan iznos u korpi za besplatnu dostavu.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultDeliveryBusinessDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Podrazumevano vreme dostave</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" max="365" {...field} />
                      </FormControl>
                      <FormDescription>Broj radnih dana za isporuku.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-primary" /> Loyalty program
                </CardTitle>
                <CardDescription>Prikaz i obračun loyalty bodova za B2B korisnike</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="showLoyaltyPoints"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Prikaži loyalty bodove</FormLabel>
                        <FormDescription>
                          Da li vlasnici salona vide bodove pri kupovini u korpi.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pointsPer100Rsd"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bodova za svakih 100 RSD</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.1" {...field} disabled={!form.watch("showLoyaltyPoints")} />
                      </FormControl>
                      <FormDescription>Koliko bodova korisnik dobija za 100 RSD potrošenih u prodavnici.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-primary" /> Zalihe
                </CardTitle>
                <CardDescription>Podešavanja za upozorenja o stanju zaliha</CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="lowStockThreshold"
                  render={({ field }) => (
                    <FormItem className="max-w-md">
                      <FormLabel>Prag za niske zalihe (kom)</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" {...field} />
                      </FormControl>
                      <FormDescription>Ako proizvod ima manju ili jednaku količinu, korisnicima se prikazuje upozorenje o niskim zalihama.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-primary" /> Napuštena korpa (Maloprodaja)
                </CardTitle>
                <CardDescription>Podešavanja za automatsko obaveštavanje kupaca o zaboravljenim proizvodima u korpi.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="retailCartReminderEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Aktiviraj podsetnik</FormLabel>
                        <FormDescription>
                          Automatski šalje email kupcima koji su ostavili proizvode u korpi.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {form.watch("retailCartReminderEnabled") && (
                  <div className="grid sm:grid-cols-2 gap-6 p-4 border rounded-lg bg-muted/20">
                    <FormField
                      control={form.control}
                      name="retailCartReminderDelayHours"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kašnjenje (sati)</FormLabel>
                          <FormControl>
                            <Input type="number" min="1" max="720" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormDescription>Koliko sati nakon poslednje izmene korpe se šalje podsetnik.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="retailCartReminderBrevoTemplateId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Brevo Template ID</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} value={field.value || ""} />
                          </FormControl>
                          <FormDescription>ID šablona iz Brevo sistema.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building className="h-5 w-5 text-primary" /> Podaci o prodavcu (Fakture)
                </CardTitle>
                <CardDescription>Ovi podaci će biti prikazani na fakturama koje se izdaju kupcima.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="sellerCompanyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Naziv firme</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. LUMERA d.o.o." {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerTaxId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>PIB</FormLabel>
                      <FormControl>
                        <Input placeholder="10XXXXXXX" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerRegistrationNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Matični broj</FormLabel>
                      <FormControl>
                        <Input placeholder="XXXXXXXX" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Adresa sedišta</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. Bulevar oslobođenja 12" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerCity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grad</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. Novi Sad" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerPostalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Poštanski broj</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. 21000" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerBankAccount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Broj tekućeg računa</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. XXX-XXXXXXXXX-XX" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerContactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kontakt Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="npr. info@lumera.rs" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sellerContactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kontakt telefon</FormLabel>
                      <FormControl>
                        <Input placeholder="npr. 06X XXX XXX" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end pt-4">
              <Button type="submit" size="lg" disabled={updateSettings.isPending}>
                {updateSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Sačuvaj promene
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </AdminLayout>
  );
}
