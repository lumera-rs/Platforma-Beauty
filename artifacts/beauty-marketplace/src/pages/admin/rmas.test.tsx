import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AdminRmaDetail, AdminRmaListItem } from "@workspace/api-client-react";
import { RmaOrderReference } from "./rmas";

const baseRma = {
  rmaNumber: "RMA-2026-001",
  orderItemId: null,
  retailOrderItemId: null,
  requesterUserId: "user-1",
  quantity: 1,
  reason: "Oštećen proizvod",
  description: "Proizvod je stigao oštećen.",
  status: "RECEIVED",
  createdAt: "2026-09-03T08:00:00.000Z",
  updatedAt: "2026-09-03T08:00:00.000Z",
  target: "b2c",
  owner: {
    firstName: "Milica",
    lastName: "Jović",
    email: "milica@example.test",
  },
} satisfies Omit<AdminRmaListItem, "id" | "orderId" | "retailOrderId">;

function listRma(
  id: string,
  orderId: string | null,
  retailOrderId: string | null,
): AdminRmaListItem {
  return { ...baseRma, id, orderId, retailOrderId };
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