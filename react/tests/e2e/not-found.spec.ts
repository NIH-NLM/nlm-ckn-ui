import { expect, test } from '@playwright/test';
import { filterErrorsContaining, getCollectedErrors, installErrorInstrumentation } from './utils/errorInstrumentation';

test('Navigating to invalid route shows 404 page', async ({ page }) => {
    await installErrorInstrumentation(page);

    await page.goto('/#/invalid-route-12345');

    // Check 404 message
    await expect(page.locator('.not-found-page h1')).toHaveText('404 — Page Not Found');
    await expect(page.locator('text=The page you\'re looking for doesn\'t exist')).toBeVisible();

    // Check link back to home
    const homeLink = page.getByRole('link', { name: 'Return to the home page' });
    await expect(homeLink).toBeVisible();
    await homeLink.click();

    // Verify we are back at home (Search page)
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByPlaceholder('Search NCKN...')).toBeVisible();

    // Verify no "split of undefined" errors occurred
    expect(filterErrorsContaining(await getCollectedErrors(page), 'split').length).toBe(0);
});
