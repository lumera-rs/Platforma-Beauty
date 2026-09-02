import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { z } from "zod";
import {
  courseEnrollmentsTable, coursesTable, db, educationBundlePurchaseEscrowsTable,
  educationBundlePurchaseItemsTable, educationBundlePurchaseLedgerEntriesTable,
  educationBundlePurchasesTable, educationBundleCoursesTable, educationBundlesTable,
  educationCentersTable, educationCenterSubscriptionsTable, educationPaymentObligationsTable, employeesTable, salonsTable,
  usersTable,
} from "@workspace/db";
import { getCurrentUser, isAdmin } from "../lib/auth";
import {
  getEducationPlatformSettings,
  lockEducationBillingRules,
  lockEducationCenterFinancials,
  resolveEducationBillingSettingsForChargeInTx,
} from "../lib/education-billing";
import { educationIpsQrPayload, educationIpsRuntimeEnvironment } from "../lib/education-marketplace-domain";
import { assertOnlineEnrollmentRequest, DIGITAL_CONTENT_CONSENT_TEXT, DIGITAL_CONTENT_CONSENT_VERSION, issueOnlineEnrollmentFields } from "../lib/education-entitlement";
import { eligibleEducationCenterSql, hasActiveEducationSubscription } from "../lib/education-center-eligibility";
import { writeEducationFinancialAuditInTx } from "../lib/education-financial-audit";

const router: IRouter = Router();
const purchaseBody = z.object({
  targetType: z.enum(["individual", "salon_employee"]),
  learnerUserId: z.string().uuid().optional(),
  salonId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  digitalContentConsent: z.boolean().optional(),
});
const fingerprint = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex");
type BundleCourseTerms = {
  duration: string; format: "online" | "in-person" | "hybrid"; coursePrice: number;
  onlineAccessDays: number | null; extensionPrice1Month: number | null;
  extensionPrice3Months: number | null; extensionPrice6Months: number | null;
  digitalContentConsent: null | { acceptedAt: string; userId: string; text: string; version: string };
};
function bundleTerms(value: unknown): BundleCourseTerms {
  const terms = value as Partial<BundleCourseTerms>;
  if (!terms || !["online", "in-person", "hybrid"].includes(terms.format ?? "") || typeof terms.duration !== "string"
    || typeof terms.coursePrice !== "number") throw new Error("ITEM_TERMS_MISSING");
  if (terms.format === "online" && (!Number.isInteger(terms.onlineAccessDays) || terms.onlineAccessDays! < 1
    || terms.extensionPrice1Month == null || terms.extensionPrice1Month <= 0
    || terms.extensionPrice3Months == null || terms.extensionPrice3Months <= 0
    || terms.extensionPrice6Months == null || terms.extensionPrice6Months <= 0
    || !terms.digitalContentConsent || typeof terms.digitalContentConsent.acceptedAt !== "string"
    || typeof terms.digitalContentConsent.userId !== "string" || typeof terms.digitalContentConsent.text !== "string"
    || typeof terms.digitalContentConsent.version !== "string")) throw new Error("ITEM_TERMS_MISSING");
  return terms as BundleCourseTerms;
}
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

function paymentSlipPdf(fields: {
  title: string; amount: number; recipientName: string; recipientAccount: string;
  reference: string; purpose: string; paymentCode: string;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 52, compress: false, info: { Title: fields.title } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.fontSize(20).text(fields.title);
    document.moveDown(0.5).fontSize(10).fillColor("#555").text("Instrukcije za plaćanje putem IPS / bank transfera");
    document.moveDown(1.5).fillColor("#111").fontSize(12);
    const rows = [
      ["Primalac", fields.recipientName],
      ["Račun primaoca", fields.recipientAccount],
      ["Iznos", `${fields.amount.toLocaleString("sr-RS")} RSD`],
      ["Šifra plaćanja", fields.paymentCode],
      ["Poziv na broj", fields.reference],
      ["Svrha uplate", fields.purpose],
    ];
    for (const [label, value] of rows) {
      document.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(value);
      document.moveDown(0.35);
    }
    document.moveDown(2).fontSize(10).fillColor("#555")
      .text("Ovaj dokument je uplatnica sa instrukcijama za plaćanje i nije SEF e-faktura.");
    document.end();
  });
}

router.get("/education/payment-slips/:type/:id", async (req, res) => {
  const actor = await user(req, res); if (!actor) return;
  if (req.params.type === "bundle") {
    const [purchase] = await db.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.id, req.params.id)).limit(1);
    if (!purchase || (!isAdmin(actor) && purchase.purchaserId !== actor.id)) { res.status(404).json({ error: "Kupovina nije pronađena." }); return; }
    const instructions = purchase.paymentInstructions as Record<string, unknown> | null;
    if (!instructions || typeof instructions.recipientName !== "string" || typeof instructions.recipientAccount !== "string"
      || typeof instructions.reference !== "string" || typeof instructions.purpose !== "string"
      || typeof instructions.paymentCode !== "string") { res.status(409).json({ error: "Sačuvane instrukcije za plaćanje nisu dostupne." }); return; }
    const pdf = await paymentSlipPdf({
      title: "Uplatnica za paket edukacija", amount: purchase.amount,
      recipientName: instructions.recipientName, recipientAccount: instructions.recipientAccount,
      reference: instructions.reference, purpose: instructions.purpose, paymentCode: instructions.paymentCode,
    });
    res.type("application/pdf").setHeader("Content-Disposition", `attachment; filename="uplatnica-paket-${purchase.id}.pdf"`).send(pdf);
    return;
  }
  if (req.params.type !== "obligation") { res.status(404).json({ error: "Uplatnica nije pronađena." }); return; }
  const [obligation] = await db.select().from(educationPaymentObligationsTable).where(eq(educationPaymentObligationsTable.id, req.params.id)).limit(1);
  if (!obligation) { res.status(404).json({ error: "Obaveza nije pronađena." }); return; }
  const [enrollment] = obligation.enrollmentId
    ? await db.select({ purchaserId: courseEnrollmentsTable.purchaserId }).from(courseEnrollmentsTable).where(eq(courseEnrollmentsTable.id, obligation.enrollmentId)).limit(1)
    : [];
  const [center] = obligation.centerId
    ? await db.select({ ownerId: educationCentersTable.ownerId }).from(educationCentersTable).where(eq(educationCentersTable.id, obligation.centerId)).limit(1)
    : [];
  const [salon] = obligation.salonId
    ? await db.select({ ownerId: salonsTable.ownerId }).from(salonsTable).where(eq(salonsTable.id, obligation.salonId)).limit(1)
    : [];
  if (!isAdmin(actor) && enrollment?.purchaserId !== actor.id && center?.ownerId !== actor.id && salon?.ownerId !== actor.id) {
    res.status(404).json({ error: "Obaveza nije pronađena." }); return;
  }
  const pdf = await paymentSlipPdf({
    title: "Uplatnica za Education obavezu", amount: obligation.expectedAmount,
    recipientName: obligation.recipientNameSnapshot, recipientAccount: obligation.recipientAccountSnapshot,
    reference: obligation.referenceSnapshot, purpose: obligation.purposeSnapshot, paymentCode: obligation.paymentCodeSnapshot,
  });
  res.type("application/pdf").setHeader("Content-Disposition", `attachment; filename="uplatnica-${obligation.id}.pdf"`).send(pdf);
});

// Public catalog deliberately exposes only currently purchasable packages.
router.get("/education/bundles", async (_req, res) => {
  const rows = await db.select({ bundle: educationBundlesTable, centerName: educationCentersTable.name })
    .from(educationBundlesTable).innerJoin(educationCentersTable, eq(educationCentersTable.id, educationBundlesTable.centerId))
    .where(and(eq(educationBundlesTable.active, true), eq(educationBundlesTable.published, true),
      eligibleEducationCenterSql(educationBundlesTable.centerId)));
  const ids = rows.map(r => r.bundle.id);
  const links = ids.length ? await db.select({ bundleId: educationBundleCoursesTable.bundleId }).from(educationBundleCoursesTable).where(inArray(educationBundleCoursesTable.bundleId, ids)) : [];
  const items = ids.length ? await db.select({ bundleId: educationBundleCoursesTable.bundleId, courseId: coursesTable.id, title: coursesTable.title, courseCenterId: coursesTable.centerId })
    .from(educationBundleCoursesTable).innerJoin(coursesTable, eq(coursesTable.id, educationBundleCoursesTable.courseId)).where(and(inArray(educationBundleCoursesTable.bundleId, ids), eq(coursesTable.published, true), eq(coursesTable.archived, false))) : [];
  res.json(rows.filter(r => { const all = links.filter(link => link.bundleId === r.bundle.id).length; return all > 0 && all === items.filter(item => item.bundleId === r.bundle.id && item.courseCenterId === r.bundle.centerId).length; }).map(r => ({ ...r.bundle, name: r.bundle.title, centerName: r.centerName, courses: items.filter(i => i.bundleId === r.bundle.id && i.courseCenterId === r.bundle.centerId).map(({ courseCenterId: _courseCenterId, ...item }) => item) })));
});
router.get("/education/bundles/:bundleId", async (req, res) => {
  const [bundle] = await db.select().from(educationBundlesTable).where(and(eq(educationBundlesTable.id, req.params.bundleId),
    eq(educationBundlesTable.active, true), eq(educationBundlesTable.published, true),
    eligibleEducationCenterSql(educationBundlesTable.centerId))).limit(1);
  if (!bundle) { res.status(404).json({ error: "Paket nije pronađen." }); return; }
  const courses = await db.select({
    courseId: coursesTable.id,
    title: coursesTable.title,
    description: coursesTable.description,
    duration: coursesTable.duration,
    format: coursesTable.format,
  })
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
  const [bundle] = await db.select().from(educationBundlesTable).where(and(eq(educationBundlesTable.id, req.params.bundleId),
    eq(educationBundlesTable.active, true), eq(educationBundlesTable.published, true),
    eligibleEducationCenterSql(educationBundlesTable.centerId))).limit(1);
  if (!bundle) { res.status(404).json({ error: "Paket nije dostupan." }); return; }
  const bundleCourses = await db.select({ id: coursesTable.id, title: coursesTable.title, duration: coursesTable.duration, format: coursesTable.format,
    price: coursesTable.price, onlineAccessDays: coursesTable.onlineAccessDays, extensionPrice1Month: coursesTable.extensionPrice1Month,
    extensionPrice3Months: coursesTable.extensionPrice3Months, extensionPrice6Months: coursesTable.extensionPrice6Months })
    .from(educationBundleCoursesTable).innerJoin(coursesTable, eq(coursesTable.id, educationBundleCoursesTable.courseId)).where(and(eq(educationBundleCoursesTable.bundleId, bundle.id), eq(coursesTable.centerId, bundle.centerId), eq(coursesTable.published, true), eq(coursesTable.archived, false)));
  const links = await db.select({ courseId: educationBundleCoursesTable.courseId }).from(educationBundleCoursesTable).where(eq(educationBundleCoursesTable.bundleId, bundle.id));
  if (!bundleCourses.length || bundleCourses.length !== links.length) { res.status(409).json({ error: "Paket nema dosledan skup aktivnih kurseva." }); return; }
  if (bundleCourses.some(course => course.format === "online") && parsed.data.digitalContentConsent !== true) {
    res.status(400).json({ error: "Za kupovinu paketa sa online kursom potrebna je izričita saglasnost za početak digitalnog sadržaja." }); return;
  }
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
  const purchaseId = randomUUID();
  const reference = `BND-${purchaseId.replace(/-/g, "").slice(0, 30)}`;
  try {
    const created = await db.transaction(async tx => {
       // Serialize checkout with center suspension and subscription changes.
       // The locked rows are the source of truth; public prechecks alone cannot
       // authorize creation because eligibility may change while checking out.
       await lockEducationCenterFinancials(tx, bundle.centerId);
       const [lockedCenter] = await tx.select().from(educationCentersTable)
         .where(eq(educationCentersTable.id, bundle.centerId)).for("update").limit(1);
       const [lockedSubscription] = await tx.select({
         subscription: educationCenterSubscriptionsTable,
         databaseNow: sql<string>`current_timestamp`,
       }).from(educationCenterSubscriptionsTable)
         .where(eq(educationCenterSubscriptionsTable.centerId, bundle.centerId)).for("update").limit(1);
       if (lockedCenter?.verificationStatus !== "verified" || !lockedSubscription
         || !hasActiveEducationSubscription(lockedSubscription.subscription, new Date(lockedSubscription.databaseNow))) {
         throw new Error("CENTER_INELIGIBLE");
       }
        const [lockedBundle] = await tx.select().from(educationBundlesTable)
          .where(eq(educationBundlesTable.id, bundle.id)).for("update").limit(1);
        if (!lockedBundle || lockedBundle.centerId !== bundle.centerId || !lockedBundle.active || !lockedBundle.published) {
          throw new Error("BUNDLE_UNAVAILABLE");
        }
        const lockedLinks = await tx.select().from(educationBundleCoursesTable)
          .where(eq(educationBundleCoursesTable.bundleId, lockedBundle.id)).for("update");
        const lockedCourses = lockedLinks.length
          ? await tx.select().from(coursesTable)
            .where(inArray(coursesTable.id, lockedLinks.map(link => link.courseId))).for("update")
          : [];
        const courseById = new Map(lockedCourses.map(course => [course.id, course]));
        const exactCourses = lockedLinks
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(link => courseById.get(link.courseId))
          .filter((course): course is typeof coursesTable.$inferSelect => Boolean(course));
        if (!exactCourses.length || exactCourses.length !== lockedLinks.length
          || exactCourses.some(course => course.centerId !== lockedBundle.centerId
          || !course.published || course.archived)) {
          throw new Error("BUNDLE_UNAVAILABLE");
        }
        for (const course of exactCourses) {
          assertOnlineEnrollmentRequest(course, parsed.data.digitalContentConsent);
        }
        const instructions = educationIpsQrPayload({
          recipientName: settings.ipsRecipientName, recipientAccount: settings.ipsRecipientAccount,
          purpose: settings.ipsPurpose, amount: lockedBundle.price, reference,
          recipientType: "platform", transactionType: "bundle_purchase",
          accountEnvironment: settings.ipsAccountEnvironment as "production" | "test",
          runtimeEnvironment: educationIpsRuntimeEnvironment(),
        });
       const consentAt = new Date();
        const hasOnlineCourse = exactCourses.some(course => course.format === "online");
        const [purchase] = await tx.insert(educationBundlePurchasesTable).values({ id: purchaseId, bundleId: lockedBundle.id, centerId: lockedBundle.centerId, purchaserId: buyer.id, targetType: parsed.data.targetType, ...target, amount: lockedBundle.price, paymentReference: reference, idempotencyKey: key, idempotencyFingerprint: fp, paymentInstructions: instructions, auditData: { bundleTitle: lockedBundle.title, digitalContentConsent: hasOnlineCourse ? { acceptedAt: consentAt.toISOString(), userId: buyer.id, text: DIGITAL_CONTENT_CONSENT_TEXT, version: DIGITAL_CONTENT_CONSENT_VERSION } : null } }).returning();
       await tx.insert(educationBundlePurchaseItemsTable).values(exactCourses.map((course, sortOrder) => ({
        purchaseId: purchase.id, courseId: course.id, courseTitle: course.title,
        courseTerms: {
          duration: course.duration, format: course.format, coursePrice: course.price,
          onlineAccessDays: course.onlineAccessDays, extensionPrice1Month: course.extensionPrice1Month,
          extensionPrice3Months: course.extensionPrice3Months, extensionPrice6Months: course.extensionPrice6Months,
          digitalContentConsent: course.format === "online" ? { acceptedAt: consentAt.toISOString(), userId: buyer.id, text: DIGITAL_CONTENT_CONSENT_TEXT, version: DIGITAL_CONTENT_CONSENT_VERSION } : null,
        }, sortOrder })));
      return purchase;
    });
    res.status(201).json(view(created, true));
  } catch (error) {
    if (error instanceof Error && error.message === "CENTER_INELIGIBLE") {
      res.status(409).json({ error: "Paket više nije dostupan za kupovinu." }); return;
    }
    if (error instanceof Error && error.message === "ONLINE_CONTENT_CONSENT_REQUIRED") {
      res.status(409).json({ error: "Za kupovinu paketa sa online kursom potrebna je izričita saglasnost za početak digitalnog sadržaja." }); return;
    }
    if (error instanceof Error && error.message === "ONLINE_ACCESS_POLICY_MISSING") {
      res.status(409).json({ error: "Online kurs u paketu nema kompletno podešene uslove pristupa." }); return;
    }
    if (error instanceof Error && error.message === "BUNDLE_UNAVAILABLE") {
      res.status(409).json({ error: "Paket više nije dostupan za kupovinu." }); return;
    }
    if (error instanceof Error && error.message.startsWith("IPS_PAYMENT_")) {
      res.status(409).json({ error: "Instrukcije za IPS uplatu trenutno nisu podešene." }); return;
    }
    res.status(409).json({ error: "Kupovina je već evidentirana." });
  }
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
  const admin = await user(req, res);
  if (!admin) return;
  if (admin.role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Ova promena je dozvoljena samo super administratorima." });
    return;
  }
  try {
    const result = await db.transaction(async tx => {
      const [purchase] = await tx.select().from(educationBundlePurchasesTable).where(eq(educationBundlePurchasesTable.id, req.params.purchaseId)).for("update").limit(1);
      if (!purchase) throw new Error("NOT_FOUND");
      if (purchase.status === "settled") return purchase;
      if (purchase.status !== "pending_payment") throw new Error("NOT_PENDING");
       await lockEducationBillingRules(tx, "shared");
       await lockEducationCenterFinancials(tx, purchase.centerId);
       await tx.select({ id: educationCentersTable.id }).from(educationCentersTable).where(eq(educationCentersTable.id, purchase.centerId)).for("update");
      const items = await tx.select().from(educationBundlePurchaseItemsTable).where(eq(educationBundlePurchaseItemsTable.purchaseId, purchase.id));
      let participantUserId = purchase.learnerUserId;
      if (purchase.employeeId) {
        const [employee] = await tx.select({ userId: employeesTable.userId }).from(employeesTable)
          .where(and(eq(employeesTable.id, purchase.employeeId), eq(employeesTable.active, true))).limit(1);
        if (!employee?.userId || employee.userId !== purchase.learnerUserId) throw new Error("EMPLOYEE_IDENTITY_CHANGED");
      }
      if (!participantUserId) throw new Error("PARTICIPANT_REQUIRED");
      const courses = await tx.select({ id: coursesTable.id }).from(coursesTable).where(inArray(coursesTable.id, items.map(item => item.courseId))).for("update");
      const existingCourseIds = new Set(courses.map(course => course.id));
      const validatedItems = items.map(item => {
        if (!existingCourseIds.has(item.courseId)) throw new Error("COURSE_MISSING");
        const terms = bundleTerms(item.courseTerms);
        if (terms.format === "online" && terms.digitalContentConsent?.userId !== purchase.purchaserId) {
          throw new Error("ITEM_TERMS_MISSING");
        }
        return { item, terms };
      });
      const settings = await resolveEducationBillingSettingsForChargeInTx(purchase.centerId, tx);
      if (settings.effective.commissionPercent + settings.effective.reservePercent > 100) throw new Error("INVALID_FINANCE_SETTINGS");
      const fee = Math.floor(purchase.amount * settings.effective.commissionPercent / 100);
      const reserve = Math.floor(purchase.amount * settings.effective.reservePercent / 100);
      const [escrow] = await tx.insert(educationBundlePurchaseEscrowsTable).values({ purchaseId: purchase.id, centerId: purchase.centerId, grossAmount: purchase.amount, platformFeeAmount: fee, reserveAmount: reserve, netAmount: purchase.amount - fee - reserve }).returning();
      await tx.insert(educationBundlePurchaseLedgerEntriesTable).values([{ escrowId: escrow.id, entryType: "charge", amount: purchase.amount }, { escrowId: escrow.id, entryType: "platform_fee", amount: fee }, { escrowId: escrow.id, entryType: "reserve_hold", amount: reserve }]);
      const accessGrantedAt = new Date();
      await tx.insert(courseEnrollmentsTable).values(validatedItems.map(({ item, terms }) => {
        return {
          courseId: item.courseId, purchaserId: purchase.purchaserId, userId: participantUserId, salonId: purchase.salonId, employeeId: purchase.employeeId,
          bundlePurchaseId: purchase.id, status: "active" as const, paymentStatus: "paid" as const, chargedAmount: null, accessGrantedAt,
          ...(terms.format === "online" ? issueOnlineEnrollmentFields({
            price: terms.coursePrice, duration: terms.duration, onlineAccessDays: terms.onlineAccessDays,
            extensionPrice1Month: terms.extensionPrice1Month, extensionPrice3Months: terms.extensionPrice3Months,
            extensionPrice6Months: terms.extensionPrice6Months,
          }, {
            userId: terms.digitalContentConsent!.userId, acceptedAt: new Date(terms.digitalContentConsent!.acceptedAt),
            textSnapshot: terms.digitalContentConsent!.text, versionSnapshot: terms.digitalContentConsent!.version,
          }, accessGrantedAt) : {}),
          auditData: { bundlePurchaseId: purchase.id, terms },
        };
      }));
      const [settled] = await tx.update(educationBundlePurchasesTable).set({ status: "settled", settledAt: new Date(), settledByUserId: admin.id, updatedAt: new Date() }).where(eq(educationBundlePurchasesTable.id, purchase.id)).returning();
       await writeEducationFinancialAuditInTx(tx, {
         actorUserId: admin.id,
         action: "education_bundle_purchase_settled",
         entityType: "education_bundle_purchase",
         entityId: purchase.id,
         oldValue: { status: purchase.status, amount: purchase.amount, centerId: purchase.centerId },
         newValue: {
           status: settled.status,
           amount: settled.amount,
           centerId: settled.centerId,
           escrow: {
             grossAmount: escrow.grossAmount,
             platformFeeAmount: escrow.platformFeeAmount,
             reserveAmount: escrow.reserveAmount,
             netAmount: escrow.netAmount,
           },
         },
       });
      return settled;
    });
    res.json(view(result));
  } catch (error) { const message = error instanceof Error ? error.message : "SETTLEMENT_FAILED"; res.status(message === "NOT_FOUND" ? 404 : 409).json({ error: message }); }
});
export default router;