import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";
import { shortestPathGraph, twoOriginRawGraphs } from "./utils/testSeeds";

const DOC_COLL = "TEST_DOCUMENT_COLLECTION";

// Covers: setOperation transitions and shortest path mode.
test("Graph settings: shortest path filters union graph correctly", async ({ page }) => {
  const originA = `${DOC_COLL}/ROOT_A`;
  const originB = `${DOC_COLL}/ROOT_B`;

  // Capture bodies
  // biome-ignore lint/suspicious/noExplicitAny: mock body
  const postedBodies: any[] = [];

  await page.route("**/arango_api/collections/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([DOC_COLL]),
      });
    }
    return route.continue();
  });
  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ Label: { type: "categorical", values: ["has_child", "path"] } }),
      });
    }
    return route.continue();
  });

  // Mock document details
  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      const results = ids.map((id) => ({ _id: id, label: id.split("/")[1] }));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(results),
      });
    }
    return route.continue();
  });

  // Mock graph: per-origin payload; client merges per setOperation
  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();
      postedBodies.push(body);
      if (Array.isArray(body.node_ids) && body.node_ids.length === 2 && body.advanced_settings) {
        // advanced not used
      }
      // Return per-origin raw; UI performs operation
      const payload = twoOriginRawGraphs(originA, originB);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    }
    return route.continue();
  });

  // Mock shortest path using dynamic seed (includes _key on edges)
  await page.route("**/arango_api/shortest_paths/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();
      postedBodies.push(body);
      const graph = shortestPathGraph(body.node_ids[0], body.node_ids[1]);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(graph),
      });
    }
    return route.continue();
  });

  // Seed two origins
  await page.addInitScript(
    (params: { a: string; b: string }) => {
      // biome-ignore lint/suspicious/noExplicitAny: monkey-patching window
      (window as any).__E2E__ = true;
      const persistedRoot = {
        nodesSlice: JSON.stringify({ originNodeIds: [params.a, params.b] }),
        savedGraphs: JSON.stringify({ graphs: [] }),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
        // biome-ignore lint/suspicious/noExplicitAny: mock store
      } as any;
      localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
    },
    { a: originA, b: originB },
  );

  await page.goto("/#/graph");
  // Instrument error capture & console monitoring
  await installErrorInstrumentation(page);

  const generateBtn = page.getByRole("button", { name: /Generate Graph|Update Graph/i });
  await expect(generateBtn).toBeVisible();

  // Wait for store
  // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
  await page.waitForFunction(() => (window as any).__STORE__ != null);
  const selected = page.locator(".selected-items-container");
  await selected.waitFor({ state: "visible" });
  // Both origins visible
  await expect(selected).toContainText("ROOT_A");
  await expect(selected).toContainText("ROOT_B");

  // Ensure graph area mounts deterministically (test hook)
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
    (window as any).__GRAPH__?.show?.();
  });
  const graphArea = page.locator(".graph-display-area");
  await graphArea.waitFor({ state: "visible" });
  await expect(page.locator('svg[aria-label="Graph visualization"]')).toBeVisible();
  // Wait for allowedCollections
  await page.waitForFunction(
    () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
      const store: any = (window as any).__STORE__;
      const allowed = store?.getState?.().graph?.present?.settings?.allowedCollections;
      return Array.isArray(allowed) && allowed.length > 0;
    },
    { timeout: 10000 },
  );
  // Trigger fetch (thunk)
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: accessing custom property
    (window as any).__ACTIONS__.fetchNow();
  });
  await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(0);
  const afterFirst = postedBodies.length;
  // Set nodeIds, trigger fetch
  await page.evaluate(
    (ids) => {
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      const store: any = (window as any).__STORE__;
      store.dispatch({ type: "graph/initializeGraph", payload: { nodeIds: ids } });
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      (window as any).__ACTIONS__.fetchNow();
    },
    [originA, originB],
  );
  await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(afterFirst);
  // Ensure allowedCollections loaded
  await page.waitForFunction(
    () => {
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      const store: any = (window as any).__STORE__;
      const allowed = store?.getState?.().graph?.present?.settings?.allowedCollections;
      return Array.isArray(allowed) && allowed.length > 0;
    },
    { timeout: 10000 },
  );
  // Update setting via Redux
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    const store: any = (window as any).__STORE__;
    store.dispatch({ type: "graph/updateSetting", payload: { setting: "depth", value: 1 } });
    // Disable automatic collapsing so union graph retains all branch nodes
    store.dispatch({
      type: "graph/updateSetting",
      payload: { setting: "collapseOnStart", value: "off" },
    });
    // Disable focus nodes (donut rendering) just to avoid any conditional pruning differences
    store.dispatch({
      type: "graph/updateSetting",
      payload: { setting: "useFocusNodes", value: false },
    });
  });
  // Reinitialize
  await page.evaluate(
    (ids) => {
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      const store: any = (window as any).__STORE__;
      store.dispatch({ type: "graph/initializeGraph", payload: { nodeIds: ids } });
    },
    [originA, originB],
  );

  // Options panel already open

  // Ensure we start from a Union so we have extra branch nodes (Y, Z) present
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    const store: any = (window as any).__STORE__;
    store.dispatch({
      type: "graph/updateSetting",
      payload: { setting: "setOperation", value: "Union" },
    });
  });
  // Trigger fetch for union graph
  const beforeOp = postedBodies.length;
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    (window as any).__ACTIONS__.fetchNow();
  });
  await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(beforeOp);
  await expect
    .poll(
      () =>
        postedBodies.some(
          (b) =>
            Array.isArray(b?.node_ids) &&
            b.node_ids.length === 2 &&
            !b.advanced_settings &&
            !b.shortestPaths,
        ),
      { timeout: 10000 },
    )
    .toBeTruthy();

  // Wait for processed union graphData (set operation applied client-side)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            // biome-ignore lint/suspicious/noExplicitAny: mock usage
            (window as any).__STORE__?.getState?.().graph?.present?.graphData?.nodes?.length || 0,
        ),
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(5); // r, mid, c1, y, z expected
  const unionNodeIds = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    const st: any = (window as any).__STORE__?.getState?.().graph?.present;
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    return (st?.graphData?.nodes || []).map((n: any) => n?.id || n?._id);
  });
  // Sanity: union should contain branch nodes (Y and Z)
  expect(
    unionNodeIds.some((id: string) => id.endsWith("/Y")),
    "Union graph missing Y node",
  ).toBeTruthy();
  expect(
    unionNodeIds.some((id: string) => id.endsWith("/Z")),
    "Union graph missing Z node",
  ).toBeTruthy();

  // Enable shortest path (Redux)
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    const store: any = (window as any).__STORE__;
    store.dispatch({
      type: "graph/updateSetting",
      payload: { setting: "findShortestPaths", value: true },
    });
  });
  // Trigger shortest path fetch
  const beforeSP = postedBodies.length;
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    (window as any).__ACTIONS__.fetchNow();
  });
  await expect.poll(() => postedBodies.length, { timeout: 10000 }).toBeGreaterThan(beforeSP);
  await expect
    .poll(
      () =>
        postedBodies.some(
          (b) =>
            Array.isArray(b?.node_ids) &&
            b.node_ids.length === 2 &&
            b.edge_direction &&
            !b.depth &&
            !b.allowed_collections,
        ),
      { timeout: 10000 },
    )
    .toBeTruthy();

  // Assert shortest path rawData present in store and is reduced (no Y/Z, no has_child edges)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            // biome-ignore lint/suspicious/noExplicitAny: mock usage
            (window as any).__STORE__
              ?.getState?.()
              // biome-ignore lint/suspicious/noExplicitAny: mock usage
              .graph?.present?.rawData?.nodes?.map((n: any) => n._id) || [],
        ),
      { timeout: 10000 },
    )
    .toHaveLength(3); // shortest path nodes: originA, mid, originB
  const spNodeIds = await page.evaluate(
    () =>
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      (window as any).__STORE__
        ?.getState?.()
        // biome-ignore lint/suspicious/noExplicitAny: mock usage
        .graph?.present?.rawData?.nodes?.map((n: any) => n._id) || [],
  );
  expect(
    spNodeIds.every((id: string) => !id.endsWith("/Y") && !id.endsWith("/Z")),
    "Shortest path graph still contains branch nodes Y/Z",
  ).toBeTruthy();
  await expect
    .poll(
      () =>
        page.evaluate(
          // biome-ignore lint/suspicious/noExplicitAny: mock usage
          () => (window as any).__STORE__?.getState?.().graph?.present?.rawData?.links?.length || 0,
        ),
      { timeout: 10000 },
    )
    .toBe(2);
  const spLinkLabels = await page.evaluate(
    () =>
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      (window as any).__STORE__
        ?.getState?.()
        // biome-ignore lint/suspicious/noExplicitAny: mock usage
        .graph?.present?.rawData?.links?.map((l: any) => l.Label) || [],
  );
  expect(
    spLinkLabels.every((lab: string) => lab === "path"),
    "Non-path edges present after shortest path filtering",
  ).toBeTruthy();

  // Capture shape snapshot for diagnostics
  const _shape = await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: mock usage
    const st: any = (window as any).__STORE__?.getState?.().graph?.present;
    return {
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      nodes: (st?.rawData?.nodes || []).map((n: any) => n?._id),
      // biome-ignore lint/suspicious/noExplicitAny: mock usage
      links: (st?.rawData?.links || []).map((l: any) => ({ from: l?._from, to: l?._to })),
    };
  });

  // Verify no "split of undefined" errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);

  // Final validation: ensure shortest path result is strict subset of union nodes (excluding Y/Z)
  const extraInUnion = unionNodeIds.filter((id: string) => !spNodeIds.includes(id));
  expect(
    extraInUnion.some((id: string) => id.endsWith("/Y") || id.endsWith("/Z")),
    "Union vs shortest path difference does not include expected branch nodes",
  ).toBeTruthy();
});
