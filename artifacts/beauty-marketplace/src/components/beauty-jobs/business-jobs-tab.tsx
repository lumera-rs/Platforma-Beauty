import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListMyBeautyJobs,
  getListMyBeautyJobsQueryKey,
  useListBeautyJobCategories,
  getListBeautyJobCategoriesQueryKey,
  useCloseBeautyJob,
  useRenewBeautyJob,
  BeautyJobListing,
  ListMyBeautyJobsParams,
  ListMyBeautyJobsStatus,
  ListMyBeautyJobsType,
  ListMyBeautyJobsListingMode,
  ListMyBeautyJobsPosted,
  ListMyBeautyJobsSort
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, Search, Edit, XCircle, RotateCcw, Users, SlidersHorizontal, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { BeautyJobCard } from "@/components/beauty-jobs/beauty-job-card";
import { BusinessJobApplicants } from "./business-job-applicants";
import { DebouncedInput } from "@/components/ui/debounced-input";

function isEnumValue<const T extends Record<string, string>>(
  options: T,
  value: string | null,
): value is T[keyof T] {
  return value !== null && Object.values(options).some((option) => option === value);
}

export function BusinessJobsTab({
  onEdit,
  onNew,
  isEmployee
}: {
  onEdit: (job: BeautyJobListing) => void;
  onNew: () => void;
  isEmployee: boolean;
}) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);

  const rawStatus = searchParams.get('status');
  const status = isEnumValue(ListMyBeautyJobsStatus, rawStatus) ? rawStatus : undefined;

  const rawType = searchParams.get('type');
  const type = isEnumValue(ListMyBeautyJobsType, rawType) ? rawType : undefined;

  const rawListingMode = searchParams.get('listingMode');
  const listingMode = isEnumValue(ListMyBeautyJobsListingMode, rawListingMode) ? rawListingMode : undefined;

  const category = searchParams.get('category') || undefined;

  const rawPeriod = searchParams.get('period');
  const period = isEnumValue(ListMyBeautyJobsPosted, rawPeriod) ? rawPeriod : 'all';

  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';

  const rawSort = searchParams.get('sort');
  const sort = isEnumValue(ListMyBeautyJobsSort, rawSort) ? rawSort : 'newest';

  const search = searchParams.get('search') || '';
  
  const rawPage = parseInt(searchParams.get('page') || '1', 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const pageSize = 10;

  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime())
      && date.getFullYear() === Number(value.slice(0, 4))
      && date.getMonth() + 1 === Number(value.slice(5, 7))
      && date.getDate() === Number(value.slice(8, 10));
  };
  const isCustomInvalid = period === "custom" && (!from || !to || !isValidDate(from) || !isValidDate(to) || from > to);

  const params: ListMyBeautyJobsParams = {
    status,
    type,
    listingMode,
    category,
    posted: period,
    from: period === 'custom' ? from : undefined,
    to: period === 'custom' ? to : undefined,
    query: search || undefined,
    sort,
    page,
    pageSize
  };

  const updateParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    if (Object.keys(changes).some(k => k !== "page" && k !== "tab")) {
      next.delete("page");
    }
    if (!next.has("tab")) next.set("tab", "my-jobs");
    setLocation(`/biznis/poslovi?${next.toString()}`);
  };

  const resetFilters = () => {
    const next = new URLSearchParams();
    next.set("tab", "my-jobs");
    setLocation(`/biznis/poslovi?${next.toString()}`);
  };

  const { data: myJobs, isLoading, isError } = useListMyBeautyJobs(params, { 
    query: { 
      queryKey: getListMyBeautyJobsQueryKey(params),
      enabled: !isCustomInvalid,
      placeholderData: keepPreviousData
    } 
  });
  
  const { data: categoriesResponse } = useListBeautyJobCategories({ query: { queryKey: getListBeautyJobCategoriesQueryKey() } });

  const closeMutation = useCloseBeautyJob();
  const renewMutation = useRenewBeautyJob();

  const handleClose = (id: string) => {
    if (confirm("Da li ste sigurni da želite da zatvorite ovaj oglas?")) {
      closeMutation.mutate({ listingId: id }, {
        onSuccess: () => {
          toast.success("Oglas zatvoren.");
          queryClient.invalidateQueries({ queryKey: getListMyBeautyJobsQueryKey() });
        }
      });
    }
  };

  const handleRenew = (id: string) => {
    renewMutation.mutate({ listingId: id }, {
      onSuccess: () => {
        toast.success("Oglas uspešno obnovljen.");
        queryClient.invalidateQueries({ queryKey: getListMyBeautyJobsQueryKey() });
      }
    });
  };

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const totalPages = Math.ceil((myJobs?.total || 0) / pageSize);

  return (
    <div className="flex flex-col xl:flex-row gap-6">
       {/* Sidebar Filters */}
       <div className="w-full xl:w-72 shrink-0 space-y-5 rounded-xl border bg-card p-5 shadow-sm h-fit" data-testid="business-jobs-filters">
          <div className="flex items-center justify-between border-b pb-4">
             <div className="flex items-center gap-2">
               <SlidersHorizontal className="w-5 h-5 text-primary" />
               <h3 className="font-bold text-lg font-serif">Filteri</h3>
             </div>
             <Button variant="ghost" size="sm" onClick={resetFilters} className="text-xs">Resetuj</Button>
          </div>

          <div className="space-y-4">
             <div className="space-y-1.5">
               <Label>Pretraga</Label>
               <div className="relative">
                 <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                 <DebouncedInput
                   className="pl-9"
                   placeholder="Pretraži naslov..."
                   value={search}
                   onChange={(val) => updateParams({ search: val.toString() })}
                   data-testid="filter-search"
                 />
               </div>
             </div>

             <div className="space-y-1.5">
               <Label>Status</Label>
               <Select value={status || 'all'} onValueChange={(v) => updateParams({ status: v === 'all' ? '' : v })}>
                 <SelectTrigger data-testid="filter-status"><SelectValue placeholder="Svi statusi" /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Svi statusi</SelectItem>
                   <SelectItem value="pending">Na čekanju</SelectItem>
                   <SelectItem value="active">Odobreni-aktivni</SelectItem>
                   <SelectItem value="rejected">Odbijeni</SelectItem>
                   <SelectItem value="expiring">Ističe uskoro</SelectItem>
                   <SelectItem value="expired">Istekli</SelectItem>
                   <SelectItem value="filled">Popunjeni</SelectItem>
                 </SelectContent>
               </Select>
             </div>

             <div className="space-y-1.5">
               <Label>Tip</Label>
               <Select value={type || 'all'} onValueChange={(v) => updateParams({ type: v === 'all' ? '' : v })}>
                 <SelectTrigger data-testid="filter-type"><SelectValue placeholder="Svi tipovi" /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Svi tipovi</SelectItem>
                   <SelectItem value="job">Zaposlenje</SelectItem>
                   <SelectItem value="rental">Izdavanje</SelectItem>
                   <SelectItem value="freelance">Freelance</SelectItem>
                 </SelectContent>
               </Select>
             </div>

             <div className="space-y-1.5">
               <Label>Namera</Label>
               <Select value={listingMode || 'all'} onValueChange={(v) => updateParams({ listingMode: v === 'all' ? '' : v })}>
                 <SelectTrigger data-testid="filter-listing-mode"><SelectValue placeholder="Sve namere" /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Sve namere</SelectItem>
                   <SelectItem value="offering">Nudim</SelectItem>
                   <SelectItem value="rental">Izdajem</SelectItem>
                   <SelectItem value="seeking_work">Tražim posao-usluge</SelectItem>
                   <SelectItem value="seeking_rental">Tražim opremu-prostor</SelectItem>
                 </SelectContent>
               </Select>
             </div>

             <div className="space-y-1.5">
               <Label>Kategorija</Label>
               <Select value={category || 'all'} onValueChange={(v) => updateParams({ category: v === 'all' ? '' : v })}>
                 <SelectTrigger data-testid="filter-category"><SelectValue placeholder="Sve kategorije" /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Sve kategorije</SelectItem>
                   {categoriesResponse?.categories?.map(c => (
                     <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>

             <div className="space-y-1.5">
               <Label>Period</Label>
               <Select value={period} onValueChange={(v) => updateParams({ period: v, from: '', to: '' })}>
                 <SelectTrigger data-testid="filter-period"><SelectValue /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Sve vreme</SelectItem>
                   <SelectItem value="today">Danas</SelectItem>
                   <SelectItem value="week">Ova nedelja</SelectItem>
                   <SelectItem value="month">Ovaj mesec</SelectItem>
                   <SelectItem value="custom">Prilagođeni datum</SelectItem>
                 </SelectContent>
               </Select>
             </div>

             {period === 'custom' && (
               <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                 <div className="grid grid-cols-2 gap-2">
                   <div className="space-y-1">
                     <Label className="text-xs">Od</Label>
                     <Input type="date" className="h-8 text-xs" value={from} onChange={e => updateParams({ from: e.target.value })} data-testid="filter-from" />
                   </div>
                   <div className="space-y-1">
                     <Label className="text-xs">Do</Label>
                     <Input type="date" className="h-8 text-xs" value={to} onChange={e => updateParams({ to: e.target.value })} data-testid="filter-to" />
                   </div>
                 </div>
                 {isCustomInvalid && (
                   <p className="text-xs text-destructive font-medium flex items-center gap-1 mt-1">
                     <AlertCircle className="w-3 h-3" />
                     Za prilagođeni period, unesite validan datum od i do (od mora biti pre do).
                   </p>
                 )}
               </div>
             )}

             <div className="space-y-1.5">
               <Label>Sortiranje</Label>
               <Select value={sort} onValueChange={(v) => updateParams({ sort: v })}>
                 <SelectTrigger data-testid="filter-sort"><SelectValue /></SelectTrigger>
                 <SelectContent>
                   <SelectItem value="newest">Najnovije prvo</SelectItem>
                   <SelectItem value="oldest">Najstarije prvo</SelectItem>
                   <SelectItem value="activity">Po broju prijava</SelectItem>
                 </SelectContent>
               </Select>
             </div>
          </div>
       </div>

       {/* Results */}
       <div className="flex-1 min-w-0 space-y-4">
          <div className="flex justify-between items-center bg-card p-4 rounded-xl border shadow-sm">
            <div>
              <h2 className="text-lg font-bold font-serif text-foreground">Vaši oglasi</h2>
              <p className="text-sm text-muted-foreground mt-1">Pronađeno: {!isCustomInvalid ? (myJobs?.total || 0) : 0} oglasa</p>
            </div>
            {!isEmployee && (
              <Button onClick={onNew} className="gap-2 shrink-0" data-testid="action-new-listing">
                <Briefcase className="w-4 h-4" /> Novi oglas
              </Button>
            )}
          </div>

          {isLoading && !myJobs ? (
            <div className="space-y-4"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-32 w-full rounded-xl" /></div>
          ) : isError ? (
            <div className="p-8 text-center text-destructive bg-destructive/5 rounded-xl border border-destructive/20">
              Došlo je do greške prilikom učitavanja.
            </div>
          ) : isCustomInvalid ? (
             <div className="text-center py-16 bg-card border border-dashed rounded-xl shadow-sm text-muted-foreground">
                Potrebno je uneti validan prilagođeni period kako bi se prikazali rezultati.
             </div>
          ) : myJobs?.items?.length === 0 ? (
            <div className="text-center py-16 bg-card border border-dashed rounded-xl shadow-sm">
              <Briefcase className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="font-medium text-lg mb-2">Nema rezultata</h3>
              <p className="text-muted-foreground mb-6">Pokušajte da promenite filtere ili objavite novi oglas.</p>
              {!isEmployee && (
                <Button onClick={onNew}>Objavi oglas</Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {myJobs?.items?.map(job => (
                <div key={job.id} className="relative group" data-testid={`business-job-card-${job.id}`}>
                  <BeautyJobCard job={job} showSaveButton={false} />
                  
                  <div className="flex flex-wrap items-center justify-between gap-3 px-1 mt-2">
                     <div className="flex gap-2">
                        {!isEmployee && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => onEdit(job)} data-testid={`action-edit-${job.id}`}>
                              <Edit className="w-4 h-4 mr-1.5" /> Izmeni
                            </Button>
                            {job.status === "active" ? (
                              <Button size="sm" variant="secondary" className="text-destructive hover:text-destructive hover:bg-destructive/10 border-transparent hover:border-destructive/20" onClick={() => handleClose(job.id)} data-testid={`action-close-${job.id}`}>
                                <XCircle className="w-4 h-4 mr-1.5" /> Zatvori
                              </Button>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => handleRenew(job.id)} data-testid={`action-renew-${job.id}`}>
                                <RotateCcw className="w-4 h-4 mr-1.5" /> Obnovi
                              </Button>
                            )}
                          </>
                        )}
                     </div>
                     {job.type === 'job' && (
                        <Button
                          size="sm"
                          variant={job.contactCount > 0 ? "default" : "outline"}
                          className="shadow-sm ml-auto"
                          onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                          data-testid={`action-applicants-${job.id}`}
                        >
                          <Users className="w-4 h-4 mr-1.5" /> 
                          {expandedId === job.id ? "Zatvori prijave" : `Upravljanje prijavama (${job.contactCount})`}
                        </Button>
                     )}
                  </div>

                  {expandedId === job.id && (
                     <div className="mt-3 border bg-muted/10 p-5 rounded-xl shadow-sm animate-in slide-in-from-top-2 fade-in duration-200">
                       <BusinessJobApplicants listingId={job.id} />
                     </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && !isCustomInvalid && (
            <div className="flex items-center justify-center gap-4 pt-6">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => updateParams({ page: (page - 1).toString() })}
              >
                <ChevronLeft className="w-4 h-4 mr-2" /> Prethodna
              </Button>
              <span className="text-sm font-medium">Strana {page} od {totalPages}</span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => updateParams({ page: (page + 1).toString() })}
              >
                Sledeća <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
       </div>
    </div>
  );
}
