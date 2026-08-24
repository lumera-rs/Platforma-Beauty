type FixtureIssue = {
  path: readonly (string | number)[];
  message: string;
};

export type FixtureSchema = {
  safeParse(payload: unknown):
    | { success: true }
    | { success: false; error: { issues: readonly FixtureIssue[] } };
};

const DEFAULT_ADMIN_SUMMARY = {
  totalUsers: 4,
  totalSalons: 2,
  activeSalons: 2,
  bookingsThisMonth: 8,
  bookingsLastMonth: 6,
  bookingsTrend: 33.3,
  grossMerchandiseValue: 125000,
  newSalonsThisMonth: 1,
  totalReviews: 3,
  hiddenReviews: 1,
  activeSubscriptions: 2,
  galleryCleanupFailedTickets: 0,
  galleryCleanupFailureAttempts: 0,
  galleryCleanupOldestEligibleTicketAgeMinutes: null,
  galleryCleanupHasRepeatedFailures: false,
  topCategories: [{ name: "Kosa", count: 4 }],
  deliveryReportStaleProviders: [],
  smsFallbackReachableAdminCount: 2,
  schedulerJobs: [{
    job: "rescheduled-confirmation-retries",
    state: "idle",
    lastStartedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastFailureClass: null,
    consecutiveFailures: 0,
    deferredCycles: 0,
    nextRetryAt: null,
  }],
  schedulerDatabaseCapacity: {
    active: 0,
    limit: 4,
    queued: 0,
  },
};

export type AdminSummaryFixtureOverrides = Partial<typeof DEFAULT_ADMIN_SUMMARY>;

type AdminIntegrationCardFixture = {
  enabled: boolean;
  configuredInDatabase: boolean;
  complete: boolean;
  version: string | null;
  values: Record<string, string | null>;
};

type AdminWebhookIntegrationCardFixture = AdminIntegrationCardFixture & {
  webhookSecretPendingReconfirmation: boolean;
  webhookVerifiedAt: string | null;
  webhookVerificationStale: boolean;
  webhookConfirmationMaxAgeDays: number;
};

type AdminBrevoWebhookIntegrationCardFixture = AdminWebhookIntegrationCardFixture & {
  brevoRegistrationMissingEvents: string[];
};

export type AdminIntegrationsFixtureOverrides = {
  sms?: Partial<AdminWebhookIntegrationCardFixture>;
  brevo?: Partial<AdminBrevoWebhookIntegrationCardFixture>;
  google_oauth?: Partial<AdminIntegrationCardFixture>;
  facebook_oauth?: Partial<AdminIntegrationCardFixture>;
  cloudflare?: Partial<AdminIntegrationCardFixture>;
  redirectUris?: {
    google: string;
    facebook: string;
  };
  redirectUriWarning?: string;
};

type AdminWebhookFreshnessFixture = Pick<
  AdminWebhookIntegrationCardFixture,
  "webhookVerifiedAt" | "webhookVerificationStale" | "webhookConfirmationMaxAgeDays"
>;

export type AdminWebhookFreshnessFixtureOverrides = {
  sms?: Partial<AdminWebhookFreshnessFixture>;
  brevo?: Partial<AdminWebhookFreshnessFixture>;
};

/**
 * Build the platform summary used by admin browser mocks.
 *
 * Keep validation here, next to the shared defaults, so a response-contract
 * change fails the fixture setup with the endpoint name before page assertions
 * can run in any suite that uses this builder.
 */
export function adminSummaryFixture(
  schema: FixtureSchema,
  overrides: AdminSummaryFixtureOverrides = {},
) {
  return checkedApiFixture(
    "/api/admin/summary",
    schema,
    { ...DEFAULT_ADMIN_SUMMARY, ...overrides },
  );
}

/**
 * Build the complete integration settings response used by admin browser
 * mocks. Keep the delivery-health fields here so standalone integration
 * suites share one contract-checked fixture instead of drifting independently.
 */
export function adminIntegrationsFixture(
  schema: FixtureSchema,
  overrides: AdminIntegrationsFixtureOverrides = {},
) {
  const card: AdminIntegrationCardFixture = {
    enabled: false,
    configuredInDatabase: false,
    complete: false,
    version: null,
    values: {},
  };
  const webhookCard: AdminWebhookIntegrationCardFixture = {
    ...card,
    webhookSecretPendingReconfirmation: false,
    webhookVerifiedAt: null,
    webhookVerificationStale: false,
    webhookConfirmationMaxAgeDays: 7,
  };
  const brevoWebhookCard: AdminBrevoWebhookIntegrationCardFixture = {
    ...webhookCard,
    brevoRegistrationMissingEvents: [],
  };

  return checkedApiFixture(
    "/api/admin/integrations",
    schema,
    {
      integrations: {
        sms: { ...webhookCard, ...overrides.sms },
        brevo: { ...brevoWebhookCard, ...overrides.brevo },
        google_oauth: { ...card, ...overrides.google_oauth },
        facebook_oauth: { ...card, ...overrides.facebook_oauth },
        cloudflare: { ...card, ...overrides.cloudflare },
      },
      deliveryReports: {
        providers: {
          brevo: {
            lastEventAt: null,
            rejectedPayloadCount: 0,
            lastRejectedAt: null,
            malformedWebhookState: "normal",
            lastAutomationSentAt: null,
            recentSendCount: 0,
            warning: false,
          },
          infobip: {
            lastEventAt: null,
            rejectedPayloadCount: 0,
            lastRejectedAt: null,
            malformedWebhookState: "normal",
            lastAutomationSentAt: null,
            recentSendCount: 0,
            warning: false,
          },
        },
        windowHours: 24,
        graceMinutes: 30,
        rejectionAlertThreshold: 3,
      },
      smsFallback: { reachableAdminCount: 0, reachableAdmins: [] },
      smsWebhookRegistration: { state: "unconfirmed", secretSavedAt: null, lastReportAt: null },
      redirectUris: overrides.redirectUris ?? {
        google: "https://example.test/google",
        facebook: "https://example.test/facebook",
      },
      ...(overrides.redirectUriWarning !== undefined
        ? { redirectUriWarning: overrides.redirectUriWarning }
        : {}),
      smsReminder: { command: "pnpm run sms-reminders", active: false, instructions: [] },
    },
  );
}

export function adminWebhookFreshnessFixture(
  schema: FixtureSchema,
  overrides: AdminWebhookFreshnessFixtureOverrides = {},
) {
  return checkedApiFixture(
    "/api/admin/integrations/webhook-freshness",
    schema,
    {
      integrations: {
        sms: {
          webhookVerifiedAt: null,
          webhookVerificationStale: false,
          webhookConfirmationMaxAgeDays: 7,
          ...overrides.sms,
        },
        brevo: {
          webhookVerifiedAt: null,
          webhookVerificationStale: false,
          webhookConfirmationMaxAgeDays: 7,
          ...overrides.brevo,
        },
      },
      deliveryReports: {
        providers: {
          brevo: {
            lastEventAt: null,
            rejectedPayloadCount: 0,
            lastRejectedAt: null,
            malformedWebhookState: "normal",
            lastAutomationSentAt: null,
            recentSendCount: 0,
            warning: false,
          },
          infobip: {
            lastEventAt: null,
            rejectedPayloadCount: 0,
            lastRejectedAt: null,
            malformedWebhookState: "normal",
            lastAutomationSentAt: null,
            recentSendCount: 0,
            warning: false,
          },
        },
        windowHours: 24,
        graceMinutes: 30,
        rejectionAlertThreshold: 3,
      },
    },
  );
}

function formatFieldPath(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (field, segment) => typeof segment === "number"
      ? `${field}[${segment}]`
      : field ? `${field}.${segment}` : segment,
    "",
  );
}

/**
 * Validate mocked API data at the boundary where it is created.
 *
 * The parsed value is deliberately not returned: response schemas may coerce
 * dates, but Playwright must still receive the original JSON-compatible
 * payload. Keeping validation here makes contract drift point at the fixture
 * and endpoint instead of at an unrelated page assertion.
 */
export function assertApiFixture(
  endpoint: string,
  schema: FixtureSchema,
  payload: unknown,
): void {
  const result = schema.safeParse(payload);
  if (result.success) return;

  const issue = result.error.issues[0];
  const field = issue ? formatFieldPath(issue.path) || "(response)" : "(response)";
  const detail = issue?.message ?? "does not match the response schema";
  throw new Error(`Invalid browser API fixture for ${endpoint}: ${field} ${detail}`);
}

export function checkedApiFixture<T>(
  endpoint: string,
  schema: FixtureSchema,
  payload: T,
): T {
  assertApiFixture(endpoint, schema, payload);
  return payload;
}