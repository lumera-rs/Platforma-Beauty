import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

// Offline only: no ambient connection string is read; all DDL uses the runner
// on a newly owned PostgreSQL instance with its declared identity.
if (isDeploymentRuntime(process.env)) throw new Error("Deployment runtime refused");
const dir = await mkdtemp(path.join(os.tmpdir(), "job-head-"));
let started = false;
let pool: pg.Pool | undefined;
try {
  execFileSync("initdb", ["-D", dir, "--auth=trust", "--username=job_head", "--encoding=UTF8", "--locale=C"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", dir, "-l", path.join(dir, "server.log"), "-o", `-h '' -k ${dir} -p 55439`, "-w", "start"], { stdio: "ignore" });
  started = true;
  pool = new pg.Pool({ host: dir, port: 55439, user: "job_head", database: "postgres", max: 1 });
  const client = await pool.connect();
  try {
    const systemIdentifier = (await client.query("SELECT system_identifier::text FROM pg_catalog.pg_control_system()")).rows[0].system_identifier;
    const expectedTargetIdentity = { databaseName: "postgres", systemIdentifier, transport: "unencrypted" as const };
    console.log("DISPOSABLE_IDENTITY", JSON.stringify(expectedTargetIdentity));
    const fingerprint = async () => {
      await pinFingerprintEnvironment(client);
      return fingerprintSnapshot(await readPostgresSnapshot(client), ownershipExceptions, await readPostgresFingerprintCompatibility(client));
    };
    const manifest = await loadMigrations();
    const previous = manifest.filter(m => m.id < "000004");
    const sql = await readFile(new URL("../../../lib/db/migrations/000004_job_first_publication/migration.sql", import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const header = parseMigrationHeader(Buffer.from(sql), "000004");
    const candidate = {
      ...previous.at(-1)!, id: "000004", directory: "000004_job_first_publication",
      checksum, description: header.description, sql, body: header.sqlBody,
      preconditions: header.preconditions, postconditions: header.postconditions, recovery: header.recovery,
    };
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
      throw new Error("Calibration unexpectedly accepted previous pins as head");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Migration 000004 did not produce its declared catalog fingerprint") throw error;
    }
    if (!captured) throw new Error("Head was not observed");
    const head = {
      ...candidate, structuralFingerprint: captured.structuralFingerprint,
      physicalFingerprint: captured.physicalFingerprint, normalizedObjectCount: captured.normalizedObjectCount,
    };
    console.log("HEAD_MANIFEST", JSON.stringify(head, (key, value) => ["sql", "body", "preconditions", "postconditions", "recovery"].includes(key) ? undefined : value));
    const declaredHead = manifest.find(m => m.id === "000004");
    // The first calibration only prints the observed values after rollback.
    if (declaredHead) {
      if (head.structuralFingerprint !== declaredHead.structuralFingerprint
        || head.physicalFingerprint !== declaredHead.physicalFingerprint
        || head.normalizedObjectCount !== declaredHead.normalizedObjectCount
        || head.checksum !== declaredHead.checksum) throw new Error("Computed head differs from the checked-in manifest");
      console.log("RUNNER", await applyMigrations(client, { migrations: [...previous, head], expectedTargetIdentity }));
      await beginFingerprintTransaction(client);
      const actual = await fingerprint();
      await client.query("ROLLBACK");
      if (actual.structuralFingerprint !== head.structuralFingerprint || actual.physicalFingerprint !== head.physicalFingerprint) throw new Error("Head verification mismatch");
      console.log("VERIFIED_HEAD", JSON.stringify({
        structuralFingerprint: actual.structuralFingerprint, physicalFingerprint: actual.physicalFingerprint,
        normalizedObjectCount: actual.normalizedObjectCount, postgresCompatibility: actual.postgresCompatibility,
      }));
      const readiness = await inspectDatabaseMigrationReady(client);
      console.log("READINESS", JSON.stringify(readiness));
      if (!readiness.ready) throw new Error("Disposable head readiness failed");
    }
  } finally {
    client.release();
  }
} finally {
  if (pool) await pool.end();
  if (started) execFileSync("pg_ctl", ["-D", dir, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  await rm(dir, { recursive: true, force: true });
}