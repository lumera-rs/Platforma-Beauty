/**
 * Provider webhook endpoints — Brevo (email) and Infobip (SMS) delivery events.
 *
 * These are the ONLY unauthenticated-session routes that mutate delivery
 * state, so they authenticate the caller with a shared-secret capability
 * token embedded in the webhook path (registered at the provider by the
 * administrator). See ../lib/provider-events.ts for the full security and
 * idempotency model.
 *
 *   POST /api/webhooks/brevo/:token    — Brevo transactional email events
 *   POST /api/webhooks/infobip/:token  — Infobip SMS delivery reports
 *
 * Responses:
 *   401 — invalid token (timing-safe comparison failed)
 *   503 — no webhook secret configured (events are never accepted open)
 *   400 — authenticated but malformed payload
 *   200 — processed; body reports per-event accounting so providers see
 *         success (and never retry-storm) while replays remain no-ops
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  applyBrevoEvents,
  applyInfobipReports,
  isBrevoVerificationBatch,
  isInfobipVerificationBatch,
  parseBrevoWebhookBody,
  parseInfobipWebhookBody,
  recordWebhookReceipt,
  resolveWebhookSecret,
  webhookTokenMatches,
  type DeliveryReportProvider,
  type WebhookProvider,
  type WebhookSummary,
} from "../lib/provider-events";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Track the last accepted verified event batch per provider (admin freshness
 * monitoring). Non-fatal by design: a tracking failure must never change the
 * webhook response semantics (the events themselves were already applied).
 */
async function trackWebhookReceipt(provider: DeliveryReportProvider, summary: WebhookSummary): Promise<void> {
  if (summary.processed === 0) return;
  try {
    await recordWebhookReceipt(provider);
  } catch (err) {
    logger.warn({ provider, err }, "failed to record webhook receipt timestamp");
  }
}

/**
 * Verify the path token against the configured secret. Returns true when the
 * request may proceed; otherwise the response has already been sent.
 */
async function verifyWebhookToken(provider: WebhookProvider, req: Request, res: Response): Promise<boolean> {
  const secret = await resolveWebhookSecret(provider);
  if (!secret) {
    res.status(503).json({ error: "Webhook nije konfigurisan.", code: "WEBHOOK_NOT_CONFIGURED" });
    return false;
  }
  const rawToken = req.params["token"];
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!token || !webhookTokenMatches(secret, token)) {
    res.status(401).json({ error: "Nevažeći webhook token.", code: "UNAUTHORIZED" });
    return false;
  }
  return true;
}

router.post("/webhooks/brevo/:token", async (req, res, next) => {
  try {
    if (!(await verifyWebhookToken("brevo", req, res))) return;
    const events = parseBrevoWebhookBody(req.body);
    if (!events) {
      res.status(400).json({ error: "Nevažeći format Brevo događaja.", code: "INVALID_PAYLOAD" });
      return;
    }
    const summary = await applyBrevoEvents(events);
    // Admin self-check batches prove endpoint+secret health, not provider
    // activity — they must never refresh delivery-report freshness.
    const verificationOnly = isBrevoVerificationBatch(events);
    if (!verificationOnly) await trackWebhookReceipt("brevo", summary);
    logger.info({ provider: "brevo", verificationOnly, ...summary }, "provider webhook processed");
    res.json(summary);
  } catch (err) { next(err); }
});

router.post("/webhooks/infobip/:token", async (req, res, next) => {
  try {
    if (!(await verifyWebhookToken("sms", req, res))) return;
    const reports = parseInfobipWebhookBody(req.body);
    if (!reports) {
      res.status(400).json({ error: "Nevažeći format Infobip izveštaja.", code: "INVALID_PAYLOAD" });
      return;
    }
    const summary = await applyInfobipReports(reports);
    // Admin self-check batches prove endpoint+secret health, not provider
    // activity — they must never refresh delivery-report freshness.
    const verificationOnly = isInfobipVerificationBatch(reports);
    if (!verificationOnly) await trackWebhookReceipt("infobip", summary);
    logger.info({ provider: "infobip", verificationOnly, ...summary }, "provider webhook processed");
    res.json(summary);
  } catch (err) { next(err); }
});

export default router;
