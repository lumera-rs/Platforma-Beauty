export type PaymentRuntimeEnvironment = "production" | "test";

const TRUE_VALUES = new Set(["1", "true", "yes", "production"]);

/**
 * Provider-neutral payment classification. An explicit new value always wins.
 * Invalid or empty new values fail closed; legacy Replit markers are consulted
 * only when PAYMENT_RUNTIME_ENV is entirely absent.
 */
export function paymentRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): PaymentRuntimeEnvironment {
  if (env.PAYMENT_RUNTIME_ENV !== undefined) {
    return env.PAYMENT_RUNTIME_ENV.trim().toLowerCase() === "production"
      ? "production"
      : "test";
  }
  const deploymentValue = env.REPLIT_DEPLOYMENT ?? env.REPL_DEPLOYMENT;
  const publishedDeployment = deploymentValue !== undefined
    && TRUE_VALUES.has(deploymentValue.trim().toLowerCase());
  const optionalMarkerAllowsProduction = env.REPLIT_ENVIRONMENT === undefined
    || env.REPLIT_ENVIRONMENT === "production";
  return env.NODE_ENV === "production" && publishedDeployment && optionalMarkerAllowsProduction
    ? "production"
    : "test";
}

/** Express trust-proxy value. The new setting wins even when it is invalid. */
export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): number | false {
  if (env.TRUST_PROXY_HOPS !== undefined) {
    const hops = Number(env.TRUST_PROXY_HOPS.trim());
    return Number.isSafeInteger(hops) && hops > 0 ? hops : false;
  }
  // Preserve the existing app.ts behavior exactly as the compatibility fallback.
  return env.REPLIT_DEPLOYMENT ? 1 : false;
}

function normalizedHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Public host allowlist. Presence of ALLOWED_PUBLIC_HOSTS (including an empty
 * value) suppresses every legacy hostname source.
 */
export function allowedPublicHosts(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const source = env.ALLOWED_PUBLIC_HOSTS !== undefined
    ? env.ALLOWED_PUBLIC_HOSTS
    : env.REPLIT_DOMAINS ?? "";
  const hosts = new Set<string>();
  for (const entry of source.split(",")) {
    const host = normalizedHostname(entry);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function isAllowedPublicHost(hostname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const hosts = allowedPublicHosts(env);
  // No configured list retains existing APP_BASE_URL/request-origin behavior.
  return hosts.size === 0 && env.ALLOWED_PUBLIC_HOSTS === undefined
    ? true
    : hosts.has(hostname.trim().toLowerCase());
}

export function isDevelopmentHostname(hostname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (env.ALLOWED_PUBLIC_HOSTS === undefined) {
    const legacyDev = env.REPLIT_DEV_DOMAIN?.trim().toLowerCase();
    if (legacyDev && normalized === legacyDev) return true;
  }
  return normalized.endsWith(".replit.dev")
    || ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(normalized);
}

export function safeModeNoExternalCalls(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAFE_MODE_NO_EXTERNAL_CALLS?.trim().toLowerCase() === "true";
}