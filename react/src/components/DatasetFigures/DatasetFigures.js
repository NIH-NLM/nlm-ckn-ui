import { useEffect, useRef, useState } from "react";
import { getDatasetFigures } from "utils";

/**
 * Quality-control figures published for a cell set dataset (nlm-ckn#283), as
 * cards in the graph workspace's bottom strip (its Figures view).
 *
 * Renders nothing for any document with no published figures, which includes
 * every collection other than CSD and the cell set datasets that have no
 * NS-Forest QC output.
 *
 * A card shows a thumbnail, enough to recognise the figure but not read it, so
 * each one opens full size in a modal — which is also the only place the
 * interactive silhouette page fits, being authored at a fixed 1800x900.
 *
 * The strip mounts this only when its Figures view is chosen, and each image
 * waits until its card is in view: a stacked violin plot has a median of 1.2 MB
 * and reaches 10.7 MB.
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
    <div className="dataset-figure-strip">
      {figures.map((figure) => (
        <button
          type="button"
          className="dataset-figure-card"
          key={figure.key}
          onClick={() => setOpenFigure(figure)}
          title={`${figure.caption} Click to open full size.`}
        >
          <span className="dataset-figure-card-title">{figure.label}</span>
          <LazyFigureImage figure={figure} />
        </button>
      ))}
      {openFigure && <FigureModal figure={openFigure} onClose={() => setOpenFigure(null)} />}
    </div>
  );
};

/**
 * A figure's image, fetched only once its card is scrolled into the strip.
 *
 * `loading="lazy"` is not enough on its own: measured here, Chromium fetched all
 * three immediately, the violin plot included.
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
        // Decorative: the card's title already names the figure.
        <img className="dataset-figure-image" src={figure.src} alt="" loading="lazy" />
      )}
    </span>
  );
};

/**
 * One figure at full size, over the page.
 *
 * Focus moves to the close button on open, Tab cycles within the dialog, and
 * focus returns to whatever opened it on every way of closing.
 * @param {object} props
 * @param {object} props.figure - The figure to show, from getDatasetFigures.
 * @param {Function} props.onClose - Called to dismiss the modal.
 */
const FigureModal = ({ figure, onClose }) => {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    // Tab inside the interactive frame is handled by the frame's own document,
    // so trapTab never sees it leave; bring back any focus that lands outside.
    const keepFocusInside = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) {
        closeRef.current?.focus();
      }
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      opener?.focus?.();
    };
  }, []);

  // Every Tab is moved by hand rather than only at the ends: Safari skips links
  // when tabbing by default, so from the close button its own Tab would pass
  // the dialog's link and leave the dialog.
  const trapTab = (event) => {
    if (event.key !== "Tab") {
      return;
    }
    const focusable = [...dialogRef.current.querySelectorAll("button, a[href], iframe")];
    const current = focusable.indexOf(document.activeElement);
    const count = focusable.length;
    let next;
    if (current === -1) {
      next = event.shiftKey ? count - 1 : 0;
    } else {
      next = (current + (event.shiftKey ? -1 : 1) + count) % count;
    }
    event.preventDefault();
    focusable[next].focus();
  };

  // Key events inside the frame never reach the parent window, so Escape is
  // bound in the frame too. The plots are same-origin; were one not, reading
  // its window throws and Escape works only outside the frame.
  const bindFrameEscape = (event) => {
    try {
      event.target.contentWindow.addEventListener("keydown", (keyEvent) => {
        if (keyEvent.key === "Escape") {
          onClose();
        }
      });
    } catch {
      // Cross-origin frame: nothing to bind.
    }
  };

  return (
    <div className="modal-overlay">
      {/* Out of the tab order: Escape and the close button already dismiss the
          modal from the keyboard, and a focusable backdrop let Tab leave it. */}
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close figure"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="modal-content modal-content-figure"
        role="dialog"
        aria-modal="true"
        aria-label={figure.label}
        onKeyDown={trapTab}
      >
        <h2 className="dataset-figure-modal-title">{figure.label}</h2>
        <button
          ref={closeRef}
          type="button"
          className="modal-close-button"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
        {figure.interactiveUrl ? (
          // A self-contained plotly page that loads its own bundle by a path
          // relative to itself, so it is framed at its own URL rather than inlined.
          <iframe
            className="dataset-figure-modal-frame"
            src={figure.interactiveUrl}
            title={figure.label}
            onLoad={bindFrameEscape}
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
};

export default DatasetFigures;
