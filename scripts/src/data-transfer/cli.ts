import pg from "pg";
import { readFile } from "node:fs/promises";
import { parseExpectedTargetIdentity } from "../migrations/cli";
import { transferData, TransferError } from "./engine";
import type { TransferPolicy } from "./mapping";

export function parseTransferArguments(argv: string[]) {
  const recognized = new Set(["source-url", "target-url", "policy-file", "expected-database", "expected-system-identifier",
    "expected-transport", "expected-neon-project-id", "expected-neon-branch-id", "expected-neon-timeline-id"]);
  const values = new Map<string, string>();
  const rehearsal = argv.includes("--rehearsal");
  for (const arg of argv) {
    if (arg === "--rehearsal") continue;
    const match = /^--([^=]+)=(.+)$/u.exec(arg);
    if (!match || !recognized.has(match[1]!) || values.has(match[1]!)) throw new TransferError("INVALID_ARGUMENTS");
    values.set(match[1]!, match[2]!);
  }
  for (const key of ["source-url", "target-url"]) {
    const value = values.get(key);
    if (!value) throw new TransferError("EXPLICIT_CONNECTIONS_REQUIRED");
    let url: URL;
    try { url = new URL(value); } catch { throw new TransferError("INVALID_CONNECTION"); }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new TransferError("INVALID_CONNECTION");
    if ([...url.searchParams.keys()].some(key => /options|service|passfile/iu.test(key))) throw new TransferError("INVALID_CONNECTION");
  }
  return { sourceUrl: values.get("source-url")!, targetUrl: values.get("target-url")!,
    rehearsal, policyFile: values.get("policy-file"), expectedTargetIdentity: parseExpectedTargetIdentity(argv.filter(a => a !== "--rehearsal")) };
}
function validatePolicy(value: unknown): TransferPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TransferError("INVALID_POLICY");
  const policy = value as Record<string, unknown>;
  if (Object.keys(policy).some(k => !["dropColumns", "excludeTables", "casts"].includes(k))) throw new TransferError("INVALID_POLICY");
  for (const key of ["dropColumns", "excludeTables"]) {
    const items = policy[key];
    if (items !== undefined && (!Array.isArray(items) || items.some(i => typeof i !== "string" || !/^public\.[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/u.test(i))
      || new Set(items).size !== items.length)) throw new TransferError("INVALID_POLICY");
  }
  if (policy.casts !== undefined && (!policy.casts || typeof policy.casts !== "object" || Array.isArray(policy.casts)
    || Object.entries(policy.casts).some(([k,v]) => !/^public\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/u.test(k) || typeof v !== "string"))) {
    throw new TransferError("INVALID_POLICY");
  }
  return policy as TransferPolicy;
}
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseTransferArguments(argv);
  const policy = options.policyFile ? validatePolicy(JSON.parse(await readFile(options.policyFile, "utf8"))) : {};
  // Dedicated clients: the source snapshot and target transaction never move between connections.
  const source = new pg.Client({ connectionString: options.sourceUrl, options: "-c default_transaction_read_only=on", application_name: "lumera_data_transfer_source" });
  const target = new pg.Client({ connectionString: options.targetUrl, application_name: "lumera_data_transfer_target" });
  try {
    await source.connect(); await target.connect();
    const result = await transferData(source, target, { expectedTargetIdentity: options.expectedTargetIdentity, policy, rehearsal: options.rehearsal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "blocked") process.exitCode = 2;
  } finally { await Promise.allSettled([source.end(), target.end()]); }
}
if (process.argv[1]?.endsWith("/data-transfer/cli.ts")) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({ code: error instanceof TransferError ? error.code : "TRANSFER_FAILED",
      sqlstate: error instanceof TransferError ? error.sqlstate
        : typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null,
      step: error instanceof TransferError ? error.step : "connection-or-arguments", vacuumRecommended: true })}\n`);
    process.exitCode = 2;
  });
}