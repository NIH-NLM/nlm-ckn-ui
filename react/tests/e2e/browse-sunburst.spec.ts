import { expect, test } from '@playwright/test';
import { deepChildren, sunburstRoot } from './utils/testSeeds';

// Minimal hierarchical data with grandchildren
const mockRoot = sunburstRoot({ children: deepChildren() });

test('Browse loads Sunburst visualization', async ({ page }) => {
    // Mock the Sunburst root fetch
    await page.route('**/arango_api/sunburst/', async (route) => {
        const req = route.request();
        if (req.method() === 'POST') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockRoot),
            });
        }
        return route.continue();
    });

    // Go to homepage and click Browse in the header
    await page.goto('/');
    await page.getByRole('link', { name: 'Browse' }).click();

    // HashRouter navigation
    await expect(page).toHaveURL(/#\/sunburst$/);

    // Expect the sunburst SVG to be appended inside the container
    const svg = page.locator('#sunburst-container svg');
    await expect(svg).toBeVisible();

    // And at least one child arc/path (non-root) should exist
    const childPath = page.locator('#sunburst-container svg path:not([fill="none"])').first();
    await expect(childPath).toBeVisible();

    // Click a child arc to zoom and reveal grandchildren labels (dispatch event to avoid overlay)
    await childPath.dispatchEvent('click');

    // Expect one of the grandchild labels to be visible as a <text> element (avoid hidden <title>)
    const visibleGrandchildLabel = page.locator(
        '#sunburst-container svg text:has-text("A1"), #sunburst-container svg text:has-text("B1")'
    ).first();
    await expect(visibleGrandchildLabel).toBeVisible();
});
