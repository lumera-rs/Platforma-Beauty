import { retryFailedRescheduledEmailConfirmations } from "./brevo";
import { logger } from "./logger";

// NOTE: retryFailedRescheduledEmailConfirmations now delegates to the generalized
// email outbox retry worker, so this scheduled batch also drives retries for
// automation emails (and any other retryable email type), not only rescheduled
// appointment confirmations. The name/log wording is retained for compatibility.
export async function retryFailedRescheduledConfirmations() {
  return { email: await retryFailedRescheduledEmailConfirmations() };
}

export async function runRescheduledConfirmationRetries() {
  try {
    const result = await retryFailedRescheduledConfirmations();
    if (result.email.retried) {
      logger.info(result, "Rescheduled appointment confirmation retry batch finished");
    }
    return result;
  } catch (error) {
    logger.error({ err: error }, "Rescheduled appointment confirmation retry batch failed");
    throw error;
  }
}

export async function runScheduledRescheduledConfirmationRetries(
  runner: () => Promise<unknown> = runRescheduledConfirmationRetries,
): Promise<void> {
  try {
    await runner();
  } catch {
    // The worker already logs the batch error. Scheduled runs must not become
    // unhandled rejections that can terminate the API process.
  }
}