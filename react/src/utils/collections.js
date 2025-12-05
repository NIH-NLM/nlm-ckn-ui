/**
 * Collection and label utilities for processing collection data and generating labels/URLs.
 */
import collMaps from "../assets/cell-kn-mvp-collection-maps.json";
import { capitalCase } from "./strings";

/**
 * Sort and parse collections with optional display name mapping.
 * @param {Array<string>} collections - Array of collection names.
 * @param {Map|null} collectionMaps - Optional map of collection configurations.
 * @returns {Array<string>} Sorted array of collection names.
 */
export const parseCollections = (collections, collectionMaps = null) => {
  if (collectionMaps) {
    return collections.sort((a, b) => {
      const aDisplay = collectionMaps.get(a)?.display_name ? collectionMaps.get(a).display_name : a;
      const bDisplay = collectionMaps.get(b)?.display_name ? collectionMaps.get(b).display_name : b;
      return aDisplay.toLowerCase().localeCompare(bDisplay.toLowerCase());
    });
  }
  return collections.sort((a, b) => {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
};

/**
 * Generates display label for data item based on dynamic configuration.
 * Finds first valid field from options, applies transformations, and returns result.
 * @param {object} item - Data object needing label. Must contain `_id` property.
 * @returns {string} Processed label string or default "NAME UNKNOWN" fallback.
 */
export const getLabel = (item) => {
  try {
    const collectionMaps = new Map(collMaps.maps);
    const itemCollection = item._id.split("/")[0];

    const labelOptions =
      collectionMaps.get(itemCollection)?.individual_labels ??
      collectionMaps.get("edges")?.individual_labels;

    let label;

    if (Array.isArray(labelOptions)) {
      for (const config of labelOptions) {
        const value = item[config.field_to_use];

        if (value !== null && value !== undefined) {
          let processedLabel = String(value);

          if (config.to_be_replaced) {
            processedLabel = processedLabel.replaceAll(
              config.to_be_replaced,
              config.replace_with || "",
            );
          }

          if (config.make_lower_case) {
            processedLabel = processedLabel.toLowerCase();
          }

          label = processedLabel;
          break;
        }
      }
    }

    return label || "NAME UNKNOWN";
  } catch (error) {
    console.error(`getLabel failed with exception: ${error}`);
    return "NAME UNKNOWN";
  }
};

/**
 * Generates dynamic URL for data item based on configuration.
 * Finds first valid URL rule, applies transformations, and returns result.
 * @param {object} item - Data object needing URL. Must contain `_id` property.
 * @returns {string|null} Processed URL string, or null if no URL could be generated.
 */
export const getUrl = (item) => {
  try {
    const collectionMaps = new Map(collMaps.maps);
    const itemCollection = item._id.split("/")[0];
    const collectionMap = collectionMaps.get(itemCollection);

    if (collectionMap) {
      const urlOptions = collectionMap.individual_urls;

      if (Array.isArray(urlOptions)) {
        for (const config of urlOptions) {
          const value = item[config.field_to_use];

          if (value !== null && value !== undefined) {
            let replacement = String(value);

            if (config.to_be_replaced) {
              replacement = replacement.replaceAll(
                config.to_be_replaced,
                config.replace_with || "",
              );
            }

            if (config.make_lower_case) {
              replacement = replacement.toLowerCase();
            }

            const url = config.individual_url.replace("<FIELD_TO_USE>", replacement);
            return url;
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`getUrl failed with exception: ${error}`);
    return null;
  }
};

/**
 * Extracts and formats ordered list of fields for display.
 * Uses 'individual_fields' config to select, order, and format item properties.
 * @param {object} item - Data object to process. Must contain `_id` property.
 * @returns {Array<object>} Array of field objects { key, label, value, url }, or empty array.
 */
export const getDisplayFields = (item) => {
  try {
    const collectionMaps = new Map(collMaps.maps);
    const itemCollection = item._id.split("/")[0];

    const fieldConfigs =
      collectionMaps.get(itemCollection)?.individual_fields ??
      collectionMaps.get("edges")?.individual_fields;

    if (!Array.isArray(fieldConfigs)) {
      return [];
    }

    return fieldConfigs
      .map((config) => {
        const value = item[config.field_to_display];
        let fieldUrl = null;

        if (config.field_url && config.field_to_use) {
          const urlValue = item[config.field_to_use];
          if (urlValue !== null && urlValue !== undefined) {
            fieldUrl = config.field_url.replace("<FIELD_TO_USE>", urlValue);
          }
        }

        return {
          key: config.field_to_display,
          label: config.display_field_as,
          value: value,
          url: fieldUrl,
        };
      })
      .filter((field) => field.value !== null && field.value !== undefined);
  } catch (error) {
    console.error(`getDisplayFields failed with exception: ${error}`);
    return [];
  }
};

/**
 * Generate a title for a document/item.
 * @param {object} item - Data object. Must contain `_id` property.
 * @returns {string} Formatted title string.
 */
export const getTitle = (item) => {
  const collectionMaps = new Map(collMaps.maps);
  const itemCollection = item._id.split("/")[0];
  const collectionMap = collectionMaps.get(itemCollection);

  if (collectionMap) {
    const title = `${collectionMap.display_name}: ${getLabel(item)}`;
    return capitalCase(title);
  }
  const title = `${itemCollection}: ${item.label ? item.label : item._id}`;
  return capitalCase(title);
};

/**
 * Extracts filterable edge attribute names from collection maps configuration.
 * @returns {Array<string>} Sorted array of unique field names for filtering.
 */
export const getFilterableEdgeFields = () => {
  try {
    const collectionMaps = new Map(collMaps.maps);
    const edgeConfig = collectionMaps.get("edges");

    if (!edgeConfig || !Array.isArray(edgeConfig.individual_fields)) {
      console.warn("No 'edges' configuration found in collection maps.");
      return [];
    }

    const fields = edgeConfig.individual_fields
      .map((field) => field.field_to_display)
      .filter(Boolean);

    return [...new Set(fields)].sort();
  } catch (error) {
    console.error("Failed to parse filterable edge fields:", error);
    return [];
  }
};

/**
 * Get all searchable fields from collection maps configuration.
 * @returns {Set<String>} Set of unique field names for searching.
 */
export const getAllSearchableFields = () => {
  const collectionMaps = new Map(collMaps.maps);

  const fieldsToDisplay = new Set();
  collectionMaps.forEach((collectionMap, _collection, _collectionMaps) => {
    collectionMap.individual_fields.forEach((fieldMap, _index) => {
      fieldsToDisplay.add(fieldMap.field_to_display);
    });
  });

  return fieldsToDisplay;
};
