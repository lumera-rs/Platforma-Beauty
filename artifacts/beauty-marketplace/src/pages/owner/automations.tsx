import { BusinessLayout } from "@/components/business-layout";
import { OwnerSidebar } from "./dashboard";
import { 
  useOwnerListAutomations, 
  useOwnerGetAutomationStats,
  useOwnerListAutomationStats,
  useOwnerListAutomationAttributedAppointments,
  useOwnerCreateAutomation, 
  useOwnerUpdateAutomation, 
  useOwnerDeleteAutomation,
  useOwnerActivateAutomation,
  useOwnerPauseAutomation,
  useOwnerTestRunAutomation,
  useGetCurrentUser,
  getOwnerListAutomationsQueryKey,
  getOwnerListAutomationStatsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap, Play, Pause, Trash2, Mail, MessageSquare, Plus, Activity, CheckCircle2, XCircle, BarChart3, CalendarCheck, CalendarRange, TrendingUp, TrendingDown, Minus, AlertTriangle, Copy, Share2 } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { rangePresets, toDateParam } from "@/lib/date-range-presets";
import type { AutomationAttributedAppointment, AutomationStatsOverviewItem } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import { Link } from "wouter";
import { parsePeriodSelection, serializePeriodSelection, type StatsPeriod } from "@/lib/campaign-period-url";
import { getCampaignCancellationWarning } from "@/lib/campaign-cancellation-warning";

function rate(part: number, total: number) {
  if (!total) return null;
  return `${Math.round((part / total) * 100)}%`;
}

function formatClientShare(share: number): string {
  return `${share.toLocaleString("sr-RS", { maximumFractionDigits: 1 })}%`;
}

function formatNewClientShare(
  newClientCount: number,
  knownClientCount: number,
  share: number | null,
): React.ReactNode {
  if (share === null) return "Udeo novih: nema poznatih podataka";
  return (
    <>
      Udeo novih: <strong className="text-foreground">{newClientCount} od {knownClientCount} poznatih</strong>{" "}
      (<strong className="text-foreground">{formatClientShare(share)}</strong>)
    </>
  );
}

function formatPercentagePoints(points: number): string {
  return points.toLocaleString("sr-RS", { maximumFractionDigits: 1 });
}

/**
 * Trend for a percentage share. Unlike count trends, this is expressed in
 * percentage points and is unavailable when either period has no known
 * client history.
 */
function ClientShareTrend({
  current,
  previous,
  testId,
}: {
  current: number | null;
  previous?: number | null;
  testId: string;
}) {
  if (previous === undefined) return null;
  if (current === null || previous === null) {
    return (
      <span className="text-xs font-medium text-muted-foreground" title="Poređenje nije dostupno bez poznatih podataka o klijentima" data-testid={testId}>
        (bez validnog poređenja)
      </span>
    );
  }

  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground" title="U odnosu na prethodni period iste dužine" data-testid={testId}>
        <Minus className="w-3 h-3" /> bez promene
      </span>
    );
  }

  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700" title="U odnosu na prethodni period iste dužine" data-testid={testId}>
        <TrendingUp className="w-3 h-3" /> +{formatPercentagePoints(diff)} pp
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-700" title="U odnosu na prethodni period iste dužine" data-testid={testId}>
      <TrendingDown className="w-3 h-3" /> −{formatPercentagePoints(Math.abs(diff))} pp
    </span>
  );
}

/** Page size for the attributed-appointments drill-down list. */
const ATTRIBUTED_PAGE_SIZE = 25;
type AttributedClientType = "all" | "new" | "returning";
const periodOptions: { value: Exclude<StatsPeriod, "custom">; label: string }[] = [
  { value: "7d", label: "7 dana" },
  { value: "30d", label: "30 dana" },
  { value: "90d", label: "90 dana" },
  { value: "all", label: "Sve vreme" },
];

function parseAttributedClientType(search: string): AttributedClientType {
  const clientType = new URLSearchParams(search).get("clients");
  return clientType === "new" || clientType === "returning" ? clientType : "all";
}

/**
 * Serbian count phrase for masculine forms: "1 nov", "2 nova", "5 novih"
 * (standard 11–14 exception included). Used for the new/returning client
 * mix summary above the attributed-appointments list.
 */
function srCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
function formatRangeLabel(range: DateRange | undefined): string | null {
  if (!range?.from || !range?.to) return null;
  return `${range.from.toLocaleDateString("sr-RS")} – ${range.to.toLocaleDateString("sr-RS")}`;
}

function isShareCancelled(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { name?: unknown }).name === "AbortError";
}

async function copyTextWithFallback(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Clipboard permissions can reject even when the API is available.
    // Continue with the legacy fallback before reporting failure.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    if (!document.execCommand("copy")) {
      throw new Error("Kopiranje nije uspelo.");
    }
  } finally {
    textarea.remove();
  }
}

function periodDescription(period: StatsPeriod, customRange: DateRange | undefined): string {
  switch (period) {
    case "7d": return "poslednjih 7 dana";
    case "30d": return "poslednjih 30 dana";
    case "90d": return "poslednjih 90 dana";
    case "custom": return formatRangeLabel(customRange) ?? "izabrani period";
    default: return "sve vreme";
  }
}

/** Label the exact window used as the comparison baseline in the trend note. */
function previousTrendWindowLabel(period: StatsPeriod, customRange: DateRange | undefined): string | null {
  if (period === "all") return null;
  if (period !== "custom") return periodDescription(period, undefined).replace("poslednjih ", "");
  if (!customRange?.from || !customRange.to) return null;

  const currentFrom = new Date(
    customRange.from.getFullYear(),
    customRange.from.getMonth(),
    customRange.from.getDate(),
  );
  const currentTo = new Date(
    customRange.to.getFullYear(),
    customRange.to.getMonth(),
    customRange.to.getDate(),
  );
  const rangeDays = Math.round((currentTo.getTime() - currentFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const previousTo = new Date(currentFrom.getFullYear(), currentFrom.getMonth(), currentFrom.getDate() - 1);
  const previousFrom = new Date(currentFrom.getFullYear(), currentFrom.getMonth(), currentFrom.getDate() - rangeDays);
  return formatRangeLabel({ from: previousFrom, to: previousTo });
}
/**
 * Up/down/flat indicator versus the preceding window of the same length.
 * Percentage change is shown when the previous count is non-zero; a jump from
 * zero is marked as "novo" since a percentage would be undefined. Rendered
 * only for bounded periods — "all time" has no previous window to compare.
 */
function TrendIndicator({ current, previous, testId }: { current: number; previous: number; testId: string }) {
  if (current === 0 && previous === 0) return null;
  const diff = current - previous;
  const title = "U odnosu na prethodni period iste dužine";
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground" title={title} data-testid={testId}>
        <Minus className="w-3 h-3" /> bez promene
      </span>
    );
  }
  if (diff > 0) {
    const pct = previous > 0 ? `+${Math.round((diff / previous) * 100)}%` : "novo";
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-700" title={title} data-testid={testId}>
        <TrendingUp className="w-3 h-3" /> {pct}
      </span>
    );
  }
  const pct = `−${Math.round((Math.abs(diff) / previous) * 100)}%`;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-700" title={title} data-testid={testId}>
      <TrendingDown className="w-3 h-3" /> {pct}
    </span>
  );
}
/**
 * Live per-channel delivery funnel: sent → delivered → opened, fed by verified
 * provider webhook events. `opened: null` marks a channel whose provider does
 * not expose open tracking (SMS) — the opened step is replaced by a note.
 */
function DeliveryFunnel({ icon, label, sent, delivered, opened, failed, noOpensNote, previousDelivered, previousOpened, trendTestIdPrefix }: {
  icon: React.ReactNode;
  label: string;
  sent: number;
  delivered: number;
  opened: number | null;
  failed: number;
  noOpensNote?: string;
  /** Counts from the preceding window of the same length; when set, a trend indicator is rendered next to the matching step. */
  previousDelivered?: number;
  previousOpened?: number;
  trendTestIdPrefix?: string;
}) {
  return (
    <div className="border rounded-lg p-3 bg-muted/20" data-testid={`funnel-${label.toLowerCase()}`}>
      <div className="flex items-center gap-2 text-sm font-semibold mb-2">{icon} {label}</div>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="px-2 py-1 rounded bg-muted/60">Poslato: <strong>{sent}</strong></span>
        <span className="text-muted-foreground">→</span>
        <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-900">
          Isporučeno: <strong>{delivered}</strong>{rate(delivered, sent) ? <span className="text-emerald-700 ml-1">({rate(delivered, sent)})</span> : null}
          {previousDelivered !== undefined && (
            <span className="ml-1.5"><TrendIndicator current={delivered} previous={previousDelivered} testId={`${trendTestIdPrefix ?? `trend-${label.toLowerCase()}`}-delivered`} /></span>
          )}
        </span>
        {opened !== null && (
          <>
            <span className="text-muted-foreground">→</span>
            <span className="px-2 py-1 rounded bg-indigo-50 text-indigo-900">
              Otvoreno: <strong>{opened}</strong>{rate(opened, sent) ? <span className="text-indigo-700 ml-1">({rate(opened, sent)})</span> : null}
              {previousOpened !== undefined && (
                <span className="ml-1.5"><TrendIndicator current={opened} previous={previousOpened} testId={`${trendTestIdPrefix ?? `trend-${label.toLowerCase()}`}-opened`} /></span>
              )}
            </span>
          </>
        )}
      </div>
      {failed > 0 && (
        <p className="text-xs text-red-700 mt-2">Neisporučeno (provajder prijavio grešku): {failed}</p>
      )}
      {noOpensNote && <p className="text-xs text-muted-foreground mt-2">{noOpensNote}</p>}
    </div>
  );
}

function PeriodSelector({
  period,
  onPeriodChange,
  customRange,
  onCustomRangeChange,
  testId,
}: {
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  customRange: DateRange | undefined;
  onCustomRangeChange: (range: DateRange | undefined) => void;
  testId: string;
}) {
  const [rangeOpen, setRangeOpen] = useState(false);
  const customTriggerRef = useRef<HTMLButtonElement>(null);
  const wasRangeOpen = useRef(false);
  const rangeLabel = formatRangeLabel(customRange);

  useEffect(() => {
    if (wasRangeOpen.current && !rangeOpen) {
      customTriggerRef.current?.focus();
    }
    wasRangeOpen.current = rangeOpen;
  }, [rangeOpen]);

  return (
    <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border bg-muted/30 p-1 sm:flex sm:w-fit sm:flex-wrap" role="group" aria-label="Period prikaza" data-testid={testId}>
      {periodOptions.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onPeriodChange(opt.value)}
          aria-pressed={period === opt.value}
          data-testid={`period-${opt.value}`}
          className={`min-h-9 justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            period === opt.value
              ? "bg-background text-foreground shadow-sm border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
      <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
        <PopoverTrigger asChild>
          <button
            ref={customTriggerRef}
            type="button"
            onClick={() => onPeriodChange("custom")}
            aria-pressed={period === "custom"}
            aria-expanded={rangeOpen}
            aria-haspopup="dialog"
            data-testid="period-custom"
            className={`col-span-2 inline-flex min-h-9 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors sm:col-span-1 ${
              period === "custom"
                ? "bg-background text-foreground shadow-sm border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarRange className="w-3.5 h-3.5" />
            {period === "custom" && rangeLabel ? rangeLabel : "Izaberi datume"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <div className="flex flex-wrap gap-1.5 px-3 pt-3" data-testid={`${testId}-range-presets`}>
            {rangePresets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                data-testid={`range-preset-${preset.key}`}
                className="px-2 py-1 rounded-md border bg-muted/30 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => {
                  onPeriodChange("custom");
                  onCustomRangeChange(preset.getRange());
                  setRangeOpen(false);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Calendar
            mode="range"
            numberOfMonths={1}
            defaultMonth={customRange?.from}
            selected={customRange}
            disabled={{ after: new Date() }}
            onSelect={(range) => {
              // DayPicker represents an initial range click as a complete
              // one-day range. Keep that first click open as the range start;
              // a second click on the same day still completes a one-day
              // window, while a different day creates the intended span.
              const nextRange = !customRange
                && range?.from
                && range.to
                && range.from.getTime() === range.to.getTime()
                ? { from: range.from, to: undefined }
                : range;
              onPeriodChange("custom");
              onCustomRangeChange(nextRange);
              if (nextRange?.from && nextRange?.to) setRangeOpen(false);
            }}
            data-testid={`${testId}-range-calendar`}
          />
          <p className="px-3 pb-3 text-xs text-muted-foreground">
            {customRange?.from && !customRange?.to
              ? "Izaberite i krajnji datum perioda."
              : "Izaberite početni i krajnji datum perioda."}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
/**
 * At-a-glance performance comparison across every automation rule: per-channel
 * sent → delivered → opened rates plus attributed appointments, from the same
 * verified provider-event counts as the per-rule stats dialog. SMS providers
 * do not report opens, so the SMS column shows delivery only.
 */
function CampaignOverview({ items, period, onPeriodChange, customRange, onCustomRangeChange, onShowStats }: {
  items: AutomationStatsOverviewItem[];
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  customRange: DateRange | undefined;
  onCustomRangeChange: (range: DateRange | undefined) => void;
  onShowStats: (ruleId: string) => void;
}) {
  const anySms = items.some((i) => i.smsSentCount > 0);
  return (
    <Card data-testid="campaign-overview">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" /> Pregled performansi kampanja
            </CardTitle>
            <CardDescription className="mt-1.5">
               Uporedni prikaz svih pravila — isporuka i otvaranja prema podacima provajdera, uz termine i prihod ostvarene kampanjama. Otkazani i no-show termini se ne računaju u prihod, već su prikazani zasebno.
            </CardDescription>
          </div>
            <PeriodSelector
              period={period}
              onPeriodChange={onPeriodChange}
              customRange={customRange}
              onCustomRangeChange={onCustomRangeChange}
              testId="overview-period-selector"
            />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-4 font-semibold">Kampanja</th>
                <th className="py-2 pr-4 font-semibold"><span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> Email</span></th>
                <th className="py-2 pr-4 font-semibold"><span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> SMS</span></th>
                <th className="py-2 font-semibold text-right"><span className="inline-flex items-center gap-1"><CalendarCheck className="w-3.5 h-3.5" /> Termini</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const cancellationWarning = getCampaignCancellationWarning(item);
                return (
                <tr key={item.ruleId} className={`border-b last:border-b-0 align-top ${cancellationWarning.isFlagged ? "bg-amber-50/70" : ""}`} data-testid={`overview-row-${item.ruleId}`}>
                  <td className="py-3 pr-4">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className="font-medium text-foreground hover:underline text-left"
                        onClick={() => onShowStats(item.ruleId)}
                        title="Otvori detaljnu statistiku"
                      >
                        {item.ruleName}
                      </button>
                      {cancellationWarning.isFlagged && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              role="img"
                              tabIndex={0}
                              aria-label={cancellationWarning.explanation}
                              data-testid={`overview-cancellation-flag-${item.ruleId}`}
                              className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full text-amber-700 outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-1"
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-center">
                            {cancellationWarning.explanation}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {item.ruleStatus === 'active'
                        ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none">Aktivno</Badge>
                        : <Badge variant="secondary">{item.ruleStatus === 'paused' ? 'Pauzirano' : 'Nacrt'}</Badge>}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {item.emailSentCount > 0 ? (
                      <div className="space-y-0.5">
                        <div>Poslato: <strong>{item.emailSentCount}</strong></div>
                        <div className="text-emerald-800">
                          Isporučeno: <strong>{item.emailDeliveredCount}</strong>
                          {rate(item.emailDeliveredCount, item.emailSentCount) && <span className="text-emerald-700"> ({rate(item.emailDeliveredCount, item.emailSentCount)})</span>}
                          {item.previous && <span className="ml-1.5"><TrendIndicator current={item.emailDeliveredCount} previous={item.previous.emailDeliveredCount} testId={`trend-email-delivered-${item.ruleId}`} /></span>}
                        </div>
                        <div className="text-indigo-800">
                          Otvoreno: <strong>{item.emailOpenedCount}</strong>
                          {rate(item.emailOpenedCount, item.emailSentCount) && <span className="text-indigo-700"> ({rate(item.emailOpenedCount, item.emailSentCount)})</span>}
                          {item.previous && <span className="ml-1.5"><TrendIndicator current={item.emailOpenedCount} previous={item.previous.emailOpenedCount} testId={`trend-email-opened-${item.ruleId}`} /></span>}
                        </div>
                        {item.emailFailedCount > 0 && <div className="text-xs text-red-700">Neisporučeno: {item.emailFailedCount}</div>}
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        <span className="text-muted-foreground">—</span>
                        {item.previous && item.previous.emailDeliveredCount > 0 && (
                          <div><TrendIndicator current={0} previous={item.previous.emailDeliveredCount} testId={`trend-email-delivered-${item.ruleId}`} /></div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {item.smsSentCount > 0 ? (
                      <div className="space-y-0.5">
                        <div>Poslato: <strong>{item.smsSentCount}</strong></div>
                        <div className="text-emerald-800">
                          Isporučeno: <strong>{item.smsDeliveredCount}</strong>
                          {rate(item.smsDeliveredCount, item.smsSentCount) && <span className="text-emerald-700"> ({rate(item.smsDeliveredCount, item.smsSentCount)})</span>}
                          {item.previous && <span className="ml-1.5"><TrendIndicator current={item.smsDeliveredCount} previous={item.previous.smsDeliveredCount} testId={`trend-sms-delivered-${item.ruleId}`} /></span>}
                        </div>
                        {item.smsFailedCount > 0 && <div className="text-xs text-red-700">Neisporučeno: {item.smsFailedCount}</div>}
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        <span className="text-muted-foreground">—</span>
                        {item.previous && item.previous.smsDeliveredCount > 0 && (
                          <div><TrendIndicator current={0} previous={item.previous.smsDeliveredCount} testId={`trend-sms-delivered-${item.ruleId}`} /></div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <span className="text-lg font-bold text-primary">{item.attributedAppointments}</span>
                    {(item.newClientCount + item.returningClientCount + item.unknownClientCount) > 0 && (
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap" data-testid={`overview-client-mix-${item.ruleId}`}>
                        <span className="font-semibold text-foreground">{srCount(item.newClientCount, "nov", "nova", "novih")}</span>
                        <span> · </span>
                        <span className="font-semibold text-foreground">{srCount(item.returningClientCount, "vraćen", "vraćena", "vraćenih")}</span>
                        {item.unknownClientCount > 0 && (
                          <>
                            <span> · </span>
                            <span>{srCount(item.unknownClientCount, "nepoznat", "nepoznata", "nepoznatih")}</span>
                          </>
                        )}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground whitespace-nowrap" data-testid={`overview-new-client-share-${item.ruleId}`}>
                      {formatNewClientShare(item.newClientCount, item.knownClientCount, item.newClientShare)}
                      {item.previous && (
                        <span className="ml-1.5">
                          <ClientShareTrend
                            current={item.newClientShare}
                            previous={item.previous.newClientShare}
                            testId={`trend-new-client-share-${item.ruleId}`}
                          />
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-emerald-800 whitespace-nowrap" data-testid={`overview-revenue-${item.ruleId}`}>
                      {(item.attributedRevenue ?? 0).toLocaleString("sr-RS")} RSD
                      {item.previous && <span className="ml-1.5"><TrendIndicator current={item.attributedRevenue ?? 0} previous={item.previous.attributedRevenue ?? 0} testId={`trend-revenue-${item.ruleId}`} /></span>}
                    </div>
                    {item.attributedAppointments > 0 && (
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap" data-testid={`overview-revenue-split-${item.ruleId}`}>
                        Ostvareno {(item.completedRevenue ?? 0).toLocaleString("sr-RS")} · Zakazano {(item.upcomingRevenue ?? 0).toLocaleString("sr-RS")}
                      </div>
                    )}
                    {(item.cancelledAttributedAppointments ?? 0) > 0 && (
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap mt-0.5" data-testid={`overview-cancelled-${item.ruleId}`}>
                        Otkazano: {item.cancelledAttributedAppointments} ({(item.cancelledAttributedRevenue ?? 0).toLocaleString("sr-RS")} RSD)
                      </div>
                    )}
                    {(item.noShowAttributedAppointments ?? 0) > 0 && (
                      <div className="text-[11px] text-muted-foreground whitespace-nowrap mt-0.5" data-testid={`overview-no-show-${item.ruleId}`}>
                        No-show: {item.noShowAttributedAppointments} ({(item.noShowAttributedRevenue ?? 0).toLocaleString("sr-RS")} RSD)
                      </div>
                    )}
                    {item.previous && (
                      <div className="mt-0.5 flex justify-end">
                        <TrendIndicator current={item.attributedAppointments} previous={item.previous.attributedAppointments} testId={`trend-appointments-${item.ruleId}`} />
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
         {previousTrendWindowLabel(period, customRange) && (
          <p className="text-xs text-muted-foreground mt-3" data-testid="overview-trend-note">
             Trend u odnosu na prethodni period iste dužine ({previousTrendWindowLabel(period, customRange)}).
          </p>
        )}
        {anySms && (
          <p className="text-xs text-muted-foreground mt-3">Provajder ne prati otvaranja SMS poruka, pa se za SMS prikazuje samo isporuka.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function OwnerAutomations() {
  const { data: userResp } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: rules, isLoading } = useOwnerListAutomations({
    query: {
      enabled: !!userResp?.user,
      queryKey: getOwnerListAutomationsQueryKey()
    }
  });

  const [pathname, setLocation] = useLocation();
  const searchString = useSearch();

  // The picked window is restored from the URL on load (bookmark/shared link).
  // One-shot read on mount is intentional: after mount, local state leads and
  // is mirrored back into the URL below.
  const [initialSelection] = useState(() => parsePeriodSelection(window.location.search));
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>(initialSelection.period);
  const [customRange, setCustomRange] = useState<DateRange | undefined>(initialSelection.range);

  // Deep link into one campaign's detailed stats: ?rule=<id> mirrors the open
  // dialog. An id arriving from a shared URL is held as "pending" until the
  // rules list loads, then validated — an unknown/stale id is dropped silently
  // so the shared link degrades to the overview instead of a dialog that can
  // only error.
  const [statsRuleId, setStatsRuleId] = useState<string | null>(null);
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("rule"),
  );
  const [attributedClientType, setAttributedClientType] = useState<AttributedClientType>(
    () => parseAttributedClientType(window.location.search),
  );

  // Browser Back/Forward changes the URL without remounting this page. Treat
  // those query-string changes as incoming state before the mirror effect
  // runs; otherwise a previously open dialog can immediately write its stale
  // rule back into the restored URL.
  const lastHandledSearchRef = useRef(searchString);
  const skipUrlMirrorRef = useRef(false);
  useEffect(() => {
    if (lastHandledSearchRef.current === searchString) return;

    lastHandledSearchRef.current = searchString;
    skipUrlMirrorRef.current = true;
    const params = new URLSearchParams(searchString);
    const urlRuleId = params.get("rule");
    setAttributedClientType(parseAttributedClientType(searchString));
    setStatsRuleId(null);
    setPendingRuleId(urlRuleId);
  }, [searchString]);

  useEffect(() => {
    if (pendingRuleId === null || !rules) return;
    if (rules.some((rule: any) => rule.id === pendingRuleId)) {
      setStatsRuleId(pendingRuleId);
    }
    setPendingRuleId(null);
  }, [pendingRuleId, rules]);

  // Mirror the complete selection into the query string so the view is
  // bookmarkable and shareable. Incomplete custom ranges are not written
  // (`null`: nothing valid to restore yet, so the URL must not change); the
  // default "all time" keeps a clean URL, which also strips invalid params
  // that fell back to the default. The open stats dialog rides along as
  // ?rule= (kept while a shared id still awaits validation) so the exact
  // view is shareable. The client segment follows the rule and is omitted for
  // the default "all" view.
  useEffect(() => {
    if (skipUrlMirrorRef.current) {
      skipUrlMirrorRef.current = false;
      return;
    }

    const serialized = serializePeriodSelection(searchString, statsPeriod, customRange);
    if (serialized === null) return;
    const params = new URLSearchParams(serialized);
    params.delete("rule");
    params.delete("clients");
    const urlRuleId = statsRuleId ?? pendingRuleId;
    if (urlRuleId) {
      params.set("rule", urlRuleId);
      if (attributedClientType !== "all") params.set("clients", attributedClientType);
    }
    const next = params.toString();
    if (next !== searchString) {
      lastHandledSearchRef.current = next;
      setLocation(`${pathname}${next ? `?${next}` : ""}`, { replace: true });
    }
  }, [statsPeriod, customRange, statsRuleId, pendingRuleId, attributedClientType, searchString, pathname, setLocation]);

  // Custom mode queries with exact from/to dates; presets use ?period=.
  // While a custom range is incomplete (only start picked) there is nothing
  // valid to request yet, so the stats queries stay disabled.
  const statsParams = useMemo(() => {
    if (statsPeriod === "custom") {
      return customRange?.from && customRange?.to
        ? { from: toDateParam(customRange.from), to: toDateParam(customRange.to) }
        : null;
    }
    return { period: statsPeriod };
  }, [statsPeriod, customRange]);

  // While the custom range is incomplete, keep showing the last complete
  // window instead of unmounting the overview (which holds the picker).
  const lastCompleteParamsRef = useRef<NonNullable<typeof statsParams>>({ period: "all" });
  if (statsParams !== null) lastCompleteParamsRef.current = statsParams;
  const activeStatsParams = statsParams ?? lastCompleteParamsRef.current;

  // For every bounded window, request counts for the preceding window of the
  // same length so the overview can show per-rule trends. The API derives the
  // exact preceding dates for complete custom ranges; "all time" has no
  // previous window and therefore sends no compare flag.
  const overviewParams = useMemo(() => (
    ("period" in activeStatsParams && activeStatsParams.period !== "all") || "from" in activeStatsParams
      ? { ...activeStatsParams, compare: "previous" as const }
      : activeStatsParams
  ), [activeStatsParams]);

  const { data: overviewStats } = useOwnerListAutomationStats(overviewParams, {
    query: {
      enabled: !!userResp?.user,
      queryKey: getOwnerListAutomationStatsQueryKey(overviewParams)
    }
  });

  const createMutation = useOwnerCreateAutomation();
  const updateMutation = useOwnerUpdateAutomation();
  const deleteMutation = useOwnerDeleteAutomation();
  const activateMutation = useOwnerActivateAutomation();
  const pauseMutation = useOwnerPauseAutomation();
  const testMutation = useOwnerTestRunAutomation();

  const [isEditing, setIsEditing] = useState(false);
  const [currentRuleId, setCurrentRuleId] = useState<string | null>(null);
  const [isCopyingStatsLink, setIsCopyingStatsLink] = useState(false);
  const [isSharingStatsLink, setIsSharingStatsLink] = useState(false);

  const statsShareUrl = useMemo(() => {
    const serialized = serializePeriodSelection(searchString, statsPeriod, customRange);
    if (serialized === null) return window.location.href;

    const params = new URLSearchParams(serialized);
    params.delete("rule");
    params.delete("clients");
    if (statsRuleId) {
      params.set("rule", statsRuleId);
      if (attributedClientType !== "all") params.set("clients", attributedClientType);
    }

    const url = new URL(window.location.href);
    url.pathname = pathname;
    url.search = params.toString() ? `?${params.toString()}` : "";
    return url.toString();
  }, [searchString, statsPeriod, customRange, statsRuleId, attributedClientType, pathname]);

  // The dialog mirrors the overview request so it shows the same trends for
  // presets and complete custom ranges; "all time" has no previous window.
  const { data: statsData, isLoading: isStatsLoading } = useOwnerGetAutomationStats(
    statsRuleId ?? "",
    overviewParams,
    {
      query: {
        enabled: !!statsRuleId,
        queryKey: ['owner-automation-stats', statsRuleId, overviewParams]
      }
    }
  );

  // Attributed appointments are paginated (limit/offset) so long-running
  // campaigns don't load hundreds of rows at once. Pages accumulate into
  // `attributedItems`; "load more" advances the offset.
  const [attributedOffset, setAttributedOffset] = useState(0);
  const [attributedItems, setAttributedItems] = useState<AutomationAttributedAppointment[]>([]);
  const [attributedTotal, setAttributedTotal] = useState<number | null>(null);
  // New vs returning client mix for the whole attributed set (not just the
  // loaded pages) — computed server-side with the same derivation as each
  // row's isReturning badge. The server ignores the clientType filter for
  // these counts, so the summary stays stable while the list is narrowed.
  const [attributedMix, setAttributedMix] = useState<{ newClientCount: number; returningClientCount: number; unknownClientCount: number } | null>(null);

  // Client-segment filter for the drill-down list: all / only new / only
  // returning clients. Server-side filter (same SQL derivation as the
  // per-row badge) so `total` and "load more" stay consistent.
  // The drill-down follows the same window as the stats above it: preset
  // periods send ?period=, a complete custom range sends ?from=&?to=.
  const { data: attributedPage, isLoading: isAttributedLoading, isFetching: isAttributedFetching } = useOwnerListAutomationAttributedAppointments(
    statsRuleId ?? "",
    {
      ...activeStatsParams,
      ...(attributedClientType !== "all" ? { clientType: attributedClientType } : {}),
      limit: ATTRIBUTED_PAGE_SIZE,
      offset: attributedOffset,
    },
    {
      query: {
        enabled: !!statsRuleId,
        queryKey: ['owner-automation-attributed-appointments', statsRuleId, activeStatsParams, attributedClientType, attributedOffset]
      }
    }
  );

  // Reset accumulated pages whenever the dialog switches to another rule, the
  // owner picks a different time window (preset or completed custom range),
  // or the client-segment filter changes.
  useEffect(() => {
    setAttributedOffset(0);
    setAttributedItems([]);
    setAttributedTotal(null);
  }, [statsRuleId, activeStatsParams, attributedClientType]);

  // The mix summary only depends on the rule and window — not the segment
  // filter — so it is kept through filter switches and only cleared when the
  // rule or period actually changes.
  useEffect(() => {
    setAttributedMix(null);
  }, [statsRuleId, activeStatsParams]);

  // Merge each arriving page at its offset — idempotent if a page refetches.
  useEffect(() => {
    if (!attributedPage) return;
    setAttributedTotal(attributedPage.total);
    setAttributedMix({
      newClientCount: attributedPage.newClientCount,
      returningClientCount: attributedPage.returningClientCount,
      unknownClientCount: attributedPage.unknownClientCount,
    });
    setAttributedItems((prev) => [...prev.slice(0, attributedPage.offset), ...attributedPage.items]);
  }, [attributedPage]);

  const [formData, setFormData] = useState({
    name: "",
    trigger: "inactive_days" as any,
    triggerValue: 30,
    action: "send_email" as any,
    emailSubject: "",
    emailBody: "",
    smsBody: "",
    voucherCode: "",
  });

  const resetForm = () => {
    setFormData({
      name: "",
      trigger: "inactive_days",
      triggerValue: 30,
      action: "send_email",
      emailSubject: "",
      emailBody: "",
      smsBody: "",
      voucherCode: "",
    });
    setCurrentRuleId(null);
  };

  const handleEdit = (rule: any) => {
    let tVal = 30;
    if (rule.trigger === 'inactive_days') tVal = rule.triggerConfig?.inactiveDays || 30;
    else if (rule.trigger === 'visit_count') tVal = rule.triggerConfig?.visitCount || 5;
    else if (rule.trigger === 'expected_return_overdue') tVal = rule.triggerConfig?.overdueDays || 14;
    
    setFormData({
      name: rule.name,
      trigger: rule.trigger,
      triggerValue: tVal,
      action: rule.action,
      emailSubject: rule.emailSubject || "",
      emailBody: rule.emailBody || "",
      smsBody: rule.smsBody || "",
      voucherCode: rule.voucherCode || "",
    });
    setCurrentRuleId(rule.id);
    setIsEditing(true);
  };

  const handleSave = () => {
    let tConfig = {};
    if (formData.trigger === 'inactive_days') tConfig = { inactiveDays: formData.triggerValue };
    else if (formData.trigger === 'visit_count') tConfig = { visitCount: formData.triggerValue };
    else if (formData.trigger === 'expected_return_overdue') tConfig = { overdueDays: formData.triggerValue };

    const payload = {
      name: formData.name,
      trigger: formData.trigger,
      triggerConfig: tConfig,
      action: formData.action,
      emailSubject: formData.emailSubject || null,
      emailBody: formData.emailBody || null,
      smsBody: formData.smsBody || null,
      voucherCode: formData.voucherCode || null,
    };

    const callbacks = {
      onSuccess: () => {
        toast.success("Automatizacija sačuvana.");
        setIsEditing(false);
        resetForm();
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationStatsQueryKey() });
      },
      onError: (err: any) => {
        toast.error(err.message || "Greška pri čuvanju.");
      }
    };

    if (currentRuleId) {
      updateMutation.mutate({ automationId: currentRuleId, data: payload }, callbacks);
    } else {
      createMutation.mutate({ data: payload }, callbacks);
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm("Trajno obrisati ovu automatizaciju?")) return;
    deleteMutation.mutate({ automationId: id }, {
      onSuccess: () => {
        toast.success("Automatizacija obrisana.");
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationStatsQueryKey() });
      }
    });
  };

  const toggleStatus = (rule: any) => {
    const callbacks = {
      onSuccess: () => {
        toast.success(`Automatizacija je ${rule.status === 'active' ? 'pauzirana' : 'aktivirana'}.`);
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getOwnerListAutomationStatsQueryKey() });
      }
    };

    if (rule.status === 'active') {
      pauseMutation.mutate({ automationId: rule.id }, callbacks);
    } else {
      activateMutation.mutate({ automationId: rule.id }, callbacks);
    }
  };

  const handleTestRun = (id: string) => {
    toast.success("Pokrećem probno izvršavanje...");
    testMutation.mutate({ automationId: id }, {
      onSuccess: (res) => {
        toast.success(`Probni mod: ${res.eligibleCustomers} klijenata ispunjava uslov.`);
      }
    });
  };

  const handleCopyStatsLink = async () => {
    setIsCopyingStatsLink(true);
    try {
      await copyTextWithFallback(statsShareUrl);
      toast.success("Link kopiran.");
    } catch {
      toast.error("Link nije moguće kopirati. Kopirajte ga ručno iz adresne trake.");
    } finally {
      setIsCopyingStatsLink(false);
    }
  };

  const handleShareStatsLink = async () => {
    setIsSharingStatsLink(true);
    try {
      if (typeof navigator.share !== "function") {
        await copyTextWithFallback(statsShareUrl);
        toast.success("Link kopiran.");
        return;
      }

      await navigator.share({
        title: "Statistika automatizacije",
        text: "Pogledajte statistiku automatizacije.",
        url: statsShareUrl,
      });
      toast.success("Link je spreman za deljenje.");
    } catch (error) {
      if (!isShareCancelled(error)) {
        toast.error("Direktno deljenje nije moguće. Pokušajte kopiranje linka.");
        return;
      }

      try {
        await copyTextWithFallback(statsShareUrl);
        toast.success("Link kopiran.");
      } catch {
        toast.error("Deljenje je otkazano, a link nije moguće kopirati.");
      }
    } finally {
      setIsSharingStatsLink(false);
    }
  };

  const openStats = (ruleId: string) => {
    setAttributedClientType("all");
    setStatsRuleId(ruleId);
  };

  const closeStats = () => {
    setStatsRuleId(null);
    setAttributedClientType("all");
  };

  const triggerLabels: Record<string, string> = {
    inactive_days: "Neaktivnost (N dana)",
    birthday: "Rođendan",
    visit_count: "Broj poseta dostigao",
    first_visit_completed: "Završena prva poseta",
    package_completed: "Paket iskorišćen",
    appointment_cancelled: "Termin otkazan",
    expected_return_overdue: "Kasni na očekivani termin",
  };

  return (
    <BusinessLayout>
      <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-8 items-start">
        <OwnerSidebar current="/vlasnik/automatizacije" />
        
        <div className="flex-1 space-y-6 w-full min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">Marketing Automatizacije</h1>
              <p className="text-muted-foreground mt-1">Automatski šaljite poruke klijentima prema postavljenim pravilima.</p>
            </div>
            <Button onClick={() => { resetForm(); setIsEditing(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Novo pravilo
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
            <span className="font-semibold flex items-center gap-2 mb-1"><Zap className="w-4 h-4" /> AI Nikada ne šalje sam.</span>
            Sve kampanje koje predloži AI Asistent biće kreirane u stanju "Pauzirano". Samo vi možete aktivirati slanje.
          </div>

          {overviewStats && overviewStats.length > 0 && (
            <CampaignOverview items={overviewStats} period={statsPeriod} onPeriodChange={setStatsPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} onShowStats={openStats} />
          )}

          <div className="space-y-4">
            {isLoading ? (
              <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : rules?.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground flex flex-col items-center">
                  <Zap className="w-12 h-12 mb-4 opacity-20" />
                  <p>Nemate aktivnih automatizacija.</p>
                  <Button variant="outline" className="mt-4" onClick={() => { resetForm(); setIsEditing(true); }}>Kreirajte prvu automatizaciju</Button>
                </CardContent>
              </Card>
            ) : (
              rules?.map((rule: any) => (
                <Card key={rule.id} className={`transition-all ${rule.status === 'paused' ? 'opacity-70 bg-muted/30' : ''}`}>
                  <CardHeader className="pb-3 border-b">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {rule.name}
                          {rule.status === 'active' ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none">Aktivno</Badge> : <Badge variant="secondary">Pauzirano</Badge>}
                          {rule.aiProposed && <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">AI Predlog</Badge>}
                        </CardTitle>
                        <CardDescription className="mt-1 flex items-center gap-4">
                          <span className="font-medium text-foreground">
                            Okidač: {triggerLabels[rule.trigger] || rule.trigger} {rule.trigger === 'inactive_days' && rule.triggerConfig?.inactiveDays ? `(${rule.triggerConfig.inactiveDays} dana)` : rule.trigger === 'visit_count' && rule.triggerConfig?.visitCount ? `(${rule.triggerConfig.visitCount})` : rule.trigger === 'expected_return_overdue' && rule.triggerConfig?.overdueDays ? `(${rule.triggerConfig.overdueDays} dana)` : ''}
                          </span>
                          <span>Akcija: {rule.action === 'send_email' ? 'Email' : rule.action === 'send_sms' ? 'SMS' : 'Email + SMS'}</span>
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleTestRun(rule.id)} title="Proveri koliko klijenata ispunjava uslov (Dry-run)">
                          <Play className="w-4 h-4 mr-2" /> Probni run
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openStats(rule.id)}>
                          <Activity className="w-4 h-4 mr-2" /> Statistika
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleEdit(rule)}>Izmeni</Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="py-3 flex justify-between items-center bg-muted/10">
                    <div className="flex gap-2">
                      <Button variant={rule.status === 'active' ? "outline" : "default"} size="sm" onClick={() => toggleStatus(rule)}>
                        {rule.status === 'active' ? <><Pause className="w-4 h-4 mr-2" /> Pauziraj</> : <><Play className="w-4 h-4 mr-2" /> Aktiviraj</>}
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(rule.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </div>

      <Dialog open={isEditing} onOpenChange={(open) => !open && setIsEditing(false)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{currentRuleId ? "Izmeni automatizaciju" : "Nova automatizacija"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Naziv pravila</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Npr. Podsetnik za 30 dana neaktivnosti" />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Okidač (Trigger)</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formData.trigger} onChange={e => setFormData({...formData, trigger: e.target.value})}>
                  {Object.entries(triggerLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              {(formData.trigger === 'inactive_days' || formData.trigger === 'expected_return_overdue') && (
                <div className="space-y-2">
                  <Label>Broj dana</Label>
                  <Input type="number" min="1" value={formData.triggerValue} onChange={e => setFormData({...formData, triggerValue: Number(e.target.value)})} />
                </div>
              )}
              {formData.trigger === 'visit_count' && (
                <div className="space-y-2">
                  <Label>Broj poseta</Label>
                  <Input type="number" min="1" value={formData.triggerValue} onChange={e => setFormData({...formData, triggerValue: Number(e.target.value)})} />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Akcija (Šta se šalje)</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formData.action} onChange={e => setFormData({...formData, action: e.target.value})}>
                <option value="send_email">Samo Email</option>
                <option value="send_sms">Samo SMS</option>
                <option value="send_email_and_sms">Email i SMS</option>
              </select>
            </div>

            {(formData.action === 'send_email' || formData.action === 'send_email_and_sms') && (
              <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="w-4 h-4" /> Email podešavanja</div>
                <div className="space-y-2">
                  <Label>Naslov email-a</Label>
                  <Input value={formData.emailSubject} onChange={e => setFormData({...formData, emailSubject: e.target.value})} placeholder="Nedostajete nam!" />
                </div>
                <div className="space-y-2">
                  <Label>Sadržaj email-a (HTML dozvoljen)</Label>
                  <Textarea value={formData.emailBody} onChange={e => setFormData({...formData, emailBody: e.target.value})} rows={5} placeholder="Zdravo {{firstName}}, nismo se dugo videli..." />
                  <p className="text-xs text-muted-foreground">Podržani tagovi: {"{{firstName}}, {{lastName}}, {{salonName}}, {{voucherCode}}"}</p>
                </div>
              </div>
            )}

            {(formData.action === 'send_sms' || formData.action === 'send_email_and_sms') && (
              <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="w-4 h-4" /> SMS podešavanja</div>
                <div className="space-y-2">
                  <Label>Tekst poruke (do 160 karaktera)</Label>
                  <Textarea value={formData.smsBody} onChange={e => setFormData({...formData, smsBody: e.target.value})} rows={3} placeholder="Zdravo {{firstName}}, posetite nas opet. Vaš {{salonName}}." />
                  <p className="text-xs text-muted-foreground">Podržani tagovi: {"{{firstName}}, {{salonName}}, {{voucherCode}}"}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Promo kod (opciono)</Label>
              <Input value={formData.voucherCode} onChange={e => setFormData({...formData, voucherCode: e.target.value})} placeholder="Npr. POPUST10" />
              <p className="text-xs text-muted-foreground">Ovaj kod će biti ubačen umesto {"{{voucherCode}}"} taga u porukama.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>Odustani</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Sačuvaj pravilo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statsRuleId} onOpenChange={(open) => !open && closeStats()}>
        <DialogContent className="w-[calc(100%-1rem)] sm:w-full">
          <DialogHeader className="pr-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <DialogTitle>Statistika automatizacije</DialogTitle>
              <div className="flex shrink-0 flex-wrap gap-2">
                {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void handleShareStatsLink()}
                    disabled={isSharingStatsLink || isCopyingStatsLink}
                    aria-label="Podeli link do statistike"
                    data-testid="stats-share-link"
                  >
                    {isSharingStatsLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                    Podeli
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void handleCopyStatsLink()}
                  disabled={isCopyingStatsLink || isSharingStatsLink}
                  aria-label="Kopiraj link do statistike"
                  data-testid="stats-copy-link"
                >
                  {isCopyingStatsLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                  Kopiraj link
                </Button>
              </div>
            </div>
            <DialogDescription>Pregled uspešnosti ovog pravila — {periodDescription(statsPeriod, customRange)}.</DialogDescription>
          </DialogHeader>
          <PeriodSelector
            period={statsPeriod}
            onPeriodChange={setStatsPeriod}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
            testId="stats-period-selector"
          />
          <p
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="stats-period-status"
          >
            Izabran period: {periodDescription(statsPeriod, customRange)}
          </p>
          {isStatsLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : statsData ? (
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="bg-muted/30 p-4 rounded-lg text-center">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Ukupno pokretanja</p>
                <p className="text-2xl font-bold mt-1">{statsData.totalRuns}</p>
              </div>
              <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg text-center">
                <p className="text-xs text-primary uppercase font-semibold">Prihodovani termini</p>
                <p className="text-2xl font-bold mt-1 text-primary">{statsData.attributedAppointments}</p>
                {statsData.previous && (
                  <div className="mt-0.5 flex justify-center">
                    <TrendIndicator current={statsData.attributedAppointments} previous={statsData.previous.attributedAppointments} testId="stats-trend-appointments" />
                  </div>
                )}
                <p className="text-sm font-semibold text-emerald-800 mt-1" data-testid="stats-attributed-revenue">
                  {(statsData.attributedRevenue ?? 0).toLocaleString("sr-RS")} RSD prihoda
                  {statsData.previous && (
                    <span className="ml-1.5"><TrendIndicator current={statsData.attributedRevenue ?? 0} previous={statsData.previous.attributedRevenue ?? 0} testId="stats-trend-revenue" /></span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1" data-testid="stats-revenue-split">
                  Ostvareno: {(statsData.completedRevenue ?? 0).toLocaleString("sr-RS")} RSD ({statsData.completedAppointments}) · Zakazano: {(statsData.upcomingRevenue ?? 0).toLocaleString("sr-RS")} RSD ({statsData.upcomingAppointments})
                </p>
                {(statsData.cancelledAttributedAppointments ?? 0) > 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-1" data-testid="stats-cancelled-line">
                    Otkazano: {statsData.cancelledAttributedAppointments} {statsData.cancelledAttributedAppointments === 1 ? "termin" : "termina"} · {(statsData.cancelledAttributedRevenue ?? 0).toLocaleString("sr-RS")} RSD propušteno
                  </p>
                ) : null}
                {(statsData.noShowAttributedAppointments ?? 0) > 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-1" data-testid="stats-no-show-line">
                    No-show: {statsData.noShowAttributedAppointments} {statsData.noShowAttributedAppointments === 1 ? "termin" : "termina"} · {(statsData.noShowAttributedRevenue ?? 0).toLocaleString("sr-RS")} RSD nije realizovano
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">Otkazani i no-show termini nisu uračunati u ostvareni prihod</p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">No-show termini ne ulaze u ostvareni prihod kampanje.</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg text-center col-span-2 sm:col-span-1">
                <p className="text-xs text-emerald-700 uppercase font-semibold flex items-center justify-center gap-1"><CheckCircle2 className="w-3 h-3" /> Uspešno poslato</p>
                <p className="text-2xl font-bold mt-1 text-emerald-900">{statsData.sentCount}</p>
              </div>
              <div className="bg-red-50 border border-red-100 p-4 rounded-lg text-center col-span-2 sm:col-span-1">
                <p className="text-xs text-red-700 uppercase font-semibold flex items-center justify-center gap-1"><XCircle className="w-3 h-3" /> Neuspešno (Greške)</p>
                <p className="text-2xl font-bold mt-1 text-red-900">{statsData.failedCount}</p>
              </div>
              <div className="col-span-2 space-y-3">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3" data-testid="stats-new-client-share">
                  <p className="text-xs uppercase font-semibold text-primary">Udeo novih klijenata</p>
                  <p className="mt-1 text-sm">
                    {statsData.newClientShare === null
                      ? "Nije dostupan — nema poznatih podataka o klijentima."
                      : <><strong className="text-lg text-primary">{formatClientShare(statsData.newClientShare)}</strong> pripisanih termina je od novih klijenata ({statsData.newClientCount} od {statsData.knownClientCount} poznatih).</>}
                    {statsData.previous && (
                      <span className="ml-1.5">
                        <ClientShareTrend
                          current={statsData.newClientShare}
                          previous={statsData.previous.newClientShare}
                          testId="stats-trend-new-client-share"
                        />
                      </span>
                    )}
                  </p>
                  {statsData.previous && (statsData.newClientShare === null || statsData.previous.newClientShare === null) && (
                    <p className="mt-1 text-xs text-muted-foreground">Poređenje sa prethodnim periodom nije dostupno bez poznatih podataka u oba perioda.</p>
                  )}
                  {statsData.unknownClientCount > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="stats-unknown-client-count">
                      Nepoznati klijenti: {statsData.unknownClientCount} (nisu u osnovi)
                    </p>
                  )}
                </div>
              </div>
              <div className="col-span-2 space-y-3">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Isporuka poruka (podaci provajdera)</p>
                {statsData.emailSentCount === 0 && statsData.smsSentCount === 0 ? (
                  <p className="text-sm text-muted-foreground">Podaci o isporuci se prikazuju nakon prvog slanja.</p>
                ) : (
                  <div className="space-y-2">
                    {statsData.emailSentCount > 0 && (
                      <DeliveryFunnel
                        icon={<Mail className="w-4 h-4" />}
                        label="Email"
                        sent={statsData.emailSentCount}
                        delivered={statsData.emailDeliveredCount}
                        opened={statsData.emailOpenedCount}
                        failed={statsData.emailFailedCount}
                        previousDelivered={statsData.previous?.emailDeliveredCount}
                        previousOpened={statsData.previous?.emailOpenedCount}
                        trendTestIdPrefix="stats-trend-email"
                      />
                    )}
                    {statsData.smsSentCount > 0 && (
                      <DeliveryFunnel
                        icon={<MessageSquare className="w-4 h-4" />}
                        label="SMS"
                        sent={statsData.smsSentCount}
                        delivered={statsData.smsDeliveredCount}
                        opened={null}
                        failed={statsData.smsFailedCount}
                        noOpensNote="Provajder ne prati otvaranja SMS poruka."
                        previousDelivered={statsData.previous?.smsDeliveredCount}
                        trendTestIdPrefix="stats-trend-sms"
                      />
                    )}
                  </div>
                )}
                {statsData.previous && statsData.emailSentCount === 0 && statsData.previous.emailDeliveredCount > 0 && (
                  <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Email: <TrendIndicator current={0} previous={statsData.previous.emailDeliveredCount} testId="stats-trend-email-delivered" />
                  </p>
                )}
                {statsData.previous && statsData.smsSentCount === 0 && statsData.previous.smsDeliveredCount > 0 && (
                  <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" /> SMS: <TrendIndicator current={0} previous={statsData.previous.smsDeliveredCount} testId="stats-trend-sms-delivered" />
                  </p>
                )}
              </div>
              <div className="col-span-2 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground uppercase font-semibold">Termini ostvareni ovom kampanjom</p>
                  <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1" role="group" aria-label="Filter po tipu klijenta" data-testid="attributed-client-type-filter">
                    {([
                      { value: "all", label: "Svi" },
                      { value: "new", label: "Novi" },
                      { value: "returning", label: "Vraćeni" },
                    ] as const).map((opt) => {
                      // Per-segment count for the selected period, from the
                      // same period-wide mix as the summary line ("Svi" sums
                      // all three buckets, unknown included, so it matches
                      // the unfiltered list total). Hidden until the first
                      // page for this period arrives; stable while switching
                      // segments because the mix ignores the active filter.
                      const count = attributedMix === null
                        ? null
                        : opt.value === "all"
                          ? attributedMix.newClientCount + attributedMix.returningClientCount + attributedMix.unknownClientCount
                          : opt.value === "new"
                            ? attributedMix.newClientCount
                            : attributedMix.returningClientCount;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setAttributedClientType(opt.value)}
                          aria-pressed={attributedClientType === opt.value}
                          data-testid={`client-type-${opt.value}`}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            attributedClientType === opt.value
                              ? "bg-background text-foreground shadow-sm border"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                          {count !== null && (
                            <span data-testid={`client-type-count-${opt.value}`}> ({count})</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {attributedMix && (attributedMix.newClientCount + attributedMix.returningClientCount + attributedMix.unknownClientCount) > 0 && (
                  <p className="text-sm" data-testid="attributed-client-mix">
                    <span className="font-semibold">{srCount(attributedMix.newClientCount, "nov", "nova", "novih")}</span>
                    {statsData?.previous && (
                      <span className="ml-1.5">
                        <TrendIndicator
                          current={attributedMix.newClientCount}
                          previous={statsData.previous.newClientCount}
                          testId="stats-trend-new-clients"
                        />
                      </span>
                    )}
                    <span className="text-muted-foreground"> · </span>
                    <span className="font-semibold">{srCount(attributedMix.returningClientCount, "vraćen", "vraćena", "vraćenih")}</span>
                    {statsData?.previous && (
                      <span className="ml-1.5">
                        <TrendIndicator
                          current={attributedMix.returningClientCount}
                          previous={statsData.previous.returningClientCount}
                          testId="stats-trend-returning-clients"
                        />
                      </span>
                    )}
                    {attributedMix.unknownClientCount > 0 && (
                      <>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-muted-foreground">{srCount(attributedMix.unknownClientCount, "nepoznat", "nepoznata", "nepoznatih")}</span>
                      </>
                    )}
                  </p>
                )}
                {isAttributedLoading && attributedItems.length === 0 ? (
                  <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                ) : attributedItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {attributedClientType === "new"
                      ? "Nema termina novih klijenata za izabrani period."
                      : attributedClientType === "returning"
                        ? "Nema termina vraćenih klijenata za izabrani period."
                        : "Još uvek nema termina pripisanih ovoj kampanji."}
                  </p>
                ) : (
                  <>
                    <div className="border rounded-lg divide-y max-h-56 overflow-y-auto" data-testid="attributed-appointments-list">
                      {attributedItems.map((appt) => (
                        <div key={appt.appointmentId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`attributed-appointment-${appt.appointmentId}`}>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{appt.serviceName}</p>
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                              <span>{new Date(appt.date).toLocaleDateString("sr-RS")}</span>
                              <span>·</span>
                              <span data-testid={`attributed-appointment-client-${appt.appointmentId}`}>
                                {appt.salonCustomerId ? (
                                  <Link
                                    href={`/vlasnik/klijenti?klijent=${appt.salonCustomerId}`}
                                    className="text-primary hover:underline font-medium"
                                    title="Otvori istoriju klijenta"
                                    data-testid={`link-attributed-client-${appt.appointmentId}`}
                                  >
                                    {appt.clientFirstName || appt.clientLastName
                                      ? [appt.clientFirstName, appt.clientLastName].filter(Boolean).join(" ")
                                      : "Nepoznat klijent"}
                                  </Link>
                                ) : appt.clientFirstName || appt.clientLastName ? (
                                  [appt.clientFirstName, appt.clientLastName].filter(Boolean).join(" ")
                                ) : (
                                  "Nepoznat klijent"
                                )}
                              </span>
                              {appt.isReturning !== null && appt.isReturning !== undefined && (
                                <Badge
                                  variant={appt.isReturning ? "secondary" : "outline"}
                                  className="px-1.5 py-0 text-[10px] font-medium"
                                  data-testid={`attributed-appointment-client-type-${appt.appointmentId}`}
                                >
                                  {appt.isReturning ? "Vraćen klijent" : "Nov klijent"}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <span className="font-semibold text-emerald-800 whitespace-nowrap">{appt.price.toLocaleString("sr-RS")} RSD</span>
                        </div>
                      ))}
                    </div>
                    {attributedTotal !== null && attributedItems.length < attributedTotal && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={isAttributedFetching}
                        onClick={() => setAttributedOffset(attributedItems.length)}
                        data-testid="button-load-more-attributed"
                      >
                        {isAttributedFetching ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>Učitaj još ({attributedItems.length} od {attributedTotal})</>
                        )}
                      </Button>
                    )}
                  </>
                )}
              </div>
              <div className="col-span-2 text-center mt-2 text-sm text-muted-foreground">
                <p>Preskočeno (npr. nema kontakt podataka): {statsData.skippedCount}</p>
                <p className="mt-1">Poslednje pokretanje: {statsData.lastRunAt ? new Date(statsData.lastRunAt).toLocaleString("sr-RS") : "Nikad"}</p>
              </div>
              {statsData.previous && previousTrendWindowLabel(statsPeriod, customRange) && (
                <p className="col-span-2 text-xs text-muted-foreground" data-testid="stats-trend-note">
                  Trend u odnosu na prethodni period iste dužine ({previousTrendWindowLabel(statsPeriod, customRange)}).
                </p>
              )}
            </div>
          ) : (
            <p className="p-4 text-center text-muted-foreground">Podaci nisu dostupni.</p>
          )}
        </DialogContent>
      </Dialog>
    </BusinessLayout>
  );
}
