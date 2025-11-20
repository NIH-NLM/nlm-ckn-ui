import { expect, test } from '@playwright/test';
import { filterErrorsContaining, getCollectedErrors, installErrorInstrumentation } from './utils/errorInstrumentation';

test('FTU Explorer page loads illustration component', async ({ page }) => {
    await installErrorInstrumentation(page);

    await page.goto('/#/ftu');

    // Check for the custom element (might be hidden if script not loaded, but should be attached)
    const ftuElement = page.locator('hra-medical-illustration');
    await expect(ftuElement).toBeAttached();

    // Mock the illustrations JSON-LD to ensure it "loads" something
    await page.route('https://cdn.humanatlas.io/digital-objects/graph/2d-ftu-illustrations/latest/assets/2d-ftu-illustrations.jsonld', async (route) => {
        return route.fulfill({
            status: 200,
            contentType: 'application/ld+json',
            body: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "ItemList",
                "itemListElement": []
            })
        });
    });

    // Check for expand button
    const expandBtn = page.locator('button.expand-button');
    await expect(expandBtn).toBeVisible();
    await expect(expandBtn).toHaveAttribute('title', 'Expand');

    // Click expand
    await expandBtn.click();
    await expect(expandBtn).toHaveAttribute('title', 'Collapse');
    await expect(page.locator('.ftu-container')).toHaveClass(/fullscreen/);

    // Click collapse
    await expandBtn.click();
    await expect(expandBtn).toHaveAttribute('title', 'Expand');
    await expect(page.locator('.ftu-container')).not.toHaveClass(/fullscreen/);

    // Verify no "split of undefined" errors occurred
    expect(filterErrorsContaining(await getCollectedErrors(page), 'split').length).toBe(0);
});
