import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Save, Video } from "lucide-react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

  useEffect(() => {
    setVideoUrl(salon?.videoUrl ?? "");
  }, [salon?.videoUrl]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const nextVideoUrl = videoUrl.trim();
    if (nextVideoUrl && !/^https?:\/\//i.test(nextVideoUrl)) {
      toast.error("Unesite pun video URL koji počinje sa http:// ili https://.");
      return;
    }
    updateProfile.mutate(
      { data: { videoUrl: nextVideoUrl || null } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetManagedSalonProfileQueryKey(), updated);
          toast.success("Video predstavljanje je sačuvano.");
        },
        onError: () => toast.error("Video predstavljanje nije sačuvano."),
      },
    );
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto flex flex-col items-start gap-8 px-4 py-8 md:flex-row">
        <OwnerSidebar current="/vlasnik/profil" />
        <main className="w-full max-w-2xl space-y-6">
          <div>
            <p className="text-sm font-medium text-primary">Javni profil</p>
            <h1 className="mt-1 font-serif text-3xl font-bold">Predstavljanje salona</h1>
            <p className="mt-2 text-muted-foreground">Dodajte video koji će klijenti videti prvi u galeriji vašeg salona.</p>
          </div>

          {isLoading ? (
            <div className="flex justify-center p-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : !salon ? (
            <Card><CardContent className="p-6 text-muted-foreground">Profil salona trenutno nije dostupan.</CardContent></Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-primary" />Video predstavljanje</CardTitle>
                <CardDescription>Podržan je javno dostupan video link (npr. MP4). Ostavite polje prazno da uklonite video.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-5" onSubmit={save}>
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
                    Sačuvaj video
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </main>
      </div>
    </BusinessLayout>
  );
}