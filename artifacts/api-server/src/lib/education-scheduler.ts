import { processUpcomingEducationSessions } from "./education-sessions";
import { logger } from "./logger";

/**
 * Run one pass of the education session lifecycle maintenance:
 *  - auto-cancel sessions below minimum enrollment (starting within 24h)
 *  - expire timed-out waitlist offers and promote the next waiting user
 *
 * Errors are logged and swallowed so a scheduled run can never crash the API
 * process with an unhandled rejection.
 */
export async function runScheduledEducationSessionMaintenance(
  runner: () => Promise<unknown> = processUpcomingEducationSessions,
): Promise<void> {
  try {
    const result = await runner();
    logger.debug({ result }, "Education session maintenance batch finished");
  } catch (error) {
    logger.error({ err: error }, "Education session maintenance batch failed");
  }
}
