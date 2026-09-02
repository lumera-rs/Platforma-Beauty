import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AdminLayout } from "./layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search, MailQuestion, Save, Phone, Mail, User, Clock, Store } from "lucide-react";
import { useDebouncedSearch } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";

interface PriceInquiry {
  id: string;
  supplierId: string;
  productId: string;
  productName: string;
  supplierName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  message: string;
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  internalNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function AdminPriceInquiries() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedSearch(search);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: inquiries, isLoading } = useQuery<PriceInquiry[]>({
    queryKey: ["admin", "price-inquiries", debouncedSearch],
    queryFn: () => customFetch(`/api/admin/price-inquiries?search=${encodeURIComponent(debouncedSearch)}`, { method: 'GET' })
  });

  const updateInquiry = useMutation({
    mutationFn: ({ id, status, internalNote }: { id: string, status?: string, internalNote?: string }) => 
      customFetch(`/api/admin/price-inquiries/${id}`, { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, internalNote }) 
      }),
    onSuccess: () => {
      toast.success("Upit je uspešno ažuriran.");
      qc.invalidateQueries({ queryKey: ["admin", "price-inquiries"] });
    },
    onError: () => toast.error("Greška prilikom ažuriranja upita.")
  });

  const [notes, setNotes] = useState<Record<string, string>>({});

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Upiti za cenu / dostupnost</h1>
          <p className="text-muted-foreground">Upravljanje upitima korisnika za proizvode bez javne cene ili na stanju.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Pretraga po imenu, emailu..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : !inquiries || inquiries.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <MailQuestion className="w-10 h-10 mx-auto mb-3 opacity-30" />
              Nema pronađenih upita.
            </CardContent>
          </Card>
        ) : (
          inquiries.filter(q => q.contactName.toLowerCase().includes(debouncedSearch.toLowerCase()) || q.contactEmail.toLowerCase().includes(debouncedSearch.toLowerCase())).map((inquiry) => {
            const currentNote = notes[inquiry.id] !== undefined ? notes[inquiry.id] : (inquiry.internalNote || "");
            const hasChanged = currentNote !== (inquiry.internalNote || "");
            
            return (
              <Card key={inquiry.id} className="overflow-hidden">
                <div className={`h-1.5 w-full ${inquiry.status === 'NEW' ? 'bg-primary' : inquiry.status === 'CLOSED' ? 'bg-emerald-500' : 'bg-muted'}`} />
                <CardContent className="p-0">
                  <div className="flex flex-col lg:flex-row">
                    
                    {/* Customer & Product Info */}
                    <div className="p-5 flex-1 lg:border-r">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Badge variant={inquiry.status === 'NEW' ? "default" : "secondary"}>
                            {inquiry.status === 'NEW' ? "NOVO" : inquiry.status === 'CONTACTED' ? "U KOMUNIKACIJI" : "ZATVORENO"}
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(inquiry.createdAt).toLocaleString("sr-RS")}</span>
                        </div>
                        <Select 
                          value={inquiry.status} 
                          onValueChange={(val) => updateInquiry.mutate({ id: inquiry.id, status: val })}
                        >
                          <SelectTrigger className="w-40 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NEW">Novo</SelectItem>
                            <SelectItem value="CONTACTED">Kontaktirano</SelectItem>
                            <SelectItem value="CLOSED">Zatvoreno</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="mb-4 p-3 bg-muted/20 rounded-lg border">
                        <p className="text-sm font-semibold flex items-center gap-1.5 mb-1"><Store className="w-4 h-4 text-primary" /> {inquiry.supplierName}</p>
                        <p className="text-sm text-foreground">Proizvod: <strong>{inquiry.productName}</strong></p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <User className="w-4 h-4" /> <span className="text-foreground font-medium">{inquiry.contactName}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="w-4 h-4" /> <a href={`mailto:${inquiry.contactEmail}`} className="text-primary hover:underline">{inquiry.contactEmail}</a>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="w-4 h-4" /> <a href={`tel:${inquiry.contactPhone}`} className="text-primary hover:underline">{inquiry.contactPhone}</a>
                        </div>
                      </div>

                      <div className="bg-muted/10 p-4 rounded-lg border">
                        <p className="text-xs text-muted-foreground font-semibold mb-1 uppercase tracking-wider">Poruka kupca</p>
                        <p className="text-sm whitespace-pre-line">{inquiry.message}</p>
                      </div>
                    </div>

                    {/* Internal Note */}
                    <div className="p-5 lg:w-80 bg-muted/5 flex flex-col">
                      <p className="text-xs text-muted-foreground font-semibold mb-2 uppercase tracking-wider flex items-center justify-between">
                        Interna beleška
                        {hasChanged && <span className="text-primary normal-case font-normal">* Nesačuvano</span>}
                      </p>
                      <Textarea 
                        className="flex-1 min-h-[120px] resize-none bg-background text-sm" 
                        placeholder="Zabeležite detalje komunikacije sa kupcem..."
                        value={currentNote}
                        onChange={(e) => setNotes({ ...notes, [inquiry.id]: e.target.value })}
                      />
                      <Button 
                        size="sm" 
                        className="mt-3 w-full" 
                        disabled={!hasChanged || updateInquiry.isPending}
                        onClick={() => updateInquiry.mutate({ id: inquiry.id, internalNote: currentNote })}
                      >
                        {updateInquiry.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Sačuvaj belešku
                      </Button>
                    </div>
                    
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </AdminLayout>
  );
}