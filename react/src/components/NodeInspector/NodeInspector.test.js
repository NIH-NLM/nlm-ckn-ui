import { render, screen } from "@testing-library/react";
import NodeInspector from "./NodeInspector";

jest.mock("hooks", () => ({ useNodeDocument: jest.fn() }));

import { useNodeDocument } from "hooks";

// DocumentCard reads collection config; stub it to a simple marker.
jest.mock("components/DocumentCard", () => ({ document }) => (
  <div data-testid="doc-card">{document?._id}</div>
));

describe("NodeInspector", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the origin document when nothing is selected", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: null });
    render(<NodeInspector selectedNodeId={null} originDocument={{ _id: "CSD/origin" }} />);
    expect(screen.getByTestId("doc-card")).toHaveTextContent("CSD/origin");
  });

  it("renders an empty-state placeholder when there is no selection and no origin document", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: null });
    const { container } = render(<NodeInspector selectedNodeId={null} originDocument={null} />);
    expect(container.querySelector(".node-inspector-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-card")).not.toBeInTheDocument();
  });

  it("renders a loading skeleton while fetching a selected node", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: true, error: null });
    const { container } = render(
      <NodeInspector selectedNodeId="CS/abc" originDocument={{ _id: "CSD/origin" }} />,
    );
    expect(container.querySelector(".node-inspector-loading")).toBeInTheDocument();
  });

  it("renders the selected node's document when loaded", () => {
    useNodeDocument.mockReturnValue({ document: { _id: "CS/abc" }, loading: false, error: null });
    render(<NodeInspector selectedNodeId="CS/abc" originDocument={{ _id: "CSD/origin" }} />);
    expect(screen.getByTestId("doc-card")).toHaveTextContent("CS/abc");
  });

  it("renders a fallback card on fetch error", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: new Error("x") });
    const { container } = render(
      <NodeInspector selectedNodeId="CS/err" originDocument={{ _id: "CSD/origin" }} />,
    );
    expect(container.querySelector(".node-inspector-fallback")).toHaveTextContent("CS/err");
  });
});
