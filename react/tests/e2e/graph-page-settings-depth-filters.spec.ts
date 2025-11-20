import { expect, test } from '@playwright/test';
import { filterErrorsContaining, getCollectedErrors, installErrorInstrumentation } from './utils/errorInstrumentation';
import { OTHER_COLL, smallGraphWithEdges } from './utils/testSeeds';

const DOC_COLL = 'TEST_DOCUMENT_COLLECTION';

// Raw graph keyed by origin id
function buildRaw(originId: string) {
    const { root, edges } = smallGraphWithEdges();
    const nodes = [root, ...(root.children || []), ...((root.children?.[0]?.children) || []), ...((root.children?.[1]?.children) || [])];
    const links = edges.map((e, i) => ({ ...e, _key: `${e._from.split('/')[1]}-${e._to.split('/')[1]}-${i}` }));
    return { [originId]: { nodes, links } };
}

// Covers: depth, traversal direction, allowedCollections, edge filters.
test('Graph settings: depth, direction, collections, edge filters', async ({ page }) => {
    await installErrorInstrumentation(page);

    const originId = `${DOC_COLL}/ROOT`;

    // Capture POST bodies
    const postedBodies: any[] = [];

    await page.route('**/arango_api/collections/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([DOC_COLL, OTHER_COLL]) });
        }
        return route.continue();
    });
    await page.route('**/arango_api/edge_filter_options/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Label: ['has_child', 'path'] }) });
        }
        return route.continue();
    });
    await page.route('**/arango_api/graph/', async (route) => {
        if (route.request().method() === 'POST') {
            const body = await route.request().postDataJSON();
            postedBodies.push(body);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildRaw(originId)) });
        }
        return route.continue();
    });
    await page.route('**/arango_api/document/details', async (route) => {
        if (route.request().method() === 'POST') {
            const req = await route.request().postDataJSON();
            const ids: string[] = req.document_ids || [];
            const results = ids.map((id) => ({ _id: id, label: id.split('/')[1] }));
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
        }
        return route.continue();
    });

    // Seed one origin via redux-persist
    await page.addInitScript((origin) => {
        const persistedRoot = {
            nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
            savedGraphs: JSON.stringify({ graphs: [] }),
            _persist: JSON.stringify({ version: -1, rehydrated: true }),
        } as any;
        localStorage.setItem('persist:root', JSON.stringify(persistedRoot));
    }, originId);

    await page.goto('/#/graph');
    const generateBtn = page.getByRole('button', { name: /Generate Graph|Update Graph/i });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();
    const svg = page.locator('#chart-container-wrapper svg');
    await expect(svg).toBeVisible();

    // Open options
    const toggleOptions = page.locator('.graph-component-wrapper .toggle-options-button');
    await toggleOptions.click();
    await expect(page.locator('#graph-options-panel')).toBeVisible();

    // Depth = 1
    await page.selectOption('#depth-select', '1');
    // Traversal = OUTBOUND
    await page.selectOption('#edge-direction-select', 'OUTBOUND');

    // Open Filters tab
    const filtersTab = page.getByRole('button', { name: 'Filters' });
    await filtersTab.click();

    // Collections: disable OTHER_COLL
    const collectionsInput = page.locator('input[placeholder="Search Collections..."]');
    await expect(collectionsInput).toBeVisible();
    await collectionsInput.click();
    const otherItem = page.locator('#tab-panel-collections .dropdown-list .dropdown-item-btn', { hasText: OTHER_COLL });
    await otherItem.click();

    // Edge filters: Label=has_child only
    const labelFilterInput = page.locator('input[placeholder="Search Label..."]');
    await expect(labelFilterInput).toBeVisible();
    await labelFilterInput.click();
    const hasChildItem = page.locator('#tab-panel-collections .dropdown-list .dropdown-item-btn', { hasText: 'has_child' });
    await hasChildItem.click();

    // Regenerate
    await generateBtn.click();

    // Assert request body contains settings
    const found = postedBodies.some((b) => b && b.depth === 1 && b.edge_direction === 'OUTBOUND' && Array.isArray(b.allowed_collections) && b.allowed_collections.includes(DOC_COLL) && !b.allowed_collections.includes(OTHER_COLL) && b.edge_filters && Array.isArray(b.edge_filters.Label) && b.edge_filters.Label.includes('has_child'));

    // Verify no "split of undefined" errors occurred
    expect(filterErrorsContaining(await getCollectedErrors(page), 'split').length).toBe(0);
});
