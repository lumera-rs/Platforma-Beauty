import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicOnlyNamespaces,
  NON_PUBLIC_NAMESPACE_REASON,
} from "./namespaces";

test("public and PostgreSQL namespaces are accepted", async () => {
  const client = {
    async query(sql: string) {
      assert.match(sql, /pg_catalog\.pg_namespace/u);
      return { rows: [{ has_unsupported_namespace: false }] };
    },
  };
  await assert.doesNotReject(() => assertPublicOnlyNamespaces(client));
});

test("an application namespace is rejected without exposing its name", async () => {
  const client = {
    async query() {
      return { rows: [{ has_unsupported_namespace: true }] };
    },
  };
  await assert.rejects(
    () => assertPublicOnlyNamespaces(client),
    (error: unknown) => error instanceof Error
      && error.message === NON_PUBLIC_NAMESPACE_REASON
      && !error.message.includes("shadow"),
  );
});