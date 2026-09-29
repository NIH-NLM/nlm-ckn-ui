import React, { useEffect, useRef } from "react";
import "./DocumentPopup.css";

/**
 * A DocumentPopup component for context menus.
 * It positions itself based on props and handles closing itself.
 * The content of the popup is passed in as children.
 *
 * @param {boolean} isVisible - Controls whether the popup is rendered.
 * @param {{x: number, y: number}} position - The top/left coordinates for positioning.
 * @param {function} onClose - Callback function to be invoked when the popup should close.
 * @param {React.ReactNode} children - The content to be rendered inside the popup.
 */
const DocumentPopup = ({ isVisible, position, onClose, children }) => {
  const popupRef = useRef(null);

  // Effect to handle clicks outside of the popup to close it.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isVisible, onClose]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={popupRef}
      className="document-popup"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {/* The content is passed in from the parent component */}
      {children}

      <button
        type="button"
        className="document-popup-close-button"
        onClick={onClose}
        aria-label="Close popup"
      >
        {/* The design's close glyph (Figma 683:3977). */}
        <svg aria-hidden="true" focusable="false" viewBox="0 0 12 12" width="12" height="12">
          <path
            fill="currentColor"
            d="M6 7.793 2.195 11.609c-.24.239-.546.358-.918.358s-.678-.12-.918-.358A1.25 1.25 0 0 1 0 10.696c0-.37.12-.674.359-.913l3.815-3.816L.359 2.195A1.24 1.24 0 0 1 0 1.277C0 .905.12.6.359.359.598.12.902 0 1.272 0s.674.12.913.359L6 4.174 9.772.359C10.012.12 10.319 0 10.69 0c.372 0 .678.12.919.359.239.24.358.546.358.918 0 .372-.12.678-.358.918L7.826 5.967l3.783 3.816c.239.239.358.543.358.913 0 .37-.12.674-.358.913-.24.239-.547.358-.919.358-.371 0-.678-.12-.918-.358L6 7.793Z"
          />
        </svg>
      </button>
    </div>
  );
};

export default DocumentPopup;
