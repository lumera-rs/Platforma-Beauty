import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminRmaDetail, AdminRmaListItem } from "@workspace/api-client-react";
import { RmaOrderReference } from "./rmas";

const baseRma = {
  rmaNumber: "RMA-2026-001",
  requesterUserId: "user-1",
  quantity: 1,
  reason: "Oštećen proizvod",
  description: "Proizvod je stigao oštećen.",
  status: "RECEIVED",
  createdAt: "2026-09-03T08:00:00.000Z",
  updatedAt: "2026-09-03T08:00:00.000Z",
  owner: {
    firstName: "Milica",
    lastName: "Jović",
    email: "milica@example.test",
  },
} satisfies Omit<AdminRmaListItem, "id" | "orderId" | "orderItemId" | "retailOrderId" | "retailOrderItemId" | "target">;

// @ts-expect-error A standard order cannot carry the retail market label.
const contradictoryStandardRma: AdminRmaListItem = {
  ...baseRma, id: "standard-rma", target: "b2c", orderId: "standard-order", orderItemId: "standard-item", retailOrderId: null, retailOrderItemId: null,
};
// @ts-expect-error A retail order cannot carry the standard market label.
const contradictoryRetailRma: AdminRmaListItem = {
  ...baseRma, id: "retail-rma", target: "b2b", orderId: null, orderItemId: null, retailOrderId: "retail-order", retailOrderItemId: "retail-item",
};
void contradictoryStandardRma;
void contradictoryRetailRma;

function listRma(
  id: string,
  orderId: string | null,
  retailOrderId: string | null,
): AdminRmaListItem {
  return orderId
    ? { ...baseRma, id, target: "b2b", orderId, orderItemId: `${id}-item`, retailOrderId: null, retailOrderItemId: null }
    : { ...baseRma, id, target: "b2c", orderId: null, orderItemId: null, retailOrderId: retailOrderId!, retailOrderItemId: `${id}-item` };
}

function detailRma(rma: AdminRmaListItem): AdminRmaDetail {
  return {
    ...rma,
    items: [],
    privatePhotos: [],
    auditTrail: [],
  };
}

const cases = [
  {
    name: "standard order",
    list: listRma("standard-rma", "standard-order-id", null),
    expected: "standard",
  },
  {
    name: "retail order",
    list: listRma("retail-rma", null, "retail-order-id"),
    expected: "retail-o",
  },
  {
    name: "missing order",
    list: listRma("missing-rma", null, null),
    expected: "—",
  },
] as const;

for (const testCase of cases) {
  test(`RMA list and detail show the ${testCase.name} reference safely`, () => {
    const listHtml = renderToStaticMarkup(
      <RmaOrderReference rma={testCase.list} context="list" />,
    );
    const detail: AdminRmaDetail = detailRma(testCase.list);
    const detailHtml = renderToStaticMarkup(
      <RmaOrderReference rma={detail} context="detail" />,
    );

    assert.equal(listHtml, `Porudžbina: ${testCase.expected}`);
    assert.equal(detailHtml, `Porudžbina #${testCase.expected}`);
  });
}