import { AdminLayout } from "./layout";
import { useAdminGetMetaCatalogStatus, useAdminValidateMetaCatalog } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Facebook, CheckCircle, AlertTriangle, XCircle, ExternalLink, Activity, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function AdminSocialMedia() {
  const { data: status, isLoading } = useAdminGetMetaCatalogStatus();
  const validateCatalog = useAdminValidateMetaCatalog();
  const { toast } = useToast();
  const qc = useQueryClient();

  const handleValidate = () => {
    validateCatalog.mutate(undefined, {
      onSuccess: (result) => {
        if (result.run.validationErrors.length) toast.error("Validacija je završena sa greškama.");
        else toast.success("Katalog je uspešno validiran. Prikazani su najnoviji podaci.");
        qc.invalidateQueries({ queryKey: ["admin", "meta-catalog-status"] });
      },
      onError: () => toast.error("Nije moguće izvršiti validaciju kataloga u ovom trenutku.")
    });
  };

  const feedUrl = `${window.location.origin}/api/catalog/feed`;
  const latestRun = status?.latestRun;
  const validationErrors = latestRun?.validationErrors ?? [];

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-bold text-foreground">Društvene mreže (Meta)</h1>
        <p className="text-muted-foreground">Upravljanje integracijom sa Facebook i Instagram prodavnicama (Meta Commerce Manager).</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Facebook className="w-5 h-5 text-[#1877F2]" /> 
                Status integracije
                {isLoading ? null : (
                  <Badge variant={(status?.connectionStatus as string) === 'NOT_CONNECTED' ? 'destructive' : (status?.connectionStatus as string) === 'ERROR' ? 'destructive' : 'default'} className="ml-auto">
                    {(status?.connectionStatus as string) === 'CONNECTED' ? 'Povezano' : (status?.connectionStatus as string) === 'NOT_CONNECTED' ? 'Nije povezano' : 'Greška u konekciji'}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading || !status ? (
                <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <>
                  <div className="bg-muted/10 p-4 rounded-xl border">
                    <p className="text-sm text-muted-foreground font-semibold mb-2">URL Data Feed-a (XML)</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted p-2 rounded flex-1 overflow-x-auto whitespace-nowrap border select-all">
                        {feedUrl}
                      </code>
                      <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(feedUrl); toast.success("URL iskopiran"); }}>
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Kopirajte ovaj URL i dodajte ga u Facebook Commerce Manager (Data sources &gt; Data feed).</p>
                  </div>

                  {(status.connectionStatus as string) === 'NOT_CONNECTED' && (
                    <div className="bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 p-4 rounded-xl flex gap-3">
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-sm mb-1">Katalog trenutno nije povezan na Meta</p>
                        <p className="text-xs">Potrebna je Meta Connector autorizacija kako bi se ostvarila aktivna veza. Zbog sigurnosnih razloga, integracija trenutno ne podržava direktno povezivanje naloga.</p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="border rounded-xl p-4 flex flex-col justify-center items-center text-center">
                      <p className="text-3xl font-bold text-primary">{latestRun ? latestRun.itemCount : "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1">Artikala u poslednjoj proveri</p>
                    </div>
                    <div className="border rounded-xl p-4 flex flex-col justify-center items-center text-center">
                      <p className="text-3xl font-bold text-destructive">{latestRun ? validationErrors.length : "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1">Detektovanih grešaka</p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter className="bg-muted/5 border-t py-4">
              <Button onClick={handleValidate} disabled={validateCatalog.isPending} className="w-full">
                {validateCatalog.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Osveži status i proveri greške
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5 text-muted-foreground" /> Izveštaj o validaciji feed-a</CardTitle>
              <CardDescription>Eventualne greške u podacima proizvoda koje sprečavaju Meta platformu da ih ispravno prikaže.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading || !status ? (
                <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : !latestRun ? (
                <div className="py-8 text-center text-muted-foreground">
                  <Activity className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">Validacija još nije pokrenuta.</p>
                  <p className="text-sm mt-1">Pokrenite proveru da biste videli spremnost feed-a.</p>
                </div>
              ) : validationErrors.length > 0 ? (
                <div className="space-y-3">
                  {validationErrors.map((error, i) => (
                    <div key={i} className="flex gap-3 bg-destructive/5 text-destructive-foreground p-3 rounded-lg border border-destructive/20 text-sm">
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
                      <p>{error}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-emerald-600">
                  <CheckCircle className="w-10 h-10 mx-auto mb-3 opacity-60" />
                  <p className="font-medium">Nisu pronađene greške.</p>
                  <p className="text-sm text-emerald-600/80 mt-1">Svi proizvodi su spremni za Meta katalog.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}