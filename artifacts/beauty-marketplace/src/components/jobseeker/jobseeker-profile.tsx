import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetJobseekerProfile,
  useUpdateJobseekerProfile,
  useListJobseekerSalonInterests,
  useReplaceJobseekerSalonInterests,
  useListBeautyJobCategories,
  getGetJobseekerProfileQueryKey,
  getListJobseekerSalonInterestsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { uploadOptimizedImage } from "@/lib/media-upload";
import { OptimizedImage } from "@/components/optimized-image";
import { Loader2, X, Image as ImageIcon, BriefcaseBusiness } from "lucide-react";
import { toast } from "sonner";

const profileSchema = z.object({
  bio: z.string().max(4000, "Maksimalno 4000 karaktera").default(""),
  portfolioMedia: z.array(z.string()).min(3, "Potrebno je tačno 3 do 5 slika").max(5, "Maksimalno 5 slika"),
  skillTags: z.array(z.string()).max(30, "Maksimalno 30 veština").default([]),
  categoryTags: z.array(z.string()).max(20, "Maksimalno 20 kategorija").default([]),
});

export default function JobseekerProfile() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading: isLoadingProfile } = useGetJobseekerProfile({
    query: { queryKey: getGetJobseekerProfileQueryKey(), retry: false },
  });
  const { data: interests, isLoading: isLoadingInterests } = useListJobseekerSalonInterests();
  const { data: categories } = useListBeautyJobCategories();
  
  const updateProfile = useUpdateJobseekerProfile();
  const updateInterests = useReplaceJobseekerSalonInterests();
  
  const [isUploading, setIsUploading] = useState(false);
  const [skillInput, setSkillInput] = useState("");

  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      bio: "",
      portfolioMedia: [],
      skillTags: [],
      categoryTags: [],
    },
  });

  useEffect(() => {
    if (profile) {
      form.reset({
        bio: profile.bio || "",
        portfolioMedia: profile.portfolioMedia || [],
        skillTags: profile.skillTags || [],
        categoryTags: profile.categoryTags || [],
      });
    }
  }, [profile, form]);

  if (isLoadingProfile || isLoadingInterests) {
    return (
      <div className="p-6 md:p-8 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const onSubmit = (values: z.infer<typeof profileSchema>) => {
    updateProfile.mutate({ data: values }, {
      onSuccess: () => {
        toast.success("Profil je uspešno ažuriran");
        queryClient.invalidateQueries({ queryKey: getGetJobseekerProfileQueryKey() });
      },
      onError: () => {
        toast.error("Došlo je do greške prilikom čuvanja profila.");
      }
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const currentPhotos = form.getValues("portfolioMedia") || [];
    if (currentPhotos.length + files.length > 5) {
      toast.error("Maksimalan broj slika u portfoliju je 5.");
      return;
    }

    setIsUploading(true);
    try {
      const uploadedUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const result = await uploadOptimizedImage(files[i], "jobseeker-portfolio");
        uploadedUrls.push(result.imageUrl);
      }
      form.setValue("portfolioMedia", [...currentPhotos, ...uploadedUrls], { shouldDirty: true, shouldValidate: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Neuspešno otpremanje slike.");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const removePhoto = (index: number) => {
    const photos = form.getValues("portfolioMedia") || [];
    const newPhotos = [...photos];
    newPhotos.splice(index, 1);
    form.setValue("portfolioMedia", newPhotos, { shouldDirty: true, shouldValidate: true });
  };

  const addSkill = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const newSkill = skillInput.trim();
      if (newSkill) {
        const current = form.getValues("skillTags");
        if (!current.includes(newSkill) && current.length < 30) {
          form.setValue("skillTags", [...current, newSkill], { shouldDirty: true, shouldValidate: true });
        }
        setSkillInput("");
      }
    }
  };

  const removeSkill = (skill: string) => {
    const current = form.getValues("skillTags");
    form.setValue("skillTags", current.filter((s) => s !== skill), { shouldDirty: true, shouldValidate: true });
  };

  const handleClearInterests = () => {
    if (confirm("Da li ste sigurni da želite da uklonite sva interesovanja za salone?")) {
      updateInterests.mutate({ data: { salonIds: [] } }, {
        onSuccess: () => {
          toast.success("Interesovanja uklonjena.");
          queryClient.invalidateQueries({ queryKey: getListJobseekerSalonInterestsQueryKey() });
        }
      });
    }
  };

  const watchPhotos = form.watch("portfolioMedia");
  const watchSkills = form.watch("skillTags");

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Vaš Profil</h1>
        <p className="text-muted-foreground mt-1">Detalji koje poslodavci vide o vama.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Biografija i Iskustvo</CardTitle>
          <CardDescription>Opišite sebe, vaše obrazovanje i dosadašnji rad.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              
              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kratka biografija</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Rođen/a sam u... Moje iskustvo obuhvata..." className="min-h-[150px]" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="categoryTags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kategorije u kojima radite</FormLabel>
                    <div className="flex flex-wrap gap-2 mt-2 p-4 border rounded-xl bg-muted/20">
                      {categories?.categories?.map((cat) => (
                        <label key={cat.id} className="flex items-center gap-1.5 text-sm">
                          <Checkbox
                            checked={field.value.includes(cat.slug)}
                            onCheckedChange={(checked) => {
                              return checked
                                ? field.onChange([...field.value, cat.slug])
                                : field.onChange(field.value.filter((val: string) => val !== cat.slug))
                            }}
                          />
                          {cat.name}
                        </label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <FormLabel>Veštine (pritisnite Enter za dodavanje)</FormLabel>
                <div className="flex flex-wrap gap-2 mb-3">
                  {watchSkills.map((skill) => (
                    <span key={skill} className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm flex items-center gap-1">
                      {skill}
                      <button type="button" onClick={() => removeSkill(skill)} className="hover:text-primary/70">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <Input 
                  placeholder="Dodajte veštinu (npr. Manikir, Balayage, Depilacija)..." 
                  value={skillInput} 
                  onChange={(e) => setSkillInput(e.target.value)} 
                  onKeyDown={addSkill} 
                  disabled={watchSkills.length >= 30}
                />
                <FormDescription>Dodali ste {watchSkills.length}/30 veština.</FormDescription>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div>
                  <FormLabel>Portfolio radova *</FormLabel>
                  <FormDescription>Dodajte između 3 i 5 fotografija vaših najboljih radova.</FormDescription>
                </div>
                
                <div className="flex flex-wrap gap-4">
                  {watchPhotos.map((url: string, idx: number) => (
                    <div key={idx} className="relative w-32 h-32 rounded-lg overflow-hidden border group">
                      <OptimizedImage src={url} alt={`Portfolio ${idx+1}`} width={128} height={128} className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removePhoto(idx)} className="absolute top-1 right-1 bg-black/60 hover:bg-black text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  
                  {watchPhotos.length < 5 && (
                    <label className="flex flex-col items-center justify-center w-32 h-32 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
                      {isUploading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : <ImageIcon className="w-6 h-6 text-muted-foreground" />}
                      <span className="text-xs text-muted-foreground mt-1 text-center px-1">Dodaj fotografiju</span>
                      <input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" multiple onChange={handleImageUpload} disabled={isUploading} />
                    </label>
                  )}
                </div>
                {form.formState.errors.portfolioMedia && (
                  <p className="text-sm font-medium text-destructive">{form.formState.errors.portfolioMedia.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full sm:w-auto" disabled={updateProfile.isPending || isUploading}>
                {updateProfile.isPending ? "Čuvanje..." : "Sačuvaj izmene"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Interesovanja za salone</CardTitle>
          <CardDescription>
            Saloni za koje ste izrazili interesovanje putem njihovog profila.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {interests && interests.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <BriefcaseBusiness className="w-8 h-8 text-primary" />
                <p>Izrazili ste interesovanje za <strong>{interests.length}</strong> salona.</p>
              </div>
              <Button variant="outline" onClick={handleClearInterests} disabled={updateInterests.isPending}>
                Ukloni sva interesovanja
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">Trenutno niste iskazali interesovanje ni za jedan salon.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}