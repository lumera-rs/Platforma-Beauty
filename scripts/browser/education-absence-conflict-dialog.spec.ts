import { expect, test, type Page } from "@playwright/test";

const centerId = "00000000-0000-4000-8000-000000000626";
const absentStaffId = "00000000-0000-4000-8000-000000000627";
const replacementStaffId = "00000000-0000-4000-8000-000000000628";
const replacementSessionId = "00000000-0000-4000-8000-000000000629";
const cancellationSessionId = "00000000-0000-4000-8000-000000000630";

async function mockAbsenceOperations(page: Page) {
  const unresolved = new Set([replacementSessionId, cancellationSessionId]);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/api/auth/me") {
      return route.fulfill({ json: { user: { id: "owner-626", firstName: "Vlasnik", lastName: "Centra", email: "owner@example.test", role: "EDUKATIVNI_CENTAR" } } });
    }
    if (path === "/api/education/center/status") {
      return route.fulfill({ json: [{
        id: centerId, name: "Centar za odsustva", verificationStatus: "verified", subscriptionStatus: "active",
        eligible: true, organicInquiriesAndCompletedEnrollments90d: 0, completedLearnerCount: 0,
        publishedReviewCount: 0, publishedRating: 0, qualifiesMostRequested: false, qualifiesTopRated: false,
        metricsExplanation: "Test",
      }] });
    }
    if (path === "/api/education/public/taxonomy") return route.fulfill({ json: [] });
    if (path === `/api/education/operations/centers/${centerId}/permissions`) {
      return route.fulfill({ json: { centerId, role: "owner_admin", educatorStaffId: null, canManageStaff: true, canManageCalendar: true, canTakeAttendance: true } });
    }
    if (path === `/api/education/operations/centers/${centerId}/staff`) {
      return route.fulfill({ json: [
        { id: absentStaffId, centerId, userId: "Ana Edukator", instructorProfileId: null, role: "educator", active: true },
        { id: replacementStaffId, centerId, userId: "Mila Zamena", instructorProfileId: null, role: "educator", active: true },
      ] });
    }
    if (path.includes("/weekly-availability") || (path.endsWith("/absences") && method === "GET")) {
      return route.fulfill({ json: [] });
    }
    if (path.endsWith("/absences/preview") && method === "POST") {
      const conflicts = [
        { sessionId: replacementSessionId, courseId: "course-1", courseTitle: "Kurs za zamenu", startsAt: "2027-03-10T09:00:00.000Z", endsAt: "2027-03-10T10:00:00.000Z", reservedSeats: 2 },
        { sessionId: cancellationSessionId, courseId: "course-2", courseTitle: "Kurs za otkazivanje", startsAt: "2027-03-11T09:00:00.000Z", endsAt: "2027-03-11T10:00:00.000Z", reservedSeats: 1 },
      ].filter((conflict) => unresolved.has(conflict.sessionId));
      return route.fulfill({ json: { canCreate: conflicts.length === 0, conflicts } });
    }
    if (path === `/api/education/operations/centers/${centerId}/sessions/${replacementSessionId}/educator` && method === "PATCH") {
      unresolved.delete(replacementSessionId);
      return route.fulfill({ json: { sessionId: replacementSessionId, educatorStaffId: replacementStaffId } });
    }
    if (path === `/api/education/operations/centers/${centerId}/sessions/${cancellationSessionId}/cancel` && method === "POST") {
      unresolved.delete(cancellationSessionId);
      return route.fulfill({ json: { id: cancellationSessionId, cancelledAt: new Date().toISOString() } });
    }
    if (path === "/api/shop/notifications") return route.fulfill({ json: [] });
    if (path.includes("/operations/centers/") && path.includes("/calendar")) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
}

async function openConflictPreview(page: Page) {
  await page.goto("/biznis/edukacije");
  await page.getByRole("tab", { name: "Operacije" }).click();
  await page.getByRole("tab", { name: "Raspored i odsustva" }).click();
  await page.getByRole("tabpanel", { name: "Raspored i odsustva" }).getByRole("combobox").click();
  await page.getByRole("option", { name: "Ana Edukator" }).click();
  await page.getByRole("button", { name: "Dodaj" }).click();
  await page.locator("#absence-start-date").fill("2027-03-10");
  await page.locator("#absence-end-date").fill("2027-03-11");
  await page.getByRole("button", { name: "Proveri konflikte" }).click();
  await expect(page.getByText("Pronađeno konflikata: 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Potvrdi odsustvo" })).toBeDisabled();
}

async function resolveAllConflicts(page: Page) {
  await page.getByRole("combobox", { name: "Zamenski edukator za Kurs za zamenu" }).click();
  await page.getByRole("option", { name: "Mila Zamena" }).click();
  await page.getByTestId(`absence-conflict-${replacementSessionId}`).getByRole("button", { name: "Dodeli zamenu" }).click();
  await expect(page.getByText("Pronađeno konflikata: 1")).toBeVisible();
  await expect(page.getByTestId("absence-dialog")).toBeVisible();

  page.on("dialog", (dialog) => dialog.accept(dialog.type() === "prompt" ? "Bolest edukatora" : undefined));
  await page.getByTestId(`absence-conflict-${cancellationSessionId}`).getByRole("button", { name: "Otkaži termin" }).click();
  await expect(page.getByText("Nema konflikata. Odsustvo može da se potvrdi.")).toBeVisible();
  await expect(page.getByTestId("absence-dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Potvrdi odsustvo" })).toBeEnabled();
}

test("desktop owner resolves absence conflicts without leaving the dialog", async ({ page }) => {
  await mockAbsenceOperations(page);
  await openConflictPreview(page);
  await resolveAllConflicts(page);
});

test("mobile owner resolves absence conflicts without leaving the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAbsenceOperations(page);
  await openConflictPreview(page);
  await resolveAllConflicts(page);
});