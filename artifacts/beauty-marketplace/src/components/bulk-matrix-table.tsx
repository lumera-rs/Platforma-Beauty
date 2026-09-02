import { useState, useMemo } from "react";
import { useGetPublicBulkMatrix, useAddShopBulkMatrix, getGetShopCartQueryKey, getGetShopSummaryQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ShoppingCart, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { extractApiError } from "@/lib/admin-form-utils";

export function BulkMatrixOrderTable({ productId }: { productId: string }) {
  const { data, isLoading, isError } = useGetPublicBulkMatrix(productId, {
    query: { queryKey: ["publicBulkMatrix", productId], enabled: !!productId } 
  });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const { toast } = useToast();
  const qc = useQueryClient();
  const addBulk = useAddShopBulkMatrix({
    mutation: {
      onSuccess: () => {
        toast.success("Varijante su uspešno dodate u korpu.");
        setQuantities({});
        qc.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
        qc.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() });
      },
      onError: (err) => {
        toast.error("Greška", { description: extractApiError(err, "Nije moguće dodati proizvode u korpu.") });
      }
    }
  });

  const handleQtyChange = (variantValue: string, val: string, max: number) => {
    let num = parseInt(val, 10);
    if (isNaN(num)) num = 0;
    if (num < 0) num = 0;
    if (num > max) num = max;
    
    setQuantities(prev => ({
      ...prev,
      [variantValue]: num
    }));
  };

  const selectedRows = useMemo(() => {
    return Object.entries(quantities)
      .filter(([_, qty]) => qty > 0)
      .map(([variantValue, quantity]) => ({ productId, variantValue, quantity }));
  }, [quantities, productId]);

  const totalSelectedCount = selectedRows.reduce((sum, r) => sum + r.quantity, 0);

  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (isError || !data?.rows) return <div className="py-10 text-center text-muted-foreground"><Info className="w-5 h-5 mx-auto mb-2" /> Nije moguće učitati bulk tabelu.</div>;

  return (
    <div className="space-y-4 mt-6">
      <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="p-3 font-medium">Varijanta</th>
                <th className="p-3 font-medium">SKU</th>
                <th className="p-3 font-medium">Stanje</th>
                <th className="p-3 font-medium text-right">Cena</th>
                <th className="p-3 font-medium w-24 text-center">Količina</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="p-3 font-medium">{row.label || row.value}</td>
                  <td className="p-3 text-muted-foreground">{row.sku || "-"}</td>
                  <td className="p-3">
                    {row.available ? (
                      <span className="text-emerald-600 font-medium">{row.stock > 0 ? `${row.stock} kom.` : "Dostupno"}</span>
                    ) : (
                      <span className="text-destructive font-medium">Nedostupno</span>
                    )}
                  </td>
                  <td className="p-3 text-right font-semibold text-primary">{row.unitPrice == null ? "Na upit" : `${row.unitPrice.toLocaleString("sr-RS")} RSD`}</td>
                  <td className="p-3">
                    <Input 
                      type="number" 
                      min="0" 
                      max={row.stock || 9999}
                      className="w-20 text-center mx-auto h-8"
                      disabled={!data.cartEligible || !row.available || row.stock === 0}
                      value={quantities[row.value] || ""}
                      onChange={(e) => handleQtyChange(row.value, e.target.value, row.stock || 9999)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="flex items-center justify-between p-4 bg-primary/5 rounded-xl border border-primary/20">
        <div>
          <span className="text-sm font-medium">Izabrano artikala: </span>
          <span className="text-lg font-bold text-primary">{totalSelectedCount}</span>
        </div>
        <Button 
          disabled={!data.cartEligible || totalSelectedCount === 0 || addBulk.isPending}
          onClick={() => addBulk.mutate({ data: { rows: selectedRows } })}
        >
          {addBulk.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          <ShoppingCart className="w-4 h-4 mr-2" /> Dodaj sve u korpu
        </Button>
      </div>
    </div>
  );
}