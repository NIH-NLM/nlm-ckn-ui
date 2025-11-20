import { useEffect, useRef, useState } from "react";
import InfoPopup from "../InfoPopup/InfoPopup";

const ExpandIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <title>Expand</title>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);

const CollapseIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <title>Collapse</title>
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
);

// This component comes from https://apps.humanatlas.io/us6
const FTUIllustration = ({ selectedIllustration, illustrations }) => {
  const [popupData, setPopupData] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const ftuRef = useRef();

  // State to manage fullscreen mode
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    const ftu = document.getElementsByTagName("hra-medical-illustration")[0];
    if (!ftu) return;

    const handleCellClick = (event) => {
      if (!event.detail?.representation_of || !event.detail?.svg_id) {
        return;
      }

      // Get event data details
      const id = event.detail.representation_of.split("/").pop().replace("_", "/");
      const label = event.detail.label;
      setPopupData({ id, label });

      // Find web component rect
      const rect = ftuRef.current.getBoundingClientRect();
      setPopupPosition({ x: rect.left, y: rect.top });
    };

    // Add event listener
    ftu.addEventListener("cell-click", handleCellClick);

    // Cleanup
    return () => {
      ftu.removeEventListener("cell-click", handleCellClick);
    };
  }, []);

  const handleClosePopup = () => {
    setPopupData(null);
  };

  const toggleFullScreen = () => {
    setIsFullScreen(!isFullScreen);
  };

  // Apply dynamic class based on state
  const containerClasses = `ftu-container ${isFullScreen ? "fullscreen" : "max-height-limited"}`;

  return (
    <div className={containerClasses}>
      <button
        type="button"
        onClick={toggleFullScreen}
        className="expand-button"
        title={isFullScreen ? "Collapse" : "Expand"}
      >
        {isFullScreen ? <CollapseIcon /> : <ExpandIcon />}
      </button>

      <hra-medical-illustration
        selected-illustration={selectedIllustration}
        illustrations={illustrations}
        ref={ftuRef}
      ></hra-medical-illustration>

      <InfoPopup data={popupData} position={popupPosition} onClose={handleClosePopup} />
    </div>
  );
};

export default FTUIllustration;
