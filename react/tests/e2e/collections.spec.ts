import { expect, test } from '@playwright/test';
import { doc } from './utils/testSeeds';

// Seed: deterministic collection and docs
const TEST_COLL = 'TEST_DOCUMENT_COLLECTION';
const docs = [
    doc('0001', 'Alpha'),
    doc('0002', 'Beta'),
    doc('0003', 'Gamma'),
];

test('Collections page: select, filter, and navigate to item', async ({ page }) => {
    // Mock collections list
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

    // Mock documents in collection
    await page.route(`**/arango_api/collection/${TEST_COLL}/`, async (route) => {
        if (route.request().method() === 'POST') {
            // API returns object keyed by _id; UI flattens via Object.values
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

    // Mock document details for navigation
    await page.route(`**/arango_api/collection/${TEST_COLL}/0002/`, async (route) => {
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(docs[1]), // Beta
        });
    });

    // Navigate -> Collections
    await page.goto('/');
    await page.getByRole('link', { name: 'Collections' }).click();
    await expect(page).toHaveURL(/#\/collections$/);

    // Pick test collection
    await page.getByRole('link', { name: /Test document collection/i }).click();
    await expect(page).toHaveURL(new RegExp(`#/collections/${TEST_COLL}$`));

    // Items visible
    const listPanel = page.locator('.document-list-panel');
    await expect(listPanel).toContainText('Alpha');
    await expect(listPanel).toContainText('Beta');
    await expect(listPanel).toContainText('Gamma');

    // Filter -> Beta
    const filter = page.locator('input.document-filter-input');
    await filter.fill('Beta');

    // Only Beta remains
    const itemsContainer = page.locator('.document-list-items-container');
    await expect(itemsContainer).toContainText('Beta');
    await expect(itemsContainer).not.toContainText('Alpha');
    await expect(itemsContainer).not.toContainText('Gamma');

    // Navigate to Beta
    await itemsContainer.getByRole('link', { name: 'Beta' }).click();
    await expect(page).toHaveURL(new RegExp(`#/collections/${TEST_COLL}/0002$`));

    // Title shows collection + label
    await expect(page.locator('.document-item-header h1')).toHaveText(/Test document collection: Beta/i);
});
