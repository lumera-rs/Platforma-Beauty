import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const PINNED_REVIEWED_EVIDENCE_COMMIT = "91b6b162b6b491a5dc76f90cb55de9894c199de6";
export const PINNED_REVIEWED_EVIDENCE_PATH = "docs/additional-operations-evidence/complete-evidence.json";
export const PINNED_REVIEWED_EVIDENCE_SHA256 = "866fb8e2516bbbd5696264d1e43a0ca10be2e80255df5366f9b8354553e606da";
const authenticatedSources = new Map<string, ReadonlyMap<string, string>>();

/**
 * Read only immutable Git objects, never a working-tree overlay. Verify each
 * blob against its Git object ID and the reviewed evidence against its existing
 * SHA-256 pin. Return a fresh map so callers cannot poison later validations.
 */
export function loadReviewedHistoricalSources(root: string): Map<string, string> {
  const cached = authenticatedSources.get(root);
  if (cached) return new Map(cached);
  const git = (...args: string[]): Buffer => execFileSync("git", ["-C", root, ...args], {
    maxBuffer: 128 * 1024 * 1024,
  });
  const revision = git("rev-parse", "--verify", `${PINNED_REVIEWED_EVIDENCE_COMMIT}^{commit}`).toString().trim();
  if (revision !== PINNED_REVIEWED_EVIDENCE_COMMIT) throw new Error("Reviewed historical commit authentication failed");
  const entries = git("ls-tree", "-rz", "--full-tree", revision).toString().split("\0")
    .filter(Boolean).map((line) => {
      const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/u.exec(line);
      return match ? { mode: match[1]!, oid: match[2]!, file: match[3]! } : undefined;
    }).filter((entry) => entry !== undefined && (
      /\.tsx?$/u.test(entry.file) || entry.file.endsWith("package.json")
      || entry.file === PINNED_REVIEWED_EVIDENCE_PATH
    ));
  const bytes = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
    input: entries.map((entry) => entry!.oid).join("\n") + "\n",
    maxBuffer: 128 * 1024 * 1024,
  });
  const sources = new Map<string, string>();
  let offset = 0;
  for (const entry of entries) {
    if (!entry || !["100644", "100755"].includes(entry.mode)) throw new Error("Historical source is not a regular file");
    const end = bytes.indexOf(10, offset);
    const header = bytes.subarray(offset, end).toString();
    const match = /^([0-9a-f]{40}) blob (\d+)$/u.exec(header);
    if (!match || match[1] !== entry.oid) throw new Error(`Historical blob missing: ${entry.file}`);
    const size = Number(match[2]);
    const content = bytes.subarray(end + 1, end + 1 + size);
    const oid = createHash("sha1").update(`blob ${size}\0`).update(content).digest("hex");
    if (oid !== entry.oid || bytes[end + 1 + size] !== 10) throw new Error(`Historical blob authentication failed: ${entry.file}`);
    sources.set(entry.file, content.toString("utf8"));
    offset = end + size + 2;
  }
  if (offset !== bytes.length) throw new Error("Unexpected historical Git batch content");
  const evidence = sources.get(PINNED_REVIEWED_EVIDENCE_PATH);
  if (!evidence || createHash("sha256").update(evidence).digest("hex") !== PINNED_REVIEWED_EVIDENCE_SHA256) {
    throw new Error("Reviewed historical evidence authentication failed");
  }
  authenticatedSources.set(root, sources);
  return new Map(sources);
}

export function reviewedHistoricalSource(root: string, file: string): string {
  const source = loadReviewedHistoricalSources(root).get(file);
  if (source === undefined) throw new Error(`Missing authenticated historical source: ${file}`);
  return source;
}