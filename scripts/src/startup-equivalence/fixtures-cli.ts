import { writeFile } from "node:fs/promises";
import { characterizeDisposableEquivalence, explicitAdminUrlFromArgs } from "./fixtures";

// Deliberately separate from the node:test runner: a diagnostic process exiting
// zero must not be mistaken for an equivalence GO.
const adminUrl = explicitAdminUrlFromArgs(process.argv.slice(2));
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
if (!adminUrl || !output) {
  throw new Error("Usage: fixtures-cli.ts --admin-url=<explicit disposable loopback target> --output=<report.json>");
}
const report = await characterizeDisposableEquivalence(adminUrl);
await writeFile(output, `${JSON.stringify(report, (key, value) =>
  key === "structuralPayload" || key === "physicalPayload" ? undefined : value, 2)}\n`);
console.log(JSON.stringify({
  readiness: report.blockers.length ? "BLOCKED" : "CHARACTERIZED_NOT_AUTHORIZED",
  blockers: report.blockers,
  output,
}));
process.exitCode = report.blockers.length ? 2 : 0;