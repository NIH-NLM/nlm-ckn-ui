/**
 * API-layer tests for graph.js edge filter forwarding (regression coverage for #245).
 * Mocks postJson so each function-under-test is asserted on the exact request body it builds.
 */

jest.mock("./fetchWrapper", () => ({
  ...jest.requireActual("./fetchWrapper"),
  postJson: jest.fn(() => Promise.resolve({})),
}));

import { postJson } from "./fetchWrapper";
import {
  fetchConnectingPaths,
  fetchEdgesBetween,
  fetchGraphData,
  fetchNodeExpansion,
} from "./graph";

// postJson is called as postJson(endpoint, body, ...) — body is the 2nd positional arg.
beforeEach(() => postJson.mockClear());

describe("graph API forwards edge filters", () => {
  it("fetchNodeExpansion forwards edge_filters and exclude_edge_filters (regression for #245)", async () => {
    await fetchNodeExpansion(
      "CL/1",
      "ontologies",
      ["CL"],
      true,
      { Label: ["IS_A"] },
      { Label: ["DERIVES_FROM"] },
    );
    const [, body] = postJson.mock.calls[0];
    expect(body.edge_filters).toEqual({ Label: ["IS_A"] });
    expect(body.exclude_edge_filters).toEqual({ Label: ["DERIVES_FROM"] });
    expect(body.node_ids).toEqual(["CL/1"]);
  });

  it("fetchNodeExpansion defaults filters to empty objects (no hardcoded only-{} regression)", async () => {
    await fetchNodeExpansion("CL/1", "ontologies", ["CL"], true);
    const [, body] = postJson.mock.calls[0];
    expect(body.edge_filters).toEqual({});
    expect(body.exclude_edge_filters).toEqual({});
  });

  it("fetchGraphData standard branch forwards exclude_edge_filters", async () => {
    await fetchGraphData({
      nodeIds: ["CL/1"],
      depth: 1,
      edgeDirection: "ANY",
      allowedCollections: ["CL"],
      nodeLimit: 100,
      graphType: "ontologies",
      edgeFilters: { Label: ["IS_A"] },
      excludeEdgeFilters: { Label: ["DERIVES_FROM"] },
    });
    const [, body] = postJson.mock.calls[0];
    expect(body.edge_filters).toEqual({ Label: ["IS_A"] });
    expect(body.exclude_edge_filters).toEqual({ Label: ["DERIVES_FROM"] });
  });

  it("fetchEdgesBetween forwards both filter dicts", async () => {
    await fetchEdgesBetween(
      ["CL/1", "CL/2"],
      "ontologies",
      { Label: ["IS_A"] },
      { Label: ["DERIVES_FROM"] },
    );
    const [, body] = postJson.mock.calls[0];
    expect(body.edge_filters).toEqual({ Label: ["IS_A"] });
    expect(body.exclude_edge_filters).toEqual({ Label: ["DERIVES_FROM"] });
  });

  it("fetchGraphData shortest-path branch intentionally omits edge filters (documented limitation)", async () => {
    await fetchGraphData({
      nodeIds: ["CL/1", "CL/2"],
      shortestPaths: true,
      edgeDirection: "ANY",
      graphType: "ontologies",
      edgeFilters: { Label: ["IS_A"] },
      excludeEdgeFilters: { Label: ["DERIVES_FROM"] },
    });
    const [, body] = postJson.mock.calls[0];
    expect(body.edge_filters).toBeUndefined();
    expect(body.exclude_edge_filters).toBeUndefined();
    expect(body.node_ids).toEqual(["CL/1", "CL/2"]);
  });

  it("fetchConnectingPaths forwards exclude_edge_filters", async () => {
    await fetchConnectingPaths({
      nodeIds: ["CL/1", "CL/2"],
      graphType: "phenotypes",
      allowedCollections: [],
      edgeFilters: {},
      excludeEdgeFilters: { Label: ["DERIVES_FROM"] },
    });
    const [, body] = postJson.mock.calls[0];
    expect(body.exclude_edge_filters).toEqual({ Label: ["DERIVES_FROM"] });
  });
});
