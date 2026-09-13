import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  compareWithReference,
  readMigrationSet,
  type MigrationRecord,
} from "./contract";

const MIGRATION_PATH = "lib/db/migrations";
const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const DATABASE_ENV_PATTERN = /^(?:DATABASE_URL(?:_UNPOOLED)?|POSTGRES_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|.+_DATABASE_URL)$/;
const GITHUB_CONTEXT_KEYS = [
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH",
  "GITHUB_SHA",
  "GITHUB_REF",
] as const;
const HISTORY_DEPTH_STEPS = [32, 128, 512] as const;
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export interface CiMigrationContractOptions {
  repoRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface CiMigrationContractResult {
  eventName: "local" | "pull_request" | "merge_group" | "push" | "workflow_dispatch";
  current: MigrationRecord[];
  protectedMigrations: number;
}

interface CommandResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

function databaseFreeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const blocked = Object.entries(environment)
    .filter(([key, value]) => DATABASE_ENV_PATTERN.test(key) && value !== undefined && value !== "")
    .map(([key]) => key)
    .sort();
  if (blocked.length > 0) {
    throw new Error(
      `Migration-contract validation refuses nonempty database environment variables: ${blocked.join(", ")}`,
    );
  }
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !DATABASE_ENV_PATTERN.test(key)),
  );
}

async function gitCommand(
  argumentsToPass: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  acceptedCodes = [0],
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", argumentsToPass, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      const result = {
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (!acceptedCodes.includes(result.code)) {
        reject(new Error(
          `git ${argumentsToPass[0] ?? ""} failed (${result.code}): `
          + result.stderr.toString("utf8").trim(),
        ));
        return;
      }
      resolve(result);
    });
  });
}

export function safeTreePath(rawPath: Buffer): string {
  const treePath = rawPath.toString("utf8");
  if (!rawPath.equals(Buffer.from(treePath, "utf8"))) {
    throw new Error("Protected migration tree contains a non-UTF-8 path");
  }
  const segments = treePath.split("/");
  if (
    path.posix.isAbsolute(treePath)
    || treePath.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
    || !treePath.startsWith(`${MIGRATION_PATH}/`)
  ) {
    throw new Error(`Unsafe protected migration tree path: ${JSON.stringify(treePath)}`);
  }
  return treePath;
}

async function materializeReference(
  repoRoot: string,
  commit: string,
  environment: NodeJS.ProcessEnv,
  destination: string,
): Promise<void> {
  await gitCommand(["cat-file", "-e", `${commit}:${MIGRATION_PATH}`], repoRoot, environment);
  const listing = await gitCommand(
    ["ls-tree", "-rz", "--full-tree", commit, "--", MIGRATION_PATH],
    repoRoot,
    environment,
  );
  await mkdir(destination, { recursive: true });
  const entries = listing.stdout.subarray(0, listing.stdout.length - (
    listing.stdout.at(-1) === 0 ? 1 : 0
  )).toString("binary").split("\0");
  const seen = new Set<string>();
  for (const binaryEntry of entries) {
    if (binaryEntry === "") continue;
    const entry = Buffer.from(binaryEntry, "binary");
    const tab = entry.indexOf(0x09);
    if (tab < 0) throw new Error("Malformed protected migration tree entry");
    const header = entry.subarray(0, tab).toString("ascii");
    const match = /^(100644|100755) blob ([0-9a-f]+)$/.exec(header);
    const treePath = safeTreePath(entry.subarray(tab + 1));
    if (!match) {
      throw new Error(`Protected migration path is not a regular file: ${treePath}`);
    }
    const relativePath = treePath.slice(MIGRATION_PATH.length + 1);
    if (seen.has(relativePath)) {
      throw new Error(`Duplicate protected migration tree path: ${treePath}`);
    }
    seen.add(relativePath);
    const contents = await gitCommand(["cat-file", "blob", match[2]!], repoRoot, environment);
    const outputPath = path.join(destination, ...relativePath.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, contents.stdout);
  }
}

async function fetchExactReference(
  repoRoot: string,
  baseSha: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await gitCommand(
    ["fetch", "--no-tags", "--depth=1", "origin", baseSha],
    repoRoot,
    environment,
  ).catch(() => {
    throw new Error(`Trusted base commit is unavailable from origin: ${baseSha}`);
  });
}

async function checkoutHeadSha(
  repoRoot: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const resolved = await gitCommand(
    ["rev-parse", "--verify", "HEAD^{commit}"],
    repoRoot,
    environment,
  ).catch(() => {
    throw new Error("The checkout HEAD commit is unavailable");
  });
  const headSha = resolved.stdout.toString("ascii").trim();
  if (!COMMIT_SHA_PATTERN.test(headSha)) {
    throw new Error(`The checkout HEAD did not resolve to an exact commit SHA: ${headSha}`);
  }
  return headSha;
}

async function proveAncestryWithBoundedDeepening(
  repoRoot: string,
  baseSha: string,
  headSha: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  for (const deepenBy of [0, ...HISTORY_DEPTH_STEPS]) {
    if (deepenBy !== 0) {
      await gitCommand(
        ["fetch", "--no-tags", `--deepen=${deepenBy}`, "origin", headSha],
        repoRoot,
        environment,
      ).catch(() => {
        throw new Error(`Unable to deepen history for checkout HEAD commit: ${headSha}`);
      });
    }
    const ancestry = await gitCommand(
      ["merge-base", "--is-ancestor", baseSha, headSha],
      repoRoot,
      environment,
      [0, 1],
    );
    if (ancestry.code === 0) return;
  }
  throw new Error(`Trusted base commit is not an ancestor of HEAD after bounded deepening: ${baseSha}`);
}

async function validateHistoricalReference(
  repoRoot: string,
  baseSha: string | undefined,
  environment: NodeJS.ProcessEnv,
): Promise<MigrationRecord[]> {
  if (!baseSha || !COMMIT_SHA_PATTERN.test(baseSha)) {
    throw new Error("Historical migration validation requires the exact base commit SHA");
  }
  const headSha = await checkoutHeadSha(repoRoot, environment);
  await fetchExactReference(repoRoot, baseSha, environment);
  const resolved = await gitCommand(
    ["rev-parse", "--verify", `${baseSha}^{commit}`],
    repoRoot,
    environment,
  ).catch(() => {
    throw new Error(`Trusted base commit is unavailable: ${baseSha}`);
  });
  if (resolved.stdout.toString("ascii").trim().toLowerCase() !== baseSha.toLowerCase()) {
    throw new Error(`Trusted base did not resolve exactly: ${baseSha}`);
  }
  await proveAncestryWithBoundedDeepening(repoRoot, baseSha, headSha, environment);

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-migration-reference-"));
  try {
    const referenceRoot = path.join(temporaryRoot, "migrations");
    await materializeReference(repoRoot, baseSha, environment, referenceRoot);
    return await readMigrationSet(referenceRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

interface GitHubEventPayload {
  pull_request?: { base?: { sha?: unknown } };
  merge_group?: { base_sha?: unknown };
}

async function readGitHubPayload(eventPath: string): Promise<GitHubEventPayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(eventPath, "utf8"));
  } catch (error) {
    throw new Error(
      `GitHub event payload is missing or malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("GitHub event payload must be a JSON object");
  }
  return parsed as GitHubEventPayload;
}

function payloadBaseSha(
  eventName: string,
  payload: GitHubEventPayload,
): string | undefined {
  const value = eventName === "pull_request"
    ? payload.pull_request?.base?.sha
    : eventName === "merge_group"
      ? payload.merge_group?.base_sha
      : undefined;
  if ((eventName === "pull_request" || eventName === "merge_group")
    && (typeof value !== "string" || !COMMIT_SHA_PATTERN.test(value))) {
    throw new Error(`GitHub ${eventName} payload requires an exact base SHA`);
  }
  return typeof value === "string" ? value : undefined;
}

export async function runCiMigrationContract(
  options: CiMigrationContractOptions = {},
): Promise<CiMigrationContractResult> {
  const repoRoot = path.resolve(options.repoRoot ?? WORKSPACE_ROOT);
  const environment = options.environment ?? process.env;
  const gitEnvironment = databaseFreeEnvironment(environment);
  const configuredEventName = environment.LUMERA_CI_EVENT_NAME;
  const hasNativeContext = GITHUB_CONTEXT_KEYS.some((key) => Boolean(environment[key]));
  let eventName: string;
  let baseSha: string | undefined;
  if (hasNativeContext) {
    const missing = GITHUB_CONTEXT_KEYS.filter((key) => !environment[key]);
    if (environment.GITHUB_ACTIONS !== "true" || missing.length > 0) {
      throw new Error(
        `Incomplete GitHub event context: ${missing.length > 0 ? `missing ${missing.join(", ")}` : "GITHUB_ACTIONS must equal true"}`,
      );
    }
    const nativeEventName = environment.GITHUB_EVENT_NAME;
    if (configuredEventName && configuredEventName !== nativeEventName) {
      throw new Error(
        `Migration-contract event mismatch: LUMERA_CI_EVENT_NAME=${configuredEventName}, `
        + `GITHUB_EVENT_NAME=${nativeEventName}`,
      );
    }
    eventName = nativeEventName!;
    const payload = await readGitHubPayload(environment.GITHUB_EVENT_PATH!);
    baseSha = payloadBaseSha(eventName, payload);
    if (eventName === "pull_request" && environment.LUMERA_CI_PR_BASE_SHA !== baseSha) {
      throw new Error(
        "LUMERA_CI_PR_BASE_SHA must be present and equal pull_request.base.sha from the native payload",
      );
    }
    if (eventName === "merge_group"
      && environment.LUMERA_CI_MERGE_GROUP_BASE_SHA !== baseSha) {
      throw new Error(
        "LUMERA_CI_MERGE_GROUP_BASE_SHA must be present and equal merge_group.base_sha from the native payload",
      );
    }
    if (eventName !== "pull_request" && environment.LUMERA_CI_PR_BASE_SHA) {
      throw new Error("LUMERA_CI_PR_BASE_SHA is permitted only for pull_request events");
    }
    if (eventName !== "merge_group" && environment.LUMERA_CI_MERGE_GROUP_BASE_SHA) {
      throw new Error("LUMERA_CI_MERGE_GROUP_BASE_SHA is permitted only for merge_group events");
    }
  } else {
    eventName = configuredEventName || "local";
    if (eventName !== "local") {
      throw new Error("Compatibility CI event context without complete native GitHub context is forbidden");
    }
    if (environment.LUMERA_CI_PR_BASE_SHA) {
      throw new Error("LUMERA_CI_PR_BASE_SHA is forbidden in local mode");
    }
    if (environment.LUMERA_CI_MERGE_GROUP_BASE_SHA) {
      throw new Error("LUMERA_CI_MERGE_GROUP_BASE_SHA is forbidden in local mode");
    }
  }
  if (!["local", "pull_request", "merge_group", "push", "workflow_dispatch"].includes(eventName)) {
    throw new Error(`Unsupported migration-contract event: ${eventName}`);
  }
  if (hasNativeContext && eventName === "local") {
    throw new Error("Local migration-contract mode is forbidden in GitHub Actions");
  }

  const current = await readMigrationSet(path.join(repoRoot, MIGRATION_PATH));
  let reference: MigrationRecord[] = [];
  if (eventName === "pull_request" || eventName === "merge_group") {
    reference = await validateHistoricalReference(
      repoRoot,
      baseSha,
      gitEnvironment,
    );
    compareWithReference(current, reference);
  }
  return {
    eventName: eventName as CiMigrationContractResult["eventName"],
    current,
    protectedMigrations: reference.length,
  };
}

export async function main(argumentsToParse = process.argv.slice(2)): Promise<number> {
  try {
    if (argumentsToParse.length > 0) {
      throw new Error(
        "This command accepts no path or reference arguments. Locally it validates the working migration set; CI supplies the trusted event context.",
      );
    }
    const result = await runCiMigrationContract();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      event: result.eventName,
      migrations: result.current.map(({ directory, sequence, sha256 }) => ({
        directory,
        sequence,
        sha256,
      })),
      protectedMigrations: result.protectedMigrations,
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CI migration contract validation failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}