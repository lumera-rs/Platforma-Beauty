import test from "node:test";
import assert from "node:assert/strict";
import { inspectTriggerPolicy, validatingTriggers, mutatingTriggers } from "./trigger-policy";
import { assertDestructiveTestRuntimeAllowed } from "../destructive-test-runtime";

assertDestructiveTestRuntimeAllowed(process.env, "Data transfer trigger policy tests");

test("canonical trigger policy classifies exactly twenty-four distinct triggers", () => {
  assert.equal(validatingTriggers.length, 21);
  assert.equal(mutatingTriggers.length, 3);
  assert.equal(new Set([...validatingTriggers, ...mutatingTriggers.map(t => t.key)]).size, 24);
});

test("unknown and disabled validating triggers fail closed", async () => {
  const client = { async query() { return { rows: [{ relname: "products", tgname: "unknown", tgenabled: "O" }] }; } };
  await assert.rejects(() => inspectTriggerPolicy(client), { message: "UNCLASSIFIED_TRIGGER" });
  client.query = async () => ({ rows: [{ relname: "products", tgname: "products_supplier_ownership", tgenabled: "D" }] });
  await assert.rejects(() => inspectTriggerPolicy(client), { message: "UNCLASSIFIED_TRIGGER" });
});

test("validating ownership trigger never enters the disable list", async () => {
  const client = { async query() { return { rows: [
    { relname: "products", tgname: "products_supplier_ownership", tgenabled: "O" },
    { relname: "products", tgname: "products_enqueue_restocked_waitlist", tgenabled: "O" },
  ] }; } };
  assert.deepEqual(await inspectTriggerPolicy(client), ["products.products_enqueue_restocked_waitlist"]);
});