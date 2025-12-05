/**
 * Platform detection utilities.
 */

/**
 * Check if the current platform is macOS.
 */
export const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
