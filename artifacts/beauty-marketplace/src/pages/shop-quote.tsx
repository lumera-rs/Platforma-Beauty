import { useRoute, Link, useLocation } from "wouter";
import { useGetShopQuote, useRestoreShopQuoteCart, getGetShopCartQueryKey, getGetShopSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, FileText, ShoppingCart, CalendarClock, Download, ArrowRight, Store } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { Badge } from "@/components/ui/badge";

export default function ShopQuotePage() {
  const [, params] = useRoute("/ponuda/:publicId");
  const publicId = params?.publicId ?? "";
  
  const { data: quote, isLoading, isError } = useGetShopQuote(publicId, {
    query: { enabled: !!publicId, queryKey: ["shopQuote", publicId] }
  });

  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const restoreQuote = useRestoreShopQuoteCart({
    mutation: {
      onSuccess: () => {
        toast.success("Artikli iz ponude su dodati u vašu korpu.");
        qc.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
        qc.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() });
        setLocation("/vlasnik/prodavnica/korpa");
      },
      onError: (err) => {
        toast.error("Greška", { description: extractApiError(err, "Nije moguće dodati artikle u korpu.") });
      }
    }
  });

  if (isLoading) return <Layout><div className="flex justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></Layout>;
  
  if (isError || !quote) return (
    <Layout>
      <div className="flex flex-col items-center justify-center p-20 text-center">
        <FileText className="w-12 h-12 text-muted-foreground mb-4" />
        <h1 className="text-2xl font-bold font-serif mb-2">Ponuda nije pronađena</h1>
        <p className="text-muted-foreground">Ova ponuda ne postoji ili je istekla.</p>
        <Button asChild className="mt-6"><Link href="/">Nazad na početnu</Link></Button>
      </div>
    </Layout>
  );

  const money = (n: number) => `${n.toLocaleString("sr-RS")} ${quote.currency}`;
  const validUntil = new Date(quote.validUntil);
  const isValid = validUntil > new Date();

  return (
    <Layout>
      <main className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <Badge variant="secondary" className="mb-3 uppercase tracking-wider text-[10px]">Zvanična ponuda</Badge>
            <h1 className="text-3xl font-serif font-bold text-foreground">Ponuda #{quote.publicId.split("-")[0].toUpperCase()}</h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4" /> 
              Kreirano: {new Date(quote.createdAt).toLocaleDateString("sr-RS")} 
              <span className="mx-2">•</span> 
              Važi do: <span className={isValid ? "font-medium text-foreground" : "text-destructive font-medium"}>{validUntil.toLocaleDateString("sr-RS")}</span>
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" asChild>
              <a href={`/api/shop/quotes/${publicId}/pdf`} target="_blank" rel="noopener noreferrer">
                <Download className="w-4 h-4 mr-2" /> Preuzmi PDF
              </a>
            </Button>
            <Button 
              onClick={() => restoreQuote.mutate({ publicId })} 
              disabled={restoreQuote.isPending || !isValid}
            >
              {restoreQuote.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <ShoppingCart className="w-4 h-4 mr-2" /> Dodaj sve u korpu
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 items-start">
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold font-serif">Stavke ponude</h2>
                  <span className="text-sm text-muted-foreground">{quote.itemSnapshots.length} artikala</span>
                </div>
                <div className="space-y-4">
                  {quote.itemSnapshots.map((item: any, i: number) => (
                    <div key={i} className="flex gap-4 py-4 border-b last:border-0 last:pb-0">
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">{item.productName}</p>
                        {item.variantLabel && item.variantValue && (
                          <p className="text-sm text-muted-foreground mt-0.5">{item.variantLabel}: {item.variantValue}</p>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-sm font-medium bg-muted/40 px-2 py-1 rounded">Kol: {item.quantity}</span>
                          <span className="font-medium text-primary">{money(item.unitPrice)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6 space-y-4">
                <h3 className="font-bold font-serif text-lg border-b pb-3">Detalji ponude</h3>
                {quote.customerCompanyName && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Za klijenta:</p>
                    <p className="font-medium">{quote.customerCompanyName}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Izdaje:</p>
                  <p className="font-medium flex items-center gap-1.5"><Store className="w-4 h-4 text-primary" /> {(quote.sellerSnapshot as any).name || "LUMERA Partner"}</p>
                </div>
                <div className="pt-4 border-t space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Međuzbir</span>
                    <span>{money(quote.subtotalWithoutVat)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">PDV</span>
                    <span>{money(quote.vatAmount)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg pt-2">
                    <span>Ukupno</span>
                    <span className="text-primary">{money(quote.totalWithVat)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </Layout>
  );
}