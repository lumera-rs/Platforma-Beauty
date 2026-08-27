import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  commerceExperienceSettingsTable, db, mediaAssetsTable, orderItemsTable, ordersTable,
  productDocumentsTable, productsTable, retailOrderItemsTable, retailOrdersTable, suppliersTable,
} from "@workspace/db";
import {
  AdminAttachProductDocumentBody,
  AdminReorderProductDocumentsBody, AdminUpdateCommerceExperienceBody,
} from "@workspace/api-zod";
import { getCurrentUser, isAdmin } from "../lib/auth";
import { activeProductSale } from "../lib/active-product-sale";
import { mediaAssetIdFromUrl } from "./media";
import { boundedSearchTerm, isAllowedBestsellerPeriod } from "../lib/commerce-g-domain";

const router: IRouter = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireAdmin(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Authentication required." }); return null; }
  if (!isAdmin(user)) { res.status(403).json({ error: "Administrator access required." }); return null; }
  return user;
}
function canBrowseB2b(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return Boolean(user && (isAdmin(user) || user.role === "SALON_OWNER" || user.role === "EDUKATIVNI_CENTAR"));
}

async function settings() {
  const [found] = await db.select().from(commerceExperienceSettingsTable).limit(1);
  if (found) return found;
  const [created] = await db.insert(commerceExperienceSettingsTable).values({}).onConflictDoNothing().returning();
  return created ?? (await db.select().from(commerceExperienceSettingsTable).limit(1))[0]!;
}

const activeCategory = sql<boolean>`EXISTS (
  WITH RECURSIVE ancestors AS (
    SELECT id,parent_id,active FROM product_categories WHERE id=${productsTable.categoryId}
    UNION ALL SELECT c.id,c.parent_id,c.active FROM product_categories c JOIN ancestors a ON a.parent_id=c.id
  ) SELECT 1 FROM ancestors HAVING count(*) > 0 AND bool_and(active)
)`;
function eligible(audience: "B2B" | "B2C") {
  return and(
    eq(productsTable.active, true), activeCategory,
    sql`EXISTS (SELECT 1 FROM ${suppliersTable} supplier WHERE supplier.id=${productsTable.supplierId}
      AND supplier.active=true AND supplier.scope IN (${audience}, 'BOTH'))`,
    audience === "B2B"
      ? eq(productsTable.professionalEnabled, true)
      : and(eq(productsTable.retailEnabled, true), isNotNull(productsTable.publicPrice), isNotNull(productsTable.publicDescription)),
  )!;
}

router.get("/commerce/header-bar", async (_req, res): Promise<void> => {
  const row = await settings();
  res.json({ enabled: row.headerEnabled, messages: row.headerMessages, intervalSeconds: row.headerIntervalSeconds });
});
router.get("/admin/commerce-experience", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  res.json(await settings());
});
router.put("/admin/commerce-experience", async (req, res): Promise<void> => {
  const user = await requireAdmin(req, res); if (!user) return;
  const parsed = AdminUpdateCommerceExperienceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  const current = await settings();
  if (input.version !== current.version) { res.status(409).json({ error: "Settings changed after they were loaded." }); return; }
  const ids = [...new Set(input.smartSearchProductIds)];
  if (input.smartSearchMode === "MANUAL" && ids.length) {
    const rows = await db.select({ id: productsTable.id }).from(productsTable)
      .where(and(inArray(productsTable.id, ids), eligible("B2C"))).limit(5);
    if (rows.length !== ids.length) { res.status(400).json({ error: "Manual suggestions must be eligible public products." }); return; }
  }
  const [updated] = await db.update(commerceExperienceSettingsTable).set({
    headerEnabled: input.headerEnabled, headerMessages: input.headerMessages,
    headerIntervalSeconds: input.headerIntervalSeconds, smartSearchMode: input.smartSearchMode,
    smartSearchProductIds: ids, bestsellerPeriodDays: input.bestsellerPeriodDays,
    version: current.version + 1, updatedByUserId: user.id, updatedAt: new Date(),
  }).where(and(eq(commerceExperienceSettingsTable.id, current.id), eq(commerceExperienceSettingsTable.version, current.version))).returning();
  if (!updated) { res.status(409).json({ error: "Settings changed after they were loaded." }); return; }
  res.json(updated);
});

async function ranking(audience: "B2B" | "B2C", periodDays: 30 | 60, categoryId?: string, supplierSlug?: string) {
  const cutoff = new Date(Date.now() - periodDays * 86_400_000);
  const category = categoryId ? eq(productsTable.categoryId, categoryId) : undefined;
  const supplier = supplierSlug ? eq(suppliersTable.slug, supplierSlug) : undefined;
  const rows = audience === "B2B"
    ? await db.select({ product: productsTable, quantity: sql<number>`sum(${orderItemsTable.quantity})` })
      .from(orderItemsTable).innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id)).innerJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
      .where(and(eq(ordersTable.status, "delivered"), sql`${ordersTable.updatedAt} >= ${cutoff}`, eligible(audience), category, supplier))
      .groupBy(productsTable.id).orderBy(desc(sql`sum(${orderItemsTable.quantity})`), asc(productsTable.id)).limit(10)
    : await db.select({ product: productsTable, quantity: sql<number>`sum(${retailOrderItemsTable.quantity})` })
      .from(retailOrderItemsTable).innerJoin(retailOrdersTable, eq(retailOrderItemsTable.orderId, retailOrdersTable.id))
      .innerJoin(productsTable, eq(retailOrderItemsTable.productId, productsTable.id)).innerJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
      .where(and(eq(retailOrdersTable.status, "delivered"), sql`${retailOrdersTable.updatedAt} >= ${cutoff}`, eligible(audience), category, supplier))
      .groupBy(productsTable.id).orderBy(desc(sql`sum(${retailOrderItemsTable.quantity})`), asc(productsTable.id)).limit(10);
  return rows.map((row, index) => ({
    rank: index + 1, productId: row.product.id, name: row.product.name, imageUrl: row.product.imageUrl,
    categoryId: row.product.categoryId, quantitySold: Number(row.quantity), audience, periodDays, automaticBestseller: true,
  }));
}

function rankingQuery(req: Request, res: Response) {
  const audience = req.query.audience;
  const period = Number(req.query.periodDays || 0);
  const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;
  const supplierSlug = typeof req.query.supplierSlug === "string" ? req.query.supplierSlug.trim() : undefined;
  if ((audience !== "B2B" && audience !== "B2C") || (period !== 0 && !isAllowedBestsellerPeriod(period)) || (categoryId && !uuid.test(categoryId)) || (supplierSlug !== undefined && (!supplierSlug || supplierSlug.length > 120))) {
    res.status(400).json({ error: "Invalid ranking query." }); return null;
  }
  return { audience: audience as "B2B" | "B2C", period: period as 0 | 30 | 60, categoryId, supplierSlug };
}
router.get("/commerce/bestsellers", async (req, res): Promise<void> => {
  const query = rankingQuery(req, res); if (!query) return;
  if (query.audience === "B2B" && !canBrowseB2b(await getCurrentUser(req))) {
    res.status(403).json({ error: "Business access required." }); return;
  }
  const config = await settings();
  res.json(await ranking(query.audience, query.period || config.bestsellerPeriodDays as 30 | 60, query.categoryId, query.supplierSlug));
});
router.get("/admin/commerce/bestsellers", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const query = rankingQuery(req, res); if (!query) return;
  const config = await settings();
  res.json(await ranking(query.audience, query.period || config.bestsellerPeriodDays as 30 | 60, query.categoryId, query.supplierSlug));
});

router.get("/commerce/search-suggestions", async (req, res): Promise<void> => {
  const audience = req.query.audience;
  if (audience !== "B2B" && audience !== "B2C") { res.status(400).json({ error: "audience is required." }); return; }
  if (audience === "B2B") {
    const user = await getCurrentUser(req);
    if (!canBrowseB2b(user)) { res.status(403).json({ error: "Business access required." }); return; }
  }
  const limit = Math.max(1, Math.min(5, Number(req.query.limit) || 5));
  const q = boundedSearchTerm(req.query.q);
  const config = await settings();
  let rows: (typeof productsTable.$inferSelect)[] = [];
  if (!q && config.smartSearchMode === "MANUAL") {
    rows = config.smartSearchProductIds.length
      ? await db.select().from(productsTable).where(and(inArray(productsTable.id, config.smartSearchProductIds), eligible(audience))).limit(5)
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    rows = config.smartSearchProductIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  } else if (!q) {
    const top = await ranking(audience, config.bestsellerPeriodDays as 30 | 60);
    const ids = top.map((item) => item.productId).slice(0, limit);
    rows = ids.length ? await db.select().from(productsTable).where(and(inArray(productsTable.id, ids), eligible(audience))).limit(5) : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    rows = ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  } else {
    const normalized = q.toLowerCase();
    rows = await db.select().from(productsTable).where(and(eligible(audience), sql`
      lower(${productsTable.name}) LIKE ${`%${normalized}%`}
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${productsTable.searchSynonyms}) s WHERE lower(s) LIKE ${`%${normalized}%`})
      OR similarity(lower(${productsTable.name}), ${normalized}) >= 0.25
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${productsTable.searchSynonyms}) s WHERE similarity(lower(s), ${normalized}) >= 0.25)
    `)).orderBy(
      desc(sql`CASE WHEN lower(${productsTable.name}) = ${normalized} THEN 4 WHEN lower(${productsTable.name}) LIKE ${`%${normalized}%`} THEN 3
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements_text(${productsTable.searchSynonyms}) s WHERE lower(s) = ${normalized}) THEN 2 ELSE 1 END`),
      desc(sql`similarity(lower(${productsTable.name}), ${normalized})`), asc(productsTable.id),
    ).limit(limit);
  }
  const topIds = new Set((await ranking(audience, config.bestsellerPeriodDays as 30 | 60)).map((item) => item.productId));
  res.json(rows.slice(0, limit).map((product) => {
    const sale = activeProductSale(product, audience);
    const variants = product.variants ?? [];
    const perVariant = variants.length > 0 && variants.every((variant) => variant.stock != null)
      && variants.reduce((sum, variant) => sum + Math.max(0, variant.stock!), 0) === product.stock;
    const invalidVariantStock = variants.some((variant) => variant.stock != null) && !perVariant;
    const stock = invalidVariantStock ? 0 : perVariant
      ? variants.reduce((sum, variant) => sum + Math.max(0, variant.stock!), 0)
      : Math.max(0, product.stock);
    const por = product.priceOnRequest || stock === 0;
    const basePrice = audience === "B2B" ? product.price : product.publicPrice;
    return {
      id: product.id, name: product.name, imageUrl: product.imageUrl, audience,
      price: por ? null : basePrice, discountPrice: por ? null : sale?.price ?? null,
      priceOnRequest: por, cartEligible: !por, variantType: product.variantType,
      variants: variants.map((variant) => ({
        value: variant.value, label: variant.label,
        cartEligible: !por && (variant.stock == null ? stock > 0 : variant.stock > 0),
        swatch: variant.swatch ?? null, imageUrl: variant.mainImageUrl ?? null,
      })),
      automaticBestseller: topIds.has(product.id),
    };
  }));
});

function documentDto(row: { document: typeof productDocumentsTable.$inferSelect; asset: typeof mediaAssetsTable.$inferSelect }) {
  return {
    id: row.document.id, displayName: row.document.displayName, sortOrder: row.document.sortOrder,
    url: `/api/media/${row.asset.id}?size=original&format=original&v=${row.asset.contentHash.slice(0, 16)}`, contentType: row.asset.originalContentType,
  };
}
async function documentAsset(req: Request, res: Response, mediaUrl: string) {
  const user = await requireAdmin(req, res); if (!user) return null;
  const id = mediaAssetIdFromUrl(mediaUrl);
  if (!id) { res.status(400).json({ error: "Managed document URL required." }); return null; }
  const [asset] = await db.select().from(mediaAssetsTable).where(and(
    eq(mediaAssetsTable.id, id), eq(mediaAssetsTable.ownerUserId, user.id), eq(mediaAssetsTable.scope, "product-document"),
  )).limit(1);
  if (!asset || !["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(asset.originalContentType)) {
    res.status(400).json({ error: "Only owned finalized PDF/DOCX documents are allowed." }); return null;
  }
  return asset;
}
router.get("/products/:productId/documents", async (req, res): Promise<void> => {
  const audience = req.query.audience;
  if (audience !== "B2B" && audience !== "B2C") { res.status(400).json({ error: "audience is required." }); return; }
  if (audience === "B2B") {
    const user = await getCurrentUser(req);
    if (!canBrowseB2b(user)) { res.status(403).json({ error: "Business access required." }); return; }
  }
  const [product] = await db.select({ id: productsTable.id }).from(productsTable)
    .where(and(eq(productsTable.id, req.params.productId!), eligible(audience))).limit(1);
  if (!product) { res.status(404).json({ error: "Product not found." }); return; }
  const rows = await db.select({ document: productDocumentsTable, asset: mediaAssetsTable }).from(productDocumentsTable)
    .innerJoin(mediaAssetsTable, eq(productDocumentsTable.mediaAssetId, mediaAssetsTable.id))
    .where(eq(productDocumentsTable.productId, product.id)).orderBy(asc(productDocumentsTable.sortOrder), asc(productDocumentsTable.id)).limit(100);
  res.json(rows.map(documentDto));
});
router.post("/admin/products/:productId/documents", async (req, res): Promise<void> => {
  const parsed = AdminAttachProductDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const asset = await documentAsset(req, res, parsed.data.mediaUrl); if (!asset) return;
  const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, req.params.productId!)).limit(1);
  if (!product) { res.status(404).json({ error: "Product not found." }); return; }
  const [document] = await db.insert(productDocumentsTable).values({
    productId: product.id, mediaAssetId: asset.id, displayName: parsed.data.displayName, sortOrder: parsed.data.sortOrder,
  }).onConflictDoUpdate({ target: [productDocumentsTable.productId, productDocumentsTable.mediaAssetId], set: {
    displayName: parsed.data.displayName, sortOrder: parsed.data.sortOrder,
  }}).returning();
  await db.update(mediaAssetsTable).set({ resourceId: product.id, visibility: "public" }).where(eq(mediaAssetsTable.id, asset.id));
  res.status(201).json(documentDto({ document: document!, asset: { ...asset, resourceId: product.id, visibility: "public" } }));
});
router.put("/admin/products/:productId/documents/reorder", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const parsed = AdminReorderProductDocumentsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const ids = [...new Set(parsed.data.items.map((item) => item.id))];
  if (ids.length !== parsed.data.items.length) { res.status(400).json({ error: "Document ids must be unique." }); return; }
  const existing = ids.length ? await db.select({ id: productDocumentsTable.id }).from(productDocumentsTable)
    .where(and(eq(productDocumentsTable.productId, req.params.productId!), inArray(productDocumentsTable.id, ids))).limit(100) : [];
  if (existing.length !== ids.length) { res.status(404).json({ error: "A document is outside the product scope." }); return; }
  await db.transaction(async (tx) => {
    for (const item of parsed.data.items) await tx.update(productDocumentsTable).set({ sortOrder: item.sortOrder })
      .where(and(eq(productDocumentsTable.id, item.id), eq(productDocumentsTable.productId, req.params.productId!)));
  });
  const rows = await db.select({ document: productDocumentsTable, asset: mediaAssetsTable }).from(productDocumentsTable)
    .innerJoin(mediaAssetsTable, eq(productDocumentsTable.mediaAssetId, mediaAssetsTable.id))
    .where(eq(productDocumentsTable.productId, req.params.productId!))
    .orderBy(asc(productDocumentsTable.sortOrder), asc(productDocumentsTable.id)).limit(100);
  res.json(rows.map(documentDto));
});
router.post("/admin/categories/:categoryId/documents", async (req, res): Promise<void> => {
  const parsed = AdminAttachProductDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const asset = await documentAsset(req, res, parsed.data.mediaUrl); if (!asset) return;
  const products = await db.select({ id: productsTable.id }).from(productsTable)
    .where(eq(productsTable.categoryId, req.params.categoryId!)).orderBy(asc(productsTable.id)).limit(1001);
  if (products.length > 1000) { res.status(409).json({ error: "Category exceeds the 1000-product operation bound." }); return; }
  if (!products.length) { res.status(404).json({ error: "Category has no products." }); return; }
  await db.transaction(async (tx) => {
    await tx.insert(productDocumentsTable).values(products.map((product) => ({
      productId: product.id, mediaAssetId: asset.id, displayName: parsed.data.displayName, sortOrder: parsed.data.sortOrder,
    }))).onConflictDoNothing();
    await tx.update(mediaAssetsTable).set({ resourceId: req.params.categoryId!, visibility: "public" }).where(eq(mediaAssetsTable.id, asset.id));
  });
  res.json({ attached: products.length });
});
router.delete("/admin/product-documents/:documentId", async (req, res): Promise<void> => {
  if (!await requireAdmin(req, res)) return;
  const [deleted] = await db.delete(productDocumentsTable).where(eq(productDocumentsTable.id, req.params.documentId!)).returning();
  if (!deleted) { res.status(404).json({ error: "Document not found." }); return; }
  const [remaining] = await db.select({ id: productDocumentsTable.id }).from(productDocumentsTable)
    .where(eq(productDocumentsTable.mediaAssetId, deleted.mediaAssetId)).limit(1);
  if (!remaining) await db.update(mediaAssetsTable).set({ resourceId: null, visibility: "private" }).where(eq(mediaAssetsTable.id, deleted.mediaAssetId));
  res.status(204).end();
});

export default router;