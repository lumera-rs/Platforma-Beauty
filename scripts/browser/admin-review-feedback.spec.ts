import { expect, test, type Page } from "@playwright/test";

const reviewId = "00000000-0000-4000-8000-000000000055";
const review = {
  id: reviewId,
  salonId: "00000000-0000-4000-8000-000000000056",
  salonName: "Izolovani test salon",
  customerId: "00000000-0000-4000-8000-000000000057",
  customerName: "Test kupac",
  serviceName: "Test tretman",
  rating: 4,
  text: "Recenzija za proveru moderatorske povratne informacije.",
  visible: true,
  date: "2026-08-21T09:00:00.000Z",
};

const moderator = {
  id: "00000000-0000-4000-8000-000000000058",
  firstName: "Test",
  lastName: "Moderator",
  email: "moderator-feedback@example.test",
  role: "ADMIN",
  active: true,
  mustChangePassword: false,
};

type DeleteOutcome = {
  name: string;
  status?: 204 | 404 | 500;
  failure?: "failed";
  title: string;
  description: string;
  refreshesList: boolean;
};

async function mockAdminReviewScreen(page: Page, outcome: DeleteOutcome) {
  let listRequestCount = 0;
  let deleteRequestCount = 0;
  let nextDeleteHold: Promise<void> | null = null;
  let reviewIsListed = true;

  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({ json: { user: moderator } });
  });

  await page.route("**/api/admin/reviews**", async (route) => {
    const request = route.request();

    if (request.method() === "GET") {
      listRequestCount += 1;
      await route.fulfill({ json: reviewIsListed ? [review] : [] });
      return;
    }

    if (request.method() === "DELETE") {
      deleteRequestCount += 1;
      const hold = nextDeleteHold;
      nextDeleteHold = null;
      if (hold) await hold;
      if (outcome.status !== 500) reviewIsListed = false;

      if (outcome.failure) {
        await route.abort(outcome.failure);
        return;
      }

      if (outcome.status === 204) {
        await route.fulfill({ status: 204 });
      } else {
        await route.fulfill({
          status: outcome.status,
          json: { error: outcome.status === 404 ? "Recenzija nije pronađena." : "Testirana greška servera." },
        });
      }
      return;
    }

    await route.fallback();
  });

  await page.goto("/admin/recenzije");
  await expect(page.getByTestId(`review-card-${reviewId}`)).toBeVisible();

  return {
    getListRequestCount: () => listRequestCount,
    getDeleteRequestCount: () => deleteRequestCount,
    holdNextDelete: () => {
      let release: () => void = () => undefined;
      nextDeleteHold = new Promise<void>((resolve) => { release = resolve; });
      return release;
    },
  };
}

const outcomes: DeleteOutcome[] = [
  {
    name: "a successful moderator deletion",
    status: 204,
    title: "Obrisano",
    description: "Recenzija je uklonjena iz sistema.",
    refreshesList: true,
  },
  {
    name: "a review already withdrawn by its customer",
    status: 404,
    title: "Recenzija više nije dostupna",
    description: "Klijent je u međuvremenu povukao ovu recenziju. Lista je osvežena.",
    refreshesList: true,
  },
  {
    name: "an unexpected deletion failure",
    status: 500,
    title: "Greška",
    description: "Nije moguće obrisati recenziju.",
    refreshesList: false,
  },
  {
    name: "an uncertain network failure",
    failure: "failed",
    title: "Brisanje nije potvrđeno",
    description: "Veza sa serverom je prekinuta. Lista je osvežena; proverite da li je recenzija obrisana.",
    refreshesList: true,
  },
];

for (const outcome of outcomes) {
  test(`moderator receives reliable review feedback for ${outcome.name}`, async ({ page }) => {
    const screen = await mockAdminReviewScreen(page, outcome);
    const initialListRequestCount = screen.getListRequestCount();
    // Kept as two separately typed waits rather than one union-typed promise:
    // outcome.failure cannot narrow a Promise<Request> | Promise<Response> at
    // the point it is awaited. Exactly one is armed, as before, and both are
    // armed before the click that triggers the request.
    const failedDelete = outcome.failure
      ? page.waitForEvent("requestfailed", (request) =>
          request.method() === "DELETE"
          && new URL(request.url()).pathname === `/api/admin/reviews/${reviewId}`,
        )
      : undefined;
    const completedDelete = outcome.failure
      ? undefined
      : page.waitForResponse((response) =>
          response.request().method() === "DELETE"
          && new URL(response.url()).pathname === `/api/admin/reviews/${reviewId}`,
        );

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId(`btn-delete-${reviewId}`).click();
    if (failedDelete) {
      expect((await failedDelete).failure()).toBeTruthy();
    } else if (completedDelete) {
      expect((await completedDelete).status()).toBe(outcome.status);
    }

    await expect(page.getByText(outcome.title, { exact: true })).toBeVisible();
    await expect(page.getByText(outcome.description, { exact: true })).toBeVisible();

    const reviewCard = page.getByTestId(`review-card-${reviewId}`);
    if (outcome.refreshesList) {
      await expect.poll(screen.getListRequestCount).toBe(initialListRequestCount + 1);
      await expect(reviewCard).toHaveCount(0);
    } else {
      await expect(reviewCard).toBeVisible();
      await page.waitForTimeout(600);
      expect(screen.getListRequestCount()).toBe(initialListRequestCount);
    }
  });
}

test("a rapid confirmed deletion sends one request and stays disabled while pending", async ({ page }) => {
  const screen = await mockAdminReviewScreen(page, outcomes[0]);
  const remove = page.getByTestId(`btn-delete-${reviewId}`);
  page.on("dialog", (dialog) => dialog.accept());
  const release = screen.holdNextDelete();

  await remove.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  await expect.poll(screen.getDeleteRequestCount).toBe(1);
  await expect(remove).toBeDisabled();
  release();
});