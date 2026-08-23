import { useState, useMemo, useEffect } from "react";
import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { useOwnerListRetention, useOwnerGetRetentionDetail, useUpdateSalonCustomer } from "@workspace/api-client-react";
import { useGetCurrentUser, getOwnerListRetentionQueryKey, getOwnerGetRetentionDetailQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, HeartHandshake, AlertTriangle, Calendar, Phone, Mail, Clock, DollarSign, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";

export default function OwnerRetention() {
  const { data: userResp } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: retentionData, isLoading } = useOwnerListRetention({
    query: {
      enabled: !!userResp?.user,
      queryKey: getOwnerListRetentionQueryKey()
    }
  });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const { data: detailData, isLoading: isDetailLoading } = useOwnerGetRetentionDetail(
    selectedCustomerId ?? "",
    {
      query: {
        enabled: !!selectedCustomerId,
        queryKey: getOwnerGetRetentionDetailQueryKey(selectedCustomerId ?? "")
      }
    }
  );

  const updateCustomerMutation = useUpdateSalonCustomer();
  const [birthDate, setBirthDate] = useState("");
  const [isEditingBirthDate, setIsEditingBirthDate] = useState(false);

  // Initialize birthDate when detailData is loaded or changes
  useEffect(() => {
    if (detailData) {
      setBirthDate(detailData.birthDate || "");
      // Also close edit mode when switching customers
      setIsEditingBirthDate(false);
    }
  }, [detailData, selectedCustomerId]);

  const customers = retentionData || [];
  
  const filteredCustomers = useMemo(() => {
    return customers.filter((c: any) => {
      const matchesSearch = (c.firstName + " " + c.lastName).toLowerCase().includes(search.toLowerCase()) || 
                            (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
                            (c.phone && c.phone.includes(search));
      const matchesFilter = filter === "ALL" || c.status === filter;
      return matchesSearch && matchesFilter;
    });
  }, [customers, search, filter]);

  const stats = useMemo(() => {
    return {
      total: customers.length,
      new: customers.filter((c: any) => c.status === 'NEW').length,
      active: customers.filter((c: any) => c.status === 'ACTIVE').length,
      vip: customers.filter((c: any) => c.status === 'VIP').length,
      atRisk: customers.filter((c: any) => c.status === 'AT_RISK').length,
      lost: customers.filter((c: any) => c.status === 'LOST').length,
    };
  }, [customers]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NEW': return <Badge variant="secondary" className="bg-blue-100 text-blue-700">Novi</Badge>;
      case 'ACTIVE': return <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Aktivan</Badge>;
      case 'VIP': return <Badge variant="secondary" className="bg-purple-100 text-purple-700">VIP</Badge>;
      case 'AT_RISK': return <Badge variant="secondary" className="bg-orange-100 text-orange-700">Rizik od odlaska</Badge>;
      case 'LOST': return <Badge variant="secondary" className="bg-red-100 text-red-700">Izgubljen</Badge>;
      default: return <Badge>{status}</Badge>;
    }
  };

  const handleUpdateBirthDate = () => {
    if (!selectedCustomerId) return;
    
    updateCustomerMutation.mutate({
      customerId: selectedCustomerId,
      data: { birthDate: birthDate || null }
    }, {
      onSuccess: () => {
        toast.success("Datum rođenja uspešno sačuvan.");
        setIsEditingBirthDate(false);
        queryClient.invalidateQueries({ queryKey: getOwnerListRetentionQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerGetRetentionDetailQueryKey(selectedCustomerId) });
      },
      onError: () => {
        toast.error("Greška prilikom čuvanja datuma rođenja.");
      }
    });
  };

  const handleEditBirthDate = (customer: any) => {
    setSelectedCustomerId(customer.salonCustomerId);
    setBirthDate(customer.birthDate || "");
    setIsEditingBirthDate(true);
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/klijenti" />
        
        <div className="flex-1 space-y-6 w-full min-w-0">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">CRM & Retencija</h1>
            <p className="text-muted-foreground mt-1">Pratite aktivnost klijenata i sprečite odlazak.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card className="bg-blue-50 border-blue-100">
              <CardContent className="p-4 text-center">
                <p className="text-sm font-medium text-blue-700">Novi</p>
                <p className="text-2xl font-bold text-blue-900">{stats.new}</p>
              </CardContent>
            </Card>
            <Card className="bg-emerald-50 border-emerald-100">
              <CardContent className="p-4 text-center">
                <p className="text-sm font-medium text-emerald-700">Aktivni</p>
                <p className="text-2xl font-bold text-emerald-900">{stats.active}</p>
              </CardContent>
            </Card>
            <Card className="bg-purple-50 border-purple-100">
              <CardContent className="p-4 text-center">
                <p className="text-sm font-medium text-purple-700">VIP</p>
                <p className="text-2xl font-bold text-purple-900">{stats.vip}</p>
              </CardContent>
            </Card>
            <Card className="bg-orange-50 border-orange-100">
              <CardContent className="p-4 text-center">
                <p className="text-sm font-medium text-orange-700">Rizik</p>
                <p className="text-2xl font-bold text-orange-900">{stats.atRisk}</p>
              </CardContent>
            </Card>
            <Card className="bg-red-50 border-red-100">
              <CardContent className="p-4 text-center">
                <p className="text-sm font-medium text-red-700">Izgubljeni</p>
                <p className="text-2xl font-bold text-red-900">{stats.lost}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
              <CardTitle className="text-lg">Klijenti</CardTitle>
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    placeholder="Pretraži klijente..." 
                    className="pl-9 h-9 text-sm"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground"
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                >
                  <option value="ALL">Svi statusi</option>
                  <option value="NEW">Novi</option>
                  <option value="ACTIVE">Aktivni</option>
                  <option value="VIP">VIP</option>
                  <option value="AT_RISK">Rizik od odlaska</option>
                  <option value="LOST">Izgubljeni</option>
                </select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : filteredCustomers.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  Nema pronađenih klijenata.
                </div>
              ) : (
                <div className="divide-y">
                  {filteredCustomers.map((customer: any) => (
                    <div key={customer.salonCustomerId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-muted/10 transition-colors">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-foreground">{customer.firstName} {customer.lastName}</h4>
                          {getStatusBadge(customer.status)}
                          {customer.hasFutureAppointment && <Badge variant="outline" className="text-xs">Zauzeto</Badge>}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {customer.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {customer.phone}</span>}
                          {customer.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {customer.email}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-6 sm:text-right">
                        <div className="text-sm">
                          <p className="font-medium text-foreground">{customer.totalSpend.toLocaleString()} RSD</p>
                          <p className="text-muted-foreground text-xs">{customer.completedCount} poseta</p>
                        </div>
                        <div className="text-sm w-24">
                          {customer.lastVisitDaysAgo !== null ? (
                            <>
                              <p className="font-medium text-foreground">Pre {customer.lastVisitDaysAgo} dana</p>
                              {customer.typicalIntervalDays && <p className="text-muted-foreground text-xs">Ciklus: {customer.typicalIntervalDays}d</p>}
                            </>
                          ) : (
                            <p className="text-muted-foreground">Nema poseta</p>
                          )}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setSelectedCustomerId(customer.salonCustomerId)}>Detalji</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!selectedCustomerId} onOpenChange={(open) => !open && setSelectedCustomerId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {isDetailLoading ? (
             <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : detailData ? (
            <>
              <DialogHeader className="pb-4 border-b">
                <div className="flex items-start justify-between">
                  <div>
                    <DialogTitle className="text-2xl flex items-center gap-2">
                      {detailData.firstName} {detailData.lastName}
                      {getStatusBadge(detailData.status)}
                    </DialogTitle>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                      {detailData.phone && <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {detailData.phone}</span>}
                      {detailData.email && <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {detailData.email}</span>}
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <div className="rounded-lg border bg-muted/20 p-4 mt-4 space-y-2" data-testid="retention-explanation">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-sm">Zašto ovaj status?</h4>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Pragovi {detailData.thresholdVersion === 0 ? "— podrazumevani" : `v${detailData.thresholdVersion}`}
                  </span>
                </div>
                <p className="text-sm text-foreground">{detailData.explanation}</p>
                <p className="text-sm text-muted-foreground flex items-start gap-1.5">
                  <HeartHandshake className="w-4 h-4 shrink-0 mt-0.5" />
                  {detailData.recommendedAction}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 my-4">
                <div className="bg-muted/30 p-3 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Ukupna potrošnja</p>
                  <p className="text-lg font-bold mt-1">{detailData.totalSpend.toLocaleString()} RSD</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Završeni termini</p>
                  <p className="text-lg font-bold mt-1">{detailData.completedCount}</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Poslednja poseta</p>
                  <p className="text-lg font-bold mt-1">{detailData.lastVisitDaysAgo !== null ? `Pre ${detailData.lastVisitDaysAgo} dana` : 'Nema'}</p>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm">Datum rođenja</h4>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditingBirthDate(!isEditingBirthDate)}>
                    {isEditingBirthDate ? 'Odustani' : 'Izmeni'}
                  </Button>
                </div>
                {isEditingBirthDate ? (
                  <div className="flex items-center gap-2">
                    <Input 
                      type="date" 
                      value={birthDate} 
                      onChange={e => setBirthDate(e.target.value)} 
                      className="w-auto"
                    />
                    <Button size="sm" onClick={handleUpdateBirthDate} disabled={updateCustomerMutation.isPending}>
                      {updateCustomerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sačuvaj'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Datum rođenja je sačuvan u profilu klijenta za rođendanske automatizacije.
                  </p>
                )}
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-3">Istorija termina ({detailData.recentAppointments.length})</h4>
                {detailData.recentAppointments.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Nema zabeleženih termina.</p>
                ) : (
                  <div className="space-y-3">
                    {detailData.recentAppointments.map(appt => (
                      <div key={appt.id} className="flex justify-between items-center p-3 rounded-lg border bg-card">
                        <div>
                          <p className="font-medium text-sm">{appt.serviceName}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Calendar className="w-3 h-3" /> {format(parseISO(appt.date), 'dd.MM.yyyy')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-sm">{appt.price.toLocaleString()} RSD</p>
                          <Badge variant="outline" className="mt-1 text-[10px]">{appt.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

    </BusinessLayout>
  );
}
