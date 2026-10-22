/**
 * Citations keyed by DOI and anatomical structure names keyed by UBERON CURIE,
 * loaded once at startup. Labels and node card rows are built synchronously,
 * so they read these rather than fetching the documents a cell set references.
 *
 * Kept apart from utils/collections so config/fieldSections can read it
 * without an import cycle.
 */
let lookups = { publications: {}, anatomical_structures: {} };

/**
 * Install the lookups. A missing or failed load leaves them empty, and
 * readers fall back to the raw identifier or leave the part out.
 * @param {{publications?: Object, anatomical_structures?: Object}|null} next
 */
export const setCellSetLabelLookups = (next) => {
  lookups = {
    publications: next?.publications ?? {},
    anatomical_structures: next?.anatomical_structures ?? {},
  };
};

/**
 * @param {string} doi
 * @returns {string|undefined} The citation, e.g. "Xu (2023) Cell".
 */
export const getCitation = (doi) => lookups.publications[doi];

/**
 * @param {string} curie - e.g. "UBERON:0001004".
 * @returns {string|undefined} The structure's name, e.g. "respiratory system".
 */
export const getAnatomicalStructureName = (curie) => lookups.anatomical_structures[curie];
