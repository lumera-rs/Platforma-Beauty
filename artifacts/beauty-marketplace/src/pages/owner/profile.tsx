import { type ReactNode, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CircleAlert, Copy, CreditCard, ExternalLink, House, ImagePlus, Loader2, Save, Trash2, UserRoundCheck, Video, Zap } from "lucide-react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { OptimizedImage } from "@/components/optimized-image";
import { MarketingEmailPreferences } from "@/components/marketing-email-preferences";
import { uploadOptimizedImage, type FinalizedMediaAsset } from "@/lib/media-upload";
import {
  getGetManagedSalonProfileQueryKey,
  useGetManagedSalonProfile,
  useUpdateManagedSalonProfile,
} from "@workspace/api-client-react";

export default function OwnerSalonProfile() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: salon, isLoading } = useGetManagedSalonProfile();
  const updateProfile = useUpdateManagedSalonProfile();
  const [videoUrl, setVideoUrl] = useState("");
  const [acceptsCards, setAcceptsCards] = useState(false);
  const [instantBooking, setInstantBooking] = useState(false);
  const [homeServiceRadiusKm, setHomeServiceRadiusKm] = useState(10);
  const [servesMen, setServesMen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [gallery, setGallery] = useState<string[]>([]);
  const [uploading, setUploading] = useState<"profile" | "gallery" | null>(null);
  const [widgetColor, setWidgetColor] = useState("#9b6b54");

  useEffect(() => {
    setVideoUrl(salon?.videoUrl ?? "");
    setAcceptsCards(salon?.acceptsCards ?? false);
    setInstantBooking(salon?.instantBooking ?? false);
    setHomeServiceRadiusKm(salon?.homeServiceRadiusKm ?? 10);
    setServesMen(salon?.servesMen ?? false);
    setImageUrl(salon?.imageUrl ?? "");
    setGallery(salon?.gallery ?? []);
  }, [salon]);

  const uploadProfileImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading("profile");
    try {
      const asset = await uploadOptimizedImage(file, "salon-profile", salon?.id);
      setImageUrl(asset.imageUrl);
      toast.success("Naslovna fotografija je obrađena i spremna za čuvanje.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload fotografije nije uspeo.");
    } finally {
      setUploading(null);
    }
  };

  const uploadGalleryImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, Math.max(0, 20 - gallery.length));
    event.target.value = "";
    if (!files.length) return;
    setUploading("gallery");
    try {
      const assets: FinalizedMediaAsset[] = [];
      for (const file of files) assets.push(await uploadOptimizedImage(file, "salon-gallery", salon?.id));
      setGallery((current) => [...current, ...assets.map((asset) => asset.imageUrl)].slice(0, 20));
      toast.success(files.length === 1 ? "Fotografija je dodata u galeriju." : `${files.length} fotografije su dodate u galeriju.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload galerije nije uspeo.");
    } finally {
      setUploading(null);
    }
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const nextVideoUrl = videoUrl.trim();
    if (nextVideoUrl && !/^https?:\/\//i.test(nextVideoUrl)) {
      toast.error("Unesite pun video URL koji počinje sa http:// ili https://.");
      return;
    }
    updateProfile.mutate(
      {
        data: {
          videoUrl: nextVideoUrl || null,
          acceptsCards,
          instantBooking,
          homeServiceRadiusKm: Number(homeServiceRadiusKm),
          servesMen,
          imageUrl,
          gallery,
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetManagedSalonProfileQueryKey(), updated);
          toast.success("Javni profil i podešavanja pretrage su sačuvani.");
        },
        onError: () => toast.error("Podešavanja javnog profila nisu sačuvana."),
      },
    );
  };

  const setting = (
    id: string,
    icon: ReactNode,
    title: string,
    description: string,
    checked: boolean,
    onCheckedChange: (value: boolean) => void,
  ) => (
    <div className="flex items-center justify-between gap-5 rounded-xl border bg-muted/20 p-4">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 text-primary">{icon}</div>
        <div>
          <label htmlFor={id} className="cursor-pointer font-medium">{title}</label>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
  const widgetUrl = salon ? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/widget/${salon.slug}${widgetColor ? `?boja=${widgetColor.slice(1)}` : ""}` : "";
  const widgetSnippet = `<iframe src="${widgetUrl}" style="border:0;width:100%;max-width:420px;height:640px" title="Zakazivanje"></iframe>`;
  const widgetAvailable = Boolean(salon?.active && salon.isVerified);
  const copyWidgetSnippet = async () => {
    try {
      await navigator.clipboard.writeText(widgetSnippet);
      toast.success("Kod za widget je kopiran.");
    } catch {
      toast.error("Kod nije moguće automatski kopirati. Označite ga i kopirajte ručno.");
    }
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto flex flex-col items-start gap-8 px-4 py-8 md:flex-row">
        <OwnerSidebar current="/vlasnik/profil" />
        <main className="w-full max-w-2xl space-y-6">
          <div>
            <p className="text-sm font-medium text-primary">Javni profil</p>
            <h1 className="mt-1 font-serif text-3xl font-bold">Predstavljanje i dostupnost</h1>
            <p className="mt-2 text-muted-foreground">Podesite šta klijenti vide na profilu i po čemu mogu da pronađu vaš salon.</p>
          </div>

          {isLoading ? (
            <div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : !salon ? (
            <Card><CardContent className="p-6 text-muted-foreground">Profil salona trenutno nije dostupan.</CardContent></Card>
          ) : (
            <form className="space-y-6" onSubmit={save}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />Widget za zakazivanje na vašem sajtu</CardTitle>
                  <CardDescription>Posetioci rezervišu direktno na vašem sajtu, a zahtev stiže kao pending termin koji vi potvrđujete.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {widgetAvailable ? (
                    <>
                      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950" data-testid="widget-status-active">
                        <BadgeCheck className="h-4 w-4" />
                        <AlertTitle>Widget je aktivan</AlertTitle>
                        <AlertDescription>Salon je aktivan i verifikovan. Link i iframe kod ispod mogu odmah da se objave na vašem sajtu.</AlertDescription>
                      </Alert>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="space-y-2"><label htmlFor="widget-color" className="text-sm font-medium">Boja akcija</label><div className="flex items-center gap-2"><input id="widget-color" type="color" value={widgetColor} onChange={(event) => setWidgetColor(event.target.value)} className="h-10 w-12 rounded border p-1" data-testid="widget-color" /><Input value={widgetColor} onChange={(event) => /^#[0-9a-fA-F]{0,6}$/.test(event.target.value) && setWidgetColor(event.target.value)} className="h-10 w-28" /></div></div>
                        <a href={widgetUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted" data-testid="widget-preview">Pregled widgeta <ExternalLink className="ml-2 h-3.5 w-3.5" /></a>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kod za kopiranje</p>
                        <code className="block break-all text-xs leading-5 text-foreground">{widgetSnippet}</code>
                      </div>
                      <Button type="button" variant="outline" onClick={() => void copyWidgetSnippet()} data-testid="widget-copy"><Copy className="mr-2 h-4 w-4" />Kopiraj iframe kod</Button>
                    </>
                  ) : (
                    <Alert className="border-amber-300 bg-amber-50 text-amber-950" data-testid="widget-status-unavailable">
                      <CircleAlert className="h-4 w-4" />
                      <AlertTitle>Widget još nije dostupan za objavljivanje</AlertTitle>
                      <AlertDescription>
                        {!salon.active
                          ? "Salon trenutno nije aktivan. Widget će postati dostupan kada administrator aktivira salon i potvrdi verifikaciju."
                          : "Salon je aktivan, ali verifikacija još nije završena. Nakon administratorske potvrde ovde će se pojaviti pregled i iframe kod; do tada javni widget namerno ostaje nedostupan."}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ImagePlus className="h-5 w-5 text-primary" />Fotografije salona</CardTitle>
                  <CardDescription>Fotografije se bezbedno čuvaju u App Storage-u i automatski dobijaju veličine za telefon, kartice i veliki prikaz.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">Naslovna fotografija</p>
                        <p className="text-sm text-muted-foreground">Prikazuje se u pretrazi i na vrhu profila.</p>
                      </div>
                      <Button asChild type="button" variant="outline" disabled={uploading !== null}>
                        <label className="cursor-pointer">
                          {uploading === "profile" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                          Izaberi fotografiju
                          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void uploadProfileImage(event)} disabled={uploading !== null} />
                        </label>
                      </Button>
                    </div>
                    {imageUrl ? <OptimizedImage src={imageUrl} alt={`Naslovna fotografija salona ${salon.name}`} width={1200} height={800} priority responsiveSizes="(max-width: 768px) 100vw, 640px" className="aspect-[3/2] w-full rounded-xl object-cover" /> : null}
                  </div>

                  <div className="space-y-3 border-t pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">Galerija ({gallery.length}/20)</p>
                        <p className="text-sm text-muted-foreground">Dodajte prostor, radove i atmosferu salona.</p>
                      </div>
                      <Button asChild type="button" variant="outline" disabled={uploading !== null || gallery.length >= 20}>
                        <label className="cursor-pointer">
                          {uploading === "gallery" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
                          Dodaj u galeriju
                          <input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => void uploadGalleryImages(event)} disabled={uploading !== null || gallery.length >= 20} />
                        </label>
                      </Button>
                    </div>
                    {gallery.length ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {gallery.map((url, index) => (
                          <div className="group relative overflow-hidden rounded-lg border" key={`${url}-${index}`}>
                            <OptimizedImage src={url} alt={`Fotografija ${index + 1} salona ${salon.name}`} width={480} height={360} responsiveSizes="(max-width: 640px) 50vw, 210px" preferredSize="medium" className="aspect-[4/3] w-full object-cover" />
                            <Button type="button" size="icon" variant="destructive" className="absolute right-2 top-2 h-8 w-8 opacity-90" aria-label={`Ukloni fotografiju ${index + 1}`} onClick={() => setGallery((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Galerija je prazna.</div>}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Prikaz u pretrazi</CardTitle>
                  <CardDescription>Ove vrednosti koriste se direktno kada klijenti filtriraju salone.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {setting("owner-accepts-cards", <CreditCard className="h-5 w-5" />, "Prima platne kartice", "Klijenti mogu filtrirati salone koji prihvataju plaćanje karticom.", acceptsCards, setAcceptsCards)}
                  {setting("owner-instant-booking", <Zap className="h-5 w-5" />, "Instant zakazivanje", "Termini rezervisani online biće automatski potvrđeni bez čekanja na vašu potvrdu.", instantBooking, setInstantBooking)}
                  {setting("owner-serves-men", <UserRoundCheck className="h-5 w-5" />, "Nudi usluge za muškarce", "Prikazujte salon kada klijent uključi filter „Saloni za muškarce”.", servesMen, setServesMen)}
                  <div className="rounded-xl border p-4">
                    <div className="flex items-start gap-3">
                      <House className="mt-0.5 h-5 w-5 text-primary" />
                      <div className="flex-1">
                        <p className="font-medium">Dolazak na adresu</p>
                        <p className="mt-1 text-sm text-muted-foreground">Dostupnost i naknadu birate za svaku uslugu posebno na stranici Usluge.</p>
                        <div className="mt-3 max-w-xs">
                          <label className="text-xs font-medium" htmlFor="home-service-radius">Radijus pokrivenosti (km)</label>
                          <Input id="home-service-radius" className="mt-1" type="number" min="1" max="100" value={homeServiceRadiusKm} onChange={(event) => setHomeServiceRadiusKm(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-dashed p-4 text-sm">
                    <p className="font-medium">Otvoren nedeljom: {salon.openSunday ? "da" : "ne"}</p>
                    <p className="mt-1 text-muted-foreground">Ova vrednost se automatski preuzima iz vašeg radnog vremena i ne može se ručno uključiti ovde.</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" />Video predstavljanje</CardTitle>
                  <CardDescription>Podržan je javno dostupan video link (npr. MP4). Ostavite polje prazno da uklonite video.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="owner-video-url">Video URL</label>
                    <Input
                      id="owner-video-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://..."
                      value={videoUrl}
                      onChange={(event) => setVideoUrl(event.target.value)}
                    />
                  </div>
                  {salon.videoUrl ? (
                    <a href={salon.videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                      Pogledajte trenutno postavljeni video <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  <Button type="submit" disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Sačuvaj podešavanja
                  </Button>
                </CardContent>
              </Card>
            </form>
          )}
          <MarketingEmailPreferences />
        </main>
      </div>
    </BusinessLayout>
  );
}