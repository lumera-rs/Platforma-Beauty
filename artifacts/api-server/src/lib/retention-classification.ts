/**
 * Deterministic retention classification service.
 *
 * Classifies a salon customer into one of: NEW, ACTIVE, VIP, AT_RISK, LOST
 * based solely on their appointment history within the SAME salon.
 * Never infers cross-salon data.
 *
 * Semantics (numbers below are the platform DEFAULTS — administrators tune the
 * actual values via platform retention settings, passed in as `thresholds`):
 *   NEW      — never had a completed visit, or exactly 1 completed visit with no prior
 *              repeat pattern (first-timer / very recent first visit ≤ 45 days ago).
 *   ACTIVE   — repeat customer (≥ 2 completed) returning within their typical window.
 *   VIP      — high-frequency (≥ 5 completed) OR salon-relative high-spend AND active.
 *   AT_RISK  — has at least 1 completed visit; last visit is 1.5×–2.5× their typical
 *              interval overdue (or 61–180 days if no interval is computable); no future apt.
 *   LOST     — last visit > 2.5× typical interval overdue (or > 180 days); no future apt.
 *
 * Future confirmed/pending appointments rescue AT_RISK/LOST → ACTIVE.
 *
 * For each status we return:
 *   explanation      — human-readable reason for the classification
 *   recommendedAction — brief owner action suggestion
 */

export type RetentionStatus = "NEW" | "ACTIVE" | "VIP" | "AT_RISK" | "LOST";

export interface AppointmentRecord {
  date: string; // ISO date string YYYY-MM-DD
  status: "pending" | "confirmed" | "completed" | "cancelled" | "no-show";
  price: number;
}

/**
 * Admin-tunable classification thresholds. Multipliers are expressed as
 * integer percents (150 = 1.5×) so stored settings stay exactly deterministic.
 */
export interface RetentionThresholds {
  /** A single completed visit within this many days still counts as NEW. */
  newCustomerWindowDays: number;
  /** Assumed visit interval (days) when fewer than 2 completed visits exist. */
  defaultIntervalDays: number;
  /** AT_RISK when overdue beyond typicalInterval × this percent. */
  atRiskIntervalPercent: number;
  /** LOST when overdue beyond typicalInterval × this percent. */
  lostIntervalPercent: number;
  /** LOST never triggers before this many days since the last visit. */
  lostMinimumDays: number;
  /** VIP when the customer has at least this many completed visits. */
  vipMinCompletedVisits: number;
  /** VIP when total spend exceeds salon median × this percent. */
  vipSpendPercentOfMedian: number;
}

/** Platform defaults — must match the pre-settings hardcoded behaviour. */
export const DEFAULT_RETENTION_THRESHOLDS: RetentionThresholds = {
  newCustomerWindowDays: 45,
  defaultIntervalDays: 45,
  atRiskIntervalPercent: 150,
  lostIntervalPercent: 250,
  lostMinimumDays: 180,
  vipMinCompletedVisits: 5,
  vipSpendPercentOfMedian: 200,
};

/**
 * Median of completed-appointment prices for a salon. Centralized so the
 * retention LIST and DETAIL endpoints (and any snapshot) always feed the SAME
 * median into classifyRetention — otherwise a VIP-by-spend customer could
 * show different statuses on different screens.
 */
export function computeSalonMedianSpend(completedPrices: number[]): number | undefined {
  if (completedPrices.length === 0) return undefined;
  const sorted = [...completedPrices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface RetentionInput {
  appointments: AppointmentRecord[];
  /** today for determinism in tests */
  today?: Date;
  /** per-salon median spend for VIP calculation */
  salonMedianSpend?: number;
  /** active platform thresholds; defaults preserve historical behaviour */
  thresholds?: RetentionThresholds;
}

export interface RetentionResult {
  status: RetentionStatus;
  completedCount: number;
  lastVisitDaysAgo: number | null;
  typicalIntervalDays: number | null;
  totalSpend: number;
  hasFutureAppointment: boolean;
  explanation: string;
  recommendedAction: string;
}

function medianInterval(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / 86_400_000);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0
    ? ((gaps[mid - 1]! + gaps[mid]!) / 2)
    : gaps[mid]!;
}

export function classifyRetention(input: RetentionInput): RetentionResult {
  const today = input.today ?? new Date();
  const todayTime = today.getTime();
  const t = input.thresholds ?? DEFAULT_RETENTION_THRESHOLDS;

  const completed = input.appointments.filter((a) => a.status === "completed");
  const future = input.appointments.filter(
    (a) =>
      (a.status === "pending" || a.status === "confirmed") &&
      new Date(a.date).getTime() >= todayTime,
  );

  const completedCount = completed.length;
  const hasFutureAppointment = future.length > 0;
  const totalSpend = completed.reduce((s, a) => s + a.price, 0);

  // ── NEW ──────────────────────────────────────────────────────────────────
  if (completedCount === 0) {
    return {
      status: "NEW",
      completedCount: 0,
      lastVisitDaysAgo: null,
      typicalIntervalDays: null,
      totalSpend: 0,
      hasFutureAppointment,
      explanation: "Klijent još nije završio nijednu posetu.",
      recommendedAction: "Pozdravite klijenta i ponudite popust za prvu posetu.",
    };
  }

  const completedDates = completed.map((a) => new Date(a.date));
  const lastVisitDate = completedDates.reduce((max, d) => (d > max ? d : max), completedDates[0]!);
  const lastVisitDaysAgo = Math.floor((todayTime - lastVisitDate.getTime()) / 86_400_000);
  const typicalIntervalDays = medianInterval(completedDates);

  // First-time with very recent single visit → still NEW
  if (completedCount === 1 && lastVisitDaysAgo <= t.newCustomerWindowDays && !hasFutureAppointment) {
    return {
      status: "NEW",
      completedCount,
      lastVisitDaysAgo,
      typicalIntervalDays: null,
      totalSpend,
      hasFutureAppointment,
      explanation: "Klijent je tek završio prvu posetu.",
      recommendedAction: "Kontaktirajte za rezervaciju sledeće posete dok je iskustvo svežo.",
    };
  }

  // Risk thresholds based on typical interval or admin-tuned defaults
  const baseInterval = typicalIntervalDays ?? t.defaultIntervalDays;
  const atRiskThreshold = (baseInterval * t.atRiskIntervalPercent) / 100;
  const lostThreshold = Math.max((baseInterval * t.lostIntervalPercent) / 100, t.lostMinimumDays);

  const isOverdue = lastVisitDaysAgo > atRiskThreshold;
  const isLost = lastVisitDaysAgo > lostThreshold;

  // Future appointment rescues AT_RISK/LOST → treat as returning ACTIVE
  if (hasFutureAppointment) {
    const isVip =
      completedCount >= t.vipMinCompletedVisits ||
      (input.salonMedianSpend !== undefined && totalSpend > (input.salonMedianSpend * t.vipSpendPercentOfMedian) / 100);
    if (isVip) {
      return {
        status: "VIP",
        completedCount, lastVisitDaysAgo, typicalIntervalDays, totalSpend, hasFutureAppointment,
        explanation: `VIP klijent se vratio — zakazao novi termin (${completedCount} završenih poseta).`,
        recommendedAction: "Personalizujte uslugu i ponudite posebne povlastice.",
      };
    }
    return {
      status: "ACTIVE",
      completedCount, lastVisitDaysAgo, typicalIntervalDays, totalSpend, hasFutureAppointment,
      explanation: "Klijent ima zakazan termin u budućnosti.",
      recommendedAction: "Potvrdite termin i ponudite dodatne usluge.",
    };
  }

  // ── LOST ─────────────────────────────────────────────────────────────────
  if (isLost) {
    return {
      status: "LOST",
      completedCount, lastVisitDaysAgo, typicalIntervalDays, totalSpend, hasFutureAppointment,
      explanation: `Klijent nije posetio salon ${lastVisitDaysAgo} dana (prag za gubitak: ${Math.round(lostThreshold)} dana).`,
      recommendedAction: "Pošaljite win-back ponudu sa posebnim popustom.",
    };
  }

  // ── AT_RISK ───────────────────────────────────────────────────────────────
  if (isOverdue) {
    return {
      status: "AT_RISK",
      completedCount, lastVisitDaysAgo, typicalIntervalDays, totalSpend, hasFutureAppointment,
      explanation: `Klijent kasni sa posetom ${lastVisitDaysAgo} dana (uobičajeni interval: ${Math.round(baseInterval)} dana).`,
      recommendedAction: "Pošaljite podsetnik ili ponudite popust za sledeći termin.",
    };
  }

  // ── VIP ───────────────────────────────────────────────────────────────────
  const isHighSpend =
    input.salonMedianSpend !== undefined &&
    totalSpend > (input.salonMedianSpend * t.vipSpendPercentOfMedian) / 100;
  if (completedCount >= t.vipMinCompletedVisits || isHighSpend) {
    return {
      status: "VIP",
      completedCount, lastVisitDaysAgo, typicalIntervalDays, totalSpend, hasFutureAppointment,
      explanation: isHighSpend
        ? `Klijent troši znatno više od proseka salona (${totalSpend} din ukupno, ${completedCount} poseta).`
        : `Visokofrekventni klijent — ${completedCount} završenih poseta.`,
      recommendedAction: "Ponudite VIP paket ili ekskluzivni tretman.",
    };
  }

  // ── ACTIVE ────────────────────────────────────────────────────────────────
  return {
    status: "ACTIVE",
    completedCount, lastVisitDaysAgo, typicalIntervalDays, totalSpend, hasFutureAppointment,
    explanation: `Redovni klijent, ${completedCount} poseta, poslednja pre ${lastVisitDaysAgo} dana.`,
    recommendedAction: "Podsetite na sledeći termin blizu isteka uobičajenog intervala.",
  };
}
