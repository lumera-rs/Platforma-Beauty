import { useState, useMemo } from "react";
import { AdminLayout } from "./layout";
import {
  useAdminGetAftercareStatistics,
  getAdminGetAftercareStatisticsQueryKey,
} from "@workspace/api-client-react";
import { useLocation, useSearch, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, TrendingUp, Sparkles, Calendar, Search, Filter, DollarSign, MousePointerClick, FileText, Settings } from "lucide-react";
import { format, subDays, parseISO, differenceInDays } from "date-fns";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useToast } from "@/hooks/use-toast";

function money(value: number) {
  return new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(value);
}

export default function AdminAftercareStatistics() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const { toast } = useToast();
  
  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const from = searchParams.get("from") || thirtyDaysAgo;
  const to = searchParams.get("to") || today;
  
  // Enforce <= 366 days
  const daysDiff = differenceInDays(parseISO(to), parseISO(from));
  const isValidRange = daysDiff >= 0 && daysDiff <= 366;

  const { data: stats, isLoading } = useAdminGetAftercareStatistics(
    { from, to },
    {
      query: {
        enabled: isValidRange,
        queryKey: getAdminGetAftercareStatisticsQueryKey({ from, to })
      }
    }
  );
  
  const handleDateChange = (type: "from" | "to", value: string) => {
    const params = new URLSearchParams(searchString);
    params.set(type, value);
    
    // Check if new range is valid before navigating
    const newFrom = params.get("from") || from;
    const newTo = params.get("to") || to;
    const diff = differenceInDays(parseISO(newTo), parseISO(newFrom));
    
    if (diff < 0) {
      toast.error("Neispravan datum", { description: "Početni datum mora biti pre krajnjeg datuma." });
      return;
    }
    if (diff > 366) {
      toast.error("Prevelik raspon", { description: "Raspon datuma ne može biti duži od 366 dana." });
      return;
    }
    
    setLocation(`/admin/nega-posle-tretmana/statistika?${params.toString()}`);
  };

  const chartData = useMemo(() => {
    if (!stats?.timeSeries) return [];
    return stats.timeSeries.map(point => ({
      ...point,
      displayDate: format(parseISO(point.date), 'dd.MM.')
    }));
  }, [stats?.timeSeries]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold tracking-tight text-foreground flex items-center gap-2">
              <TrendingUp className="w-8 h-8 text-primary" /> Statistika nege
            </h1>
            <p className="text-muted-foreground mt-2">
              Analiza uspešnosti preporuka posle tretmana.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/admin/nega-posle-tretmana">Podešavanja</Link>
          </Button>
        </div>

        <Card className="bg-muted/30 border-muted">
          <CardContent className="p-4 flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <input 
                type="date" 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 max-w-[150px]"
                value={from}
                onChange={(e) => handleDateChange("from", e.target.value)}
                data-testid="input-date-from"
              />
              <span className="text-muted-foreground">-</span>
              <input 
                type="date" 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 max-w-[150px]"
                value={to}
                max={today}
                onChange={(e) => handleDateChange("to", e.target.value)}
                data-testid="input-date-to"
              />
            </div>
          </CardContent>
        </Card>

        {!isValidRange ? (
          <div className="p-12 text-center border rounded-xl bg-destructive/5 text-destructive font-medium">
            Raspon datuma je neispravan (maksimum 366 dana, početni datum mora biti pre krajnjeg).
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
        ) : !stats ? (
          <div className="p-12 text-center border rounded-xl bg-muted/20 text-muted-foreground">
            Nema podataka za izabrani period.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <FileText className="w-4 h-4" />
                    <span className="text-sm font-medium">Kreirane preporuke</span>
                  </div>
                  <h3 className="text-3xl font-bold">{stats.kpis.recommendationsCreated}</h3>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-primary mb-2">
                    <MousePointerClick className="w-4 h-4" />
                    <span className="text-sm font-medium">Stopa konverzije</span>
                  </div>
                  <h3 className="text-3xl font-bold text-primary">{stats.kpis.conversionRatePercent.toFixed(1)}%</h3>
                  <p className="text-xs text-muted-foreground mt-1">({stats.kpis.convertedRecommendations} konvertovano)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-emerald-600 mb-2">
                    <DollarSign className="w-4 h-4" />
                    <span className="text-sm font-medium">Prihod od konverzija</span>
                  </div>
                  <h3 className="text-3xl font-bold text-emerald-600">{money(stats.kpis.conversionRevenueRsd)}</h3>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-sm font-medium">Poslati podsetnici</span>
                  </div>
                  <h3 className="text-3xl font-bold">{stats.kpis.secondSent}</h3>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Trend kreiranja i konverzija</CardTitle>
                <CardDescription>Prikaz po danima</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground)/0.2)" />
                      <XAxis dataKey="displayDate" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--emerald-600))" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))' }}
                        labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '8px' }}
                      />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      <Line yAxisId="left" type="monotone" name="Kreirano" dataKey="recommendationsCreated" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Line yAxisId="left" type="monotone" name="Konvertovano" dataKey="convertedRecommendations" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Line yAxisId="right" type="monotone" name="Prihod (RSD)" dataKey="conversionRevenueRsd" stroke="hsl(var(--emerald-600))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Top Tretmani</CardTitle>
                  <CardDescription>Sa najviše konvertovanih preporuka</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tretman</TableHead>
                          <TableHead className="text-right">Konverzije</TableHead>
                          <TableHead className="text-right">Prihod</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.byTreatment.slice(0, 10).map((t, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <div className="font-medium">{t.treatmentName}</div>
                              <div className="text-xs text-muted-foreground">{t.categoryName}</div>
                            </TableCell>
                            <TableCell className="text-right font-medium">{t.convertedRecommendations}</TableCell>
                            <TableCell className="text-right text-emerald-600 font-medium">{money(t.conversionRevenueRsd)}</TableCell>
                          </TableRow>
                        ))}
                        {stats.byTreatment.length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Nema podataka</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top Proizvodi</CardTitle>
                  <CardDescription>Najprodavaniji iz preporuka</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Proizvod</TableHead>
                          <TableHead className="text-right">Konverzije</TableHead>
                          <TableHead className="text-right">Prihod</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.byItem.slice(0, 10).map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <div className="font-medium">{item.itemName}</div>
                              <div className="text-xs text-muted-foreground">{item.kind === 'PREMADE_BUNDLE' ? 'Paket' : 'Proizvod'}</div>
                            </TableCell>
                            <TableCell className="text-right font-medium">{item.convertedRecommendations}</TableCell>
                            <TableCell className="text-right text-emerald-600 font-medium">{money(item.conversionRevenueRsd)}</TableCell>
                          </TableRow>
                        ))}
                        {stats.byItem.length === 0 && (
                          <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Nema podataka</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
