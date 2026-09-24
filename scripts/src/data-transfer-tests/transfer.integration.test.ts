import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDestructiveTestRuntimeAllowed } from "@workspace/db/destructive-test-runtime";
import type { DatabaseClient } from "../backend-standards-database";
import { transferData } from "../data-transfer/engine";
import { transferFixtureData } from "../data-transfer/fixture";
import { withOwnedPair, type OwnedPair } from "../data-transfer-proof/owned-pair";
import { identifier, readTransferCatalog, relation } from "../data-transfer/catalog";
import { stableRows } from "../data-transfer/seed-contract";

assertDestructiveTestRuntimeAllowed(process.env, "Data transfer integration tests");

const category = "00000000-0000-4000-8000-000000000101";
const user = "00000000-0000-4000-8000-000000000102";
const salon = "00000000-0000-4000-8000-000000000103";
const ledgerAccess = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+(?:"?public"?\.)?"?lumera_migration_ledger"?\b/iu;
const ledgerWrite = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|ALTER\s+TABLE|DROP\s+TABLE)\s+(?:"?public"?\.)?"?lumera_migration_ledger"?\b/iu;
const fixtures = new WeakSet<OwnedPair>();

test("transfer refuses a target session already configured in replica mode", async () => {
  await withOwnedPair(async pair => {
    const source = await pair.source.connect();
    const target = await pair.target.connect();
    try {
      await target.query("SET session_replication_role=replica");
      await assert.rejects(() => transferFixtureData(source, target, { expectedTargetIdentity: pair.expectedTargetIdentity }),
        { code: "TARGET_REPLICATION_ROLE_NOT_ORIGIN", step: "trigger-runtime" },
        "preconfigured replica mode must not bypass validating triggers or foreign keys");
    } finally {
      await target.query("SET session_replication_role=origin");
      source.release(); target.release();
    }
  });
});

test("canonical ownership trigger rejects self-parent category during the real transfer", async () => {
  await withOwnedPair(async pair => {
    await pair.buildCanonical(pair.source);
    const source = await pair.source.connect();
    const target = await pair.target.connect();
    try {
      // Disposable fixture preparation only: seed identities must match exactly.
      await source.query("BEGIN");
      await source.query("SET LOCAL session_replication_role=replica");
      for (const table of await readTransferCatalog(target)) {
        const columns = table.columns.filter(c => !c.generated).map(c => c.name);
        const rows = await stableRows(target, table.name, columns, table.primaryKey);
        await source.query(`DELETE FROM ${relation(table.name)}`);
        for (const row of rows) {
          const projection = columns.map(identifier).join(",");
          await source.query(`INSERT INTO ${relation(table.name)} (${projection}) OVERRIDING SYSTEM VALUE
            SELECT ${projection} FROM jsonb_populate_record(NULL::${relation(table.name)},$1::jsonb)`, [row]);
        }
      }
      await source.query(`INSERT INTO public.product_categories(id,name,slug,parent_id)
        VALUES($1,'Disposable self-parent','disposable-self-parent',$1)`, [category]);
      await source.query("COMMIT");
      await assert.rejects(() => transferData(source, target, { expectedTargetIdentity: pair.expectedTargetIdentity }),
        { code: "TRANSFER_FAILED", sqlstate: "P0001", step: "insert" },
        "the canonical validating ownership trigger must reject a self-parent category");
      assert.equal((await target.query("SELECT count(*)::int AS n FROM public.product_categories")).rows[0].n, 0);
      assert.equal((await target.query(`SELECT tgenabled FROM pg_trigger
        WHERE tgname='product_categories_supplier_ownership'`)).rows[0].tgenabled, "O");
    } finally { source.release(); target.release(); }
  }, { builtCanonical: true });
});

async function withFixturePair(callback: (pair: OwnedPair) => Promise<void>): Promise<void> {
  await withOwnedPair(async pair => {
    fixtures.add(pair);
    for (const pool of [pair.source, pair.target]) {
      await pool.query(`
        CREATE TABLE public.service_categories(id uuid PRIMARY KEY,name text NOT NULL,slug text NOT NULL,description text NOT NULL);
        CREATE TABLE public.users(id uuid PRIMARY KEY,first_name text,last_name text,email text,password_hash text);
        CREATE TABLE public.salons(id uuid PRIMARY KEY,owner_id uuid REFERENCES public.users(id),name text,slug text,
          city text,municipality text,address text,phone text,email text,short_description text,description text,image_url text,payment_reference_number text);
        CREATE TABLE public.salon_brands(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),salon_id uuid REFERENCES public.salons(id),
          brand_id uuid REFERENCES public.service_categories(id));
        CREATE TABLE public.synthetic_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE FUNCTION public.synthetic_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN INSERT INTO public.synthetic_outbox DEFAULT VALUES; NEW.payment_reference_number := 'trigger-fired'; RETURN NEW; END $$;
        CREATE TRIGGER synthetic_side_effect BEFORE INSERT ON public.salons FOR EACH ROW EXECUTE FUNCTION public.synthetic_side_effect();
        CREATE TABLE public.lumera_migration_ledger(migration_id text PRIMARY KEY,receipt text);
      `);
    }
    await pair.source.query("INSERT INTO public.lumera_migration_ledger VALUES('source','source-receipt')");
    await pair.target.query("INSERT INTO public.lumera_migration_ledger VALUES('target','target-receipt')");
    await callback(pair);
  });
}

async function receipts(pair: OwnedPair): Promise<unknown[]> {
  return (await pair.target.query("SELECT to_jsonb(r) AS receipt FROM public.lumera_migration_ledger r ORDER BY migration_id")).rows;
}

async function withCanonicalPair(callback: (pair: OwnedPair) => Promise<void>): Promise<void> {
  await withOwnedPair(async pair => {
    await pair.buildCanonical(pair.source);
    await callback(pair);
  }, { builtCanonical: true });
}

async function transfer(pair: OwnedPair, wrongIdentity = false, rehearsal = false) {
  const source = await pair.source.connect();
  const target = await pair.target.connect();
  const sourceStatements: string[] = [];
  const targetStatements: string[] = [];
  const observed = (client: DatabaseClient, statements: string[]): DatabaseClient => ({
    async query(sql, values) {
      statements.push(sql);
      return client.query(sql, values);
    },
  });
  try {
    const run = fixtures.has(pair) ? transferFixtureData : transferData;
    const report = await run(observed(source, sourceStatements), observed(target, targetStatements), {
      rehearsal,
      expectedTargetIdentity: wrongIdentity
        ? { ...pair.expectedTargetIdentity, databaseName: "wrong_declared_database" }
        : pair.expectedTargetIdentity,
    });
    return { report, sourceStatements, targetStatements };
  } finally {
    source.release();
    target.release();
    assert.equal(sourceStatements.some(sql => ledgerAccess.test(sql)), false, "the source ledger must never be queried");
    assert.equal(targetStatements.some(sql => ledgerWrite.test(sql)), false, "the target ledger must never be written");
  }
}

async function insertCategory(pair: OwnedPair, destination: "source" | "target" = "source"): Promise<void> {
  await pair[destination].query(
    "INSERT INTO public.service_categories(id,name,slug,description) VALUES($1,'synthetic','synthetic-transfer','synthetic fixture')",
    [category],
  );
}

test("transfer refuses a source-only column without changing the target", async () => {
  await withFixturePair(async pair => {
    await insertCategory(pair);
    await pair.source.query("ALTER TABLE public.service_categories ADD COLUMN source_only_note text");
    const before = await receipts(pair);
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked", "a source-only column must never be silently dropped");
    assert.ok(report.blockers.some(b => b.code === "SOURCE_ONLY_COLUMN"
      && b.table === "public.service_categories" && b.column === "source_only_note"));
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.service_categories")).rows[0].n, 0);
    assert.deepEqual(await receipts(pair), before);
  });
});

test("transfer refuses a target-only NOT NULL column without a default", async () => {
  await withFixturePair(async pair => {
    await pair.source.query("ALTER TABLE public.service_categories DROP COLUMN description");
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked");
    assert.ok(report.blockers.some(b => b.code === "TARGET_REQUIRED_COLUMN"
      && b.table === "public.service_categories" && b.column === "description"));
  });
});

test("transfer reports foreign-key violation counts and rolls back every loaded row", async () => {
  await withFixturePair(async pair => {
    await insertCategory(pair);
    const source = await pair.source.connect();
    try {
      await source.query("BEGIN");
      await source.query("SET LOCAL session_replication_role=replica");
      await source.query("INSERT INTO public.salon_brands(salon_id,brand_id) VALUES($1,$2)", [salon, category]);
      await source.query("COMMIT");
    } finally { source.release(); }
    const before = await receipts(pair);
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked", "constraint verification must reject a transferred orphan");
    assert.ok(report.blockers.some(b => b.table === "public.salon_brands"
      && b.code === "FOREIGN_KEY_DEPENDENCY_BLOCKED" && b.count === 1),
    "each violated foreign key must be reported with its observed count");
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.service_categories")).rows[0].n, 0);
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.salon_brands")).rows[0].n, 0);
    assert.deepEqual(await receipts(pair), before);
  });
});

test("transfer refuses a non-empty target even when its schema is canonical", async () => {
  await withCanonicalPair(async pair => {
    await insertCategory(pair, "target");
    const before = (await pair.target.query("SELECT to_jsonb(r) AS row FROM public.service_categories r")).rows;
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked", "non-empty application targets must be refused");
    assert.ok(report.blockers.some(b => b.table === "public.service_categories"));
    assert.deepEqual((await pair.target.query("SELECT to_jsonb(r) AS row FROM public.service_categories r")).rows, before);
  });
});

test("shared load transaction refuses a non-empty synthetic target", async () => {
  await withFixturePair(async pair => {
    await insertCategory(pair, "target");
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked", "non-empty application targets must be refused");
    assert.ok(report.blockers.some(b => b.code === "TARGET_NOT_PRISTINE"));
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.service_categories")).rows[0].n, 1);
  });
});

test("transfer refuses a wrong declared target identity before any write", async () => {
  await withCanonicalPair(async pair => {
    const before = await receipts(pair);
    await assert.rejects(() => transfer(pair, true), { message: "Target identity mismatch: databaseName" },
      "wrong declared identity must fail with the exact identity error");
    assert.deepEqual(await receipts(pair), before);
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.service_categories")).rows[0].n, 0);
  });
});

test("positive sequence transfer advances beyond every transferred value", async () => {
  await withFixturePair(async pair => {
    for (const pool of [pair.source, pair.target]) await pool.query("CREATE TABLE public.sequence_positive(id bigserial PRIMARY KEY,note text)");
    await pair.source.query("INSERT INTO public.sequence_positive(id,note) VALUES(7,'fixture'),(4000,'fixture')");
    const { report } = await transfer(pair);
    assert.equal(report.status, "committed");
    const next = (await pair.target.query("SELECT nextval('public.sequence_positive_id_seq')::text AS n")).rows[0].n;
    assert.equal(next, "4001", "sequence must restart above the highest transferred value");
  });
});

test("positive no-primary-key transfer preserves duplicate multiplicity", async () => {
  await withFixturePair(async pair => {
    for (const pool of [pair.source, pair.target]) await pool.query("CREATE TABLE public.duplicate_fixture(note text,n integer)");
    await pair.source.query("INSERT INTO public.duplicate_fixture VALUES('fixture',7),('fixture',7),('other',9)");
    const { report } = await transfer(pair);
    assert.equal(report.status, "committed", "duplicate rows must not be discarded during transfer");
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.duplicate_fixture WHERE n=7")).rows[0].n, 2,
      "duplicate multiplicity must be preserved");
  });
});

test("validating trigger rejects a category that is its own parent", async () => {
  await withFixturePair(async pair => {
    for (const pool of [pair.source, pair.target]) {
      await pool.query(`CREATE TABLE public.category_fixture(id integer PRIMARY KEY,parent_id integer);
        CREATE FUNCTION public.category_no_self() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.id=NEW.parent_id THEN RAISE EXCEPTION 'self parent rejected'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER category_no_self BEFORE INSERT ON public.category_fixture FOR EACH ROW EXECUTE FUNCTION public.category_no_self()`);
    }
    await pair.source.query("ALTER TABLE public.category_fixture DISABLE TRIGGER category_no_self");
    await pair.source.query("INSERT INTO public.category_fixture VALUES(1,1)");
    await pair.source.query("ALTER TABLE public.category_fixture ENABLE TRIGGER category_no_self");
    let rejected = false;
    try { rejected = (await transfer(pair)).report.status === "blocked"; } catch (error) {
      assert.equal((error as { sqlstate?: string }).sqlstate, "P0001");
      rejected = true;
    }
    assert.equal(rejected, true, "validating triggers must reject self-parent categories");
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.category_fixture")).rows[0].n, 0);
  });
});

test("every disabled trigger is restored before commit and fingerprint verification", async () => {
  await withFixturePair(async pair => {
    await insertCategory(pair);
    const { report } = await transfer(pair).catch(() =>
      assert.fail("disabled trigger must be re-enabled before final policy and fingerprint verification"));
    assert.equal(report.status, "committed", "disabled trigger must be re-enabled before fingerprint verification");
    assert.equal((await pair.target.query("SELECT tgenabled FROM pg_trigger WHERE tgname='synthetic_side_effect'")).rows[0].tgenabled, "O",
      "no disabled trigger may survive commit");
  });
});

test("rehearsal verifies a complete transfer then rolls back rows and sequences", async () => {
  await withFixturePair(async pair => {
    for (const pool of [pair.source, pair.target]) await pool.query("CREATE TABLE public.sequence_positive(id bigserial PRIMARY KEY,note text)");
    await pair.source.query("INSERT INTO public.sequence_positive(id,note) VALUES(4000,'fixture')");
    const before = (await pair.target.query("SELECT last_value,is_called FROM public.sequence_positive_id_seq")).rows;
    const { report } = await transfer(pair, false, true);
    assert.equal(report.status, "rehearsed");
    assert.equal(report.vacuumRecommended, true);
    assert.equal(report.tables.find(t => t.table === "public.sequence_positive")?.targetCount, 1);
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.sequence_positive")).rows[0].n, 0);
    assert.deepEqual((await pair.target.query("SELECT last_value,is_called FROM public.sequence_positive_id_seq")).rows, before);
  });
});

test("transfer never reads the source ledger or writes the target ledger", async () => {
  await withFixturePair(async pair => {
    await insertCategory(pair);
    const before = await receipts(pair);
    const { report, sourceStatements, targetStatements } = await transfer(pair);
    assert.equal(report.status, "committed");
    assert.equal(sourceStatements.some(sql => ledgerAccess.test(sql)), false, "the source ledger must never be queried");
    assert.equal(targetStatements.some(sql => ledgerWrite.test(sql)), false, "the target ledger must never be written");
    assert.deepEqual(await receipts(pair), before);
    assert.ok(sourceStatements.some(sql => /REPEATABLE READ READ ONLY/iu.test(sql)));
    const result = report.tables.find(t => t.table === "public.service_categories");
    assert.equal(result?.sourceCount, 1);
    assert.equal(result?.targetCount, 1);
    assert.equal(result?.sourceHash, result?.targetHash);
  });
});

test("shared load transaction suppresses synthetic INSERT trigger side effects and preserves source values", async () => {
  await withFixturePair(async pair => {
    const source = await pair.source.connect();
    try {
      await source.query("BEGIN");
      await source.query("SET LOCAL session_replication_role=replica");
      await source.query(
        "INSERT INTO public.users(id,first_name,last_name,email,password_hash) VALUES($1,'Synthetic','Fixture','fixture@example.invalid','not-a-login')",
        [user],
      );
      await source.query(`INSERT INTO public.salons
        (id,owner_id,name,slug,city,municipality,address,phone,email,short_description,description,image_url)
        VALUES($1,$2,'Synthetic','synthetic-transfer','Synthetic','Synthetic','Synthetic','000','fixture@example.invalid','Synthetic','Synthetic','')`,
      [salon, user]);
      await source.query("COMMIT");
    } finally { source.release(); }
    const { report } = await transfer(pair);
    assert.equal(report.status, "committed");
    const row = (await pair.target.query("SELECT payment_reference_number FROM public.salons WHERE id=$1", [salon])).rows[0];
    assert.equal(row.payment_reference_number, null, "synthetic payment-reference INSERT trigger must not fire");
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.synthetic_outbox")).rows[0].n, 0,
      "no outbox row may be created by a transfer");
    const target = report.tables.find(t => t.table === "public.salons");
    assert.equal(target?.sourceHash, target?.targetHash);
  });
});

test("transfer explicitly verifies standalone unique indexes and exclusion constraints", async () => {
  await withFixturePair(async pair => {
    for (const pool of [pair.source, pair.target]) {
      await pool.query(`CREATE TABLE public.constraint_fixture(id integer PRIMARY KEY,label text,span int4range);
        CREATE UNIQUE INDEX unique_fixture_label ON public.constraint_fixture(lower(label)) WHERE label IS NOT NULL;
        ALTER TABLE public.constraint_fixture ADD CONSTRAINT fixture_window_exclusion EXCLUDE USING gist (span WITH &&);`);
    }
    await pair.source.query("INSERT INTO public.constraint_fixture VALUES(1,'synthetic','[1,3)'),(2,'other','[4,6)')");
    const { report, targetStatements } = await transfer(pair);
    assert.equal(report.status, "committed");
    assert.ok(targetStatements.some(sql => /FROM pg_index/iu.test(sql)), "standalone unique indexes must be inventoried");
    assert.ok(targetStatements.some(sql => /row_tid<r.row_tid/iu.test(sql)), "exclusion pairs must be explicitly verified");
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.constraint_fixture")).rows[0].n, 2);
  });
});

test("standalone unique constraint rejection reports the observed row and rolls back", async () => {
  await withFixturePair(async pair => {
    for (const pool of [pair.source, pair.target]) {
      await pool.query("CREATE TABLE public.constraint_fixture(id integer PRIMARY KEY,label text)");
    }
    await pair.target.query("CREATE UNIQUE INDEX unique_fixture_label ON public.constraint_fixture(lower(label))");
    await pair.source.query("INSERT INTO public.constraint_fixture VALUES(1,'synthetic'),(2,'SYNTHETIC')");
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked");
    assert.ok(report.blockers.some(b => b.constraint === "unique_fixture_label" && b.count === 1));
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.constraint_fixture")).rows[0].n, 0);
  });
});

test("shared generated-column mismatch rolls back instead of silently recomputing data", async () => {
  await withFixturePair(async pair => {
    await pair.source.query("CREATE TABLE public.generated_fixture(id integer PRIMARY KEY,base integer,result integer GENERATED ALWAYS AS (base*2) STORED)");
    await pair.target.query("CREATE TABLE public.generated_fixture(id integer PRIMARY KEY,base integer,result integer GENERATED ALWAYS AS (base*3) STORED)");
    await pair.source.query("INSERT INTO public.generated_fixture(id,base) VALUES(1,7)");
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked");
    assert.ok(report.blockers.some(b => b.code === "CONTENT_MISMATCH" && b.table === "public.generated_fixture"));
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.generated_fixture")).rows[0].n, 0);
  });
});

test("target-only sequence default is blocked without advancing its sequence", async () => {
  await withFixturePair(async pair => {
    await pair.source.query("CREATE TABLE public.sequence_fixture(id integer PRIMARY KEY)");
    await pair.target.query("CREATE TABLE public.sequence_fixture(id integer PRIMARY KEY,generated_number bigserial)");
    await pair.source.query("INSERT INTO public.sequence_fixture VALUES(1)");
    const before = (await pair.target.query("SELECT last_value,is_called FROM public.sequence_fixture_generated_number_seq")).rows;
    const { report } = await transfer(pair);
    assert.equal(report.status, "blocked");
    assert.ok(report.blockers.some(b => b.table === "public.sequence_fixture" && b.column === "generated_number"));
    assert.deepEqual((await pair.target.query("SELECT last_value,is_called FROM public.sequence_fixture_generated_number_seq")).rows, before);
    assert.equal((await pair.target.query("SELECT count(*)::int AS n FROM public.sequence_fixture")).rows[0].n, 0);
  });
});