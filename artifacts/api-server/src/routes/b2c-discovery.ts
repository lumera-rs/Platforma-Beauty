import { Router, type Request, type Response } from "express";
import {
  and, asc, count, desc, eq, exists, gte, ilike, inArray, isNotNull, isNull, lte, or, sql,
  type SQL,
} from "drizzle-orm";
import {
  b2cDisplaySettingsTable,
  b2cRecentlyViewedProductsTable,
  b2cNeedTagsTable,
  b2cProductNeedTagsTable,
  b2cProductTypesTable,
  b2cPromotionalBannersTable,
  db,
  productCategoriesTable,
  productsTable,
  retailProductReviewsTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";
import { getCurrentUser, isAdmin } from "../lib/auth";
import { createHash, randomBytes } from "node:crypto";
import { activeProductSale, activeProductSalePriceSql } from "../lib/active-product-sale";

const router = Router();
const SORTS = ["RECOMMENDED", "PRICE_ASC", "PRICE_DESC", "NEWEST", "BEST_RATED", "MOST_POPULAR"] as const;
type Sort = typeof SORTS[number];

async function admin(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Authentication required." }); return null; }
  if (!isAdmin(user)) { res.status(403).json({ error: "Administrator access required." }); return null; }
  return user;
}

function text(value: unknown, name: string, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${name} is invalid.`);
  return value.trim();
}
function integer(value: unknown, name: string, min = 0, max = 1_000_000) {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} is invalid.`);
  return Number(value);
}
function identifier(value: unknown, name: string) {
  const result = text(value, name, 100).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new Error(`${name} is invalid.`);
  return result;
}
function version(value: unknown) {
  const normalized = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return integer(normalized, "expectedVersion", 1, 2_147_483_647);
}
function list(value: unknown): string[] {
  const input = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(input.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean))].slice(0, 50);
}
function publicMedia(value: unknown, required = false) {
  if (value == null && !required) return null;
  const result = text(value, "image", 2_000);
  if (/uploads|staged|private/i.test(result)) throw new Error("A finalized public media URL is required.");
  if (!(result.startsWith("/") || /^https:\/\//.test(result))) throw new Error("A public image URL is required.");
  return result;
}
function internalPath(value: unknown) {
  const result = text(value, "customInternalPath", 2_000);
  const origin = "https://lumera.invalid";
  const parsed = new URL(result, origin);
  if (parsed.origin !== origin || !result.startsWith("/") || result.startsWith("//")) throw new Error("Destination must be an internal path.");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
function conflict(res: Response) {
  res.status(409).json({ code: "VERSION_CONFLICT", error: "Resource changed after it was loaded." });
}
function dictionaryView(row: typeof b2cProductTypesTable.$inferSelect | typeof b2cNeedTagsTable.$inferSelect) {
  return row;
}

function dictionaryRoutes(
  path: string,
  table: typeof b2cProductTypesTable | typeof b2cNeedTagsTable,
  stable: "slug" | "key",
) {
  router.get(path, async (req, res) => {
    if (!await admin(req, res)) return;
    res.json(await db.select().from(table).orderBy(asc(table.sortOrder), asc(table.id)));
  });
  router.post(path, async (req, res) => {
    const user = await admin(req, res); if (!user) return;
    try {
      const value = {
        [stable]: identifier(req.body?.[stable], stable),
        label: text(req.body?.label, "label"),
        active: req.body?.active ?? true,
        sortOrder: integer(req.body?.sortOrder ?? 0, "sortOrder"),
        createdByUserId: user.id, updatedByUserId: user.id,
      };
      const [created] = await db.insert(table).values(value as never).returning();
      res.status(201).json(dictionaryView(created!));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid dictionary value." }); }
  });
  router.patch(`${path}/:id`, async (req, res) => {
    const user = await admin(req, res); if (!user) return;
    try {
      const expectedVersion = version(req.body?.expectedVersion);
      const changes: Record<string, unknown> = { updatedAt: new Date(), updatedByUserId: user.id, version: expectedVersion + 1 };
      if (req.body?.label !== undefined) changes.label = text(req.body.label, "label");
      if (req.body?.active !== undefined) changes.active = Boolean(req.body.active);
      if (req.body?.sortOrder !== undefined) changes.sortOrder = integer(req.body.sortOrder, "sortOrder");
      // Stable slug/key is intentionally never mutable.
      const [updated] = await db.update(table).set(changes).where(and(eq(table.id, req.params.id!), eq(table.version, expectedVersion))).returning();
      if (!updated) { conflict(res); return; }
      res.json(updated);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid update." }); }
  });
  router.put(`${path}/reorder`, async (req, res) => {
    const user = await admin(req, res); if (!user) return;
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length || items.length > 500) { res.status(400).json({ error: "items is required." }); return; }
    try {
      const rows = await db.transaction(async (tx) => {
        const output = [];
        for (const item of items) {
          const expected = version(item.expectedVersion);
          const [updated] = await tx.update(table).set({
            sortOrder: integer(item.sortOrder, "sortOrder"), version: expected + 1,
            updatedAt: new Date(), updatedByUserId: user.id,
          }).where(and(eq(table.id, text(item.id, "id")), eq(table.version, expected))).returning();
          if (!updated) throw new Error("VERSION_CONFLICT");
          output.push(updated);
        }
        return output;
      });
      res.json(rows);
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") conflict(res);
      else res.status(400).json({ error: error instanceof Error ? error.message : "Invalid reorder." });
    }
  });
  router.delete(`${path}/:id`, async (req, res) => {
    if (!await admin(req, res)) return;
    try {
      const expected = version(req.query.expectedVersion);
      const [deleted] = await db.delete(table).where(and(eq(table.id, req.params.id!), eq(table.version, expected))).returning();
      if (!deleted) { conflict(res); return; }
      res.status(204).end();
    } catch (error) {
      const message = `${error instanceof Error ? error.message : ""} ${(error as { cause?: Error })?.cause?.message ?? ""}`;
      if (/foreign key|violates/i.test(message)) res.status(409).json({ code: "RESOURCE_REFERENCED", error: "Referenced values must be deactivated." });
      else res.status(400).json({ error: "Invalid delete request." });
    }
  });
}
dictionaryRoutes("/admin/b2c/product-types", b2cProductTypesTable, "slug");
dictionaryRoutes("/admin/b2c/need-tags", b2cNeedTagsTable, "key");

async function activeB2cSupplier(slug: string) {
  const [supplier] = await db.select().from(suppliersTable).where(and(
    eq(suppliersTable.slug, slug), eq(suppliersTable.active, true), inArray(suppliersTable.scope, ["B2C", "BOTH"]),
  )).limit(1);
  return supplier;
}
router.get("/suppliers", async (_req, res) => {
  res.json(await db.select().from(suppliersTable).where(and(
    eq(suppliersTable.active, true), inArray(suppliersTable.scope, ["B2C", "BOTH"]),
  )).orderBy(asc(suppliersTable.name), asc(suppliersTable.id)));
});
router.get("/suppliers/:supplierSlug", async (req, res, next) => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { next(); return; }
  res.json(supplier);
});
router.get("/suppliers/:supplierSlug/categories", async (req, res) => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { res.status(404).json({ error: "Supplier not found." }); return; }
  const [allCategories, counts] = await Promise.all([
    db.select().from(productCategoriesTable).where(
      eq(productCategoriesTable.supplierId, supplier.id),
    ).orderBy(asc(productCategoriesTable.sortOrder), asc(productCategoriesTable.id)),
    db.select({ categoryId: productsTable.categoryId, count: count() }).from(productsTable).where(and(
      eq(productsTable.supplierId, supplier.id), eq(productsTable.active, true), eq(productsTable.retailEnabled, true),
      isNotNull(productsTable.publicPrice), isNotNull(productsTable.publicDescription),
    )).groupBy(productsTable.categoryId),
  ]);
  const allById = new Map(allCategories.map((category) => [category.id, category]));
  const categories = allCategories.filter((category) => {
    let current: typeof category | undefined = category;
    while (current) {
      if (!current.active) return false;
      current = current.parentId ? allById.get(current.parentId) : undefined;
    }
    return true;
  });
  const byId = new Map(categories.map((category) => [category.id, category]));
  const direct = new Map(counts.map((row) => [row.categoryId, Number(row.count)]));
  const pathFor = (category: typeof categories[number]) => {
    const parts = [category.slug]; let current = category; let depth = 0;
    while (current.parentId && byId.has(current.parentId)) {
      current = byId.get(current.parentId)!; parts.unshift(current.slug); depth += 1;
    }
    return { path: parts.join("/"), depth };
  };
  res.json(categories.map((category) => {
    const path = pathFor(category);
    return { ...category, ...path, directProductCount: direct.get(category.id) ?? 0,
      descendantProductCount: categories.filter((candidate) => {
        const candidatePath = pathFor(candidate).path;
        return candidatePath === path.path || candidatePath.startsWith(`${path.path}/`);
      }).reduce((sum, candidate) => sum + (direct.get(candidate.id) ?? 0), 0) };
  }));
});

router.get("/admin/b2c/banners", async (req, res) => {
  if (!await admin(req, res)) return;
  const conditions = req.query.supplierId ? eq(b2cPromotionalBannersTable.supplierId, String(req.query.supplierId)) : undefined;
  res.json(await db.select().from(b2cPromotionalBannersTable).where(conditions)
    .orderBy(asc(b2cPromotionalBannersTable.supplierId), asc(b2cPromotionalBannersTable.placement), asc(b2cPromotionalBannersTable.sortOrder), asc(b2cPromotionalBannersTable.id)));
});

async function bannerInput(body: Record<string, unknown>, existing?: typeof b2cPromotionalBannersTable.$inferSelect) {
  const supplierId = body.supplierId === undefined && existing ? existing.supplierId : text(body.supplierId, "supplierId");
  const [supplier] = await db.select().from(suppliersTable).where(and(eq(suppliersTable.id, supplierId), eq(suppliersTable.active, true), inArray(suppliersTable.scope, ["B2C", "BOTH"]))).limit(1);
  if (!supplier) throw new Error("Active B2C supplier not found.");
  const kind = (body.destinationKind ?? existing?.destinationKind) as string;
  if (!["CATEGORY", "PRODUCT", "FILTERED_LISTING", "CUSTOM_INTERNAL_PATH"].includes(kind)) throw new Error("destinationKind is invalid.");
  const categoryId = kind === "CATEGORY" ? text(body.destinationCategoryId ?? existing?.destinationCategoryId, "destinationCategoryId") : null;
  const productId = kind === "PRODUCT" ? text(body.destinationProductId ?? existing?.destinationProductId, "destinationProductId") : null;
  if (categoryId) {
    const [category] = await db.select({ id: productCategoriesTable.id }).from(productCategoriesTable).where(and(eq(productCategoriesTable.id, categoryId), eq(productCategoriesTable.supplierId, supplierId))).limit(1);
    if (!category) throw new Error("Destination category does not belong to supplier.");
  }
  if (productId) {
    const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.id, productId), eq(productsTable.supplierId, supplierId), eq(productsTable.retailEnabled, true))).limit(1);
    if (!product) throw new Error("Destination product does not belong to supplier.");
  }
  const placement = (body.placement ?? existing?.placement) as string;
  if (!["HERO", "BELOW_CATEGORIES", "IN_RESULTS"].includes(placement)) throw new Error("placement is invalid.");
  const filtered = kind === "FILTERED_LISTING" ? body.filteredListing ?? existing?.filteredListing : null;
  if (filtered != null && (typeof filtered !== "object" || Array.isArray(filtered))) throw new Error("filteredListing is invalid.");
  const allowed = new Set(["categoryId", "brand", "productType", "needTag", "minPrice", "maxPrice", "sort"]);
  if (filtered && Object.keys(filtered as object).some((key) => !allowed.has(key))) throw new Error("filteredListing contains an unsafe filter.");
  return {
    supplierId,
    internalName: body.internalName === undefined && existing ? existing.internalName : text(body.internalName, "internalName"),
    desktopImageUrl: body.desktopImageUrl === undefined && existing ? existing.desktopImageUrl : publicMedia(body.desktopImageUrl, true)!,
    mobileImageUrl: body.mobileImageUrl === undefined ? existing?.mobileImageUrl ?? null : publicMedia(body.mobileImageUrl),
    headline: body.headline === undefined && existing ? existing.headline : text(body.headline, "headline", 300),
    text: body.text === undefined ? existing?.text ?? null : body.text == null ? null : text(body.text, "text", 2_000),
    ctaLabel: body.ctaLabel === undefined ? existing?.ctaLabel ?? null : body.ctaLabel == null ? null : text(body.ctaLabel, "ctaLabel", 100),
    destinationKind: kind as "CATEGORY" | "PRODUCT" | "FILTERED_LISTING" | "CUSTOM_INTERNAL_PATH",
    destinationCategoryId: categoryId, destinationProductId: productId,
    filteredListing: kind === "FILTERED_LISTING" ? filtered as Record<string, string | string[] | number> : null,
    customInternalPath: kind === "CUSTOM_INTERNAL_PATH" ? internalPath(body.customInternalPath ?? existing?.customInternalPath) : null,
    placement: placement as "HERO" | "BELOW_CATEGORIES" | "IN_RESULTS",
    active: body.active === undefined ? existing?.active ?? true : Boolean(body.active),
    startsAt: body.startsAt === undefined ? existing?.startsAt ?? null : body.startsAt == null ? null : new Date(text(body.startsAt, "startsAt")),
    endsAt: body.endsAt === undefined ? existing?.endsAt ?? null : body.endsAt == null ? null : new Date(text(body.endsAt, "endsAt")),
    sortOrder: body.sortOrder === undefined ? existing?.sortOrder ?? 0 : integer(body.sortOrder, "sortOrder"),
  };
}

router.post("/admin/b2c/banners", async (req, res) => {
  const user = await admin(req, res); if (!user) return;
  try {
    const input = await bannerInput(req.body ?? {});
    const [created] = await db.insert(b2cPromotionalBannersTable).values({ ...input, createdByUserId: user.id, updatedByUserId: user.id }).returning();
    res.status(201).json(created);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid banner." }); }
});
router.patch("/admin/b2c/banners/:id", async (req, res) => {
  const user = await admin(req, res); if (!user) return;
  try {
    const expected = version(req.body?.expectedVersion);
    const [current] = await db.select().from(b2cPromotionalBannersTable).where(eq(b2cPromotionalBannersTable.id, req.params.id!)).limit(1);
    if (!current || current.version !== expected) { conflict(res); return; }
    const input = await bannerInput(req.body ?? {}, current);
    const [updated] = await db.update(b2cPromotionalBannersTable).set({
      ...input, version: expected + 1, updatedAt: new Date(), updatedByUserId: user.id,
    }).where(and(eq(b2cPromotionalBannersTable.id, current.id), eq(b2cPromotionalBannersTable.version, expected))).returning();
    if (!updated) { conflict(res); return; }
    res.json(updated);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid banner." }); }
});
router.put("/admin/b2c/banners/reorder", async (req, res) => {
  const user = await admin(req, res); if (!user) return;
  if (!Array.isArray(req.body?.items)) { res.status(400).json({ error: "items is required." }); return; }
  try {
    const rows = await db.transaction(async (tx) => {
      const output = [];
      for (const item of req.body.items) {
        const expected = version(item.expectedVersion);
        const [updated] = await tx.update(b2cPromotionalBannersTable).set({
          sortOrder: integer(item.sortOrder, "sortOrder"), version: expected + 1, updatedAt: new Date(), updatedByUserId: user.id,
        }).where(and(eq(b2cPromotionalBannersTable.id, text(item.id, "id")), eq(b2cPromotionalBannersTable.version, expected))).returning();
        if (!updated) throw new Error("VERSION_CONFLICT");
        output.push(updated);
      }
      return output;
    });
    res.json(rows);
  } catch (error) { if (error instanceof Error && error.message === "VERSION_CONFLICT") conflict(res); else res.status(400).json({ error: "Invalid reorder." }); }
});
router.delete("/admin/b2c/banners/:id", async (req, res) => {
  if (!await admin(req, res)) return;
  try {
    const expected = version(req.query.expectedVersion);
    const [deleted] = await db.delete(b2cPromotionalBannersTable).where(and(eq(b2cPromotionalBannersTable.id, req.params.id!), eq(b2cPromotionalBannersTable.version, expected))).returning();
    if (!deleted) { conflict(res); return; }
    res.status(204).end();
  } catch { res.status(400).json({ error: "Invalid delete request." }); }
});
router.get("/suppliers/:supplierSlug/banners", async (req, res) => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { res.status(404).json({ error: "Supplier not found." }); return; }
  const now = new Date();
  const rows = await db.select().from(b2cPromotionalBannersTable).where(and(
    eq(b2cPromotionalBannersTable.supplierId, supplier.id), eq(b2cPromotionalBannersTable.active, true),
    or(isNull(b2cPromotionalBannersTable.startsAt), lte(b2cPromotionalBannersTable.startsAt, now)),
    or(isNull(b2cPromotionalBannersTable.endsAt), gte(b2cPromotionalBannersTable.endsAt, now)),
  )).orderBy(asc(b2cPromotionalBannersTable.placement), asc(b2cPromotionalBannersTable.sortOrder), asc(b2cPromotionalBannersTable.id));
  res.json(rows.map((row) => ({
    id: row.id, desktopImageUrl: row.desktopImageUrl, mobileImageUrl: row.mobileImageUrl,
    headline: row.headline, text: row.text, ctaLabel: row.ctaLabel, placement: row.placement,
    destination: row.destinationKind === "CATEGORY" ? { kind: row.destinationKind, categoryId: row.destinationCategoryId }
      : row.destinationKind === "PRODUCT" ? { kind: row.destinationKind, productId: row.destinationProductId }
      : row.destinationKind === "FILTERED_LISTING" ? { kind: row.destinationKind, filters: row.filteredListing }
      : { kind: row.destinationKind, path: row.customInternalPath },
  })));
});

async function settings() {
  const [row] = await db.select().from(b2cDisplaySettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(b2cDisplaySettingsTable).values({}).onConflictDoNothing().returning();
  return created ?? (await db.select().from(b2cDisplaySettingsTable).limit(1))[0]!;
}
router.get("/admin/b2c/display-settings", async (req, res) => {
  if (!await admin(req, res)) return;
  res.json(await settings());
});
router.put("/admin/b2c/display-settings", async (req, res) => {
  const user = await admin(req, res); if (!user) return;
  try {
    const current = await settings();
    const expected = version(req.body?.expectedVersion);
    if (current.version !== expected) { conflict(res); return; }
    const defaultSort = req.body.defaultSort as Sort;
    const enabled = list(req.body.enabledSortOptions) as Sort[];
    if (!SORTS.includes(defaultSort) || !enabled.length || enabled.some((item) => !SORTS.includes(item)) || !enabled.includes(defaultSort)) throw new Error("Sort settings are invalid.");
    const [updated] = await db.update(b2cDisplaySettingsTable).set({
      defaultSort, enabledSortOptions: enabled, pageSize: integer(req.body.pageSize, "pageSize", 1, 100),
      showOutOfStock: Boolean(req.body.showOutOfStock), recentlyViewedEnabled: Boolean(req.body.recentlyViewedEnabled),
      recentlyViewedMax: integer(req.body.recentlyViewedMax, "recentlyViewedMax", 1, 100),
      version: expected + 1, updatedByUserId: user.id, updatedAt: new Date(),
    }).where(and(eq(b2cDisplaySettingsTable.id, current.id), eq(b2cDisplaySettingsTable.version, expected))).returning();
    if (!updated) { conflict(res); return; }
    res.json(updated);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid settings." }); }
});
router.get("/b2c/display-config", async (_req, res) => {
  const row = await settings();
  res.json({ defaultSort: row.defaultSort, enabledSortOptions: row.enabledSortOptions, pageSize: row.pageSize,
    showOutOfStock: row.showOutOfStock, recentlyViewedEnabled: row.recentlyViewedEnabled, recentlyViewedMax: row.recentlyViewedMax });
});

async function categorySubtree(supplierId: string, categoryId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM product_categories WHERE id=${categoryId} AND supplier_id=${supplierId} AND active=true
      UNION ALL SELECT c.id FROM product_categories c JOIN subtree s ON c.parent_id=s.id
        WHERE c.supplier_id=${supplierId} AND c.active=true
    ) SELECT id FROM subtree`);
  return rows.rows.map((row) => row.id);
}
const priceExpr = sql<number>`coalesce(${activeProductSalePriceSql("B2C")}, ${productsTable.publicPrice})`;
// Moderation maintains this aggregate atomically with the review row. Listing
// and BEST_RATED deliberately read the identical public aggregate.
const ratingExpr = productsTable.averageRating;
const popularityExpr = sql<number>`coalesce((select sum(i.quantity) from retail_order_items i join retail_orders o on o.id=i.order_id where i.product_id=${productsTable.id} and o.status='delivered'),0)`;

type FilterInput = {
  search?: string; categoryIds: string[]; brands: string[]; types: string[]; tags: string[];
  min?: number; max?: number; showOutOfStock: boolean;
};
function productConditions(supplierId: string, f: FilterInput, omit?: "category" | "brand" | "type" | "tag") {
  const conditions: SQL[] = [
    canonicalPublicProductCondition(supplierId),
  ];
  if (!f.showOutOfStock) conditions.push(sql`${productsTable.stock} > 0`);
  if (f.min != null) conditions.push(gte(priceExpr, f.min));
  if (f.max != null) conditions.push(lte(priceExpr, f.max));
  if (omit !== "category" && f.categoryIds.length) conditions.push(inArray(productsTable.categoryId, f.categoryIds));
  if (omit !== "brand" && f.brands.length) conditions.push(inArray(productsTable.brand, f.brands));
  if (omit !== "type" && f.types.length) conditions.push(sql`EXISTS (SELECT 1 FROM b2c_product_types pt WHERE pt.id=${productsTable.productTypeId} AND pt.active=true AND pt.slug IN (${sql.join(f.types.map((value) => sql`${value}`), sql`, `)}))`);
  if (omit !== "tag" && f.tags.length) conditions.push(sql`EXISTS (SELECT 1 FROM b2c_product_need_tags pnt JOIN b2c_need_tags nt ON nt.id=pnt.need_tag_id WHERE pnt.product_id=${productsTable.id} AND nt.active=true AND nt.key IN (${sql.join(f.tags.map((value) => sql`${value}`), sql`, `)}))`);
  if (f.search) {
    const normalized = f.search.toLowerCase();
    const pattern = `%${normalized}%`;
    conditions.push(or(
      ilike(productsTable.name, pattern), ilike(productsTable.brand, pattern), ilike(productsTable.categoryName, pattern),
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${productsTable.searchSynonyms}) synonym
        WHERE lower(synonym) LIKE ${pattern} OR similarity(lower(synonym), ${normalized}) >= 0.25)`,
      sql`similarity(lower(${productsTable.name}), ${normalized}) >= 0.25`,
      exists(db.select({ one: sql`1` }).from(b2cProductTypesTable).where(and(eq(b2cProductTypesTable.id, productsTable.productTypeId), eq(b2cProductTypesTable.active, true), ilike(b2cProductTypesTable.label, pattern)))),
      sql`EXISTS (SELECT 1 FROM b2c_product_need_tags pnt JOIN b2c_need_tags nt ON nt.id=pnt.need_tag_id WHERE pnt.product_id=${productsTable.id} AND nt.active=true AND nt.label ILIKE ${pattern})`,
    )!);
  }
  return and(...conditions)!;
}

/** One public-product eligibility predicate shared by discovery and legacy reads. */
export function canonicalPublicProductCondition(supplierId: string) {
  return and(
    eq(productsTable.supplierId, supplierId),
    eq(productsTable.active, true),
    eq(productsTable.retailEnabled, true),
    isNotNull(productsTable.publicDescription),
    isNotNull(productsTable.publicPrice),
    sql`EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id,parent_id,supplier_id,active FROM product_categories WHERE id=${productsTable.categoryId}
        UNION ALL SELECT c.id,c.parent_id,c.supplier_id,c.active
          FROM product_categories c JOIN ancestors a ON a.parent_id=c.id
      )
      SELECT 1 FROM ancestors HAVING bool_and(active) AND bool_and(supplier_id=${supplierId})
    )`,
  )!;
}
function publicVariantInventoryModel(product: typeof productsTable.$inferSelect) {
  const variants = product.variants ?? [];
  if (!variants.length || variants.every((variant) => variant.stock == null)) return { kind: "shared" as const, variants };
  if (!variants.every((variant) => variant.stock != null)) return { kind: "invalid" as const, variants };
  const total = variants.reduce((sum, variant) => sum + Math.max(0, variant.stock!), 0);
  return total === product.stock
    ? { kind: "per-variant" as const, variants, total }
    : { kind: "invalid" as const, variants };
}

function publicBase(product: typeof productsTable.$inferSelect) {
  const configuredPrice = product.publicPrice!;
  const sale = activeProductSale(product, "B2C");
  const inventory = publicVariantInventoryModel(product);
  const effectiveStock = inventory.kind === "invalid"
    ? 0
    : inventory.kind === "per-variant" ? inventory.total : Math.max(0, product.stock);
  const priceOnRequest = product.priceOnRequest || effectiveStock === 0;
  const price = priceOnRequest ? null : configuredPrice;
  const discountPrice = priceOnRequest ? null : sale?.price ?? null;
  return {
    id: product.id, supplierId: product.supplierId, name: product.name, category: product.categoryName,
    categoryId: product.categoryId, subcategory: product.subcategoryName, brand: product.brand,
    description: product.publicDescription!, imageUrl: product.imageUrl, images: product.images ?? [],
    price, discountPrice, saleEndsAt: discountPrice ? sale?.endsAt ?? null : null,
    discountPercent: discountPrice ? Math.round((1 - discountPrice / configuredPrice) * 100) : null,
    priceOnRequest, cartEligible: !priceOnRequest,
    unit: product.unit, isNew: product.isNew, isBestseller: product.isBestseller,
    deliveryBusinessDaysOverride: product.deliveryBusinessDaysOverride,
    characteristics: product.characteristics,
    subscriptionAllowed: product.subscriptionAllowed,
    subscriptionDiscountPercent: product.subscriptionAllowed ? product.subscriptionDiscountPercent : null,
    reviewSummary: { averageRating: product.averageRating, reviewCount: product.reviewCount },
    variantType: product.variantType ?? null,
    variants: (product.variants ?? []).map((variant) => ({
      value: variant.value,
      label: variant.label,
      cartEligible: inventory.kind !== "invalid"
        && (inventory.kind === "per-variant" ? variant.stock! > 0 : product.stock > 0),
      swatch: variant.swatch ?? null,
      imageUrl: variant.mainImageUrl ?? null,
    })),
  };
}

const VIEWER_COOKIE = "lumera_b2c_viewer";
const viewerCookieOptions = {
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production",
  maxAge: 1000 * 60 * 60 * 24 * 30, path: "/",
};
function viewerHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function recordRecentlyViewed(req: Request, res: Response, productId: string, maximum: number) {
  const user = await getCurrentUser(req);
  const guestToken = typeof req.cookies?.[VIEWER_COOKIE] === "string" ? req.cookies[VIEWER_COOKIE] : null;
  const now = new Date();

  if (user) {
    // Claim exactly the history presented by this browser once.  Conflicting
    // products retain the newer timestamp and the cookie is retired, so a
    // subsequently signed-in account cannot inherit this browser's old rows.
    await claimRecentlyViewedForUser(req, res, user.id);
    await db.execute(sql`
      INSERT INTO b2c_recently_viewed_products (user_id, product_id, last_viewed_at)
      VALUES (${user.id}::uuid, ${productId}::uuid, ${now})
      ON CONFLICT (user_id, product_id) WHERE user_id IS NOT NULL
      DO UPDATE SET last_viewed_at = excluded.last_viewed_at`);
    await db.execute(sql`
      DELETE FROM b2c_recently_viewed_products WHERE id IN (
        SELECT id FROM b2c_recently_viewed_products WHERE user_id = ${user.id}::uuid
        ORDER BY last_viewed_at DESC, id DESC OFFSET ${maximum}
      )`);
    return;
  }

  const token = guestToken ?? randomBytes(32).toString("base64url");
  const hash = viewerHash(token);
  if (!guestToken) res.cookie(VIEWER_COOKIE, token, viewerCookieOptions);
  await db.execute(sql`
    INSERT INTO b2c_recently_viewed_products (viewer_token_hash, product_id, last_viewed_at)
    VALUES (${hash}, ${productId}::uuid, ${now})
    ON CONFLICT (viewer_token_hash, product_id) WHERE viewer_token_hash IS NOT NULL
    DO UPDATE SET last_viewed_at = excluded.last_viewed_at`);
  await db.execute(sql`
    DELETE FROM b2c_recently_viewed_products WHERE id IN (
      SELECT id FROM b2c_recently_viewed_products WHERE viewer_token_hash = ${hash}
      ORDER BY last_viewed_at DESC, id DESC OFFSET ${maximum}
    )`);
}

/** Claiming is performed at sign-in, not on a passive recent-list read. */
export async function claimRecentlyViewedForUser(req: Request, res: Response, userId: string) {
  const token = typeof req.cookies?.[VIEWER_COOKIE] === "string" ? req.cookies[VIEWER_COOKIE] : null;
  if (!token) return;
  const hash = viewerHash(token);
  await db.transaction(async (tx) => {
    const [displaySettings] = await tx.select({ recentlyViewedMax: b2cDisplaySettingsTable.recentlyViewedMax })
      .from(b2cDisplaySettingsTable).limit(1);
    const maximum = displaySettings?.recentlyViewedMax ?? 12;
    await tx.execute(sql`
      INSERT INTO b2c_recently_viewed_products (user_id, product_id, last_viewed_at)
      SELECT ${userId}::uuid, product_id, last_viewed_at
      FROM b2c_recently_viewed_products WHERE viewer_token_hash = ${hash}
      ON CONFLICT (user_id, product_id) WHERE user_id IS NOT NULL
      DO UPDATE SET last_viewed_at = greatest(b2c_recently_viewed_products.last_viewed_at, excluded.last_viewed_at)`);
    await tx.delete(b2cRecentlyViewedProductsTable)
      .where(eq(b2cRecentlyViewedProductsTable.viewerTokenHash, hash));
    await tx.execute(sql`
      DELETE FROM b2c_recently_viewed_products WHERE id IN (
        SELECT id FROM b2c_recently_viewed_products WHERE user_id = ${userId}::uuid
        ORDER BY last_viewed_at DESC, id DESC OFFSET ${maximum}
      )`);
  });
  res.clearCookie(VIEWER_COOKIE, { path: "/" });
}

router.get("/suppliers/:supplierSlug/public-products", async (req, res, next) => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { res.status(404).json({ error: "Supplier not found." }); return; }
  try {
    const config = await settings();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || config.pageSize));
    const sort = String(req.query.sort ?? config.defaultSort) as Sort;
    if (!config.enabledSortOptions.includes(sort) || !SORTS.includes(sort)) { res.status(400).json({ error: "Sort is not enabled." }); return; }
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : "";
    const categoryIds = categoryId ? await categorySubtree(supplier.id, categoryId) : [];
    if (categoryId && !categoryIds.length) { res.status(404).json({ error: "Category not found." }); return; }
    const min = req.query.minPrice == null ? undefined : Number(req.query.minPrice);
    const max = req.query.maxPrice == null ? undefined : Number(req.query.maxPrice);
    if ((min != null && (!Number.isFinite(min) || min < 0)) || (max != null && (!Number.isFinite(max) || max < 0)) || (min != null && max != null && min > max)) {
      res.status(400).json({ error: "Price range is invalid." }); return;
    }
    const f: FilterInput = {
      search: typeof req.query.search === "string" ? req.query.search.trim().slice(0, 200) : undefined,
      categoryIds, brands: list(req.query.brand), types: list(req.query.productType), tags: list(req.query.needTag),
      min, max, showOutOfStock: config.showOutOfStock,
    };
    const where = productConditions(supplier.id, f);
    const relevance = f.search ? desc(sql`CASE WHEN lower(${productsTable.name}) = ${f.search.toLowerCase()} THEN 3
      WHEN lower(${productsTable.name}) LIKE ${`%${f.search.toLowerCase()}%`} THEN 2 ELSE 1 END`) : undefined;
    const ordering = relevance ? [relevance, desc(sql`similarity(lower(${productsTable.name}), ${f.search!.toLowerCase()})`), asc(productsTable.id)]
      : sort === "PRICE_ASC" ? [asc(priceExpr), asc(productsTable.id)]
      : sort === "PRICE_DESC" ? [desc(priceExpr), asc(productsTable.id)]
      : sort === "NEWEST" ? [desc(productsTable.createdAt), asc(productsTable.id)]
      : sort === "BEST_RATED" ? [desc(ratingExpr), desc(productsTable.createdAt), asc(productsTable.id)]
      : sort === "MOST_POPULAR" ? [desc(popularityExpr), desc(productsTable.createdAt), asc(productsTable.id)]
      : [desc(productsTable.isBestseller), desc(productsTable.isNew), desc(productsTable.createdAt), asc(productsTable.id)];
    const [totalRows, products, categoryFacets, facetCategories, brandFacets, typeFacets, tagFacets] = await Promise.all([
      db.select({ value: count() }).from(productsTable).where(where),
      db.select().from(productsTable).where(where).orderBy(...ordering).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ id: productsTable.categoryId, count: count() }).from(productsTable).where(productConditions(supplier.id, f, "category")).groupBy(productsTable.categoryId),
      db.select({ id: productCategoriesTable.id, parentId: productCategoriesTable.parentId, name: productCategoriesTable.name })
        .from(productCategoriesTable).where(and(eq(productCategoriesTable.supplierId, supplier.id), eq(productCategoriesTable.active, true))),
      db.select({ value: productsTable.brand, count: count() }).from(productsTable).where(productConditions(supplier.id, f, "brand")).groupBy(productsTable.brand),
      db.select({ id: b2cProductTypesTable.id, value: b2cProductTypesTable.slug, label: b2cProductTypesTable.label, count: count() })
        .from(productsTable).innerJoin(b2cProductTypesTable, eq(productsTable.productTypeId, b2cProductTypesTable.id))
        .where(and(productConditions(supplier.id, f, "type"), eq(b2cProductTypesTable.active, true))).groupBy(b2cProductTypesTable.id),
      db.select({ id: b2cNeedTagsTable.id, value: b2cNeedTagsTable.key, label: b2cNeedTagsTable.label, count: sql<number>`count(distinct ${productsTable.id})` })
        .from(productsTable).innerJoin(b2cProductNeedTagsTable, eq(productsTable.id, b2cProductNeedTagsTable.productId))
        .innerJoin(b2cNeedTagsTable, eq(b2cProductNeedTagsTable.needTagId, b2cNeedTagsTable.id))
        .where(and(productConditions(supplier.id, f, "tag"), eq(b2cNeedTagsTable.active, true))).groupBy(b2cNeedTagsTable.id),
    ]);
    const total = Number(totalRows[0]?.value ?? 0);
    const prices = await db.select({ min: sql<number>`min(${priceExpr})`, max: sql<number>`max(${priceExpr})` }).from(productsTable)
      .where(productConditions(supplier.id, { ...f, min: undefined, max: undefined }));
    res.json({
      items: products.map(publicBase), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      activeRange: { minPrice: prices[0]?.min == null ? null : Number(prices[0].min), maxPrice: prices[0]?.max == null ? null : Number(prices[0].max) },
      facets: {
        categories: facetCategories.map((category) => {
          const direct = new Map(categoryFacets.map((item) => [item.id, Number(item.count)]));
          const descendants = new Set([category.id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const candidate of facetCategories) if (candidate.parentId && descendants.has(candidate.parentId) && !descendants.has(candidate.id)) {
              descendants.add(candidate.id); changed = true;
            }
          }
          return { id: category.id, label: category.name, count: [...descendants].reduce((sum, id) => sum + (direct.get(id) ?? 0), 0) };
        }),
        brands: brandFacets.filter((x) => x.value).map((x) => ({ value: x.value, count: Number(x.count) })),
        productTypes: typeFacets.map((x) => ({ ...x, count: Number(x.count) })),
        needTags: tagFacets.map((x) => ({ ...x, count: Number(x.count) })),
      },
    });
  } catch (error) { next(error); }
});

router.get("/suppliers/:supplierSlug/public-products/:productId", async (req, res, next) => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { res.status(404).json({ error: "Supplier not found." }); return; }
  const [product] = await db.select().from(productsTable).where(and(
    eq(productsTable.id, req.params.productId!),
    productConditions(supplier.id, { categoryIds: [], brands: [], types: [], tags: [], showOutOfStock: true }),
  )).limit(1);
  if (!product) { next(); return; } // Preserve the existing detail route's related-products behavior.
  const [productType, needTags] = await Promise.all([
    product.productTypeId ? db.select({ slug: b2cProductTypesTable.slug, label: b2cProductTypesTable.label })
      .from(b2cProductTypesTable).where(and(eq(b2cProductTypesTable.id, product.productTypeId), eq(b2cProductTypesTable.active, true))).limit(1) : [],
    db.select({ key: b2cNeedTagsTable.key, label: b2cNeedTagsTable.label }).from(b2cProductNeedTagsTable)
      .innerJoin(b2cNeedTagsTable, eq(b2cProductNeedTagsTable.needTagId, b2cNeedTagsTable.id))
      .where(and(eq(b2cProductNeedTagsTable.productId, product.id), eq(b2cNeedTagsTable.active, true)))
      .orderBy(asc(b2cNeedTagsTable.sortOrder), asc(b2cNeedTagsTable.id)),
  ]);
  const relationIds = product.similarProductsMode === "MANUAL" ? product.similarProductIds : [];
  const relatedWhere = and(
    canonicalPublicProductCondition(supplier.id),
    relationIds.length
      ? inArray(productsTable.id, relationIds)
      : product.categoryId ? eq(productsTable.categoryId, product.categoryId) : eq(productsTable.categoryName, product.categoryName),
    sql`${productsTable.id} <> ${product.id}`,
  );
  const relatedRows = await db.select().from(productsTable).where(relatedWhere).limit(12);
  const byId = new Map(relatedRows.map((item) => [item.id, item]));
  const related = relationIds.length
    ? relationIds.map((id) => byId.get(id)).filter((item): item is typeof relatedRows[number] => Boolean(item))
    : relatedRows;
  res.json({ ...publicBase(product), ingredients: product.ingredients, usageInstructions: product.usageInstructions,
    productType: productType[0] ?? null, needTags, relatedProducts: related.slice(0, 8).map((item) => {
      const view = publicBase(item);
      return {
        id: item.id, name: item.name, imageUrl: item.imageUrl, brand: item.brand,
        price: view.price, discountPrice: view.discountPrice, saleEndsAt: view.saleEndsAt,
        priceOnRequest: view.priceOnRequest, cartEligible: view.cartEligible,
      };
    }) });
});

// This intentionally does not mint a viewer cookie: passive reads must not
// create either cart or browsing identity state.
router.get("/suppliers/:supplierSlug/recently-viewed", async (req, res) => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { res.status(404).json({ error: "Supplier not found." }); return; }
  const config = await settings();
  if (!config.recentlyViewedEnabled) { res.json([]); return; }
  const user = await getCurrentUser(req);
  const token = typeof req.cookies?.[VIEWER_COOKIE] === "string" ? req.cookies[VIEWER_COOKIE] : null;
  if (!user && !token) { res.json([]); return; }
  const owner = user
    ? eq(b2cRecentlyViewedProductsTable.userId, user.id)
    : eq(b2cRecentlyViewedProductsTable.viewerTokenHash, viewerHash(token!));
  const rows = await db.select({ product: productsTable }).from(b2cRecentlyViewedProductsTable)
    .innerJoin(productsTable, eq(b2cRecentlyViewedProductsTable.productId, productsTable.id))
    .where(and(owner, productConditions(supplier.id, {
      categoryIds: [], brands: [], types: [], tags: [], showOutOfStock: config.showOutOfStock,
    })))
    .orderBy(desc(b2cRecentlyViewedProductsTable.lastViewedAt), desc(b2cRecentlyViewedProductsTable.id))
    .limit(config.recentlyViewedMax);
  res.json(rows.map(({ product }) => publicBase(product)));
});

// Kept for API clients that record a completed product-detail render
// themselves. It applies precisely the same public eligibility guard as GET
// detail and is naturally idempotent per viewer/product.
router.post("/suppliers/:supplierSlug/recently-viewed/:productId", async (req, res) => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { res.status(404).json({ error: "Supplier not found." }); return; }
  const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(and(
    eq(productsTable.id, req.params.productId!),
    productConditions(supplier.id, { categoryIds: [], brands: [], types: [], tags: [], showOutOfStock: true }),
  )).limit(1);
  if (!product) { res.status(404).json({ error: "Product not found." }); return; }
  const config = await settings();
  if (config.recentlyViewedEnabled) await recordRecentlyViewed(req, res, product.id, config.recentlyViewedMax);
  res.status(204).end();
});

router.get("/suppliers/:supplierSlug/public-products/:productId/reviews", async (req, res): Promise<void> => {
  const supplier = await activeB2cSupplier(req.params.supplierSlug!);
  if (!supplier) { res.status(404).json({ error: "Supplier not found." }); return; }
  const [product] = await db.select({
    id: productsTable.id, averageRating: productsTable.averageRating, reviewCount: productsTable.reviewCount,
  }).from(productsTable).where(and(
    eq(productsTable.id, req.params.productId!),
    canonicalPublicProductCondition(supplier.id),
  )).limit(1);
  if (!product) { res.status(404).json({ error: "Product not found." }); return; }
  const rows = await db.select({
    review: retailProductReviewsTable, firstName: usersTable.firstName, lastName: usersTable.lastName,
  }).from(retailProductReviewsTable).innerJoin(usersTable, eq(retailProductReviewsTable.userId, usersTable.id))
    .where(and(eq(retailProductReviewsTable.productId, product.id), eq(retailProductReviewsTable.moderationStatus, "PUBLISHED")))
    .orderBy(desc(retailProductReviewsTable.createdAt), desc(retailProductReviewsTable.id));
  res.json({
    summary: { averageRating: product.averageRating, reviewCount: product.reviewCount },
    items: rows.map(({ review, firstName, lastName }) => ({
      id: review.id, rating: review.rating, comment: review.comment, verifiedPurchase: true,
      reviewerName: `${firstName} ${lastName.slice(0, 1)}.`.trim(), createdAt: review.createdAt, updatedAt: review.updatedAt,
    })),
  });
});

export default router;