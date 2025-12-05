/**
 * FTU (Functional Tissue Unit) related utilities.
 */

/**
 * Find FTU illustration URL by ID.
 * @param {Array} ftuPartsArray - Array of FTU parts.
 * @param {string} searchId - ID to search for.
 * @returns {string|null} FTU digital object URL or null.
 */
export const findFtuUrlById = (ftuPartsArray, searchId) => {
  if (!Array.isArray(ftuPartsArray) || !searchId) {
    return null;
  }

  const foundMatch = ftuPartsArray.find(
    (ftuPart) => ftuPart.ftu_iri.includes(searchId) || ftuPart.ftu_part_iri.includes(searchId),
  );

  return foundMatch?.ftu_digital_object || null;
};
