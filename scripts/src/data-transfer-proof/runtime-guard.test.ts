import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { assertDestructiveTestRuntimeAllowed, destructiveTestGuardEnvironments } from "../destructive-test-runtime";

assertDestructiveTestRuntimeAllowed(process.env, "Data transfer runtime guard regression");

const execute = promisify(execFile);
const workspace = path.resolve(import.meta.dirname, "../../..");

test("data transfer harnesses refuse every deployment marker before PostgreSQL processes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumera-transfer-guard-"));
  const bin = path.join(root, "bin");
  const marker = path.join(root, "database-command-attempt");
  try {
    await mkdir(bin);
    for (const command of ["initdb", "pg_ctl", "pg_restore", "postgres", "psql"]) {
      await writeFile(path.join(bin, command), `#!/bin/sh\nprintf '${command}\\n' >> '${marker}'\nexit 97\n`, { mode: 0o755 });
    }
    for (const script of ["data-transfer-proof/owned-pair.ts", "data-transfer-tests/transfer.integration.test.ts"]) {
      for (const environment of destructiveTestGuardEnvironments) {
        let observed = "";
        try {
          await execute(path.join(workspace, "scripts/node_modules/.bin/tsx"), [path.join(workspace, "scripts/src", script)], {
            cwd: workspace,
            env: { HOME: os.homedir(), PATH: `${bin}:${process.env.PATH}`, CI: "true", NODE_ENV: "test", ...environment.values },
            timeout: 30_000,
          });
          assert.fail(`Harness admitted deployment marker: ${script}`);
        } catch (error) {
          observed = String((error as { stderr?: string }).stderr ?? "");
          assert.match(observed, /Destructive test harnesses refuse production or deployment runtimes/);
        }
        await assert.rejects(access(marker), { code: "ENOENT" });
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});