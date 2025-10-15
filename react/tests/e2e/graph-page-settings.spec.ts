import { expect, test } from '@playwright/test';
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
                cb.checked = true;
                cb.dispatchEvent(new Event('input', { bubbles: true }));
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    });

    // Assert label visible
    const nodeLabels = page.locator('g.node text.node-label');
    await expect(nodeLabels.first()).toBeVisible();
});
