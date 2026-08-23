type FixtureIssue = {
  path: readonly (string | number)[];
  message: string;
};

type FixtureSchema = {
  safeParse(payload: unknown):
    | { success: true }
    | { success: false; error: { issues: readonly FixtureIssue[] } };
};

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