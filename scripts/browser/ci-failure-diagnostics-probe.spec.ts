import { expect, test } from "@playwright/test";

test("controlled CI failure produces a screenshot and trace", async ({ page }) => {
  test.skip(
    process.env.LUMERA_CI_DIAGNOSTICS_PROBE !== "1",
    "This intentionally failing test is restricted to the manual CI diagnostics probe.",
  );

  await page.setContent(`
    <main>
      <h1>Controlled CI diagnostics probe</h1>
      <p>This page exists only to make the failure screenshot recognizable.</p>
    </main>
  `);

  await expect(page.getByRole("heading")).toHaveText(
    "This assertion intentionally fails",
  );
});