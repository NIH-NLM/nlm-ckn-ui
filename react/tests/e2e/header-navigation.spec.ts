import { expect, test } from '@playwright/test';
import { filterErrorsContaining, getCollectedErrors, installErrorInstrumentation } from './utils/errorInstrumentation';

test('Header navigation links work correctly', async ({ page }) => {
    await installErrorInstrumentation(page);

    // Mock common APIs to prevent crashes/overlays
    await page.route('**/arango_api/collections/', async (route) => {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(['TEST_COLLECTION']) });
    });
    await page.route('**/arango_api/edge_filter_options/', async (route) => {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Label: ['has_child'] }) });
    });
    await page.route('**/arango_api/graph/', async (route) => {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.route('**/arango_api/document/details', async (route) => {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route('**/arango_api/sunburst/', async (route) => {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'Root', children: [], _id: 'ROOT/1' }) });
    });

    await page.goto('/');

    // Check active state for Search
    await expect(page.locator('.navbar a[href="#/"] h4')).toHaveClass(/active-nav/);

    // Navigate to Browse
    await page.getByRole('link', { name: 'Browse' }).click();
    await expect(page).toHaveURL(/#\/sunburst$/);
    await expect(page.locator('.navbar a[href="#/sunburst"] h4')).toHaveClass(/active-nav/);

    // Navigate to Explore
    await page.getByRole('link', { name: 'Explore' }).click();
    await expect(page).toHaveURL(/#\/tree$/);
    await expect(page.locator('.navbar a[href="#/tree"] h4')).toHaveClass(/active-nav/);

    // Navigate to Collections
    await page.getByRole('link', { name: 'Collections' }).click();
    await expect(page).toHaveURL(/#\/collections$/);
    await expect(page.locator('.navbar a[href="#/collections"] h4')).toHaveClass(/active-nav/);

    // Navigate to Graph
    await page.getByRole('link', { name: 'Graph' }).click();
    await expect(page).toHaveURL(/#\/graph$/);
    await expect(page.locator('.navbar a[href="#/graph"] h4')).toHaveClass(/active-nav/);

    // Navigate to About
    await page.getByRole('link', { name: 'About' }).click();
    await expect(page).toHaveURL(/#\/about$/);
    await expect(page.locator('.navbar a[href="#/about"] h4')).toHaveClass(/active-nav/);

    // Verify no "split of undefined" errors occurred
    expect(filterErrorsContaining(await getCollectedErrors(page), 'split').length).toBe(0);
});
