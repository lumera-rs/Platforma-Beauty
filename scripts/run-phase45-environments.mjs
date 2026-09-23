#!/usr/bin/env node
// No application imports: guard the ambient runtime BEFORE constructing child env.
// Usage: node scripts/run-phase45-environments.mjs --mode=ci [--phase=4|5] [--chromium=/absolute/path]
// Each real phase chain runs once. On failure only its unstarted suites run next.
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, realpathSync, readdirSync,
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ambient = process.env;
if (ambient.NODE_ENV === "production"
    || /^(1|true)$/i.test(ambient.REPLIT_DEPLOYMENT ?? "")
    || /^(1|true)$/i.test(ambient.REPL_DEPLOYMENT ?? "")
    || ambient.REPLIT_DEPLOYMENT_ID !== undefined
    || ambient.REPL_DEPLOYMENT_ID !== undefined) {
  throw new Error("Refusing production/deployment runtime before environment stripping.");
}
const options = new Map(process.argv.slice(2).map(arg => {
  const match = /^--(mode|phase|chromium|browser-cache)=(.+)$/.exec(arg);
  if (!match && arg !== "--full-chain" && arg !== "--check") {
    throw new Error("Expected --mode=ci, --phase=4|5, --chromium=PATH, --browser-cache=PATH, --check.");
  }
  return match ? [match[1], match[2]] : [arg.slice(2), true];
}));
const mode = options.get("mode") ?? "ci";
if (mode !== "ci") throw new Error("Only stripped CI mode is supported; run normal workspace validation separately.");
const selectedPhase = options.get("phase");
if (selectedPhase !== undefined && !["4", "5"].includes(selectedPhase)) {
  throw new Error("Expected --phase=4 or --phase=5; omit to run both.");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const phases = ["4-isolated", "5-final"]
  .filter(phase => selectedPhase === undefined || phase.startsWith(`${selectedPhase}-`))
  .map(phase => {
  const command = `validate:release:${phase}`;
  const text = pkg.scripts[command];
  const suites = [...text.matchAll(/pnpm run (test:[\w:-]+)/g)].map(m => m[1]);
  if (!suites.length || new Set(suites).size !== suites.length) throw new Error("Invalid phase inventory.");
  // Fail closed if the chain adds any unrecognized shell operation.
  const pieces = text.split(" && ");
  if (pieces.some(p => p !== "export CI=true" && !/^echo '[^']*'$/.test(p)
      && !/^pnpm run test:[\w:-]+$/.test(p))) throw new Error("Phase grammar changed; re-audit runner.");
  return { command, suites };
});
// Vite auto-loads .env files, independently of DOTENV_CONFIG_PATH. Refuse them
// throughout first-party directories, rather than hide/modify workspace files.
function rejectEnvFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", ".cache", ".local", ".config", ".upm", ".replit", "dist"].includes(entry.name)) continue;
    if (/^\.env(?:$|\.)/.test(entry.name)) throw new Error("Workspace .env file found; cannot promise secret-free execution.");
    if (entry.isDirectory()) rejectEnvFiles(path.join(directory, entry.name));
  }
}
rejectEnvFiles(root);
const evidence = mkdtempSync("/tmp/lumera-phase45-");
chmodSync(evidence, 0o700);
const bin = path.join(evidence, "bin");
mkdirSync(bin);
const resolveTool = name => {
  for (const directory of (ambient.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    // Preserve invocation basename: Nix coreutils applet symlinks resolve to a
    // shared coreutils binary, which needs dirname/readlink/etc as argv[0].
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  throw new Error(`Missing required tool: ${name}`);
};
// Expose only named tools, not the ambient PATH or platform Node wrapper.
const tools = {};
for (const name of ["bash", "sh", "env", "initdb", "pg_ctl", "postgres", "createdb",
  "dropdb", "psql", "git", "curl", "grep", "sed", "awk", "cat", "mkdir", "rm",
  "dirname", "readlink", "uname", "head", "tail", "sort", "find", "sleep", "date",
  "tr", "cut", "wc", "xargs", "which", "chmod", "cp", "mv", "touch", "kill",
  "jq", "mktemp", "timeout", "printf", "tee", "base64", "openssl"]) {
  tools[name] = resolveTool(name);
  // PostgreSQL locates share/postgresql relative to argv[0]; a symlink farm
  // changes that prefix. Exec the absolute tool path to preserve its installation.
  writeFileSync(path.join(bin, name),
    `#!${resolveTool("sh")}\nexec '${tools[name]}' "$@"\n`, { mode: 0o700 });
}
tools.node = process.execPath;
tools.pnpm = realpathSync(resolveTool("pnpm"));
symlinkSync(tools.node, path.join(bin, "node"));
// pnpm's JS entry point is run with the unwrapped current Node executable.
writeFileSync(path.join(bin, "pnpm"), `#!${tools.sh}\nexec '${tools.node}' '${tools.pnpm}' "$@"\n`, { mode: 0o700 });
const tsx = realpathSync(path.join(root, "scripts/node_modules/tsx/dist/cli.mjs"));
for (const option of ["chromium", "browser-cache"]) {
  const value = options.get(option);
  if (value && (!path.isAbsolute(value) || !existsSync(value))) throw new Error(`Invalid --${option} path.`);
}
const base = {
  PATH: bin, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
  NODE_ENV: "test",
  SESSION_SECRET: "lumera-ci-browser-only-session-secret",
  DOTENV_CONFIG_PATH: "/dev/null",
  NPM_CONFIG_USERCONFIG: "/dev/null", NPM_CONFIG_GLOBALCONFIG: "/dev/null",
  npm_config_update_notifier: "false", NO_COLOR: "1",
};
if (options.has("chromium")) base.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE = options.get("chromium");
if (options.has("browser-cache")) base.PLAYWRIGHT_BROWSERS_PATH = options.get("browser-cache");
// Smoke-check the explicitly selected browser under the SAME stripped tool env.
// This catches wrappers that depend on ambient LD_LIBRARY_PATH before any DB.
let chromiumVersion;
if (options.has("chromium")) {
  const browserHome = path.join(evidence, "browser-preflight-home");
  mkdirSync(browserHome);
  chromiumVersion = execFileSync(options.get("chromium"), ["--version"], {
    env: { ...base, HOME: browserHome }, encoding: "utf8", timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
const report = {
  version: 1, startedAt: new Date().toISOString(),
  modes: ["ci"],
  selectedPhase: selectedPhase ?? "both",
  phaseCommands: phases.map(phase => phase.command),
  chromiumVersion,
  environmentKeys: Object.keys(base).sort(), tools,
  nodeVersion: process.version,
  postgresVersion: execFileSync(tools.initdb, ["--version"], { env: base, encoding: "utf8" }).trim(),
  suites: [], chains: [],
  inventory: phases.map(phase => ({
    ...phase, shell: pkg.scripts[phase.command],
    rootCommands: Object.fromEntries(phase.suites.map(suite => [suite, pkg.scripts[suite]])),
  })),
  sourceFingerprints: Object.fromEntries([
    "package.json", "scripts/package.json", "artifacts/api-server/package.json",
    "scripts/run-phase45-environments.mjs",
    "artifacts/beauty-marketplace/package.json", "pnpm-lock.yaml",
    ".github/workflows/ci.yml", "scripts/src/run-destructive-test.ts",
    "scripts/src/run-isolated-browser-suite.ts", "scripts/playwright.config.ts",
    "scripts/playwright.seo.config.ts", "lib/db/drizzle.config.ts",
    "artifacts/beauty-marketplace/vite.config.ts",
  ].map(file => [file, createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex")])),
  notes: [
    "CI mode excludes all inherited application/platform secrets, PG*, NODE_OPTIONS, preload, proxy and npm configuration.",
    "CI mode sets CI=true before the owned wrapper. Normal workspace validation is deliberately outside this runner.",
    "Browser CI NODE_ENV and SESSION_SECRET match ci.yml exactly; DATABASE_URL intentionally replaced by owned socket identity.",
    "Optional explicit Chromium/cache paths are local tool accommodations, not GitHub CI parity.",
    "Private raw logs stay in this mode-0700 temporary directory; public summary contains no child output.",
    "Missing SESSION_SECRET would break integration encryption. PUBLIC_SITE_URL must be generated by the isolated harness, not inherited.",
    "Owned wrapper forwards its environment; therefore stripping must happen before it starts.",
    "Node/pnpm bypass platform wrapper; no REPL_ID, Replit library injection or dotenv preloads are inherited.",
    "Deployment guard matches migrations/development-runtime.ts, including present-but-empty deployment IDs. REPLIT_ENVIRONMENT alone is not a canonical deployment indicator.",
    "Direct API tests inherit only the owned database. Nested API/browser harnesses create databases on that owned socket, run drizzle push-force, and start test-server/Vite/Playwright.",
    "Drizzle-kit and Vite can load dotenv; first-party .env files are refused before execution. HOME and npm user/global configuration are isolated.",
    "Vite runtime-error plugin remains installed; cartographer/dev-banner require REPL_ID, which is excluded. Replit platform plugins receive no inherited credentials.",
    "client-seo uses its dedicated Vite server and public API fixtures. No existing development web/API URL or browser storage is inherited.",
    "PostgreSQL16 initdb/pg_ctl/postgres/createdb/dropdb/psql and installed workspace pnpm dependencies are required; Chromium must be explicitly supplied or installed in the explicit browser cache.",
  ],
};
function save() {
  writeFileSync(path.join(evidence, "summary.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}
save();
console.log(`Private evidence: ${evidence}`);
if (options.has("check")) {
  console.log(`Preflight only: ${phases.reduce((sum, p) => sum + p.suites.length, 0)} suites per mode. No DB or suite started.`);
  process.exit(0);
}
let active;
let interrupted;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { interrupted = signal; active?.kill(signal); });
}
async function run(command, currentMode, label, observeHeading) {
  const home = path.join(evidence, `${currentMode}-home`);
  mkdirSync(home, { recursive: true });
  const environment = { ...base, HOME: home, TMPDIR: "/tmp", XDG_CONFIG_HOME: home };
  if (currentMode === "ci") environment.CI = "true";
  const log = createWriteStream(path.join(evidence, `${currentMode}-${label}.log`), { mode: 0o600 });
  let pending = "";
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const result = await new Promise(resolve => {
    active = spawn(tools.node, [tsx, "scripts/src/run-destructive-test.ts", "--",
      "pnpm", "run", command], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    active.stdout.on("data", chunk => {
      log.write(chunk);
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^> workspace@[^ ]+ (test:[\w:-]+)(?:\s|$)/.exec(line);
        if (match) observeHeading?.(match[1]);
      }
    });
    active.stderr.on("data", chunk => log.write(chunk));
    active.once("error", () => resolve({ code: null, signal: null, spawnError: true }));
    active.once("close", (code, signal) => resolve({ code, signal }));
  });
  active = undefined;
  await new Promise(resolve => log.end(resolve));
  return { ...result, startedAt, durationSeconds: (Date.now() - start) / 1000 };
}
for (const currentMode of report.modes) {
  for (const phase of phases) {
    if (interrupted) break;
    const started = [];
    const chain = await run(phase.command, currentMode, phase.command.replaceAll(":", "-"), name => {
      if (phase.suites[started.length] !== name) return;
      started.push(name);
      console.log(`${currentMode}: started ${name}`);
    });
    report.chains.push({ mode: currentMode, command: phase.command, ...chain });
    for (let index = 0; index < started.length; index++) {
      const status = index < started.length - 1 || chain.code === 0 ? "passed"
        : interrupted ? "interrupted" : "failed";
      report.suites.push({ mode: currentMode, suite: started[index], status,
        evidence: "standard && chain progression and exit status" });
    }
    // If headings disappear, do not double-execute an unknown set of suites.
    if (started.length === 0 || (chain.code === 0 && started.length !== phase.suites.length)) {
      for (const suite of phase.suites.slice(started.length)) {
        report.suites.push({ mode: currentMode, suite, status: "not-observed",
          evidence: "chain setup failed or pnpm heading format changed; no unsafe replay" });
      }
    } else {
      for (const suite of phase.suites.slice(started.length)) {
        if (interrupted) {
          report.suites.push({ mode: currentMode, suite, status: "not-run", evidence: "interrupted" });
          continue;
        }
        const result = await run(suite, currentMode, suite.replaceAll(":", "-"));
        report.suites.push({ mode: currentMode, suite,
          status: result.code === 0 ? "passed" : "failed", ...result,
          evidence: "remaining suite invoked once in a fresh owned cluster" });
        save();
        console.log(`${currentMode}: ${suite}: ${result.code === 0 ? "passed" : "failed"}`);
      }
    }
    save();
  }
}
report.finishedAt = new Date().toISOString();
report.interrupted = interrupted ?? null;
save();
console.log(`Summary: ${path.join(evidence, "summary.json")}`);
process.exitCode = interrupted ? 130
  : report.suites.some(s => s.status !== "passed") || report.chains.some(c => c.code !== 0) ? 1 : 0;