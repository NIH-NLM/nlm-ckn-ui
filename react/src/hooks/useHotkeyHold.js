import { useEffect } from "react";

/**
 * Custom hook to handle press-and-hold hotkey actions.
 * @param {string} key - The key to listen for (e.g., 's').
 * @param {Function} onKeyDown - Callback to fire on keydown event.
 * @param {Function} onKeyUp - Callback to fire on keyup event.
 */
export function useHotkeyHold(key, onKeyDown, onKeyUp) {
  useEffect(() => {
    // Handler for keydown events.
    const handleKeyDown = (event) => {
      // Activate only for specified key, ignores input fields.
      if (
        event.key.toLowerCase() !== key.toLowerCase() ||
        event.target.tagName === "INPUT" ||
        event.target.tagName === "SELECT"
      ) {
        return;
      }
      event.preventDefault();
      if (onKeyDown) {
        onKeyDown();
      }
    };

    // Handler for keyup events.
    const handleKeyUp = (event) => {
      if (event.key.toLowerCase() !== key.toLowerCase()) {
        return;
      }
      event.preventDefault();
      if (onKeyUp) {
        onKeyUp();
      }
    };

    // Bind event listeners to window.
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Cleanup function removes listeners and calls keyup handler on unmount.
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      // Ensures "off" state is triggered if component unmounts while key is held.
      if (onKeyUp) {
        onKeyUp();
      }
    };
  }, [key, onKeyDown, onKeyUp]); // Re-runs effect if key or callbacks change.
}
