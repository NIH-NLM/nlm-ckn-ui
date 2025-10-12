import { expect, test } from '@playwright/test';
import { doc } from './utils/testSeeds';

// Deterministic test collection and documents
const TEST_COLL = 'TEST_DOCUMENT_COLLECTION';
const docs = [
    doc('0001', 'Alpha'),
    doc('0002', 'Beta'),
    doc('0003', 'Gamma'),
];

test('Collections page: select, filter, and navigate to item', async ({ page }) => {
    // Mock the collections list endpoint
    await page.route('**/arango_api/collections/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([TEST_COLL]),
            });
        }
        return route.continue();
    });

    // Mock the documents fetch for the selected collection
    await page.route(`**/arango_api/collection/${TEST_COLL}/`, async (route) => {
        if (route.request().method() === 'POST') {
            // API returns an object keyed by _id in real app; BrowseBox flattens via Object.values
            const body: Record<string, unknown> = {};
            for (const d of docs) body[d._id] = d;
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        }
        return route.continue();
    });

    // Mock the document details fetch when navigating to the item page
    await page.route(`**/arango_api/collection/${TEST_COLL}/0002/`, async (route) => {
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(docs[1]), // Beta
        });
    });

    // Go to home and open Collections from the header
    await page.goto('/');
    await page.getByRole('link', { name: 'Collections' }).click();
    await expect(page).toHaveURL(/#\/collections$/);

    // The list should show our test collection by its display name
    await page.getByRole('link', { name: /Test document collection/i }).click();
    await expect(page).toHaveURL(new RegExp(`#/collections/${TEST_COLL}$`));

    // Wait for items to populate (document list panel)
    const listPanel = page.locator('.document-list-panel');
    await expect(listPanel).toContainText('Alpha');
    await expect(listPanel).toContainText('Beta');
    await expect(listPanel).toContainText('Gamma');

    // Type into the filter to narrow results to "Beta"
    const filter = page.locator('input.document-filter-input');
    await filter.fill('Beta');

    // Only Beta should remain visible in the list items container
    const itemsContainer = page.locator('.document-list-items-container');
    await expect(itemsContainer).toContainText('Beta');
    await expect(itemsContainer).not.toContainText('Alpha');
    await expect(itemsContainer).not.toContainText('Gamma');

    // Click the Beta item to navigate to its page
    await itemsContainer.getByRole('link', { name: 'Beta' }).click();
    await expect(page).toHaveURL(new RegExp(`#/collections/${TEST_COLL}/0002$`));

    // Document page should render the title using collection map + label
    await expect(page.locator('.document-item-header h1')).toHaveText(/Test document collection: Beta/i);
});
