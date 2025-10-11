import React, { useEffect, useRef } from "react";

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
        ×
      </button>
    </div>
  );
};

export default DocumentPopup;
