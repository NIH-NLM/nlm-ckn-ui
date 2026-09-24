import { fireEvent, render, screen } from "@testing-library/react";
import plotManifest from "assets/plot-manifest.json";
import DatasetFigures from "./DatasetFigures";

// A cell set dataset that the committed manifest has figures for, addressed the
// way the app does: anatomical structure plus the last six characters of the
// dataset UUID.
const [manifestKey] = Object.keys(plotManifest.datasets);
const [anatomy, hash] = manifestKey.split("/");
const datasetDocument = { _id: `CSD/00000000-0000-0000-0000-0000${hash}__${anatomy}` };

const openFigure = (name) => fireEvent.click(screen.getByRole("button", { name }));

describe("DatasetFigures", () => {
  it("shows every published figure inline", () => {
    render(<DatasetFigures document={datasetDocument} />);
    const images = document.querySelectorAll(".dataset-figure-image");
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image).toHaveAttribute("src", expect.stringContaining(`/plots/${plotManifest.tag}/`));
    }
  });

  it("defers the inline images until they are scrolled to", () => {
    // The real browser measurement that motivated this: loading="lazy" alone
    // fetched all three immediately, the 1.2 MB violin plot included.
    const observe = jest.fn();
    const originalObserver = window.IntersectionObserver;
    window.IntersectionObserver = jest.fn(() => ({
      observe,
      disconnect: jest.fn(),
      unobserve: jest.fn(),
    }));
    try {
      render(<DatasetFigures document={datasetDocument} />);
      expect(document.querySelectorAll(".dataset-figure-image")).toHaveLength(0);
      expect(observe).toHaveBeenCalled();
    } finally {
      window.IntersectionObserver = originalObserver;
    }
  });

  it("shows the images where there is no observer to defer with", () => {
    const originalObserver = window.IntersectionObserver;
    window.IntersectionObserver = undefined;
    try {
      render(<DatasetFigures document={datasetDocument} />);
      expect(document.querySelectorAll(".dataset-figure-image").length).toBeGreaterThan(0);
    } finally {
      window.IntersectionObserver = originalObserver;
    }
  });

  it("renders nothing for a document with no published figures", () => {
    const { container } = render(<DatasetFigures document={{ _id: "CS/some-cell-set" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing rather than throwing when there is no document", () => {
    const { container } = render(<DatasetFigures document={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows no modal until a figure is clicked", () => {
    render(<DatasetFigures document={datasetDocument} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the clicked figure in a modal", () => {
    render(<DatasetFigures document={datasetDocument} />);
    openFigure(/Cell set dendrogram/);
    expect(screen.getByRole("dialog", { name: "Cell set dendrogram" })).toBeInTheDocument();
  });

  it("frames the interactive page in the modal, where it has room to render", () => {
    render(<DatasetFigures document={datasetDocument} />);
    openFigure(/Silhouette and F-beta scores/);
    expect(screen.getByTitle("Silhouette and F-beta scores").tagName).toBe("IFRAME");
  });

  it("closes on Escape", () => {
    render(<DatasetFigures document={datasetDocument} />);
    openFigure(/Cell set dendrogram/);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on a click on the backdrop, which is out of the tab order", () => {
    render(<DatasetFigures document={datasetDocument} />);
    openFigure(/Cell set dendrogram/);
    const backdrop = screen.getByRole("button", { name: "Close figure" });
    expect(backdrop).toHaveAttribute("tabindex", "-1");
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape pressed inside the interactive frame", () => {
    render(<DatasetFigures document={datasetDocument} />);
    openFigure(/Silhouette and F-beta scores/);
    const frame = screen.getByTitle("Silhouette and F-beta scores");
    fireEvent.load(frame);
    fireEvent.keyDown(frame.contentWindow, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focuses the close button on open and returns focus to the figure on close", () => {
    render(<DatasetFigures document={datasetDocument} />);
    const trigger = screen.getByRole("button", { name: /Cell set dendrogram/ });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTitle("Close")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab within the modal", () => {
    render(<DatasetFigures document={datasetDocument} />);
    openFigure(/Cell set dendrogram/);
    const close = screen.getByTitle("Close");
    const link = screen.getByRole("link", { name: "Open the SVG in a new tab" });
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(link).toHaveFocus();
    fireEvent.keyDown(link, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("brings focus back when it lands outside the dialog", () => {
    // Tab out of the interactive frame is handled by the frame, not trapTab.
    render(
      <>
        <button type="button">Behind the modal</button>
        <DatasetFigures document={datasetDocument} />
      </>,
    );
    openFigure(/Silhouette and F-beta scores/);
    screen.getByRole("button", { name: "Behind the modal" }).focus();
    expect(screen.getByTitle("Close")).toHaveFocus();
  });

  it("moves Tab through the dialog itself, not only at its ends", () => {
    // Safari skips links when tabbing, so its own Tab from the close button
    // would leave the dialog; every Tab is handled here instead.
    render(<DatasetFigures document={datasetDocument} />);
    openFigure(/Cell set dendrogram/);
    const close = screen.getByTitle("Close");
    fireEvent.keyDown(close, { key: "Tab" });
    expect(screen.getByRole("link", { name: "Open the SVG in a new tab" })).toHaveFocus();
  });
});
