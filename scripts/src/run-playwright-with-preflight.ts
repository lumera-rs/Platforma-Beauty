import { spawn } from "node:child_process";
import path from "node:path";
import { runBrowserSpecTypeCheck } from "./check-browser-spec-types";

const scriptsRoot = path.resolve(import.meta.dirname, "..");

runBrowserSpecTypeCheck();

const playwrightArguments = process.argv.slice(2);
if (playwrightArguments[0] === "--") playwrightArguments.shift();

const child = spawn(
  path.join(scriptsRoot, "node_modules", ".bin", "playwright"),
  ["test", ...playwrightArguments],
  {
    cwd: scriptsRoot,
    env: {
      ...process.env,
      LUMERA_BROWSER_SPEC_TYPES_CHECKED: "1",
    },
    stdio: "inherit",
  },
);

child.once("error", () => {
  console.error("Playwright could not be started.");
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});