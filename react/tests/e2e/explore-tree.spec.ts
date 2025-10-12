import { expect, test } from '@playwright/test';
import { deepChildren, sunburstRoot, treeApiWrapper } from './utils/testSeeds';

// Mock API response: Tree component uses data.children[0] as the root.
// Wrap the desired root under the first child to mimic actual API shape.
const mockApiResponse = treeApiWrapper(sunburstRoot({ label: 'Root', children: deepChildren() }));

test('Explore shows Root then expands to children', async ({ page }) => {
    // Mock the same sunburst endpoint used by Tree for initial data
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

    // Open home and click Explore
    await page.goto('/');
    await page.getByRole('link', { name: 'Explore' }).click();

    // Confirm HashRouter navigation to /tree
    await expect(page).toHaveURL(/#\/tree$/);

    // Expect the TreeConstructor to render an SVG
    const container = page.locator('.tree-constructor-container');
    const svg = container.locator('svg');
    await expect(svg).toBeVisible();

    // Click the root node group to expand children (labels may be truncated or mapped)
    const rootNodeGroup = container.locator('g.node-group').first();
    await expect(rootNodeGroup).toBeVisible();
    await rootNodeGroup.click();

    // Verify children appear after expansion (text is duplicated for stroke/clone, use first())
    await expect(container.getByText('A').first()).toBeVisible();
    await expect(container.getByText('B').first()).toBeVisible();

    // Click one of the children to expand grandchildren
    const aNodeGroup = container.locator('g.node-group', { hasText: 'A' }).first();
    await aNodeGroup.dispatchEvent('click');
    await expect(container.getByText('A1').first()).toBeVisible();
});
