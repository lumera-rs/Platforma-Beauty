import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useCreatePriceInquiry } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { Loader2, MailQuestion } from "lucide-react";

export function PriceInquiryDialog({
  open,
  onOpenChange,
  supplierId,
  productId,
  productName,
  initialName = "",
  initialEmail = "",
  initialPhone = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  productId: string;
  productName: string;
  initialName?: string;
  initialEmail?: string;
  initialPhone?: string;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [message, setMessage] = useState(`Poštovani, zanima me cena za proizvod "${productName}".`);

  const { toast } = useToast();
  const createInquiry = useCreatePriceInquiry();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || message.trim().length < 10) {
      toast.error("Molimo popunite sva polja i unesite poruku od bar 10 karaktera.");
      return;
    }
    
    createInquiry.mutate({ supplierId, productId, data: { name, email, phone, message } }, {
      onSuccess: () => {
        toast.success("Upit je uspešno poslat! Dobićete odgovor uskoro.");
        onOpenChange(false);
      },
      onError: (err) => toast.error("Greška", { description: extractApiError(err, "Nije moguće poslati upit.") })
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-2xl"><MailQuestion className="w-5 h-5 text-primary" /> Upit za cenu / dostupnost</DialogTitle>
            <DialogDescription>Pošaljite upit direktno dobavljaču za proizvod <strong>{productName}</strong>.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Ime i prezime *</Label>
                <Input value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Email adresa *</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Broj telefona *</Label>
              <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required minLength={6} />
            </div>
            <div className="space-y-2">
              <Label>Poruka *</Label>
              <Textarea rows={4} value={message} onChange={e => setMessage(e.target.value)} required minLength={10} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createInquiry.isPending}>Odustani</Button>
            <Button type="submit" disabled={createInquiry.isPending}>
              {createInquiry.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Pošalji upit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}