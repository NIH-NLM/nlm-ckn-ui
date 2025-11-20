import { expect, test } from '@playwright/test';
import { filterErrorsContaining, getCollectedErrors, installErrorInstrumentation } from './utils/errorInstrumentation';

// Graph save & load lifecycle: build a graph, save it, load via modal, then delete.
test('Graph save/load lifecycle', async ({ page }) => {
    const DOC_COLL = 'TEST_DOCUMENT_COLLECTION';
    const originA = `${DOC_COLL}/ROOT_A`;
    const originB = `${DOC_COLL}/ROOT_B`;
    const graphName = 'My Saved Graph';
    const postedBodies: any[] = [];

    // Collections
    await page.route('**/arango_api/collections/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([DOC_COLL]) });
        }
        return route.continue();
    });
    // Edge filter options
    await page.route('**/arango_api/edge_filter_options/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Label: ['has_child'] }) });
        }
        return route.continue();
    });
    // Document details
    await page.route('**/arango_api/document/details', async (route) => {
        if (route.request().method() === 'POST') {
            const req = await route.request().postDataJSON();
            const ids: string[] = req.document_ids || [];
            const results = ids.map((id) => ({ _id: id, label: id.split('/')[1] }));
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
        }
        return route.continue();
    });
    // Graph fetch (standard traversal)
    await page.route('**/arango_api/graph/', async (route) => {
        if (route.request().method() === 'POST') {
            const body = await route.request().postDataJSON();
            postedBodies.push(body);
            // Minimal per-origin graphs with some overlap
            const makeNode = (key: string) => ({ _id: `${DOC_COLL}/${key}`, label: key });
            const makeEdge = (k: string, from: string, to: string) => ({ _id: `TEST_EDGE_COLLECTION/${k}`, _key: k, _from: from, _to: to, Label: 'has_child' });

            const rA = makeNode('ROOT_A');
            const rB = makeNode('ROOT_B');
            const mid = makeNode('MID');
            const a1 = makeNode('A1');
            const b1 = makeNode('B1');

            const e_am = makeEdge('E_AM', rA._id, mid._id);
            const e_bm = makeEdge('E_BM', rB._id, mid._id);
            const e_ma1 = makeEdge('E_MA1', mid._id, a1._id);
            const e_mb1 = makeEdge('E_MB1', mid._id, b1._id);

            const payload = {
                [originA]: { nodes: [rA, mid, a1], links: [e_am, e_ma1] },
                [originB]: { nodes: [rB, mid, b1], links: [e_bm, e_mb1] }
            };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
        }
        return route.continue();
    });

    // Seed origins via persisted localStorage before load
    await page.addInitScript((params: { a: string; b: string }) => {
        (window as any).__E2E__ = true;
        const persistedRoot = {
            nodesSlice: JSON.stringify({ originNodeIds: [params.a, params.b] }),
            savedGraphs: JSON.stringify({ savedGraphs: [] }),
            _persist: JSON.stringify({ version: -1, rehydrated: true }),
        } as any;
        localStorage.setItem('persist:root', JSON.stringify(persistedRoot));
    }, { a: originA, b: originB });

    await installErrorInstrumentation(page);
    await page.goto('/#/graph');
    // Force graph mount & wait for store
    await page.evaluate(() => { (window as any).__GRAPH__?.show?.(); });
    await page.waitForFunction(() => (window as any).__STORE__ != null);

    // Ensure graph component is mounted and ready
    await expect(page.locator('#chart-container-wrapper svg')).toBeVisible();

    // Click "Generate Graph" to trigger fetch and render
    const generateBtn = page.getByRole('button', { name: /Generate Graph|Update Graph/i });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // Wait for D3 to render nodes.
    // The mock returns 5 unique nodes (ROOT_A, ROOT_B, MID, A1, B1) and 4 links.
    // Due to collapseOnStart=true, A1 and B1 are collapsed (removed).
    // MID is preserved (non-leaf). ROOT_A and ROOT_B are preserved (origins).
    // So we expect 3 nodes and 2 links (ROOT_A->MID, ROOT_B->MID).
    await expect(page.locator('#chart-container-wrapper svg g.node')).toHaveCount(3, { timeout: 10000 });
    await expect(page.locator('#chart-container-wrapper svg g.link')).toHaveCount(2, { timeout: 10000 });

    // Wait for simulation to end and update store
    await expect.poll(() => page.evaluate(() => (window as any).__STORE__?.getState?.().graph?.present?.graphData?.nodes?.length || 0)).toBeGreaterThanOrEqual(3);

    await page.waitForTimeout(2000);

    // Invoke save via exposed store (simulate prompt & alert bypass)
    await page.evaluate((name) => {
        const store: any = (window as any).__STORE__;
        const state = store.getState();
        const { originNodeIds, settings, graphData } = state.graph.present;
        store.dispatch({ type: 'savedGraphs/saveGraph', payload: { name, originNodeIds, settings, graphData } });
    }, graphName);

    // Open modal (button text: Load Saved Graph)
    const loadButton = page.getByRole('button', { name: 'Load Saved Graph' });
    await loadButton.click();
    // Modal visible
    const modal = page.locator('.modal-content');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(graphName);

    // Click Load inside table row
    const row = modal.locator('tr', { hasText: graphName });
    await row.getByRole('button', { name: 'Load' }).click();
    // Modal closes
    await expect(modal).toBeHidden();

    // Validate savedGraphs slice now contains our saved graph
    const hasSavedGraph = await page.evaluate((name) => {
        const store: any = (window as any).__STORE__;
        return store.getState().savedGraphs.savedGraphs.some((g: any) => g.name === name);
    }, graphName);
    expect(hasSavedGraph).toBeTruthy();

    // Assert no split-related runtime errors captured
    const errors = await getCollectedErrors(page);
    const splitErrors = filterErrorsContaining(errors, 'split');
    expect(splitErrors.length, `Unexpected split errors: ${JSON.stringify(splitErrors)}`).toBe(0);

    // Verify graph restored (check store and visual elements)
    await expect.poll(() => page.evaluate(() => (window as any).__STORE__?.getState?.().graph?.present?.graphData?.nodes?.length || 0)).toBeGreaterThanOrEqual(3);
    await expect(page.locator('g.node')).toHaveCount(3, { timeout: 5000 });
    await expect(page.locator('g.link')).toHaveCount(2, { timeout: 5000 });

    // Re-open modal to delete
    await loadButton.click();
    // Modal visible
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(graphName);

    // Click Delete inside table row
    const rowDeleteButton = modal.getByRole('button', { name: 'Delete' });

    // Handle delete confirmation dialog
    page.once('dialog', dialog => dialog.accept());

    await rowDeleteButton.click();

    // Close modal manually as delete doesn't auto-close
    await modal.locator('.modal-close-button').click();

    // Modal closes
    await expect(modal).toBeHidden();

    // Validate savedGraphs slice no longer contains our graph
    const hasNoSavedGraph = await page.evaluate((name) => {
        const store: any = (window as any).__STORE__;
        return store.getState().savedGraphs.savedGraphs.every((g: any) => g.name !== name);
    }, graphName);
    expect(hasNoSavedGraph).toBeTruthy();
});
