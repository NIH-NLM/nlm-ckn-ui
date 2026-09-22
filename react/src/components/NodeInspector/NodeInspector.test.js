import { render, screen } from "@testing-library/react";
import NodeInspector from "./NodeInspector";

jest.mock("hooks", () => ({ useNodeDocument: jest.fn() }));
jest.mock("contexts", () => ({ useFtuParts: jest.fn() }));
jest.mock("utils", () => ({ findFtuUrlById: jest.fn() }));

import { useFtuParts } from "contexts";
import { useNodeDocument } from "hooks";
import { findFtuUrlById } from "utils";

// DocumentCard reads collection config; stub it to a simple marker.
jest.mock("components/DocumentCard", () => ({ document }) => (
  <div data-testid="doc-card">{document?._id}</div>
));

// RelatedCards fetches neighbors; stub it to a marker naming its document.
jest.mock("components/RelatedCards", () => ({ document }) => (
  <div data-testid="related-cards">{document?._id}</div>
));

// LearnExplore uses react-router Link; stub it so this test stays router-free.
jest.mock("components/LearnExplore", () => () => <div data-testid="learn-explore" />);

// FTUIllustration renders a third-party web component; stub it to a simple marker.
jest.mock("components/FTUIllustration", () => ({ selectedIllustration }) => (
  <div data-testid="ftu-illustration">{selectedIllustration}</div>
));

describe("NodeInspector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useFtuParts.mockReturnValue({ ftuParts: [] });
    findFtuUrlById.mockReturnValue(null);
  });

  it("renders the origin document when nothing is selected", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: null });
    render(<NodeInspector selectedNodeId={null} originDocument={{ _id: "CSD/origin" }} />);
    expect(screen.getByTestId("doc-card")).toHaveTextContent("CSD/origin");
    expect(screen.getByTestId("related-cards")).toHaveTextContent("CSD/origin");
    expect(screen.getByTestId("learn-explore")).toBeInTheDocument();
    expect(screen.queryByTestId("ftu-illustration")).not.toBeInTheDocument();
  });

  it("hides Learn & Explore when showLearnExplore is false", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: null });
    render(
      <NodeInspector
        selectedNodeId={null}
        originDocument={{ _id: "CSD/origin" }}
        showLearnExplore={false}
      />,
    );
    expect(screen.getByTestId("doc-card")).toBeInTheDocument();
    expect(screen.queryByTestId("learn-explore")).not.toBeInTheDocument();
  });

  it("hides Learn & Explore on the selected-node view too when showLearnExplore is false", () => {
    useNodeDocument.mockReturnValue({ document: { _id: "CS/abc" }, loading: false, error: null });
    render(<NodeInspector selectedNodeId="CS/abc" showLearnExplore={false} />);
    expect(screen.getByTestId("doc-card")).toHaveTextContent("CS/abc");
    expect(screen.getByTestId("related-cards")).toHaveTextContent("CS/abc");
    expect(screen.queryByTestId("learn-explore")).not.toBeInTheDocument();
  });

  it("renders the FTU illustration in the sidebar when the origin document has one", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: null });
    useFtuParts.mockReturnValue({ ftuParts: [{ id: "CSD_origin" }] });
    findFtuUrlById.mockReturnValue("https://example.com/ftu.jsonld");
    render(<NodeInspector selectedNodeId={null} originDocument={{ _id: "CSD/origin" }} />);
    expect(findFtuUrlById).toHaveBeenCalledWith([{ id: "CSD_origin" }], "CSD_origin");
    expect(screen.getByTestId("ftu-illustration")).toHaveTextContent(
      "https://example.com/ftu.jsonld",
    );
  });

  it("renders the FTU illustration for the selected node's document when it has one", () => {
    useNodeDocument.mockReturnValue({ document: { _id: "CS/abc" }, loading: false, error: null });
    useFtuParts.mockReturnValue({ ftuParts: [{ id: "CS_abc" }] });
    findFtuUrlById.mockReturnValue("https://example.com/pericyte.jsonld");
    render(<NodeInspector selectedNodeId="CS/abc" originDocument={{ _id: "CSD/origin" }} />);
    expect(screen.getByTestId("ftu-illustration")).toHaveTextContent(
      "https://example.com/pericyte.jsonld",
    );
  });

  it("renders an empty-state placeholder when there is no selection and no origin document", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: null });
    const { container } = render(<NodeInspector selectedNodeId={null} originDocument={null} />);
    expect(container.querySelector(".node-inspector-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("learn-explore")).not.toBeInTheDocument();
  });

  it("renders a loading skeleton while fetching a selected node", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: true, error: null });
    const { container } = render(
      <NodeInspector selectedNodeId="CS/abc" originDocument={{ _id: "CSD/origin" }} />,
    );
    expect(container.querySelector(".node-inspector-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("learn-explore")).not.toBeInTheDocument();
  });

  it("renders the selected node's document when loaded", () => {
    useNodeDocument.mockReturnValue({ document: { _id: "CS/abc" }, loading: false, error: null });
    render(<NodeInspector selectedNodeId="CS/abc" originDocument={{ _id: "CSD/origin" }} />);
    expect(screen.getByTestId("doc-card")).toHaveTextContent("CS/abc");
    expect(screen.getByTestId("learn-explore")).toBeInTheDocument();
    expect(screen.queryByTestId("ftu-illustration")).not.toBeInTheDocument();
  });

  it("renders a fallback card on fetch error", () => {
    useNodeDocument.mockReturnValue({ document: null, loading: false, error: new Error("x") });
    const { container } = render(
      <NodeInspector selectedNodeId="CS/err" originDocument={{ _id: "CSD/origin" }} />,
    );
    expect(container.querySelector(".node-inspector-fallback")).toHaveTextContent("CS/err");
    expect(screen.queryByTestId("learn-explore")).not.toBeInTheDocument();
  });
});
