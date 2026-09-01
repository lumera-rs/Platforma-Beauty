import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  courseEnrollmentsTable, coursesTable, db, educationBundlePurchaseEscrowsTable,
  educationBundlePurchaseItemsTable, educationBundlePurchaseLedgerEntriesTable,
  educationBundlePurchasesTable, educationBundleCoursesTable, educationBundlesTable,
  educationCentersTable, employeesTable, salonsTable,
  usersTable,
} from "@workspace/db";
import { getCurrentUser, isAdmin } from "../lib/auth";
import {
  getEducationPlatformSettings,
  lockEducationBillingRules,
  lockEducationCenterFinancials,
  resolveEducationBillingSettingsForChargeInTx,
} from "../lib/education-billing";
import { educationIpsQrPayload } from "../lib/education-marketplace-domain";

const router: IRouter = Router();
const purchaseBody = z.object({
  targetType: z.enum(["individual", "salon_employee"]),
  learnerUserId: z.string().uuid().optional(),
  salonId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
});
const fingerprint = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex");
async function user(req: Request, res: Response) {
  const result = await getCurrentUser(req);
  if (!result) res.status(401).json({ error: "Prijava je obavezna." });
  return result;
}
function view(row: typeof educationBundlePurchasesTable.$inferSelect, includePaymentInstructions = false) {
  return { id: row.id, bundleId: row.bundleId, centerId: row.centerId, purchaserId: row.purchaserId,
    targetType: row.targetType, learnerUserId: row.learnerUserId, salonId: row.salonId, employeeId: row.employeeId,
    amount: row.amount, currency: row.currency, status: row.status,
    ...(includePaymentInstructions ? { paymentInstructions: row.paymentInstructions } : {}),
    requestedAt: row.requestedAt, settledAt: row.settledAt };
}
async function canManageCenter(userId: string, centerId: string) {
  const [center] = await db.select({ ownerId: educationCentersTable.ownerId }).from(educationCentersTable).where(eq(educationCentersTable.id, centerId)).limit(1);
  return center?.ownerId === userId;
}

// Public catalog deliberately exposes only currently purchasable packages.
router.get("/education/bundles", async (_req, res) => {
  const rows = await db.select({ bundle: educationBundlesTable, centerName: educationCentersTable.name })
    .from(educationBundlesTable).innerJoin(educationCentersTable, eq(educationCentersTable.id, educationBundlesTable.centerId))
    .where(and(eq(educationBundlesTable.active, true), eq(educationBundlesTable.published, true)));
  const ids = rows.map(r => r.bundle.id);
  const links = ids.length ? await db.select({ bundleId: educationBundleCoursesTable.bundleId }).from(educationBundleCoursesTable).where(inArray(educationBundleCoursesTable.bundleId, ids)) : [];
  const items = ids.length ? await db.select({ bundleId: educationBundleCoursesTable.bundleId, courseId: coursesTable.id, title: coursesTable.title, courseCenterId: coursesTable.centerId })
    .from(educationBundleCoursesTable).innerJoin(coursesTable, eq(coursesTable.id, educationBundleCoursesTable.courseId)).where(and(inArray(educationBundleCoursesTable.bundleId, ids), eq(coursesTable.published, true), eq(coursesTable.archived, false))) : [];
  res.json(rows.filter(r => { const all = links.filter(link => link.bundleId === r.bundle.id).length; return all > 0 && all === items.filter(item => item.bundleId === r.bundle.id && item.courseCenterId === r.bundle.centerId).length; }).map(r => ({ ...r.bundle, name: r.bundle.title, centerName: r.centerName, courses: items.filter(i => i.bundleId === r.bundle.id && i.courseCenterId === r.bundle.centerId).map(({ courseCenterId: _courseCenterId, ...item }) => item) })));
});
router.get("/education/bundles/:bundleId", async (req, res) => {
  const [bundle] = await db.select().from(educationBundlesTable).where(and(eq(educationBundlesTable.id, req.params.bundleId), eq(educationBundlesTable.active, true), eq(educationBundlesTable.published, true))).limit(1);
  if (!bundle) { res.status(404).json({ error: "Paket nije pronađen." }); return; }
  const courses = await db.select({ courseId: coursesTable.id, title: coursesTable.title, description: coursesTable.description, duration: coursesTable.duration })
    .from(educationBundleCoursesTable).innerJoin(coursesTable, eq(coursesTable.id, educationBundleCoursesTable.courseId)).where(and(eq(educationBundleCoursesTable.bundleId, bundle.id), eq(coursesTable.centerId, bundle.centerId), eq(coursesTable.published, true), eq(coursesTable.archived, false)));
  const links = await db.select({ courseId: educationBundleCoursesTable.courseId }).from(educationBundleCoursesTable).where(eq(educationBundleCoursesTable.bundleId, bundle.id));
  if (!courses.length || courses.length !== links.length) { res.status(409).json({ error: "Paket nema dosledan skup aktivnih kurseva." }); return; }
  res.json({ ...bundle, name: bundle.title, courses });
});
router.post("/education/bundles/:bundleId/purchases", async (req, res) => {
  const buyer = await user(req, res); if (!buyer) return;
  const parsed = purchaseBody.safeParse(req.body); const key = req.header("Idempotency-Key")?.trim();
  if (!parsed.success || !key || key.length > 200) { res.status(400).json({ error: "Ispravan zahtev i Idempotency-Key su obavezni." }); return; }
  const fp = fingerprint(parsed.data);
  const prior = await db.select().from(educationBundlePurchasesTable).where(and(eq(educationBundlePurchasesTable.purchaserId, buyer.id), eq(educationBundlePurchasesTable.idempotencyKey, key))).limit(1);
  if (prior[0]) { if (prior[0].idempotencyFingerprint !== fp) { res.status(409).json({ error: "Idempotency-Key je već korišćen za drugi zahtev." }); return; } res.json(view(prior[0], true)); return; }
  const [bundle] = await db.select().from(educationBundlesTable).where(and(eq(educationBundlesTable.id, req.params.bundleId), eq(educationBundlesTable.active, true), eq(educationBundlesTable.published, true))).limit(1);
  if (!bundle) { res.status(404).json({ error: "Paket nije dostupan." }); return; }
  const bundleCourses = await db.select({ id: coursesTable.id, title: coursesTable.title, duration: coursesTable.duration, format: coursesTable.format })
    .from(educationBundleCoursesTable).innerJoin(coursesTable, eq(coursesTable.id, educationBundleCoursesTable.courseId)).where(and(eq(educationBundleCoursesTable.bundleId, bundle.id), eq(coursesTable.centerId, bundle.centerId), eq(coursesTable.published, true), eq(coursesTable.archived, false)));
  const links = await db.select({ courseId: educationBundleCoursesTable.courseId }).from(educationBundleCoursesTable).where(eq(educationBundleCoursesTable.bundleId, bundle.id));
  if (!bundleCourses.length || bundleCourses.length !== links.length) { res.status(409).json({ error: "Paket nema dosledan skup aktivnih kurseva." }); return; }
  let target: { learnerUserId: string | null; salonId: string | null; employeeId: string | null };
  if (parsed.data.targetType === "individual") {
    if (parsed.data.learnerUserId && parsed.data.learnerUserId !== buyer.id) { res.status(403).json({ error: "Možete kupiti paket samo za sebe." }); return; }
    target = { learnerUserId: buyer.id, salonId: null, employeeId: null };
  } else {
    if (buyer.role !== "SALON_OWNER" || !parsed.data.salonId || !parsed.data.employeeId) { res.status(403).json({ error: "Samo vlasnik salona može izabrati zaposlenog." }); return; }
    const [employee] = await db.select({ id: employeesTable.id, userId: employeesTable.userId }).from(employeesTable).innerJoin(salonsTable, eq(salonsTable.id, employeesTable.salonId))
      .where(and(eq(employeesTable.id, parsed.data.employeeId), eq(employeesTable.salonId, parsed.data.salonId), eq(employeesTable.active, true), eq(salonsTable.ownerId, buyer.id))).limit(1);
    if (!employee) { res.status(403).json({ error: "Zaposleni ne pripada vašem salonu." }); return; }
    if (!employee.userId) { res.status(409).json({ error: "Zaposleni mora imati povezan korisnički nalog za pristup kursevima." }); return; }
    target = { learnerUserId: employee.userId, salonId: parsed.data.salonId, employeeId: parsed.data.employeeId };
  }
  const settings = await getEducationPlatformSettings();
  const reference = `BND-${bundle.id.replace(/-/g, "").slice(0, 18)}`;
  let instructions: Record<string, unknown> = { reference, pending: true };
  if (settings) try { instructions = { ...instructions, ...educationIpsQrPayload({ recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount, purpose: settings.ipsPurpose, amount: bundle.price, reference }) }; } catch { /* settings may intentionally be incomplete */ }
  try {
    const created = await db.transaction(async tx => {
      const [purchase] = await tx.insert(educationBundlePurchasesTable).values({ bundleId: bundle.id, centerId: bundle.centerId, purchaserId: buyer.id, targetType: parsed.data.targetType, ...target, amount: bundle.price, idempotencyKey: key, idempotencyFingerprint: fp, paymentInstructions: instructions, auditData: { bundleTitle: bundle.title } }).returning();
      await tx.insert(educationBundlePurchaseItemsTable).values(bundleCourses.map((course, sortOrder) => ({ purchaseId: purchase.id, courseId: course.id, courseTitle: course.title, courseTerms: { duration: course.duration, format: course.format }, sortOrder })));
      return purchase;
    });
    res.status(201).json(view(created, true));
  } catch { res.status(409).json({ error: "Kupovina je već evidentirana." }); }
});
router.get("/education/bundle-purchases", async (req, res) => {
  const buyer = await user(req, res); if (!buyer) return;
  res.json((await db.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.purchaserId, buyer.id)).orderBy(desc(educationBundlePurchasesTable.requestedAt))).map(row => view(row, true)));
});
router.get("/education/bundle-purchases/eligible-employees", async (req, res) => {
  const buyer = await user(req, res); if (!buyer) return;
  if (buyer.role !== "SALON_OWNER") { res.json([]); return; }
  const rows = await db.select({ id: employeesTable.id, name: employeesTable.name, salonId: employeesTable.salonId })
    .from(employeesTable).innerJoin(salonsTable, eq(salonsTable.id, employeesTable.salonId))
    .where(and(eq(salonsTable.ownerId, buyer.id), eq(employeesTable.active, true), isNotNull(employeesTable.userId)));
  res.json(rows);
});
router.get("/education/centers/:centerId/bundle-purchases", async (req, res) => {
  const actor = await user(req, res); if (!actor) return;
  if (!isAdmin(actor) && !await canManageCenter(actor.id, req.params.centerId)) { res.status(403).json({ error: "Nemate pristup kupovinama centra." }); return; }
  const purchases = await db.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.centerId, req.params.centerId)).orderBy(desc(educationBundlePurchasesTable.requestedAt));
  const employeeIds = purchases.flatMap(purchase => purchase.employeeId ? [purchase.employeeId] : []);
  const learnerIds = purchases.flatMap(purchase => purchase.learnerUserId ? [purchase.learnerUserId] : []);
  const [employeeRows, learnerRows] = await Promise.all([
    employeeIds.length ? db.select({ id: employeesTable.id, name: employeesTable.name }).from(employeesTable).where(inArray(employeesTable.id, employeeIds)) : [],
    learnerIds.length ? db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(inArray(usersTable.id, learnerIds)) : [],
  ]);
  const employees: Array<{ id: string; name: string }> = employeeRows as Array<{ id: string; name: string }>;
  const learners: Array<{ id: string; firstName: string; lastName: string }> = learnerRows as Array<{ id: string; firstName: string; lastName: string }>;
  res.json(purchases.map(purchase => ({ id: purchase.id, bundleId: purchase.bundleId, participantName: purchase.employeeId ? employees.find(employee => employee.id === purchase.employeeId)?.name ?? null : (() => { const learner = learners.find(item => item.id === purchase.learnerUserId); return learner ? `${learner.firstName} ${learner.lastName}`.trim() : null; })(), targetType: purchase.targetType, status: purchase.status, amount: purchase.amount, requestedAt: purchase.requestedAt, settledAt: purchase.settledAt })));
});
router.get("/admin/education/bundle-purchases/pending", async (req, res) => {
  const actor = await user(req, res); if (!actor || !isAdmin(actor)) { if (actor) res.status(403).json({ error: "Samo administrator." }); return; }
  res.json((await db.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.status, "pending_payment")).orderBy(desc(educationBundlePurchasesTable.requestedAt))).map(row => view(row)));
});
router.post("/admin/education/bundle-purchases/:purchaseId/settle", async (req, res) => {
  const admin = await user(req, res); if (!admin || !isAdmin(admin)) { if (admin) res.status(403).json({ error: "Samo administrator." }); return; }
  try {
    const result = await db.transaction(async tx => {
      const [purchase] = await tx.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.id, req.params.purchaseId)).for("update").limit(1);
      if (!purchase) throw new Error("NOT_FOUND");
      if (purchase.status === "settled") return purchase;
      if (purchase.status !== "pending_payment") throw new Error("NOT_PENDING");
       await lockEducationBillingRules(tx, "shared");
       await lockEducationCenterFinancials(tx, purchase.centerId);
       await tx.select({ id: educationCentersTable.id }).from(educationCentersTable).where(eq(educationCentersTable.id, purchase.centerId)).for("update");
       const settings = await resolveEducationBillingSettingsForChargeInTx(purchase.centerId, tx);
       if (settings.effective.commissionPercent + settings.effective.reservePercent > 100) throw new Error("INVALID_FINANCE_SETTINGS");
       const fee = Math.floor(purchase.amount * settings.effective.commissionPercent / 100);
       const reserve = Math.floor(purchase.amount * settings.effective.reservePercent / 100);
      const [escrow] = await tx.insert(educationBundlePurchaseEscrowsTable).values({ purchaseId: purchase.id, centerId: purchase.centerId, grossAmount: purchase.amount, platformFeeAmount: fee, reserveAmount: reserve, netAmount: purchase.amount - fee - reserve }).returning();
      await tx.insert(educationBundlePurchaseLedgerEntriesTable).values([{ escrowId: escrow.id, entryType: "charge", amount: purchase.amount }, { escrowId: escrow.id, entryType: "platform_fee", amount: fee }, { escrowId: escrow.id, entryType: "reserve_hold", amount: reserve }]);
      const items = await tx.select().from(educationBundlePurchaseItemsTable).where(eq(educationBundlePurchaseItemsTable.purchaseId, purchase.id));
      let participantUserId = purchase.learnerUserId;
      if (purchase.employeeId) {
        const [employee] = await tx.select({ userId: employeesTable.userId }).from(employeesTable)
          .where(and(eq(employeesTable.id, purchase.employeeId), eq(employeesTable.active, true))).limit(1);
        if (!employee?.userId || employee.userId !== purchase.learnerUserId) throw new Error("EMPLOYEE_IDENTITY_CHANGED");
      }
      if (!participantUserId) throw new Error("PARTICIPANT_REQUIRED");
      await tx.insert(courseEnrollmentsTable).values(items.map(item => ({ courseId: item.courseId, purchaserId: purchase.purchaserId, userId: participantUserId, salonId: purchase.salonId, employeeId: purchase.employeeId, bundlePurchaseId: purchase.id, status: "active" as const, paymentStatus: "paid" as const, chargedAmount: null, accessGrantedAt: new Date(), auditData: { bundlePurchaseId: purchase.id, terms: item.courseTerms } })));
      const [settled] = await tx.update(educationBundlePurchasesTable).set({ status: "settled", settledAt: new Date(), settledByUserId: admin.id, updatedAt: new Date() }).where(eq(educationBundlePurchasesTable.id, purchase.id)).returning();
      return settled;
    });
    res.json(view(result));
  } catch (error) { const message = error instanceof Error ? error.message : "SETTLEMENT_FAILED"; res.status(message === "NOT_FOUND" ? 404 : 409).json({ error: message }); }
});
export default router;