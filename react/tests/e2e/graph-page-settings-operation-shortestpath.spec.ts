import { expect, test } from '@playwright/test';
import { shortestPathGraph, twoOriginRawGraphs } from './utils/testSeeds';

const DOC_COLL = 'TEST_DOCUMENT_COLLECTION';

// Covers: setOperation transitions and shortest path mode.
test('Graph settings: set operation and shortest path', async ({ page }) => {
    const originA = `${DOC_COLL}/ROOT_A`;
    const originB = `${DOC_COLL}/ROOT_B`;

    // Capture bodies
    const postedBodies: any[] = [];

    await page.route('**/arango_api/collections/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([DOC_COLL]) });
        }
        return route.continue();
    });
    await page.route('**/arango_api/edge_filter_options/', async (route) => {
        if (route.request().method() === 'POST') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Label: ['has_child', 'path'] }) });
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

    // Mock graph: per-origin payload; client merges per setOperation
    await page.route('**/arango_api/graph/', async (route) => {
        if (route.request().method() === 'POST') {
            const body = await route.request().postDataJSON();
            postedBodies.push(body);
            if (Array.isArray(body.node_ids) && body.node_ids.length === 2 && body.advanced_settings) {
                // advanced not used
            }
            // Return per-origin raw; UI performs operation
            const payload = twoOriginRawGraphs(originA, originB);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
        }
        return route.continue();
    });

    // Mock shortest path
    await page.route('**/arango_api/shortest_paths/', async (route) => {
        if (route.request().method() === 'POST') {
            const body = await route.request().postDataJSON();
            postedBodies.push(body);
            const sp = shortestPathGraph();
            // Single merged payload
            const graph = { nodes: sp.nodes, links: sp.links };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) });
        }
        return route.continue();
    });

    // Seed two origins
    await page.addInitScript((params: { a: string; b: string }) => {
        (window as any).__E2E__ = true;
        const persistedRoot = {
            nodesSlice: JSON.stringify({ originNodeIds: [params.a, params.b] }),
            savedGraphs: JSON.stringify({ graphs: [] }),
            _persist: JSON.stringify({ version: -1, rehydrated: true }),
        } as any;
        localStorage.setItem('persist:root', JSON.stringify(persistedRoot));
    }, { a: originA, b: originB });

    await page.goto('/#/graph');
    // E2E mode: show graph area immediately
    await page.evaluate(() => { (window as any).__E2E__ = true; });
    // Wait for store
    await page.waitForFunction(() => (window as any).__STORE__ != null);
    const selected = page.locator('.selected-items-container');
    await selected.waitFor({ state: 'visible' });
    // Both origins visible
    await expect(selected).toContainText('ROOT_A');
    await expect(selected).toContainText('ROOT_B');
    // Wait for allowedCollections
    await page.waitForFunction(() => {
        const store: any = (window as any).__STORE__;
        const allowed = store?.getState?.().graph?.present?.settings?.allowedCollections;
        return Array.isArray(allowed) && allowed.length > 0;
    }, { timeout: 10000 });
    // Trigger fetch (thunk)
    await page.evaluate(() => { (window as any).__ACTIONS__.fetchNow(); });
    await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(0);
    const afterFirst = postedBodies.length;
    // Set nodeIds, trigger fetch
    await page.evaluate((ids) => {
        const store: any = (window as any).__STORE__;
        store.dispatch({ type: 'graph/initializeGraph', payload: { nodeIds: ids } });
        (window as any).__ACTIONS__.fetchNow();
    }, [originA, originB]);
    await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(afterFirst);
    // Ensure allowedCollections loaded
    await page.waitForFunction(() => {
        const store: any = (window as any).__STORE__;
        const allowed = store?.getState?.().graph?.present?.settings?.allowedCollections;
        return Array.isArray(allowed) && allowed.length > 0;
    }, { timeout: 10000 });
    // Update setting via Redux
    await page.evaluate(() => {
        const store: any = (window as any).__STORE__;
        store.dispatch({ type: 'graph/updateSetting', payload: { setting: 'depth', value: 1 } });
    });
    // Reinitialize
    await page.evaluate((ids) => {
        const store: any = (window as any).__STORE__;
        store.dispatch({ type: 'graph/initializeGraph', payload: { nodeIds: ids } });
    }, [originA, originB]);

    // Options panel already open

    // SetOperation = Intersection (Redux)
    await page.evaluate(() => {
        const store: any = (window as any).__STORE__;
        store.dispatch({ type: 'graph/updateSetting', payload: { setting: 'setOperation', value: 'Intersection' } });
    });
    // Trigger fetch
    const beforeOp = postedBodies.length;
    await page.evaluate(() => { (window as any).__ACTIONS__.fetchNow(); });
    await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(beforeOp);
    await expect.poll(() => postedBodies.some((b) => Array.isArray(b?.node_ids) && b.node_ids.length === 2 && !b.advanced_settings && !b.shortestPaths), { timeout: 10000 }).toBeTruthy();

    // Enable shortest path (Redux)
    await page.evaluate(() => {
        const store: any = (window as any).__STORE__;
        store.dispatch({ type: 'graph/updateSetting', payload: { setting: 'findShortestPaths', value: true } });
    });
    // Trigger shortest path fetch
    const beforeSP = postedBodies.length;
    await page.evaluate(() => { (window as any).__ACTIONS__.fetchNow(); });
    await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(beforeSP);
    await expect.poll(() => postedBodies.some((b) => Array.isArray(b?.node_ids) && b.node_ids.length === 2 && b.edge_direction && !b.depth && !b.allowed_collections), { timeout: 10000 }).toBeTruthy();

    // No DOM assertions; network-level verification only
});
