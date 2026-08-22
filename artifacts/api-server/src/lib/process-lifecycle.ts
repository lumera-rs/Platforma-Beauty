/**
 * Centralised fatal-error handler registration for the API server process.
 *
 * Extracted into its own module so it can be unit-tested with a fake process
 * without booting the real server or touching real I/O.
 */

import type pino from "pino";

export type FatalHandlerDeps = {
  /** Pino logger (or compatible fake). flush(cb) must invoke cb after flushing. */
  logger: Pick<pino.Logger, "fatal" | "flush">;
  /** Called once to initiate graceful resource cleanup before exit. */
  cleanup: () => Promise<void> | void;
  /** Exits the process with the given code. Defaults to process.exit. */
  exit?: (code: number) => never;
  /** The EventEmitter to attach handlers to. Defaults to process. */
  proc?: NodeJS.EventEmitter & {
    once(event: string, listener: (...args: unknown[]) => void): NodeJS.EventEmitter;
  };
};

type FatalShutdownDeps = Omit<FatalHandlerDeps, "proc"> & {
  reason: string;
  error: unknown;
};

export async function runFatalShutdown(deps: FatalShutdownDeps): Promise<never> {
  const {
    logger,
    cleanup,
    exit: doExit = (code) => process.exit(code),
    reason,
    error,
  } = deps;

  logger.fatal({ err: error }, reason);
  const fallback = setTimeout(() => doExit(1), 10_000);
  fallback.unref();

  try {
    await cleanup();
  } catch {
    // Fatal shutdown remains best-effort: still flush the original fatal event
    // and terminate even when one cleanup step fails.
  }
  await new Promise<void>((resolve) => logger.flush(() => resolve()));
  clearTimeout(fallback);
  return doExit(1);
}

/**
 * Registers `once` listeners for `unhandledRejection` and `uncaughtException`
 * on `proc` (defaults to `process`). Each handler:
 *   1. Logs a fatal message via `logger.fatal`.
 *   2. Calls `cleanup()` to begin graceful resource teardown.
 *   3. Waits for `logger.flush(cb)` to complete before calling `exit(1)`.
 *   4. A hard fallback timer (`10 s`) forces exit if flush/cleanup stall.
 *
 * Returns a `deregister()` function that removes both listeners — useful for
 * test isolation.
 */
export function registerFatalHandlers(deps: FatalHandlerDeps): { deregister: () => void } {
  const {
    logger,
    cleanup,
    exit: doExit = (code) => process.exit(code),
    proc = process as NodeJS.EventEmitter & {
      once(event: string, listener: (...args: unknown[]) => void): NodeJS.EventEmitter;
    },
  } = deps;

  let handled = false;

  function handleFatal(reason: string, error: unknown): void {
    if (handled) return;
    handled = true;

    void runFatalShutdown({ logger, cleanup, exit: doExit, reason, error });
  }

  const onUnhandledRejection = (reason: unknown): void => {
    handleFatal("Unhandled promise rejection — shutting down", reason);
  };

  const onUncaughtException = (error: Error): void => {
    handleFatal("Uncaught exception — shutting down", error);
  };

  proc.once("unhandledRejection", onUnhandledRejection as (...args: unknown[]) => void);
  proc.once("uncaughtException", onUncaughtException as (...args: unknown[]) => void);

  return {
    deregister(): void {
      proc.removeListener("unhandledRejection", onUnhandledRejection as (...args: unknown[]) => void);
      proc.removeListener("uncaughtException", onUncaughtException as (...args: unknown[]) => void);
    },
  };
}
