export function isDeploymentRuntime(environment: {
  readonly NODE_ENV?: string;
  readonly REPLIT_DEPLOYMENT?: string;
  readonly REPL_DEPLOYMENT?: string;
  readonly REPLIT_DEPLOYMENT_ID?: string;
  readonly REPL_DEPLOYMENT_ID?: string;
  readonly REPLIT_ENVIRONMENT?: string;
}): boolean {
  return environment.NODE_ENV === "production"
    || /^(?:1|true)$/iu.test(environment.REPLIT_DEPLOYMENT ?? "")
    || /^(?:1|true)$/iu.test(environment.REPL_DEPLOYMENT ?? "")
    || environment.REPLIT_DEPLOYMENT_ID !== undefined
    || environment.REPL_DEPLOYMENT_ID !== undefined;
}