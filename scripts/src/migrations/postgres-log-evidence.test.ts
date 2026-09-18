import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNoDdlInBootWindow,
  assertPostgresLogSettings,
  assertProbeLogged,
  assertProofOutputDirectorySafe,
  parsePostgresLogEntries,
  proofOutputFromArgs,
} from "./postgres-log-evidence";

const settings = {
  databaseName: "owned_child",
  logStatement: "ddl",
  logLinePrefix: "%m db=%d user=%u ",
  logDestination: "stderr",
  logMinMessages: "warning",
};

test("boot log evidence requires database-tagged, complete, live probe records", () => {
  const probe = "startup_log_probe_after";
  const valid = [
    "2026-01-01 db=owned_child user=owner LOG:  statement: SELECT 1",
    `2026-01-01 db=owned_child user=owner LOG:  statement: CREATE TABLE public."${probe}" (`,
    "  id integer",
    ")",
    `2026-01-01 db=owned_child user=owner LOG:  statement: DROP TABLE public."${probe}"`,
  ].join("\n") + "\n";

  assertPostgresLogSettings(settings, "owned_child");
  assertProbeLogged(valid, "owned_child", probe);
  assertNoDdlInBootWindow(valid, "owned_child", probe);
  assert.match(parsePostgresLogEntries(valid)[1]?.statement ?? "", /\n  id integer\n\)/u);

  for (const malformed of [
    "",
    "2026-01-01 LOG:  statement: CREATE TABLE public.x (id integer)\n",
    `not-a-postgres-record db=owned_child statement: CREATE TABLE public."${probe}" (id integer)\n`,
    `2026-01-01 db=other_child LOG:  statement: CREATE TABLE public."${probe}" (id integer)\n`,
    `2026-01-01 db=owned_child LOG:  statement: CREATE TABLE public."${probe}" (id integer)`,
  ]) {
    assert.throws(() => assertProbeLogged(malformed, "owned_child", probe));
  }
  assert.throws(
    () => assertNoDdlInBootWindow(
      [
        "2026-01-01 db=owned_child LOG:  statement: SELECT 1",
        `not-a-postgres-record db=owned_child statement: CREATE TABLE public."${probe}" (id integer)`,
      ].join("\n") + "\n",
      "owned_child",
      "different_probe",
    ),
    /malformed/u,
  );
});

test("owned database settings reject untagged or non-DDL log configurations", () => {
  assert.throws(
    () => assertPostgresLogSettings({ ...settings, logStatement: "none" }, "owned_child"),
    /log_statement/u,
  );
  assert.throws(
    () => assertPostgresLogSettings({ ...settings, logLinePrefix: "%m user=%u " }, "owned_child"),
    /log_line_prefix/u,
  );
  assert.throws(
    () => assertPostgresLogSettings({ ...settings, logDestination: "csvlog" }, "owned_child"),
    /log_destination/u,
  );
  assert.throws(
    () => assertPostgresLogSettings({ ...settings, databaseName: "other_child" }, "owned_child"),
    /owned child/u,
  );
});

test("boot log evidence detects DDL on continuation lines and excludes only its own probe", () => {
  const probe = "startup_log_probe_after";
  const multilineDdl = [
    "2026-01-01 db=owned_child LOG:  execute <unnamed>:",
    "  ALTER TABLE public.users",
    "  ADD COLUMN unexpected integer",
    `2026-01-01 db=owned_child LOG:  statement: CREATE TABLE public."${probe}" (id integer)`,
    `2026-01-01 db=owned_child LOG:  statement: DROP TABLE public."${probe}"`,
  ].join("\n") + "\n";
  assert.throws(
    () => assertNoDdlInBootWindow(multilineDdl, "owned_child", probe),
    /startup DDL/u,
  );
});

test("normal proof output is ignored and versioned regeneration is explicit", () => {
  const root = path.resolve("/workspace");
  const normal = proofOutputFromArgs([], root);
  assert.equal(normal.regeneratesVersionedEvidence, false);
  assert.equal(normal.directory, path.join(root, ".local/startup-ddl-equivalence-evidence/supported-path-boot"));
  assert.doesNotMatch(normal.directory, /docs\/startup-ddl-equivalence\/evidence/u);

  assert.throws(
    () => proofOutputFromArgs(["--evidence-dir=docs/startup-ddl-equivalence/evidence"], root),
    /Refusing to overwrite/u,
  );
  assert.throws(
    () => proofOutputFromArgs(["--evidence-dir=docs/startup-ddl-equivalence/evidence/nested"], root),
    /Refusing to overwrite/u,
  );
  assert.throws(
    () => proofOutputFromArgs(["--evidence-dir=scripts/proof-output"], root),
    /outside the workspace or inside ignored/u,
  );
  assert.deepEqual(
    proofOutputFromArgs(["--evidence-dir=/external/proof-output"], root),
    { directory: "/external/proof-output", regeneratesVersionedEvidence: false },
  );
  assert.deepEqual(
    proofOutputFromArgs(["--regenerate-versioned-evidence"], root),
    {
      directory: path.join(root, "docs/startup-ddl-equivalence/evidence"),
      regeneratesVersionedEvidence: true,
    },
  );
});

test("canonical evidence output cannot escape ignored .local through a symlink", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "postgres-log-evidence-"));
  try {
    await fs.mkdir(path.join(root, ".local"));
    await fs.mkdir(path.join(root, "docs/startup-ddl-equivalence/evidence"), { recursive: true });
    await fs.symlink(
      path.join(root, "docs/startup-ddl-equivalence/evidence"),
      path.join(root, ".local/escaped-evidence"),
      "dir",
    );
    const escaped = proofOutputFromArgs(["--evidence-dir=.local/escaped-evidence"], root);
    await assert.rejects(
      () => assertProofOutputDirectorySafe(escaped, root),
      /canonical path escapes ignored/u,
    );
    await assert.doesNotReject(() => assertProofOutputDirectorySafe(
      proofOutputFromArgs(["--evidence-dir=.local/safe-evidence"], root),
      root,
    ));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});