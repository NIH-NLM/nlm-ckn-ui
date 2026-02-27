import collMaps from "assets/nlm-ckn-collection-maps.json";

// Build collection config map from collection maps JSON (module-level for efficiency)
const collectionConfigMap = new Map(collMaps.maps);

/**
 * Get the collection color for a node ID (e.g., "CL/0000540").
 * @param {string} nodeId - The node ID
 * @returns {string} The hex color code
 */
export const getCollectionColor = (nodeId) => {
  const collection = nodeId?.split("/")[0] || "";
  return collectionConfigMap.get(collection)?.color || "#666666";
};

/**
 * Get the collection color by collection key (e.g., "CL").
 * @param {string} collectionKey - The collection key
 * @returns {string|null} The hex color code or null
 */
export const getCollectionColorByKey = (collectionKey) => {
  return collectionConfigMap.get(collectionKey)?.color || null;
};

/**
 * Get the display name for a collection key.
 * @param {string} collectionKey - The collection key (e.g., "CL")
 * @returns {string} The display name
 */
export const getCollectionDisplayName = (collectionKey) => {
  return collectionConfigMap.get(collectionKey)?.display_name || collectionKey;
};

/**
 * Get the fields to display for a collection.
 * @param {string} collection - The collection key
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
 *   - getNodeLabel(nodeData, nodeId)  — nodeId contains "/" (e.g., "CL/0000540")
 *   - getNodeLabel(nodeData, collectionKey) — plain collection key (e.g., "CL")
 *
 * @param {Object} nodeData - The node data object (may be partial or null)
 * @param {string} nodeIdOrCollection - Either a full node ID ("CL/0000540") or a collection key ("CL")
 * @returns {string} The display label
 */
export const getNodeLabel = (nodeData, nodeIdOrCollection) => {
  // Determine collection and fallback label
  const isNodeId = nodeIdOrCollection?.includes("/");
  const collection = isNodeId
    ? nodeIdOrCollection?.split("/")[0] || ""
    : nodeIdOrCollection || "";
  const fallback = isNodeId ? nodeIdOrCollection : "-";

  if (!nodeData) return fallback;

  const config = collectionConfigMap.get(collection);

  if (!config?.individual_labels) {
    // Fallback if no config
    return nodeData.label || nodeData.name || nodeData._key || fallback;
  }

  for (const labelConfig of config.individual_labels) {
    let value = nodeData[labelConfig.field_to_use];
    if (value !== undefined && value !== null && value !== "") {
      // Apply transformations if specified
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

  // Apply transformations
  if (urlConfig.to_be_replaced && urlConfig.replace_with !== undefined) {
    fieldValue = fieldValue.split(urlConfig.to_be_replaced).join(urlConfig.replace_with);
  }
  if (urlConfig.make_lower_case) {
    fieldValue = fieldValue.toLowerCase();
  }

  return urlConfig.individual_url.replace("<FIELD_TO_USE>", fieldValue);
};

/**
 * Direct access to the collection config map for advanced use cases.
 */
export { collectionConfigMap };
