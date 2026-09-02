import { useGetReferralDashboard } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Copy, Share2, AlertTriangle, HelpCircle, Gift, Sparkles, AlertCircle, QrCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { QRCodeSVG } from "qrcode.react";

const money = (n: number) => `${n.toLocaleString("sr-RS")} RSD`;

export default function Referrals() {
  const { data: dashboard, isLoading, error } = useGetReferralDashboard();
  const { toast } = useToast();

  if (isLoading) {
    return (
      <Layout>
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (error || !dashboard) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="flex h-64 items-center justify-center flex-col text-center border rounded-xl border-dashed">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold">Program preporuka nije dostupan</h2>
            <p className="text-muted-foreground mt-2">Ili niste prijavljeni ili vaš nalog nema pristup ovom programu.</p>
          </div>
        </div>
      </Layout>
    );
  }

  const copyToClipboard = (text: string, description: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Kopirano", { description });
  };

  const shareLink = (url: string, text: string) => {
    if (navigator.share) {
      navigator.share({ title: "LUMERA Preporuka", text, url }).catch(() => {});
    } else {
      copyToClipboard(url, "Link je kopiran u klipbord");
    }
  };

  return (
    <Layout>
      <div className="bg-primary/5 py-10 border-b border-primary/10">
        <div className="container mx-auto px-4">
          <h1 className="text-4xl font-serif font-bold text-foreground">Program preporuka</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-lg">
            Podelite LUMERA iskustvo i ostvarite nagrade. 
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2 text-primary">
                <Gift className="h-5 w-5" />
                <p className="font-semibold uppercase tracking-wider text-xs">Dostupno za trošenje</p>
              </div>
              <p className="text-3xl font-bold text-primary">{money(dashboard.availableRsd)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2 text-muted-foreground">
                <AlertCircle className="h-5 w-5" />
                <p className="font-semibold uppercase tracking-wider text-xs">Uskoro ističe</p>
              </div>
              <p className="text-3xl font-bold">{money(dashboard.expiringSoonRsd)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2 text-muted-foreground">
                <Sparkles className="h-5 w-5" />
                <p className="font-semibold uppercase tracking-wider text-xs">Aktivni kanali</p>
              </div>
              <p className="text-3xl font-bold">{dashboard.channels.length}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue={dashboard.channels[0] ? `${dashboard.channels[0].channel}-${dashboard.channels[0].sourceBusinessId ?? "account"}` : "ledger"} className="w-full">
          <TabsList className="mb-6 w-full justify-start overflow-x-auto h-auto p-1">
            {dashboard.channels.map(ch => (
              <TabsTrigger key={`${ch.channel}-${ch.sourceBusinessId ?? "account"}`} value={`${ch.channel}-${ch.sourceBusinessId ?? "account"}`} className="px-6 py-2.5">
                Kanal {ch.channel} · {ch.sourceBusinessName}
              </TabsTrigger>
            ))}
            <TabsTrigger value="ledger" className="px-6 py-2.5">Istorija transakcija</TabsTrigger>
          </TabsList>

          {dashboard.channels.map(ch => {
            return (
              <TabsContent key={`${ch.channel}-${ch.sourceBusinessId ?? "account"}`} value={`${ch.channel}-${ch.sourceBusinessId ?? "account"}`} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Podaci o kanalu {ch.channel}</CardTitle>
                    <CardDescription>Statistika preporuka i pravila</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-2 gap-6 mb-8">
                      <div className="space-y-6">
                        <div className="bg-muted/30 rounded-xl p-5 border">
                          <p className="text-sm text-muted-foreground font-medium mb-1">Na čekanju / u obradi</p>
                          <p className="text-2xl font-bold">{ch.pending}</p>
                        </div>
                        <div className="bg-muted/30 rounded-xl p-5 border">
                          <p className="text-sm text-muted-foreground font-medium mb-1">Kvalifikovano (završeno)</p>
                          <p className="text-2xl font-bold text-emerald-600">{ch.qualified}</p>
                        </div>
                      </div>

                      <div className="bg-primary/5 border-primary/20 rounded-xl p-5 border flex flex-col items-center text-center justify-center">
                        <p className="font-semibold mb-4 text-primary">Vaš kod za preporuku</p>
                        <div className="bg-white p-3 rounded-xl shadow-sm mb-4">
                          <QRCodeSVG value={ch.link} size={140} />
                        </div>
                        <div className="flex items-center gap-2 mb-4 w-full">
                          <code className="flex-1 bg-white border px-3 py-2 rounded-lg text-lg font-bold tracking-wider">{ch.code}</code>
                          <Button variant="outline" size="icon" onClick={() => copyToClipboard(ch.code, "Kod je kopiran")} aria-label="Kopiraj kod">
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                        <Button className="w-full" onClick={() => shareLink(ch.link, `Pridruži se preko moje LUMERA preporuke uz kod ${ch.code}!`)}>
                          <Share2 className="mr-2 h-4 w-4" /> Podeli link
                        </Button>
                      </div>
                    </div>

                    <div className="bg-card border rounded-xl p-6">
                      <h3 className="font-serif font-bold text-xl mb-4">Uslovi i pravila</h3>
                      <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                        {ch.terms}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}

          <TabsContent value="ledger">
            <Card>
              <CardHeader>
                <CardTitle>Istorija transakcija (Knjiga)</CardTitle>
                <CardDescription>Sve promene na vašem stanju preporuka</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard.ledger.length === 0 ? (
                  <div className="text-center p-8 border border-dashed rounded-xl">
                    <p className="text-muted-foreground">Još uvek nema transakcija.</p>
                  </div>
                ) : (
                  <div className="relative overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-muted-foreground uppercase bg-muted/50">
                        <tr>
                          <th className="px-4 py-3 rounded-tl-lg">Datum</th>
                          <th className="px-4 py-3">Tip</th>
                          <th className="px-4 py-3">Razlog</th>
                          <th className="px-4 py-3">Iznos</th>
                          <th className="px-4 py-3 rounded-tr-lg">Ističe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.ledger.map(entry => (
                          <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-3">{entry.effectiveAt ? format(parseISO(entry.effectiveAt), "dd.MM.yyyy HH:mm") : "—"}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                entry.type === 'available' ? 'bg-emerald-100 text-emerald-800' :
                                entry.type === 'held' ? 'bg-amber-100 text-amber-800' :
                                entry.type === 'redeemed' ? 'bg-blue-100 text-blue-800' :
                                entry.type === 'expired' ? 'bg-red-100 text-red-800' :
                                'bg-muted text-foreground'
                              }`}>
                                {entry.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-[200px] truncate" title={entry.reason}>{entry.reason}</td>
                            <td className={`px-4 py-3 font-semibold ${entry.amountRsd > 0 ? 'text-emerald-600' : entry.amountRsd < 0 ? 'text-red-600' : ''}`}>
                              {entry.amountRsd > 0 ? '+' : ''}{entry.amountRsd} RSD
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {entry.expiresAt ? format(parseISO(entry.expiresAt), "dd.MM.yyyy") : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
