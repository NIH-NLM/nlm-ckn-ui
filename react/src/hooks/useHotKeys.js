import { useEffect, useRef } from "react";

export function useHotkeys(hotkeys, deps = []) {
  // Use ref to avoid re-renders
  const savedHotkeys = useRef(hotkeys);
  useEffect(() => {
    savedHotkeys.current = hotkeys;
  }, [hotkeys]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Loop through hotkeys
      savedHotkeys.current.forEach((hotkey) => {
        // Check for main key match
        if (event.key.toLowerCase() !== hotkey.key.toLowerCase()) return;

        // Check if shift matches requirement
        const shiftMatch = (hotkey.shiftKey || false) === event.shiftKey;

        // Check if one of the main modifiers (Ctrl or Cmd) is pressed
        const modifierMatch =
          (hotkey.ctrlKey && event.ctrlKey) ||
          (hotkey.metaKey && event.metaKey);

        if (shiftMatch && modifierMatch) {
          event.preventDefault();
          hotkey.handler();
        }
      });
    };

    // Add the event listener when the component mounts
    window.addEventListener("keydown", handleKeyDown);

    // Remove the event listener when the component unmounts
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, deps);
}
