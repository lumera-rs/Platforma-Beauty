import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import {
  db, educationCentersTable, referralAttributionsTable, referralCreditLedgerTable,
  referralCreditRedemptionsTable,
  referralQualificationsTable, referralReviewsTable, salonsTable,
} from "@workspace/db";
import {
  AdminListReferralApprovalsResponse, AdminListReferralReviewsResponse,
  AdminDecideReferralApprovalBody, AdminDecideReferralApprovalParams, AdminDecideReferralApprovalResponse,
  AdminReviewReferralBody, AdminReviewReferralParams, AdminReviewReferralResponse,
  GetReferralDashboardResponse, ValidateReferralCodeParams, ValidateReferralCodeResponse,
} from "@workspace/api-zod";
import { getCurrentUser, isAdmin } from "../lib/auth";
import {
  decideReferralReview, decideReferredBusinessApproval, deriveReferralWalletSnapshot,
  ensureReferralCode, REFERRAL_TERMS_SR, normalizedReferralCode, referralLink,
  ReferralReviewDecisionConflictError, validateReferralCode,
} from "../lib/referral-service";
import { REFERRAL_POLICY, type ReferralChannel } from "../lib/referral-domain";
import { publishCatalogInvalidation } from "../lib/catalog-cache";
import { safeIsoTimestamp } from "../lib/date-serialization";

const router: IRouter = Router();

/**
 * The only unauthenticated referral endpoint intentionally discloses no
 * referrer identity. Registration uses the same lookup again inside its
 * transaction; this endpoint is only a preflight for a landing page.
 */
router.get("/referrals/validate/:code", async (req: Request, res: Response): Promise<void> => {
  const params = ValidateReferralCodeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Kod preporuke nije ispravan." });
    return;
  }
  const code = await validateReferralCode(params.data.code);
  if (!code) {
    res.status(404).json({ valid: false });
    return;
  }
  res.json(ValidateReferralCodeResponse.parse({
    valid: true,
    code: code.code,
    channel: code.channel,
    link: referralLink(`${req.protocol}://${req.get("host")}`, normalizedReferralCode(code.code), code.channel),
  }));
});

router.get("/referrals/dashboard", async (req: Request, res: Response): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  const now = new Date();
  const capLookback = new Date(now.getTime() - 35 * 86400_000);
  const [qualifications, ledger, walletLedger, redemptionRows, capLedger, ownedSalons, ownedCenters] = await Promise.all([
    db.select({ attributionId: referralAttributionsTable.id, codeId: referralAttributionsTable.referralCodeId, channel: referralAttributionsTable.channel, status: referralQualificationsTable.status })
      .from(referralQualificationsTable)
      .innerJoin(referralAttributionsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
      .where(eq(referralAttributionsTable.referrerUserId, user.id)),
    db.select().from(referralCreditLedgerTable).where(eq(referralCreditLedgerTable.ownerUserId, user.id))
      .orderBy(desc(referralCreditLedgerTable.effectiveAt)).limit(100),
    db.select().from(referralCreditLedgerTable)
      .where(eq(referralCreditLedgerTable.ownerUserId, user.id)),
    db.select({
      ledgerEntryId: referralCreditRedemptionsTable.ledgerEntryId,
      amountRsd: referralCreditRedemptionsTable.amountRsd,
    }).from(referralCreditRedemptionsTable)
      .innerJoin(referralCreditLedgerTable,
        eq(referralCreditRedemptionsTable.ledgerEntryId, referralCreditLedgerTable.id))
      .where(eq(referralCreditLedgerTable.ownerUserId, user.id)),
    db.select({
      referralAttributionId: referralCreditLedgerTable.referralAttributionId,
      type: referralCreditLedgerTable.type,
      effectiveAt: referralCreditLedgerTable.effectiveAt,
    }).from(referralCreditLedgerTable).where(and(
      eq(referralCreditLedgerTable.ownerUserId, user.id),
      eq(referralCreditLedgerTable.type, "held"),
      gte(referralCreditLedgerTable.effectiveAt, capLookback),
    )),
    db.select({ id: salonsTable.id, name: salonsTable.name }).from(salonsTable).where(eq(salonsTable.ownerId, user.id)),
    db.select({ id: educationCentersTable.id, name: educationCentersTable.name }).from(educationCentersTable).where(eq(educationCentersTable.ownerId, user.id)),
  ]);
  const walletScopeKey = (entry: Pick<typeof referralCreditLedgerTable.$inferSelect,
    "walletKind" | "ownerUserId" | "salonId" | "educationCenterId">) =>
    `${entry.walletKind}:${entry.ownerUserId}:${entry.salonId ?? ""}:${entry.educationCenterId ?? ""}`;
  const walletSnapshots = Array.from(new Set(walletLedger.map(walletScopeKey))).map((scopeKey) => {
    const scopedEntries = walletLedger.filter((entry) => walletScopeKey(entry) === scopeKey);
    const sourceIds = new Set(scopedEntries
      .filter((entry) => entry.type === "available")
      .map((entry) => entry.id));
    return deriveReferralWalletSnapshot(
      scopedEntries,
      redemptionRows.filter((row) => sourceIds.has(row.ledgerEntryId)),
      now,
    );
  });
  const periodStart = (period: "calendar_month" | "calendar_week") => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === "calendar_month") return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date;
  };
  const issued = await db.transaction(async (tx) => {
    const sources: Array<{
      channel: ReferralChannel;
      sourceBusinessId: string | null;
      sourceBusinessKind: "salon" | "education_center" | "account";
      sourceBusinessName: string;
    }> = [];
    if (user.role === "CUSTOMER" || user.role === "JOBSEEKER") {
      sources.push({ channel: "B1", sourceBusinessId: null, sourceBusinessKind: "account", sourceBusinessName: `${user.firstName} ${user.lastName}`.trim() });
    }
    sources.push({ channel: "B2", sourceBusinessId: null, sourceBusinessKind: "account", sourceBusinessName: `${user.firstName} ${user.lastName}`.trim() });
    for (const salon of ownedSalons) {
      sources.push({ channel: "A", sourceBusinessId: salon.id, sourceBusinessKind: "salon", sourceBusinessName: salon.name });
      sources.push({ channel: "D", sourceBusinessId: salon.id, sourceBusinessKind: "salon", sourceBusinessName: salon.name });
    }
    for (const center of ownedCenters) {
      sources.push({ channel: "A", sourceBusinessId: center.id, sourceBusinessKind: "education_center", sourceBusinessName: center.name });
      sources.push({ channel: "C", sourceBusinessId: center.id, sourceBusinessKind: "education_center", sourceBusinessName: center.name });
    }
    const result = [];
    for (const source of sources) {
      const code = await ensureReferralCode(tx, {
        channel: source.channel,
        referrerUserId: user.id,
        ...(source.sourceBusinessKind === "account" ? {} : {
          sourceBusiness: source.sourceBusinessKind,
          sourceBusinessId: source.sourceBusinessId!,
        }),
      });
      result.push({ ...source, code });
    }
    return result;
  });
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  const response = {
    availableRsd: walletSnapshots.reduce((sum, snapshot) => sum + snapshot.availableRsd, 0),
    expiringSoonRsd: walletSnapshots.reduce((sum, snapshot) => sum + snapshot.expiringSoonRsd, 0),
    channels: issued.map(({ channel, sourceBusinessId, sourceBusinessKind, sourceBusinessName, code }) => {
      const scoped = qualifications.filter((item) => item.codeId === code.id);
      const policy = REFERRAL_POLICY[channel];
      const capUsed = policy.cap
        ? capLedger.filter((entry) => entry.referralAttributionId
          && entry.type === "held"
          && entry.effectiveAt >= periodStart(policy.cap!.period)
          && scoped.some((qualification) => qualification.attributionId === entry.referralAttributionId)).length
        : null;
      return {
        channel, sourceBusinessId, sourceBusinessKind, sourceBusinessName,
        code: code.code, link: referralLink(requestOrigin, code.code, channel),
        qualified: scoped.filter((item) => ["qualified", "held", "available"].includes(item.status)).length,
        pending: scoped.filter((item) => !["available", "reversed", "rejected"].includes(item.status)).length,
        terms: REFERRAL_TERMS_SR[channel],
        cap: policy.cap ? { limit: policy.cap.amount, used: capUsed ?? 0, period: policy.cap.period } : null,
      };
    }),
    ledger: ledger.map((entry) => ({
      id: entry.id, type: entry.type, amountRsd: entry.amountRsd,
      effectiveAt: safeIsoTimestamp(entry.effectiveAt), expiresAt: safeIsoTimestamp(entry.expiresAt), reason: entry.reason,
    })),
  };
  res.json(GetReferralDashboardResponse.parse(response));
});

router.get("/admin/referrals/approvals", async (req: Request, res: Response): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !isAdmin(user)) { res.status(user ? 403 : 401).json({ error: "Administratorski pristup je obavezan." }); return; }
  const rows = await db.select().from(referralAttributionsTable)
    .innerJoin(referralQualificationsTable, eq(referralQualificationsTable.attributionId, referralAttributionsTable.id))
    .where(and(inArray(referralAttributionsTable.channel, ["A", "B1"]), eq(referralQualificationsTable.status, "pending_verification")));
  res.json(AdminListReferralApprovalsResponse.parse(rows.map((row) => ({
    attributionId: row.referral_attributions.id, channel: row.referral_attributions.channel,
    businessKind: row.referral_attributions.referredSalonId ? "salon" : "education_center",
    status: row.referral_qualifications.status, createdAt: safeIsoTimestamp(row.referral_attributions.createdAt),
  }))));
});

router.patch("/admin/referrals/approvals/:attributionId", async (req: Request, res: Response): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !isAdmin(user)) { res.status(user ? 403 : 401).json({ error: "Administratorski pristup je obavezan." }); return; }
  const [params, body] = [AdminDecideReferralApprovalParams.safeParse(req.params), AdminDecideReferralApprovalBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Odluka o verifikaciji nije ispravna." }); return; }
  const decided = await decideReferredBusinessApproval(user.id, params.data.attributionId, body.data.action, body.data.reason);
  if (!decided) { res.status(404).json({ error: "Preporučeni biznis nije pronađen." }); return; }
  // Salon discovery has a dedicated invalidation path; invalidate the education
  // listing too because the shared approval action can alter either source.
  void publishCatalogInvalidation(decided.businessKind === "salon" ? ["salons"] : ["education-categories"]);
  res.json(AdminDecideReferralApprovalResponse.parse(decided));
});

router.get("/admin/referrals/reviews", async (req: Request, res: Response): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !isAdmin(user)) { res.status(user ? 403 : 401).json({ error: "Administratorski pristup je obavezan." }); return; }
  const rows = await db.select().from(referralReviewsTable).where(eq(referralReviewsTable.status, "open")).orderBy(desc(referralReviewsTable.createdAt));
  res.json(AdminListReferralReviewsResponse.parse(rows.map((row) => ({
    id: row.id, status: row.status, reasonCode: row.reasonCode, detail: row.detail, score: row.score, createdAt: safeIsoTimestamp(row.createdAt),
  }))));
});

router.patch("/admin/referrals/reviews/:reviewId", async (req: Request, res: Response): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user || !isAdmin(user)) { res.status(user ? 403 : 401).json({ error: "Administratorski pristup je obavezan." }); return; }
  const [params, body] = [AdminReviewReferralParams.safeParse(req.params), AdminReviewReferralBody.safeParse(req.body)];
  if (!params.success || !body.success) { res.status(400).json({ error: "Podaci za pregled nisu ispravni." }); return; }
  let saved;
  try {
    saved = await decideReferralReview(
      user.id,
      params.data.reviewId,
      body.data.status,
      body.data.detail,
    );
  } catch (error) {
    if (error instanceof ReferralReviewDecisionConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!saved) { res.status(404).json({ error: "Zapis za pregled nije pronađen." }); return; }
  res.json(AdminReviewReferralResponse.parse({
    id: saved.id, status: saved.status, reasonCode: saved.reasonCode, detail: saved.detail, score: saved.score, createdAt: safeIsoTimestamp(saved.createdAt),
  }));
});

export default router;