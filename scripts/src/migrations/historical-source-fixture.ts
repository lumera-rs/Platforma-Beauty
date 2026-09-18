import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const EXPECTED_HISTORICAL_SOURCE_FIXTURE_MANIFEST_SHA256 =
  "283bfebe57385587ada9d9db60de82279fc25001ed5ed4362bce64473e9ff8ef";

const FIXTURE_SOURCE_COMMIT = "815465404f7ed530cdb79446bfcba68e5dc1821b";
const EXPECTED_CROSSWALK_SHA256 = "174ebf6e31fd8f7c53ea5e1112518a2afd2d56e72c3762e796e139a8a43b90a3";
const EXPECTED_GENERATOR = "scripts/src/startup-equivalence/crosswalk.ts";
const DEFAULT_FIXTURE_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/historical-operation-matrix",
);
const MAX_COMPRESSED_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_PAYLOAD_BYTES = 128 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FORBIDDEN_PATH_SEGMENTS = new Set([
  ".git",
  ".agents",
  ".env",
  "attached_assets",
  "node_modules",
]);

interface FixtureFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface FixtureManifest {
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly expectedCrosswalkSha256: string;
  readonly generator: string;
  readonly payload: {
    readonly file: string;
    readonly sha256: string;
    readonly uncompressedBytes: number;
  };
  readonly files: readonly FixtureFile[];
  readonly directories: readonly string[];
}

interface PayloadFile {
  readonly path: string;
  readonly base64: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeRelativePath(value: unknown, description: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a non-empty relative path.`);
  }
  if (
    path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
    || value.includes("\\")
    || value.includes("\0")
  ) {
    throw new Error(`${description} must be a portable relative path: ${value}`);
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0
        || segment === "."
        || segment === ".."
        || FORBIDDEN_PATH_SEGMENTS.has(segment)
        || segment.startsWith(".env."),
    )
  ) {
    throw new Error(`${description} contains an unsafe or forbidden segment: ${value}`);
  }
  return value;
}

function requireSha256(value: unknown, description: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${description} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function requireBoundedInteger(
  value: unknown,
  description: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${description} must be a non-negative integer no greater than ${maximum}.`);
  }
  return value as number;
}

function parseManifest(bytes: Buffer): FixtureManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Historical source fixture manifest is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error("Historical source fixture manifest must be an object.");
  }
  if (
    parsed.schemaVersion !== 1
    || parsed.sourceCommit !== FIXTURE_SOURCE_COMMIT
    || parsed.expectedCrosswalkSha256 !== EXPECTED_CROSSWALK_SHA256
    || parsed.generator !== EXPECTED_GENERATOR
  ) {
    throw new Error("Historical source fixture manifest provenance is invalid.");
  }
  if (!isRecord(parsed.payload)) {
    throw new Error("Historical source fixture payload metadata is invalid.");
  }
  const payloadFile = requireSafeRelativePath(parsed.payload.file, "Payload file");
  if (payloadFile !== "sources.json.gz") {
    throw new Error("Historical source fixture payload filename is invalid.");
  }
  const payloadSha256 = requireSha256(parsed.payload.sha256, "Payload SHA-256");
  const uncompressedBytes = requireBoundedInteger(
    parsed.payload.uncompressedBytes,
    "Payload uncompressed byte count",
    MAX_UNCOMPRESSED_PAYLOAD_BYTES,
  );
  if (uncompressedBytes === 0) {
    throw new Error("Payload uncompressed byte count must be greater than zero.");
  }
  if (!Array.isArray(parsed.files) || !Array.isArray(parsed.directories)) {
    throw new Error("Historical source fixture inventory is invalid.");
  }
  const files = parsed.files.map((entry, index): FixtureFile => {
    if (!isRecord(entry)) {
      throw new Error(`File inventory entry ${index} is invalid.`);
    }
    return {
      path: requireSafeRelativePath(entry.path, `File inventory entry ${index}`),
      bytes: requireBoundedInteger(
        entry.bytes,
        `File inventory byte count ${index}`,
        MAX_UNCOMPRESSED_PAYLOAD_BYTES,
      ),
      sha256: requireSha256(entry.sha256, `File inventory SHA-256 ${index}`),
    };
  });
  const directories = parsed.directories.map((entry, index) =>
    requireSafeRelativePath(entry, `Directory inventory entry ${index}`),
  );
  return {
    schemaVersion: 1,
    sourceCommit: FIXTURE_SOURCE_COMMIT,
    expectedCrosswalkSha256: EXPECTED_CROSSWALK_SHA256,
    generator: EXPECTED_GENERATOR,
    payload: {
      file: payloadFile,
      sha256: payloadSha256,
      uncompressedBytes,
    },
    files,
    directories,
  };
}

function decodeCanonicalBase64(value: unknown, description: string): Buffer {
  if (
    typeof value !== "string"
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error(`${description} is not canonical base64.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`${description} is not canonical base64.`);
  }
  return decoded;
}

function validateInventory(
  manifest: FixtureManifest,
  payloadBytes: Buffer,
): readonly { readonly path: string; readonly bytes: Buffer }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new Error("Historical source fixture payload is not valid JSON.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
    throw new Error("Historical source fixture payload must contain a files array.");
  }

  const manifestFiles = new Map<string, FixtureFile>();
  for (const file of manifest.files) {
    if (manifestFiles.has(file.path)) {
      throw new Error(`Duplicate manifest file path: ${file.path}`);
    }
    manifestFiles.set(file.path, file);
  }
  const directorySet = new Set<string>();
  for (const directory of manifest.directories) {
    if (directorySet.has(directory)) {
      throw new Error(`Duplicate manifest directory path: ${directory}`);
    }
    directorySet.add(directory);
  }

  const allPaths = new Map<string, "file" | "directory">();
  for (const [kind, paths] of [
    ["file", manifestFiles.keys()],
    ["directory", directorySet.values()],
  ] as const) {
    for (const itemPath of paths) {
      const segments = itemPath.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        const ancestor = segments.slice(0, index).join("/");
        if (allPaths.get(ancestor) === "file" || manifestFiles.has(ancestor)) {
          throw new Error(`File-directory inventory collision at ${ancestor}.`);
        }
      }
      if (allPaths.has(itemPath)) {
        throw new Error(`File-directory inventory collision at ${itemPath}.`);
      }
      allPaths.set(itemPath, kind);
    }
  }
  for (const [itemPath, kind] of allPaths) {
    const segments = itemPath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join("/");
      if (!directorySet.has(parent)) {
        throw new Error(`${kind} inventory path has an undeclared parent directory: ${parent}`);
      }
    }
  }

  const decodedFiles = new Map<string, Buffer>();
  for (const [index, entry] of parsed.files.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Payload file entry ${index} is invalid.`);
    }
    const entryPath = requireSafeRelativePath(entry.path, `Payload file entry ${index}`);
    if (decodedFiles.has(entryPath)) {
      throw new Error(`Duplicate payload file path: ${entryPath}`);
    }
    const bytes = decodeCanonicalBase64(entry.base64, `Payload file ${entryPath}`);
    const expected = manifestFiles.get(entryPath);
    if (!expected) {
      throw new Error(`Payload file is absent from the manifest: ${entryPath}`);
    }
    if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) {
      throw new Error(`Payload file integrity check failed: ${entryPath}`);
    }
    decodedFiles.set(entryPath, bytes);
  }
  if (decodedFiles.size !== manifestFiles.size) {
    const missing = [...manifestFiles.keys()].find((filePath) => !decodedFiles.has(filePath));
    throw new Error(`Manifest file is absent from the payload: ${missing ?? "unknown"}`);
  }

  return [...decodedFiles].map(([filePath, bytes]) => ({ path: filePath, bytes }));
}

async function requireEmptyDestination(destination: string): Promise<void> {
  try {
    const destinationStat = await lstat(destination);
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
      throw new Error("Historical source fixture destination must be an owned directory.");
    }
    if ((await readdir(destination)).length !== 0) {
      throw new Error("Historical source fixture destination must be empty.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await mkdir(destination, { recursive: true });
  }
}

async function readRegularFile(filePath: string, description: string): Promise<Buffer> {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${description} must be a regular file, not a symlink.`);
  }
  return readFile(filePath);
}

export async function materializeHistoricalSourceFixture(
  destination: string,
  fixtureDirectory = DEFAULT_FIXTURE_DIRECTORY,
): Promise<void> {
  const manifestPath = path.join(fixtureDirectory, "manifest.json");
  const manifestBytes = await readRegularFile(manifestPath, "Historical source fixture manifest");
  const actualManifestSha256 = sha256(manifestBytes);
  if (actualManifestSha256 !== EXPECTED_HISTORICAL_SOURCE_FIXTURE_MANIFEST_SHA256) {
    throw new Error("Historical source fixture manifest SHA-256 does not match the trusted pin.");
  }

  const manifest = parseManifest(manifestBytes);
  const payloadPath = path.join(fixtureDirectory, manifest.payload.file);
  const compressedPayload = await readRegularFile(
    payloadPath,
    "Historical source fixture payload",
  );
  if (compressedPayload.byteLength > MAX_COMPRESSED_PAYLOAD_BYTES) {
    throw new Error("Historical source fixture compressed payload exceeds the hard limit.");
  }
  if (sha256(compressedPayload) !== manifest.payload.sha256) {
    throw new Error("Historical source fixture payload SHA-256 does not match its manifest.");
  }

  let payloadBytes: Buffer;
  try {
    payloadBytes = gunzipSync(compressedPayload, {
      maxOutputLength: manifest.payload.uncompressedBytes,
    });
  } catch {
    throw new Error("Historical source fixture payload could not be safely decompressed.");
  }
  if (payloadBytes.byteLength !== manifest.payload.uncompressedBytes) {
    throw new Error("Historical source fixture uncompressed byte count does not match its manifest.");
  }
  const files = validateInventory(manifest, payloadBytes);

  const resolvedDestination = path.resolve(destination);
  await requireEmptyDestination(resolvedDestination);
  for (const directory of manifest.directories) {
    const resolvedDirectory = path.resolve(resolvedDestination, directory);
    if (!resolvedDirectory.startsWith(`${resolvedDestination}${path.sep}`)) {
      throw new Error(`Directory escaped fixture destination: ${directory}`);
    }
    await mkdir(resolvedDirectory, { recursive: true });
  }
  for (const file of files) {
    const resolvedFile = path.resolve(resolvedDestination, file.path);
    if (!resolvedFile.startsWith(`${resolvedDestination}${path.sep}`)) {
      throw new Error(`File escaped fixture destination: ${file.path}`);
    }
    await mkdir(path.dirname(resolvedFile), { recursive: true });
    await writeFile(resolvedFile, file.bytes, { flag: "wx" });
  }
}