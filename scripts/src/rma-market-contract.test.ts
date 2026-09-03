import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminGetRmaResponse,
  AdminListRmasResponse,
} from "@workspace/api-zod";

const standardRma = {
  id: "00000000-0000-4000-8000-000000000001",
  rmaNumber: "RMA-B2B-1",
  requesterUserId: "00000000-0000-4000-8000-000000000002",
  quantity: 1,
  reason: "Damaged",
  description: "Damaged standard order item",
  status: "RECEIVED",
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
  orderId: "00000000-0000-4000-8000-000000000003",
  orderItemId: "00000000-0000-4000-8000-000000000004",
  retailOrderId: null,
  retailOrderItemId: null,
  target: "b2b",
  owner: {
    firstName: "Standard",
    lastName: "Buyer",
    businessName: "Standard Salon",
    pib: "123456789",
    email: "standard@example.test",
  },
} as const;

const retailRma = {
  ...standardRma,
  id: "00000000-0000-4000-8000-000000000005",
  rmaNumber: "RMA-B2C-1",
  description: "Damaged retail order item",
  orderId: null,
  orderItemId: null,
  retailOrderId: "00000000-0000-4000-8000-000000000006",
  retailOrderItemId: "00000000-0000-4000-8000-000000000007",
  target: "b2c",
  owner: {
    firstName: "Retail",
    lastName: "Buyer",
    businessName: null,
    pib: null,
    email: "retail@example.test",
  },
} as const;

const detailFields = {
  items: [{
    orderItemId: "00000000-0000-4000-8000-000000000008",
    productName: "Test product",
    quantity: 1,
  }],
  privatePhotos: [],
  auditTrail: [{
    action: "CREATED",
    timestamp: "2026-09-03T10:00:00.000Z",
    actorId: null,
    note: null,
  }],
} as const;

test("RMA list contracts pair standard orders with b2b and retail orders with b2c", () => {
  assert.equal(AdminListRmasResponse.safeParse([standardRma, retailRma]).success, true);
  assert.equal(
    AdminListRmasResponse.safeParse([{ ...standardRma, target: "b2c" }]).success,
    false,
  );
  assert.equal(
    AdminListRmasResponse.safeParse([{ ...retailRma, target: "b2b" }]).success,
    false,
  );
});

test("RMA detail contracts pair standard orders with b2b and retail orders with b2c", () => {
  const standardDetail = { ...standardRma, ...detailFields };
  const retailDetail = { ...retailRma, ...detailFields };

  assert.equal(AdminGetRmaResponse.safeParse(standardDetail).success, true);
  assert.equal(AdminGetRmaResponse.safeParse(retailDetail).success, true);
  assert.equal(
    AdminGetRmaResponse.safeParse({ ...standardDetail, target: "b2c" }).success,
    false,
  );
  assert.equal(
    AdminGetRmaResponse.safeParse({ ...retailDetail, target: "b2b" }).success,
    false,
  );
});