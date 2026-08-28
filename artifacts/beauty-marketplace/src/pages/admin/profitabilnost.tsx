import { useState } from "react";
import { AdminLayout } from "./layout";
import { useAdminGetCommerceProfitability } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowUpRight, ArrowDownRight, TrendingUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";

const money = (val: number) => new Intl.NumberFormat("sr-RS", { style: "currency", currency: "RSD", maximumFractionDigits: 0 }).format(val);

export default function AdminProfitability() {
  const [params, setParams] = useState({
    periodDays: 30,
    market: "ALL",
    supplierId: "",
    categoryId: "",
    brand: "",
    productId: ""
  });

  const { data, isLoading } = useAdminGetCommerceProfitability({
    from: new Date(Date.now() - params.periodDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
    market: (params.market === "ALL" ? "BOTH" : params.market) as any,
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
    ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    ...(params.brand ? { brand: params.brand } : {}),
    ...(params.productId ? { productId: params.productId } : {})
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Izveštaj o profitabilnosti</h1>
          <p className="text-muted-foreground">Analiza prihoda, troškova i marži na osnovu prodatih proizvoda.</p>
        </div>

        <Card>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 p-4">
            <div className="space-y-2">
              <Label>Vremenski period</Label>
              <Select value={params.periodDays.toString()} onValueChange={(v) => setParams({ ...params, periodDays: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Poslednjih 7 dana</SelectItem>
                  <SelectItem value="30">Poslednjih 30 dana</SelectItem>
                  <SelectItem value="90">Poslednjih 90 dana</SelectItem>
                  <SelectItem value="365">Poslednjih 365 dana</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tržište (Kanal)</Label>
              <Select value={params.market} onValueChange={(v) => setParams({ ...params, market: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Sva tržišta</SelectItem>
                  <SelectItem value="B2B">Samo B2B</SelectItem>
                  <SelectItem value="B2C">Samo B2C</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Dobavljač ID</Label>
              <Input value={params.supplierId} onChange={(e) => setParams({ ...params, supplierId: e.target.value })} placeholder="UUID dobavljača" />
            </div>
            <div className="space-y-2">
              <Label>Kategorija ID</Label>
              <Input value={params.categoryId} onChange={(e) => setParams({ ...params, categoryId: e.target.value })} placeholder="UUID kategorije" />
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Ukupan prihod (Revenue)</CardDescription>
                  <CardTitle className="text-2xl">{money(data.kpis.revenueRsd)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Ukupan trošak nabavke</CardDescription>
                  <CardTitle className="text-2xl text-destructive">{money(data.kpis.cogsRsd)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Bruto profit (Gross Profit)</CardDescription>
                  <CardTitle className="text-2xl text-emerald-600 flex items-center gap-2">
                    {money(data.kpis.profitRsd)}
                    {data.kpis.profitRsd > 0 && <TrendingUp className="h-5 w-5" />}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Prosečna marža</CardDescription>
                  <CardTitle className="text-2xl text-primary">{(data.kpis.marginPercent ?? 0).toFixed(2)}%</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Prihod vs Profit tokom vremena</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.timeSeries}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 12 }} stroke="#888" tickFormatter={(val) => new Date(val).toLocaleDateString("sr-RS", { month: "short", day: "numeric" })} />
                      <YAxis tickFormatter={(val) => `${val / 1000}k`} tick={{ fontSize: 12 }} stroke="#888" />
                      <Tooltip 
                        formatter={(value: number) => money(value)} 
                        labelFormatter={(label) => new Date(label).toLocaleDateString("sr-RS")}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="revenueRsd" name="Prihod" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="profitRsd" name="Profit" stroke="#10b981" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Detalji po proizvodima</CardTitle>
                <CardDescription>Prikazani su samo proizvodi sa definisanom nabavnom cenom.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 font-medium">Proizvod</th>
                        <th className="pb-2 font-medium text-right">Prodato kom.</th>
                        <th className="pb-2 font-medium text-right">Prihod</th>
                        <th className="pb-2 font-medium text-right">Trošak</th>
                        <th className="pb-2 font-medium text-right">Profit</th>
                        <th className="pb-2 font-medium text-right">Marža</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.products.map((item) => (
                        <tr key={item.productId} className="hover:bg-muted/50 transition-colors">
                          <td className="py-3 font-medium">{item.productName}</td>
                          <td className="py-3 text-right">{item.units}</td>
                          <td className="py-3 text-right">{money(item.realizedRevenueRsd)}</td>
                          <td className="py-3 text-right text-destructive">{money(item.cogsRsd)}</td>
                          <td className="py-3 text-right text-emerald-600 font-semibold">{money(item.profitRsd)}</td>
                          <td className="py-3 text-right">
                            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              {(item.marginPercent ?? 0).toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {data.products.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-muted-foreground">
                            Nema podataka o proizvodima u izabranom periodu.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
