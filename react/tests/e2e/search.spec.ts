import { expect, test } from '@playwright/test';
import { doc } from './utils/testSeeds';

// Contract
// - Type 'lung' into the homepage search input
// - Mock /arango_api/search/ to return a result with id TEST_DOCUMENT_COLLECTION/0001 and label 'lung'
// - Click first result and verify navigation to #/collections/TEST_DOCUMENT_COLLECTION/0001

const LUNG_ID = 'TEST_DOCUMENT_COLLECTION/0001';

// Helper to build expected hash route without hardcoding host
function expectedHashForDocument(id: string) {
    return `#/collections/${id}`;
}

test('searching "lung" navigates to lung page', async ({ page }) => {
    // Intercept the search API and return mocked results
    await page.route('**/arango_api/search/', async (route) => {
        const request = route.request();
        if (request.method() === 'POST') {
            const body = request.postDataJSON?.() as any;
            const term = body?.search_term?.toString()?.toLowerCase?.() ?? '';
            if (term.includes('lung')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([
                        doc('0001', 'lung'),
                        // Optionally other decoys
                    ]),
                });
            }
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // Navigate to app root (SearchPage is at '/')
    await page.goto('/');

    // Locate the search input by placeholder text
    const input = page.getByPlaceholder('Search NCKN...');
    await expect(input).toBeVisible();

    // Type the query and wait for dropdown to appear
    await input.fill('lung');

    // Wait for the results dropdown to show an item labeled 'lung'
    // The SearchResultsTable uses getLabel(item) based on collection maps; TEST_DOCUMENT_COLLECTION maps label directly.
    const firstResult = page.locator('.unified-search-results-list .result-item-row-link').first();
    await expect(firstResult).toBeVisible();
    await expect(firstResult).toContainText('lung');

    // Clicking the first result should navigate to the document page.
    await firstResult.click();

    // Expect hash-based navigation using React Router HashRouter
    await expect(page).toHaveURL(new RegExp(`${expectedHashForDocument(LUNG_ID)}$`));
});
