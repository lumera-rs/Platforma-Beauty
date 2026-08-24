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