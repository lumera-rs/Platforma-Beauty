// @ts-nocheck
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAdminGetB2cDisplaySettings, useAdminUpdateB2cDisplaySettings, getAdminGetB2cDisplaySettingsQueryKey, B2cProductSort } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Settings2, SlidersHorizontal, MonitorSmartphone } from "lucide-react";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";

const sortOptionLabels: Record<keyof typeof B2cProductSort, string> = {
  RECOMMENDED: "Preporučeno",
  PRICE_ASC: "Cena: Rastuće",
  PRICE_DESC: "Cena: Opadajuće",
  NEWEST: "Najnovije",
  BEST_RATED: "Najbolje ocenjeno",
  MOST_POPULAR: "Najpopularnije",
};

const displaySettingsSchema = z.object({
  defaultSort: z.nativeEnum(B2cProductSort),
  enabledSortOptions: z.array(z.nativeEnum(B2cProductSort)).min(1, "Morate omogućiti barem jednu opciju sortiranja."),
  pageSize: z.coerce.number().min(1, "Minimum je 1").max(100, "Maksimum je 100"),
  showOutOfStock: z.boolean(),
  recentlyViewedEnabled: z.boolean(),
  recentlyViewedMax: z.coerce.number().min(1).max(100),
  expectedVersion: z.number().min(1),
});

type DisplaySettingsFormValues = z.infer<typeof displaySettingsSchema>;

export default function AdminB2cDisplaySettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading, isError } = useAdminGetB2cDisplaySettings();
  const updateSettings = useAdminUpdateB2cDisplaySettings();

  const form = useForm<DisplaySettingsFormValues>({
    resolver: zodResolver(displaySettingsSchema),
    defaultValues: {
      defaultSort: "RECOMMENDED",
      enabledSortOptions: ["RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "NEWEST"],
      pageSize: 24,
      showOutOfStock: true,
      recentlyViewedEnabled: true,
      recentlyViewedMax: 10,
      expectedVersion: 1,
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        defaultSort: settings.defaultSort,
        enabledSortOptions: settings.enabledSortOptions,
        pageSize: settings.pageSize,
        showOutOfStock: settings.showOutOfStock,
        recentlyViewedEnabled: settings.recentlyViewedEnabled,
        recentlyViewedMax: settings.recentlyViewedMax,
        expectedVersion: settings.version,
      });
    }
  }, [settings, form]);

  const onSubmit = (values: DisplaySettingsFormValues) => {
    updateSettings.mutate(
      { data: values },
      {
        onSuccess: (newSettings) => {
          qc.setQueryData(getAdminGetB2cDisplaySettingsQueryKey(), newSettings);
          toast.success("B2C podešavanja prikaza su uspešno sačuvana.");
        },
        onError: (error: any) => {
          const isConflict = error?.response?.status === 409;
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
          <AlertDescription>Nismo uspeli da učitamo podešavanja B2C prikaza.</AlertDescription>
        </Alert>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground">B2C Podešavanja Prikaza</h1>
          <p className="text-muted-foreground mt-2">Upravljajte parametrima prikaza kataloga za maloprodajne kupce.</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-primary" /> Sortiranje i Paginacija
                </CardTitle>
                <CardDescription>Podešavanja listanja proizvoda u prodavnici</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="defaultSort"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Podrazumevano sortiranje</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Izaberi sortiranje" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(sortOptionLabels).map(([val, label]) => (
                            <SelectItem key={val} value={val}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Sortiranje koje se primenjuje pri otvaranju kategorije.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="pageSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proizvoda po stranici</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" max="100" {...field} />
                      </FormControl>
                      <FormDescription>Broj proizvoda (1-100) koji se prikazuje na jednoj strani.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="enabledSortOptions"
                  render={() => (
                    <FormItem className="sm:col-span-2">
                      <div className="mb-4">
                        <FormLabel className="text-base">Dozvoljene opcije sortiranja</FormLabel>
                        <FormDescription>
                          Opcije koje će biti ponuđene kupcima u padajućem meniju.
                        </FormDescription>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {Object.entries(sortOptionLabels).map(([val, label]) => (
                          <FormField
                            key={val}
                            control={form.control}
                            name="enabledSortOptions"
                            render={({ field }) => {
                              return (
                                <FormItem
                                  key={val}
                                  className="flex flex-row items-start space-x-3 space-y-0"
                                >
                                  <FormControl>
                                    <Checkbox
                                      checked={field.value?.includes(val as any)}
                                      onCheckedChange={(checked) => {
                                        return checked
                                          ? field.onChange([...field.value, val])
                                          : field.onChange(
                                              field.value?.filter(
                                                (value) => value !== val
                                              )
                                            )
                                      }}
                                    />
                                  </FormControl>
                                  <FormLabel className="font-normal cursor-pointer">
                                    {label}
                                  </FormLabel>
                                </FormItem>
                              )
                            }}
                          />
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MonitorSmartphone className="h-5 w-5 text-primary" /> Prikaz Proizvoda
                </CardTitle>
                <CardDescription>Podešavanja dostupnosti i istorije pregleda</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="showOutOfStock"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Prikazuj rasprodate proizvode</FormLabel>
                        <FormDescription>
                          Da li da se u listingu vide proizvodi kojih trenutno nema na stanju.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="recentlyViewedEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Nedavno pregledani proizvodi</FormLabel>
                        <FormDescription>
                          Prati i prikazuje istoriju pregleda za kupce.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {form.watch("recentlyViewedEnabled") && (
                  <FormField
                    control={form.control}
                    name="recentlyViewedMax"
                    render={({ field }) => (
                      <FormItem className="max-w-xs">
                        <FormLabel>Maksimalan broj istorije</FormLabel>
                        <FormControl>
                          <Input type="number" min="1" max="50" {...field} />
                        </FormControl>
                        <FormDescription>Koliko nedavno pregledanih proizvoda se pamti po korisniku (1-50).</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
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
