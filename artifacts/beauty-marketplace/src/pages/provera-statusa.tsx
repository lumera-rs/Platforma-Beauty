import { useState } from "react";
import { Link, useSearch } from "wouter";
import { Layout } from "@/components/layout";
import { ClientSeoMetadata } from "@/components/client-seo-metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, CheckCircle2, Circle, Truck, Package, ExternalLink } from "lucide-react";
import { useLookupRetailOrderTracking, useTrackRetailOrder, getTrackRetailOrderQueryKey } from "@workspace/api-client-react";
import type { PublicRetailOrderTracking } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const orderSteps = [
  { id: "RECEIVED", label: "Primljeno" },
  { id: "PREPARING", label: "U pripremi" },
  { id: "PACKING", label: "Pakovanje" },
  { id: "SHIPPED", label: "Poslato" },
  { id: "COMPLETED", label: "Završeno" },
];

export function ProveraStatusaPage() {
  const searchString = useSearch();
  const token = new URLSearchParams(searchString).get("token");
  const { toast } = useToast();
  
  const [form, setForm] = useState({ orderNumber: "", email: "" });
  const [searched, setSearched] = useState(false);
  
  const lookup = useLookupRetailOrderTracking({
    mutation: {
      onSuccess: () => setSearched(true),
      onError: () => {
        // Generic error
        toast.error("Provera nije uspela.", { description: "Ukoliko podaci koje ste uneli postoje u sistemu, poslaćemo Vam novu vezu za praćenje na e-mail." });
        setSearched(true);
      }
    }
  });

  const { data: orderData, isLoading: isTokenLoading, isError: isTokenError } = useTrackRetailOrder(
    { token: token! },
    { query: { enabled: !!token && token.length >= 32, queryKey: getTrackRetailOrderQueryKey({ token: token! }), retry: false } }
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.orderNumber.trim() || !form.email.trim()) return;
    lookup.mutate({ data: { orderNumber: form.orderNumber.trim(), email: form.email.trim() } });
  };

  const currentOrder: PublicRetailOrderTracking | undefined = token ? orderData : lookup.data;

  const renderProgress = (status: string) => {
    if (status === "CANCELLED") {
      return <div className="text-center p-4 border border-destructive/20 bg-destructive/10 rounded-lg text-destructive font-medium">Porudžbina je otkazana.</div>;
    }
    
    const currentIndex = orderSteps.findIndex(s => s.id === status);
    const activeIndex = currentIndex === -1 ? 0 : currentIndex;
    
    return (
      <div className="relative pt-6 pb-2">
        <div className="absolute top-9 left-6 right-6 h-1 bg-muted rounded-full">
          <div 
            className="absolute top-0 left-0 h-1 bg-primary rounded-full transition-all duration-500" 
            style={{ width: `${(activeIndex / (orderSteps.length - 1)) * 100}%` }}
          />
        </div>
        <div className="relative flex justify-between">
          {orderSteps.map((step, index) => {
            const isCompleted = index <= activeIndex;
            const isCurrent = index === activeIndex;
            return (
              <div key={step.id} className="flex flex-col items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 z-10 bg-card ${isCompleted ? 'border-primary text-primary' : 'border-muted text-muted-foreground'} ${isCurrent ? 'ring-4 ring-primary/20' : ''}`}>
                  {isCompleted ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-4 h-4" />}
                </div>
                <span className={`text-xs sm:text-sm font-medium ${isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <ClientSeoMetadata />
      <main className="mx-auto min-h-[calc(100vh-200px)] max-w-3xl px-4 py-12 md:py-20 flex flex-col items-center">
        <div className="text-center mb-10 w-full">
          <h1 className="font-serif text-3xl md:text-5xl font-bold tracking-tight mb-4">Praćenje porudžbine</h1>
          <p className="text-muted-foreground md:text-lg max-w-lg mx-auto">Unesite broj porudžbine i vašu email adresu kako biste proverili status.</p>
        </div>

        <div className="w-full space-y-8">
          {!token && !currentOrder && (
            <Card className="w-full max-w-md mx-auto overflow-hidden">
              <CardContent className="p-6">
                {searched && !lookup.isPending && !lookup.isError && !lookup.data ? (
                  <div className="text-center py-6">
                    <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                    <h3 className="font-semibold text-lg">Provera je zatražena</h3>
                    <p className="text-muted-foreground text-sm mt-2">Ukoliko podaci koje ste uneli postoje u sistemu, poslaćemo Vam novu vezu za praćenje na e-mail: <strong>{form.email}</strong>.</p>
                    <Button variant="outline" className="mt-6" onClick={() => setSearched(false)}>Nova provera</Button>
                  </div>
                ) : (
                  <form onSubmit={onSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Broj porudžbine</Label>
                      <Input 
                        placeholder="npr. RET-123456" 
                        value={form.orderNumber} 
                        onChange={(e) => setForm({ ...form, orderNumber: e.target.value })} 
                        required 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email adresa</Label>
                      <Input 
                        type="email" 
                        placeholder="Vaš email" 
                        value={form.email} 
                        onChange={(e) => setForm({ ...form, email: e.target.value })} 
                        required 
                      />
                    </div>
                    <Button type="submit" className="w-full h-11" disabled={lookup.isPending}>
                      {lookup.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Search className="w-5 h-5 mr-2" />}
                      Pronađi porudžbinu
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {(token || currentOrder) && (
            <div className="w-full">
              {isTokenLoading ? (
                <div className="flex flex-col items-center justify-center p-12 space-y-4">
                  <Loader2 className="w-10 h-10 animate-spin text-primary" />
                  <p className="text-muted-foreground animate-pulse">Učitavanje podataka o porudžbini...</p>
                </div>
              ) : isTokenError ? (
                <Card className="border-destructive/20 bg-destructive/5 text-center">
                  <CardContent className="p-8">
                    <p className="text-destructive font-medium mb-4">Veza za praćenje je nevažeća ili je istekla.</p>
                    <Button asChild variant="outline"><Link href="/provera-statusa">Zatraži novu vezu</Link></Button>
                  </CardContent>
                </Card>
              ) : currentOrder && (
                <Card className="border-primary/10 shadow-md">
                  <CardContent className="p-6 md:p-8 space-y-8">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border/50 pb-6">
                      <div>
                        <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold">Porudžbina</p>
                        <h2 className="text-2xl font-mono font-bold mt-1">{currentOrder.orderNumber}</h2>
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold mb-2">Trenutni status</p>
                        <Badge className="text-sm px-3 py-1 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">
                          {orderSteps.find(s => s.id === currentOrder.status)?.label ?? currentOrder.status}
                        </Badge>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-lg mb-6">Napredak isporuke</h3>
                      {renderProgress(currentOrder.status)}
                    </div>

                    {(currentOrder.trackingNumber || currentOrder.courierUrl) && (
                      <div className="bg-muted/40 rounded-xl p-5 border border-muted flex flex-col sm:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 p-2 rounded-full text-primary">
                            <Truck className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">Broj pošiljke (Tracking)</p>
                            {currentOrder.trackingNumber && <p className="font-mono mt-1 text-muted-foreground">{currentOrder.trackingNumber}</p>}
                          </div>
                        </div>
                        {currentOrder.courierUrl && (
                          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                            <a href={currentOrder.courierUrl} target="_blank" rel="noopener noreferrer">
                              Prati na sajtu kurira <ExternalLink className="w-3 h-3 ml-2" />
                            </a>
                          </Button>
                        )}
                      </div>
                    )}
                    
                    <div className="border-t border-border/50 pt-6">
                      <p className="text-center text-sm text-muted-foreground">
                        Imate pitanja u vezi porudžbine? <a href="mailto:podrska@lumera.rs" className="text-primary hover:underline">Kontaktirajte nas</a>.
                      </p>
                      {!token && (
                        <div className="mt-4 text-center">
                          <Button
                            variant="outline"
                            onClick={() => {
                              lookup.reset();
                              setSearched(false);
                              setForm({ orderNumber: "", email: "" });
                            }}
                          >
                            Nova provera
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </main>
    </Layout>
  );
}
