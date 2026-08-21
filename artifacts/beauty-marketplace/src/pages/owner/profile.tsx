import { type ReactNode, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CreditCard, ExternalLink, House, Loader2, Save, UserRoundCheck, Video, Zap } from "lucide-react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
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

  useEffect(() => {
    setVideoUrl(salon?.videoUrl ?? "");
    setAcceptsCards(salon?.acceptsCards ?? false);
    setInstantBooking(salon?.instantBooking ?? false);
    setHomeServiceRadiusKm(salon?.homeServiceRadiusKm ?? 10);
    setServesMen(salon?.servesMen ?? false);
  }, [salon]);

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
        </main>
      </div>
    </BusinessLayout>
  );
}