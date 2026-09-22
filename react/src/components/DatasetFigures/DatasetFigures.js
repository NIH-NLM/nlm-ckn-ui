import { useEffect, useRef, useState } from "react";
import { getDatasetFigures } from "utils";

/**
 * Quality-control figures published for a cell set dataset (nlm-ckn#283).
 *
 * Renders nothing for any document with no published figures, which includes
 * every collection other than CSD and the cell set datasets that have no
 * NS-Forest QC output.
 *
 * All three figures are shown inline, scaled to the sidebar. That is enough to
 * read a figure's shape but not its labels, so each one opens full size in a
 * modal — which is also the only place the interactive silhouette page fits,
 * being authored at a fixed 1800x900.
 *
 * The images load only once scrolled to. The dendrogram and silhouette summary
 * are a few kilobytes, but a stacked violin plot has a median of 1.2 MB and
 * reaches 10.7 MB, and this section sits below the graph, off the first screen.
 * @param {object} props
 * @param {object} props.document - The document being inspected.
 */
const DatasetFigures = ({ document }) => {
  const [openFigure, setOpenFigure] = useState(null);
  const figures = getDatasetFigures(document);

  // Escape closes the modal, matching what the browser's own dialogs do. Bound
  // only while one is open so this adds no listener to ordinary browsing.
  useEffect(() => {
    if (!openFigure) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenFigure(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openFigure]);

  if (figures.length === 0) {
    return null;
  }

  return (
    <section className="dataset-figures">
      <h3 className="dataset-figures-title">Figures</h3>
      <div className="dataset-figures-grid">
        {figures.map((figure) => (
          <figure className="dataset-figure" key={figure.key}>
            <button
              type="button"
              className="dataset-figure-open"
              onClick={() => setOpenFigure(figure)}
              title={`${figure.label} — click to enlarge`}
            >
              <LazyFigureImage figure={figure} />
            </button>
            <figcaption className="dataset-figure-caption">{figure.caption}</figcaption>
          </figure>
        ))}
      </div>
      {openFigure && <FigureModal figure={openFigure} onClose={() => setOpenFigure(null)} />}
    </section>
  );
};

/**
 * A figure's image, fetched only once it is scrolled near the viewport.
 *
 * `loading="lazy"` is not enough on its own: measured here, Chromium fetched all
 * three immediately, the violin plot included. The observer watches an empty
 * slot that reserves a little height, so the three figures are far enough apart
 * to resolve separately rather than all becoming visible at once.
 * @param {object} props
 * @param {object} props.figure - The figure to show, from getDatasetFigures.
 */
const LazyFigureImage = ({ figure }) => {
  const slotRef = useRef(null);
  // Where there is no observer — jsdom, or a browser without it — show the
  // image rather than nothing at all.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const slot = slotRef.current;
    if (inView || !slot) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      // A small margin so scrolling to a figure does not land on an empty box,
      // but not so large that resting above the section fetches it.
      { rootMargin: "100px" },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <span className="dataset-figure-slot" ref={slotRef}>
      {inView && (
        <img className="dataset-figure-image" src={figure.src} alt={figure.label} loading="lazy" />
      )}
    </span>
  );
};

/**
 * One figure at full size, over the page.
 * @param {object} props
 * @param {object} props.figure - The figure to show, from getDatasetFigures.
 * @param {Function} props.onClose - Called to dismiss the modal.
 */
const FigureModal = ({ figure, onClose }) => (
  <div className="modal-overlay">
    {/* The click-outside affordance is a real button rather than a handler on
        the backdrop, so it is reachable by keyboard like the close button. */}
    <button type="button" className="modal-backdrop" aria-label="Close figure" onClick={onClose} />
    <div
      className="modal-content modal-content-figure"
      role="dialog"
      aria-modal="true"
      aria-label={figure.label}
    >
      <h2 className="dataset-figure-modal-title">{figure.label}</h2>
      <button type="button" className="modal-close-button" onClick={onClose} title="Close">
        ×
      </button>
      {figure.interactiveUrl ? (
        // A self-contained plotly page that loads its own bundle by a path
        // relative to itself, so it is framed at its own URL rather than inlined.
        <iframe
          className="dataset-figure-modal-frame"
          src={figure.interactiveUrl}
          title={figure.label}
        />
      ) : (
        <img className="dataset-figure-modal-image" src={figure.src} alt={figure.caption} />
      )}
      <p className="dataset-figure-caption">{figure.caption}</p>
      <a className="external-link" href={figure.src} target="_blank" rel="noopener noreferrer">
        Open the SVG in a new tab
      </a>
    </div>
  </div>
);

export default DatasetFigures;
