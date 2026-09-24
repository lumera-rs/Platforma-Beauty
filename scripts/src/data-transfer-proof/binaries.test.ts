import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { isolatedEnvironment, postgresPrograms, withOwnedPair } from "./owned-pair";

test("explicit PostgreSQL directory resolves absolute programs without PATH lookup", async () => {
  const directory = process.env.LUMERA_POSTGRES_16_BIN;
  assert.ok(directory, "run binary proof with explicit LUMERA_POSTGRES_16_BIN");
  const programs = await postgresPrograms({ PATH: "/nonexistent", LUMERA_POSTGRES_16_BIN: directory });
  for (const [name, program] of Object.entries(programs)) {
    assert.equal(program, path.resolve(directory, name));
  }
  await assert.rejects(postgresPrograms({ PATH: process.env.PATH, LUMERA_POSTGRES_16_BIN: "/nonexistent" }),
    /PostgreSQL 16 binaries unavailable/);
});

test("owned PostgreSQL cluster works with initdb absent from PATH", async () => {
  assert.equal(execFileSync("/bin/bash", ["-c", "if command -v initdb; then exit 1; else printf absent; fi"],
    { env: isolatedEnvironment(), encoding: "utf8" }), "absent");
  await withOwnedPair(async ({ target }) => {
    const result = await target.query("SHOW server_version_num");
    assert.equal(Math.floor(Number(result.rows[0].server_version_num) / 10000), 16);
  });
});