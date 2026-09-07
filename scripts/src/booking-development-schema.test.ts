import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import {
  assertBookingDevelopmentSchemaRuntimeAllowed,
  ensureBookingDevelopmentSchema,
} from "./booking-development-schema";

assertDestructiveTestRuntimeAllowed(process.env, "Booking development schema tests");

const schemaName = `booking_dev_schema_${Date.now()}`;
const schema = `"${schemaName}"`;

async function run(): Promise<void> {
  assert.throws(
    () => assertBookingDevelopmentSchemaRuntimeAllowed({ NODE_ENV: "production" }),
    /refuses production or deployment runtimes/,
  );

  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
    await pool.query(`CREATE TABLE ${schema}.salons (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
    await pool.query(`CREATE TABLE ${schema}.services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      duration_minutes integer NOT NULL DEFAULT 30
    )`);
    await pool.query(`CREATE TABLE ${schema}.employees (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
    await pool.query(`CREATE TABLE ${schema}.appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      duration_minutes integer NOT NULL DEFAULT 30
    )`);
    await pool.query(`CREATE TABLE ${schema}.appointment_series (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
    await pool.query(`CREATE TABLE ${schema}.salon_resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);

    await ensureBookingDevelopmentSchema(schemaName);
    await ensureBookingDevelopmentSchema(schemaName);

    const tables = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM information_schema.tables
       WHERE table_schema = $1
         AND table_name = ANY($2::text[])`,
      [
        schemaName,
        [
          "appointment_waitlist",
          "appointment_employees",
          "appointment_add_ons",
          "appointment_deposits",
          "service_add_ons",
          "service_add_on_resource_requirements",
        ],
      ],
    );
    assert.equal(tables.rows[0]?.count, 6);

    const columns = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM information_schema.columns
       WHERE table_schema = $1
         AND (table_name, column_name) IN (
           ('appointment_series', 'recurrence_frequency'),
           ('appointment_series', 'recurrence_interval'),
           ('appointments', 'pre_processing_minutes'),
           ('appointments', 'processing_minutes'),
           ('appointments', 'post_processing_minutes'),
           ('appointments', 'seat_count'),
           ('appointments', 'buffer_minutes'),
           ('services', 'pre_processing_minutes'),
           ('services', 'processing_minutes'),
           ('services', 'post_processing_minutes'),
           ('services', 'seat_capacity'),
           ('services', 'required_employee_count'),
           ('services', 'deposit_amount'),
           ('services', 'buffer_minutes')
         )`,
      [schemaName],
    );
    assert.equal(columns.rows[0]?.count, 14);

    const constraints = await pool.query<{ names: string[] }>(
      `SELECT array_agg(conname ORDER BY conname)::text[] AS names
       FROM pg_constraint
       WHERE connamespace = $1::regnamespace
         AND conname = ANY($2::text[])`,
      [
        schemaName,
        [
          "appointments_buffer_minutes_check",
          "appointments_segments_check",
          "appointments_seat_count_check",
          "services_buffer_minutes_check",
          "services_deposit_amount_check",
          "services_processing_segments_check",
          "services_required_employee_count_check",
          "services_seat_capacity_check",
          "services_segments_check",
        ],
      ],
    );
    assert.equal(constraints.rows[0]?.names.length, 9);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }

  console.log("✓ booking development schema is replay-safe and production-guarded");
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});