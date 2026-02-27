/**
 * Collection and label utilities for processing collection data and generating labels/URLs.
 */
import collMaps from "../assets/nlm-ckn-collection-maps.json";
import { capitalCase } from "./strings";

/**
 * Module-level collection config map built from the JSON asset.
 * Shared across all functions to avoid re-creating the Map on every call.
 */
export const collectionConfigMap = new Map(collMaps.maps);

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
    const itemCollection = item._id.split("/")[0];

    const labelOptions =
      collectionConfigMap.get(itemCollection)?.individual_labels ??
      collectionConfigMap.get("edges")?.individual_labels;

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
    const itemCollection = item._id.split("/")[0];
    const collectionMap = collectionConfigMap.get(itemCollection);

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
    const itemCollection = item._id.split("/")[0];

    const fieldConfigs =
      collectionConfigMap.get(itemCollection)?.individual_fields ??
      collectionConfigMap.get("edges")?.individual_fields;

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
  const itemCollection = item._id.split("/")[0];
  const collectionMap = collectionConfigMap.get(itemCollection);

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
    const edgeConfig = collectionConfigMap.get("edges");

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
  const fieldsToDisplay = new Set();
  collectionConfigMap.forEach((collectionMap, _collection, _collectionMaps) => {
    collectionMap.individual_fields.forEach((fieldMap, _index) => {
      fieldsToDisplay.add(fieldMap.field_to_display);
    });
  });

  return fieldsToDisplay;
};

/**
 * Get the display name for a collection key.
 * @param {string} collectionKey - The collection key (e.g., "CL")
 * @returns {string} The display name, or the key itself if not found.
 */
export const getCollectionDisplayName = (collectionKey) => {
  return collectionConfigMap.get(collectionKey)?.display_name || collectionKey;
};

/**
 * Get the field definitions for a collection (schema-level, without populating values).
 * @param {string} collection - The collection key (e.g., "CL")
 * @returns {Array<{fieldName: string, displayName: string}>}
 */
export const getCollectionFields = (collection) => {
  const config = collectionConfigMap.get(collection);
  if (!config?.individual_fields) return [];
  return config.individual_fields.map((f) => ({
    fieldName: f.field_to_display,
    displayName: f.display_field_as,
  }));
};

/**
 * Get the display label for a node using the collection's individual_labels config.
 * Tries each field in order until one has a value.
 *
 * Supports two calling conventions:
 *   - getNodeLabel(nodeData, nodeId)  -- nodeId contains "/" (e.g., "CL/0000540")
 *   - getNodeLabel(nodeData, collectionKey) -- plain collection key (e.g., "CL")
 *
 * @param {Object} nodeData - The node data object (may be partial or null)
 * @param {string} nodeIdOrCollection - Either a full node ID ("CL/0000540") or a collection key ("CL")
 * @returns {string} The display label
 */
export const getNodeLabel = (nodeData, nodeIdOrCollection) => {
  const isNodeId = nodeIdOrCollection?.includes("/");
  const collection = isNodeId
    ? nodeIdOrCollection?.split("/")[0] || ""
    : nodeIdOrCollection || "";
  const fallback = isNodeId ? nodeIdOrCollection : "-";

  if (!nodeData) return fallback;

  const config = collectionConfigMap.get(collection);

  if (!config?.individual_labels) {
    return nodeData.label || nodeData.name || nodeData._key || fallback;
  }

  for (const labelConfig of config.individual_labels) {
    let value = nodeData[labelConfig.field_to_use];
    if (value !== undefined && value !== null && value !== "") {
      if (labelConfig.to_be_replaced && labelConfig.replace_with !== undefined) {
        value = String(value).split(labelConfig.to_be_replaced).join(labelConfig.replace_with);
      }
      if (labelConfig.make_lower_case) {
        value = String(value).toLowerCase();
      }
      return String(value);
    }
  }

  return fallback;
};

/**
 * Get the external URL for a node based on its collection config.
 * @param {Object} node - The node data object
 * @param {string} collection - The collection key
 * @returns {string|null} The URL or null
 */
export const getNodeExternalUrl = (node, collection) => {
  const config = collectionConfigMap.get(collection);
  if (!config?.individual_urls?.[0]) return null;

  const urlConfig = config.individual_urls[0];
  let fieldValue = node[urlConfig.field_to_use];
  if (!fieldValue) return null;

  if (urlConfig.to_be_replaced && urlConfig.replace_with !== undefined) {
    fieldValue = fieldValue.split(urlConfig.to_be_replaced).join(urlConfig.replace_with);
  }
  if (urlConfig.make_lower_case) {
    fieldValue = fieldValue.toLowerCase();
  }

  return urlConfig.individual_url.replace("<FIELD_TO_USE>", fieldValue);
};
