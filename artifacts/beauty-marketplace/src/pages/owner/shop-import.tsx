import { useState, useRef } from "react";
import { Link } from "wouter";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { Button } from "@/components/ui/button";
import { downloadB2bOrderImportTemplate, usePreviewB2bOrderImport, useApplyB2bOrderImport } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetShopCartQueryKey, getGetShopSummaryQueryKey } from "@workspace/api-client-react";
import { Upload, Download, Loader2, ArrowLeft, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { extractApiError } from "@/lib/admin-form-utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";

export default function OwnerShopImportPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const previewImport = usePreviewB2bOrderImport();
  const applyImport = useApplyB2bOrderImport();

  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [applyConfirmed, setApplyConfirmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await downloadB2bOrderImportTemplate();
      const blobWithBom = new Blob(["\ufeff", res], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blobWithBom);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lumera-b2b-order-template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Šablon je uspešno preuzet.");
    } catch {
      toast.error("Preuzimanje šablona nije uspelo.");
    } finally {
      setDownloading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setApplyConfirmed(false);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvContent(text);
      previewImport.mutate({ data: { csvText: text } });
    };
    reader.readAsText(file);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearFile = () => {
    setCsvContent(null);
    setFileName(null);
    setApplyConfirmed(false);
    previewImport.reset();
  };

  const handleApply = () => {
    if (!csvContent) return;
    applyImport.mutate({
      data: { csvText: csvContent, confirmed: true, idempotencyKey }
    }, {
      onSuccess: (res) => {
        toast.success(`Uspešno dodato ${res.validRowCount} proizvoda u korpu.`);
        setIdempotencyKey(crypto.randomUUID());
        queryClient.invalidateQueries({ queryKey: getGetShopCartQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetShopSummaryQueryKey() });
        clearFile();
      },
      onError: (err) => toast.error(extractApiError(err, "Uvoz nije uspeo."))
    });
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-8 items-start">
          <OwnerSidebar current="/vlasnik/shop" />
          <div className="flex-1 min-w-0 space-y-6">
            <div>
              <Button variant="ghost" asChild className="mb-4 -ml-4 text-muted-foreground hover:text-foreground">
                <Link href="/vlasnik/shop"><ArrowLeft className="w-4 h-4 mr-2" /> Nazad u prodavnicu</Link>
              </Button>
              <h1 className="text-3xl font-serif font-bold">Uvoz korpe (CSV)</h1>
              <p className="text-muted-foreground">Brzo dodajte proizvode u korpu pomoću CSV fajla</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                    <Download className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">1. Preuzmite šablon</h3>
                    <p className="text-sm text-muted-foreground mt-1">Preuzmite prazan CSV šablon i popunite ga SKU šiframa i količinama.</p>
                  </div>
                  <Button variant="outline" onClick={handleDownload} disabled={downloading}>
                    {downloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />}
                    Preuzmi šablon
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">2. Učitajte fajl</h3>
                    <p className="text-sm text-muted-foreground mt-1">Nakon što ste popunili šablon, učitajte ga ovde za validaciju.</p>
                  </div>
                  <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
                  <Button onClick={() => fileInputRef.current?.click()} disabled={previewImport.isPending || applyImport.isPending}>
                    {previewImport.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    Izaberi fajl
                  </Button>
                </CardContent>
              </Card>
            </div>

            {previewImport.isError && (
              <div className="p-4 bg-destructive/10 text-destructive rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold">Greška pri čitanju fajla</h4>
                  <p className="text-sm">{extractApiError(previewImport.error, "Proverite format CSV fajla.")}</p>
                </div>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={clearFile}>Zatvori</Button>
              </div>
            )}

            {previewImport.isSuccess && previewImport.data && (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between p-4 bg-card border rounded-xl shadow-sm">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="w-8 h-8 text-primary" />
                    <div>
                      <h3 className="font-semibold">{fileName}</h3>
                      <p className="text-sm text-muted-foreground">
                        {previewImport.data.validRowCount} validnih redova • {previewImport.data.invalidRowCount} nevalidnih redova
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={clearFile}><XCircle className="w-5 h-5 text-muted-foreground" /></Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {previewImport.data.matchedRows.length > 0 && (
                    <Card className="border-emerald-200 bg-emerald-50">
                      <CardContent className="p-4">
                        <h4 className="font-semibold text-emerald-800 flex items-center mb-3">
                          <CheckCircle2 className="w-5 h-5 mr-2" />
                          Spremni za dodavanje ({previewImport.data.matchedRows.length})
                        </h4>
                        <ScrollArea className="h-[200px] rounded border border-emerald-200 bg-white">
                          <div className="p-3 space-y-2">
                            {previewImport.data.matchedRows.map((row, i) => (
                              <div key={i} className="flex justify-between text-sm items-center">
                                <span className="font-medium text-emerald-700">Red {row.rowNumber}</span>
                                <span className="text-emerald-600">SKU: {row.sku} × {row.quantity}</span>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {(previewImport.data.unmatchedRows.length > 0 || previewImport.data.invalidRows.length > 0) && (
                    <Card className="border-rose-200 bg-rose-50 md:col-span-1">
                      <CardContent className="p-4">
                        <h4 className="font-semibold text-rose-800 flex items-center mb-3">
                          <AlertTriangle className="w-5 h-5 mr-2" />
                          Greške ({previewImport.data.invalidRowCount})
                        </h4>
                        <ScrollArea className="h-[200px] rounded border border-rose-200 bg-white">
                          <div className="p-3 space-y-3">
                            {previewImport.data.unmatchedRows.length > 0 && (
                              <div className="mb-4">
                                <h5 className="font-semibold text-xs uppercase tracking-wider text-rose-800/70 mb-2">Proizvod nije pronađen</h5>
                                {previewImport.data.unmatchedRows.map((row, i) => (
                                  <div key={`u-${i}`} className="text-sm border-b border-rose-100 pb-2 mb-2 last:border-0 last:mb-0 last:pb-0">
                                    <div className="font-medium text-rose-700">Red {row.rowNumber}: SKU {row.sku}</div>
                                    <div className="text-rose-600 text-xs mt-0.5">Proizvod nije pronađen ili nije dostupan.</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {previewImport.data.invalidRows.length > 0 && (
                              <div>
                                <h5 className="font-semibold text-xs uppercase tracking-wider text-rose-800/70 mb-2">Neispravan format</h5>
                                {previewImport.data.invalidRows.map((row, i) => (
                                  <div key={`i-${i}`} className="text-sm border-b border-rose-100 pb-2 mb-2 last:border-0 last:mb-0 last:pb-0">
                                    <div className="font-medium text-rose-700">Red {row.rowNumber}</div>
                                    <div className="text-rose-600 text-xs mt-0.5">{row.message || "Neispravan format"}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}
                </div>

                <div className="flex flex-col items-end pt-4 space-y-4">
                  {(previewImport.data.invalidRowCount > 0 && previewImport.data.validRowCount > 0) && (
                    <div className="bg-muted p-4 rounded-lg flex items-start gap-3 w-full md:w-auto md:max-w-md">
                      <Checkbox 
                        id="confirm-apply" 
                        checked={applyConfirmed} 
                        onCheckedChange={(v) => setApplyConfirmed(!!v)} 
                        className="mt-1" 
                      />
                      <div className="grid gap-1.5 leading-none">
                        <label htmlFor="confirm-apply" className="text-sm font-medium leading-none cursor-pointer">
                          Potvrđujem da želim da uvezem samo {previewImport.data.validRowCount} ispravnih proizvoda
                        </label>
                        <p className="text-sm text-muted-foreground">
                          Neispravni redovi će biti ignorisani.
                        </p>
                      </div>
                    </div>
                  )}

                  <Button 
                    size="lg" 
                    onClick={handleApply} 
                    disabled={
                      applyImport.isPending || 
                      previewImport.data.validRowCount === 0 || 
                      ((previewImport.data.invalidRowCount > 0) && !applyConfirmed)
                    } 
                    className="w-full md:w-auto text-base h-12"
                  >
                    {applyImport.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Play className="w-5 h-5 mr-2" />}
                    Dodaj {previewImport.data.validRowCount} proizvoda u korpu
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </BusinessLayout>
  );
}
