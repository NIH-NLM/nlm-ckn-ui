import { renderHook, waitFor } from "@testing-library/react";
import { fetchGraphData } from "services";
import { useRelatedDocuments } from "./useRelatedDocuments";

jest.mock("services", () => ({ fetchGraphData: jest.fn() }));

describe("useRelatedDocuments", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists a cell set's dataset first, then its marker and gene sets", async () => {
    fetchGraphData.mockResolvedValue({
      "CS/k": {
        nodes: [{ _id: "BGS/k" }, { _id: "CS/k" }, { _id: "BMC/k" }, { _id: "CSD/d" }],
      },
    });
    const { result } = renderHook(() => useRelatedDocuments({ _id: "CS/k" }));
    await waitFor(() =>
      expect(result.current.map((d) => d._id)).toEqual(["CSD/d", "BMC/k", "BGS/k"]),
    );
    expect(fetchGraphData).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeIds: ["CS/k"],
        depth: 1,
        allowedCollections: ["CSD", "BMC", "BGS"],
      }),
    );
  });

  it("fetches nothing for a collection with no related nodes", () => {
    const { result } = renderHook(() => useRelatedDocuments({ _id: "PUB/p" }));
    expect(result.current).toEqual([]);
    expect(fetchGraphData).not.toHaveBeenCalled();
  });

  it("shows no related cards when the fetch fails", async () => {
    fetchGraphData.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useRelatedDocuments({ _id: "BGS/k" }));
    await waitFor(() => expect(fetchGraphData).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
