import { renderHook, waitFor } from "@testing-library/react";

jest.mock("../../../services", () => ({
  fetchNodeDetailsByIds: jest.fn(),
}));

import { fetchNodeDetailsByIds } from "../../../services";
import { useNodeNames } from "./useNodeNames";

describe("useNodeNames", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  // Regression: when the backend has no details for an origin node id, the
  // details endpoint returns an empty array. The hook must not refetch that id
  // in an infinite loop (which floods the server with POST /document/details).
  it("fetches a missing origin id at most once even when the backend returns no details", async () => {
    fetchNodeDetailsByIds.mockResolvedValue([]);
    const graphData = { nodes: [] }; // id not present in graph -> name is "missing"
    const originNodeIds = ["CS/unknown"];

    renderHook(() => useNodeNames(graphData, originNodeIds, "phenotypes"));

    await waitFor(() => expect(fetchNodeDetailsByIds).toHaveBeenCalled());
    // Give the effect several ticks to (incorrectly) loop if the bug is present.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(fetchNodeDetailsByIds).toHaveBeenCalledTimes(1);
  });

  it("resolves and caches an origin id when the backend returns details, fetching once", async () => {
    fetchNodeDetailsByIds.mockResolvedValue([{ _id: "CS/known", label: "Known" }]);

    const { result } = renderHook(() => useNodeNames({ nodes: [] }, ["CS/known"], "phenotypes"));

    await waitFor(() => expect(fetchNodeDetailsByIds).toHaveBeenCalled());
    await waitFor(() => expect(result.current.cachedNames["CS/known"]).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchNodeDetailsByIds).toHaveBeenCalledTimes(1);
  });
});
