import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  coursesTable, db, educationB2bDiscountAuditsTable, educationB2bDiscountSettingsTable,
  educationB2bDiscountTiersTable, educationB2bOrderItemsTable, educationB2bOrdersTable,
  educationCenterStaffTable, educationCentersTable, educationFinancialAuditLogTable,
  productsTable,
} from "@workspace/db";
import {
  AdminGetEducationB2bDiscountTiersResponse, AdminReplaceEducationB2bDiscountTiersBody,
  AdminReplaceEducationB2bDiscountTiersResponse, CheckoutEducationB2bOrderBody,
  CheckoutEducationB2bOrderResponse, GetEducationB2bBenefitResponse,
  QuoteEducationB2bOrderBody, QuoteEducationB2bOrderResponse,
} from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { educationBelgradeInstant } from "../lib/education-availability-store";

const router: IRouter = Router();

export function previousBelgradeCalendarMonth(now: Date) {
  // Product rule: the benefit for the whole current month is based on the
  // immediately preceding Europe/Belgrade calendar month. This is deliberately
  // not a trailing or rolling 30-day window, so a center's tier stays stable
  // throughout the current calendar month.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const current = `${year}-${String(month).padStart(2, "0")}-01`;
  const previousDate = new Date(Date.UTC(year, month - 2, 1));
  const previous = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return {
    start: educationBelgradeInstant(previous, "00:00"),
    end: educationBelgradeInstant(current, "00:00"),
  };
}

async function centerAccess(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return null; }
  if (user.role !== "EDUKATIVNI_CENTAR") {
    res.status(403).json({ error: "Ova pogodnost je dostupna samo edukativnim centrima." }); return null;
  }
  const [owned] = await db.select().from(educationCentersTable).where(eq(educationCentersTable.ownerId, user.id)).limit(1);
  if (owned) return { user, center: owned };
  const [staff] = await db.select({ center: educationCentersTable }).from(educationCenterStaffTable)
    .innerJoin(educationCentersTable, eq(educationCentersTable.id, educationCenterStaffTable.centerId))
    .where(and(eq(educationCenterStaffTable.userId, user.id), eq(educationCenterStaffTable.active, true),
      inArray(educationCenterStaffTable.role, ["owner_admin", "manager_reception"]))).limit(1);
  if (!staff) { res.status(403).json({ error: "Nemate pravo upravljanja B2B kupovinom centra." }); return null; }
  return { user, center: staff.center };
}

async function benefit(centerId: string, now = new Date(), store: any = db) {
  const period = previousBelgradeCalendarMonth(now);
  const [settings] = await store.select().from(educationB2bDiscountSettingsTable)
    .where(eq(educationB2bDiscountSettingsTable.id, true)).for("share").limit(1);
  const tiers = await store.select().from(educationB2bDiscountTiersTable)
    .orderBy(asc(educationB2bDiscountTiersTable.minSpendRsd), asc(educationB2bDiscountTiersTable.sortOrder));
  const completedOrders = await store.select({
    amount: sql<number>`coalesce(sum(greatest(${educationB2bOrdersTable.totalRsd} - ${educationB2bOrdersTable.refundedAmountRsd}, 0)), 0)::int`,
  }).from(educationB2bOrdersTable)
    .where(and(
      eq(educationB2bOrdersTable.centerId, centerId),
      eq(educationB2bOrdersTable.paymentStatus, "paid"),
      eq(educationB2bOrdersTable.fulfillmentStatus, "COMPLETED"),
      gte(educationB2bOrdersTable.completedAt, period.start),
      lt(educationB2bOrdersTable.completedAt, period.end),
    ));
  const spend = Number(completedOrders[0]?.amount ?? 0);
  const tier = selectEducationB2bTier(
    tiers as Array<typeof educationB2bDiscountTiersTable.$inferSelect>, spend,
  );
  const next = tiers.find((row: any) => row.minSpendRsd > spend) ?? null;
  return {
    periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(),
    priorMonthSpendRsd: spend, discountPercent: tier?.discountPercent ?? 0,
    discountReason: tier ? `Automatski nivo „${tier.name}” prema neto plaćenim i završenim B2B porudžbinama prethodnog meseca.` : "Prethodni mesec ne pripada nijednom podešenom nivou.",
    amountToNextTierRsd: next ? next.minSpendRsd - spend : null,
    tierId: tier?.id ?? null, settingsVersion: settings?.version ?? 1,
  };
}

export function selectEducationB2bTier<T extends {
  minSpendRsd: number; maxSpendRsd: number | null;
  id: string; name: string; discountPercent: number;
}>(
  tiers: readonly T[], spendRsd: number,
) {
  return [...tiers].sort((a, b) => b.minSpendRsd - a.minSpendRsd)
    .find((row) => spendRsd >= row.minSpendRsd && (row.maxSpendRsd == null || spendRsd <= row.maxSpendRsd)) ?? null;
}

async function quote(centerId: string, input: { lines: Array<{ productId: string; quantity: number }> }, store: any = db) {
  if (new Set(input.lines.map((line) => line.productId)).size !== input.lines.length) throw new Error("DUPLICATE");
  const products = await store.select().from(productsTable).where(and(
    inArray(productsTable.id, input.lines.map((line) => line.productId)),
    eq(productsTable.active, true), eq(productsTable.professionalEnabled, true),
  ));
  if (products.length !== input.lines.length) throw new Error("PRODUCT");
  const map = new Map(products.map((product: any) => [product.id, product]));
  const lines = input.lines.map((line) => {
    const product: any = map.get(line.productId);
    const unitPriceRsd = product.price;
    return { productId: product.id, name: product.name, quantity: line.quantity, unitPriceRsd, lineSubtotalRsd: unitPriceRsd * line.quantity };
  });
  const subtotalRsd = lines.reduce((sum, line) => sum + line.lineSubtotalRsd, 0);
  const selected = await benefit(centerId, new Date(), store);
  const educationCenterDiscountRsd = Math.floor(subtotalRsd * selected.discountPercent / 100);
  return { lines, subtotalRsd, educationCenterDiscountRsd, payableTotalRsd: subtotalRsd - educationCenterDiscountRsd, benefit: selected };
}

router.get("/education/b2b/benefit", async (req, res) => {
  const access = await centerAccess(req, res); if (!access) return;
  res.json(GetEducationB2bBenefitResponse.parse(
    await db.transaction((tx) => benefit(access.center.id, new Date(), tx)),
  ));
});

router.get("/education/b2b/products", async (req, res) => {
  const access = await centerAccess(req, res); if (!access) return;
  const products = await db.select({
    id: productsTable.id, name: productsTable.name, description: productsTable.description,
    priceRsd: productsTable.price, stock: productsTable.stock,
  }).from(productsTable).where(and(eq(productsTable.active, true), eq(productsTable.professionalEnabled, true)))
    .orderBy(asc(productsTable.name));
  res.json({ products });
});

router.post("/education/b2b/quote", async (req, res) => {
  const access = await centerAccess(req, res); if (!access) return;
  const body = QuoteEducationB2bOrderBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Stavke porudžbine nisu ispravne." }); return; }
  try { res.json(QuoteEducationB2bOrderResponse.parse(
    await db.transaction((tx) => quote(access.center.id, body.data, tx)),
  )); }
  catch { res.status(409).json({ error: "Jedan ili više proizvoda nije dostupno za B2B kupovinu." }); }
});

router.post("/education/b2b/checkout", async (req, res) => {
  const access = await centerAccess(req, res); if (!access) return;
  const body = CheckoutEducationB2bOrderBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Podaci porudžbine nisu ispravni." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const current = await quote(access.center.id, body.data, tx);
      if (current.payableTotalRsd !== body.data.expectedTotalRsd) throw new Error("QUOTE");
      for (const line of current.lines) {
        const [locked] = await tx.update(productsTable).set({ stock: sql`${productsTable.stock} - ${line.quantity}` })
          .where(and(eq(productsTable.id, line.productId), gte(productsTable.stock, line.quantity))).returning();
        if (!locked) throw new Error("STOCK");
      }
      const [order] = await tx.insert(educationB2bOrdersTable).values({
        centerId: access.center.id, purchaserUserId: access.user.id,
        linesSnapshot: current.lines.map(({ lineSubtotalRsd: _lineTotal, ...line }) => line),
        subtotalRsd: current.subtotalRsd, discountRsd: current.educationCenterDiscountRsd,
        totalRsd: current.payableTotalRsd, benefitSnapshot: current.benefit,
      }).returning();
      await tx.insert(educationB2bOrderItemsTable).values(current.lines.map((line) => ({
        orderId: order!.id, productId: line.productId, quantity: line.quantity,
        unitPriceRsd: line.unitPriceRsd, lineTotalRsd: line.lineSubtotalRsd,
      })));
      return { id: order!.id, createdAt: order!.createdAt.toISOString(), ...current };
    });
    res.status(201).json(CheckoutEducationB2bOrderResponse.parse(result));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error && error.message === "QUOTE"
      ? "Ponuda je promenjena. Osvežite obračun." : "Zalihe ili cena su promenjene. Osvežite obračun." });
  }
});

router.get("/admin/education/b2b-discount-tiers", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (user.role !== "SUPER_ADMIN") { res.status(403).json({ error: "Samo super administrator može menjati finansijska pravila." }); return; }
  const current = await db.transaction(async (tx) => {
    const settings = await tx.select().from(educationB2bDiscountSettingsTable)
      .where(eq(educationB2bDiscountSettingsTable.id, true)).for("share").limit(1);
    const tiers = await tx.select().from(educationB2bDiscountTiersTable)
      .orderBy(asc(educationB2bDiscountTiersTable.sortOrder));
    return { version: settings[0]?.version ?? 1, tiers };
  });
  res.json(AdminGetEducationB2bDiscountTiersResponse.parse(current));
});

router.put("/admin/education/b2b-discount-tiers", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (user.role !== "SUPER_ADMIN") { res.status(403).json({ error: "Samo super administrator može menjati finansijska pravila." }); return; }
  const body = AdminReplaceEducationB2bDiscountTiersBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Nivoi popusta nisu ispravni." }); return; }
  const sorted = [...body.data.tiers].sort((a, b) => a.minSpendRsd - b.minSpendRsd);
  if (new Set(sorted.map((tier) => tier.sortOrder)).size !== sorted.length
    || sorted.some((tier, index) => tier.maxSpendRsd != null && tier.maxSpendRsd < tier.minSpendRsd
      || index > 0 && (sorted[index - 1]!.maxSpendRsd == null || tier.minSpendRsd <= sorted[index - 1]!.maxSpendRsd!))) {
    res.status(400).json({ error: "Opsezi nivoa ne smeju da se preklapaju." }); return;
  }
  const updated = await db.transaction(async (tx) => {
    const [settings] = await tx.select().from(educationB2bDiscountSettingsTable)
      .where(eq(educationB2bDiscountSettingsTable.id, true)).for("update").limit(1);
    const version = settings?.version ?? 1;
    if (version !== body.data.expectedVersion) return null;
    const oldTiers = await tx.select().from(educationB2bDiscountTiersTable)
      .orderBy(asc(educationB2bDiscountTiersTable.sortOrder));
    await tx.delete(educationB2bDiscountTiersTable);
    const tiers = body.data.tiers.length ? await tx.insert(educationB2bDiscountTiersTable)
      .values(body.data.tiers.map((tier) => ({ ...tier, version: version + 1 }))).returning() : [];
    await tx.insert(educationB2bDiscountSettingsTable).values({
      id: true, version: version + 1, updatedByUserId: user.id, updatedAt: new Date(),
    }).onConflictDoUpdate({ target: educationB2bDiscountSettingsTable.id, set: {
      version: version + 1, updatedByUserId: user.id, updatedAt: new Date(),
    } });
    await tx.insert(educationB2bDiscountAuditsTable).values({
      version: version + 1, actorUserId: user.id, tiersSnapshot: body.data.tiers,
    });
    await tx.insert(educationFinancialAuditLogTable).values({
      actorUserId: user.id, action: "b2b_discount_tiers_changed",
      entityType: "education_b2b_discount_settings", entityId: "global",
      oldValue: { version, tiers: oldTiers },
      newValue: { version: version + 1, tiers: body.data.tiers },
      reason: "Promena pragova i procenata Education B2B pogodnosti.",
    });
    return { version: version + 1, tiers };
  });
  if (!updated) { res.status(409).json({ error: "Podešavanja su u međuvremenu promenjena." }); return; }
  res.json(AdminReplaceEducationB2bDiscountTiersResponse.parse(updated));
});

const orderFinanceBody = z.object({
  confirmedAmountRsd: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(1000),
});

router.post("/admin/education/b2b-orders/:orderId/settle", async (req, res) => {
  const actor = await getCurrentUser(req);
  if (!actor) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (actor.role !== "SUPER_ADMIN") { res.status(403).json({ error: "Samo super administrator može potvrditi uplatu." }); return; }
  const body = orderFinanceBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Potvrđeni iznos i razlog su obavezni." }); return; }
  try {
    const order = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(educationB2bOrdersTable)
        .where(eq(educationB2bOrdersTable.id, req.params.orderId)).for("update").limit(1);
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.paymentStatus !== "pending") throw new Error("ALREADY_RECORDED");
      if (body.data.confirmedAmountRsd !== locked.totalRsd) throw new Error("AMOUNT_MISMATCH");
      const [updated] = await tx.update(educationB2bOrdersTable).set({
        paymentStatus: "paid", settledAt: new Date(), settledByUserId: actor.id,
      }).where(and(eq(educationB2bOrdersTable.id, locked.id), eq(educationB2bOrdersTable.paymentStatus, "pending"))).returning();
      if (!updated) throw new Error("ALREADY_RECORDED");
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: actor.id, action: "education_b2b_order_settled",
        entityType: "education_b2b_order", entityId: locked.id,
        oldValue: { paymentStatus: locked.paymentStatus, expectedAmountRsd: locked.totalRsd },
        newValue: { paymentStatus: "paid", confirmedAmountRsd: body.data.confirmedAmountRsd },
        reason: body.data.reason,
      });
      return updated;
    });
    res.json(order);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    res.status(code === "NOT_FOUND" ? 404 : 409).json({ error: code === "AMOUNT_MISMATCH"
      ? "Potvrđeni iznos mora biti jednak očekivanom iznosu."
      : code === "ALREADY_RECORDED" ? "Uplata je već evidentirana." : "Porudžbina nije pronađena." });
  }
});

router.post("/admin/education/b2b-orders/:orderId/refund", async (req, res) => {
  const actor = await getCurrentUser(req);
  if (!actor) { res.status(401).json({ error: "Prijava je obavezna." }); return; }
  if (actor.role !== "SUPER_ADMIN") { res.status(403).json({ error: "Samo super administrator može evidentirati refundaciju." }); return; }
  const body = orderFinanceBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Iznos i razlog su obavezni." }); return; }
  try {
    const order = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(educationB2bOrdersTable)
        .where(eq(educationB2bOrdersTable.id, req.params.orderId)).for("update").limit(1);
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.paymentStatus !== "paid" || body.data.confirmedAmountRsd > locked.totalRsd - locked.refundedAmountRsd) throw new Error("INVALID_REFUND");
      const refundedAmountRsd = locked.refundedAmountRsd + body.data.confirmedAmountRsd;
      const [updated] = await tx.update(educationB2bOrdersTable).set({
        refundedAmountRsd,
        paymentStatus: refundedAmountRsd === locked.totalRsd ? "refunded" : "paid",
      }).where(eq(educationB2bOrdersTable.id, locked.id)).returning();
      await tx.insert(educationFinancialAuditLogTable).values({
        actorUserId: actor.id, action: "education_b2b_order_refunded",
        entityType: "education_b2b_order", entityId: locked.id,
        oldValue: { refundedAmountRsd: locked.refundedAmountRsd, paymentStatus: locked.paymentStatus },
        newValue: { refundedAmountRsd, paymentStatus: updated!.paymentStatus },
        reason: body.data.reason,
      });
      return updated;
    });
    res.json(order);
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    res.status(code === "NOT_FOUND" ? 404 : 409).json({ error: code === "INVALID_REFUND" ? "Refundacija nije dozvoljena ili iznos prelazi preostalu uplatu." : "Porudžbina nije pronađena." });
  }
});

export default router;
