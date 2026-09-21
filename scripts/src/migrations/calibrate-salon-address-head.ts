import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { isDeploymentRuntime } from "./development-runtime";
import { loadMigrations } from "./files";
import { parseMigrationHeader } from "../migration-contract/header";
import { applyMigrations } from "./runner";
import { beginFingerprintTransaction, pinFingerprintEnvironment } from "../schema-drift/fingerprint-transaction";
import { readPostgresSnapshot, readPostgresFingerprintCompatibility } from "../schema-drift/catalog";
import { fingerprintSnapshot } from "../schema-drift/fingerprint";
import { ownershipExceptions } from "../schema-drift/ownership";
import { inspectDatabaseMigrationReady } from "@workspace/db/migration-runtime";
import { redactDatabaseCommandOutput, formatDatabaseCommandFailure } from "../safe-child-process-output";

// Offline calibration only: the owned instance is never the development target.
if (isDeploymentRuntime(process.env)) throw new Error("Deployment runtime refused");
const requestedSuite = process.argv[2];
if (requestedSuite !== undefined && !["test:backend-standards", "test:appointment-regressions"].includes(requestedSuite)) {
  throw new Error("Only the full backend standards or appointment regression suite is supported");
}
const dir = await mkdtemp(path.join(os.tmpdir(), "salon-head-"));
let started = false;
let pool: pg.Pool | undefined;
try {
  execFileSync("initdb", ["-D", dir, "--auth=trust", "--username=salon_head", "--encoding=UTF8", "--locale=C"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", dir, "-l", path.join(dir, "server.log"), "-o", `-h '' -k ${dir} -p 55439`, "-w", "start"], { stdio: "ignore" });
  started = true;
  pool = new pg.Pool({ host: dir, port: 55439, user: "salon_head", database: "postgres", max: 1 });
  const client = await pool.connect();
  try {
    const systemIdentifier = (await client.query("SELECT system_identifier::text FROM pg_catalog.pg_control_system()")).rows[0].system_identifier;
    const expectedTargetIdentity = { databaseName: "postgres", systemIdentifier, transport: "unencrypted" as const };
    const fingerprint = async () => {
      await pinFingerprintEnvironment(client);
      return fingerprintSnapshot(await readPostgresSnapshot(client), ownershipExceptions, await readPostgresFingerprintCompatibility(client));
    };
    const manifest = await loadMigrations();
    const previous = manifest.filter(m => m.id < "000003");
    const sql = await readFile(new URL("../../../lib/db/migrations/000003_public_salon_entrance_details/migration.sql", import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const header = parseMigrationHeader(Buffer.from(sql), "000003");
    const candidate = {
      ...previous[0]!, id: "000003", directory: "000003_public_salon_entrance_details",
      checksum, description: header.description, sql, body: header.sqlBody,
      preconditions: header.preconditions, postconditions: header.postconditions, recovery: header.recovery,
    };
    // Capture the actual head in the runner transaction before its intentional
    // unknown-pin rejection. No check is disabled; that transaction rolls back.
    let captured: Awaited<ReturnType<typeof fingerprint>> | undefined;
    const observingClient = {
      async query(sqlText: string, values?: unknown[]) {
        const result = await client.query(sqlText, values);
        if (sqlText === candidate.postconditions[0]) captured = await fingerprint();
        return result;
      },
    };
    try {
      await applyMigrations(observingClient, { migrations: [...previous, candidate], expectedTargetIdentity });
      throw new Error("Calibration unexpectedly accepted baseline pins as head");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Migration 000003 did not produce its declared catalog fingerprint") throw error;
    }
    if (!captured) throw new Error("Head was not observed");
    const head = {
      ...candidate, structuralFingerprint: captured.structuralFingerprint,
      physicalFingerprint: captured.physicalFingerprint, normalizedObjectCount: captured.normalizedObjectCount,
    };
    const declaredHead = manifest.find(migration => migration.id === "000003")!;
    if (head.structuralFingerprint !== declaredHead.structuralFingerprint
      || head.physicalFingerprint !== declaredHead.physicalFingerprint
      || head.normalizedObjectCount !== declaredHead.normalizedObjectCount
      || head.checksum !== declaredHead.checksum) throw new Error("Computed head differs from the checked-in manifest");
    console.log("HEAD_MANIFEST", JSON.stringify(head, (key, value) => ["sql", "body", "preconditions", "postconditions", "recovery"].includes(key) ? undefined : value));
    console.log("RUNNER", await applyMigrations(client, { migrations: [...previous, head], expectedTargetIdentity }));
    await beginFingerprintTransaction(client);
    const actual = await fingerprint();
    await client.query("ROLLBACK");
    if (actual.structuralFingerprint !== head.structuralFingerprint || actual.physicalFingerprint !== head.physicalFingerprint) throw new Error("Head verification mismatch");
    console.log("VERIFIED_HEAD", JSON.stringify({
      structuralFingerprint: actual.structuralFingerprint,
      physicalFingerprint: actual.physicalFingerprint,
      normalizedObjectCount: actual.normalizedObjectCount,
      postgresCompatibility: actual.postgresCompatibility,
    }));
    const readiness = await inspectDatabaseMigrationReady(client);
    console.log("READINESS", JSON.stringify(readiness));
    if (!readiness.ready) throw new Error("Disposable head readiness failed");
  } finally {
    client.release();
  }
  if (requestedSuite) {
    // Only route the child to this owned Unix socket. Deployment/runtime guard
    // values are inherited unchanged; no guard is bypassed.
    const databaseUrl = `postgresql://salon_head@localhost:55439/postgres?host=${encodeURIComponent(dir)}`;
    console.log("BACKEND_SUITE", requestedSuite);
    const environment = { ...process.env, DATABASE_URL: databaseUrl };
    try {
      if (requestedSuite === "test:appointment-regressions") {
        // This existing entry point initializes the full demo fixture before
        // booking-p1 creates any users. The fixture initializer intentionally
        // will not create demo identities once arbitrary users already exist.
        const bootstrapOutput = execFileSync("pnpm", ["run", "test:appointment-concurrency"], {
          cwd: new URL("../../../", import.meta.url),
          env: environment,
          timeout: 180_000,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
        process.stdout.write(redactDatabaseCommandOutput(bootstrapOutput, environment));
      }
      const output = execFileSync("pnpm", ["run", requestedSuite], {
        cwd: new URL("../../../", import.meta.url),
        env: environment,
        timeout: 240_000,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      process.stdout.write(redactDatabaseCommandOutput(output, environment));
    } catch (error) {
      throw formatDatabaseCommandFailure(requestedSuite, error, environment);
    }
  }
} finally {
  await pool?.end();
  if (started) execFileSync("pg_ctl", ["-D", dir, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  await rm(dir, { recursive: true, force: true });
  try {
    await access(dir);
    throw new Error("Owned instance directory remains after cleanup");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  console.log("OWNED_INSTANCE_REMOVED", dir);
}