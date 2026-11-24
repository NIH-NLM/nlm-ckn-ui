import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getNodeLabel } from "utils";
import { buildAdjacency, buildEdgePool, buildNodeIndex } from "utils/solution";
import LinkedNodes from "./LinkedNodes";

const edge = (_id, _from, _to, Label) => ({ _id, _from, _to, Label });
const phaseResults = {
  a: {
    nodes: [{ _id: "PR/P1", label: "CFTR protein", name: "CFTR protein" }, { _id: "GS/CFTR" }],
    links: [
      edge("e1", "CHEMBL/1", "PR/P1", "MOLECULARLY_INTERACTS_WITH"),
      edge("e2", "GS/CFTR", "PR/P1", "PRODUCES"),
    ],
  },
};
const adjacency = buildAdjacency(buildEdgePool(phaseResults));
const nodeIndex = buildNodeIndex(phaseResults, {});

const renderFor = (nodeId) =>
  render(
    <MemoryRouter>
      <LinkedNodes nodeId={nodeId} adjacency={adjacency} nodeIndex={nodeIndex} />
    </MemoryRouter>,
  );

describe("LinkedNodes", () => {
  it("lists an outbound relationship with the neighbor linked", () => {
    renderFor("GS/CFTR");
    expect(screen.getByText("Linked nodes")).toBeInTheDocument();
    expect(screen.getByText(/Produces →/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: getNodeLabel(nodeIndex.get("PR/P1"), "PR") }),
    ).toHaveAttribute("href", "/collections/PR/P1");
  });

  it("marks inbound relationships with a left arrow and falls back to the id", () => {
    renderFor("PR/P1");
    expect(screen.getByText(/Produces ←/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CHEMBL/1" })).toBeInTheDocument();
  });

  it("falls back to the id for an indexed neighbor with no label fields", () => {
    renderFor("PR/P1");
    expect(screen.getByRole("link", { name: "GS/CFTR" })).toBeInTheDocument();
  });

  it("renders nothing when the node has no neighbors", () => {
    const { container } = renderFor("GS/NONE");
    expect(container).toBeEmptyDOMElement();
  });
});

it('keeps a missing label and the string "undefined" as separate groups', () => {
  const results = {
    a: { nodes: [], links: [edge("e1", "GS/A", "PR/1"), edge("e2", "GS/A", "PR/2", "undefined")] },
  };
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <LinkedNodes
        nodeId="GS/A"
        adjacency={buildAdjacency(buildEdgePool(results))}
        nodeIndex={buildNodeIndex(results, {})}
      />
    </MemoryRouter>,
  );
  const duplicateKey = spy.mock.calls.some((args) => String(args[0]).includes("same key"));
  spy.mockRestore();
  expect(duplicateKey).toBe(false);
  expect(screen.getAllByRole("link")).toHaveLength(2);
});
