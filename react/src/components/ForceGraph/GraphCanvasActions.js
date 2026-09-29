import { useEffect, useState } from "react";

/**
 * Bottom-right canvas action bar: origins (optional), full screen, lasso,
 * download.
 *
 * Rendered as a sibling of the canvas wrapper so that wrapper holds ONLY the
 * graph <svg> — useGraphExport and the e2e suite both select
 * `#chart-container-wrapper svg`.
 *
 * @param {object} props
 * @param {Function} [props.onToggleOrigins] - Toggles the origins panel. The
 *   origins button is omitted entirely when this is not supplied.
 * @param {boolean} props.originsOpen - Whether the origins panel is open.
 * @param {number} props.originCount - Origin node count, shown as a badge.
 * @param {boolean} props.lassoMode - Whether lasso selection is armed. Owned by
 *   the parent, which also reads it from the keyboard handler and pushes it into
 *   the D3 instance.
 * @param {Function} props.onToggleLasso - Toggles lasso mode.
 * @param {Function} props.onDownload - Downloads the graph as a PNG.
 * @param {object} [props.fullscreenTargetRef] - Element to show full screen.
 *   The graph resizes itself from a ResizeObserver, so no extra wiring is
 *   needed. The button is omitted where the browser has no Fullscreen API.
 */
function GraphCanvasActions({
  onToggleOrigins,
  originsOpen,
  originCount,
  lassoMode,
  onToggleLasso,
  onDownload,
  fullscreenTargetRef,
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canFullscreen = Boolean(document.fullscreenEnabled && fullscreenTargetRef);

  // Esc and the browser's own controls leave full screen without going through
  // the button, so the label follows the document rather than the last click.
  useEffect(() => {
    const syncFullscreen = () =>
      setIsFullscreen(document.fullscreenElement === fullscreenTargetRef?.current);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, [fullscreenTargetRef]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      fullscreenTargetRef.current?.requestFullscreen();
    }
  };

  return (
    <div className="graph-canvas-actions">
      {onToggleOrigins && (
        <button
          type="button"
          className={`graph-canvas-icon-button graph-canvas-origins${originsOpen ? " active" : ""}`}
          aria-label={`Origins (${originCount})`}
          aria-pressed={originsOpen}
          data-tooltip={`Origins (${originCount})`}
          onClick={onToggleOrigins}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M12 9.6V6.9M12 14.4l-3.6 2.4M12 14.4l3.6 2.4" />
            <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
            <circle cx="12" cy="5.2" r="1.8" />
            <circle cx="6.6" cy="18" r="1.8" />
            <circle cx="17.4" cy="18" r="1.8" />
          </svg>
          {originCount > 0 && (
            <span className="graph-canvas-origins-count" aria-hidden="true">
              {originCount}
            </span>
          )}
        </button>
      )}
      {canFullscreen && (
        <button
          type="button"
          className={`graph-canvas-icon-button graph-canvas-fullscreen${isFullscreen ? " active" : ""}`}
          aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
          aria-pressed={isFullscreen}
          data-tooltip={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
          onClick={toggleFullscreen}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="currentColor"
          >
            {isFullscreen ? (
              <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
            ) : (
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
            )}
          </svg>
        </button>
      )}
      <button
        type="button"
        className={`graph-canvas-icon-button graph-canvas-lasso${lassoMode ? " active" : ""}`}
        aria-label="Lasso select"
        aria-pressed={lassoMode}
        data-tooltip="Drag to select multiple nodes (Shift-drag to add, Esc to exit)"
        onClick={onToggleLasso}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.028 13.252c-.657-.508-1.028-1.098-1.028-1.752c0-1.657 2.686-3 6-3s6 1.343 6 3s-2.686 3-6 3c-.986 0-1.916-.119-2.738-.33" />
          <path d="M7 16c-.735.046-1 .5-1 1s.5 1 1 1" />
          <circle cx="7" cy="18" r="1" />
        </svg>
      </button>
      <button
        type="button"
        className="graph-canvas-icon-button graph-canvas-download"
        aria-label="Download graph"
        data-tooltip="Download graph as PNG"
        onClick={onDownload}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="currentColor"
        >
          <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
        </svg>
      </button>
    </div>
  );
}

export default GraphCanvasActions;
