import { pool, type DatabasePoolClient as PoolClient } from "@workspace/db";
import { isProductionOrDeploymentRuntime } from "@workspace/db/destructive-test-runtime";
import { logger } from "./logger";

const LOCK_KEY = "lumera:booking-development-schema:v1";

const ENUMS = {
  appointment_deposit_status: ["pending", "paid", "waived", "refunded", "forfeited"],
  appointment_waitlist_status: ["waiting", "notified", "converted", "cancelled", "expired"],
} as const;

function quoteSchema(schemaName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName) || schemaName.length > 63) {
    throw new Error("Invalid PostgreSQL schema name for booking development reconciliation.");
  }
  return `"${schemaName}"`;
}

export function assertBookingDevelopmentSchemaRuntimeAllowed(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (isProductionOrDeploymentRuntime(environment)) {
    throw new Error(
      "Booking development schema reconciliation refuses production or deployment runtimes; use Replit Publish.",
    );
  }
}

function enumStatements(schema: string, typeName: string, labels: readonly string[]): string[] {
  const qualifiedType = `${schema}.${typeName}`;
  return [
    `DO $$ BEGIN
       CREATE TYPE ${qualifiedType} AS ENUM (${labels.map((label) => `'${label}'`).join(", ")});
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`,
    ...labels.map((label) => `ALTER TYPE ${qualifiedType} ADD VALUE IF NOT EXISTS '${label}'`),
  ];
}

function addConstraintIfMissing(
  schemaName: string,
  schema: string,
  table: string,
  constraint: string,
  definition: string,
): string {
  return `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = '${schemaName}.${table}'::regclass
        AND conname = '${constraint}'
    ) THEN
      ALTER TABLE ${schema}.${table} ADD CONSTRAINT ${constraint} ${definition};
    END IF;
  END $$`;
}

function bookingSchemaStatements(schemaName: string, schema: string): string[] {
  const constraints = [
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_ons",
      "service_add_ons_pkey",
      "PRIMARY KEY (id)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_ons",
      "service_add_ons_duration_check",
      "CHECK (duration_minutes >= 0)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_ons",
      "service_add_ons_price_check",
      "CHECK (price >= 0)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_ons",
      "service_add_ons_service_id_services_id_fk",
      `FOREIGN KEY (service_id) REFERENCES ${schema}.services(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_on_resource_requirements",
      "service_add_on_resource_requirements_pkey",
      "PRIMARY KEY (id)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_on_resource_requirements",
      "service_add_on_resource_quantity_check",
      "CHECK (quantity >= 1)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_on_resource_requirements",
      "service_add_on_resource_requirements_add_on_id_service_add_ons_",
      `FOREIGN KEY (add_on_id) REFERENCES ${schema}.service_add_ons(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "service_add_on_resource_requirements",
      "service_add_on_resource_requirements_resource_id_salon_resource",
      `FOREIGN KEY (resource_id) REFERENCES ${schema}.salon_resources(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_add_ons",
      "appointment_add_ons_pkey",
      "PRIMARY KEY (id)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_add_ons",
      "appointment_add_ons_add_on_id_service_add_ons_id_fk",
      `FOREIGN KEY (add_on_id) REFERENCES ${schema}.service_add_ons(id) ON DELETE SET NULL`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_add_ons",
      "appointment_add_ons_appointment_id_appointments_id_fk",
      `FOREIGN KEY (appointment_id) REFERENCES ${schema}.appointments(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_employees",
      "appointment_employees_pkey",
      "PRIMARY KEY (id)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_employees",
      "appointment_employees_appointment_id_appointments_id_fk",
      `FOREIGN KEY (appointment_id) REFERENCES ${schema}.appointments(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_employees",
      "appointment_employees_employee_id_employees_id_fk",
      `FOREIGN KEY (employee_id) REFERENCES ${schema}.employees(id) ON DELETE RESTRICT`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_waitlist",
      "appointment_waitlist_pkey",
      "PRIMARY KEY (id)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_waitlist",
      "appointment_waitlist_window_check",
      "CHECK (earliest_time < latest_time)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_waitlist",
      "appointment_waitlist_customer_id_users_id_fk",
      `FOREIGN KEY (customer_id) REFERENCES ${schema}.users(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_waitlist",
      "appointment_waitlist_employee_id_employees_id_fk",
      `FOREIGN KEY (employee_id) REFERENCES ${schema}.employees(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_waitlist",
      "appointment_waitlist_salon_id_salons_id_fk",
      `FOREIGN KEY (salon_id) REFERENCES ${schema}.salons(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_waitlist",
      "appointment_waitlist_service_id_services_id_fk",
      `FOREIGN KEY (service_id) REFERENCES ${schema}.services(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_deposits",
      "appointment_deposits_pkey",
      "PRIMARY KEY (id)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_deposits",
      "appointment_deposits_amount_check",
      "CHECK (amount >= 0)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_deposits",
      "appointment_deposits_appointment_id_appointments_id_fk",
      `FOREIGN KEY (appointment_id) REFERENCES ${schema}.appointments(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_deposits",
      "appointment_deposits_salon_id_salons_id_fk",
      `FOREIGN KEY (salon_id) REFERENCES ${schema}.salons(id) ON DELETE CASCADE`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointment_deposits",
      "appointment_deposits_settled_by_user_id_users_id_fk",
      `FOREIGN KEY (settled_by_user_id) REFERENCES ${schema}.users(id) ON DELETE SET NULL`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointments",
      "appointments_segments_check",
      `CHECK (
        pre_processing_minutes >= 0
        AND processing_minutes >= 0
        AND post_processing_minutes >= 0
        AND (
          (pre_processing_minutes = 0 AND processing_minutes = 0 AND post_processing_minutes = 0)
          OR (pre_processing_minutes + processing_minutes + post_processing_minutes = duration_minutes)
        )
      )`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointments",
      "appointments_seat_count_check",
      "CHECK (seat_count >= 1)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "appointments",
      "appointments_buffer_minutes_check",
      "CHECK (buffer_minutes >= 0)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "services",
      "services_segments_check",
      `CHECK (
        pre_processing_minutes >= 0
        AND processing_minutes >= 0
        AND post_processing_minutes >= 0
        AND (
          (pre_processing_minutes = 0 AND processing_minutes = 0 AND post_processing_minutes = 0)
          OR (pre_processing_minutes + processing_minutes + post_processing_minutes = duration_minutes)
        )
      )`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "services",
      "services_processing_segments_check",
      `CHECK (
        pre_processing_minutes >= 0
        AND processing_minutes >= 0
        AND post_processing_minutes >= 0
        AND (
          (pre_processing_minutes = 0 AND processing_minutes = 0 AND post_processing_minutes = 0)
          OR (
            duration_minutes = pre_processing_minutes + processing_minutes + post_processing_minutes
            AND duration_minutes > 0
          )
        )
      )`,
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "services",
      "services_seat_capacity_check",
      "CHECK (seat_capacity >= 1)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "services",
      "services_required_employee_count_check",
      "CHECK (required_employee_count >= 1 AND required_employee_count <= 20)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "services",
      "services_deposit_amount_check",
      "CHECK (deposit_amount IS NULL OR deposit_amount >= 0)",
    ),
    addConstraintIfMissing(
      schemaName,
      schema,
      "services",
      "services_buffer_minutes_check",
      "CHECK (buffer_minutes >= 0)",
    ),
  ];

  return [
    `CREATE TABLE IF NOT EXISTS ${schema}.service_add_ons (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      service_id uuid NOT NULL,
      name text NOT NULL,
      duration_minutes integer DEFAULT 0 NOT NULL,
      price integer DEFAULT 0 NOT NULL,
      active boolean DEFAULT true NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.service_add_on_resource_requirements (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      add_on_id uuid NOT NULL,
      resource_id uuid NOT NULL,
      quantity integer DEFAULT 1 NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.appointment_add_ons (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      appointment_id uuid NOT NULL,
      add_on_id uuid,
      name text NOT NULL,
      duration_minutes integer NOT NULL,
      price integer NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.appointment_employees (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      appointment_id uuid NOT NULL,
      employee_id uuid NOT NULL,
      is_primary boolean DEFAULT false NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.appointment_waitlist (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      salon_id uuid NOT NULL,
      service_id uuid NOT NULL,
      customer_id uuid NOT NULL,
      employee_id uuid,
      desired_date date NOT NULL,
      earliest_time text DEFAULT '00:00' NOT NULL,
      latest_time text DEFAULT '23:59' NOT NULL,
      status ${schema}.appointment_waitlist_status DEFAULT 'waiting' NOT NULL,
      notified_at timestamptz,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.appointment_deposits (
      id uuid DEFAULT gen_random_uuid() NOT NULL,
      appointment_id uuid NOT NULL,
      salon_id uuid NOT NULL,
      amount integer NOT NULL,
      status ${schema}.appointment_deposit_status DEFAULT 'pending' NOT NULL,
      settled_at timestamptz,
      settled_by_user_id uuid,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )`,
    `ALTER TABLE ${schema}.appointment_series ADD COLUMN IF NOT EXISTS recurrence_frequency text`,
    `ALTER TABLE ${schema}.appointment_series ADD COLUMN IF NOT EXISTS recurrence_interval integer`,
    `ALTER TABLE ${schema}.appointments ADD COLUMN IF NOT EXISTS buffer_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.appointments ADD COLUMN IF NOT EXISTS post_processing_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.appointments ADD COLUMN IF NOT EXISTS pre_processing_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.appointments ADD COLUMN IF NOT EXISTS processing_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.appointments ADD COLUMN IF NOT EXISTS seat_count integer DEFAULT 1 NOT NULL`,
    `ALTER TABLE ${schema}.services ADD COLUMN IF NOT EXISTS buffer_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.services ADD COLUMN IF NOT EXISTS deposit_amount integer`,
    `ALTER TABLE ${schema}.services ADD COLUMN IF NOT EXISTS post_processing_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.services ADD COLUMN IF NOT EXISTS pre_processing_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.services ADD COLUMN IF NOT EXISTS processing_minutes integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE ${schema}.services ADD COLUMN IF NOT EXISTS required_employee_count integer DEFAULT 1 NOT NULL`,
    `ALTER TABLE ${schema}.services ADD COLUMN IF NOT EXISTS seat_capacity integer DEFAULT 1 NOT NULL`,
    ...constraints,
    `CREATE UNIQUE INDEX IF NOT EXISTS service_add_ons_service_name_unique ON ${schema}.service_add_ons(service_id, name)`,
    `CREATE INDEX IF NOT EXISTS service_add_ons_service_active_idx ON ${schema}.service_add_ons(service_id, active)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS service_add_on_resource_unique ON ${schema}.service_add_on_resource_requirements(add_on_id, resource_id)`,
    `CREATE INDEX IF NOT EXISTS service_add_on_resource_resource_idx ON ${schema}.service_add_on_resource_requirements(resource_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS appointment_add_ons_appointment_add_on_unique ON ${schema}.appointment_add_ons(appointment_id, add_on_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_add_ons_appointment_idx ON ${schema}.appointment_add_ons(appointment_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_add_ons_add_on_idx ON ${schema}.appointment_add_ons(add_on_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS appointment_employees_appointment_employee_unique ON ${schema}.appointment_employees(appointment_id, employee_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_employees_appointment_idx ON ${schema}.appointment_employees(appointment_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_employees_employee_idx ON ${schema}.appointment_employees(employee_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS appointment_waitlist_live_unique
      ON ${schema}.appointment_waitlist(salon_id, service_id, customer_id, desired_date)
      WHERE status IN ('waiting', 'notified')`,
    `CREATE INDEX IF NOT EXISTS appointment_waitlist_salon_date_status_idx ON ${schema}.appointment_waitlist(salon_id, desired_date, status)`,
    `CREATE INDEX IF NOT EXISTS appointment_waitlist_customer_idx ON ${schema}.appointment_waitlist(customer_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_waitlist_service_idx ON ${schema}.appointment_waitlist(service_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_waitlist_employee_idx ON ${schema}.appointment_waitlist(employee_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS appointment_deposits_appointment_unique ON ${schema}.appointment_deposits(appointment_id)`,
    `CREATE INDEX IF NOT EXISTS appointment_deposits_salon_status_idx ON ${schema}.appointment_deposits(salon_id, status)`,
    `CREATE INDEX IF NOT EXISTS appointment_deposits_settled_by_idx ON ${schema}.appointment_deposits(settled_by_user_id)`,
  ];
}

export async function runBookingDevelopmentSchemaDdl(
  client: PoolClient,
  schemaName: string,
): Promise<void> {
  const schema = quoteSchema(schemaName);
  for (const [typeName, labels] of Object.entries(ENUMS)) {
    for (const statement of enumStatements(schema, typeName, labels)) {
      await client.query(statement);
    }
  }

  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL search_path TO ${schema}`);
    for (const statement of bookingSchemaStatements(schemaName, schema)) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function ensureBookingDevelopmentSchema(
  schemaName = "public",
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  assertBookingDevelopmentSchemaRuntimeAllowed(environment);
  quoteSchema(schemaName);
  const client = await pool.connect();
  let locked = false;
  let schemaError: unknown;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`${LOCK_KEY}:${schemaName}`]);
    locked = true;
    await runBookingDevelopmentSchemaDdl(client, schemaName);
  } catch (error) {
    schemaError = error;
    throw error;
  } finally {
    let unlockError: unknown;
    if (locked) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext($1))",
        [`${LOCK_KEY}:${schemaName}`],
      ).catch((error) => {
        unlockError = error;
        logger.error(
          { err: error, schema: schemaName },
          "Booking development schema advisory lock could not be released cleanly",
        );
      });
    }
    client.release(unlockError instanceof Error ? unlockError : unlockError ? true : undefined);
    if (unlockError && !schemaError) throw unlockError;
  }
}