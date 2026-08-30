import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const state = path.join(root, ".lumera-test-state", "booking-load-databases");
const reportDirectory = path.join(root, "reports", "booking-load");
const prefix = "lumera_booking_load_";
const namePattern = /^lumera_booking_load_\d+_[a-f0-9]{32}$/;
const parseInteger = (key: string, fallback: number, minimum: number, maximum: number) => {
  const raw = process.env[key] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(raw);
};
const target = () => {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.LUMERA_BOOKING_LOAD !== "1") throw new Error("Booking load requires LUMERA_BOOKING_LOAD=1 and a named development DATABASE_URL.");
  const url = new URL(raw);
  if (!url.pathname || url.pathname === "/") throw new Error("Booking load requires a named development maintenance database.");
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1" || process.env.REPL_DEPLOYMENT === "1") throw new Error("Booking load refuses production or deployment runtimes.");
  if (namePattern.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error("Booking load refuses a disposable database as its maintenance target.");
  return raw;
};
const targetIdentity = (raw: string) => {
  const url = new URL(raw);
  return `${url.protocol}//${url.hostname}:${url.port}/${decodeURIComponent(url.pathname.slice(1))}`;
};
const testUrl = (base: string, database: string) => { const url = new URL(base); url.pathname = `/${database}`; return url.toString(); };
function isolatedEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, LUMERA_TEST_DATABASE_URL: databaseUrl, LUMERA_BOOKING_LOAD: "1" };
  const loadConnectionTimeout = process.env.LUMERA_BOOKING_LOAD_DB_CONN_TIMEOUT_MS ?? "15000";
  if (!/^\d+$/.test(loadConnectionTimeout) || Number(loadConnectionTimeout) < 500 || Number(loadConnectionTimeout) > 60_000) {
    throw new Error("LUMERA_BOOKING_LOAD_DB_CONN_TIMEOUT_MS must be an integer from 500 to 60000.");
  }
  environment.DB_CONN_TIMEOUT_MS = loadConnectionTimeout;
  environment.DB_POOL_MAX = String(parseInteger("LUMERA_BOOKING_LOAD_POOL_MAX", 10, 4, 50));
  // Test traffic must not inherit any delivery connector, sender, webhook, or
  // provider configuration from the developer shell.
  for (const key of Object.keys(environment)) if (/(BREVO|SMS|TWILIO|SENDGRID|RESEND|MAILGUN|SMTP|EMAIL.*(?:KEY|URL|SENDER)|WEBHOOK)/i.test(key)) delete environment[key];
  delete environment.LUMERA_TEST_SEED;
  return environment;
}
const run = (command: string, args: string[], env: NodeJS.ProcessEnv) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, detached: process.platform !== "win32", stdio: "inherit" });
  child.once("error", () => reject(new Error(`${command} could not start`)));
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed`)));
});
const port = async () => {
  const server = createServer().listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("Could not allocate loopback port.");
  return address.port;
};
const stop = async (child?: ChildProcess) => {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch {} } else child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) { if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); } catch {} } else child.kill("SIGKILL"); }
};
async function processIdentity(pid: number): Promise<string | undefined> {
  try {
    const [boot, stat] = await Promise.all([readFile("/proc/sys/kernel/random/boot_id", "utf8"), readFile(`/proc/${pid}/stat`, "utf8")]);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return boot.trim() && fields[19] ? `${boot.trim()}:${fields[19]}` : undefined;
  } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
}
async function recover(base: string) {
  const malformed: string[] = [];
  try {
    for (const entry of await readdir(state)) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(state, entry); let manifest: { databaseName?: string; target?: string; ownerPid?: number; ownerIdentity?: string };
      try { manifest = JSON.parse(await readFile(file, "utf8")); } catch { malformed.push(entry); continue; }
      if (!manifest.databaseName || typeof manifest.target !== "string" || !namePattern.test(manifest.databaseName) || entry !== `${manifest.databaseName}.json` || !Number.isSafeInteger(manifest.ownerPid) || !manifest.ownerIdentity) { malformed.push(entry); continue; }
      if (manifest.target !== targetIdentity(base)) continue;
      const ownerPid = manifest.ownerPid;
      if (typeof ownerPid !== "number") { malformed.push(entry); continue; }
      if (await processIdentity(ownerPid) === manifest.ownerIdentity) continue;
      await run("dropdb", ["--force", "--if-exists", "--maintenance-db", base, manifest.databaseName], process.env);
      await unlink(file);
    }
  } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  if (malformed.length) throw new Error(`Refusing malformed booking-load recovery manifests: ${malformed.join(", ")}`);
}
async function main() {
  const base = target();
  if (process.argv.includes("--recover-interrupted-databases")) return recover(base);
  await recover(base);
  const apiProcesses = parseInteger("LUMERA_BOOKING_LOAD_API_PROCESSES", 2, 1, 16);
  const expectedDeploymentProcesses = parseInteger("LUMERA_BOOKING_LOAD_EXPECTED_DEPLOYMENT_PROCESSES", apiProcesses, 1, 16);
  if (apiProcesses !== expectedDeploymentProcesses) {
    throw new Error(`Configured ${apiProcesses} load-test API processes do not match the documented deployment topology of ${expectedDeploymentProcesses}.`);
  }
  const poolMax = parseInteger("LUMERA_BOOKING_LOAD_POOL_MAX", 10, 4, 50);
  const harnessPoolMax = parseInteger("LUMERA_BOOKING_LOAD_HARNESS_POOL_MAX", 10, 4, 20);
  const connectionReserve = parseInteger("LUMERA_BOOKING_LOAD_CONNECTION_RESERVE", 5, 1, 100);
  const connectionBudget = parseInteger("LUMERA_BOOKING_LOAD_DB_CONNECTION_BUDGET", 35, 10, 1_000);
  const requiredConnections = apiProcesses * poolMax + harnessPoolMax + connectionReserve;
  if (requiredConnections > connectionBudget) {
    throw new Error(`Booking load requires ${requiredConnections} database connections (${apiProcesses}x${poolMax} API + ${harnessPoolMax} harness + ${connectionReserve} reserve), above the documented budget of ${connectionBudget}.`);
  }
  const databaseName = `${prefix}${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const ownerIdentity = await processIdentity(process.pid);
  if (!ownerIdentity) throw new Error("Could not identify booking-load harness process.");
  const manifest = path.join(state, `${databaseName}.json`); await mkdir(state, { recursive: true });
  await writeFile(`${manifest}.tmp`, JSON.stringify({ version: 1, databaseName, target: targetIdentity(base), ownerPid: process.pid, ownerIdentity }) + "\n", { flag: "wx" }); await rename(`${manifest}.tmp`, manifest);
  const databaseUrl = testUrl(base, databaseName);
  let apiChildren: ChildProcess[] = []; let suite: ChildProcess | undefined; let interrupted = false;
  const terminate = () => { interrupted = true; void Promise.all([stop(suite), ...apiChildren.map((child) => stop(child))]); };
  process.once("SIGINT", terminate); process.once("SIGTERM", terminate);
  try {
    await run("createdb", ["--maintenance-db", base, databaseName], process.env);
    const environment = isolatedEnvironment(databaseUrl);
    await run("pnpm", ["--filter", "@workspace/db", "run", "push-force"], environment);
    const ports = await Promise.all(Array.from({ length: apiProcesses }, () => port()));
    const start = (p: number, seed: boolean) => {
      const apiEnvironment: NodeJS.ProcessEnv = { ...environment, PORT: String(p), LOG_LEVEL: "error" };
      if (seed) apiEnvironment.LUMERA_TEST_SEED = "1";
      return spawn(path.join(root, "scripts/node_modules/.bin/tsx"), [path.join(root, "artifacts/api-server/src/test-server.ts")], { cwd: root, env: apiEnvironment, detached: process.platform !== "win32", stdio: "inherit" });
    };
    const ready = async (url: string) => { for (let i = 0; i < 120; i++) { try { if ((await fetch(`${url}/api/healthz`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error("Local test API did not become ready."); };
    // Seed once before the second process starts. ensureDemoData caches only
    // in-process, so first-request seeding in both APIs would race on unique
    // demo catalog rows and turn half the booking traffic into unrelated 500s.
    apiChildren.push(start(ports[0]!, true));
    await ready(`http://127.0.0.1:${ports[0]}`);
    for (const apiPort of ports.slice(1)) {
      const child = start(apiPort, false);
      apiChildren.push(child);
      await ready(`http://127.0.0.1:${apiPort}`);
    }
    if (interrupted) throw new Error("Booking load interrupted.");
    suite = spawn(path.join(root, "scripts/node_modules/.bin/tsx"), [path.join(root, "scripts/src/booking-load-suite.ts")], {
      cwd: root,
      env: {
        ...environment,
        DB_POOL_MAX: String(harnessPoolMax),
        LUMERA_BOOKING_LOAD_URLS: ports.map((apiPort) => `http://127.0.0.1:${apiPort}`).join(","),
        LUMERA_BOOKING_LOAD_API_PROCESSES: String(apiProcesses),
        LUMERA_BOOKING_LOAD_EXPECTED_DEPLOYMENT_PROCESSES: String(expectedDeploymentProcesses),
        LUMERA_BOOKING_LOAD_API_POOL_MAX: String(poolMax),
        LUMERA_BOOKING_LOAD_HARNESS_POOL_MAX: String(harnessPoolMax),
        LUMERA_BOOKING_LOAD_CONNECTION_RESERVE: String(connectionReserve),
        LUMERA_BOOKING_LOAD_DB_CONNECTION_BUDGET: String(connectionBudget),
      },
      detached: process.platform !== "win32",
      stdio: "inherit",
    });
    const suiteExitCode = await new Promise<number | null>((resolve) => suite!.once("exit", resolve));
    const expectFailure = process.env.LUMERA_BOOKING_LOAD_EXPECT_FAILURE === "1";
    if (expectFailure) {
      const reportName = process.env.LUMERA_BOOKING_LOAD_REPORT_NAME ?? "latest";
      if (!/^[a-z0-9-]+$/.test(reportName)) throw new Error("Invalid booking load report name.");
      const report = JSON.parse(await readFile(path.join(reportDirectory, `${reportName}.json`), "utf8")) as {
        marker?: string;
        failure?: string;
        configuration?: { dbConnectionTimeoutMs?: number };
        scenarios?: Array<{ name?: string; unexpectedErrors?: number }>;
      };
      const distinctFailure = report.scenarios?.find((item) => item.name === "1000-distinct")?.unexpectedErrors ?? 0;
      if (
        suiteExitCode === 0
        || report.marker !== `booking-load-${suite.pid}`
        || report.configuration?.dbConnectionTimeoutMs !== Number(environment.DB_CONN_TIMEOUT_MS)
        || !report.failure
        || distinctFailure < 1
      ) {
        throw new Error("Expected the short-timeout baseline to demonstrate a 1000-distinct failure.");
      }
    } else if (suiteExitCode !== 0) {
      throw new Error("Booking load suite failed");
    }
  } finally {
    await Promise.all([stop(suite), ...apiChildren.map((child) => stop(child))]);
    await run("dropdb", ["--force", "--if-exists", "--maintenance-db", base, databaseName], process.env);
    await unlink(manifest).catch(() => undefined);
    process.removeListener("SIGINT", terminate); process.removeListener("SIGTERM", terminate);
  }
}
void main();