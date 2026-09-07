import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as apiSchemas from "@workspace/api-zod";

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

const mixedRma = {
  ...standardRma,
  retailOrderId: retailRma.retailOrderId,
  retailOrderItemId: retailRma.retailOrderItemId,
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

type RmaResponseCase = {
  schema: {
    safeParse(value: unknown): { success: boolean };
  };
  standard: unknown;
  retail: unknown;
  mixed: unknown;
};

const responseCases: Record<string, RmaResponseCase> = {
  AdminListRmasResponse: {
    schema: apiSchemas.AdminListRmasResponse,
    standard: [standardRma],
    retail: [retailRma],
    mixed: [mixedRma],
  },
  AdminGetRmaResponse: {
    schema: apiSchemas.AdminGetRmaResponse,
    standard: { ...standardRma, ...detailFields },
    retail: { ...retailRma, ...detailFields },
    mixed: { ...mixedRma, ...detailFields },
  },
  AdminUpdateRmaStatusResponse: {
    schema: apiSchemas.AdminUpdateRmaStatusResponse,
    standard: { row: withoutPresentationFields(standardRma), changed: true },
    retail: { row: withoutPresentationFields(retailRma), changed: false },
    mixed: { row: withoutPresentationFields(mixedRma), changed: true },
  },
};

function withoutPresentationFields(rma: typeof standardRma | typeof retailRma | typeof mixedRma) {
  const { target: _target, owner: _owner, ...row } = rma;
  return row;
}

function discoverRmaResponses(): string[] {
  const generatedSource = readFileSync(
    new URL("../../lib/api-zod/src/generated/api.ts", import.meta.url),
    "utf8",
  );
  const declarations = new Map<string, string>();
  const declarationPattern = /^export const ([A-Za-z0-9_]+)\s*=/gm;
  const matches = [...generatedSource.matchAll(declarationPattern)];

  for (const [index, match] of matches.entries()) {
    const start = match.index;
    const end = matches[index + 1]?.index ?? generatedSource.length;
    declarations.set(match[1], generatedSource.slice(start, end));
  }

  const declarationNames = new Set(declarations.keys());
  const dependencies = new Map(
    [...declarations].map(([name, declaration]) => [
      name,
      [...new Set(declaration.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [])]
        .filter((token) => token !== name && declarationNames.has(token)),
    ]),
  );

  const containsRmaRecord = (name: string, visited = new Set<string>()): boolean => {
    if (visited.has(name)) return false;
    visited.add(name);
    const declaration = declarations.get(name);
    if (!declaration) return false;
    if (
      declaration.includes('"rmaNumber"') &&
      declaration.includes('"orderId"') &&
      declaration.includes('"retailOrderId"')
    ) {
      return true;
    }
    return (dependencies.get(name) ?? []).some((dependency) =>
      containsRmaRecord(dependency, visited),
    );
  };

  return [...declarations.keys()]
    .filter((name) => name.endsWith("Response") && containsRmaRecord(name))
    .sort();
}

test("every generated RMA response is inventoried by the market contract check", () => {
  const discovered = discoverRmaResponses();
  const covered = Object.keys(responseCases).sort();
  const uncovered = discovered.filter((name) => !responseCases[name]);
  const stale = covered.filter((name) => !discovered.includes(name));

  assert.deepEqual(
    { uncovered, stale },
    { uncovered: [], stale: [] },
    [
      uncovered.length
        ? `New generated RMA responses need standard, retail, and mixed-row fixtures: ${uncovered.join(", ")}.`
        : "",
      stale.length
        ? `RMA response fixtures no longer match a generated response: ${stale.join(", ")}.`
        : "",
    ].filter(Boolean).join(" "),
  );
});

for (const [name, responseCase] of Object.entries(responseCases)) {
  test(`${name} accepts standard and retail rows but rejects mixed market identifiers`, () => {
    assert.equal(
      responseCase.schema.safeParse(responseCase.standard).success,
      true,
      `${name} must accept a valid standard-order RMA row`,
    );
    assert.equal(
      responseCase.schema.safeParse(responseCase.retail).success,
      true,
      `${name} must accept a valid retail-order RMA row`,
    );
    assert.equal(
      responseCase.schema.safeParse(responseCase.mixed).success,
      false,
      `${name} must reject an RMA row containing both standard and retail identifiers`,
    );
  });
}
