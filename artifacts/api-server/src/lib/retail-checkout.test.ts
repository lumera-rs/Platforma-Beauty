import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  couponsTable,
  db,
  commerceCustomerNotificationsTable,
  loyaltyPointLedgerTable,
  observeDatabaseQueries,
  pool,
  productCategoriesTable,
  productWaitlistNotificationOutboxTable,
  productWaitlistTable,
  productsTable,
  reorderActionsTable,
  retailCartItemsTable,
  retailCartsTable,
  retailOrderItemsTable,
  retailOrdersTable,
  savedRetailCartItemsTable,
  shopSettingsTable,
  shippingRulesTable,
  suppliersTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { createSession, hashPassword, sessionCookieName } from "./auth";
import { ensureBusinessGrowthSchema } from "./business-growth-schema";
import { runProductWaitlistNotificationWorker } from "./product-waitlist-worker";
import { ensureShippingConfigSchema } from "./shipping-config";

type RetailCart = {
  id: string;
  items: Array<{ id: string; sku: string; quantity: number }>;
  savedItems?: Array<{ id: string; quantity: number }>;
};
type RetailCartSummary = { itemCount: number };
type RetailCheckoutPreview = {
  cart: { subtotal: number; items: Array<{ sku: string }> };
  shipping: { shippingCost: number };
  total: number;
  merchandiseSubtotalRsd: number;
};
type RetailOrder = {
  id: string;
  subtotal: number;
  shippingCost: number;
  total: number;
  items: Array<{ sku: string }>;
};
type ApiError = { error: string; code?: string };

const createdCartIds: string[] = [];
const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];
let createdCategoryId: string | undefined;
let createdProductId: string | undefined;
let createdSupplierId: string | undefined;
let createdShippingRuleId: string | undefined;
let previousShippingRule: typeof shippingRulesTable.$inferSelect | undefined;
let baseUrl = "";
let server: ReturnType<typeof app.listen> | undefined;

function retailClient(sessionCookie = "") {
  let cookie = "";
  return async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(cookie || sessionCookie ? { cookie: [cookie, sessionCookie].filter(Boolean).join("; ") } : {}),
        ...(init.headers ?? {}),
      },
    });
    const setCookie = response.headers.get("set-cookie");
    const token = setCookie?.match(/lumera_retail_cart=([^;]+)/)?.[1];
    if (token) cookie = `lumera_retail_cart=${token}`;
    return response;
  };
}

function retailCartCookie(response: Response) {
  const token = response.headers.get("set-cookie")?.match(/lumera_retail_cart=([^;]+)/)?.[1];
  assert.ok(token, "response must set a retail cart cookie");
  return `lumera_retail_cart=${token}`;
}

async function createTestUser(role: "CUSTOMER" | "JOBSEEKER" | "ADMIN" = "CUSTOMER") {
  const marker = randomUUID();
  const [user] = await db.insert(usersTable).values({
    firstName: "Retail",
    lastName: `Regression ${marker}`,
    email: `retail-regression-${marker}@example.test`,
    passwordHash: await hashPassword(`retail-regression-${marker}`),
    passwordSetAt: new Date(),
    role,
  }).returning();
  assert.ok(user);
  createdUserIds.push(user.id);
  return { user, cookie: `${sessionCookieName}=${await createSession(user.id)}` };
}

async function addRetailItem(request: ReturnType<typeof retailClient>, productId: string, quantity: number) {
  const cartResponse = await request("/retail/cart");
  assert.equal(cartResponse.status, 200);
  const cart = await cartResponse.json() as RetailCart;
  createdCartIds.push(cart.id);
  const addResponse = await request("/retail/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId, quantity }),
  });
  return addResponse;
}

async function checkoutAndAssertSavedAmount(
  productId: string,
  deliveryMethod: "courier" | "personal_belgrade",
  city: string,
) {
  const request = retailClient();
  const addResponse = await addRetailItem(request, productId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request(
    `/retail/checkout-preview?deliveryMethod=${deliveryMethod}&city=${encodeURIComponent(city)}`,
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;

  const checkoutResponse = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-checkout-test-${randomUUID()}`,
      firstName: "Retail",
      lastName: "Kupac",
      email: `retail-${randomUUID()}@example.test`,
      phone: "+381601234567",
      street: "Test ulica 1",
      city,
      postalCode: "11000",
      paymentMethod: "BANK_TRANSFER",
      deliveryMethod,
      expectedSubtotal: preview.cart.subtotal,
      expectedShippingCost: preview.shipping.shippingCost,
      expectedTotal: preview.total,
    }),
  });
  assert.equal(checkoutResponse.status, 201);
  const order = await checkoutResponse.json() as RetailOrder;
  createdOrderIds.push(order.id);

  assert.equal(order.subtotal, preview.cart.subtotal, `${deliveryMethod} preserves the displayed subtotal`);
  assert.equal(order.shippingCost, preview.shipping.shippingCost, `${deliveryMethod} preserves the displayed delivery cost`);
  assert.equal(order.total, preview.total, `${deliveryMethod} preserves the displayed total`);

  const [persisted] = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, order.id)).limit(1);
  assert.ok(persisted, "checkout must persist the order");
  assert.equal(persisted.subtotal, preview.cart.subtotal);
  assert.equal(persisted.shippingCost, preview.shipping.shippingCost);
  assert.equal(persisted.total, preview.total);
  assert.equal(
    persisted.referralCreditMerchandiseSubtotalRsd,
    preview.merchandiseSubtotalRsd,
    "locked checkout persists the same referral base as preview",
  );
}

test.before(async () => {
  await ensureBusinessGrowthSchema();
  await ensureShippingConfigSchema();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;

  previousShippingRule = (await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1))[0];
  const shippingValues = {
    freeShippingThreshold: 10_000,
    tiers: [{ maxWeightGrams: 1_000, price: 390, label: "do 1 kg" }],
    personalDeliveryEnabled: true,
    personalDeliveryName: "Lična dostava u Beogradu",
    personalDeliveryPrice: 650,
    personalDeliveryDescription: "Test lična dostava.",
    updatedAt: new Date(),
  };
  if (previousShippingRule) {
    await db.update(shippingRulesTable).set(shippingValues).where(eq(shippingRulesTable.id, previousShippingRule.id));
  } else {
    const [created] = await db.insert(shippingRulesTable).values(shippingValues).returning();
    createdShippingRuleId = created!.id;
  }

  const suffix = randomUUID();
  const [supplier] = await db.insert(suppliersTable).values({
    name: `Retail checkout supplier ${suffix}`,
    slug: `retail-checkout-supplier-${suffix}`,
    scope: "BOTH",
    active: true,
  }).returning();
  createdSupplierId = supplier!.id;
  const [category] = await db.insert(productCategoriesTable).values({
    supplierId: supplier!.id,
    name: `Retail checkout test ${suffix}`,
    slug: `retail-checkout-test-${suffix}`,
    active: true,
  }).returning();
  createdCategoryId = category!.id;
  const [product] = await db.insert(productsTable).values({
    supplierId: supplier!.id,
    categoryId: category!.id,
    categoryName: category!.name,
    name: `Retail proizvod ${suffix}`,
    description: "Test proizvod za retail checkout.",
    publicDescription: "Javni opis retail proizvoda.",
    imageUrl: "/retail-checkout-test.jpg",
    price: 2_500,
    publicPrice: 2_500,
    publicDiscountPrice: 2_000,
    retailEnabled: true,
    professionalEnabled: false,
    stock: 8,
    sku: `retail-checkout-${suffix}`,
    unit: "kom",
    weightGrams: 500,
    active: true,
  }).returning();
  createdProductId = product!.id;
});

test.after(async () => {
  if (createdUserIds.length) {
    await db.delete(loyaltyPointLedgerTable).where(inArray(loyaltyPointLedgerTable.userId, createdUserIds));
    await db.delete(reorderActionsTable).where(inArray(reorderActionsTable.userId, createdUserIds));
    await db.delete(commerceCustomerNotificationsTable).where(inArray(commerceCustomerNotificationsTable.userId, createdUserIds));
    await db.delete(productWaitlistTable).where(inArray(productWaitlistTable.userId, createdUserIds));
  }
  if (createdOrderIds.length) {
    await db.delete(retailOrderItemsTable).where(inArray(retailOrderItemsTable.orderId, createdOrderIds));
    await db.delete(retailOrdersTable).where(inArray(retailOrdersTable.id, createdOrderIds));
  }
  if (createdCartIds.length) {
    await db.delete(retailCartItemsTable).where(inArray(retailCartItemsTable.cartId, createdCartIds));
    await db.delete(savedRetailCartItemsTable).where(inArray(savedRetailCartItemsTable.cartId, createdCartIds));
    await db.delete(retailCartsTable).where(inArray(retailCartsTable.id, createdCartIds));
  }
  if (createdUserIds.length) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  if (createdProductId) await db.delete(productsTable).where(eq(productsTable.id, createdProductId));
  if (createdCategoryId) await db.delete(productCategoriesTable).where(eq(productCategoriesTable.id, createdCategoryId));
  if (createdSupplierId) await db.delete(suppliersTable).where(eq(suppliersTable.id, createdSupplierId));
  if (previousShippingRule) {
    await db.update(shippingRulesTable).set({
      freeShippingThreshold: previousShippingRule.freeShippingThreshold,
      tiers: previousShippingRule.tiers,
      personalDeliveryEnabled: previousShippingRule.personalDeliveryEnabled,
      personalDeliveryName: previousShippingRule.personalDeliveryName,
      personalDeliveryPrice: previousShippingRule.personalDeliveryPrice,
      personalDeliveryDescription: previousShippingRule.personalDeliveryDescription,
      updatedAt: previousShippingRule.updatedAt,
    }).where(eq(shippingRulesTable.id, previousShippingRule.id));
  } else if (createdShippingRuleId) {
    await db.delete(shippingRulesTable).where(eq(shippingRulesTable.id, createdShippingRuleId));
  }
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
});

test("cart summary does not create a cart and returns the count for an existing cart", async () => {
  assert.ok(createdProductId);
  const cartsBefore = await db.select({ id: retailCartsTable.id }).from(retailCartsTable);

  const emptySummary = await fetch(`${baseUrl}/retail/cart-summary`);
  assert.equal(emptySummary.status, 200);
  assert.equal(emptySummary.headers.get("set-cookie"), null);
  assert.deepEqual(await emptySummary.json() as RetailCartSummary, { itemCount: 0 });

  const cartsAfterEmptySummary = await db.select({ id: retailCartsTable.id }).from(retailCartsTable);
  assert.equal(cartsAfterEmptySummary.length, cartsBefore.length, "a summary request must not create a persistent cart");

  const addResponse = await fetch(`${baseUrl}/retail/cart/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  });
  assert.equal(addResponse.status, 201);
  const cart = await addResponse.json() as RetailCart;
  createdCartIds.push(cart.id);
  const token = addResponse.headers.get("set-cookie")?.match(/lumera_retail_cart=([^;]+)/)?.[1];
  assert.ok(token);

  const existingSummary = await fetch(`${baseUrl}/retail/cart-summary`, {
    headers: { cookie: `lumera_retail_cart=${token}` },
  });
  assert.equal(existingSummary.status, 200);
  assert.equal(existingSummary.headers.get("set-cookie"), null);
  assert.deepEqual(await existingSummary.json() as RetailCartSummary, { itemCount: 1 });
});

test("an excluded B2C free-shipping coupon cannot waive checkout delivery", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
  const baselineResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(baselineResponse.status, 200);
  const baseline = await baselineResponse.json() as RetailCheckoutPreview;
  assert.ok(baseline.shipping.shippingCost > 0);

  const code = `B2C-FREE-${randomUUID().slice(0, 8)}`.toUpperCase();
  const [restrictedCoupon] = await db.insert(couponsTable).values({
    code,
    audience: "B2C",
    discountType: "FIXED_RSD",
    discountValue: 1,
    freeShipping: true,
    excludeProductIds: [createdProductId],
  }).returning();
  try {
    const restrictedPreview = await request(
      `/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad&couponCode=${encodeURIComponent(code)}`,
    );
    assert.equal(restrictedPreview.status, 409);
    assert.equal((await restrictedPreview.json() as ApiError).code, "COUPON_APPLICABILITY");

    const restrictedCheckout = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-restricted-coupon-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `retail-restricted-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        couponCode: code,
        expectedSubtotal: baseline.cart.subtotal,
        expectedShippingCost: baseline.shipping.shippingCost,
        expectedTotal: baseline.total,
      }),
    });
    assert.equal(restrictedCheckout.status, 409);
    assert.equal((await restrictedCheckout.json() as ApiError).code, "COUPON_APPLICABILITY");
  } finally {
    await db.delete(couponsTable).where(eq(couponsTable.id, restrictedCoupon!.id));
  }
});

test("cart and checkout retain the saved catalog reference after an SKU edit", async () => {
  assert.ok(createdProductId);
  const [product] = await db.select({
    catalogReference: productsTable.catalogReference,
    sku: productsTable.sku,
    stock: productsTable.stock,
  }).from(productsTable).where(eq(productsTable.id, createdProductId)).limit(1);
  assert.ok(product);

  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);
  const addedCart = await addResponse.json() as RetailCart;
  assert.equal(addedCart.items[0]?.sku, product.catalogReference);
  const [savedCartItem] = await db.select().from(retailCartItemsTable)
    .where(eq(retailCartItemsTable.cartId, addedCart.id)).limit(1);
  assert.equal(savedCartItem?.productCatalogReference, product.catalogReference);

  await db.update(productsTable).set({ sku: `retail-checkout-updated-${randomUUID()}` })
    .where(eq(productsTable.id, createdProductId));
  try {
    const cartResponse = await request("/retail/cart");
    assert.equal(cartResponse.status, 200);
    const cart = await cartResponse.json() as RetailCart;
    assert.equal(cart.items[0]?.sku, product.catalogReference);

    const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as RetailCheckoutPreview;
    assert.equal(preview.cart.items[0]?.sku, product.catalogReference);

    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-reference-test-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `reference-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 201);
    const order = await checkoutResponse.json() as RetailOrder;
    createdOrderIds.push(order.id);
    assert.equal(order.items[0]?.sku, product.catalogReference);
    const [savedOrderItem] = await db.select().from(retailOrderItemsTable)
      .where(eq(retailOrderItemsTable.orderId, order.id)).limit(1);
    assert.equal(savedOrderItem?.productCatalogReference, product.catalogReference);

    const skuAfterOrder = `retail-checkout-after-order-${randomUUID()}`;
    await db.update(productsTable).set({ sku: skuAfterOrder }).where(eq(productsTable.id, createdProductId));
    const [admin] = await db.insert(usersTable).values({
      firstName: "Retail",
      lastName: "Search Admin",
      email: `retail-reference-admin-${randomUUID()}@example.test`,
      passwordHash: await hashPassword(`retail-reference-admin-${randomUUID()}`),
      passwordSetAt: new Date(),
      role: "ADMIN",
    }).returning();
    assert.ok(admin);
    try {
      const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
      const searchQueries: string[] = [];
      const stopObserving = observeDatabaseQueries(({ sql: query }) => searchQueries.push(query));
      let byCatalogReference: Response;
      try {
        byCatalogReference = await fetch(
          `${baseUrl}/admin/retail-orders?search=${encodeURIComponent(product.catalogReference.toLowerCase())}`,
          { headers: { cookie: adminCookie } },
        );
      } finally {
        stopObserving();
      }
      assert.equal(byCatalogReference.status, 200);
      const referenceResults = await byCatalogReference.json() as Array<{ id: string }>;
      assert.ok(referenceResults.some((candidate) => candidate.id === order.id), "an order must remain searchable by its saved catalog reference");
      const retailOrderSearch = searchQueries.find((query) => (
        query.includes('from "retail_order_items" inner join "retail_orders"')
        && query.includes('"product_catalog_reference" =')
      ));
      assert.ok(retailOrderSearch, "canonical reference search must begin at retail order items and join matching orders");
      assert.ok(
        !searchQueries.some((query) => /^select "order_id" from "retail_order_items"/i.test(query)),
        "reference search must not load an unbounded order-id list into application memory",
      );

      const byEditedSku = await fetch(
        `${baseUrl}/admin/retail-orders?search=${encodeURIComponent(skuAfterOrder)}`,
        { headers: { cookie: adminCookie } },
      );
      assert.equal(byEditedSku.status, 200);
      const skuResults = await byEditedSku.json() as Array<{ id: string }>;
      assert.ok(!skuResults.some((candidate) => candidate.id === order.id), "admin search must not use the product's current editable SKU");

      const planMarker = `retail-reference-plan-${randomUUID()}`;
      let planText = "";
      try {
        await pool.query(
          `WITH inserted_orders AS (
             INSERT INTO retail_orders (
               id, order_number, cart_id, user_id, tracking_token_hash, idempotency_key,
               status, payment_method, payment_status, delivery_method,
               subtotal, shipping_cost, total,
               shipping_name, shipping_address, shipping_city, shipping_postal_code,
               shipping_phone, shipping_email, shipping_note, created_at, updated_at
             )
             SELECT gen_random_uuid(), $2 || '-' || sequence_number, source.cart_id, NULL,
                    $2 || '-tracking-' || sequence_number, $2 || '-idempotency-' || sequence_number,
                    'pending', 'BANK_TRANSFER', 'unpaid', 'courier',
                    1, 0, 1,
                    'Plan fixture', 'Test ulica 1', 'Novi Sad', '21000',
                    '+381601234567', $2 || '-' || sequence_number || '@example.test',
                    'Retail reference plan fixture', now(), now()
             FROM retail_orders AS source
             CROSS JOIN generate_series(1, 1500) AS sequence_number
             WHERE source.id = $1
             RETURNING id
           )
           INSERT INTO retail_order_items (
             order_id, product_id, product_name, product_image_url,
             product_catalog_reference, variant_value, variant_label, unit_price, quantity,
             supplier_id, supplier_name, supplier_slug, product_sku_snapshot,
             line_subtotal, line_total
           )
           SELECT inserted_order.id, product.id, 'Plan distractor', '/reference-plan.jpg',
                  $2 || '-reference-' || inserted_order.id, NULL, NULL, 1, 1,
                  product.supplier_id, supplier.name, supplier.slug, product.sku, 1, 1
           FROM inserted_orders AS inserted_order
           CROSS JOIN products AS product
           INNER JOIN suppliers AS supplier ON supplier.id = product.supplier_id
           WHERE product.id = $3::uuid`,
          [order.id, planMarker, createdProductId],
        );
        await pool.query("ANALYZE retail_orders, retail_order_items");
        const explained = await pool.query(
          `EXPLAIN (COSTS OFF, FORMAT TEXT)
           SELECT DISTINCT retail_order.id, retail_order.created_at
           FROM retail_order_items AS retail_item
           INNER JOIN retail_orders AS retail_order ON retail_item.order_id = retail_order.id
           WHERE retail_item.product_catalog_reference = $1
           ORDER BY retail_order.created_at DESC, retail_order.id DESC
           LIMIT 100`,
          [product.catalogReference],
        );
        planText = explained.rows.map((row) => String(row["QUERY PLAN"])).join("\n");
      } finally {
        await pool.query(`DELETE FROM retail_orders WHERE order_number LIKE $1`, [`${planMarker}-%`]);
      }
      assert.match(
        planText,
        /retail_order_items_catalog_reference_order_idx/,
        "normal canonical-reference plan must use the covering item index with a large order history",
      );
      assert.doesNotMatch(planText, /Seq Scan on retail_order_items/, "canonical reference lookup must not scan all retail order items");
      assert.doesNotMatch(planText, /Seq Scan on retail_orders/, "canonical reference lookup must not scan all retail orders");
    } finally {
      await db.delete(usersTable).where(eq(usersTable.id, admin.id));
    }
  } finally {
    await db.update(productsTable).set({ sku: product.sku, stock: product.stock })
      .where(eq(productsTable.id, createdProductId));
  }
});

test("retail checkout saves the exact courier and personal-delivery previews", async () => {
  assert.ok(createdProductId);
  await checkoutAndAssertSavedAmount(createdProductId, "courier", "Novi Sad");
  await checkoutAndAssertSavedAmount(createdProductId, "personal_belgrade", "Beograd");
});

test("guest checkout stays anonymous while CUSTOMER and JOBSEEKER orders are owned and isolated", async () => {
  assert.ok(createdProductId);
  const place = async (request: ReturnType<typeof retailClient>, marker: string) => {
    assert.equal((await addRetailItem(request, createdProductId!, 1)).status, 201);
    const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as RetailCheckoutPreview;
    const response = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-account-${marker}-${randomUUID()}`,
        firstName: "Retail", lastName: "Kupac", email: `${marker}-${randomUUID()}@example.test`,
        phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
        paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal, expectedShippingCost: preview.shipping.shippingCost, expectedTotal: preview.total,
      }),
    });
    assert.equal(response.status, 201);
    const order = await response.json() as RetailOrder;
    createdOrderIds.push(order.id);
    return order;
  };

  const usersBefore = await db.select({ id: usersTable.id }).from(usersTable);
  const guest = await place(retailClient(), "guest");
  const usersAfter = await db.select({ id: usersTable.id }).from(usersTable);
  assert.equal(usersAfter.length, usersBefore.length, "guest checkout must never create an account");
  const [guestRow] = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, guest.id));
  assert.equal(guestRow?.userId, null);

  const customer = await createTestUser("CUSTOMER");
  const jobseeker = await createTestUser("JOBSEEKER");
  const customerOrder = await place(retailClient(customer.cookie), "customer");
  const jobseekerOrder = await place(retailClient(jobseeker.cookie), "jobseeker");
  const [customerRow, jobseekerRow] = await Promise.all([
    db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, customerOrder.id)).then((rows) => rows[0]),
    db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, jobseekerOrder.id)).then((rows) => rows[0]),
  ]);
  assert.equal(customerRow?.userId, customer.user.id);
  assert.equal(jobseekerRow?.userId, jobseeker.user.id);

  const customerHistory = await retailClient(customer.cookie)("/customer/retail-orders");
  assert.equal(customerHistory.status, 200);
  assert.ok((await customerHistory.json() as RetailOrder[]).some((order) => order.id === customerOrder.id));
  const jobseekerHistory = await retailClient(jobseeker.cookie)("/customer/retail-orders");
  assert.equal(jobseekerHistory.status, 200);
  assert.ok((await jobseekerHistory.json() as RetailOrder[]).some((order) => order.id === jobseekerOrder.id));
  const denied = await retailClient(jobseeker.cookie)(`/customer/retail-orders/${customerOrder.id}`);
  assert.equal(denied.status, 404, "another retail account cannot read an order by id");
});

test("B2C sale lines are excluded from the referral base in preview and final checkout", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;
  assert.equal(preview.merchandiseSubtotalRsd, 0);

  const checkoutResponse = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-referral-stacking-${randomUUID()}`,
      firstName: "Retail", lastName: "Kupac", email: `stacking-${randomUUID()}@example.test`,
      phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
      paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
      expectedSubtotal: preview.cart.subtotal,
      expectedShippingCost: preview.shipping.shippingCost,
      expectedTotal: preview.total,
    }),
  });
  assert.equal(checkoutResponse.status, 201);
  const order = await checkoutResponse.json() as RetailOrder;
  createdOrderIds.push(order.id);
  const [persisted] = await db.select().from(retailOrdersTable).where(eq(retailOrdersTable.id, order.id));
  assert.equal(persisted?.referralCreditMerchandiseSubtotalRsd, preview.merchandiseSubtotalRsd);
});

test("checkout and admin settings keep the canonical shipping rule after it is updated beside a duplicate", async () => {
  assert.ok(createdProductId);
  const canonicalShippingRuleId = "00000000-0000-0000-0000-000000000001";
  const [replacedShippingRule] = await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1);
  assert.ok(replacedShippingRule);
  await db.execute(sql`drop index if exists "shipping_rules_singleton_unique"`);
  await db.insert(shippingRulesTable).values({
    id: canonicalShippingRuleId,
    freeShippingThreshold: 10_000,
    tiers: [{ maxWeightGrams: 1_000, price: 390, label: "do 1 kg" }],
    personalDeliveryEnabled: true,
    personalDeliveryName: "Lična dostava u Beogradu",
    personalDeliveryPrice: 700,
    personalDeliveryDescription: "Test lična dostava.",
    updatedAt: new Date(),
  });
  await ensureShippingConfigSchema();
  const [admin] = await db.insert(usersTable).values({
    firstName: "Retail",
    lastName: "Admin",
    email: `retail-admin-${randomUUID()}@example.test`,
    passwordHash: await hashPassword("retail-admin-test"),
    passwordSetAt: new Date(),
    role: "ADMIN",
  }).returning();
  assert.ok(admin);
  const adminCookie = `${sessionCookieName}=${await createSession(admin.id)}`;
  const getAdminShipping = () => fetch(`${baseUrl}/admin/shipping`, {
    headers: { cookie: adminCookie },
  });
  try {
    const request = retailClient();
    assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
    const beforeUpdateResponse = await request("/retail/checkout-preview?deliveryMethod=personal_belgrade&city=Beograd");
    assert.equal(beforeUpdateResponse.status, 200);
    assert.equal((await beforeUpdateResponse.json() as RetailCheckoutPreview).shipping.shippingCost, 700);
    const beforeUpdateAdminResponse = await getAdminShipping();
    assert.equal(beforeUpdateAdminResponse.status, 200);
    assert.equal((await beforeUpdateAdminResponse.json() as { personalDeliveryPrice: number }).personalDeliveryPrice, 700);

    await db.update(shippingRulesTable).set({
      personalDeliveryPrice: 800,
      updatedAt: new Date(),
    }).where(eq(shippingRulesTable.id, canonicalShippingRuleId));

    const updatedRequest = retailClient();
    assert.equal((await addRetailItem(updatedRequest, createdProductId, 1)).status, 201);
    const afterUpdateResponse = await updatedRequest("/retail/checkout-preview?deliveryMethod=personal_belgrade&city=Beograd");
    assert.equal(afterUpdateResponse.status, 200);
    assert.equal((await afterUpdateResponse.json() as RetailCheckoutPreview).shipping.shippingCost, 800);
    const afterUpdateAdminResponse = await getAdminShipping();
    assert.equal(afterUpdateAdminResponse.status, 200);
    assert.equal((await afterUpdateAdminResponse.json() as { personalDeliveryPrice: number }).personalDeliveryPrice, 800);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, admin.id));
    await db.delete(shippingRulesTable).where(eq(shippingRulesTable.id, canonicalShippingRuleId));
    const [restoredShippingRule] = await db.select({ id: shippingRulesTable.id }).from(shippingRulesTable)
      .where(eq(shippingRulesTable.id, replacedShippingRule.id))
      .limit(1);
    if (!restoredShippingRule) await db.insert(shippingRulesTable).values(replacedShippingRule);
    await ensureShippingConfigSchema();
  }
});

test("adding a second cart quantity above available stock returns 409", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 5 }).where(eq(productsTable.id, createdProductId));
  const request = retailClient();
  const firstAdd = await addRetailItem(request, createdProductId, 5);
  assert.equal(firstAdd.status, 201);

  const secondAdd = await request("/retail/cart/items", {
    method: "POST",
    body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  });
  assert.equal(secondAdd.status, 409);

  const cartResponse = await request("/retail/cart");
  assert.equal(cartResponse.status, 200);
  const cart = await cartResponse.json() as RetailCart;
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0]?.quantity, 5, "the rejected aggregate quantity must not change the cart");
});

test("updating one duplicate cart row cannot exceed the product's aggregate stock", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 3);
  assert.equal(addResponse.status, 201);
  const cart = await addResponse.json() as RetailCart;
  const item = cart.items[0];
  assert.ok(item);

  await db.insert(retailCartItemsTable).values({
    cartId: cart.id,
    productId: createdProductId,
    variantValue: "test-duplicate",
    productName: "Duplicirana retail stavka",
    productImageUrl: "/retail-checkout-test.jpg",
    unitPrice: 2_000,
    quantity: 1,
    weightGrams: 500,
  });
  const updateResponse = await request(`/retail/cart/items/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity: 5 }),
  });
  assert.equal(updateResponse.status, 409);

  const afterResponse = await request("/retail/cart");
  assert.equal(afterResponse.status, 200);
  const after = await afterResponse.json() as RetailCart;
  assert.equal(after.items.reduce((sum, cartItem) => sum + cartItem.quantity, 0), 4);
});

test("duplicate cart rows cannot create a quote or order above aggregate stock", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 3);
  assert.equal(addResponse.status, 201);
  const cart = await addResponse.json() as RetailCart;
  await db.insert(retailCartItemsTable).values({
    cartId: cart.id,
    productId: createdProductId,
    variantValue: "test-duplicate",
    productName: "Duplicirana retail stavka",
    productImageUrl: "/retail-checkout-test.jpg",
    unitPrice: 2_000,
    quantity: 3,
    weightGrams: 500,
  });
  const [stockBefore] = await db.select({ stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, createdProductId)).limit(1);
  const [ordersBefore] = await db.select({ count: retailOrdersTable.id }).from(retailOrdersTable);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 409);
  const checkoutResponse = await request("/retail/checkout", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `retail-duplicate-test-${randomUUID()}`,
      firstName: "Retail",
      lastName: "Kupac",
      email: `duplicate-${randomUUID()}@example.test`,
      phone: "+381601234567",
      street: "Test ulica 1",
      city: "Novi Sad",
      postalCode: "21000",
      paymentMethod: "BANK_TRANSFER",
      deliveryMethod: "courier",
    }),
  });
  assert.equal(checkoutResponse.status, 409);

  const [stockAfter] = await db.select({ stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, createdProductId)).limit(1);
  const [ordersAfter] = await db.select({ count: retailOrdersTable.id }).from(retailOrdersTable);
  assert.equal(stockAfter?.stock, stockBefore?.stock);
  assert.equal(ordersAfter?.count, ordersBefore?.count);
  const afterResponse = await request("/retail/cart");
  const after = await afterResponse.json() as RetailCart;
  assert.equal(after.items.reduce((sum, item) => sum + item.quantity, 0), 6);
});

test("checkout marks a displayed-quote mismatch so shoppers can refresh it in place", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;

  await db.update(productsTable).set({ publicDiscountPrice: 1_800 }).where(eq(productsTable.id, createdProductId));
  try {
    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-quote-conflict-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `quote-conflict-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 409);
    const error = await checkoutResponse.json() as ApiError;
    assert.equal(error.code, "CHECKOUT_QUOTE_CHANGED");
  } finally {
    await db.update(productsTable).set({ publicDiscountPrice: 2_000 }).where(eq(productsTable.id, createdProductId));
  }
});

test("checkout marks a displayed-quote delivery change with the stable conflict code", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;
  const [shippingRule] = await db.select().from(shippingRulesTable)
    .orderBy(asc(shippingRulesTable.id))
    .limit(1);
  assert.ok(shippingRule);
  const originalTiers = shippingRule.tiers;

  await db.update(shippingRulesTable).set({
    tiers: [{ maxWeightGrams: 1_000, price: 590, label: "do 1 kg" }],
    updatedAt: new Date(),
  }).where(eq(shippingRulesTable.id, shippingRule.id));
  try {
    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-delivery-conflict-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `delivery-conflict-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 409);
    const error = await checkoutResponse.json() as ApiError;
    assert.equal(error.code, "CHECKOUT_QUOTE_CHANGED");
  } finally {
    await db.update(shippingRulesTable).set({ tiers: originalTiers, updatedAt: new Date() })
      .where(eq(shippingRulesTable.id, shippingRule.id));
  }
});

test("checkout marks an unavailable displayed-quote item with the stable conflict code", async () => {
  assert.ok(createdProductId);
  const request = retailClient();
  const addResponse = await addRetailItem(request, createdProductId, 1);
  assert.equal(addResponse.status, 201);

  const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as RetailCheckoutPreview;
  const [product] = await db.select({ stock: productsTable.stock }).from(productsTable)
    .where(eq(productsTable.id, createdProductId)).limit(1);
  assert.ok(product);

  await db.update(productsTable).set({ stock: 0 }).where(eq(productsTable.id, createdProductId));
  try {
    const checkoutResponse = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-stock-conflict-${randomUUID()}`,
        firstName: "Retail",
        lastName: "Kupac",
        email: `stock-conflict-${randomUUID()}@example.test`,
        phone: "+381601234567",
        street: "Test ulica 1",
        city: "Novi Sad",
        postalCode: "21000",
        paymentMethod: "BANK_TRANSFER",
        deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal,
        expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkoutResponse.status, 409);
    const error = await checkoutResponse.json() as ApiError;
    assert.equal(error.code, "CHECKOUT_QUOTE_CHANGED");
  } finally {
    await db.update(productsTable).set({ stock: product.stock }).where(eq(productsTable.id, createdProductId));
  }
});

test("two customers concurrently claiming one anonymous cart produce one winner and one isolated loser", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 10, minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  const anonymous = await fetch(`${baseUrl}/retail/cart/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  });
  assert.equal(anonymous.status, 201);
  const anonymousCart = await anonymous.json() as RetailCart;
  createdCartIds.push(anonymousCart.id);
  const sharedCookie = retailCartCookie(anonymous);
  const [first, second] = await Promise.all([createTestUser(), createTestUser()]);

  const responses = await Promise.all([first, second].map(({ cookie }) => fetch(`${baseUrl}/retail/cart`, {
    headers: { cookie: `${sharedCookie}; ${cookie}` },
  })));
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const carts = await Promise.all(responses.map((response) => response.json() as Promise<RetailCart>));
  for (const cart of carts) if (!createdCartIds.includes(cart.id)) createdCartIds.push(cart.id);

  const winners = carts.filter((cart) => cart.id === anonymousCart.id && cart.items.length === 1);
  const losers = carts.filter((cart) => cart.id !== anonymousCart.id && cart.items.length === 0);
  assert.equal(winners.length, 1, "exactly one account claims the anonymous cart and its item");
  assert.equal(losers.length, 1, "the losing account receives a distinct empty cart");
  const persisted = await db.select().from(retailCartsTable).where(inArray(retailCartsTable.id, carts.map((cart) => cart.id)));
  assert.equal(new Set(persisted.map((cart) => cart.userId)).size, 2);
  assert.ok(persisted.every((cart) => cart.userId === first.user.id || cart.userId === second.user.id));
});

test("logout and account switching hide bound active and saved items, while the owner can restore them", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 10, minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  const owner = await createTestUser();
  const other = await createTestUser();
  const added = await fetch(`${baseUrl}/retail/cart/items`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner.cookie },
    body: JSON.stringify({ productId: createdProductId, quantity: 2 }),
  });
  assert.equal(added.status, 201);
  const original = await added.json() as RetailCart;
  createdCartIds.push(original.id);
  const ownerCartCookie = retailCartCookie(added);
  const ownerRequest = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      cookie: `${ownerCartCookie}; ${owner.cookie}`,
      ...(init.headers ?? {}),
    },
  });
  const item = original.items[0];
  assert.ok(item);
  const savedResponse = await ownerRequest(`/retail/cart/items/${item.id}/save-for-later`, { method: "POST" });
  assert.equal(savedResponse.status, 200);
  const savedCart = await savedResponse.json() as RetailCart;
  const savedItem = savedCart.savedItems?.[0];
  assert.ok(savedItem);
  assert.equal((await ownerRequest("/retail/cart/items", {
    method: "POST", body: JSON.stringify({ productId: createdProductId, quantity: 1 }),
  })).status, 201);

  const [bound] = await db.select().from(retailCartsTable).where(eq(retailCartsTable.id, original.id)).limit(1);
  assert.equal(bound?.userId, owner.user.id);
  const logout = await fetch(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: { cookie: `${ownerCartCookie}; ${owner.cookie}` },
  });
  assert.equal(logout.status, 204);
  const tokenOnlyResponse = await fetch(`${baseUrl}/retail/cart`, {
    headers: { cookie: ownerCartCookie },
  });
  assert.equal(tokenOnlyResponse.status, 200);
  const tokenOnlyCart = await tokenOnlyResponse.json() as RetailCart;
  createdCartIds.push(tokenOnlyCart.id);
  assert.notEqual(tokenOnlyCart.id, original.id);
  assert.deepEqual(tokenOnlyCart.items, []);
  assert.deepEqual(tokenOnlyCart.savedItems ?? [], []);

  const switchedResponse = await fetch(`${baseUrl}/retail/cart`, {
    headers: { cookie: `${ownerCartCookie}; ${other.cookie}` },
  });
  assert.equal(switchedResponse.status, 200);
  const switchedCart = await switchedResponse.json() as RetailCart;
  createdCartIds.push(switchedCart.id);
  assert.notEqual(switchedCart.id, original.id);
  assert.deepEqual(switchedCart.items, []);
  assert.deepEqual(switchedCart.savedItems ?? [], []);

  const restored = await fetch(`${baseUrl}/retail/cart/saved-items/${savedItem.id}/restore`, {
    method: "POST",
    headers: { cookie: `${ownerCartCookie}; ${sessionCookieName}=${await createSession(owner.user.id)}` },
  });
  assert.equal(restored.status, 200);
  const ownerCart = await restored.json() as RetailCart;
  assert.equal(ownerCart.id, original.id);
  assert.equal(ownerCart.items[0]?.quantity, 3);
  assert.deepEqual(ownerCart.savedItems ?? [], []);
});

test("a cart created under an old MOQ cannot be previewed or checked out after the MOQ rises", async () => {
  assert.ok(createdProductId);
  await db.update(productsTable).set({ stock: 10, minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  const request = retailClient();
  assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
  await db.update(productsTable).set({ minimumOrderQuantity: 2 }).where(eq(productsTable.id, createdProductId));
  try {
    const preview = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(preview.status, 200, "the stale cart remains visible so the shopper can correct it");
    const checkout = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-stale-moq-${randomUUID()}`,
        firstName: "Retail", lastName: "MOQ", email: `moq-${randomUUID()}@example.test`,
        phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
        paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
      }),
    });
    assert.equal(checkout.status, 409);
    assert.equal((await checkout.json() as ApiError).code, "MINIMUM_ORDER_QUANTITY");
  } finally {
    await db.update(productsTable).set({ minimumOrderQuantity: 1 }).where(eq(productsTable.id, createdProductId));
  }
});

test("waitlist stock transitions create one outbox event and worker replay creates one notification", async () => {
  assert.ok(createdProductId);
  const customer = await createTestUser();
  await db.update(productsTable).set({ stock: 0 }).where(eq(productsTable.id, createdProductId));
  const subscribe = await fetch(`${baseUrl}/shop/public/products/${createdProductId}/waitlist`, {
    method: "POST",
    headers: { cookie: customer.cookie },
  });
  assert.equal(subscribe.status, 201);
  const waitlist = await subscribe.json() as { id: string };

  await db.update(productsTable).set({ stock: 1 }).where(eq(productsTable.id, createdProductId));
  await db.update(productsTable).set({ stock: 2 }).where(eq(productsTable.id, createdProductId));
  const outbox = await db.select().from(productWaitlistNotificationOutboxTable)
    .where(eq(productWaitlistNotificationOutboxTable.waitlistId, waitlist.id));
  assert.equal(outbox.length, 1, "one availability episode has one durable outbox row");
  await db.update(productWaitlistNotificationOutboxTable).set({ createdAt: new Date(0) })
    .where(eq(productWaitlistNotificationOutboxTable.id, outbox[0]!.id));
  assert.deepEqual(await runProductWaitlistNotificationWorker(1), { processed: 1 });
  await db.update(productWaitlistNotificationOutboxTable).set({ processedAt: null, createdAt: new Date(0) })
    .where(eq(productWaitlistNotificationOutboxTable.id, outbox[0]!.id));
  assert.deepEqual(await runProductWaitlistNotificationWorker(1), { processed: 1 });
  const notifications = await db.select().from(commerceCustomerNotificationsTable)
    .where(eq(commerceCustomerNotificationsTable.waitlistId, waitlist.id));
  assert.equal(notifications.length, 1, "replaying a delivered outbox row is notification-idempotent");
});

test("authenticated checkout awards and reverses loyalty once, and repeat-last is request-idempotent", async () => {
  assert.ok(createdProductId);
  const customer = await createTestUser();
  const admin = await createTestUser("ADMIN");
  let [settingsBefore] = await db.select().from(shopSettingsTable).limit(1);
  const ownsSettings = !settingsBefore;
  if (!settingsBefore) {
    [settingsBefore] = await db.insert(shopSettingsTable).values({
      showLoyaltyPoints: true,
      pointsPer100Rsd: 1,
      lowStockThreshold: 5,
      defaultDeliveryBusinessDays: 3,
    }).returning();
  }
  assert.ok(settingsBefore);
  const [productBefore] = await db.select().from(productsTable).where(eq(productsTable.id, createdProductId)).limit(1);
  assert.ok(productBefore);
  await db.update(shopSettingsTable).set({ showLoyaltyPoints: true, pointsPer100Rsd: 2 })
    .where(eq(shopSettingsTable.id, settingsBefore.id));
  await db.update(productsTable).set({
    stock: 10, minimumOrderQuantity: 1, publicDiscountPrice: null, quantityPricingTiers: [],
  }).where(eq(productsTable.id, createdProductId));
  try {
    const request = retailClient(customer.cookie);
    assert.equal((await addRetailItem(request, createdProductId, 1)).status, 201);
    const previewResponse = await request("/retail/checkout-preview?deliveryMethod=courier&city=Novi%20Sad");
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as RetailCheckoutPreview;
    const checkout = await request("/retail/checkout", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `retail-loyalty-${randomUUID()}`,
        firstName: "Retail", lastName: "Loyalty", email: customer.user.email,
        phone: "+381601234567", street: "Test ulica 1", city: "Novi Sad", postalCode: "21000",
        paymentMethod: "BANK_TRANSFER", deliveryMethod: "courier",
        expectedSubtotal: preview.cart.subtotal, expectedShippingCost: preview.shipping.shippingCost,
        expectedTotal: preview.total,
      }),
    });
    assert.equal(checkout.status, 201);
    const order = await checkout.json() as RetailOrder;
    createdOrderIds.push(order.id);
    const awards = await db.select().from(loyaltyPointLedgerTable).where(eq(loyaltyPointLedgerTable.retailOrderId, order.id));
    assert.equal(awards.length, 1);
    assert.equal(awards[0]?.type, "AWARD");
    assert.equal(awards[0]?.points, 50);

    const reorderKey = `repeat-${randomUUID()}`;
    const repeated = await Promise.all([1, 2].map(() => request("/retail/orders/repeat-last", {
      method: "POST", headers: { "Idempotency-Key": reorderKey },
    })));
    assert.deepEqual(repeated.map((response) => response.status), [200, 200]);
    const outcomes = await Promise.all(repeated.map((response) => response.json()));
    assert.deepEqual(outcomes[0], outcomes[1]);
    const cartAfterRepeat = (outcomes[0] as { cart: RetailCart }).cart;
    assert.equal(cartAfterRepeat.items[0]?.quantity, 1, "a replay must not add the order twice");
    const actions = await db.select().from(reorderActionsTable).where(and(
      eq(reorderActionsTable.userId, customer.user.id),
      eq(reorderActionsTable.idempotencyKey, reorderKey),
    ));
    assert.equal(actions.length, 1);

    const cancel = () => fetch(`${baseUrl}/admin/retail-orders/${order.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin.cookie },
      body: JSON.stringify({ status: "cancelled" }),
    });
    assert.equal((await cancel()).status, 200);
    assert.equal((await cancel()).status, 200);
    const ledger = await db.select().from(loyaltyPointLedgerTable)
      .where(eq(loyaltyPointLedgerTable.retailOrderId, order.id));
    assert.equal(ledger.filter((entry) => entry.type === "AWARD").length, 1);
    assert.equal(ledger.filter((entry) => entry.type === "REVERSAL").length, 1);
    assert.equal(ledger.reduce((sum, entry) => sum + entry.points, 0), 0);
    const [stockAfter] = await db.select({ stock: productsTable.stock }).from(productsTable)
      .where(eq(productsTable.id, createdProductId)).limit(1);
    assert.equal(stockAfter?.stock, 10, "repeated cancellation restores checkout stock only once");
  } finally {
    if (ownsSettings) {
      await db.delete(shopSettingsTable).where(eq(shopSettingsTable.id, settingsBefore.id));
    } else {
      await db.update(shopSettingsTable).set({
        showLoyaltyPoints: settingsBefore.showLoyaltyPoints,
        pointsPer100Rsd: settingsBefore.pointsPer100Rsd,
      }).where(eq(shopSettingsTable.id, settingsBefore.id));
    }
    await db.update(productsTable).set({
      publicDiscountPrice: productBefore.publicDiscountPrice,
      quantityPricingTiers: productBefore.quantityPricingTiers,
      minimumOrderQuantity: productBefore.minimumOrderQuantity,
    }).where(eq(productsTable.id, createdProductId));
  }
});