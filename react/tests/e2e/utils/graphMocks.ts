// Shared API mocking and navigation helpers for graph e2e tests.

import { expect, type Page } from "@playwright/test";

const COLL = "TEST_DOCUMENT_COLLECTION";

type GraphResponse = Record<string, { nodes: unknown[]; links: unknown[] }>;

export interface GraphMockOptions {
  /** Builds the default graph response for initial fetches. */
  buildGraph: (originId: string) => GraphResponse;
  /** Optional builder for deeper graph responses (depth >= 3). */
  buildDeeperGraph?: (originId: string) => GraphResponse;
  /** Builds the expansion response for a single node expand. */
  buildExpansion: (nodeId: string) => GraphResponse;
}

/**
 * Sets up all API route mocks needed for graph tests:
 * collections, edge filter options, graph fetch, and document details.
 */
export async function setupGraphMocks(
  page: Page,
  originId: string,
  options: GraphMockOptions,
) {
  const { buildGraph, buildDeeperGraph, buildExpansion } = options;

  await page.route("**/arango_api/collections/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([COLL]),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/edge_filter_options/", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ Label: ["has_child"] }),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/graph/", async (route) => {
    if (route.request().method() === "POST") {
      const body = await route.request().postDataJSON();

      // Expansion request (depth=1, single node)
      if (body.depth === 1 && body.node_ids?.length === 1) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildExpansion(body.node_ids[0])),
        });
      }

      // Deeper graph for depth >= 3 (when a builder is provided)
      if (buildDeeperGraph && body.depth >= 3) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(buildDeeperGraph(originId)),
        });
      }

      // Default graph fetch
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildGraph(originId)),
      });
    }
    return route.continue();
  });

  await page.route("**/arango_api/document/details", async (route) => {
    if (route.request().method() === "POST") {
      const req = await route.request().postDataJSON();
      const ids: string[] = req.document_ids || [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ids.map((id) => ({ _id: id, label: id.split("/")[1] }))),
      });
    }
    return route.continue();
  });

  await page.addInitScript((origin) => {
    localStorage.setItem(
      "persist:root",
      JSON.stringify({
        nodesSlice: JSON.stringify({ originNodeIds: [origin] }),
        savedGraphs: JSON.stringify({ graphs: [] }),
        _persist: JSON.stringify({ version: -1, rehydrated: true }),
      }),
    );
  }, originId);
}

/**
 * Navigate to the graph page, click Generate Graph, and wait for
 * the expected number of nodes to render.
 */
export async function generateGraphAndWait(page: Page, expectedNodes: number) {
  await page.goto("/#/graph");
  await page.locator(".selected-items-container").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Generate Graph|Update Graph/i }).click();

  const svg = page.locator("#chart-container-wrapper svg");
  await expect(svg).toBeVisible();
  await expect(async () => {
    expect(await page.locator("g.node").count()).toBe(expectedNodes);
  }).toPass({ timeout: 5000 });
}
