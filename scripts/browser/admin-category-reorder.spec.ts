import { expect, test, type Page } from "@playwright/test";

const admin = {
  id: "00000000-0000-4000-8000-000000000991",
  firstName: "Category",
  lastName: "Admin",
  email: "category-admin@example.test",
  role: "ADMIN",
  active: true,
  mustChangePassword: false,
};

const categories = [
  { id: "00000000-0000-4000-8000-000000000992", name: "Kosa", slug: "kosa", parentId: null, sortOrder: 1, icon: null, imageUrl: null, active: true, productCount: 0 },
  { id: "00000000-0000-4000-8000-000000000993", name: "Nega", slug: "nega", parentId: null, sortOrder: 2, icon: null, imageUrl: null, active: true, productCount: 0 },
];

test("rapid category reordering submits one paired update and disables sibling controls", async ({ page }) => {
  let updateCount = 0;
  let releaseUpdates: () => void = () => undefined;
  const updatesHeld = new Promise<void>((resolve) => { releaseUpdates = resolve; });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/auth/me") return route.fulfill({ json: { user: admin } });
    if (pathname === "/api/admin/product-categories" && request.method() === "GET") return route.fulfill({ json: categories });
    if (pathname === "/api/admin/service-categories" && request.method() === "GET") return route.fulfill({ json: [] });
    if (pathname.startsWith("/api/admin/product-categories/") && request.method() === "PATCH") {
      updateCount += 1;
      await updatesHeld;
      return route.fulfill({ json: { ...categories.find((category) => category.id === pathname.split("/").at(-1)), ...request.postDataJSON() } });
    }
    return route.fallback();
  });

  await page.goto("/admin/kategorije");
  const firstRow = page.getByTestId(`category-row-${categories[0].id}`);
  const secondRow = page.getByTestId(`category-row-${categories[1].id}`);
  const moveDown = firstRow.getByTitle("Pomeri dole");

  await moveDown.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  await expect.poll(() => updateCount).toBe(2);
  await expect(moveDown).toBeDisabled();
  await expect(secondRow.getByTitle("Pomeri gore")).toBeDisabled();
  releaseUpdates();
});