import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const runnerPath = path.join(workspaceRoot, "scripts", "node_modules", ".bin", "tsx");
const wrapperPath = path.join(workspaceRoot, "scripts", "src", "ensure-retail-cart-index-ci.ts");

async function runWrapper(databaseUrl: string, environment: NodeJS.ProcessEnv = {}): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      CI: "true",
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      ...environment,
    };
    const child = spawn(runnerPath, [wrapperPath], {
      cwd: workspaceRoot,
      env: childEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("retail cart CI wrapper rejects non-isolated targets before opening a connection", async () => {
  const invalidTargets = [
    {
      label: "non-loopback host",
      url: "postgres://lumera_ci:lumera_ci@192.0.2.1:1/lumera_ci_database",
    },
    {
      label: "wrong database name",
      url: "postgres://lumera_ci:lumera_ci@127.0.0.1:1/not_the_ci_database",
    },
    {
      label: "query host override",
      url: "postgres://lumera_ci:lumera_ci@127.0.0.1:1/lumera_ci_database?host=192.0.2.1",
    },
    {
      label: "fragment override",
      url: "postgres://lumera_ci:lumera_ci@127.0.0.1:1/lumera_ci_database#host=192.0.2.1",
    },
  ];

  for (const target of invalidTargets) {
    const result = await runWrapper(target.url);
    assert.notEqual(result.code, 0, `${target.label} must fail closed.`);
    assert.match(
      result.stderr,
      /Retail cart CI reconciliation (?:requires an isolated loopback database|is restricted to the isolated CI database)/,
      `${target.label} must be rejected by the wrapper before reconciliation.`,
    );
    assert.doesNotMatch(
      result.stderr,
      /ECONNREFUSED|ENETUNREACH|ETIMEDOUT|connect timeout/i,
      `${target.label} must fail before attempting a database connection.`,
    );
  }
});