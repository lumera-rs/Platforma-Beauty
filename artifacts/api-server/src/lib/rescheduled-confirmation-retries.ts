import { retryFailedRescheduledEmailConfirmations } from "./brevo";
import { logger } from "./logger";

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