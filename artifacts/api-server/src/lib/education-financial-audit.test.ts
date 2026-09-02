import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, educationFinancialAuditLogTable } from "@workspace/db";
import {
  redactEducationFinancialAuditSnapshot,
  writeEducationFinancialAuditInTx,
} from "./education-financial-audit";

async function run(): Promise<void> {
  const snapshot = redactEducationFinancialAuditSnapshot({
    nested: {
      apiToken: "never-store",
      password: "never-store",
      private_key: "never-store",
      rawAccount: "160000000000000000",
      accountSummary: "••••0000",
      maskedAccount: "••••0000",
      safe: { credential: "never-store", amount: 45 },
    },
    date: new Date("2025-01-02T03:04:05.000Z"),
    amount: 12n,
    nonFinite: Number.POSITIVE_INFINITY,
  });
  assert.equal(snapshot!.nested && (snapshot!.nested as any).apiToken, "[REDACTED]");
  assert.equal((snapshot!.nested as any).password, "[REDACTED]");
  assert.equal((snapshot!.nested as any).private_key, "[REDACTED]");
  assert.equal((snapshot!.nested as any).rawAccount, "[REDACTED]");
  assert.equal((snapshot!.nested as any).accountSummary, "••••0000");
  assert.equal((snapshot!.nested as any).maskedAccount, "••••0000");
  assert.equal(((snapshot!.nested as any).safe as any).credential, "[REDACTED]");
  assert.equal(snapshot!.date, "2025-01-02T03:04:05.000Z");
  assert.equal(snapshot!.amount, "12");
  assert.equal(snapshot!.nonFinite, "Infinity");

  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let index = 0; index < 12; index += 1) {
    cursor.child = {};
    cursor = cursor.child as Record<string, unknown>;
  }
  const bounded = redactEducationFinancialAuditSnapshot({
    deep,
    entries: Array.from({ length: 101 }, (_, index) => index),
  })!;
  let depthValue: any = bounded.deep;
  for (let index = 0; index < 9; index += 1) depthValue = depthValue.child;
  assert.equal(depthValue, "[truncated: maximum depth]");
  assert.equal((bounded.entries as unknown[]).at(-1), "[truncated: additional items]");
  assert.throws(() => redactEducationFinancialAuditSnapshot("not-an-object"), /snapshots must be objects/i);

  await assert.rejects(
    () => db.transaction((tx) => writeEducationFinancialAuditInTx(tx, {
      actorUserId: null, action: " ", entityType: "education_test", entityId: "x",
    })),
    /action is required/i,
  );
  await assert.rejects(
    () => db.transaction((tx) => writeEducationFinancialAuditInTx(tx, {
      actorUserId: null, action: "x".repeat(161), entityType: "education_test", entityId: "x",
    })),
    /action exceeds 160/i,
  );

  const marker = randomUUID();
  const rollbackMarker = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await writeEducationFinancialAuditInTx(tx, {
        actorUserId: null,
        action: "education_financial_audit_test",
        entityType: "education_test",
        entityId: marker,
        oldValue: { status: "pending", bankAccount: "160000000000000000" },
        newValue: { status: "settled", amount: 123 },
        reason: "test persisted audit",
      });
    });
    const [persisted] = await db.select().from(educationFinancialAuditLogTable)
      .where(eq(educationFinancialAuditLogTable.entityId, marker)).limit(1);
    assert.ok(persisted);
    assert.equal(persisted.actorUserId, null);
    assert.equal((persisted.oldValue as any).bankAccount, "[REDACTED]");
    assert.equal((persisted.newValue as any).status, "settled");

    await assert.rejects(
      () => db.transaction(async (tx) => {
        await writeEducationFinancialAuditInTx(tx, {
          actorUserId: null, action: "education_financial_audit_rollback_test",
          entityType: "education_test", entityId: rollbackMarker,
        });
        throw new Error("force rollback");
      }),
      /force rollback/,
    );
    const rolledBack = await db.select({ id: educationFinancialAuditLogTable.id })
      .from(educationFinancialAuditLogTable)
      .where(eq(educationFinancialAuditLogTable.entityId, rollbackMarker));
    assert.equal(rolledBack.length, 0);
  } finally {
    await db.delete(educationFinancialAuditLogTable)
      .where(eq(educationFinancialAuditLogTable.entityId, marker));
  }
}

void run();