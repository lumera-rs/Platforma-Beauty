import { useState, useMemo } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useOwnerListEmployeePerformance,
  useOwnerUpdateEmployeeCommission,
  useGetCurrentUser,
  getOwnerListEmployeePerformanceQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, TrendingUp, DollarSign, Star, Calendar, RefreshCcw, BarChart3, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth, endOfDay, startOfDay } from "date-fns";
import { srLatn } from "date-fns/locale";

export default function OwnerPerformance() {
  const { data: userResp } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dateRange, setDateRange] = useState<"this_month" | "last_month" | "last_30">("this_month");
  const [scope, setScope] = useState<"location" | "all">("location");
  
  const rangeParams = useMemo(() => {
    const today = new Date();
    let startDate, endDate;
    
    if (dateRange === "this_month") {
      startDate = startOfMonth(today);
      endDate = endOfDay(today);
    } else if (dateRange === "last_month") {
      const lastMonth = subDays(startOfMonth(today), 1);
      startDate = startOfMonth(lastMonth);
      endDate = endOfMonth(lastMonth);
    } else {
      startDate = subDays(today, 30);
      endDate = endOfDay(today);
    }
    
    return {
      from: format(startDate, 'yyyy-MM-dd'),
      to: format(endDate, 'yyyy-MM-dd')
    };
  }, [dateRange]);

  const performanceParams = useMemo(() => ({ ...rangeParams, scope }), [rangeParams, scope]);
  const { data: performance, isLoading } = useOwnerListEmployeePerformance(
    performanceParams,
    {
      query: {
        enabled: !!userResp?.user,
        // Scope is part of the cache identity: all-location figures must never
        // be shown briefly for the active location (or vice versa).
        queryKey: getOwnerListEmployeePerformanceQueryKey(performanceParams)
      }
    }
  );

  const updateCommissionMutation = useOwnerUpdateEmployeeCommission();
  const [isEditing, setIsEditing] = useState(false);
  const [currentEmp, setCurrentEmp] = useState<any>(null);

  const [formData, setFormData] = useState({
    commissionType: "percent_of_revenue" as "percent_of_revenue" | "fixed_per_treatment",
    commissionPercent: 30,
    fixedAmountInDinars: 500,
  });

  const handleEdit = (emp: any) => {
    setCurrentEmp(emp);
    setFormData({
      commissionType: emp.commissionType,
      commissionPercent: emp.commissionPercent || 0,
      fixedAmountInDinars: emp.fixedAmountInDinars || 0,
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    if (!currentEmp) return;
    
    updateCommissionMutation.mutate({
      employeeId: currentEmp.employeeId,
      data: {
        commissionType: formData.commissionType,
        commissionPercent: formData.commissionType === 'percent_of_revenue' ? Number(formData.commissionPercent) : undefined,
        fixedAmountInDinars: formData.commissionType === 'fixed_per_treatment' ? Number(formData.fixedAmountInDinars) : undefined,
        perServiceOverrides: {} 
      }
    }, {
      onSuccess: () => {
        toast.success("Provizija uspešno ažurirana.");
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: ['owner-employee-performance'] });
      }
    });
  };

  const metrics = performance?.employees ?? [];
  const totalRevenue = metrics.reduce((acc, m) => acc + m.totalRevenue, 0);
  const totalCommission = metrics.reduce((acc, m) => acc + m.estimatedCommission, 0);
  
  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/performanse" />
        
        <div className="flex-1 space-y-6 w-full min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Performanse tima</h1>
              <p className="text-muted-foreground mt-1">Pratite učinak zaposlenih i obračunajte provizije.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="inline-flex rounded-lg border bg-muted/40 p-1" aria-label="Opseg performansi">
                <Button type="button" size="sm" variant={scope === "location" ? "default" : "ghost"} aria-pressed={scope === "location"} onClick={() => setScope("location")}>Aktivna lokacija</Button>
                <Button type="button" size="sm" variant={scope === "all" ? "default" : "ghost"} aria-pressed={scope === "all"} onClick={() => setScope("all")}>Sve lokacije</Button>
              </div>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={dateRange}
                onChange={e => setDateRange(e.target.value as "this_month" | "last_month" | "last_30")}
              >
                <option value="this_month">Ovaj mesec</option>
                <option value="last_month">Prošli mesec</option>
                <option value="last_30">Poslednjih 30 dana</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2 text-sm font-medium text-primary">
                  <DollarSign className="w-4 h-4" /> Ukupan prihod tima
                </div>
                <p className="text-3xl font-bold text-primary">{totalRevenue.toLocaleString()} RSD</p>
                <p className="text-xs text-primary/70 mt-1">Za odabrani period</p>
              </CardContent>
            </Card>
            <Card className="bg-orange-50 border-orange-200">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2 text-sm font-medium text-orange-800">
                  <BarChart3 className="w-4 h-4" /> Procenjena provizija (Ukupno)
                </div>
                <p className="text-3xl font-bold text-orange-900">{totalCommission.toLocaleString()} RSD</p>
                <p className="text-xs text-orange-700/70 mt-1">Na osnovu podešenih pravila</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Pregled po zaposlenima</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : metrics.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">Nema podataka za odabrani period.</div>
              ) : (
                <div className="divide-y">
                  {metrics.map((m) => (
                    <div key={m.employeeId} className="p-4 flex flex-col lg:flex-row gap-6 hover:bg-muted/10 transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-bold text-lg">{m.employeeName}</h4>
                          <Button variant="ghost" size="sm" className="h-8 text-primary" onClick={() => handleEdit(m)}>
                            <Settings className="w-4 h-4 mr-2" /> Podešavanje provizije
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Prihod</p>
                            <p className="font-bold text-foreground">{m.totalRevenue.toLocaleString()} RSD</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Završeni termini</p>
                            <p className="font-bold text-foreground">{m.completedAppointments}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Prosečna vrednost</p>
                            <p className="font-bold text-foreground">{Math.round(m.averageAppointmentValue).toLocaleString()} RSD</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Ocena</p>
                            <div className="flex items-center gap-1 font-bold text-foreground">
                              <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                              {m.reviewCount > 0 ? (m.averageRating / 10).toFixed(1) : "Nema"}
                              {m.reviewCount > 0 && <span className="text-xs text-muted-foreground font-normal">({m.reviewCount})</span>}
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-muted/50">
                          <div className="col-span-2">
                            <p className="text-xs text-muted-foreground mb-1">Pravilo provizije</p>
                            <p className="text-sm font-medium">
                              {m.commissionType === 'percent_of_revenue' 
                                ? `${m.commissionPercent}% od prihoda` 
                                : `${m.fixedAmountInDinars} RSD po tretmanu`}
                            </p>
                          </div>
                          <div className="col-span-2 sm:col-span-2 text-left sm:text-right">
                            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Obračun provizije</p>
                            <p className="text-xl font-bold text-orange-600">{m.estimatedCommission.toLocaleString()} RSD</p>
                          </div>
                        </div>
                        
                        <div className="flex gap-4 mt-4 text-xs text-muted-foreground bg-muted/20 p-2 rounded">
                          <span className="flex items-center gap-1"><RefreshCcw className="w-3.5 h-3.5" /> Rebooking rate: {Math.round(m.rebookingRate * 100)}%</span>
                          <span>No-show: {m.noShowCount}</span>
                          <span>Otkazano: {m.cancelledCount}</span>
                        </div>
                        {scope === "all" && m.locationBreakdown.length > 0 && (
                          <div className="mt-3 rounded-lg border bg-muted/10">
                            <p className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Po lokaciji</p>
                            <div className="divide-y">
                              {m.locationBreakdown.map((item) => (
                                <div key={item.salonId} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:gap-4">
                                  <span className="font-medium">{item.locationName}</span>
                                  <span>{item.completedAppointments} termina</span>
                                  <span className="font-semibold">{item.totalRevenue.toLocaleString()} RSD</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={isEditing} onOpenChange={(open) => !open && setIsEditing(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Podešavanje provizije</DialogTitle>
            <DialogDescription>Za zaposlenog: <strong className="text-foreground">{currentEmp?.employeeName}</strong></DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Način obračuna</Label>
              <select 
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" 
                value={formData.commissionType} 
                onChange={e => setFormData({...formData, commissionType: e.target.value as any})}
              >
                <option value="percent_of_revenue">Procenat od prihoda</option>
                <option value="fixed_per_treatment">Fiksni iznos po tretmanu</option>
              </select>
            </div>

            {formData.commissionType === 'percent_of_revenue' ? (
              <div className="space-y-2">
                <Label>Procenat (%)</Label>
                <Input type="number" min="0" max="100" value={formData.commissionPercent} onChange={e => setFormData({...formData, commissionPercent: Number(e.target.value)})} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Fiksni iznos (RSD)</Label>
                <Input type="number" min="0" value={formData.fixedAmountInDinars} onChange={e => setFormData({...formData, fixedAmountInDinars: Number(e.target.value)})} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">Nova pravila se primenjuju na sve buduće obračune za ovog zaposlenog.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={updateCommissionMutation.isPending}>
              {updateCommissionMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
