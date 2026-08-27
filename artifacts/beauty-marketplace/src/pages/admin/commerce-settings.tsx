import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  useAdminGetCommerceExperience, 
  useAdminUpdateCommerceExperience, 
  getAdminGetCommerceExperienceQueryKey,
  useAdminListProducts,
  useAdminListCommerceBestsellers,
  useAdminListProductCategories,
  CommerceExperienceSettingsSmartSearchMode,
  CommerceExperienceSettingsBestsellerPeriodDays
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Plus, Trash2, LayoutTemplate, Star, MessageSquare } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { OptimizedImage } from "@/components/optimized-image";

const messageSchema = z.object({
  text: z.string().min(1, "Tekst je obavezan").max(200, "Maksimalno 200 karaktera"),
  backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Mora biti validan HEX kod (npr. #FF0000)"),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Mora biti validan HEX kod"),
});

const schema = z.object({
  headerEnabled: z.boolean(),
  headerMessages: z.array(messageSchema).max(10, "Maksimalno 10 poruka"),
  headerIntervalSeconds: z.coerce.number().min(2, "Najmanje 2 sekunde").max(60, "Najviše 60 sekundi"),
  smartSearchMode: z.nativeEnum(CommerceExperienceSettingsSmartSearchMode),
  smartSearchProductIds: z.array(z.string()).max(5, "Najviše 5 proizvoda"),
  bestsellerPeriodDays: z.nativeEnum(CommerceExperienceSettingsBestsellerPeriodDays),
  version: z.number().min(1),
});

type FormValues = z.infer<typeof schema>;

export default function AdminCommerceExperience() {
  const { data: settings, isLoading } = useAdminGetCommerceExperience({
    query: { queryKey: getAdminGetCommerceExperienceQueryKey() }
  });
  
  const updateSettings = useAdminUpdateCommerceExperience();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: productsData } = useAdminListProducts({ page: 1, pageSize: 100 });
  const productOptions = (productsData?.items || []).map(p => ({ value: p.id, label: p.name }));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      headerEnabled: false,
      headerMessages: [],
      headerIntervalSeconds: 5,
      smartSearchMode: "AUTOMATIC",
      smartSearchProductIds: [],
      bestsellerPeriodDays: 30,
      version: 1,
    }
  });

  const { fields: messageFields, append: appendMessage, remove: removeMessage } = useFieldArray({
    control: form.control,
    name: "headerMessages",
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        ...settings,
        smartSearchProductIds: settings.smartSearchProductIds || [],
        headerMessages: settings.headerMessages || [],
      });
    }
  }, [settings, form]);

  const [bestsellerAudience, setBestsellerAudience] = useState<"B2B" | "B2C">("B2C");
  const [bestsellerCategory, setBestsellerCategory] = useState<string>("");

  const { data: categories = [] } = useAdminListProductCategories();
  const { data: bestsellers = [], isLoading: bestsellersLoading } = useAdminListCommerceBestsellers({
    audience: bestsellerAudience,
    periodDays: form.watch("bestsellerPeriodDays"),
    categoryId: bestsellerCategory || undefined
  });

  const onSubmit = (values: FormValues) => {
    updateSettings.mutate({ data: values }, {
      onSuccess: (updated) => {
        form.reset({ ...updated, smartSearchProductIds: updated.smartSearchProductIds || [], headerMessages: updated.headerMessages || [] });
        qc.setQueryData(getAdminGetCommerceExperienceQueryKey(), updated);
        toast.success("Podešavanja su uspešno sačuvana.");
      },
      onError: (err) => {
        toast.error("Greška", { description: extractApiError(err, "Podešavanja nisu sačuvana.") });
      }
    });
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

  return (
    <AdminLayout>
      <div className="container mx-auto p-6 max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-serif text-primary">Iskustvo kupovine</h1>
          <p className="text-muted-foreground mt-2">Prilagodite izgled i ponašanje prodavnice (traka sa obaveštenjima, pretraga, bestseleri).</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5"/> Info traka (Header Bar)</CardTitle>
                <CardDescription>Prikazuje se na vrhu sajta. Može sadržati HTML linkove.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="headerEnabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Prikaži info traku</FormLabel>
                          <FormDescription>Uključi ili isključi prikaz rotirajuće trake.</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="headerIntervalSeconds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Interval rotacije (sekunde)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Poruke</h3>
                    <Button type="button" variant="outline" size="sm" onClick={() => appendMessage({ text: "Nova poruka", backgroundColor: "#000000", textColor: "#ffffff" })} disabled={messageFields.length >= 10}>
                      <Plus className="w-4 h-4 mr-1" /> Dodaj poruku
                    </Button>
                  </div>
                  {messageFields.map((field, index) => (
                    <div key={field.id} className="grid grid-cols-12 gap-4 items-start border p-4 rounded-lg bg-muted/20">
                      <div className="col-span-12 md:col-span-6">
                        <FormField
                          control={form.control}
                          name={`headerMessages.${index}.text`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Tekst poruke / HTML</FormLabel>
                              <FormControl><Input {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-5 md:col-span-2">
                        <FormField
                          control={form.control}
                          name={`headerMessages.${index}.backgroundColor`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Boja pozadine</FormLabel>
                              <div className="flex gap-2 items-center">
                                <FormControl><Input {...field} /></FormControl>
                                <div className="w-8 h-8 rounded border shrink-0" style={{ backgroundColor: field.value }} />
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-5 md:col-span-2">
                        <FormField
                          control={form.control}
                          name={`headerMessages.${index}.textColor`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Boja teksta</FormLabel>
                              <div className="flex gap-2 items-center">
                                <FormControl><Input {...field} /></FormControl>
                                <div className="w-8 h-8 rounded border shrink-0" style={{ backgroundColor: field.value }} />
                              </div>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="col-span-2 md:col-span-2 flex justify-end mt-8">
                        <Button type="button" variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => removeMessage(index)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><LayoutTemplate className="w-5 h-5"/> Pametna pretraga (Smart Search)</CardTitle>
                <CardDescription>Podešavanja za sugestije pri pretrazi (pre nego što kupac počne da kuca).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="smartSearchMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Režim sugestija</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Izaberi režim" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="AUTOMATIC">Automatski (najpopularniji / najnoviji proizvodi)</SelectItem>
                          <SelectItem value="MANUAL">Manuelni izbor proizvoda</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch("smartSearchMode") === "MANUAL" && (
                  <FormField
                    control={form.control}
                    name="smartSearchProductIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Izaberite proizvode (max 5)</FormLabel>
                        <FormControl>
                          <SearchableMultiSelect
                            options={productOptions}
                            value={field.value}
                            onValueChange={field.onChange}
                            placeholder="Pretraži i izaberi proizvode..."
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Star className="w-5 h-5"/> Bestseleri (Najprodavaniji proizvodi)</CardTitle>
                <CardDescription>Period računanja za sekciju najprodavanijih proizvoda.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="bestsellerPeriodDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vremenski period (dani)</FormLabel>
                      <Select onValueChange={(v) => field.onChange(Number(v))} defaultValue={String(field.value)}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Izaberi period" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="30">Poslednjih 30 dana</SelectItem>
                          <SelectItem value="60">Poslednjih 60 dana</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="mt-8 border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">Pregled rangiranja</h3>
                  <div className="flex gap-4 mb-4">
                    <Select value={bestsellerAudience} onValueChange={(v: any) => setBestsellerAudience(v)}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="Publika" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="B2C">B2C</SelectItem>
                        <SelectItem value="B2B">B2B</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Select value={bestsellerCategory} onValueChange={setBestsellerCategory}>
                      <SelectTrigger className="w-64"><SelectValue placeholder="Sve kategorije" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Sve kategorije</SelectItem>
                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {bestsellersLoading ? (
                    <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                  ) : bestsellers.length === 0 ? (
                    <div className="p-8 text-center bg-muted/20 border rounded-lg text-muted-foreground">Nema podataka o prodaji za izabrani period.</div>
                  ) : (
                    <div className="border rounded-lg overflow-hidden bg-background">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold">Rang</th>
                            <th className="px-4 py-2 text-left font-semibold">Slika</th>
                            <th className="px-4 py-2 text-left font-semibold">Proizvod</th>
                            <th className="px-4 py-2 text-right font-semibold">Prodato</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {bestsellers.map((b) => (
                            <tr key={b.productId}>
                              <td className="px-4 py-2 font-bold text-muted-foreground">#{b.rank}</td>
                              <td className="px-4 py-2">
                                <OptimizedImage src={b.imageUrl} alt={b.name} className="w-10 h-10 object-cover rounded bg-muted" width={40} height={40} />
                              </td>
                              <td className="px-4 py-2 font-medium">{b.name}</td>
                              <td className="px-4 py-2 text-right font-semibold text-primary">{b.quantitySold}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end gap-4">
              <Button type="submit" size="lg" disabled={updateSettings.isPending}>
                {updateSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Sačuvaj izmene
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </AdminLayout>
  );
}
