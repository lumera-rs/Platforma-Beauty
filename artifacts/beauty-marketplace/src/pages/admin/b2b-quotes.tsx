import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, FileText, Download, Copy, CalendarClock, Store } from "lucide-react";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { B2bQuote } from "@workspace/api-client-react";

export default function AdminB2bQuotes() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const { toast } = useToast();

  const { data: quotes, isLoading } = useQuery<B2bQuote[]>({
    queryKey: ["admin", "b2b-quotes", debouncedSearch],
    queryFn: () => customFetch(`/api/admin/quotes`, { method: 'GET' })
  });

  const money = (n: number, currency: string) => `${n.toLocaleString("sr-RS")} ${currency}`;

  const copyLink = (publicId: string) => {
    const url = `${window.location.origin}/ponuda/${publicId}`;
    navigator.clipboard.writeText(url);
    toast.success("Link ponude je kopiran.");
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">B2B Ponude</h1>
          <p className="text-muted-foreground">Pregled generisanih PDF ponuda i njihov status.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Pretraga po ID, salonu..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spisak ponuda</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : !quotes || quotes.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              Nema pronađenih ponuda.
            </div>
          ) : (
            <div className="space-y-4">
              {quotes.filter(q => q.publicId.toLowerCase().includes(debouncedSearch.toLowerCase())).map((quote) => {
                const validUntil = new Date(quote.validUntil);
                const isValid = validUntil > new Date();
                
                return (
                  <div key={quote.id} className="p-4 border rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-muted/5 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold">#{quote.publicId.split("-")[0].toUpperCase()}</span>
                        <Badge variant={isValid ? "default" : "destructive"}>{isValid ? "Važeća" : "Istekla"}</Badge>
                        {(quote as any).restoredAt && <Badge variant="secondary">Prihvaćena</Badge>}
                      </div>
                      <p className="text-sm font-medium flex items-center gap-1.5 mt-2">
                        <Store className="w-4 h-4 text-primary" /> {(quote.sellerSnapshot as any).name || "Salon"}
                        {quote.customerCompanyName && <span className="text-muted-foreground">→ klijent: {quote.customerCompanyName}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <CalendarClock className="w-3 h-3" />
                        Kreirano: {new Date(quote.createdAt).toLocaleDateString("sr-RS")} · 
                        Važi do: {validUntil.toLocaleDateString("sr-RS")}
                      </p>
                    </div>
                    
                    <div className="flex flex-col md:items-end gap-1">
                      <p className="font-bold text-lg text-primary">{money(quote.totalWithVat ?? 0, quote.currency)}</p>
                      <p className="text-xs text-muted-foreground">{quote.itemSnapshots?.length ?? 0} artikala</p>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => copyLink(quote.publicId)} title="Kopiraj link">
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" asChild title="Preuzmi PDF">
                        <a href={`/api/shop/quotes/${quote.publicId}/pdf`} target="_blank" rel="noopener noreferrer">
                          <Download className="w-4 h-4" />
                        </a>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}