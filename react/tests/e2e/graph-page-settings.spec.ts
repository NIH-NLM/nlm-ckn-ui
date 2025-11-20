import { expect, test } from '@playwright/test';
import { filterErrorsContaining, getCollectedErrors, installErrorInstrumentation } from './utils/errorInstrumentation';
import { smallGraphWithEdges } from './utils/testSeeds';

const COLL = 'TEST_DOCUMENT_COLLECTION';

function buildRawGraph(originId: string) {
    const { root, edges } = smallGraphWithEdges();
    const nodes = [root, ...(root.children || []), ...((root.children?.[0]?.children) || []), ...((root.children?.[1]?.children) || [])];
    const links = edges.map((e, i) => ({ ...e, _key: `${e._from.split('/')[1]}-${e._to.split('/')[1]}-${i}` }));
    return {
        [originId]: {
            nodes,
            links,
        },
    };
}

test('Graph generates from one origin, shows nodes/links, and options toggle affects labels', async ({ page }) => {
    await installErrorInstrumentation(page);

    const originId = `${COLL}/ROOT`;
    const { root, edges } = smallGraphWithEdges();

    // Mock collections, edge filter options
    await page.route('**/arango_api/collections/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([COLL]) });
        }
        return route.continue();
    });
    await page.route('**/arango_api/edge_filter_options/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Label: ['has_child'] }) });
        }
        return route.continue();
    });

    // Mock graph fetch
    await page.route('**/arango_api/graph/', async (route) => {
        if (route.request().method() === 'POST') {
            const raw = buildRawGraph(originId);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(raw) });
        }
        return route.continue();
    });

    // Mock document details
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
        // Persisted slices use JSON-string values
        const persistedRoot = {
            nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
            savedGraphs: JSON.stringify({ graphs: [] }),
            _persist: JSON.stringify({ version: -1, rehydrated: true }),
        } as any;
        localStorage.setItem('persist:root', JSON.stringify(persistedRoot));
    }, originId);

    // Navigate -> Graph (rehydrates state)
    await page.goto('/#/graph');

    // Selected items and Generate button
    const selected = page.locator('.selected-items-container');
    await selected.waitFor({ state: 'visible' });
    await expect(selected).toContainText(/root/i);
    const generateBtn = page.getByRole('button', { name: /Generate Graph|Update Graph/i });
    await expect(generateBtn).toBeVisible();

    // Generate graph
    await generateBtn.click();
    const svg = page.locator('#chart-container-wrapper svg');
    await expect(svg).toBeVisible();
    // Wait for nodes
    const initialNodes = page.locator('g.node');
    await expect(async () => {
        const n = await initialNodes.count();
        expect(n).toBeGreaterThan(0);
    }).toPass();

    // Open options
    const toggleOptions = page.locator('.graph-component-wrapper .toggle-options-button');
    await toggleOptions.click();
    await expect(page.locator('#graph-options-panel')).toBeVisible();

    // Toggle labels on (scope to labels group)
    const labelToggles = page.locator(
        '.labels-toggle-container:has-text("Toggle Labels:") .labels-toggle .switch input[type="checkbox"]',
    );
    await labelToggles.evaluateAll((inputs: Element[]) => {
        (inputs as HTMLInputElement[]).forEach((input) => {
            const cb = input as HTMLInputElement;
            if (!cb.checked) {
                cb.click();
            }
        });
    });

    // Verify no "split of undefined" errors occurred
    expect(filterErrorsContaining(await getCollectedErrors(page), 'split').length).toBe(0);
});

test('Graph export buttons exist and trigger download', async ({ page }) => {
    await installErrorInstrumentation(page);
    const originId = `${COLL}/ROOT`;

    // Mock Search
    await page.route('**/arango_api/search/', async (route) => {
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ _id: originId, label: 'Root Node' }])
        });
    });

    // Mock Graph APIs
    await page.route('**/arango_api/collections/', async (route) => route.fulfill({ status: 200, body: JSON.stringify([COLL]) }));
    await page.route('**/arango_api/edge_filter_options/', async (route) => route.fulfill({ status: 200, body: JSON.stringify({ Label: ['has_child'] }) }));
    await page.route('**/arango_api/graph/', async (route) => route.fulfill({ status: 200, body: JSON.stringify(buildRawGraph(originId)) }));
    await page.route('**/arango_api/document/details', async (route) => route.fulfill({ status: 200, body: JSON.stringify([{ _id: originId, label: 'Root Node' }]) }));

    // Go to Search Page
    await page.goto('/');

    // Search
    await page.getByPlaceholder('Search NCKN...').fill('Root Node');
    // Wait for results
    await page.locator('.unified-search-results-list').waitFor({ state: 'visible' });

    // Add to Graph
    await page.getByTitle('Add to Graph').first().click();

    // Go to Graph Page
    await page.goto('/#/graph');

    // Wait for selected items
    await page.locator('.selected-items-container').waitFor({ state: 'visible' });

    // Generate Graph
    await page.getByRole('button', { name: /Generate Graph|Update Graph/i }).click();
    await page.locator('#chart-container-wrapper svg').waitFor({ state: 'visible' });

    // Open options
    await page.locator('.graph-component-wrapper .toggle-options-button').click();

    // Switch to Export tab
    await page.getByRole('button', { name: 'Export' }).click();

    // Check buttons
    const svgBtn = page.getByRole('button', { name: 'Download as SVG' });
    const pngBtn = page.getByRole('button', { name: 'Download as PNG' });
    const jsonBtn = page.getByRole('button', { name: 'Download as JSON' });

    await expect(svgBtn).toBeVisible();
    await expect(pngBtn).toBeVisible();
    await expect(jsonBtn).toBeVisible();

    // Verify click triggers download
    const downloadPromise = page.waitForEvent('download');
    await jsonBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.json');
});

test('Graph node click opens popup with actions', async ({ page }) => {
    await installErrorInstrumentation(page);
    const originId = `${COLL}/ROOT`;

    // Mock setup
    await page.route('**/arango_api/collections/', async (route) => route.fulfill({ status: 200, body: JSON.stringify([COLL]) }));
    await page.route('**/arango_api/edge_filter_options/', async (route) => route.fulfill({ status: 200, body: JSON.stringify({ Label: ['has_child'] }) }));
    await page.route('**/arango_api/graph/', async (route) => route.fulfill({ status: 200, body: JSON.stringify(buildRawGraph(originId)) }));
    await page.route('**/arango_api/document/details', async (route) => route.fulfill({ status: 200, body: JSON.stringify([{ _id: originId, label: 'Root Node' }]) }));

    // Seed state
    await page.addInitScript((origin) => {
        const persistedRoot = {
            nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
            savedGraphs: JSON.stringify({ graphs: [] }),
            _persist: JSON.stringify({ version: -1, rehydrated: true }),
        } as any;
        localStorage.setItem('persist:root', JSON.stringify(persistedRoot));
    }, originId);

    await page.goto('/#/graph');
    await page.locator('.selected-items-container').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Generate Graph|Update Graph/i }).click();

    // Wait for nodes
    const node = page.locator('g.node').first();
    await node.waitFor({ state: 'visible' });

    // Force right-click because the popup is triggered by contextmenu
    await node.click({ button: 'right', force: true });

    // Check popup
    const popup = page.locator('.document-popup');
    await expect(popup).toBeVisible();

    // Check buttons
    await expect(popup.getByText(/Go To/)).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Expand' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Collapse Leaves' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Remove Node' })).toBeVisible();
});
