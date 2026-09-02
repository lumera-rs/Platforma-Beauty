import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  automaticXyPromotionTargetsTable, automaticXyPromotionsTable, bulkSaleCampaignsTable,
  bulkSaleCampaignTargetsTable, cartThresholdRewardsTable, db, loyaltyPricingTierProductExclusionsTable,
  loyaltyPricingTiersTable, productCategoriesTable, productsTable,
  productUpsellLinksTable,
} from "@workspace/db";
import { getCurrentUser, isAdmin } from "../lib/auth";
import { effectiveLoyaltyTier } from "../lib/deo-g2-rules";
import { settledCommerceSpend } from "../lib/deo-g2-rule-loader";

const router: IRouter = Router();
type Market = "B2B" | "B2C" | "BOTH";
const markets = new Set<Market>(["B2B", "B2C", "BOTH"]);
const statuses = new Set(["DRAFT", "ACTIVE"]);

function stringParam(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function date(value: unknown, nullable = false): Date | null | undefined {
  if (value == null && nullable) return null;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
async function admin(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return null; }
  if (!isAdmin(user)) { res.status(403).json({ error: "Pristup dozvoljen samo administratorima." }); return null; }
  return user;
}
async function customer(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava je obavezna." }); return null; }
  if (user.role !== "CUSTOMER" && user.role !== "SALON_OWNER") { res.status(403).json({ error: "Nedozvoljen nalog." }); return null; }
  return user;
}
function invalid(res: Response, message: string) { res.status(400).json({ error: message }); }
function targetRows(targets: unknown, role?: "BUY" | "REWARD") {
  if (!Array.isArray(targets) || !targets.length) return null;
  const values: Array<{ productId?: string; categoryId?: string; targetRole?: "BUY" | "REWARD" }> = [];
  const seen = new Set<string>();
  for (const target of targets) {
    if (!target || typeof target !== "object") return null;
    const item = target as Record<string, unknown>;
    const productId = typeof item.productId === "string" ? item.productId : undefined;
    const categoryId = typeof item.categoryId === "string" ? item.categoryId : undefined;
    if ((productId ? 1 : 0) + (categoryId ? 1 : 0) !== 1) return null;
    const key = `${role ?? ""}:${productId ?? categoryId}`;
    if (seen.has(key)) return null;
    seen.add(key); values.push({ productId, categoryId, ...(role ? { targetRole: role } : {}) });
  }
  return values;
}
async function validateTargets(targets: Array<{ productId?: string; categoryId?: string }>) {
  const products = targets.flatMap((t) => t.productId ? [t.productId] : []);
  const categories = targets.flatMap((t) => t.categoryId ? [t.categoryId] : []);
  const [foundProducts, foundCategories] = await Promise.all([
    products.length ? db.select({ id: productsTable.id }).from(productsTable).where(inArray(productsTable.id, products)) : [],
    categories.length ? db.select({ id: productCategoriesTable.id }).from(productCategoriesTable).where(inArray(productCategoriesTable.id, categories)) : [],
  ]);
  return foundProducts.length === products.length && foundCategories.length === categories.length;
}

/** Transactional ordered merchandising links; usable by product forms as a dedicated subresource. */
router.put("/admin/products/:productId/upsells", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const productId = stringParam(req.params.productId);
  const ids = (req.body as Record<string, unknown>)?.alternativeProductIds;
  if (!productId || !Array.isArray(ids) || ids.length > 3 || ids.some((id) => typeof id !== "string")
    || new Set(ids).size !== ids.length || ids.includes(productId)) { invalid(res, "alternativeProductIds mora sadržati 0–3 različita proizvoda."); return; }
  const [source] = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  const alternatives = ids.length ? await db.select().from(productsTable).where(and(inArray(productsTable.id, ids as string[]), eq(productsTable.active, true))) : [];
  if (!source || alternatives.length !== ids.length || alternatives.some((p) =>
    (!source.retailEnabled || !p.retailEnabled) && (!source.professionalEnabled || !p.professionalEnabled))) {
    invalid(res, "Alternativni proizvodi moraju biti aktivni i dostupni na zajedničkom tržištu."); return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(productUpsellLinksTable).where(eq(productUpsellLinksTable.productId, productId));
    if (ids.length) await tx.insert(productUpsellLinksTable).values((ids as string[]).map((alternativeProductId, index) => ({ productId, alternativeProductId, sortOrder: index + 1 })));
  });
  res.json({ productId, alternativeProductIds: ids });
});

router.get("/public/products/:productId/upsells", async (req, res): Promise<void> => {
  const productId = stringParam(req.params.productId); if (!productId) { invalid(res, "Neispravan proizvod."); return; }
  const rows = await db.select({ product: productsTable, order: productUpsellLinksTable.sortOrder })
    .from(productUpsellLinksTable).innerJoin(productsTable, eq(productUpsellLinksTable.alternativeProductId, productsTable.id))
    .where(and(eq(productUpsellLinksTable.productId, productId), eq(productsTable.active, true), eq(productsTable.retailEnabled, true)))
    .orderBy(asc(productUpsellLinksTable.sortOrder));
  res.json({ items: rows.filter(({ product }) => product.publicDescription && product.publicPrice != null).map(({ product, order }) => ({
    id: product.id, name: product.name, imageUrl: product.imageUrl, price: product.priceOnRequest ? null : product.publicPrice,
    priceOnRequest: product.priceOnRequest, sortOrder: order,
  })) });
});

function tierBody(body: Record<string, unknown>) {
  return typeof body.name === "string" && body.name.trim() && markets.has(body.market as Market)
    && integer(body.spendThresholdRsd) && integer(body.discountPercent, 1) && body.discountPercent <= 100
    && (body.active === undefined || typeof body.active === "boolean") ? {
      name: body.name.trim(), market: body.market as Market, spendThresholdRsd: body.spendThresholdRsd,
      discountPercent: body.discountPercent, active: body.active ?? true,
    } : null;
}
async function tierOrdering(data: { market: Market; spendThresholdRsd: number }, omit?: string) {
  const rows = await db.select().from(loyaltyPricingTiersTable).where(or(eq(loyaltyPricingTiersTable.market, data.market), eq(loyaltyPricingTiersTable.market, "BOTH")));
  return !rows.some((row) => row.id !== omit && row.spendThresholdRsd === data.spendThresholdRsd);
}
router.get("/admin/loyalty-pricing-tiers", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  res.json(await db.select().from(loyaltyPricingTiersTable).orderBy(asc(loyaltyPricingTiersTable.market), asc(loyaltyPricingTiersTable.spendThresholdRsd)));
});
router.post("/admin/loyalty-pricing-tiers", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const data = tierBody(req.body ?? {});
  if (!data || !await tierOrdering(data)) { invalid(res, "Neispravan ili dupliran prag lojalnosti."); return; }
  const [row] = await db.insert(loyaltyPricingTiersTable).values(data).returning(); res.status(201).json(row);
});
router.patch("/admin/loyalty-pricing-tiers/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const body = req.body as Record<string, unknown>;
  const [old] = id ? await db.select().from(loyaltyPricingTiersTable).where(eq(loyaltyPricingTiersTable.id, id)).limit(1) : [];
  const data = old ? tierBody({ ...old, ...body }) : null;
  if (!old) { res.status(404).json({ error: "Nivo nije pronađen." }); return; }
  if (!data || !integer(body.version, 1) || body.version !== old.version || !await tierOrdering(data, old.id)) { res.status(409).json({ error: "Konflikt verzije ili praga." }); return; }
  const [row] = await db.update(loyaltyPricingTiersTable).set({ ...data, version: old.version + 1, updatedAt: new Date() }).where(and(eq(loyaltyPricingTiersTable.id, old.id), eq(loyaltyPricingTiersTable.version, old.version))).returning();
  if (!row) { res.status(409).json({ error: "Konflikt verzije." }); return; } res.json(row);
});
router.delete("/admin/loyalty-pricing-tiers/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const version = Number(req.query.version);
  const [row] = id && integer(version, 1) ? await db.delete(loyaltyPricingTiersTable).where(and(eq(loyaltyPricingTiersTable.id, id), eq(loyaltyPricingTiersTable.version, version))).returning() : [];
  if (!row) { res.status(409).json({ error: "Nivo nije pronađen ili je promenjen." }); return; } res.sendStatus(204);
});

router.get("/customer/loyalty-pricing", async (req, res): Promise<void> => {
  const user = await customer(req, res); if (!user) return;
  const market: "B2B" | "B2C" = user.role === "SALON_OWNER" ? "B2B" : "B2C";
  const spend = await settledCommerceSpend(db, market === "B2C"
    ? { market, userId: user.id }
    : { market, ownerUserId: user.id });
  const tiers = await db.select().from(loyaltyPricingTiersTable).where(and(eq(loyaltyPricingTiersTable.active, true), or(eq(loyaltyPricingTiersTable.market, market), eq(loyaltyPricingTiersTable.market, "BOTH"))));
  const typedTiers = tiers as Array<typeof tiers[number] & { market: Market }>;
  const tier = effectiveLoyaltyTier(market, spend, typedTiers); const next = tiers.filter((x) => x.spendThresholdRsd > spend).sort((a, b) => a.spendThresholdRsd - b.spendThresholdRsd)[0] ?? null;
  res.json({ market, netSettledSpendRsd: spend, effectiveTier: tier ? { id: tier.id, name: tier.name, discountPercent: tier.discountPercent, spendThresholdRsd: tier.spendThresholdRsd } : null, nextTier: next ? { id: next.id, name: next.name, spendThresholdRsd: next.spendThresholdRsd, progressPercent: Math.min(100, Math.floor(spend * 100 / next.spendThresholdRsd)) } : null });
});

function campaignBody(body: Record<string, unknown>) {
  const startsAt = date(body.startsAt); const endsAt = date(body.endsAt, true); const targets = targetRows(body.targets);
  if (typeof body.name !== "string" || !body.name.trim() || !markets.has(body.market as Market)
    || !["PERCENT", "FIXED_RSD"].includes(body.discountType as string) || !integer(body.discountValue, 1)
    || !startsAt || endsAt === undefined || (endsAt && endsAt <= startsAt) || !statuses.has(body.status as string) || !targets) return null;
  if (body.discountType === "PERCENT" && (body.discountValue as number) > 100) return null;
  return { campaign: { name: body.name.trim(), market: body.market as Market, discountType: body.discountType as "PERCENT" | "FIXED_RSD", discountValue: body.discountValue as number, startsAt, endsAt, status: body.status as "DRAFT" | "ACTIVE" }, targets };
}
router.get("/admin/bulk-sale-campaigns", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const campaigns = await db.select().from(bulkSaleCampaignsTable).orderBy(asc(bulkSaleCampaignsTable.startsAt));
  const targets = campaigns.length ? await db.select().from(bulkSaleCampaignTargetsTable).where(inArray(bulkSaleCampaignTargetsTable.campaignId, campaigns.map(x => x.id))) : [];
  res.json(campaigns.map(c => ({ ...c, targets: targets.filter(t => t.campaignId === c.id).map(t => ({ productId: t.productId, categoryId: t.categoryId })) })));
});
router.post("/admin/bulk-sale-campaigns", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const data = campaignBody(req.body ?? {});
  if (!data || !await validateTargets(data.targets)) { invalid(res, "Neispravna kampanja ili ciljevi."); return; }
  const row = await db.transaction(async tx => {
    const [campaign] = await tx.insert(bulkSaleCampaignsTable).values(data.campaign).returning();
    await tx.insert(bulkSaleCampaignTargetsTable).values(data.targets.map(t => ({ campaignId: campaign!.id, ...t })));
    return campaign!;
  }); res.status(201).json({ ...row, targets: data.targets });
});
router.patch("/admin/bulk-sale-campaigns/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const body = req.body as Record<string, unknown>;
  const [old] = id ? await db.select().from(bulkSaleCampaignsTable).where(eq(bulkSaleCampaignsTable.id, id)).limit(1) : [];
  const data = old ? campaignBody({ ...old, ...body, targets: body.targets ?? (await db.select().from(bulkSaleCampaignTargetsTable).where(eq(bulkSaleCampaignTargetsTable.campaignId, old.id))) }) : null;
  if (!old) { res.status(404).json({ error: "Kampanja nije pronađena." }); return; }
  if (!data || !integer(body.version, 1) || body.version !== old.version || !await validateTargets(data.targets)) { res.status(409).json({ error: "Konflikt verzije ili neispravna kampanja." }); return; }
  const row = await db.transaction(async tx => {
    const [updated] = await tx.update(bulkSaleCampaignsTable).set({ ...data.campaign, version: old.version + 1, updatedAt: new Date() }).where(and(eq(bulkSaleCampaignsTable.id, old.id), eq(bulkSaleCampaignsTable.version, old.version))).returning();
    if (!updated) return null; await tx.delete(bulkSaleCampaignTargetsTable).where(eq(bulkSaleCampaignTargetsTable.campaignId, old.id));
    await tx.insert(bulkSaleCampaignTargetsTable).values(data.targets.map(t => ({ campaignId: old.id, ...t }))); return updated;
  }); if (!row) { res.status(409).json({ error: "Konflikt verzije." }); return; } res.json({ ...row, targets: data.targets });
});
router.delete("/admin/bulk-sale-campaigns/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const version = Number(req.query.version);
  const [row] = id && integer(version, 1) ? await db.delete(bulkSaleCampaignsTable).where(and(eq(bulkSaleCampaignsTable.id, id), eq(bulkSaleCampaignsTable.version, version))).returning() : [];
  if (!row) { res.status(409).json({ error: "Kampanja nije pronađena ili je promenjena." }); return; } res.sendStatus(204);
});

function rewardBody(body: Record<string, unknown>) {
  if (typeof body.name !== "string" || !body.name.trim() || !markets.has(body.market as Market) || !integer(body.spendThresholdRsd)
    || !["FREE_SHIPPING", "GIFT_PRODUCT", "PERCENT_DISCOUNT"].includes(body.rewardKind as string) || typeof body.active !== "boolean") return null;
  const gift = typeof body.giftProductId === "string" && integer(body.giftQuantity, 1);
  const percent = integer(body.discountPercent, 1) && body.discountPercent <= 100;
  if ((body.rewardKind === "GIFT_PRODUCT" && !gift) || (body.rewardKind === "PERCENT_DISCOUNT" && !percent)
    || (body.rewardKind === "FREE_SHIPPING" && (body.giftProductId != null || body.discountPercent != null))) return null;
  return { name: body.name.trim(), market: body.market as Market, spendThresholdRsd: body.spendThresholdRsd as number, rewardKind: body.rewardKind as "FREE_SHIPPING" | "GIFT_PRODUCT" | "PERCENT_DISCOUNT", discountPercent: body.rewardKind === "PERCENT_DISCOUNT" ? body.discountPercent as number : null, giftProductId: body.rewardKind === "GIFT_PRODUCT" ? body.giftProductId as string : null, giftQuantity: body.rewardKind === "GIFT_PRODUCT" ? body.giftQuantity as number : null, active: body.active };
}
router.get("/admin/cart-threshold-rewards", async (req, res): Promise<void> => { if (!await admin(req, res)) return; res.json(await db.select().from(cartThresholdRewardsTable).orderBy(asc(cartThresholdRewardsTable.spendThresholdRsd))); });
router.post("/admin/cart-threshold-rewards", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const data = rewardBody(req.body ?? {});
  if (!data || (data.giftProductId && !(await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, data.giftProductId)).limit(1))[0])) { invalid(res, "Neispravna nagrada."); return; }
  const duplicate = await db.select({ id: cartThresholdRewardsTable.id }).from(cartThresholdRewardsTable).where(and(eq(cartThresholdRewardsTable.market, data.market), eq(cartThresholdRewardsTable.spendThresholdRsd, data.spendThresholdRsd))).limit(1);
  if (duplicate[0]) { invalid(res, "Prag mora biti jedinstven po tržištu."); return; } const [row] = await db.insert(cartThresholdRewardsTable).values(data).returning(); res.status(201).json(row);
});
router.get("/customer/cart-threshold-rewards", async (req, res): Promise<void> => {
  const user = await customer(req, res); if (!user) return; const subtotal = Number(req.query.subtotalRsd);
  if (!Number.isSafeInteger(subtotal) || subtotal < 0) { invalid(res, "subtotalRsd mora biti nenegativan ceo broj."); return; }
  const market = user.role === "SALON_OWNER" ? "B2B" : "B2C"; const rows = await db.select().from(cartThresholdRewardsTable).where(and(eq(cartThresholdRewardsTable.active, true), or(eq(cartThresholdRewardsTable.market, market), eq(cartThresholdRewardsTable.market, "BOTH")))).orderBy(asc(cartThresholdRewardsTable.spendThresholdRsd));
  const safe = (r: typeof rows[number]) => ({ id: r.id, name: r.name, spendThresholdRsd: r.spendThresholdRsd, rewardKind: r.rewardKind, discountPercent: r.discountPercent, giftQuantity: r.giftQuantity });
  res.json({ reached: rows.filter(r => r.spendThresholdRsd <= subtotal).map(safe), next: rows.find(r => r.spendThresholdRsd > subtotal) ? safe(rows.find(r => r.spendThresholdRsd > subtotal)!) : null });
});
router.patch("/admin/cart-threshold-rewards/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const body = req.body as Record<string, unknown>;
  const [old] = id ? await db.select().from(cartThresholdRewardsTable).where(eq(cartThresholdRewardsTable.id, id)).limit(1) : [];
  const data = old ? rewardBody({ ...old, ...body }) : null;
  if (!old) { res.status(404).json({ error: "Nagrada nije pronađena." }); return; }
  if (!data || !integer(body.version, 1) || body.version !== old.version) { res.status(409).json({ error: "Konflikt verzije ili neispravna nagrada." }); return; }
  const duplicates = await db.select({ id: cartThresholdRewardsTable.id }).from(cartThresholdRewardsTable).where(and(eq(cartThresholdRewardsTable.market, data.market), eq(cartThresholdRewardsTable.spendThresholdRsd, data.spendThresholdRsd)));
  if (duplicates.some(x => x.id !== old.id)) { invalid(res, "Prag mora biti jedinstven po tržištu."); return; }
  const [row] = await db.update(cartThresholdRewardsTable).set({ ...data, version: old.version + 1, updatedAt: new Date() }).where(and(eq(cartThresholdRewardsTable.id, old.id), eq(cartThresholdRewardsTable.version, old.version))).returning();
  if (!row) { res.status(409).json({ error: "Konflikt verzije." }); return; } res.json(row);
});
router.delete("/admin/cart-threshold-rewards/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const version = Number(req.query.version);
  const [row] = id && integer(version, 1) ? await db.delete(cartThresholdRewardsTable).where(and(eq(cartThresholdRewardsTable.id, id), eq(cartThresholdRewardsTable.version, version))).returning() : [];
  if (!row) { res.status(409).json({ error: "Nagrada nije pronađena ili je promenjena." }); return; } res.sendStatus(204);
});

function xyBody(body: Record<string, unknown>) {
  const startsAt = date(body.startsAt, true); const endsAt = date(body.endsAt, true);
  const buy = targetRows(body.buyTargets, "BUY"); const reward = targetRows(body.rewardTargets, "REWARD");
  if (typeof body.name !== "string" || !body.name.trim() || !markets.has(body.market as Market) || !integer(body.buyQuantity, 1)
    || !integer(body.rewardQuantity, 1) || !integer(body.rewardPercent, 1) || body.rewardPercent > 100 || !statuses.has(body.status as string)
    || startsAt === undefined || endsAt === undefined || (startsAt && endsAt && endsAt <= startsAt) || !buy || !reward
    || (body.perOrderRewardUnitCap != null && !integer(body.perOrderRewardUnitCap, 1))) return null;
  return { promotion: { name: body.name.trim(), market: body.market as Market, buyQuantity: body.buyQuantity as number, rewardQuantity: body.rewardQuantity as number, rewardPercent: body.rewardPercent as number, perOrderRewardUnitCap: body.perOrderRewardUnitCap as number | null ?? null, startsAt, endsAt, status: body.status as "DRAFT" | "ACTIVE" }, targets: [...buy, ...reward] };
}
router.get("/admin/automatic-xy-promotions", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const promotions = await db.select().from(automaticXyPromotionsTable).orderBy(asc(automaticXyPromotionsTable.createdAt));
  const targets = promotions.length ? await db.select().from(automaticXyPromotionTargetsTable).where(inArray(automaticXyPromotionTargetsTable.promotionId, promotions.map(p => p.id))) : [];
  res.json(promotions.map(p => ({ ...p, buyTargets: targets.filter(t => t.promotionId === p.id && t.targetRole === "BUY").map(t => ({ productId: t.productId, categoryId: t.categoryId })), rewardTargets: targets.filter(t => t.promotionId === p.id && t.targetRole === "REWARD").map(t => ({ productId: t.productId, categoryId: t.categoryId })) })));
});
router.post("/admin/automatic-xy-promotions", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const data = xyBody(req.body ?? {});
  if (!data || !await validateTargets(data.targets)) { invalid(res, "Neispravna X+Y promocija ili ciljevi."); return; }
  const row = await db.transaction(async tx => { const [p] = await tx.insert(automaticXyPromotionsTable).values(data.promotion).returning(); await tx.insert(automaticXyPromotionTargetsTable).values(data.targets.map(t => ({ promotionId: p!.id, productId: t.productId, categoryId: t.categoryId, targetRole: t.targetRole! }))); return p!; });
  res.status(201).json({ ...row, buyTargets: data.targets.filter(t => t.targetRole === "BUY"), rewardTargets: data.targets.filter(t => t.targetRole === "REWARD") });
});
router.patch("/admin/automatic-xy-promotions/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const body = req.body as Record<string, unknown>;
  const [old] = id ? await db.select().from(automaticXyPromotionsTable).where(eq(automaticXyPromotionsTable.id, id)).limit(1) : [];
  const oldTargets = old ? await db.select().from(automaticXyPromotionTargetsTable).where(eq(automaticXyPromotionTargetsTable.promotionId, old.id)) : [];
  const data = old ? xyBody({ ...old, ...body, buyTargets: body.buyTargets ?? oldTargets.filter(t => t.targetRole === "BUY"), rewardTargets: body.rewardTargets ?? oldTargets.filter(t => t.targetRole === "REWARD") }) : null;
  if (!old) { res.status(404).json({ error: "Promocija nije pronađena." }); return; }
  if (!data || !integer(body.version, 1) || body.version !== old.version || !await validateTargets(data.targets)) { res.status(409).json({ error: "Konflikt verzije ili neispravna promocija." }); return; }
  const row = await db.transaction(async tx => { const [p] = await tx.update(automaticXyPromotionsTable).set({ ...data.promotion, version: old.version + 1, updatedAt: new Date() }).where(and(eq(automaticXyPromotionsTable.id, old.id), eq(automaticXyPromotionsTable.version, old.version))).returning(); if (!p) return null; await tx.delete(automaticXyPromotionTargetsTable).where(eq(automaticXyPromotionTargetsTable.promotionId, old.id)); await tx.insert(automaticXyPromotionTargetsTable).values(data.targets.map(t => ({ promotionId: old.id, productId: t.productId, categoryId: t.categoryId, targetRole: t.targetRole! }))); return p; });
  if (!row) { res.status(409).json({ error: "Konflikt verzije." }); return; } res.json({ ...row, buyTargets: data.targets.filter(t => t.targetRole === "BUY"), rewardTargets: data.targets.filter(t => t.targetRole === "REWARD") });
});
router.delete("/admin/automatic-xy-promotions/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return; const id = stringParam(req.params.id); const version = Number(req.query.version);
  const [row] = id && integer(version, 1) ? await db.delete(automaticXyPromotionsTable).where(and(eq(automaticXyPromotionsTable.id, id), eq(automaticXyPromotionsTable.version, version))).returning() : [];
  if (!row) { res.status(409).json({ error: "Promocija nije pronađena ili je promenjena." }); return; } res.sendStatus(204);
});

/** Customer-safe descriptors; checkout deliberately does not apply these yet. */
router.get("/public/products/:productId/automatic-xy-promotions", async (req, res): Promise<void> => {
  const productId = stringParam(req.params.productId); if (!productId) { invalid(res, "Neispravan proizvod."); return; }
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId)).limit(1);
  if (!product || !product.active) { res.status(404).json({ error: "Proizvod nije pronađen." }); return; }
  const market = product.retailEnabled ? "B2C" : "B2B"; const now = new Date();
  const promotions = await db.select().from(automaticXyPromotionsTable).where(and(eq(automaticXyPromotionsTable.status, "ACTIVE"), or(eq(automaticXyPromotionsTable.market, market), eq(automaticXyPromotionsTable.market, "BOTH"))));
  const targets = promotions.length ? await db.select().from(automaticXyPromotionTargetsTable).where(inArray(automaticXyPromotionTargetsTable.promotionId, promotions.map(p => p.id))) : [];
  const badges = promotions.filter(p => (!p.startsAt || p.startsAt <= now) && (!p.endsAt || now < p.endsAt)
    && targets.some(t => t.promotionId === p.id && (t.productId === product.id || t.categoryId === product.categoryId)))
    .map(p => ({ id: p.id, name: p.name, buyQuantity: p.buyQuantity, rewardQuantity: p.rewardQuantity, rewardPercent: p.rewardPercent, perOrderRewardUnitCap: p.perOrderRewardUnitCap }));
  res.json({ items: badges });
});

export default router;