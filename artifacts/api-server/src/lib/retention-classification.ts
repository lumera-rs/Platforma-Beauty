/**
 * Deterministic retention classification service.
 *
 * Classifies a salon customer into one of: NEW, ACTIVE, VIP, AT_RISK, LOST
 * based solely on their appointment history within the SAME salon.
 * Never infers cross-salon data.
 *
 * Semantics:
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

export interface RetentionInput {
  appointments: AppointmentRecord[];
  /** today for determinism in tests */
  today?: Date;
  /** per-salon median spend for VIP calculation */
  salonMedianSpend?: number;
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
  if (completedCount === 1 && lastVisitDaysAgo <= 45 && !hasFutureAppointment) {
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

  // Risk thresholds based on typical interval or sensible defaults
  const baseInterval = typicalIntervalDays ?? 45;
  const atRiskThreshold = baseInterval * 1.5;
  const lostThreshold = Math.max(baseInterval * 2.5, 180);

  const isOverdue = lastVisitDaysAgo > atRiskThreshold;
  const isLost = lastVisitDaysAgo > lostThreshold;

  // Future appointment rescues AT_RISK/LOST → treat as returning ACTIVE
  if (hasFutureAppointment) {
    const isVip = completedCount >= 5 || (input.salonMedianSpend !== undefined && totalSpend > input.salonMedianSpend * 2);
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
  const isHighSpend = input.salonMedianSpend !== undefined && totalSpend > input.salonMedianSpend * 2;
  if (completedCount >= 5 || isHighSpend) {
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
