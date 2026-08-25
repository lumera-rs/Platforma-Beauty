import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { srLatn } from "date-fns/locale";
import {
  useGetBeautyJobModerationQueue,
  getGetBeautyJobModerationQueueQueryKey,
  useGetBeautyJobSettings,
  getGetBeautyJobSettingsQueryKey,
  useUpdateBeautyJobSettings,
  useSweepExpiredBeautyJobs,
  useResolveBeautyJobReport,
  useGetBeautyJobDeliveryIssues,
  getGetBeautyJobDeliveryIssuesQueryKey,
  useRetryBeautyJobDelivery,
  useBulkModerateBeautyJobs,
  useListBeautyJobCategories,
  getListBeautyJobCategoriesQueryKey,
  getListRejectedBeautyJobsQueryKey,
  type GetBeautyJobModerationQueueParams,
  GetBeautyJobModerationQueueStatus,
  GetBeautyJobModerationQueueType,
  GetBeautyJobModerationQueueListingMode,
  GetBeautyJobModerationQueuePostedBy,
  GetBeautyJobModerationQueuePeriod,
  GetBeautyJobModerationQueueSort
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { AdminLayout } from "@/pages/admin/layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Settings, Trash2, CheckCircle2, XCircle, Flag, Clock, MailWarning, RefreshCw, ChevronLeft, ChevronRight, Search, SlidersHorizontal, Lock, Trash, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Link, useLocation, useSearch } from "wouter";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DebouncedInput } from "@/components/ui/debounced-input";

const deliveryTypeLabels: Record<string, string> = {
  beauty_job_new_contact: "Novi kontakt",
  beauty_job_author_reply: "Odgovor autora",
  beauty_job_moderation: "Moderacija oglasa",
  beauty_job_expiry_warning: "Upozorenje o isteku",
};

const deliveryIssueLabels: Record<string, string> = {
  delayed: "Dugo na čekanju",
  temporary: "Prolazna greška",
  permanent: "Trajna greška",
  configuration: "Slanje preskočeno",
};

const periods = [
  ["today", "Danas"],
  ["week", "Ova nedelja"],
  ["month", "Ovaj mesec"],
  ["custom", "Prilagođeni datum"],
  ["all", "Sve vreme"],
] as const;

const adminTabs = ["queue", "reports", "email-deliveries", "settings"] as const;

function isEnumValue<const T extends Record<string, string>>(
  options: T,
  value: string | null,
): value is T[keyof T] {
  return value !== null && Object.values(options).some((option) => option === value);
}

function isAdminTab(value: string | null): value is (typeof adminTabs)[number] {
  return value !== null && adminTabs.some((tab) => tab === value);
}

export default function AdminBeautyJobsPage() {
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const [historyVersion, setHistoryVersion] = useState(0);

  // Popstate re-render subscription
  useEffect(() => {
    const handlePopState = () => setHistoryVersion((version) => version + 1);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const searchParams = useMemo(
    () => new URLSearchParams(searchString),
    [searchString, historyVersion],
  );

  const rawTab = searchParams.get("tab");
  const activeTab = isAdminTab(rawTab) ? rawTab : "queue";
  const setActiveTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setLocation(`/admin/poslovi?${next.toString()}`);
  };

  // --- FILTERS STATE (URL) ---
  const rawStatus = searchParams.get("status");
  const parsedStatus = isEnumValue(GetBeautyJobModerationQueueStatus, rawStatus) ? rawStatus : "pending";

  const rawType = searchParams.get("type");
  const parsedType = isEnumValue(GetBeautyJobModerationQueueType, rawType) ? rawType : undefined;

  const rawListingMode = searchParams.get("listingMode");
  const parsedListingMode = isEnumValue(GetBeautyJobModerationQueueListingMode, rawListingMode) ? rawListingMode : undefined;

  const rawPostedBy = searchParams.get("postedBy");
  const parsedPostedBy = isEnumValue(GetBeautyJobModerationQueuePostedBy, rawPostedBy) ? rawPostedBy : undefined;

  const rawPeriod = searchParams.get("period");
  const parsedPeriod = isEnumValue(GetBeautyJobModerationQueuePeriod, rawPeriod) ? rawPeriod : "all";

  const rawSort = searchParams.get("sort");
  const parsedSort = isEnumValue(GetBeautyJobModerationQueueSort, rawSort) ? rawSort : "oldest";

  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const parsedPage = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  const rawPageSize = parseInt(searchParams.get("pageSize") || "20", 10);
  const parsedPageSize = [10, 20, 50, 100].includes(rawPageSize) ? rawPageSize : 20;

  const params: GetBeautyJobModerationQueueParams = {
    search: searchParams.get("search") || undefined,
    status: parsedStatus,
    type: parsedType,
    listingMode: parsedListingMode,
    category: searchParams.get("category") || undefined,
    postedBy: parsedPostedBy,
    period: parsedPeriod,
    from: parsedPeriod === "custom" ? searchParams.get("from") || undefined : undefined,
    to: parsedPeriod === "custom" ? searchParams.get("to") || undefined : undefined,
    reportedOnly: searchParams.get("reportedOnly") === "true",
    sort: parsedSort,
    page: parsedPage,
    pageSize: parsedPageSize,
  };

  const updateParams = (changes: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    // Reset page if filter changes
    if (Object.keys(changes).some(k => k !== "page" && k !== "pageSize" && k !== "tab")) {
      next.delete("page");
    }
    setLocation(`/admin/poslovi?${next.toString()}`);
  };

  const resetFilters = () => {
    const next = new URLSearchParams();
    next.set("tab", "queue");
    setLocation(`/admin/poslovi?${next.toString()}`);
  };

  const { data: queue, isLoading: isLoadingQueue, isError: isQueueError } = useGetBeautyJobModerationQueue(params, {
    query: { queryKey: getGetBeautyJobModerationQueueQueryKey(params), placeholderData: keepPreviousData }
  });

  const { data: categoriesResponse } = useListBeautyJobCategories({ query: { queryKey: getListBeautyJobCategoriesQueryKey() } });
  const { data: settings, isLoading: isLoadingSettings } = useGetBeautyJobSettings({ query: { queryKey: getGetBeautyJobSettingsQueryKey() } });
  const { data: deliveryIssues, isLoading: isLoadingDeliveryIssues } = useGetBeautyJobDeliveryIssues({
    query: {
      queryKey: getGetBeautyJobDeliveryIssuesQueryKey(),
      refetchInterval: 60_000,
    },
  });

  const bulkModerateMutation = useBulkModerateBeautyJobs();
  const resolveReportMutation = useResolveBeautyJobReport();
  const updateSettingsMutation = useUpdateBeautyJobSettings();
  const sweepMutation = useSweepExpiredBeautyJobs();
  const retryDeliveryMutation = useRetryBeautyJobDelivery();
  const actionGuard = useImmediateActionGuard();

  // Settings State
  const [hourlyPostingLimit, setHourlyPostingLimit] = useState<number | "">(0);
  const [expiryDays, setExpiryDays] = useState<number | "">(0);
  const [isSettingsDirty, setIsSettingsDirty] = useState(false);

  useEffect(() => {
    if (!settings || isSettingsDirty) return;
    setHourlyPostingLimit(settings.hourlyPostingLimit);
    setExpiryDays(settings.listingExpiryDays);
  }, [settings, isSettingsDirty]);

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const bulkSelectionEnabled = params.status === "pending";

  const toggleSelection = (id: string) => {
    if (!bulkSelectionEnabled) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = (checked: boolean) => {
    if (!queue?.listings || !bulkSelectionEnabled) return;
    const selectableIds = queue.listings
      .filter((listing) => listing.moderationStatus === "pending" && listing.status === "active")
      .map((listing) => listing.id);
    if (checked) {
      setSelectedIds(new Set(selectableIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  useEffect(() => {
    // Clear selection on page/filter change
    setSelectedIds(new Set());
  }, [searchString]);

  // Individual Actions
  const [rejectReason, setRejectReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [approveInternalNote, setApproveInternalNote] = useState("");
  const [selectedApproveJobId, setSelectedApproveJobId] = useState<string | null>(null);

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [reportResolution, setReportResolution] = useState("");

  const handleModerate = (jobId: string, action: "approve" | "reject") => {
    bulkModerateMutation.mutate({
      data: {
        listingIds: [jobId],
        action,
        reason: action === "reject" ? rejectReason : undefined,
        internalNote: action === "reject" ? (internalNote || undefined) : (approveInternalNote || undefined)
      }
    }, {
      onSuccess: () => {
        toast.success(action === "approve" ? "Oglas je odobren." : "Oglas je odbijen.");
        setSelectedJobId(null);
        setSelectedApproveJobId(null);
        setRejectReason("");
        setInternalNote("");
        setApproveInternalNote("");
        // Invalidate base keys
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobModerationQueueQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRejectedBeautyJobsQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške prilikom moderacije.")
    });
  };

  // Bulk Actions
  const [isBulkApproveOpen, setIsBulkApproveOpen] = useState(false);
  const [isBulkRejectOpen, setIsBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState("");
  const [bulkInternalNote, setBulkInternalNote] = useState("");

  const handleBulkModerate = (action: "approve" | "reject") => {
    bulkModerateMutation.mutate({
      data: {
        listingIds: Array.from(selectedIds),
        action,
        reason: action === "reject" ? bulkRejectReason : undefined,
        internalNote: bulkInternalNote || undefined
      }
    }, {
      onSuccess: () => {
        toast.success(action === "approve" ? `Uspešno odobreno ${selectedIds.size} oglasa.` : `Uspešno odbijeno ${selectedIds.size} oglasa.`);
        setSelectedIds(new Set());
        setBulkRejectReason("");
        setBulkInternalNote("");
        setIsBulkApproveOpen(false);
        setIsBulkRejectOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobModerationQueueQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRejectedBeautyJobsQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške prilikom masovne moderacije.")
    });
  };

  const handleResolveReport = (reportId: string, status: "dismissed" | "resolved") => {
    resolveReportMutation.mutate({ reportId, data: { status, resolutionNote: reportResolution } }, {
      onSuccess: () => {
        toast.success("Prijava je rešena.");
        setSelectedReportId(null);
        setReportResolution("");
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobModerationQueueQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške prilikom rešavanja prijave.")
    });
  };

  const handleSaveSettings = () => {
    if (typeof hourlyPostingLimit !== "number" || typeof expiryDays !== "number") return;
    updateSettingsMutation.mutate({ data: { hourlyPostingLimit, listingExpiryDays: expiryDays } }, {
      onSuccess: () => {
        toast.success("Podešavanja sačuvana.");
        setIsSettingsDirty(false);
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobSettingsQueryKey() });
      },
      onError: () => toast.error("Došlo je do greške.")
    });
  };

  const handleSweep = () => {
    if (confirm("Da li ste sigurni da želite da ručno pokrenete čišćenje isteklih oglasa? Ovo se inače radi automatski.")) {
      sweepMutation.mutate(undefined, {
        onSuccess: (data) => {
          toast.success(`Čišćenje uspešno. Isteklo je ${data.expired} oglasa.`);
          queryClient.invalidateQueries({ queryKey: getGetBeautyJobModerationQueueQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListRejectedBeautyJobsQueryKey() });
        }
      });
    }
  };

  const handleDeliveryRetry = (deliveryId: string) => {
    const guardKey = `beauty-job-delivery-retry:${deliveryId}`;
    if (!actionGuard.begin(guardKey)) return;
    retryDeliveryMutation.mutate({ deliveryId }, {
      onSuccess: (result) => {
        toast.success(
          result.status === "sent"
            ? "Mejl je uspešno poslat."
            : "Ponovni pokušaj je pokrenut.",
        );
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobDeliveryIssuesQueryKey() });
        actionGuard.end(guardKey);
      },
      onError: () => {
        toast.error("Ponovni pokušaj nije pokrenut.", {
          description: "Zapis više nije u retry stanju ili ga drugi administrator već obrađuje.",
        });
        queryClient.invalidateQueries({ queryKey: getGetBeautyJobDeliveryIssuesQueryKey() });
        actionGuard.end(guardKey);
      },
    });
  };

  const selectableListings = bulkSelectionEnabled
    ? queue?.listings?.filter((listing) => listing.moderationStatus === "pending" && listing.status === "active") ?? []
    : [];
  const allOnPageSelected = selectableListings.length > 0 && selectedIds.size === selectableListings.length;

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-serif font-bold text-foreground mb-2">Poslovi & Oglasi</h1>
        <p className="text-muted-foreground">Moderacija oglasa, rešavanje prijava i globalna podešavanja platforme.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-6 overflow-x-auto w-full justify-start h-12 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger value="queue" className="gap-2 h-10 rounded-lg" data-testid="tab-queue">
            <Shield className="w-4 h-4" /> Moderacija
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2 h-10 rounded-lg" data-testid="tab-reports">
            <Flag className="w-4 h-4" /> Prijave
          </TabsTrigger>
          <TabsTrigger value="email-deliveries" className="gap-2 h-10 rounded-lg" data-testid="tab-deliveries">
            <MailWarning className="w-4 h-4" /> Isporuka mejlova
            {deliveryIssues?.summary.totalIssueCount ? (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] rounded-full h-5 text-xs">
                {deliveryIssues.summary.totalIssueCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 h-10 rounded-lg" data-testid="tab-settings">
            <Settings className="w-4 h-4" /> Podešavanja
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-6">
          <div className="flex flex-col xl:flex-row gap-4">
            {/* Filters Sidebar */}
            <div className="w-full xl:w-72 shrink-0 space-y-5 rounded-xl border bg-card p-5 shadow-sm h-fit" data-testid="filters-sidebar">
              <div className="flex items-center gap-2 border-b pb-4">
                <SlidersHorizontal className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-lg">Filteri</h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="search-input">Pretraga</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <DebouncedInput
                      id="search-input"
                      placeholder="Pretraži naslov..."
                      className="pl-9"
                      value={params.search || ""}
                      onChange={(val) => updateParams({ search: val.toString() })}
                      data-testid="filter-search"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label id="status-label">Status</Label>
                  <Select value={params.status} onValueChange={(val) => updateParams({ status: val })}>
                    <SelectTrigger aria-labelledby="status-label" data-testid="filter-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Na čekanju</SelectItem>
                      <SelectItem value="active">Aktivni</SelectItem>
                      <SelectItem value="rejected">Odbijeni</SelectItem>
                      <SelectItem value="expiring">Ističu</SelectItem>
                      <SelectItem value="expired">Istekli</SelectItem>
                      <SelectItem value="filled">Popunjeni / zatvoreni</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label id="sort-label">Sortiranje</Label>
                  <Select value={params.sort} onValueChange={(val) => updateParams({ sort: val })}>
                    <SelectTrigger aria-labelledby="sort-label" data-testid="filter-sort"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="oldest">Najstarije prvo</SelectItem>
                      <SelectItem value="newest">Najnovije prvo</SelectItem>
                      <SelectItem value="activity">Po aktivnosti</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label id="type-label">Tip oglasa</Label>
                  <Select value={params.type || "all"} onValueChange={(val) => updateParams({ type: val === "all" ? "" : val })}>
                    <SelectTrigger aria-labelledby="type-label" data-testid="filter-type"><SelectValue placeholder="Svi tipovi" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Svi tipovi</SelectItem>
                      <SelectItem value="job">Posao</SelectItem>
                      <SelectItem value="equipment_rental">Iznajmljivanje opreme</SelectItem>
                      <SelectItem value="space_rental">Iznajmljivanje prostora</SelectItem>
                      <SelectItem value="freelance">Freelance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label id="listing-mode-label">Način oglasa</Label>
                  <Select value={params.listingMode || "all"} onValueChange={(val) => updateParams({ listingMode: val === "all" ? "" : val })}>
                    <SelectTrigger aria-labelledby="listing-mode-label" data-testid="filter-listing-mode"><SelectValue placeholder="Sve namere" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Sve namere</SelectItem>
                      <SelectItem value="offering">Nudi se</SelectItem>
                      <SelectItem value="seeking">Traži se</SelectItem>
                      <SelectItem value="rental">Izdavanje</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label id="category-label">Kategorija</Label>
                  <Select value={params.category || "all"} onValueChange={(val) => updateParams({ category: val === "all" ? "" : val })}>
                    <SelectTrigger aria-labelledby="category-label" data-testid="filter-category"><SelectValue placeholder="Sve kategorije" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Sve kategorije</SelectItem>
                      {categoriesResponse?.categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.slug}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label id="posted-by-label">Autor</Label>
                  <Select value={params.postedBy || "all"} onValueChange={(val) => updateParams({ postedBy: val === "all" ? "" : val })}>
                    <SelectTrigger aria-labelledby="posted-by-label" data-testid="filter-posted-by"><SelectValue placeholder="Svi autori" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Svi autori</SelectItem>
                      <SelectItem value="salon">Salon</SelectItem>
                      <SelectItem value="user">Korisnik</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label id="period-label">Period</Label>
                  <Select value={params.period} onValueChange={(val) => updateParams({ period: val, from: "", to: "" })}>
                    <SelectTrigger aria-labelledby="period-label" data-testid="filter-period"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {periods.map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {params.period === "custom" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="date-from" className="text-xs">Od</Label>
                      <Input id="date-from" type="date" className="h-8 text-xs" value={params.from || ""} onChange={(e) => updateParams({ from: e.target.value })} data-testid="filter-from" />
                    </div>
                    <div>
                      <Label htmlFor="date-to" className="text-xs">Do</Label>
                      <Input id="date-to" type="date" className="h-8 text-xs" value={params.to || ""} onChange={(e) => updateParams({ to: e.target.value })} data-testid="filter-to" />
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2 pt-2">
                  <Checkbox
                    id="reportedOnly"
                    checked={params.reportedOnly}
                    onCheckedChange={(c) => updateParams({ reportedOnly: c ? "true" : "" })}
                    data-testid="filter-reported-only"
                  />
                  <Label htmlFor="reportedOnly" className="cursor-pointer">Samo prijavljeni oglasi</Label>
                </div>

                <Button variant="outline" className="w-full mt-4" onClick={resetFilters} data-testid="reset-filters">
                  Resetuj filtere
                </Button>
              </div>
            </div>

            {/* Results Area */}
            <div className="flex-1 min-w-0 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 rounded-xl border shadow-sm">
                <div>
                  <h3 className="font-bold text-lg">Rezultati</h3>
                  <p className="text-sm text-muted-foreground" data-testid="results-count">
                    Pronađeno: {queue?.total || 0} oglasa
                  </p>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                  <div className="flex items-center space-x-2">
                    <Checkbox id="selectAll" checked={allOnPageSelected} disabled={!bulkSelectionEnabled || selectableListings.length === 0} onCheckedChange={(c) => toggleAll(!!c)} data-testid="select-all" />
                    <Label htmlFor="selectAll" className="text-sm cursor-pointer whitespace-nowrap">
                      {bulkSelectionEnabled ? "Izaberi sve na strani" : "Samo oglasi na čekanju"}
                    </Label>
                  </div>
                  <Select value={params.pageSize?.toString()} onValueChange={(val) => updateParams({ pageSize: val, page: "1" })}>
                    <SelectTrigger className="w-[80px] h-8" aria-label="Broj rezultata po strani" data-testid="page-size"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isQueueError ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-destructive flex items-center gap-3">
                  <AlertCircle className="w-6 h-6" />
                  <div>
                    <h4 className="font-bold">Greška prilikom učitavanja</h4>
                    <p className="text-sm opacity-90">Nije moguće preuzeti listu oglasa. Pokušajte ponovo ili promenite filtere.</p>
                  </div>
                </div>
              ) : isLoadingQueue && !queue ? (
                <div className="space-y-4">
                  <Skeleton className="h-40 w-full rounded-xl" />
                  <Skeleton className="h-40 w-full rounded-xl" />
                </div>
              ) : queue?.listings?.length === 0 ? (
                <div className="text-center py-16 bg-card border border-dashed rounded-xl text-muted-foreground shadow-sm">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  Nema rezultata za date filtere.
                </div>
              ) : (
                <div className="space-y-4 pb-24 relative z-0">
                  {queue?.listings?.map((job) => {
                    const isReported = job.reportCount && job.reportCount > 0;
                    const isBulkSelectable = bulkSelectionEnabled && job.moderationStatus === "pending" && job.status === "active";
                    return (
                      <div key={job.id} className={`relative p-5 rounded-xl border shadow-sm space-y-4 transition-colors ${selectedIds.has(job.id) ? 'bg-primary/5 border-primary' : isReported ? 'bg-destructive/5 border-destructive/30' : 'bg-card'}`} data-testid={`job-card-${job.id}`}>
                        <div className="flex flex-col sm:flex-row gap-4 justify-between sm:items-start">
                          <div className="flex-1 min-w-0 pr-0 sm:pr-4">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <Badge variant={job.moderationStatus === "pending" ? "default" : "secondary"} className="uppercase text-[10px] tracking-wider" data-testid={`job-mod-status-${job.id}`}>
                                Moderacija: {job.moderationStatus === "pending" ? "na čekanju" : job.moderationStatus === "approved" ? "odobren" : "odbijen"}
                              </Badge>
                              <Badge variant="outline" className="uppercase text-[10px] tracking-wider" data-testid={`job-life-status-${job.id}`}>
                                Status: {job.status}
                              </Badge>
                              <Badge variant="outline">{job.type}</Badge>
                              <Badge variant="outline">{job.intent}</Badge>
                              <Badge variant="secondary">{job.categoryName}</Badge>
                              {isReported ? (
                                <Badge variant="destructive" className="gap-1"><Flag className="w-3 h-3" /> {job.reportCount} prijava</Badge>
                              ) : null}
                            </div>
                            <h4 className="font-bold text-lg text-foreground/90 break-words">{job.title}</h4>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                              <span>Autor: <strong>{job.authorDisplayName}</strong> ({job.postedByType})</span>
                              <span className="hidden sm:inline">•</span>
                              <span>Grad: {job.city || "Nepoznato"}</span>
                              <span className="hidden sm:inline">•</span>
                              <span>Kontakti: {job.contactCount}</span>
                              <span className="hidden sm:inline">•</span>
                              <span>Kreirano: {format(new Date(job.createdAt), "dd.MM.yyyy.")}</span>
                              <span className="hidden sm:inline">•</span>
                              <span>Ističe: {format(new Date(job.expiresAt), "dd.MM.yyyy.")}</span>
                            </div>
                          </div>

                          <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-4 shrink-0">
                            <Checkbox
                              checked={selectedIds.has(job.id)}
                              onCheckedChange={() => toggleSelection(job.id)}
                              disabled={!isBulkSelectable}
                              className="w-5 h-5"
                              aria-label={`Izaberi oglas ${job.title}`}
                              data-testid={`select-job-${job.id}`}
                            />
                            <Link href={`/admin/poslovi/pregled/${job.id}`} target="_blank" className="text-sm font-medium text-primary hover:underline whitespace-nowrap" data-testid={`view-job-${job.id}`}>
                              Pregled ↗
                            </Link>
                          </div>
                        </div>

                        <div className="flex flex-wrap justify-end gap-3 pt-2">
                          {job.moderationStatus === "pending" && (
                            <>
                              <Dialog open={selectedJobId === job.id} onOpenChange={(open) => {
                                if (open) { setSelectedJobId(job.id); setRejectReason(""); setInternalNote(""); }
                                else setSelectedJobId(null);
                              }}>
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="destructive" className="gap-1.5" data-testid={`reject-btn-${job.id}`}>
                                    <XCircle className="w-4 h-4" /> Odbij
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Odbij oglas</DialogTitle>
                                    <DialogDescription>Unesite razlog odbijanja (vidljivo autoru) i opcionu belešku (samo za administratore).</DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 pt-4">
                                    <div className="space-y-2">
                                      <Label htmlFor={`reject-reason-${job.id}`}>Razlog odbijanja <span className="text-destructive">*</span></Label>
                                      <Textarea id={`reject-reason-${job.id}`} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Npr. Oglas krši pravila..." data-testid="reject-reason-input" />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor={`reject-note-${job.id}`} className="flex items-center gap-1"><Lock className="w-3 h-3" /> Interna beleška</Label>
                                      <Textarea id={`reject-note-${job.id}`} value={internalNote} onChange={e => setInternalNote(e.target.value)} placeholder="Za druge administratore..." data-testid="reject-note-input" />
                                    </div>
                                    <DialogFooter>
                                      <Button type="button" variant="ghost" onClick={() => setSelectedJobId(null)} data-testid="reject-cancel">Odustani</Button>
                                      <Button type="button" variant="destructive" onClick={() => handleModerate(job.id, "reject")} disabled={!rejectReason || bulkModerateMutation.isPending} data-testid="reject-confirm">
                                        Potvrdi odbijanje
                                      </Button>
                                    </DialogFooter>
                                  </div>
                                </DialogContent>
                              </Dialog>

                              <Dialog open={selectedApproveJobId === job.id} onOpenChange={(open) => {
                                if (open) { setSelectedApproveJobId(job.id); setApproveInternalNote(""); }
                                else setSelectedApproveJobId(null);
                              }}>
                                <DialogTrigger asChild>
                                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid={`approve-btn-${job.id}`}>
                                    <CheckCircle2 className="w-4 h-4" /> Odobri
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Odobri oglas</DialogTitle>
                                    <DialogDescription>Oglas će postati aktivan i javno vidljiv.</DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-4 pt-4">
                                    <div className="space-y-2">
                                      <Label htmlFor={`approve-note-${job.id}`} className="flex items-center gap-1"><Lock className="w-3 h-3" /> Interna beleška (opciono)</Label>
                                      <Textarea id={`approve-note-${job.id}`} value={approveInternalNote} onChange={e => setApproveInternalNote(e.target.value)} placeholder="Napomena za arhivu..." data-testid="approve-note-input" />
                                    </div>
                                    <DialogFooter>
                                      <Button type="button" variant="ghost" onClick={() => setSelectedApproveJobId(null)} data-testid="approve-cancel">Odustani</Button>
                                      <Button type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleModerate(job.id, "approve")} disabled={bulkModerateMutation.isPending} data-testid="approve-confirm">
                                        Potvrdi odobravanje
                                      </Button>
                                    </DialogFooter>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Pagination */}
                  {queue && queue.total > (params.pageSize || 20) && (
                    <div className="flex items-center justify-between pt-4 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateParams({ page: ((params.page || 1) - 1).toString() })}
                        disabled={(params.page || 1) <= 1}
                        className="gap-1.5"
                        data-testid="pagination-prev"
                      >
                        <ChevronLeft className="w-4 h-4" /> Prethodna
                      </Button>
                      <div className="text-sm font-medium" data-testid="pagination-info">Strana {params.page || 1} od {Math.ceil(queue.total / (params.pageSize || 20))}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateParams({ page: ((params.page || 1) + 1).toString() })}
                        disabled={(params.page || 1) >= Math.ceil(queue.total / (params.pageSize || 20))}
                        className="gap-1.5"
                        data-testid="pagination-next"
                      >
                        Sledeća <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <h2 className="text-xl font-bold font-serif">Prijavljeni oglasi</h2>
          {isLoadingQueue ? (
            <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /></div>
          ) : queue?.reports?.length === 0 ? (
            <div className="text-center py-12 bg-card border border-dashed rounded-xl text-muted-foreground shadow-sm">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
              Nema otvorenih prijava u trenutnom prikazu.
            </div>
          ) : (
            <div className="space-y-4">
              {queue?.reports?.map((report) => (
                <div key={report.id} className="p-5 rounded-xl border border-destructive/20 bg-destructive/5 shadow-sm space-y-4" data-testid={`report-card-${report.id}`}>
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="destructive" className="gap-1"><Flag className="w-3 h-3" /> Prijava</Badge>
                        <span className="text-xs font-medium text-muted-foreground">{format(new Date(report.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}</span>
                      </div>
                      <h4 className="font-bold">Oglas ID: {report.listingId}</h4>
                      <p className="text-sm text-muted-foreground">Prijavio korisnik ID: {report.reporterUserId}</p>
                    </div>
                    <Link href={`/admin/poslovi/pregled/${report.listingId}`} target="_blank" className="text-sm font-medium text-primary hover:underline">
                      Otvori oglas ↗
                    </Link>
                  </div>

                  <div>
                    <h5 className="text-sm font-semibold mb-1">Razlog prijave:</h5>
                    <div className="bg-card p-4 rounded-lg text-sm text-foreground/90 whitespace-pre-wrap border">
                      {report.reason}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Dialog open={selectedReportId === report.id} onOpenChange={(open) => {
                      if (open) { setSelectedReportId(report.id); setReportResolution(""); }
                      else setSelectedReportId(null);
                    }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" data-testid={`resolve-report-btn-${report.id}`}>
                          Reši prijavu
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Rešavanje prijave</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                          <div className="space-y-2">
                            <Label htmlFor={`resolve-note-${report.id}`}>Beleška o rešavanju (opciono)</Label>
                            <Textarea id={`resolve-note-${report.id}`} value={reportResolution} onChange={e => setReportResolution(e.target.value)} placeholder="Za internu evidenciju..." data-testid="resolve-report-note" />
                          </div>
                          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                            <Button type="button" variant="outline" className="flex-1" onClick={() => handleResolveReport(report.id, "dismissed")} disabled={resolveReportMutation.isPending} data-testid="dismiss-report">
                              Odbaci prijavu (Oglas ostaje)
                            </Button>
                            <Button type="button" variant="destructive" className="flex-1" onClick={() => handleResolveReport(report.id, "resolved")} disabled={resolveReportMutation.isPending} data-testid="resolve-report-remove">
                              Ukloni oglas iz javnog prikaza
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Email Deliveries Tab */}
        <TabsContent value="email-deliveries" className="space-y-6">
          <div>
            <h2 className="text-xl font-bold font-serif">Beauty Poslovi mejlovi koji zahtevaju pažnju</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Prikaz ne sadrži adresu primaoca, ime, sadržaj poruke ni sirovu provider grešku.
            </p>
          </div>

          {isLoadingDeliveryIssues ? (
            <div className="space-y-4"><Skeleton className="h-28 w-full rounded-xl" /></div>
          ) : deliveryIssues ? (
            <>
              {deliveryIssues.summary.terminalIssueCount >= deliveryIssues.summary.alertThreshold && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert" data-testid="beauty-job-delivery-threshold-alert">
                  <strong>Prag za monitoring upozorenje je dostignut.</strong>{" "}
                  Sistem upozorava administratore kada ima najmanje {deliveryIssues.summary.alertThreshold} terminalno neisporučenih poruka.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <p className="text-sm text-muted-foreground">Dugo na čekanju</p>
                  <p className="mt-2 text-3xl font-bold" data-testid="beauty-job-delivery-delayed-count">{deliveryIssues.summary.delayedQueuedCount}</p>
                  <p className="mt-1 text-xs text-muted-foreground">duže od {deliveryIssues.summary.staleAfterMinutes} minuta</p>
                </div>
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <p className="text-sm text-muted-foreground">Neuspešno</p>
                  <p className="mt-2 text-3xl font-bold text-destructive" data-testid="beauty-job-delivery-failed-count">{deliveryIssues.summary.failedCount}</p>
                </div>
                <div className="rounded-xl border bg-card p-5 shadow-sm">
                  <p className="text-sm text-muted-foreground">Preskočeno</p>
                  <p className="mt-2 text-3xl font-bold text-amber-700" data-testid="beauty-job-delivery-skipped-count">{deliveryIssues.summary.skippedCount}</p>
                </div>
              </div>

              {deliveryIssues.deliveries.length ? (
                <div className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="beauty-job-delivery-list">
                  <div className="divide-y">
                    {deliveryIssues.deliveries.map((delivery) => {
                      const guardKey = `beauty-job-delivery-retry:${delivery.id}`;
                      return (
                        <div key={delivery.id} className="grid gap-4 p-5 md:grid-cols-[1.4fr_.9fr_.9fr_auto] md:items-center">
                          <div>
                            <p className="font-medium">{deliveryTypeLabels[delivery.emailType]}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Kreirano {format(new Date(delivery.createdAt), "dd.MM.yyyy. HH:mm", { locale: srLatn })}
                            </p>
                          </div>
                          <div>
                            <Badge variant={delivery.status === "failed" ? "destructive" : "secondary"}>
                              {deliveryIssueLabels[delivery.issueKind]}
                            </Badge>
                            <p className="mt-1 text-xs text-muted-foreground">Pokušaji: {delivery.retryCount}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {delivery.nextRetryAt
                              ? `Sledeći automatski pokušaj: ${format(new Date(delivery.nextRetryAt), "dd.MM. HH:mm", { locale: srLatn })}`
                              : delivery.retryAvailable
                                ? "Automatski pokušaji su iscrpljeni."
                                : "Ručni retry nije dozvoljen za ovo stanje."}
                          </p>
                          {delivery.retryAvailable ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-2"
                              onClick={() => handleDeliveryRetry(delivery.id)}
                              disabled={retryDeliveryMutation.isPending || actionGuard.isActive(guardKey)}
                              data-testid={`beauty-job-delivery-retry-${delivery.id}`}
                            >
                              <RefreshCw className={`h-4 w-4 ${actionGuard.isActive(guardKey) ? "animate-spin" : ""}`} />
                              Pokušaj ponovo
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Bez ručne akcije</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed bg-card py-12 text-center text-muted-foreground">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
                  Nema Beauty Poslovi mejlova koji zahtevaju pažnju.
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-sm text-destructive">
              Pregled isporuke trenutno nije dostupan.
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-6 max-w-2xl">
          <h2 className="text-xl font-bold font-serif mb-6">Podešavanja Berze Poslova</h2>

          <div className="p-6 rounded-xl border bg-card shadow-sm space-y-6">
            {isLoadingSettings ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="hourly-limit">Ograničenje broja oglasa po satu (po korisniku)</Label>
                  <Input
                    id="hourly-limit"
                    type="number"
                    min={1}
                    value={hourlyPostingLimit}
                    onChange={e => { setHourlyPostingLimit(e.target.value === "" ? "" : Number(e.target.value)); setIsSettingsDirty(true); }}
                    data-testid="settings-hourly-limit"
                  />
                  <p className="text-xs text-muted-foreground">Sprečava spam objavljivanje velike količine oglasa u kratkom vremenu.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expiry-days">Trajanje oglasa (dani)</Label>
                  <Input
                    id="expiry-days"
                    type="number"
                    min={1}
                    value={expiryDays}
                    onChange={e => { setExpiryDays(e.target.value === "" ? "" : Number(e.target.value)); setIsSettingsDirty(true); }}
                    data-testid="settings-expiry-days"
                  />
                  <p className="text-xs text-muted-foreground">Nakon koliko dana se oglas automatski zatvara (ističe).</p>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button onClick={handleSaveSettings} disabled={!isSettingsDirty || updateSettingsMutation.isPending} data-testid="save-settings-btn">
                    {updateSettingsMutation.isPending ? "Čuvanje..." : "Sačuvaj izmene"}
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="p-6 rounded-xl border border-destructive/20 bg-destructive/5 shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-destructive flex items-center gap-2 mb-1">
                <Trash2 className="w-5 h-5" /> Ručno čišćenje
              </h3>
              <p className="text-sm text-destructive/80">
                Pokrenite čišćenje isteklih oglasa ručno. Sistem ovo obično radi automatski svakog sata.
              </p>
            </div>
            <Button variant="destructive" className="gap-2" onClick={handleSweep} disabled={sweepMutation.isPending} data-testid="sweep-btn">
              {sweepMutation.isPending ? "Čišćenje u toku..." : <><Clock className="w-4 h-4" /> Pokreni čišćenje sada</>}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Sticky Bulk Action Bar */}
      {selectedIds.size > 0 && activeTab === "queue" && (
        <div className="fixed bottom-0 left-0 xl:left-64 right-0 z-50 p-4 animate-in slide-in-from-bottom pointer-events-none transition-all">
          <div className="max-w-4xl mx-auto bg-card border shadow-xl rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 pointer-events-auto">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="px-2 py-1 text-sm" data-testid="bulk-selected-count">{selectedIds.size} izabrano</Badge>
              <span className="text-sm text-muted-foreground hidden sm:inline">Odaberite akciju za obeležene oglase</span>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
              <Dialog open={isBulkRejectOpen} onOpenChange={setIsBulkRejectOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="flex-1 sm:flex-none gap-2" data-testid="bulk-reject-btn">
                    <XCircle className="w-4 h-4" /> Masovno odbij
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Odbij {selectedIds.size} oglasa</DialogTitle>
                    <DialogDescription>Ova akcija će odbiti sve izabrane oglase i poslati obaveštenja autorima.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="bulk-reject-reason">Javni razlog odbijanja <span className="text-destructive">*</span></Label>
                      <Textarea id="bulk-reject-reason" value={bulkRejectReason} onChange={e => setBulkRejectReason(e.target.value)} placeholder="Biće poslato svim autorima..." data-testid="bulk-reject-reason-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bulk-reject-note" className="flex items-center gap-1"><Lock className="w-3 h-3" /> Interna beleška</Label>
                      <Textarea id="bulk-reject-note" value={bulkInternalNote} onChange={e => setBulkInternalNote(e.target.value)} placeholder="Za druge administratore..." data-testid="bulk-reject-note-input" />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="ghost" onClick={() => setIsBulkRejectOpen(false)} data-testid="bulk-reject-cancel">Odustani</Button>
                      <Button type="button" variant="destructive" onClick={() => handleBulkModerate("reject")} disabled={!bulkRejectReason || bulkModerateMutation.isPending} data-testid="bulk-reject-confirm">
                        Potvrdi masovno odbijanje
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>

              <Dialog open={isBulkApproveOpen} onOpenChange={setIsBulkApproveOpen}>
                <DialogTrigger asChild>
                  <Button className="flex-1 sm:flex-none gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="bulk-approve-btn">
                    <CheckCircle2 className="w-4 h-4" /> Masovno odobri
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Odobri {selectedIds.size} oglasa</DialogTitle>
                    <DialogDescription>Oglasi će postati aktivni i javno vidljivi.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="bulk-approve-note" className="flex items-center gap-1"><Lock className="w-3 h-3" /> Interna beleška (opciono)</Label>
                      <Textarea id="bulk-approve-note" value={bulkInternalNote} onChange={e => setBulkInternalNote(e.target.value)} placeholder="Napomena za arhivu..." data-testid="bulk-approve-note-input" />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="ghost" onClick={() => setIsBulkApproveOpen(false)} data-testid="bulk-approve-cancel">Odustani</Button>
                      <Button type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleBulkModerate("approve")} disabled={bulkModerateMutation.isPending} data-testid="bulk-approve-confirm">
                        Potvrdi masovno odobravanje
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>

              <Button variant="ghost" size="icon" onClick={() => setSelectedIds(new Set())} aria-label="Zatvori" data-testid="bulk-close-btn">
                <Trash className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
