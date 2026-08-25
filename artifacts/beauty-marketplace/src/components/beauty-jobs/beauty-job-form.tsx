import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateBeautyJob,
  useUpdateBeautyJob,
  useListBeautyJobCategories,
  getListBeautyJobCategoriesQueryKey,
  type BeautyJobCreateInput,
  type BeautyJobListing,
  type BeautyJobUpdateInput,
} from "@workspace/api-client-react";
import { uploadOptimizedImage } from "@/lib/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Image as ImageIcon, Loader2, Plus, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { OptimizedImage } from "@/components/optimized-image";

const formSchema = z.object({
  type: z.enum(["job", "equipment_rental", "space_rental", "freelance"]),
  intent: z.enum(["offering", "seeking"]),
  title: z.string().min(3, "Naslov mora imati bar 3 karaktera").max(160),
  description: z.string().min(10, "Opis mora imati bar 10 karaktera").max(10000),
  city: z.string().min(1, "Unesite grad"),
  region: z.string().min(1, "Unesite region/opštinu"),
  categoryId: z.string().uuid("Izaberite kategoriju"),
  priceAmount: z.coerce.number().optional().nullable(),
  pricePeriod: z.enum(["hour", "day", "week", "month", "project", "fixed"]).optional().nullable(),
  negotiable: z.boolean().default(false),
  isUrgent: z.boolean().default(false),
  availabilityPattern: z.string().optional().nullable(),
  dayLabels: z.array(z.string()).default([]),
  availableSlots: z.array(z.object({
    id: z.string().optional(),
    startsAt: z.string(),
    endsAt: z.string(),
    available: z.boolean().optional(),
  })).max(100).default([]),
  photos: z.array(z.string()).max(8, "Maksimalno 8 slika").default([]),
}).refine(data => {
  if ((data.type === "equipment_rental" || data.type === "space_rental") && !data.availabilityPattern) {
    return false;
  }
  return true;
}, {
  message: "Raspoloživost je obavezna za oglase o iznajmljivanju",
  path: ["availabilityPattern"]
}).superRefine((data, context) => {
  if (!["equipment_rental", "space_rental"].includes(data.type) || data.intent !== "offering") return;
  if (!data.availableSlots.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["availableSlots"], message: "Dodajte bar jedan konkretan termin" });
    return;
  }
  const sorted = [...data.availableSlots].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  sorted.forEach((slot, index) => {
    const start = new Date(slot.startsAt);
    const end = new Date(slot.endsAt);
    if (!slot.startsAt || !slot.endsAt || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["availableSlots"], message: "Svaki termin mora imati ispravan početak i kraj" });
    }
    if (index > 0 && start < new Date(sorted[index - 1]!.endsAt)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["availableSlots"], message: "Termini se ne smeju preklapati" });
    }
  });
});

type FormValues = z.infer<typeof formSchema>;

interface BeautyJobFormProps {
  initialData?: BeautyJobListing | null;
  onSuccess: () => void;
  onCancel: () => void;
  open: boolean;
}

const daysOfWeek = ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"];
const pricePeriods = ["hour", "day", "week", "month", "project", "fixed"] as const;

function isPricePeriod(value: string | null): value is (typeof pricePeriods)[number] {
  return value !== null && (pricePeriods as readonly string[]).includes(value);
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function BeautyJobForm({ initialData, onSuccess, onCancel, open }: BeautyJobFormProps) {
  const createMutation = useCreateBeautyJob();
  const updateMutation = useUpdateBeautyJob();
  const [isUploading, setIsUploading] = useState(false);

  const { data: categories } = useListBeautyJobCategories({
    query: { queryKey: getListBeautyJobCategoriesQueryKey() }
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "job",
      intent: "offering",
      title: "",
      description: "",
      city: "",
      region: "",
      categoryId: "",
      priceAmount: null,
      pricePeriod: null,
      negotiable: false,
      availabilityPattern: "",
      dayLabels: [],
      availableSlots: [],
      photos: []
    }
  });

  useEffect(() => {
    if (initialData && open) {
      form.reset({
        type: initialData.type,
        intent: initialData.intent,
        title: initialData.title,
        description: initialData.description,
        city: initialData.city,
        region: initialData.region,
        categoryId: initialData.categoryId,
        priceAmount: initialData.priceAmount,
        pricePeriod: isPricePeriod(initialData.pricePeriod) ? initialData.pricePeriod : null,
        negotiable: initialData.negotiable,
        isUrgent: initialData.isUrgent || false,
        availabilityPattern: initialData.availabilityPattern || "",
        dayLabels: initialData.dayLabels || [],
        availableSlots: (initialData.availableSlots || []).map((slot) => ({
          id: slot.id,
          startsAt: toLocalDateTimeInput(slot.startsAt),
          endsAt: toLocalDateTimeInput(slot.endsAt),
          available: slot.available,
        })),
        photos: initialData.photos || []
      });
    } else if (open) {
      form.reset({
        type: "job",
        intent: "offering",
        title: "",
        description: "",
        city: "",
        region: "",
        categoryId: "",
        priceAmount: null,
        pricePeriod: null,
        negotiable: false,
        isUrgent: false,
        availabilityPattern: "",
        dayLabels: [],
        availableSlots: [],
        photos: []
      });
    }
  }, [initialData, open, form]);

  const watchPhotos = form.watch("photos") || [];

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const currentPhotos = form.getValues("photos") || [];
    if (currentPhotos.length + files.length > 8) {
      toast.error("Maksimalan broj slika je 8.");
      return;
    }

    setIsUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const result = await uploadOptimizedImage(files[i]);
        uploadedUrls.push(result.imageUrl);
      }
      form.setValue("photos", [...currentPhotos, ...uploadedUrls], { shouldDirty: true, shouldValidate: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Neuspešno otpremanje slike.");
    } finally {
      setIsUploading(false);
      // reset input
      e.target.value = "";
    }
  };

  const removePhoto = (index: number) => {
    const photos = form.getValues("photos") || [];
    const newPhotos = [...photos];
    newPhotos.splice(index, 1);
    form.setValue("photos", newPhotos, { shouldDirty: true, shouldValidate: true });
  };

  const onSubmit = (data: FormValues) => {
    const availableSlots = data.availableSlots.map((slot) => ({
      id: slot.id,
      startsAt: new Date(slot.startsAt).toISOString(),
      endsAt: new Date(slot.endsAt).toISOString(),
    }));
    const payload: BeautyJobCreateInput = {
      type: data.type,
      intent: data.intent,
      title: data.title,
      description: data.description,
      city: data.city,
      region: data.region,
      categoryId: data.categoryId,
      negotiable: data.negotiable,
      isUrgent: data.type === "freelance" ? data.isUrgent : false,
      dayLabels: data.dayLabels,
      photos: data.photos,
      priceAmount: data.priceAmount ?? undefined,
      pricePeriod: data.pricePeriod || undefined,
      availabilityPattern: data.availabilityPattern || undefined,
      availableSlots,
    };

    if (initialData) {
      const updatePayload: BeautyJobUpdateInput = {
        ...payload,
        priceAmount: data.priceAmount,
        pricePeriod: data.pricePeriod,
        isUrgent: data.type === "freelance" ? data.isUrgent : false,
        availabilityPattern: data.availabilityPattern || null,
      };
      updateMutation.mutate({ listingId: initialData.id, data: updatePayload }, {
        onSuccess: () => {
          toast.success("Oglas uspešno ažuriran.");
          onSuccess();
        },
        onError: () => toast.error("Došlo je do greške prilikom ažuriranja.")
      });
    } else {
      createMutation.mutate({ data: payload }, {
        onSuccess: () => {
          toast.success("Oglas uspešno kreiran.");
          onSuccess();
        },
        onError: () => toast.error("Došlo je do greške prilikom kreiranja.")
      });
    }
  };

  const typeWatch = form.watch("type");
  const intentWatch = form.watch("intent");
  const requiresAvailability = typeWatch === "equipment_rental" || typeWatch === "space_rental";
  const requiresConcreteSlots = requiresAvailability && intentWatch === "offering";
  const watchedSlots = form.watch("availableSlots");

  // Filter categories based on type
  const availableCategories = categories?.categories?.filter(cat => {
    // If it's a rental, maybe restrict to specific categories? 
    // Wait, the rule says: "rental types only their matching rental category; job/freelance exclude rental-only categories"
    if (typeWatch === "space_rental") return cat.slug === "iznajmljivanje-prostora-stolice";
    if (typeWatch === "equipment_rental") return cat.slug === "iznajmljivanje-opreme";
    return !cat.slug.includes("prostor") && !cat.slug.includes("oprem");
  });

  // Clear category if it becomes incompatible
  useEffect(() => {
    const currentCat = form.getValues("categoryId");
    if (currentCat && availableCategories) {
      if (!availableCategories.find(c => c.id === currentCat)) {
        form.setValue("categoryId", "", { shouldDirty: true, shouldValidate: true });
      }
    }
  }, [typeWatch, availableCategories, form]);

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onCancel()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? "Izmeni oglas" : "Novi oglas"}</DialogTitle>
          <DialogDescription>
            {initialData ? "Ažurirajte detalje vašeg oglasa." : "Popunite detalje za objavljivanje oglasa na Beauty Poslovi."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tip *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Izaberite tip" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="job">Posao</SelectItem>
                        <SelectItem value="equipment_rental">Oprema</SelectItem>
                        <SelectItem value="space_rental">Prostor / Stolica</SelectItem>
                        <SelectItem value="freelance">Freelance</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="intent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namera *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Nudim ili Tražim" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="offering">Nudim / Izdajem / Tražim radnika</SelectItem>
                        <SelectItem value="seeking">Tražim posao / prostor / opremu</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kategorija *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Izaberite kategoriju" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {availableCategories?.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {requiresConcreteSlots && (
                <div className="space-y-3 rounded-lg border bg-background p-4 md:col-span-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /> Konkretni termini *</p>
                      <p className="text-xs text-muted-foreground mt-1">Prikazuju se samo datum i vreme. Precizna adresa ostaje privatna.</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => {
                      form.setValue("availableSlots", [...watchedSlots, { startsAt: "", endsAt: "", available: true }], { shouldDirty: true, shouldValidate: true });
                    }}>
                      <Plus className="h-4 w-4 mr-1" /> Dodaj
                    </Button>
                  </div>
                  {watchedSlots.length === 0 ? (
                    <p className="text-sm text-muted-foreground border border-dashed rounded-md p-3">Dodajte termine koje korisnici mogu da zatraže.</p>
                  ) : (
                    <div className="space-y-3">
                      {watchedSlots.map((slot, index) => (
                        <div key={slot.id ?? index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                          <div className="space-y-1">
                            <Label htmlFor={`slot-start-${index}`}>Početak</Label>
                            <Input id={`slot-start-${index}`} type="datetime-local" value={slot.startsAt} disabled={slot.available === false} onChange={(event) => {
                              const next = [...watchedSlots]; next[index] = { ...slot, startsAt: event.target.value };
                              form.setValue("availableSlots", next, { shouldDirty: true, shouldValidate: true });
                            }} />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`slot-end-${index}`}>Kraj</Label>
                            <Input id={`slot-end-${index}`} type="datetime-local" value={slot.endsAt} disabled={slot.available === false} onChange={(event) => {
                              const next = [...watchedSlots]; next[index] = { ...slot, endsAt: event.target.value };
                              form.setValue("availableSlots", next, { shouldDirty: true, shouldValidate: true });
                            }} />
                          </div>
                          <Button type="button" size="icon" variant="ghost" disabled={slot.available === false} aria-label="Ukloni termin" onClick={() => {
                            form.setValue("availableSlots", watchedSlots.filter((_, slotIndex) => slotIndex !== index), { shouldDirty: true, shouldValidate: true });
                          }}><X className="h-4 w-4" /></Button>
                          {slot.available === false && <p className="sm:col-span-3 text-xs text-primary">Ovaj termin je rezervisan i ne može se menjati.</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {form.formState.errors.availableSlots?.message && <p className="text-sm font-medium text-destructive">{form.formState.errors.availableSlots.message}</p>}
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Naslov oglasa *</FormLabel>
                  <FormControl>
                    <Input placeholder="Npr. Potreban iskusni frizer..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Detaljan opis *</FormLabel>
                  <FormControl>
                    <Textarea className="min-h-[150px]" placeholder="Opišite detaljno šta nudite ili tražite..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Grad *</FormLabel>
                    <FormControl>
                      <Input placeholder="Npr. Beograd" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="region"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opština / Deo grada *</FormLabel>
                    <FormControl>
                      <Input placeholder="Npr. Vračar" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4 p-4 rounded-xl border bg-muted/20">
              <h4 className="font-medium text-sm">Finansijski detalji (opciono)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="priceAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Iznos (RSD ili %)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Npr. 50000" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pricePeriod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Period / Tip</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Izaberite" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="month">Mesečno</SelectItem>
                          <SelectItem value="week">Nedeljno</SelectItem>
                          <SelectItem value="day">Dnevno</SelectItem>
                          <SelectItem value="hour">Po satu</SelectItem>
                          <SelectItem value="project">Po projektu</SelectItem>
                          <SelectItem value="fixed">Fiksno</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="negotiable"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-2">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Cena je po dogovoru</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            {typeWatch === "freelance" && (
              <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 mt-4">
                <FormField
                  control={form.control}
                  name="isUrgent"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel className="text-destructive font-semibold">Označi kao HITNO</FormLabel>
                        <FormDescription>
                          Vaš oglas će biti istaknut crvenom značkom. Koristite samo ako ste slobodni odmah i tražite posao u najkraćem roku.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="space-y-4 p-4 rounded-xl border bg-muted/20">
              <h4 className="font-medium text-sm">Vreme i raspoloživost {requiresAvailability && "*"}</h4>
              <FormField
                control={form.control}
                name="availabilityPattern"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Obrazac raspoloživosti {requiresAvailability && "*"}</FormLabel>
                    <FormControl>
                      <Input placeholder="Npr. Puno radno vreme, ili Prepodnevna smena" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dayLabels"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Radni dani</FormLabel>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {daysOfWeek.map((day) => (
                        <label key={day} className="flex items-center gap-1.5 text-sm">
                          <Checkbox
                            checked={field.value.includes(day)}
                            onCheckedChange={(checked) => {
                              return checked
                                ? field.onChange([...field.value, day])
                                : field.onChange(field.value.filter((val: string) => val !== day))
                            }}
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <FormLabel>Slike (do 8 slika, max 8MB po slici)</FormLabel>
              
              <div className="flex flex-wrap gap-4">
                {watchPhotos.map((url: string, idx: number) => (
                  <div key={idx} className="relative w-24 h-24 rounded-lg overflow-hidden border group">
                    <OptimizedImage src={url} alt={`Slika ${idx+1}`} width={100} height={100} className="w-full h-full object-cover" />
                    <button type="button" onClick={() => removePhoto(idx)} className="absolute top-1 right-1 bg-black/50 hover:bg-black text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                
                {watchPhotos.length < 8 && (
                  <label className="flex flex-col items-center justify-center w-24 h-24 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                    {isUploading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
                    <span className="text-xs text-muted-foreground mt-1 text-center px-1">Dodaj</span>
                    <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={handleImageUpload} disabled={isUploading} />
                  </label>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="ghost" onClick={onCancel}>Odustani</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || isUploading}>
                {createMutation.isPending || updateMutation.isPending ? "Čuvanje..." : (initialData ? "Sačuvaj izmene" : "Objavi oglas")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}