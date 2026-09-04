/**
 * Pre-flight check for the shared Playwright browser suites.
 *
 * The shared specs in scripts/browser/ run against the live dev workflows
 * (web at localhost:80, API server proxied under /api). When either workflow
 * is stopped, every spec fails with opaque errors (HTTP 502 on login,
 * net::ERR_HTTP_RESPONSE_CODE_FAILURE on page.goto) that look like
 * application or test bugs. This global setup fails fast with an explicit
 * message instead.
 *
 * Isolated suites (LUMERA_ISOLATED_*) provision their own harness frontend
 * and API server, so the check is skipped for them.
 */

import { checkGeneratedApiContracts } from "./generated-api-check";
import { assertDestructiveTestRuntimeAllowed } from "./destructive-test-runtime";

const ISOLATED_SUITE_ENV_VARS = [
  "LUMERA_ISOLATED_ADMIN_BROWSER_TEST",
  "LUMERA_ISOLATED_ADMIN_FORM_RESILIENCE_BROWSER_TEST",
  "LUMERA_ISOLATED_SALON_NOTIFICATION_BROWSER_TEST",
  "LUMERA_ISOLATED_RETAIL_CHECKOUT_BROWSER_TEST",
  "LUMERA_ISOLATED_RETENTION_PREVIEW_BROWSER_TEST",
  "LUMERA_ISOLATED_INFOBIP_REGISTRATION_BROWSER_TEST",
  "LUMERA_ISOLATED_BEAUTY_JOBS_BROWSER_TEST",
  "LUMERA_ISOLATED_EDUCATION_GROUP_ONLINE_CONSENT_BROWSER_TEST",
  "LUMERA_ISOLATED_EMPLOYEE_LOCATION_DEACTIVATION_BROWSER_TEST",
  "LUMERA_ISOLATED_EDUCATION_CENTER_URL_XSS_AUDIT_BROWSER_TEST",
] as const;

const PREFLIGHT_TIMEOUT_MS = 5_000;

type PreflightTarget = {
  label: string;
  url: string;
  /** Statuses that prove the server behind the proxy is up and answering. */
  isHealthyStatus: (status: number) => boolean;
};

async function probe(target: PreflightTarget): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(target.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError"
      ? `no response within ${PREFLIGHT_TIMEOUT_MS / 1000}s`
      : error instanceof Error
        ? error.message
        : String(error);
    return `The ${target.label} is not responding at ${target.url} (${reason})`;
  }
  if (!target.isHealthyStatus(response.status)) {
    return `The ${target.label} is not responding at ${target.url} (HTTP ${response.status})`;
  }
  return null;
}

export default async function browserPreflight(): Promise<void> {
  assertDestructiveTestRuntimeAllowed(process.env, "Browser tests");
  await checkGeneratedApiContracts();

  if (ISOLATED_SUITE_ENV_VARS.some((name) => process.env[name] === "1")) {
    // Isolated suites run against their own harness servers; the harness is
    // responsible for their liveness.
    return;
  }

  const webBaseUrl = (process.env.LUMERA_WEB_BASE_URL ?? "http://localhost:80").replace(/\/+$/, "");
  const targets: PreflightTarget[] = [
    {
      label: "LUMERA web dev server",
      url: `${webBaseUrl}/`,
      // The dev proxy answers 502 when the workflow behind it is stopped;
      // any non-5xx response (including redirects) means the app is up.
      isHealthyStatus: (status) => status < 500,
    },
    {
      label: "LUMERA API dev server",
      url: `${webBaseUrl}/api/healthz`,
      isHealthyStatus: (status) => status === 200,
    },
  ];

  const failures = (await Promise.all(targets.map(probe))).filter(
    (failure): failure is string => failure !== null,
  );
  if (failures.length > 0) {
    throw new Error(
      [
        "Browser test pre-flight failed:",
        ...failures.map((failure) => `  - ${failure}`),
        "Start the dev workflows (web and API Server) before running the shared browser tests.",
      ].join("\n"),
    );
  }
}
