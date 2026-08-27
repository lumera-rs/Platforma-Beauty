import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, productsTable, retailProductSubscriptionsTable, shippingRulesTable, suppliersTable } from "@workspace/db";
import { getCurrentUser } from "../lib/auth";

const router: IRouter = Router();
const frequencies = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "EVERY_TWO_MONTHS"]);
const payments = new Set(["CARD", "BANK_TRANSFER", "CASH_ON_DELIVERY"]);
const deliveries = new Set(["courier", "personal_belgrade"]);

async function customer(req: Request, res: Response) {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Prijava kupca je obavezna." }); return null; }
  if (user.role !== "CUSTOMER") { res.status(403).json({ error: "Ova funkcija je dostupna samo klijentima." }); return null; }
  return user;
}
function view(row: typeof retailProductSubscriptionsTable.$inferSelect) {
  return { id: row.id, productId: row.productId, quantity: row.quantity, frequency: row.frequency, status: row.status,
    discountPercent: row.discountPercentSnapshot, paymentMethod: row.paymentMethod, deliveryMethod: row.deliveryMethod,
    nextDueAt: row.nextDueAt, blockedUntil: row.blockedUntil, pausedAt: row.pausedAt, cancelledAt: row.cancelledAt, createdAt: row.createdAt };
}
router.get("/customer/retail-subscriptions", async (req, res) => {
  const user = await customer(req, res); if (!user) return;
  res.json((await db.select().from(retailProductSubscriptionsTable).where(eq(retailProductSubscriptionsTable.userId, user.id))
    .orderBy(desc(retailProductSubscriptionsTable.createdAt))).map(view));
});
router.get("/customer/retail-subscriptions/:subscriptionId", async (req, res) => {
  const user = await customer(req, res); if (!user) return;
  const [row] = await db.select().from(retailProductSubscriptionsTable).where(and(eq(retailProductSubscriptionsTable.id, req.params.subscriptionId), eq(retailProductSubscriptionsTable.userId, user.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; } res.json(view(row));
});
router.post("/customer/retail-subscriptions", async (req, res) => {
  const user = await customer(req, res); if (!user) return;
  const body = req.body as Record<string, unknown>;
  const quantity = Number(body.quantity); const frequency = String(body.frequency ?? ""); const paymentMethod = String(body.paymentMethod ?? ""); const deliveryMethod = String(body.deliveryMethod ?? "");
  const contact = body.contact as Record<string, unknown>; const delivery = body.delivery as Record<string, unknown>;
  if (!Number.isInteger(quantity) || quantity < 1 || !frequencies.has(frequency) || !payments.has(paymentMethod) || !deliveries.has(deliveryMethod)
    || !contact || !delivery || !["firstName", "lastName", "email", "phone"].every((key) => typeof contact[key] === "string" && String(contact[key]).trim())
    || !["street", "city", "postalCode"].every((key) => typeof delivery[key] === "string" && String(delivery[key]).trim())) { res.status(400).json({ error: "Neispravni podaci pretplate." }); return; }
  if (deliveryMethod === "personal_belgrade" && String(delivery.city).toLocaleLowerCase("sr-Latn") !== "beograd") { res.status(400).json({ error: "Lična dostava je dostupna samo u Beogradu." }); return; }
  const [product] = await db.select({ product: productsTable }).from(productsTable)
    .innerJoin(suppliersTable, eq(suppliersTable.id, productsTable.supplierId))
    .where(and(eq(productsTable.id, String(body.productId)), eq(productsTable.active, true), eq(productsTable.retailEnabled, true),
      eq(productsTable.subscriptionAllowed, true), eq(suppliersTable.active, true))).limit(1);
  const catalog = product?.product;
  if (!catalog) { res.status(409).json({ error: "Proizvod nije dostupan za pretplatu." }); return; }
  if (quantity < catalog.minimumOrderQuantity || catalog.stock < quantity || catalog.publicPrice == null) { res.status(409).json({ error: "Količina nije dostupna za pretplatu." }); return; }
  const [shipping] = await db.select().from(shippingRulesTable).limit(1);
  if (!shipping) { res.status(409).json({ error: "Dostava trenutno nije podešena." }); return; }
  const city = String(delivery.city);
  if (deliveryMethod === "personal_belgrade" && (!shipping.personalDeliveryEnabled || city.toLocaleLowerCase("sr-Latn") !== "beograd")) {
    res.status(400).json({ error: "Lična dostava nije dostupna za izabranu adresu." }); return;
  }
  const baseSubtotal = catalog.publicPrice * quantity;
  const shippingCost = deliveryMethod === "personal_belgrade" ? shipping.personalDeliveryPrice
    : baseSubtotal >= shipping.freeShippingThreshold ? 0
      : (shipping.tiers.find((tier) => catalog.weightGrams != null && catalog.weightGrams * quantity <= tier.maxWeightGrams)?.price
        ?? shipping.tiers.at(-1)?.price ?? 0);
  const nextDueAt = body.firstDueAt ? new Date(String(body.firstDueAt)) : new Date();
  if (Number.isNaN(nextDueAt.getTime())) { res.status(400).json({ error: "Neispravan datum prve isporuke." }); return; }
  const [row] = await db.insert(retailProductSubscriptionsTable).values({
    userId: user.id, productId: catalog.id, quantity, frequency: frequency as never, paymentMethod: paymentMethod as never, deliveryMethod: deliveryMethod as never,
    discountPercentSnapshot: catalog.subscriptionDiscountPercent ?? 0,
    contactSnapshot: { firstName: String(contact.firstName), lastName: String(contact.lastName), email: String(contact.email).toLowerCase(), phone: String(contact.phone) },
    deliverySnapshot: { street: String(delivery.street), city, postalCode: String(delivery.postalCode), note: typeof delivery.note === "string" ? delivery.note : null, shippingCost },
    anchorDay: nextDueAt.getUTCDate(),
    nextDueAt,
  }).returning();
  res.status(201).json(view(row!));
});
for (const [action, status] of [["pause", "PAUSED"], ["resume", "ACTIVE"], ["cancel", "CANCELLED"]] as const) router.post(`/customer/retail-subscriptions/:subscriptionId/${action}`, async (req, res) => {
  const user = await customer(req, res); if (!user) return;
  const [row] = await db.update(retailProductSubscriptionsTable).set({
    status: status as never, ...(action === "pause" ? { pausedAt: new Date() } : action === "cancel" ? { cancelledAt: new Date() } : { pausedAt: null }), updatedAt: new Date(),
  }).where(and(eq(retailProductSubscriptionsTable.id, req.params.subscriptionId), eq(retailProductSubscriptionsTable.userId, user.id),
    action === "resume" ? eq(retailProductSubscriptionsTable.status, "PAUSED") : action === "pause" ? eq(retailProductSubscriptionsTable.status, "ACTIVE") : ne(retailProductSubscriptionsTable.status, "CANCELLED"))).returning();
  if (row) { res.json(view(row)); return; }
  const [owned] = await db.select().from(retailProductSubscriptionsTable).where(and(eq(retailProductSubscriptionsTable.id, req.params.subscriptionId), eq(retailProductSubscriptionsTable.userId, user.id))).limit(1);
  if (!owned) { res.status(404).json({ error: "Pretplata nije pronađena." }); return; }
  // Repeating a terminal lifecycle request is deliberately idempotent.
  res.json(view(owned));
});
export default router;