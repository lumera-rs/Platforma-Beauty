import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useCreateShopQuote, useGetShopCheckoutProfile } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { Loader2, FileText, CheckCircle } from "lucide-react";
import { Link } from "wouter";

export function CreateShopQuoteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [customerCompanyName, setCustomerCompanyName] = useState("");
  const [createdQuoteId, setCreatedQuoteId] = useState<string | null>(null);

  const { toast } = useToast();
  const createQuote = useCreateShopQuote();
  const { data: profile } = useGetShopCheckoutProfile();

  useEffect(() => {
    if (!open || !profile) return;
    const activeSalon = profile.deliverySalons.find((salon) => salon.id === profile.activeSalonId);
    setCustomerCompanyName(activeSalon?.companyDetails.companyName || profile.salonName);
  }, [open, profile]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createQuote.mutate({ data: { customerCompanyName: customerCompanyName.trim() || undefined } }, {
      onSuccess: (quote) => {
        setCreatedQuoteId(quote.publicId);
        toast.success("Ponuda je uspešno kreirana.");
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err, "Nije moguće kreirati ponudu.") })
    });
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after dialog closes
    setTimeout(() => {
      setCustomerCompanyName("");
      setCreatedQuoteId(null);
      createQuote.reset();
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        {createdQuoteId ? (
          <div className="py-6 text-center">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-6 h-6" />
            </div>
            <DialogTitle className="text-xl mb-2 font-serif">Ponuda kreirana</DialogTitle>
            <DialogDescription className="mb-6">Vaša PDF ponuda je generisana i spremna za preuzimanje ili deljenje sa klijentom.</DialogDescription>
            <div className="flex flex-col gap-3 max-w-xs mx-auto">
              <Button asChild className="w-full">
                <Link href={`/ponuda/${createdQuoteId}`}>Prikaži ponudu</Link>
              </Button>
              <Button variant="outline" onClick={handleClose} className="w-full">Zatvori</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-serif text-2xl"><FileText className="w-5 h-5 text-primary" /> Kreiraj PDF ponudu</DialogTitle>
               <DialogDescription>
                 PDF ponuda služi za preuzimanje, deljenje i interno odobrenje. Nije faktura i njenim kreiranjem se porudžbina ne završava.
               </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground space-y-1">
                <p>Cene i dostupnost mogu se promeniti pre konačne kupovine.</p>
                <p>Stavke ostaju u korpi, pa posle možete da se vratite, izmenite ih i završite kupovinu.</p>
              </div>
              <div className="space-y-2">
                <Label>Naziv primaoca / firme (opciona izmena)</Label>
                <Input data-testid="input-quote-recipient" value={customerCompanyName} onChange={e => setCustomerCompanyName(e.target.value)} placeholder="Naziv firme primaoca" />
                <p className="text-xs text-muted-foreground">Unos menja samo prikazani naziv primaoca; registrovani podaci aktivnog salona ostaju merodavni.</p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose} disabled={createQuote.isPending}>Odustani</Button>
              <Button type="submit" disabled={createQuote.isPending}>
                {createQuote.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Generiši ponudu
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}