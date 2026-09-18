import assert from "node:assert/strict";
import type pg from "pg";

export type Pool = pg.Pool;
export type Queryable = Pick<Pool, "query">;

export interface PlanFixture {
  userA: string;
  userB: string;
  salonA: string;
  salonB: string;
  centerA: string;
  centerB: string;
  sharedPlan: string;
  salonOnlyPlan: string;
  educationPlan: string;
  pendingPlan: string;
}

export async function canonical(pool: Pool): Promise<void> {
  const { loadMigrations } = await import("../migrations/files");
  const [migration] = await loadMigrations();
  assert.equal(migration?.id, "000001");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration!.body);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rowId(pool: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  const result = await pool.query<{ id: string }>(sql, params);
  assert.equal(result.rows.length, 1);
  return result.rows[0]!.id;
}

export async function createPlan(
  pool: Queryable,
  name: string,
  options: Partial<{
    price: number; limits: Record<string, unknown>; audience: string; courseLimit: number | null;
    active: boolean; trialDays: number; vatIncluded: boolean; priceCopy: string | null;
  }> = {},
): Promise<string> {
  return rowId(pool, `INSERT INTO public.subscription_plans
    (name,price,trial_days,features,limits,audience,course_limit,vat_included,price_copy,active)
    VALUES ($1,$2,0,'[]'::jsonb,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      name, options.price ?? 1000, JSON.stringify(options.limits ?? {}),
      options.audience ?? "salon", options.courseLimit ?? null,
      options.vatIncluded ?? false, options.priceCopy ?? null, options.active ?? true,
    ]);
}

export async function createPlanFixture(pool: Queryable): Promise<PlanFixture> {
  const userA = await rowId(pool, `INSERT INTO public.users
    (first_name,last_name,email,password_hash) VALUES ('Tenant','A',$1,'fixture') RETURNING id`,
    [`plan-a-${Date.now()}@fixture.invalid`]);
  const userB = await rowId(pool, `INSERT INTO public.users
    (first_name,last_name,email,password_hash) VALUES ('Tenant','B',$1,'fixture') RETURNING id`,
    [`plan-b-${Date.now()}@fixture.invalid`]);
  const salonA = await rowId(pool, `INSERT INTO public.salons
    (owner_id,name,slug,city,municipality,address,phone,email,short_description,description,image_url)
    VALUES ($1,'Salon A','plan-salon-a','Beograd','Stari Grad','A 1','+381600000001',$2,'A','A','/a')
    RETURNING id`, [userA, `salon-a-${Date.now()}@fixture.invalid`]);
  const salonB = await rowId(pool, `INSERT INTO public.salons
    (owner_id,name,slug,city,municipality,address,phone,email,short_description,description,image_url)
    VALUES ($1,'Salon B','plan-salon-b','Novi Sad','Centar','B 1','+381600000002',$2,'B','B','/b')
    RETURNING id`, [userB, `salon-b-${Date.now()}@fixture.invalid`]);
  const centerA = await rowId(pool, `INSERT INTO public.education_centers
    (owner_id,name,city,description,image_url) VALUES ($1,'Center A','Beograd','A','/a') RETURNING id`, [userA]);
  const centerB = await rowId(pool, `INSERT INTO public.education_centers
    (owner_id,name,city,description,image_url) VALUES ($1,'Center B','Novi Sad','B','/b') RETURNING id`, [userB]);
  const sharedPlan = await createPlan(pool, "Shared legacy plan", { limits: { courses: 20 } });
  const salonOnlyPlan = await createPlan(pool, "Salon-only plan", { price: 2000 });
  const educationPlan = await createPlan(pool, "Education custom", {
    price: 0, audience: "education", active: true, limits: {}, courseLimit: null,
  });
  const pendingPlan = await createPlan(pool, "Pending education plan", {
    audience: "education", courseLimit: 30, limits: { courses: 30 },
  });
  await pool.query(`INSERT INTO public.subscriptions (salon_id,plan_id,due_amount)
    VALUES ($1,$2,1000)`, [salonA, sharedPlan]);
  await pool.query(`INSERT INTO public.education_center_subscriptions
    (center_id,plan_id,pending_plan_id,status,due_amount)
    VALUES ($1,$2,$3,'active',1000)`, [centerA, sharedPlan, pendingPlan]);
  await pool.query(`INSERT INTO public.education_center_subscriptions
    (center_id,plan_id,status,due_amount)
    VALUES ($1,$2,'cancelled',0)`, [centerB, educationPlan]);
  await pool.query(`INSERT INTO public.education_payment_obligations
    (center_id,plan_id_snapshot,kind,expected_amount,recipient_name_snapshot,
     recipient_account_snapshot,payment_code_snapshot,purpose_snapshot,reference_snapshot)
    VALUES ($1,$2,'subscription_renewal',1000,'Fixture','123456789012345678','221','Plan','fixture-ref-a')`,
    [centerA, sharedPlan]);
  return { userA, userB, salonA, salonB, centerA, centerB, sharedPlan, salonOnlyPlan, educationPlan, pendingPlan };
}

export async function snapshot(pool: Queryable): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const table of ["subscription_plans", "subscriptions", "education_center_subscriptions", "education_payment_obligations"]) {
    result[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM public."${table}" t ORDER BY to_jsonb(t)::text`))
      .rows.map((row) => row.row);
  }
  return result;
}