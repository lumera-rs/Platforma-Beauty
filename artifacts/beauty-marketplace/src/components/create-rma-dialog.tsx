import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useCreateOrderRma, useCreateRetailOrderRma } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { MediaUpload } from "@/components/media-upload";
import { Loader2, AlertCircle } from "lucide-react";

export function CreateRmaDialog({
  open,
  onOpenChange,
  orderId,
  orderItemId,
  itemName,
  maxQuantity,
  isRetail,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderItemId: string;
  itemName: string;
  maxQuantity: number;
  isRetail: boolean;
  onSuccess?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  const { toast } = useToast();
  const createB2b = useCreateOrderRma();
  const createB2c = useCreateRetailOrderRma();

  const isPending = createB2b.isPending || createB2c.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      toast.error("Molimo izaberite razlog reklamacije.");
      return;
    }
    if (!description.trim()) {
      toast.error("Molimo unesite opis problema.");
      return;
    }

    const payload = {
      orderItemId,
      quantity,
      reason,
      description,
      photoUrls: photos,
    };

    const opts = {
      onSuccess: () => {
        toast.success("Reklamacija (RMA) je uspešno kreirana.");
        onOpenChange(false);
        onSuccess?.();
      },
      onError: (err: any) => toast.error("Greška", { description: extractApiError(err, "Nije moguće kreirati reklamaciju.") })
    };

    if (isRetail) {
      createB2c.mutate({ orderId, data: payload }, opts);
    } else {
      createB2b.mutate({ orderId, data: payload }, opts);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-primary" /> Kreiraj reklamaciju (RMA)</DialogTitle>
            <DialogDescription>
              Reklamacija za: <strong>{itemName}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label>Količina za reklamaciju (Max: {maxQuantity})</Label>
              <Input 
                type="number" 
                min="1" 
                max={maxQuantity} 
                value={quantity}
                onChange={(e) => {
                  let val = parseInt(e.target.value);
                  if (isNaN(val)) val = 1;
                  if (val > maxQuantity) val = maxQuantity;
                  if (val < 1) val = 1;
                  setQuantity(val);
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Razlog reklamacije *</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite razlog..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAMAGED">Oštećen proizvod u transportu</SelectItem>
                  <SelectItem value="DEFECTIVE">Neispravan proizvod / fabrička greška</SelectItem>
                  <SelectItem value="WRONG_ITEM">Pogrešan artikal isporučen</SelectItem>
                  <SelectItem value="MISSING_PARTS">Nedostaju delovi</SelectItem>
                  <SelectItem value="CHANGED_MIND">Odustanak od kupovine (zakonski rok)</SelectItem>
                  <SelectItem value="OTHER">Ostalo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Detaljan opis problema *</Label>
              <Textarea 
                rows={4} 
                value={description} 
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Molimo opišite problem detaljno kako bismo ga što pre rešili..."
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Fotografije (Opciono)</Label>
              <p className="text-xs text-muted-foreground mb-2">Priložite do 6 fotografija oštećenja. Ove slike su vidljive samo administraciji.</p>
              <MediaUpload
                value={photos}
                onChange={setPhotos}
                context="rma"
                maxFiles={6}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Odustani</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Podnesi reklamaciju
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}