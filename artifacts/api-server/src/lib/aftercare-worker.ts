import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { brevoTransactionalEmailTransport, type TransactionalEmailTransport } from "./brevo";
import { deploymentPublicOrigin } from "./provider-events";
import { hashAftercareEntitlement, normalizeTreatmentTaxonomyKey } from "./aftercare-domain";
import { logger } from "./logger";

const DAY = 86_400_000;
const DEFAULT_BATCH = 50;
const LEASE_MS = 2 * 60_000;
/** Replenishment becomes actionable three days before expected depletion. */
export const AFTERCARE_REPLENISHMENT_APPROACH_DAYS = 3;

type WorkerOptions = {
  now?: Date;
  batchSize?: number;
  transport?: TransactionalEmailTransport;
  publicOrigin?: string | null;
  /** Test-only crash point; provider idempotency must make replay safe. */
  afterProviderAccepted?: () => void | Promise<void>;
};

function plusDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY);
}

/** Parameterized UUID[] expression; interpolation of a JS array is not an array bind. */
function uuidArray(values: string[]) {
  if (!values.length) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::uuid[]`;
}

function safeOrigin(explicit: string | null | undefined) {
  const candidate = explicit === undefined ? deploymentPublicOrigin() : explicit;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || url.pathname !== "/" || url.search || url.hash
      || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      || url.hostname.endsWith(".replit.dev")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function processAftercareCompletionEvents(options: WorkerOptions = {}) {
  const now = options.now ?? new Date();
  let processed = 0;
  for (let attempt = 0; attempt < (options.batchSize ?? DEFAULT_BATCH); attempt += 1) {
    const handled = await db.transaction(async (tx) => {
      const claimed = await tx.execute<{
        id: string; appointment_id: string; customer_user_id: string | null; completed_at: Date;
      }>(sql`
        SELECT e.id, e.appointment_id, COALESCE(
          CASE WHEN direct.role::text IN ('CUSTOMER','JOBSEEKER') AND direct.active THEN direct.id END,
          CASE WHEN linked.role::text IN ('CUSTOMER','JOBSEEKER') AND linked.active THEN linked.id END
        ) customer_user_id, e.completed_at
        FROM aftercare_completion_events e
        JOIN appointments a ON a.id=e.appointment_id
        LEFT JOIN users direct ON direct.id=a.customer_id
        LEFT JOIN salon_customers sc ON sc.id=a.salon_customer_id
        LEFT JOIN users linked ON linked.id=sc.user_id
        WHERE e.processed_at IS NULL AND e.available_at <= ${now}
          AND e.attempts < 5
          AND (e.claim_expires_at IS NULL OR e.claim_expires_at < ${now})
        ORDER BY e.available_at, e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1
      `);
      const event = claimed.rows[0];
      if (!event) return false;
      await tx.execute(sql`UPDATE aftercare_completion_events SET attempts=attempts+1 WHERE id=${event.id}`);
      if (!event.customer_user_id) {
        await tx.execute(sql`UPDATE aftercare_completion_events SET processed_at=${now}, last_error='unlinked_customer' WHERE id=${event.id}`);
        return true;
      }
      const context = await tx.execute<{
        appointment_id: string; category_name: string; service_name: string; tags: string[];
        package_treatments: number | null; appointment_date: string;
      }>(sql`
        SELECT a.id appointment_id, s.category_name, s.name service_name, s.tags,
               s.package_treatments, a.appointment_date
        FROM appointments a JOIN services s ON s.id=a.service_id
        WHERE a.status='completed' AND (
          a.customer_id=${event.customer_user_id} OR EXISTS (
            SELECT 1 FROM salon_customers sc
            WHERE sc.id=a.salon_customer_id AND sc.user_id=${event.customer_user_id}
          )
        )
        AND a.appointment_date >= (${now}::date - (
          SELECT combination_window_days FROM aftercare_settings WHERE is_current LIMIT 1
        ))
        ORDER BY a.appointment_date, a.id
      `);
      if (!context.rows.length) {
        await tx.execute(sql`UPDATE aftercare_completion_events SET processed_at=${now}, last_error='no_completed_treatment' WHERE id=${event.id}`);
        return true;
      }
      const settingsResult = await tx.execute<{
        version: number; first_timing: "IMMEDIATE_AFTER_COMPLETION" | "NEXT_DAY"; cooldown_days: number;
        second_reminder_delay_days: number; post_treatment_discount_enabled: boolean;
        post_treatment_discount_percent: number; post_treatment_discount_validity_days: number;
        personalized_bundle_discount_percent: number; combination_window_days: number;
      }>(sql`SELECT * FROM aftercare_settings WHERE is_current LIMIT 1 FOR SHARE`);
      const settings = settingsResult.rows[0];
      if (!settings) throw new Error("Current aftercare settings are missing.");
      const treatmentIds: string[] = [];
      const treatmentSnapshot: Array<{ id: string; key: string; category: string; name: string }> = [];
      for (const row of context.rows) {
        const key = normalizeTreatmentTaxonomyKey(row.category_name, row.service_name);
        const terms = [...new Set([row.category_name, row.service_name, ...(row.tags ?? []),
          row.package_treatments ? `${row.package_treatments} tretmana` : ""] .filter(Boolean))];
        const taxonomy = await tx.execute<{ id: string }>(sql`
          INSERT INTO treatment_taxonomy (taxonomy_key, category_name, treatment_name, search_terms)
          VALUES (${key}, ${row.category_name}, ${row.service_name}, ${JSON.stringify(terms)}::jsonb)
          ON CONFLICT (taxonomy_key) DO UPDATE SET category_name=EXCLUDED.category_name,
            treatment_name=EXCLUDED.treatment_name, search_terms=EXCLUDED.search_terms, updated_at=now()
          RETURNING id
        `);
        const id = taxonomy.rows[0]!.id;
        if (!treatmentIds.includes(id)) {
          treatmentIds.push(id);
          treatmentSnapshot.push({ id, key, category: row.category_name, name: row.service_name });
        }
      }
      // One active campaign per customer/window. The advisory xact lock closes
      // the race between different appointment events for the same customer.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`aftercare:${event.customer_user_id}`}))`);
      const existing = await tx.execute<{ id: string }>(sql`
        SELECT id FROM aftercare_recommendations
        WHERE customer_user_id=${event.customer_user_id}
          AND status IN ('PENDING','ACTIVE') AND window_ends_at > ${now}
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE
      `);
      if (existing.rows[0]) {
        for (const row of context.rows) {
          const treatment = treatmentSnapshot.find((value) =>
            value.key === normalizeTreatmentTaxonomyKey(row.category_name, row.service_name))!;
          await tx.execute(sql`
            INSERT INTO aftercare_recommendation_appointments
              (recommendation_id, appointment_id, treatment_id, appointment_snapshot)
            VALUES (${existing.rows[0].id}, ${row.appointment_id}, ${treatment.id},
              ${JSON.stringify({ date: row.appointment_date, treatmentKey: treatment.key })}::jsonb)
            ON CONFLICT (appointment_id) DO NOTHING
          `);
        }
        await tx.execute(sql`UPDATE aftercare_completion_events SET processed_at=${now}, claim_token=NULL, claim_expires_at=NULL WHERE id=${event.id}`);
        return true;
      }
      const products = await tx.execute<{
        id: string; name: string; public_price: number; public_discount_price: number | null;
        average_duration_days: number | null;
      }>(sql`
        SELECT DISTINCT p.id, p.name, p.public_price, p.public_discount_price, p.average_duration_days
        FROM products p JOIN product_treatment_mappings m ON m.product_id=p.id
        WHERE m.treatment_id = ANY(${uuidArray(treatmentIds)}) AND p.active AND p.retail_enabled
          AND p.public_price IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM retail_order_items oi JOIN retail_orders o ON o.id=oi.order_id
            WHERE o.user_id=${event.customer_user_id} AND oi.product_id=p.id
              AND o.status='delivered'
              AND (o.payment_status='paid' OR (o.payment_status='unpaid' AND o.payment_method='CASH_ON_DELIVERY'))
              AND o.created_at >= ${plusDays(now, -settings.cooldown_days)}
          )
      `);
      if (!products.rows.length) {
        await tx.execute(sql`UPDATE aftercare_completion_events SET processed_at=${now}, last_error='cooldown_or_no_products' WHERE id=${event.id}`);
        return true;
      }
      const bundle = await tx.execute<{ id: string; name: string; b2c_price: number }>(sql`
        SELECT DISTINCT b.id, b.name, b.b2c_price FROM product_bundles b
        WHERE b.linked_treatment_id = ANY(${uuidArray(treatmentIds)})
          AND b.active AND b.market IN ('B2C','BOTH') AND b.b2c_price IS NOT NULL
        ORDER BY b.id LIMIT 1
      `);
      const activation = settings.first_timing === "NEXT_DAY"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 8))
        : now;
      const token = randomBytes(32).toString("base64url");
      const recommendation = await tx.execute<{ id: string }>(sql`
        INSERT INTO aftercare_recommendations
          (customer_user_id, settings_version, status, entitlement_token_hash,
           window_started_at, window_ends_at, activates_at, entitlement_expires_at,
           settings_snapshot, treatment_snapshot)
        VALUES (${event.customer_user_id}, ${settings.version}, 'PENDING', ${hashAftercareEntitlement(token)},
          ${plusDays(now, -settings.combination_window_days)}, ${plusDays(now, settings.combination_window_days)},
          ${activation}, ${plusDays(activation, settings.post_treatment_discount_validity_days)},
          ${JSON.stringify(settings)}::jsonb, ${JSON.stringify(treatmentSnapshot)}::jsonb)
        RETURNING id
      `);
      const recommendationId = recommendation.rows[0]!.id;
      for (const row of context.rows) {
        const treatment = treatmentSnapshot.find((value) =>
          value.key === normalizeTreatmentTaxonomyKey(row.category_name, row.service_name))!;
        await tx.execute(sql`
          INSERT INTO aftercare_recommendation_appointments
            (recommendation_id, appointment_id, treatment_id, appointment_snapshot)
          VALUES (${recommendationId}, ${row.appointment_id}, ${treatment.id},
            ${JSON.stringify({ date: row.appointment_date, treatmentKey: treatment.key })}::jsonb)
          ON CONFLICT (appointment_id) DO NOTHING
        `);
      }
      const coveredIds = products.rows.map((product) => product.id);
      const selectedBundle = bundle.rows[0];
      if (selectedBundle) {
        await tx.execute(sql`
          INSERT INTO aftercare_recommendation_lines
            (recommendation_id, kind, bundle_id, treatment_ids, covered_product_ids,
             catalog_snapshot, pricing_snapshot, discount_kind, discount_percent)
          VALUES (${recommendationId}, 'PREMADE_BUNDLE', ${selectedBundle.id},
            ${JSON.stringify(treatmentIds)}::jsonb, ${JSON.stringify(coveredIds)}::jsonb,
            ${JSON.stringify({ id: selectedBundle.id, name: selectedBundle.name })}::jsonb,
            ${JSON.stringify({ fixedBundlePriceRsd: selectedBundle.b2c_price })}::jsonb,
             ${settings.post_treatment_discount_enabled && settings.post_treatment_discount_percent > 0
               ? "POST_TREATMENT_RECOMMENDATION_DISCOUNT" : "FIXED_BUNDLE_PRICE"},
             ${settings.post_treatment_discount_enabled ? settings.post_treatment_discount_percent : 0})
        `);
      } else {
        const personalized = products.rows.length > 1;
        await tx.execute(sql`
          INSERT INTO aftercare_recommendation_lines
            (recommendation_id, kind, product_id, treatment_ids, covered_product_ids,
             catalog_snapshot, pricing_snapshot, discount_kind, discount_percent, replenishment_due_at)
          VALUES (${recommendationId}, ${personalized ? "PERSONALIZED_BUNDLE" : "PRODUCT"},
            ${personalized ? null : products.rows[0]!.id}, ${JSON.stringify(treatmentIds)}::jsonb,
            ${JSON.stringify(coveredIds)}::jsonb, ${JSON.stringify({ products: products.rows })}::jsonb,
            ${JSON.stringify({ products: products.rows.map(p => ({ id: p.id, priceRsd: p.public_discount_price ?? p.public_price })) })}::jsonb,
            ${personalized ? "PERSONALIZED_TREATMENT_BUNDLE_DISCOUNT" : "POST_TREATMENT_RECOMMENDATION_DISCOUNT"},
            ${personalized ? settings.personalized_bundle_discount_percent
              : (settings.post_treatment_discount_enabled ? settings.post_treatment_discount_percent : 0)},
            NULL)
        `);
      }
      await tx.execute(sql`
        INSERT INTO aftercare_deliveries
          (recommendation_id, kind, event_key, scheduled_at, payload_snapshot)
        VALUES (${recommendationId}, 'FIRST', ${`aftercare:${recommendationId}:first`}, ${activation},
          ${JSON.stringify({ href: `/moj-nalog/nega-posle-tretmana?recommendationId=${encodeURIComponent(recommendationId)}`, treatments: treatmentSnapshot })}::jsonb)
      `);
      await tx.execute(sql`UPDATE aftercare_completion_events SET processed_at=${now}, claim_token=NULL, claim_expires_at=NULL WHERE id=${event.id}`);
      return true;
    });
    if (!handled) break;
    processed += 1;
  }
  return { processed };
}

export async function reconcileAftercareConversions(now = new Date()) {
  await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (l.id) l.id line_id, o.id order_id, o.created_at,
        p.average_duration_days
      FROM aftercare_recommendation_lines l
      JOIN retail_orders o ON true
      JOIN aftercare_recommendations r ON r.id=l.recommendation_id AND r.customer_user_id=o.user_id
      JOIN retail_order_items oi ON oi.order_id=o.id
      LEFT JOIN products p ON p.id=oi.product_id
      WHERE o.status='delivered'
        AND (o.payment_status='paid' OR (o.payment_status='unpaid' AND o.payment_method='CASH_ON_DELIVERY'))
        AND oi.aftercare_recommendation_id=r.id
        AND (oi.product_id::text IN (SELECT jsonb_array_elements_text(l.covered_product_ids))
          OR oi.bundle_id=l.bundle_id)
      ORDER BY l.id, o.created_at DESC, o.id DESC
    )
    UPDATE aftercare_recommendation_lines l SET purchased_at=x.created_at, purchased_order_id=x.order_id,
      replenishment_due_at=CASE WHEN x.average_duration_days IS NULL THEN NULL
        ELSE x.created_at + (x.average_duration_days * interval '1 day') END,
      replenishment_sent_at=CASE WHEN l.purchased_at IS DISTINCT FROM x.created_at THEN NULL ELSE l.replenishment_sent_at END
    FROM latest x WHERE l.id=x.line_id AND (l.purchased_at IS NULL OR l.purchased_at < x.created_at)
  `);
  // A cancellation/refund invalidates attribution when no other settled
  // matching purchase remains. Recommendation evidence snapshots stay intact.
  await db.execute(sql`
    UPDATE aftercare_recommendation_lines l SET purchased_at=NULL, purchased_order_id=NULL,
      replenishment_due_at=NULL, replenishment_sent_at=NULL
    FROM aftercare_recommendations r
    WHERE r.id=l.recommendation_id AND l.purchased_order_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM retail_orders o JOIN retail_order_items oi ON oi.order_id=o.id
        WHERE o.user_id=r.customer_user_id AND oi.aftercare_recommendation_id=r.id AND o.status='delivered'
          AND (o.payment_status='paid' OR (o.payment_status='unpaid' AND o.payment_method='CASH_ON_DELIVERY'))
          AND (oi.product_id::text IN (SELECT jsonb_array_elements_text(l.covered_product_ids))
            OR oi.bundle_id=l.bundle_id)
      )
  `);
  await db.execute(sql`
    UPDATE aftercare_recommendations r
    SET status=CASE WHEN r.first_sent_at IS NULL THEN 'PENDING'::aftercare_recommendation_status
                    ELSE 'ACTIVE'::aftercare_recommendation_status END,
        converted_at=NULL, converted_order_id=NULL, updated_at=${now}
    WHERE r.status='CONVERTED' AND NOT EXISTS (
      SELECT 1 FROM aftercare_recommendation_lines l
      JOIN retail_orders o ON o.user_id=r.customer_user_id
      JOIN retail_order_items oi ON oi.order_id=o.id
        WHERE l.recommendation_id=r.id AND oi.aftercare_recommendation_id=r.id AND o.status='delivered'
        AND (o.payment_status='paid' OR (o.payment_status='unpaid' AND o.payment_method='CASH_ON_DELIVERY'))
        AND o.created_at >= r.created_at AND oi.aftercare_recommendation_id=r.id
        AND (oi.product_id::text IN (SELECT jsonb_array_elements_text(l.covered_product_ids))
          OR oi.bundle_id=l.bundle_id)
    )
  `);
  // A newer purchase gets a new depletion date. Never let an already queued
  // replenishment for the superseded date escape on a later delivery pass.
  await db.execute(sql`
    UPDATE aftercare_deliveries d SET status='SKIPPED', last_error='superseded_purchase',
      claim_token=NULL, claim_expires_at=NULL, updated_at=${now}
    FROM aftercare_recommendation_lines l
    WHERE l.id=d.line_id AND d.kind='REPLENISHMENT' AND d.status IN ('QUEUED','FAILED')
      AND (l.replenishment_due_at IS NULL OR
        d.event_key <> 'aftercare:' || l.id || ':replenishment:' || l.replenishment_due_at::date)
  `);
  const converted = await db.execute<{ recommendation_id: string }>(sql`
    WITH matches AS (
      SELECT DISTINCT r.id recommendation_id, o.id order_id
      FROM aftercare_recommendations r
      JOIN aftercare_recommendation_lines l ON l.recommendation_id=r.id
      JOIN retail_orders o ON o.user_id=r.customer_user_id
      JOIN retail_order_items oi ON oi.order_id=o.id
      WHERE r.status IN ('PENDING','ACTIVE') AND o.status='delivered'
        AND oi.aftercare_recommendation_id=r.id
        AND (o.payment_status='paid' OR (o.payment_status='unpaid' AND o.payment_method='CASH_ON_DELIVERY'))
        AND o.created_at >= r.created_at
        AND (oi.product_id::text IN (SELECT jsonb_array_elements_text(l.covered_product_ids))
          OR oi.bundle_id=l.bundle_id)
    )
    UPDATE aftercare_recommendations r SET status='CONVERTED', converted_at=${now},
      converted_order_id=m.order_id, updated_at=${now}
    FROM matches m WHERE r.id=m.recommendation_id
    RETURNING r.id recommendation_id
  `);
  return { converted: converted.rows.length };
}

export async function scheduleAftercareFollowups(now = new Date(), batchSize = DEFAULT_BATCH) {
  const second = await db.execute(sql`
    INSERT INTO aftercare_deliveries (recommendation_id, kind, event_key, scheduled_at, payload_snapshot)
    SELECT r.id, 'SECOND', 'aftercare:' || r.id || ':second', ${now},
      jsonb_build_object('href', '/moj-nalog/nega-posle-tretmana?recommendationId=' || r.id)
    FROM aftercare_recommendations r
    WHERE r.status IN ('PENDING','ACTIVE') AND r.first_sent_at IS NOT NULL AND r.read_at IS NULL
      AND r.second_sent_at IS NULL
      AND r.first_sent_at + ((r.settings_snapshot->>'second_reminder_delay_days')::int * interval '1 day') <= ${now}
    ORDER BY r.first_sent_at LIMIT ${batchSize}
    ON CONFLICT (event_key) DO NOTHING
  `);
  const replenishment = await db.execute(sql`
    INSERT INTO aftercare_deliveries (recommendation_id, line_id, kind, event_key, scheduled_at, payload_snapshot)
    SELECT r.id, l.id, 'REPLENISHMENT', 'aftercare:' || l.id || ':replenishment:' || l.replenishment_due_at::date,
      ${now}, jsonb_build_object('href', '/moj-nalog/nega-posle-tretmana?recommendationId=' || r.id)
    FROM aftercare_recommendation_lines l JOIN aftercare_recommendations r ON r.id=l.recommendation_id
    WHERE l.replenishment_due_at IS NOT NULL AND l.replenishment_sent_at IS NULL
      AND l.replenishment_due_at <= ${plusDays(now, AFTERCARE_REPLENISHMENT_APPROACH_DAYS)}
      AND l.purchased_at IS NOT NULL
    ORDER BY l.replenishment_due_at LIMIT ${batchSize}
    ON CONFLICT (recommendation_id, line_id, kind) WHERE line_id IS NOT NULL
    DO UPDATE SET event_key=EXCLUDED.event_key, scheduled_at=EXCLUDED.scheduled_at,
      payload_snapshot=EXCLUDED.payload_snapshot, status='QUEUED', attempts=0,
      claim_token=NULL, claim_expires_at=NULL, provider_message_id=NULL,
      provider_status=NULL, provider_event_at=NULL, accepted_at=NULL, sent_at=NULL,
      last_error=NULL, updated_at=${now}
  `);
  return { secondQueued: second.rowCount ?? 0, replenishmentQueued: replenishment.rowCount ?? 0 };
}

export async function reconcileAftercareProviderEvent(input: {
  providerMessageId: string;
  providerStatus: string;
  eventAt: Date;
}) {
  const updated = await db.execute<{ id: string }>(sql`
    UPDATE aftercare_deliveries SET provider_status=${input.providerStatus},
      provider_event_at=${input.eventAt}, updated_at=now()
    WHERE provider_message_id=${input.providerMessageId}
      AND (provider_event_at IS NULL OR provider_event_at <= ${input.eventAt})
    RETURNING id
  `);
  return { reconciled: updated.rows.length };
}

export async function cleanupAftercareWorkerRows(now = new Date(), batchSize = DEFAULT_BATCH) {
  const events = await db.execute(sql`
    DELETE FROM aftercare_completion_events WHERE id IN (
      SELECT id FROM aftercare_completion_events
      WHERE processed_at < ${plusDays(now, -180)}
      ORDER BY processed_at LIMIT ${batchSize}
    )
  `);
  const deliveries = await db.execute(sql`
    DELETE FROM aftercare_deliveries WHERE id IN (
      SELECT id FROM aftercare_deliveries
      WHERE status IN ('SKIPPED','FAILED') AND updated_at < ${plusDays(now, -180)}
      ORDER BY updated_at LIMIT ${batchSize}
    )
  `);
  return { eventsDeleted: events.rowCount ?? 0, deliveriesDeleted: deliveries.rowCount ?? 0 };
}

export async function deliverAftercareEmails(options: WorkerOptions = {}) {
  const transport = options.transport ?? brevoTransactionalEmailTransport;
  const now = options.now ?? new Date();
  const origin = safeOrigin(options.publicOrigin);
  let sent = 0;
  let skipped = 0;
  for (let index = 0; index < (options.batchSize ?? DEFAULT_BATCH); index += 1) {
    const claimToken = randomBytes(16).toString("hex");
    const claimed = await db.execute<{
      id: string; recommendation_id: string; line_id: string | null; kind: string; event_key: string;
      payload_snapshot: Record<string, unknown>; email: string; first_name: string; last_name: string;
    }>(sql`
      UPDATE aftercare_deliveries d SET status='PROCESSING', claim_token=${claimToken},
        claim_expires_at=${new Date(now.getTime() + LEASE_MS)}, attempts=attempts+1, updated_at=${now}
      FROM aftercare_recommendations r JOIN users u ON u.id=r.customer_user_id
      WHERE d.id=(SELECT id FROM aftercare_deliveries WHERE (
          status IN ('QUEUED','FAILED') OR (status='PROCESSING' AND claim_expires_at < ${now})
        )
        AND attempts < 5
        AND scheduled_at <= ${now} AND (claim_expires_at IS NULL OR claim_expires_at < ${now})
        ORDER BY scheduled_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
        AND r.id=d.recommendation_id
      RETURNING d.id,d.recommendation_id,d.line_id,d.kind,d.event_key,d.payload_snapshot,
        u.email,u.first_name,u.last_name
    `);
    const delivery = claimed.rows[0];
    if (!delivery) break;
    if (!origin) {
      await db.execute(sql`UPDATE aftercare_deliveries SET status='SKIPPED', last_error='invalid_public_origin',
        claim_token=NULL, claim_expires_at=NULL, updated_at=${now} WHERE id=${delivery.id} AND claim_token=${claimToken}`);
      skipped += 1;
      continue;
    }
    // A recommendation may be read or converted after this worker claimed its
    // reminder. Revalidate the claim immediately before the irreversible send.
    if (delivery.kind === "SECOND") {
      const eligible = await db.execute(sql`
        UPDATE aftercare_deliveries d SET status='SKIPPED', last_error='second_reminder_no_longer_eligible',
          claim_token=NULL, claim_expires_at=NULL, updated_at=${now}
        FROM aftercare_recommendations r
        WHERE d.id=${delivery.id} AND d.claim_token=${claimToken} AND r.id=d.recommendation_id
          AND (r.read_at IS NOT NULL OR r.converted_at IS NOT NULL OR r.converted_order_id IS NOT NULL
            OR r.second_sent_at IS NOT NULL)
        RETURNING d.id`);
      if (eligible.rows.length) { skipped += 1; continue; }
    }
    const href = `${origin}${String(delivery.payload_snapshot.href ?? `/moj-nalog/nega-posle-tretmana?recommendationId=${encodeURIComponent(delivery.recommendation_id)}`)}`;
    try {
      const result = await transport.send({
        idempotencyKey: delivery.id,
        to: { email: delivery.email, name: `${delivery.first_name} ${delivery.last_name}`.trim() },
        subject: delivery.kind === "FIRST" ? "Nega posle tretmana" : "Podsetnik za negu",
        htmlContent: `<p>Vaša personalizovana preporuka je spremna.</p><p><a href="${href}">Pogledajte preporuku</a></p>`,
      });
      if ("skipped" in result) throw new Error(result.errorMessage);
      await options.afterProviderAccepted?.();
      await db.execute(sql`UPDATE aftercare_deliveries SET status='SENT', provider_message_id=${result.messageId ?? null},
        accepted_at=${now}, sent_at=${now}, claim_token=NULL, claim_expires_at=NULL, last_error=NULL, updated_at=${now}
        WHERE id=${delivery.id} AND claim_token=${claimToken}`);
      await db.execute(sql`UPDATE aftercare_recommendations SET status='ACTIVE',
        first_sent_at=CASE WHEN ${delivery.kind}='FIRST' THEN COALESCE(first_sent_at,${now}) ELSE first_sent_at END,
        second_sent_at=CASE WHEN ${delivery.kind}='SECOND' THEN COALESCE(second_sent_at,${now}) ELSE second_sent_at END,
        updated_at=${now} WHERE id=${delivery.recommendation_id}`);
      if (delivery.kind === "REPLENISHMENT" && delivery.line_id) {
        await db.execute(sql`UPDATE aftercare_recommendation_lines SET replenishment_sent_at=${now} WHERE id=${delivery.line_id}`);
      }
      sent += 1;
    } catch (error) {
      await db.execute(sql`UPDATE aftercare_deliveries SET status='FAILED', last_error=${error instanceof Error ? error.message.slice(0, 500) : "delivery_failed"},
        claim_token=NULL, claim_expires_at=NULL, updated_at=${now} WHERE id=${delivery.id} AND claim_token=${claimToken}`);
    }
  }
  return { sent, skipped };
}

export async function runAftercareWorker(options: WorkerOptions = {}) {
  const now = options.now ?? new Date();
  const events = await processAftercareCompletionEvents({ ...options, now });
  const conversions = await reconcileAftercareConversions(now);
  const scheduled = await scheduleAftercareFollowups(now, options.batchSize);
  const deliveries = await deliverAftercareEmails({ ...options, now });
  const cleanup = await cleanupAftercareWorkerRows(now, options.batchSize);
  logger.info({ ...events, ...conversions, ...scheduled, ...deliveries, ...cleanup }, "Aftercare worker completed");
  return { ...events, ...conversions, ...scheduled, ...deliveries, ...cleanup };
}