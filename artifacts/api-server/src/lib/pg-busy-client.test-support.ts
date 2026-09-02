import assert from "node:assert/strict";

const busyClientWarning = /(?:query|client|connection).*(?:busy|in progress|concurrent)|(?:busy|in progress|concurrent).*(?:query|client|connection)/i;

/**
 * Future pg versions report overlapping queries on one client as warnings.
 * Keep focused database regressions red when that behavior reaches the app.
 */
export async function assertNoPgBusyClientWarnings(operation: () => Promise<void>) {
  const warnings: Error[] = [];
  const onWarning = (warning: Error) => {
    if (busyClientWarning.test(warning.message)) warnings.push(warning);
  };

  process.on("warning", onWarning);
  try {
    await operation();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(
      warnings.length,
      0,
      `pg reported overlapping work on one client:\n${warnings.map((warning) => warning.stack ?? warning.message).join("\n")}`,
    );
  } finally {
    process.off("warning", onWarning);
  }
}
