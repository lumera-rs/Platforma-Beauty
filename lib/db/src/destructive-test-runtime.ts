export const destructiveTestGuardEnvironments = [
  { name: "NODE_ENV=production", values: { NODE_ENV: "production" } },
  { name: "REPLIT_DEPLOYMENT=1", values: { REPLIT_DEPLOYMENT: "1" } },
  { name: "REPL_DEPLOYMENT=1", values: { REPL_DEPLOYMENT: "1" } },
] as const;

export function isProductionOrDeploymentRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.NODE_ENV === "production"
    || environment.REPLIT_DEPLOYMENT === "1"
    || environment.REPL_DEPLOYMENT === "1"
  );
}

export function assertDestructiveTestRuntimeAllowed(
  environment: NodeJS.ProcessEnv = process.env,
  label = "Destructive test harness",
): void {
  if (isProductionOrDeploymentRuntime(environment)) {
    throw new Error(`${label} refuses production or deployment runtimes.`);
  }
}