import { assertDestructiveTestRuntimeAllowed } from "./destructive-test-runtime";

assertDestructiveTestRuntimeAllowed(
  process.env,
  process.argv[2] || "Destructive test harness",
);