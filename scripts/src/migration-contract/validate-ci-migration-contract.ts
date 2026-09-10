import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const DATABASE_ENV_PATTERN = /(?:^|_)DATABASE_URL$/;
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

export interface CiMigrationContractOptions {
  repoRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface CiMigrationContractResult {
  eventName: "local" | "pull_request" | "push" | "workflow_dispatch";
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

async function command(
  executable: string,
  argumentsToPass: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  acceptedCodes = [0],
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsToPass, {
      cwd,
      env: environment,
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
          `${executable} ${argumentsToPass[0] ?? ""} failed (${result.code}): `
          + result.stderr.toString("utf8").trim(),
        ));
        return;
      }
      resolve(result);
    });
  });
}

function safeTreePath(rawPath: Buffer): string {
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
  await command("git", ["cat-file", "-e", `${commit}:${MIGRATION_PATH}`], repoRoot, environment);
  const listing = await command(
    "git",
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
    const contents = await command("git", ["cat-file", "blob", match[2]!], repoRoot, environment);
    const outputPath = path.join(destination, ...relativePath.split("/"));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, contents.stdout);
  }
}

async function validatePullRequestReference(
  repoRoot: string,
  baseSha: string | undefined,
  environment: NodeJS.ProcessEnv,
): Promise<MigrationRecord[]> {
  if (!baseSha || !COMMIT_SHA_PATTERN.test(baseSha)) {
    throw new Error("Pull-request migration validation requires the exact base commit SHA");
  }
  const resolved = await command(
    "git",
    ["rev-parse", "--verify", `${baseSha}^{commit}`],
    repoRoot,
    environment,
  ).catch(() => {
    throw new Error(`Trusted pull-request base commit is unavailable: ${baseSha}`);
  });
  if (resolved.stdout.toString("ascii").trim().toLowerCase() !== baseSha.toLowerCase()) {
    throw new Error(`Trusted pull-request base did not resolve exactly: ${baseSha}`);
  }
  const ancestry = await command(
    "git",
    ["merge-base", "--is-ancestor", baseSha, "HEAD"],
    repoRoot,
    environment,
    [0, 1],
  );
  if (ancestry.code !== 0) {
    throw new Error(`Trusted pull-request base is not an ancestor of HEAD: ${baseSha}`);
  }

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumera-migration-reference-"));
  try {
    const referenceRoot = path.join(temporaryRoot, "migrations");
    await materializeReference(repoRoot, baseSha, environment, referenceRoot);
    return await readMigrationSet(referenceRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function runCiMigrationContract(
  options: CiMigrationContractOptions = {},
): Promise<CiMigrationContractResult> {
  const repoRoot = path.resolve(options.repoRoot ?? WORKSPACE_ROOT);
  const environment = options.environment ?? process.env;
  const gitEnvironment = databaseFreeEnvironment(environment);
  const configuredEventName = environment.LUMERA_CI_EVENT_NAME;
  const inGitHubActions = environment.GITHUB_ACTIONS === "true";
  let eventName: string;
  if (inGitHubActions) {
    const nativeEventName = environment.GITHUB_EVENT_NAME;
    if (!nativeEventName) {
      throw new Error("GITHUB_EVENT_NAME is required in GitHub Actions");
    }
    if (configuredEventName && configuredEventName !== nativeEventName) {
      throw new Error(
        `Migration-contract event mismatch: LUMERA_CI_EVENT_NAME=${configuredEventName}, `
        + `GITHUB_EVENT_NAME=${nativeEventName}`,
      );
    }
    eventName = nativeEventName;
  } else {
    eventName = configuredEventName || "local";
  }
  if (!["local", "pull_request", "push", "workflow_dispatch"].includes(eventName)) {
    throw new Error(`Unsupported migration-contract event: ${eventName}`);
  }
  if (inGitHubActions && eventName === "local") {
    throw new Error("Local migration-contract mode is forbidden in GitHub Actions");
  }

  const current = await readMigrationSet(path.join(repoRoot, MIGRATION_PATH));
  let reference: MigrationRecord[] = [];
  if (eventName === "pull_request") {
    reference = await validatePullRequestReference(
      repoRoot,
      environment.LUMERA_CI_PR_BASE_SHA,
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