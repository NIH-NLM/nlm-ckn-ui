/**
 * Utilities for CSV generation and file download.
 */

/**
 * Escape and format a value for inclusion in a CSV cell.
 * Arrays are joined with "; ", objects are JSON-stringified,
 * and all values are wrapped in double quotes with internal quotes escaped.
 */
const formatCsvValue = (value) => {
  if (value === null || value === undefined) return '""';
  if (Array.isArray(value)) value = value.join("; ");
  if (typeof value === "object") value = JSON.stringify(value);
  return `"${String(value).replace(/"/g, '""')}"`;
};

/**
 * Generate a CSV string from an array of objects.
 *
 * @param {Object[]} dataArray - The data rows
 * @param {Object} [options]
 * @param {string[]} [options.priorityFields] - Fields to place first in column order
 * @param {string[]} [options.skipFields] - Exact field names to exclude
 * @param {string[]} [options.skipPrefixes] - Prefixes to exclude (e.g. "__")
 * @param {(field: string, item: Object) => *} [options.valueTransform] - Optional per-field value override
 * @returns {string} CSV content
 */
export const generateCsv = (dataArray, options = {}) => {
  if (!dataArray.length) return "";

  const {
    priorityFields = [],
    skipFields = [],
    skipPrefixes = ["__"],
    valueTransform,
  } = options;

  const skipFieldSet = new Set(skipFields);

  // Collect all unique fields, starting with priority fields
  const allFields = new Set(priorityFields);
  for (const item of dataArray) {
    for (const key of Object.keys(item)) {
      if (skipFieldSet.has(key)) continue;
      if (skipPrefixes.some((prefix) => key.startsWith(prefix))) continue;
      allFields.add(key);
    }
  }

  const fieldList = Array.from(allFields);

  // Build CSV header
  const header = fieldList.map((f) => `"${f}"`).join(",");

  // Build CSV rows
  const rows = dataArray.map((item) => {
    return fieldList
      .map((field) => {
        const value = valueTransform ? valueTransform(field, item) : item[field];
        return formatCsvValue(value);
      })
      .join(",");
  });

  return [header, ...rows].join("\n");
};

/**
 * Trigger a file download in the browser.
 *
 * @param {string} content - The file content
 * @param {string} filename - The download filename
 * @param {string} [mimeType="text/csv;charset=utf-8;"] - MIME type for the blob
 */
export const downloadFile = (content, filename, mimeType = "text/csv;charset=utf-8;") => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Trigger a file download from a Blob.
 *
 * @param {Blob} blob - The blob to download
 * @param {string} filename - The download filename
 */
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
