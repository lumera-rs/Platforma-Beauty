import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("production is refused before initdb is invoked", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "destructive-runner-guard-"));
  const initdb = path.join(directory, "initdb");
  const called = path.join(directory, "initdb-called");
  try {
    await writeFile(initdb, "#!/bin/sh\ntouch \"$INITDB_CALLED_MARKER\"\nexit 99\n");
    await chmod(initdb, 0o755);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/run-destructive-test.ts", "--", "true"],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
          INITDB_CALLED_MARKER: called,
          NODE_ENV: "production",
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refuses production or deployment runtimes/u);
    await assert.rejects(
      access(called),
      /ENOENT/u,
      "initdb must not be called in a production runtime",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("database child output is piped through redaction instead of inherited", async () => {
  const source = await readFile(
    path.join(import.meta.dirname, "run-destructive-test.ts"),
    "utf8",
  );
  assert.match(
    source,
    /stdio:\s*\["ignore",\s*"pipe",\s*"pipe"\][\s\S]*pipeRedactedDatabaseOutput\(child,\s*environment\)/,
  );
  assert.doesNotMatch(source, /stdio:\s*"inherit"/);
});