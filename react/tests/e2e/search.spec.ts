import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { doc } from "./utils/testSeeds";

// Behavior: typing "lung" navigates to the matching document page.
// Mock: /arango_api/search/ returns TEST_DOCUMENT_COLLECTION/0001 labeled "lung".
// Assert: hash route ends with #/collections/TEST_DOCUMENT_COLLECTION/0001.

const LUNG_ID = "TEST_DOCUMENT_COLLECTION/0001";

// Hash-only route helper
function expectedHashForDocument(id: string) {
  return `#/collections/${id}`;
}

test('searching "lung" navigates to lung page', async ({ page }) => {
  await installErrorInstrumentation(page);

  // Mock search
  await page.route("**/arango_api/search/", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      // biome-ignore lint/suspicious/noExplicitAny: mocking request body
      const body = request.postDataJSON?.() as any;
      const term = body?.search_term?.toString()?.toLowerCase?.() ?? "";
      if (term.includes("lung")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            doc("0001", "lung"),
            // decoys optional
          ]),
        });
      }
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  // Navigate
  await page.goto("/");

  // Input
  const input = page.getByPlaceholder("Search NCKN...");
  await expect(input).toBeVisible();

  // Type
  await input.fill("lung");

  // Results
  const firstResult = page.locator(".unified-search-results-list .result-item-row-link").first();
  await expect(firstResult).toBeVisible();
  await expect(firstResult).toContainText("lung");

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);

  // Click result
  await firstResult.click();

  // Assert navigation
  await expect(page).toHaveURL(new RegExp(`${expectedHashForDocument(LUNG_ID)}$`));
});
