import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  b2bQuotesTable, catalogSyncRunsTable, db, emailDeliveriesTable, priceInquiriesTable,
  orderItemsTable, ordersTable, productsTable, retailOrderItemsTable, retailOrdersTable, reviewRewardIssuancesTable, rmaAttachmentsTable, rmaStatusHistoryTable, rmasTable, salonsTable, shopSettingsTable,
  shoppingCartItemsTable, shoppingCartsTable, suppliersTable, usersTable,
} from "@workspace/db";
import { getCurrentUser, isAdmin } from "../lib/auth";
import { canClaimMediaReference, claimMediaReference, mediaAssetIdFromUrl } from "./media";
import { activeProductSale } from "../lib/active-product-sale";

const router: IRouter = Router();
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function auth(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) res.status(401).json({ error: "Authentication required." });
  return user;
}
async function admin(req: Request, res: Response) {
  const user = await auth(req, res);
  if (user && !isAdmin(user)) { res.status(403).json({ error: "Administrator access required." }); return null; }
  return user;
}
async function salonFor(userId: string) {
  const [user] = await db.select({ activeSalonId: usersTable.activeSalonId }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const [salon] = await db.select().from(salonsTable).where(and(
    eq(salonsTable.ownerId, userId),
    user?.activeSalonId ? eq(salonsTable.id, user.activeSalonId) : sql`true`,
  )).orderBy(asc(salonsTable.createdAt)).limit(1);
  return salon ?? null;
}
function canonicalOrigin() {
  const raw = process.env["APP_BASE_URL"]?.trim();
  if (!raw) throw new Error("APP_BASE_URL is required for canonical catalog URLs.");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/") {
    throw new Error("APP_BASE_URL must be a canonical origin without credentials or path.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("APP_BASE_URL must use HTTPS in production.");
  return url.origin;
}
function effectiveStock(product: typeof productsTable.$inferSelect) {
  const variants = product.variants ?? [];
  if (!variants.length || variants.every((variant) => variant.stock == null)) return Math.max(0, product.stock);
  if (!variants.every((variant) => variant.stock != null)) return 0;
  const total = variants.reduce((sum, variant) => sum + Math.max(0, variant.stock!), 0);
  return total === product.stock ? total : 0;
}
export function validatedSwatch(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const swatch = value as Record<string, unknown>;
  if (swatch.kind === "COLOR" && typeof swatch.hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(swatch.hex)) return { kind: "COLOR" as const, hex: swatch.hex.toUpperCase() };
  if (swatch.kind === "TEXT" && typeof swatch.text === "string" && swatch.text.trim().length > 0 && swatch.text.length <= 80) return { kind: "TEXT" as const, text: swatch.text.trim() };
  if (swatch.kind === "IMAGE" && typeof swatch.imageUrl === "string" && /^\/api\/media\/[0-9a-f-]{36}(?:\?|$)/i.test(swatch.imageUrl)) return { kind: "IMAGE" as const, imageUrl: swatch.imageUrl };
  return null;
}

router.get("/catalog/feed", async (_req, res): Promise<void> => {
  let origin: string;
  try { origin = canonicalOrigin(); } catch (error) { res.status(503).json({ error: (error as Error).message }); return; }
  const rows = await db.select({ product: productsTable, supplier: suppliersTable }).from(productsTable)
    .innerJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
    .where(and(eq(productsTable.active, true), eq(productsTable.retailEnabled, true), eq(suppliersTable.active, true), inArray(suppliersTable.scope, ["B2C", "BOTH"])))
    .orderBy(asc(productsTable.catalogReference));
  res.json({
    generatedAt: new Date().toISOString(),
    items: rows.filter(({ product }) => !product.priceOnRequest && effectiveStock(product) > 0).map(({ product, supplier }) => ({
      id: product.catalogReference,
      title: product.name,
      supplier: supplier.name,
      url: `${origin}/shop/${encodeURIComponent(supplier.slug)}/proizvod/${product.id}`,
      price: activeProductSale(product, "B2C")?.price ?? product.publicPrice,
      currency: "RSD",
      availability: "in_stock",
      images: [product.imageUrl, ...product.images].filter((value, index, all) => value && all.indexOf(value) === index),
    })),
  });
});

router.get("/public/products/:productId/bulk-matrix", async (req, res): Promise<void> => {
  const productId = Array.isArray(req.params.productId) ? req.params.productId[0]! : req.params.productId!;
  const [product] = await db.select().from(productsTable).where(and(eq(productsTable.id, productId), eq(productsTable.active, true), eq(productsTable.professionalEnabled, true))).limit(1);
  if (!product || !product.bulkMatrixEnabled) { res.status(404).json({ error: "Bulk matrix not available." }); return; }
  const priceOnRequest = product.priceOnRequest || effectiveStock(product) === 0;
  res.json({
    productId: product.id, priceOnRequest, cartEligible: !priceOnRequest,
    rows: (product.variants ?? []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.value.localeCompare(b.value)).map((variant) => {
      const stock = variant.stock == null ? Math.max(0, product.stock) : Math.max(0, variant.stock);
      const unitPrice = variant.price ?? Math.max(0, activeProductSale(product, "B2B")?.price ?? product.price) + (variant.priceAdjust ?? 0);
      return {
        value: variant.value, label: variant.label, sku: variant.sku ?? null, available: stock > 0,
        stock, swatch: validatedSwatch(variant.swatch), mainImageUrl: variant.mainImageUrl ?? null,
        altText: variant.altText ?? null, sortOrder: variant.sortOrder ?? 0,
        ...(priceOnRequest ? {} : { unitPrice, tierPricePreview: product.quantityPricingTiers.map((tier) => ({ minQuantity: tier.minQuantity, maxQuantity: tier.maxQuantity, unitPrice: Math.min(unitPrice, tier.unitPrice) })) }),
      };
    }),
  });
});

router.post("/public/suppliers/:supplierId/products/:productId/price-inquiries", async (req, res): Promise<void> => {
  const name = clean(req.body?.name, 120), email = clean(req.body?.email, 254).toLowerCase();
  const phone = clean(req.body?.phone, 40), message = clean(req.body?.message, 2_000);
  if (name.length < 2 || !emailPattern.test(email) || phone.length < 6 || message.length < 10) {
    res.status(400).json({ error: "Valid name, email, phone and message are required." }); return;
  }
  const [row] = await db.select({ product: productsTable, supplier: suppliersTable }).from(productsTable)
    .innerJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
    .where(and(eq(productsTable.id, req.params.productId!), eq(suppliersTable.id, req.params.supplierId!), eq(productsTable.active, true), eq(suppliersTable.active, true))).limit(1);
  if (!row) { res.status(404).json({ error: "Product not found in supplier scope." }); return; }
  if (!row.product.priceOnRequest && effectiveStock(row.product) > 0) { res.status(409).json({ error: "This product has a public price." }); return; }
  const [created] = await db.insert(priceInquiriesTable).values({ supplierId: row.supplier.id, productId: row.product.id, name, email, phone, message }).returning();
  res.status(201).json({ id: created!.id, status: created!.status, createdAt: created!.createdAt });
});

router.get("/admin/price-inquiries", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  res.json(await db.select({
    id: priceInquiriesTable.id,
    supplierId: priceInquiriesTable.supplierId,
    productId: priceInquiriesTable.productId,
    productName: productsTable.name,
    supplierName: suppliersTable.name,
    contactName: priceInquiriesTable.name,
    contactEmail: priceInquiriesTable.email,
    contactPhone: priceInquiriesTable.phone,
    message: priceInquiriesTable.message,
    status: priceInquiriesTable.status,
    internalNote: priceInquiriesTable.internalNote,
    createdAt: priceInquiriesTable.createdAt,
    updatedAt: priceInquiriesTable.updatedAt,
  }).from(priceInquiriesTable)
    .innerJoin(productsTable, eq(priceInquiriesTable.productId, productsTable.id))
    .innerJoin(suppliersTable, eq(priceInquiriesTable.supplierId, suppliersTable.id))
    .orderBy(desc(priceInquiriesTable.createdAt)).limit(500));
});
router.patch("/admin/price-inquiries/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const status = req.body?.status;
  if (status !== undefined && !["NEW", "CONTACTED", "CLOSED"].includes(status)) { res.status(400).json({ error: "Invalid status." }); return; }
  const [updated] = await db.update(priceInquiriesTable).set({
    ...(status ? { status } : {}), ...(req.body?.internalNote !== undefined ? { internalNote: clean(req.body.internalNote, 5_000) || null } : {}),
    updatedAt: new Date(),
  }).where(eq(priceInquiriesTable.id, req.params.id!)).returning();
  if (!updated) { res.status(404).json({ error: "Inquiry not found." }); return; }
  res.json(updated);
});

router.post("/shop/quotes", async (req, res): Promise<void> => {
  const user = await auth(req, res); if (!user) return;
  let origin: string;
  try { origin = canonicalOrigin(); } catch (error) { res.status(503).json({ error: (error as Error).message }); return; }
  const salon = await salonFor(user.id); if (!salon) { res.status(403).json({ error: "Salon owner access required." }); return; }
  const [cart] = await db.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salon.id)).limit(1);
  const items = cart ? await db.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cart.id)).orderBy(asc(shoppingCartItemsTable.createdAt)) : [];
  if (!cart || !items.length) { res.status(400).json({ error: "Cart is empty." }); return; }
  const [settings] = await db.select().from(shopSettingsTable).limit(1);
  const validityDays = req.body?.validityDays === undefined ? (settings?.quoteValidityDays ?? 7) : Number(req.body.validityDays);
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 90) { res.status(400).json({ error: "Validity must be 1-90 days." }); return; }
  const total = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const withoutVat = Math.round(total / 1.2);
  const [quote] = await db.insert(b2bQuotesTable).values({
    publicId: randomBytes(24).toString("base64url"), salonId: salon.id, sourceCartId: cart.id,
    customerCompanyName: clean(req.body?.customerCompanyName, 200) || null,
    sellerSnapshot: {
      companyName: settings?.sellerCompanyName ?? "LUMERA", taxId: settings?.sellerTaxId ?? undefined,
      registrationNumber: settings?.sellerRegistrationNumber ?? undefined, address: settings?.sellerAddress ?? undefined,
      city: settings?.sellerCity ?? undefined, postalCode: settings?.sellerPostalCode ?? undefined,
      bankAccount: settings?.sellerBankAccount ?? undefined, email: settings?.sellerContactEmail ?? undefined, phone: settings?.sellerContactPhone ?? undefined,
    },
    itemSnapshots: items.map((item) => ({ productId: item.productId, bundleId: item.bundleId, productName: item.productName,
      productImageUrl: item.productImageUrl, variantValue: item.variantValue, variantLabel: item.variantLabel,
      productSku: item.productSku, unitPrice: item.unitPrice, quantity: item.quantity, lineTotal: item.unitPrice * item.quantity })),
    subtotalWithoutVat: withoutVat, vatAmount: total - withoutVat, totalWithVat: total,
    validUntil: new Date(Date.now() + validityDays * 86_400_000),
  }).returning();
  res.status(201).json({ ...quote, publicUrl: `${origin}/ponuda/${quote!.publicId}` });
});

router.post("/shop/cart/bulk-matrix", async (req, res): Promise<void> => {
  const user = await auth(req, res); if (!user) return;
  const salon = await salonFor(user.id); if (!salon) { res.status(403).json({ error: "Salon owner access required." }); return; }
  const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rawRows.length || rawRows.length > 200) { res.status(400).json({ error: "Between 1 and 200 rows are required." }); return; }
  const requested = new Map<string, { productId: string; variantValue: string; quantity: number }>();
  for (const raw of rawRows) {
    const productId = clean(raw?.productId, 50), variantValue = clean(raw?.variantValue, 200), quantity = Number(raw?.quantity);
    if (!productId || !variantValue || !Number.isInteger(quantity) || quantity <= 0 || quantity > 10_000) {
      res.status(400).json({ error: "Every row requires a product, variant and positive integer quantity." }); return;
    }
    const key = `${productId}\0${variantValue}`;
    const previous = requested.get(key);
    requested.set(key, { productId, variantValue, quantity: quantity + (previous?.quantity ?? 0) });
  }
  try {
    const result = await db.transaction(async (tx) => {
      // Cart precedes products everywhere in this operation; products are then
      // locked by stable UUID order so concurrent matrices cannot deadlock.
      let [cart] = await tx.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salon.id)).for("update").limit(1);
      if (!cart) {
        [cart] = await tx.insert(shoppingCartsTable).values({ salonId: salon.id }).onConflictDoNothing().returning();
        if (!cart) [cart] = await tx.select().from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, salon.id)).for("update").limit(1);
      }
      const productIds = [...new Set([...requested.values()].map((row) => row.productId))].sort();
      const products = await tx.select().from(productsTable).where(inArray(productsTable.id, productIds)).orderBy(asc(productsTable.id)).for("update");
      const byId = new Map(products.map((product) => [product.id, product]));
      // Cart rows are locked after cart/product locks. Include them in every
      // availability check: adding a row can never silently overbook stock.
      const existing = await tx.select().from(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cart!.id)).for("update");
      const additions = [];
      for (const row of requested.values()) {
        const product = byId.get(row.productId);
        const variant = product?.variants?.find((candidate) => candidate.value === row.variantValue);
        if (!product || !product.active || !product.professionalEnabled || !product.bulkMatrixEnabled || !variant) throw new Error(`INVALID:${row.productId}:${row.variantValue}`);
        const current = existing.find((item) => item.productId === product.id && item.variantValue === variant.value);
        // Null variant stock means this variant consumes product-level shared
        // inventory, rather than being unavailable.
        const requestedForProduct = [...requested.values()].filter((candidate) => candidate.productId === product.id
          && product.variants?.find((v) => v.value === candidate.variantValue)?.stock == null).reduce((sum, candidate) => sum + candidate.quantity, 0);
        const existingShared = existing.filter((item) => item.productId === product.id
          && product.variants?.find((v) => v.value === item.variantValue)?.stock == null).reduce((sum, item) => sum + item.quantity, 0);
        const stock = variant.stock == null ? product.stock : variant.stock;
        if (product.priceOnRequest || effectiveStock(product) === 0 || (variant.stock == null
          ? requestedForProduct + existingShared > product.stock
          : row.quantity + (current?.quantity ?? 0) > stock)) throw new Error(`STOCK:${row.productId}:${row.variantValue}`);
        const unitPrice = variant.price ?? Math.max(0, activeProductSale(product, "B2B")?.price ?? product.price) + (variant.priceAdjust ?? 0);
        additions.push({ cartId: cart!.id, productId: product.id, bundleId: null, variantValue: variant.value,
          productName: product.name, productImageUrl: variant.mainImageUrl ?? product.imageUrl, variantLabel: variant.label,
          productSku: variant.sku ?? product.sku, unitPrice, quantity: row.quantity });
      }
      for (const addition of additions) {
        const current = existing.find((item) => item.productId === addition.productId && item.variantValue === addition.variantValue);
        if (current) await tx.update(shoppingCartItemsTable).set({ quantity: current.quantity + addition.quantity, unitPrice: addition.unitPrice, updatedAt: new Date() }).where(eq(shoppingCartItemsTable.id, current.id));
        else await tx.insert(shoppingCartItemsTable).values(addition);
      }
      return { cartId: cart!.id, addedRows: additions.length };
    });
    res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("INVALID:") || message.startsWith("STOCK:")) { res.status(409).json({ error: "Bulk matrix changed or has insufficient stock.", detail: message }); return; }
    throw error;
  }
});

async function ownedQuote(req: Request, res: Response) {
  const user = await auth(req, res); if (!user) return null;
  const salon = await salonFor(user.id); if (!salon) { res.status(403).json({ error: "Salon owner access required." }); return null; }
  const publicId = Array.isArray(req.params.publicId) ? req.params.publicId[0]! : req.params.publicId!;
  const [quote] = await db.select().from(b2bQuotesTable).where(and(eq(b2bQuotesTable.publicId, publicId), eq(b2bQuotesTable.salonId, salon.id))).limit(1);
  if (!quote) res.status(404).json({ error: "Quote not found." });
  return quote ?? null;
}
router.get("/shop/quotes/:publicId", async (req, res): Promise<void> => { const quote = await ownedQuote(req, res); if (quote) res.json(quote); });
router.post("/shop/quotes/:publicId/restore-cart", async (req, res): Promise<void> => {
  const quote = await ownedQuote(req, res); if (!quote) return;
  if (quote.validUntil.getTime() <= Date.now()) {
    res.status(409).json({ error: "Ponuda je istekla i više se ne može vratiti u korpu.", code: "QUOTE_EXPIRED" });
    return;
  }
  const cart = await db.transaction(async (tx) => {
    const lockedResult = await tx.execute<{ id: string }>(sql`SELECT id FROM shopping_carts WHERE salon_id = ${quote.salonId} FOR UPDATE`);
    const [locked] = lockedResult.rows;
    let cartId = locked?.id;
    if (!cartId) {
      const [created] = await tx.insert(shoppingCartsTable).values({ salonId: quote.salonId }).onConflictDoNothing().returning();
      cartId = created?.id ?? (await tx.select({ id: shoppingCartsTable.id }).from(shoppingCartsTable).where(eq(shoppingCartsTable.salonId, quote.salonId)).limit(1))[0]!.id;
    }
    await tx.delete(shoppingCartItemsTable).where(eq(shoppingCartItemsTable.cartId, cartId));
    if (quote.itemSnapshots.length) await tx.insert(shoppingCartItemsTable).values(quote.itemSnapshots.map((item) => ({
      cartId, productId: item.productId, bundleId: item.bundleId, variantValue: item.variantValue,
      productName: item.productName, productImageUrl: item.productImageUrl, variantLabel: item.variantLabel,
      productSku: item.productSku, unitPrice: item.unitPrice, quantity: item.quantity,
    })));
    return { id: cartId, items: quote.itemSnapshots };
  });
  res.json(cart);
});
router.get("/shop/quotes/:publicId/pdf", async (req, res): Promise<void> => {
  const quote = await ownedQuote(req, res); if (!quote) return;
  res.type("application/pdf"); res.setHeader("Content-Disposition", `inline; filename=\"quote-${quote.publicId}.pdf\"`);
  const pdf = new PDFDocument({ margin: 48 }); pdf.pipe(res);
  pdf.fontSize(20).text("LUMERA B2B ponuda").moveDown().fontSize(10);
  pdf.text(`Broj: ${quote.publicId}`).text(`Vazi do: ${quote.validUntil.toISOString().slice(0, 10)}`).moveDown();
  for (const item of quote.itemSnapshots) pdf.text(`${item.productName}${item.variantLabel ? ` - ${item.variantLabel}` : ""}  ${item.quantity} x ${item.unitPrice} RSD = ${item.lineTotal} RSD`);
  pdf.moveDown().text(`Osnovica: ${quote.subtotalWithoutVat} RSD`).text(`PDV: ${quote.vatAmount} RSD`).fontSize(12).text(`Ukupno: ${quote.totalWithVat} RSD`);
  pdf.end();
});

router.get("/admin/quotes", async (req, res): Promise<void> => { if (await admin(req, res)) res.json(await db.select().from(b2bQuotesTable).orderBy(desc(b2bQuotesTable.createdAt)).limit(500)); });
router.get("/admin/catalog/meta/status", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const [latest] = await db.select().from(catalogSyncRunsTable).orderBy(desc(catalogSyncRunsTable.createdAt)).limit(1);
  res.json({ connectionStatus: "NOT_CONNECTED", canSync: false, latestRun: latest ?? null });
});

router.post("/orders/:orderId/rmas", async (req, res): Promise<void> => {
  const user = await auth(req, res); if (!user) return;
  if (!["CUSTOMER", "JOBSEEKER", "SALON_OWNER"].includes(user.role)) { res.status(403).json({ error: "Order owner access required." }); return; }
  const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0]! : req.params.orderId!;
  const orderItemId = clean(req.body?.orderItemId, 50), quantity = Number(req.body?.quantity);
  const reason = clean(req.body?.reason, 120), description = clean(req.body?.description, 3_000);
  const photoUrls = Array.isArray(req.body?.photoUrls) ? req.body.photoUrls.filter((url: unknown): url is string => typeof url === "string").slice(0, 6) : [];
  if (!orderItemId || !Number.isInteger(quantity) || quantity < 1 || reason.length < 2 || description.length < 10) { res.status(400).json({ error: "Valid item, quantity, reason and description are required." }); return; }
  const [owned] = await db.select({ order: ordersTable, item: orderItemsTable, ownerId: salonsTable.ownerId }).from(ordersTable)
    .innerJoin(salonsTable, eq(ordersTable.salonId, salonsTable.id)).innerJoin(orderItemsTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(eq(ordersTable.id, orderId), eq(orderItemsTable.id, orderItemId), eq(salonsTable.ownerId, user.id))).limit(1);
  if (!owned) { res.status(404).json({ error: "Eligible owned order item not found." }); return; }
  if (owned.order.status !== "delivered" || quantity > owned.item.quantity) { res.status(409).json({ error: "Only delivered item quantities are eligible." }); return; }
  for (const url of photoUrls) {
    if (!await canClaimMediaReference({ userId: user.id, url, scope: "rma-photo" })) { res.status(400).json({ error: "Every photo must be a private managed upload owned by the requester." }); return; }
  }
  try {
    const created = await db.transaction(async (tx) => {
      // Canonical RMA lock order: target order item, then prior claims.  A
      // REJECTED RMA deliberately releases its quantity for a corrected claim.
      const [lockedItem] = await tx.select().from(orderItemsTable).where(and(eq(orderItemsTable.id, orderItemId), eq(orderItemsTable.orderId, orderId))).for("update");
      if (!lockedItem) throw new Error("INELIGIBLE");
      const claims = await tx.select({ quantity: rmasTable.quantity }).from(rmasTable)
        .where(and(eq(rmasTable.orderItemId, orderItemId), sql`${rmasTable.status} <> 'REJECTED'`)).for("update");
      if (quantity + claims.reduce((sum, claim) => sum + claim.quantity, 0) > lockedItem.quantity) throw new Error("CAPACITY");
      const [rma] = await tx.insert(rmasTable).values({
        rmaNumber: `RMA-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(6).toString("base64url").toUpperCase()}`,
        orderId, orderItemId, requesterUserId: user.id, quantity, reason, description,
      }).returning();
      for (const url of photoUrls) {
        if (!await claimMediaReference({ userId: user.id, url, scope: "rma-photo", resourceId: rma!.id, visibility: "private" }, tx)) throw new Error("MEDIA_CLAIM");
        await tx.insert(rmaAttachmentsTable).values({ rmaId: rma!.id, mediaAssetId: mediaAssetIdFromUrl(url)! });
      }
      await tx.insert(rmaStatusHistoryTable).values({ rmaId: rma!.id, actorUserId: user.id, previousStatus: null, nextStatus: "RECEIVED" });
      return rma!;
    });
    res.status(201).json(created);
  } catch (error) {
    if (["MEDIA_CLAIM", "CAPACITY", "INELIGIBLE"].includes((error as Error).message)) { res.status(409).json({ error: (error as Error).message === "MEDIA_CLAIM" ? "A photo was already claimed; no RMA was created." : "RMA quantity exceeds remaining claimable quantity." }); return; }
    throw error;
  }
});

async function adminRmaRows(condition: ReturnType<typeof eq> | ReturnType<typeof sql>, limit: number) {
  return db.select({
    rma: rmasTable,
    requester: {
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    },
    salon: {
      name: salonsTable.name,
      companyName: salonsTable.companyName,
      companyTaxId: salonsTable.companyTaxId,
      email: salonsTable.email,
    },
  }).from(rmasTable)
    .innerJoin(usersTable, eq(rmasTable.requesterUserId, usersTable.id))
    .leftJoin(ordersTable, eq(rmasTable.orderId, ordersTable.id))
    .leftJoin(salonsTable, eq(ordersTable.salonId, salonsTable.id))
    .where(condition)
    .orderBy(desc(rmasTable.createdAt))
    .limit(limit);
}

function adminRmaListDto(row: Awaited<ReturnType<typeof adminRmaRows>>[number]) {
  const target = row.rma.retailOrderId ? "b2c" as const : "b2b" as const;
  return {
    ...row.rma,
    target,
    orderId: row.rma.retailOrderId ?? row.rma.orderId!,
    owner: target === "b2c"
      ? row.requester
      : {
        businessName: row.salon?.companyName ?? row.salon?.name ?? "Nepoznat salon",
        pib: row.salon?.companyTaxId ?? null,
        email: row.salon?.email ?? row.requester.email,
      },
  };
}

router.get("/admin/rmas", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const rows = await adminRmaRows(sql`true`, 500);
  res.json(rows.map(adminRmaListDto));
});
router.get("/admin/rmas/:id", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id!;
  const [base] = await adminRmaRows(eq(rmasTable.id, id), 1);
  if (!base) { res.status(404).json({ error: "RMA not found." }); return; }
  const row = base.rma;
  const [history, attachments] = await Promise.all([
    db.select().from(rmaStatusHistoryTable).where(eq(rmaStatusHistoryTable.rmaId, row.id)).orderBy(asc(rmaStatusHistoryTable.createdAt)),
    db.select().from(rmaAttachmentsTable).where(eq(rmaAttachmentsTable.rmaId, row.id)),
  ]);
  const item = row.retailOrderItemId
    ? (await db.select({ orderItemId: retailOrderItemsTable.id, productName: retailOrderItemsTable.productName, quantity: rmasTable.quantity })
      .from(retailOrderItemsTable).innerJoin(rmasTable, eq(rmasTable.retailOrderItemId, retailOrderItemsTable.id))
      .where(eq(rmasTable.id, row.id)).limit(1))[0]
    : (await db.select({ orderItemId: orderItemsTable.id, productName: orderItemsTable.productName, quantity: rmasTable.quantity })
      .from(orderItemsTable).innerJoin(rmasTable, eq(rmasTable.orderItemId, orderItemsTable.id))
      .where(eq(rmasTable.id, row.id)).limit(1))[0];
  res.json({
    ...adminRmaListDto(base),
    items: item ? [item] : [],
    privatePhotos: attachments.map((attachment) => `/api/media/${attachment.mediaAssetId}`),
    auditTrail: history.map((entry) => ({
      action: `${entry.previousStatus ?? "CREATED"} → ${entry.nextStatus}`,
      timestamp: entry.createdAt,
      actorId: entry.actorUserId,
      note: null,
    })),
  });
});
router.post("/retail/orders/:orderId/rmas", async (req, res): Promise<void> => {
  const user = await auth(req, res); if (!user) return;
  if (!["CUSTOMER", "JOBSEEKER"].includes(user.role)) { res.status(403).json({ error: "Retail customer access required." }); return; }
  const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0]! : req.params.orderId!;
  const itemId = clean(req.body?.orderItemId, 50), quantity = Number(req.body?.quantity), reason = clean(req.body?.reason, 120), description = clean(req.body?.description, 3_000);
  const photos = Array.isArray(req.body?.photoUrls) ? req.body.photoUrls.filter((value: unknown): value is string => typeof value === "string").slice(0, 6) : [];
  if (!itemId || !Number.isInteger(quantity) || quantity < 1 || reason.length < 2 || description.length < 10) { res.status(400).json({ error: "Valid item, quantity, reason and description are required." }); return; }
  const [target] = await db.select({ order: retailOrdersTable, item: retailOrderItemsTable }).from(retailOrdersTable)
    .innerJoin(retailOrderItemsTable, eq(retailOrderItemsTable.orderId, retailOrdersTable.id))
    .where(and(eq(retailOrdersTable.id, orderId), eq(retailOrdersTable.userId, user.id), eq(retailOrderItemsTable.id, itemId))).limit(1);
  if (!target) { res.status(404).json({ error: "Eligible owned retail order item not found." }); return; }
  if (target.order.status !== "delivered" || quantity > target.item.quantity) { res.status(409).json({ error: "Only delivered item quantities are eligible." }); return; }
  for (const url of photos) if (!await canClaimMediaReference({ userId: user.id, url, scope: "rma-photo" })) { res.status(400).json({ error: "Every photo must be a private managed upload owned by the requester." }); return; }
  try {
    const rma = await db.transaction(async (tx) => {
      const [lockedItem] = await tx.select().from(retailOrderItemsTable).where(and(eq(retailOrderItemsTable.id, itemId), eq(retailOrderItemsTable.orderId, orderId))).for("update");
      if (!lockedItem) throw new Error("INELIGIBLE");
      const claims = await tx.select({ quantity: rmasTable.quantity }).from(rmasTable)
        .where(and(eq(rmasTable.retailOrderItemId, itemId), sql`${rmasTable.status} <> 'REJECTED'`)).for("update");
      if (quantity + claims.reduce((sum, claim) => sum + claim.quantity, 0) > lockedItem.quantity) throw new Error("CAPACITY");
      const [created] = await tx.insert(rmasTable).values({
        rmaNumber: `RMA-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(6).toString("base64url").toUpperCase()}`,
        retailOrderId: orderId, retailOrderItemId: itemId, requesterUserId: user.id, quantity, reason, description,
      }).returning();
      for (const url of photos) {
        if (!await claimMediaReference({ userId: user.id, url, scope: "rma-photo", resourceId: created!.id, visibility: "private" }, tx)) throw new Error("MEDIA_CLAIM");
        await tx.insert(rmaAttachmentsTable).values({ rmaId: created!.id, mediaAssetId: mediaAssetIdFromUrl(url)! });
      }
      await tx.insert(rmaStatusHistoryTable).values({ rmaId: created!.id, actorUserId: user.id, previousStatus: null, nextStatus: "RECEIVED" });
      return created!;
    });
    res.status(201).json(rma);
  } catch (error) {
    if (["MEDIA_CLAIM", "CAPACITY", "INELIGIBLE"].includes((error as Error).message)) { res.status(409).json({ error: (error as Error).message === "MEDIA_CLAIM" ? "A photo was already claimed; no RMA was created." : "RMA quantity exceeds remaining claimable quantity." }); return; }
    throw error;
  }
});
router.post("/admin/catalog/meta/validate", async (req, res): Promise<void> => {
  const user = await admin(req, res); if (!user) return;
  let errors: string[] = []; try { canonicalOrigin(); } catch (error) { errors = [(error as Error).message]; }
  const feedRows = await db.select({ product: productsTable }).from(productsTable)
    .innerJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
    .where(and(eq(productsTable.active, true), eq(productsTable.retailEnabled, true), eq(suppliersTable.active, true), inArray(suppliersTable.scope, ["B2C", "BOTH"])));
  const itemCount = feedRows.filter(({ product }) => !product.priceOnRequest && effectiveStock(product) > 0).length;
  const [run] = await db.insert(catalogSyncRunsTable).values({
    status: "NOT_CONNECTED", itemCount, validationErrors: errors, requestedByUserId: user.id,
  }).returning();
  res.json({ connectionStatus: "NOT_CONNECTED", canSync: false, run });
});
router.get("/admin/review-rewards", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const [settings] = await db.select().from(shopSettingsTable).limit(1);
  const [stats] = await db.select({ issued: sql<number>`count(*)::int` }).from(reviewRewardIssuancesTable);
  res.json({
    settings: settings ? {
      enabled: settings.reviewRewardsEnabled, invitationDelayDays: settings.reviewInvitationDelayDays,
      percent: settings.reviewRewardPercent, validityDays: settings.reviewRewardValidityDays, version: settings.version,
    } : { enabled: false, invitationDelayDays: 7, percent: 5, validityDays: 30, version: 1 },
    stats: { issued: Number(stats?.issued ?? 0) },
  });
});
router.patch("/admin/review-rewards", async (req, res): Promise<void> => {
  if (!await admin(req, res)) return;
  const version = Number(req.body?.version), delay = Number(req.body?.invitationDelayDays);
  const percent = Number(req.body?.percent), validity = Number(req.body?.validityDays);
  if (!Number.isInteger(version) || !Number.isInteger(delay) || delay < 7 || delay > 10 || !Number.isInteger(percent) || percent < 1 || percent > 100 || !Number.isInteger(validity) || validity < 1 || validity > 365 || typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "Review reward settings are outside allowed bounds." }); return;
  }
  const [updated] = await db.update(shopSettingsTable).set({
    reviewRewardsEnabled: req.body.enabled, reviewInvitationDelayDays: delay,
    reviewRewardPercent: percent, reviewRewardValidityDays: validity,
    version: version + 1, updatedAt: new Date(),
  }).where(eq(shopSettingsTable.version, version)).returning();
  if (!updated) { res.status(409).json({ error: "Settings changed; reload before saving." }); return; }
  res.json({ enabled: updated.reviewRewardsEnabled, invitationDelayDays: updated.reviewInvitationDelayDays, percent: updated.reviewRewardPercent, validityDays: updated.reviewRewardValidityDays, version: updated.version });
});

router.patch("/admin/rmas/:id/status", async (req, res): Promise<void> => {
  const user = await admin(req, res); if (!user) return;
  const status = req.body?.status;
  if (!["RECEIVED", "IN_REVIEW", "APPROVED", "REJECTED"].includes(status)) { res.status(400).json({ error: "Invalid status." }); return; }
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(rmasTable).where(eq(rmasTable.id, req.params.id!)).for("update").limit(1);
    if (!current || current.status === status) return current ? { row: current, changed: false } : null;
    const [row] = await tx.update(rmasTable).set({ status, updatedAt: new Date() }).where(eq(rmasTable.id, current.id)).returning();
    await tx.insert(rmaStatusHistoryTable).values({ rmaId: current.id, actorUserId: user.id, previousStatus: current.status, nextStatus: status });
    const [requester] = await tx.select().from(usersTable).where(eq(usersTable.id, current.requesterUserId)).limit(1);
    if (requester) await tx.insert(emailDeliveriesTable).values({
      eventKey: `rma:${current.id}:status:${status}`, emailType: "rma_status_changed", recipientEmail: requester.email,
      recipientName: `${requester.firstName} ${requester.lastName}`.trim(), subject: `LUMERA RMA ${current.rmaNumber}: ${status}`,
      htmlContent: `<p>Status vaseg zahteva je promenjen na ${status}.</p>`, metadata: { rmaId: current.id, status },
    }).onConflictDoNothing();
    return { row: row!, changed: true };
  });
  if (!result) { res.status(404).json({ error: "RMA not found." }); return; }
  res.json(result);
});

export default router;