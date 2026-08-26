import { pool } from "@workspace/db";

/**
 * Additive rollout guard for columns/enums introduced by referral redemption.
 * Referral tables themselves are owned by the Drizzle schema and are created by
 * the normal database rollout; these statements make mixed-version deploys safe
 * when an API instance starts before all old order rows have been backfilled.
 */
export async function ensureReferralSchema(schemaName = "public"): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) throw new Error("Invalid schema name.");
  const schema = `"${schemaName}"`;
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", ["lumera:referral-schema"]);
    await client.query("begin");
    await client.query(`alter table ${schema}.orders add column if not exists referral_credit_applied_rsd integer not null default 0`);
    await client.query(`alter table ${schema}.orders add column if not exists referral_credit_restored_at timestamptz`);
    await client.query(`alter table ${schema}.retail_orders add column if not exists referral_credit_applied_rsd integer not null default 0`);
    await client.query(`alter table ${schema}.retail_orders add column if not exists referral_credit_restored_at timestamptz`);
    await client.query(`alter table ${schema}.referral_qualifications add column if not exists tracking_started_at timestamptz`);
    await client.query(`alter table ${schema}.referral_milestone_benefits add column if not exists neutralized_at timestamptz`);
    await client.query(`alter table ${schema}.referral_milestone_benefits add column if not exists neutralized_by_user_id uuid references ${schema}.users(id) on delete set null`);
    await client.query(`alter table ${schema}.referral_milestone_benefits add column if not exists neutralization_reason text`);
    // Preserve already-unlocked A/B1 windows during a mixed-version rollout.
    // Prefer the immutable approval audit and use the qualification transition
    // timestamp only for legacy approvals that predate legal-entity auditing.
    await client.query(`
      update ${schema}.referral_qualifications q
      set tracking_started_at = coalesce(
        (select min(a.created_at)
         from ${schema}.business_verification_audits a
         where a.next_status = 'verified'
           and a.evidence->>'referralAttributionId' = q.attribution_id::text),
        q.updated_at
      )
      from ${schema}.referral_attributions r
      where r.id = q.attribution_id
        and r.channel in ('A', 'B1')
        and q.status <> 'pending_verification'
        and q.tracking_started_at is null
    `);
    // PostgreSQL has no IF NOT EXISTS for enum values on old supported versions.
    await client.query(`
      do $$ begin
        alter type ${schema}.sms_message_type add value 'referral';
      exception when duplicate_object then null;
      end $$;
    `);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", ["lumera:referral-schema"]).catch(() => {});
    client.release();
  }
}