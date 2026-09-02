export function assertDestructiveTestRuntimeAllowed(
  environment: NodeJS.ProcessEnv = process.env,
  label = "Destructive test",
): void {
  if (
    environment.NODE_ENV === "production"
    || environment.REPLIT_DEPLOYMENT === "1"
    || environment.REPL_DEPLOYMENT === "1"
  ) {
    throw new Error(`${label} refuses production or deployment runtimes.`);
  }
}