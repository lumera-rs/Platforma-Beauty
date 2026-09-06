/**
 * Regression: the Anthropic integration must not be required at import time.
 *
 * lib/integrations-anthropic-ai/src/client.ts used to validate
 * AI_INTEGRATIONS_ANTHROPIC_BASE_URL / _API_KEY and construct the client at
 * module scope. Those variables are provisioned by Replit and are absent in
 * GitHub Actions, so the throw fired during plain module loading. The only
 * consumer is growth-ai-snapshot.ts, which is pulled in transitively by
 *
 *   app.ts -> routes/index.ts -> routes/growth.ts -> lib/growth-ai-snapshot.ts
 *
 * so *importing the Express app at all* required the integration. That broke
 * the "Database checks (isolated PostgreSQL)" CI job at its first step,
 * test:monitoring, which imports ../app purely to exercise request logging
 * and fatal handlers and never issues an AI request.
 *
 * Validation is now deferred to first use. These tests pin both halves of
 * that contract: unrelated imports must succeed without the integration, and
 * code that genuinely reaches the provider must still fail loudly, with the
 * unchanged diagnostics.
 *
 * Each scenario runs in its own child process: the guarantee is about module
 * *load* behaviour under a specific environment, and the client is memoised
 * per process, so neither can be observed correctly by mutating env inside a
 * single already-loaded test process.
 *
 * Run:
 * NODE_ENV=test pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/anthropic-integration-lazy-init.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const apiServerDir = path.resolve(thisDir, "..", "..");
const workspaceRoot = path.resolve(apiServerDir, "..", "..");
const tsxBin = path.resolve(workspaceRoot, "scripts", "node_modules", ".bin", "tsx");

const MISSING_BASE_URL_MESSAGE =
  "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?";
const MISSING_API_KEY_MESSAGE =
  "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?";

type RunResult = { code: number; stdout: string; stderr: string };

/**
 * Runs `source` in a fresh process. `anthropicEnv` controls only the two
 * integration variables -- omitted keys are actively removed from the child's
 * environment, so a variable set in the developer's shell (or by another
 * suite) can never mask a regression here.
 */
async function runInChild(
  source: string,
  anthropicEnv: { baseUrl?: string; apiKey?: string } = {},
): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    // growth-ai-snapshot.ts imports @workspace/db, which still (correctly)
    // requires a database URL at import time; keep the ambient one so this
    // test isolates the Anthropic variables and nothing else.
    DATABASE_URL: process.env.DATABASE_URL ?? "",
    SESSION_SECRET: process.env.SESSION_SECRET ?? "anthropic-lazy-init-test-secret",
  };
  delete env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"];
  delete env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"];
  if (anthropicEnv.baseUrl !== undefined) env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] = anthropicEnv.baseUrl;
  if (anthropicEnv.apiKey !== undefined) env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] = anthropicEnv.apiKey;

  try {
    const { stdout, stderr } = await execFileAsync(tsxBin, ["-e", source], { cwd: apiServerDir, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

void test("importing the integration package without the env vars does not throw", async () => {
  const result = await runInChild(
    `import('@workspace/integrations-anthropic-ai')
       .then((m) => console.log('OK:' + Object.keys(m).sort().join(',')))
       .catch((e) => { console.error('THREW:' + e.message); process.exitCode = 1; });`,
  );
  assert.equal(result.code, 0, `importing the package must not throw. stderr: ${result.stderr}`);
  assert.match(result.stdout, /OK:assertAnthropicIntegrationConfigured,getAnthropicClient/);
});

void test("importing the Express app without the env vars does not throw (the exact CI failure)", async () => {
  // This is the import that broke the Database checks job: app.ts reaches
  // growth-ai-snapshot.ts transitively through routes/growth.ts.
  const result = await runInChild(
    `import('./src/app.ts')
       .then((m) => console.log(m.default ? 'APP_OK' : 'APP_NO_DEFAULT'))
       .catch((e) => { console.error('THREW:' + e.message); process.exitCode = 1; });`,
  );
  assert.equal(result.code, 0, `importing app.ts must not require the Anthropic integration. stderr: ${result.stderr}`);
  assert.match(result.stdout, /APP_OK/);
});

void test("importing the AI snapshot module itself without the env vars does not throw", async () => {
  const result = await runInChild(
    `import('./src/lib/growth-ai-snapshot.ts')
       .then((m) => console.log(typeof m.askGrowthAi === 'function' ? 'SNAPSHOT_OK' : 'SNAPSHOT_BAD'))
       .catch((e) => { console.error('THREW:' + e.message); process.exitCode = 1; });`,
  );
  assert.equal(result.code, 0, `importing growth-ai-snapshot.ts must not throw. stderr: ${result.stderr}`);
  assert.match(result.stdout, /SNAPSHOT_OK/);
});

void test("getAnthropicClient() still throws the original diagnostics when unprovisioned", async () => {
  const result = await runInChild(
    `import('@workspace/integrations-anthropic-ai')
       .then((m) => { try { m.getAnthropicClient(); console.log('NO_THROW'); }
                      catch (e) { console.log('THREW:' + e.message); } });`,
  );
  assert.equal(result.code, 0);
  assert.ok(!result.stdout.includes("NO_THROW"), "an unprovisioned integration must not hand back a client");
  assert.ok(
    result.stdout.includes(MISSING_BASE_URL_MESSAGE),
    `production validation must be unchanged on the real AI path. stdout: ${result.stdout}`,
  );
});

void test("a provisioned base URL but missing API key still reports the API key diagnostic", async () => {
  const result = await runInChild(
    `import('@workspace/integrations-anthropic-ai')
       .then((m) => { try { m.getAnthropicClient(); console.log('NO_THROW'); }
                      catch (e) { console.log('THREW:' + e.message); } });`,
    { baseUrl: "http://127.0.0.1:1" },
  );
  assert.equal(result.code, 0);
  assert.ok(!result.stdout.includes("NO_THROW"));
  assert.ok(
    result.stdout.includes(MISSING_API_KEY_MESSAGE),
    `both variables must still be enforced. stdout: ${result.stdout}`,
  );
});

void test("assertAnthropicIntegrationConfigured() throws when unprovisioned and passes when provisioned", async () => {
  const unprovisioned = await runInChild(
    `import('@workspace/integrations-anthropic-ai')
       .then((m) => { try { m.assertAnthropicIntegrationConfigured(); console.log('NO_THROW'); }
                      catch (e) { console.log('THREW:' + e.message); } });`,
  );
  assert.equal(unprovisioned.code, 0);
  assert.ok(unprovisioned.stdout.includes(MISSING_BASE_URL_MESSAGE), unprovisioned.stdout);

  const provisioned = await runInChild(
    `import('@workspace/integrations-anthropic-ai')
       .then((m) => { m.assertAnthropicIntegrationConfigured(); console.log('ASSERT_OK'); })
       .catch((e) => { console.error('THREW:' + e.message); process.exitCode = 1; });`,
    { baseUrl: "http://127.0.0.1:1", apiKey: "test-key-not-used-for-any-request" },
  );
  assert.equal(provisioned.code, 0, provisioned.stderr);
  assert.match(provisioned.stdout, /ASSERT_OK/);
});

void test("getAnthropicClient() builds a configured, memoised client when provisioned", async () => {
  const result = await runInChild(
    `import('@workspace/integrations-anthropic-ai')
       .then((m) => {
         const a = m.getAnthropicClient();
         const b = m.getAnthropicClient();
         console.log('SAME:' + (a === b) + ' BASEURL:' + a.baseURL);
       })
       .catch((e) => { console.error('THREW:' + e.message); process.exitCode = 1; });`,
    { baseUrl: "http://127.0.0.1:1", apiKey: "test-key-not-used-for-any-request" },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /SAME:true/, "the client must stay a per-process singleton, as it was when built at import time");
  assert.match(result.stdout, /BASEURL:http:\/\/127\.0\.0\.1:1/, "the configured base URL must reach the SDK");
});
