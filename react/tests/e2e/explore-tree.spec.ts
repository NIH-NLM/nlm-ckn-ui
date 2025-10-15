import { expect, test } from '@playwright/test';
import { deepChildren, sunburstRoot, treeApiWrapper } from './utils/testSeeds';

// Shape: Tree uses data.children[0] as root; wrap root accordingly.
const mockApiResponse = treeApiWrapper(sunburstRoot({ label: 'Root', children: deepChildren() }));

test('Explore shows Root then expands to children', async ({ page }) => {
    // Mock sunburst for Tree
    await page.route('**/arango_api/sunburst/', async (route) => {
        const req = route.request();
        if (req.method() === 'POST') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockApiResponse),
            });
        }
        return route.continue();
    });

    // Navigate -> Explore
    await page.goto('/');
    await page.getByRole('link', { name: 'Explore' }).click();

    // URL
    await expect(page).toHaveURL(/#\/tree$/);

    // SVG visible
    const container = page.locator('.tree-constructor-container');
    const svg = container.locator('svg');
    await expect(svg).toBeVisible();

    // Expand root
    const rootNodeGroup = container.locator('g.node-group').first();
    await expect(rootNodeGroup).toBeVisible();
    await rootNodeGroup.click();

    // Children visible
    await expect(container.getByText('A').first()).toBeVisible();
    await expect(container.getByText('B').first()).toBeVisible();

    // Expand child
    const aNodeGroup = container.locator('g.node-group', { hasText: 'A' }).first();
    await aNodeGroup.dispatchEvent('click');
    await expect(container.getByText('A1').first()).toBeVisible();
});
