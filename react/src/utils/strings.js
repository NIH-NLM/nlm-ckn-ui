/**
 * String manipulation utilities.
 */

/**
 * Convert string or array of strings to capital case.
 * @param {string|Array<string>} input - Input to convert.
 * @returns {string} Capital cased string.
 */
export const capitalCase = (input) => {
    if (Array.isArray(input)) {
        return input
            .map((str) =>
                typeof str === "string"
                    ? str
                        .split(" ")
                        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(" ")
                    : str,
            )
            .join("|");
    }
    if (typeof input === "string") {
        return input
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
    }
    return input;
};

/**
 * Truncate a string to a maximum length with ellipsis.
 * @param {string} text - Text to truncate.
 * @param {number} maxLength - Maximum length.
 * @returns {string} Truncated string.
 */
export function truncateString(text, maxLength) {
    if (!text || text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength)}...`;
}
