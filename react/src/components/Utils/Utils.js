import collMaps from "../../assets/cell-kn-mvp-collection-maps.json";
import React, { useEffect, useMemo, useState } from "react";

export const fetchCollections = async (graphType) => {
  // Accept graphType argument
  let response = await fetch("/arango_api/collections/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      graph: graphType,
    }),
  });
  if (!response.ok) {
    console.error(
      "Fetch collections failed:",
      response.status,
      await response.text(),
    );
    throw new Error(`Network response was not ok (${response.status})`);
  }
  return response.json();
};

export const hasAnyNodes = (data, nodeId) => {
  // Check if data, data.nodes exist and are objects.
  if (
    !data ||
    typeof data !== "object" ||
    !data.nodes ||
    typeof data.nodes !== "object" ||
    !data.nodes.hasOwnProperty(nodeId) // Check if the specific nodeId key exists
  ) {
    // Return false if basic structure or the specific key is missing
    return false;
  }

  // Get the array associated with the nodeId
  const nodeEntries = data.nodes[nodeId];

  // Validate that nodeEntries is actually an array
  if (!Array.isArray(nodeEntries)) {
    return false;
  }

  //    .some() returns true if the callback function returns true for at least one element.
  const result = nodeEntries.some((entry) => {
    // Check if the entry exists, is an object, has the 'node' property, AND that property is not null
    return (
      entry && // Check if entry is truthy
      typeof entry === "object" && // Check if entry is an object
      entry.hasOwnProperty("node") && // Check if entry has the 'node' property
      entry.node !== null
    ); // Check if the 'node' property's value is not null
  });

  // Return the result of the .some() check
  return result;
};

export const parseCollections = (collections, collectionMaps = null) => {
  if (collectionMaps) {
    return collections.sort((a, b) => {
      const aDisplay =
        collectionMaps.get(a) && collectionMaps.get(a)["display_name"]
          ? collectionMaps.get(a)["display_name"]
          : a;
      const bDisplay =
        collectionMaps.get(b) && collectionMaps.get(b)["display_name"]
          ? collectionMaps.get(b)["display_name"]
          : b;

      return aDisplay.toLowerCase().localeCompare(bDisplay.toLowerCase());
    });
  } else {
    return collections.sort((a, b) => {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
  }
};

/**
 * Generates display label for data item based on dynamic configuration.
 * Finds first valid field from options, applies transformations, and returns result.
 * @param {object} item - Data object needing label. Must contain `_id` property.
 * @returns {string} Processed label string or default "NAME UNKNOWN" fallback.
 */
export const getLabel = (item) => {
  try {
    // Load collection configuration maps.
    const collectionMaps = new Map(collMaps.maps);
    const itemCollection = item._id.split("/")[0];

    // Get label rules for item's collection, fallback for edges
    const labelOptions =
      collectionMaps.get(itemCollection)?.["individual_labels"] ??
      collectionMaps.get("edges")?.["individual_labels"];

    let label;

    if (Array.isArray(labelOptions)) {
      // Iterate through label configurations to find first match.
      for (const config of labelOptions) {
        // Get value from item using specified field.
        const value = item[config.field_to_use];

        // Check if value exists and is not null.
        if (value !== null && value !== undefined) {
          // Convert value to string for processing.
          let processedLabel = String(value);

          // Perform string replacement if specified.
          if (config.to_be_replaced) {
            processedLabel = processedLabel.replaceAll(
              config.to_be_replaced,
              config.replace_with || "",
            );
          }

          // Convert to lower case if specified.
          if (config.make_lower_case) {
            processedLabel = processedLabel.toLowerCase();
          }

          // Assign processed label and exit loop.
          label = processedLabel;
          break;
        }
      }
    }

    // Return generated label or default fallback text.
    return label || "NAME UNKNOWN";
  } catch (error) {
    // Log any exceptions during processing.
    console.error(`getLabel failed with exception: ${error}`);
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
    // Load collection configuration maps.
    const collectionMaps = new Map(collMaps.maps);
    const itemCollection = item._id.split("/")[0];
    const collectionMap = collectionMaps.get(itemCollection);

    if (collectionMap) {
      // Get URL generation rules from configuration.
      const urlOptions = collectionMap["individual_urls"];

      if (Array.isArray(urlOptions)) {
        // Iterate URL configurations to find first valid option.
        for (const config of urlOptions) {
          // Get value from item using specified field.
          const value = item[config.field_to_use];

          // Check if value exists and is not null.
          if (value !== null && value !== undefined) {
            // Start with value as string for processing.
            let replacement = String(value);

            // Perform string replacement if specified.
            if (config.to_be_replaced) {
              replacement = replacement.replaceAll(
                config.to_be_replaced,
                config.replace_with || "",
              );
            }

            // Convert to lower case if specified.
            if (config.make_lower_case) {
              replacement = replacement.toLowerCase();
            }

            // Build final URL by replacing placeholder in template.
            const url = config.individual_url.replace(
              "<FIELD_TO_USE>",
              replacement,
            );

            // Return successfully generated URL immediately.
            return url;
          }
        }
      }
    }

    // Return null if no configuration or valid URL found.
    return null;
  } catch (error) {
    // Log any exceptions during processing.
    console.error(`getUrl failed with exception: ${error}`);
    return null; // Ensure null return on error.
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
    // Load collection configuration maps.
    const collectionMaps = new Map(collMaps.maps);
    const itemCollection = item._id.split("/")[0];

    // Get field display rules from configuration, with fallback for edges.
    const fieldConfigs =
      collectionMaps.get(itemCollection)?.["individual_fields"] ??
      collectionMaps.get("edges")?.["individual_fields"];

    // Return empty array if no specific field configuration exists.
    if (!Array.isArray(fieldConfigs)) {
      return [];
    }

    // Process configured fields, filtering out those with no value in item.
    return fieldConfigs
      .map((config) => {
        const value = item[config.field_to_display];
        let fieldUrl = null;

        // Generate URL for field value if specified.
        if (config.field_url && config.field_to_use) {
          const urlValue = item[config.field_to_use];
          // Ensure value for URL exists before creating link.
          if (urlValue !== null && urlValue !== undefined) {
            fieldUrl = config.field_url.replace("<FIELD_TO_USE>", urlValue);
          }
        }

        return {
          key: config.field_to_display, // Original key for React.
          label: config.display_field_as, // Label for UI.
          value: value,
          url: fieldUrl,
        };
      })
      .filter((field) => field.value !== null && field.value !== undefined);
  } catch (error) {
    // Log any exceptions during processing.
    console.error(`getDisplayFields failed with exception: ${error}`);
    return []; // Return empty array on error for safe rendering.
  }
};

export const getTitle = (item) => {
  const collectionMaps = new Map(collMaps.maps);
  // Get item collection
  const itemCollection = item._id.split("/")[0];
  const collectionMap = collectionMaps.get(itemCollection);

  // Collection exists in map
  if (collectionMap) {
    const title = `${collectionMap["display_name"]}: ${getLabel(item)}`;
    return capitalCase(title);
  }
  // Default (expected for edges)
  else {
    const title = `${itemCollection}: ${item.label ? item.label : item._id}`;
    return capitalCase(title);
  }
};

export const capitalCase = (input) => {
  if (Array.isArray(input)) {
    // If the input is an array, map over each element and capitalize each word
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
  } else if (typeof input === "string") {
    // If the input is a single string, capitalize each word
    return input
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  } else {
    // If the input is neither a string nor an array of strings, return as is
    return input;
  }
};

export function findNodeById(node, id) {
  if (node._id === id) {
    return node;
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export function mergeChildren(graphData, parentId, childrenWithGrandchildren) {
  const newData = JSON.parse(JSON.stringify(graphData)); // Deep copy
  const parentNode = findNodeById(newData, parentId);

  if (parentNode) {
    console.log(
      `Found parent ${parentId}, merging children:`,
      childrenWithGrandchildren,
    );
    parentNode.children = childrenWithGrandchildren;
    parentNode._childrenLoaded = true;
  } else {
    console.warn(`Parent node ${parentId} not found for merging children.`);
  }
  return newData;
}

export function truncateString(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "...";
}

// Parse id. If edge id, return both edges.
export function parseId(document) {
  // Check if edge document
  if (document._from && document._to) {
    return [document._from, document._to];
  }
  // Return its own id if vertex
  else {
    return [document._id];
  }
}

export const LoadingBar = () => {
  return (
    <div className="loading-indicator">
      <div className="progress-bar"></div>
      <span>Loading...</span>
    </div>
  );
};

export const findFtuUrlById = (ftuPartsArray, searchId) => {
  if (!Array.isArray(ftuPartsArray) || !searchId) {
    return null;
  }

  // Find match
  const foundMatch = ftuPartsArray.find(
    (ftuPart) =>
      ftuPart.ftu_iri.includes(searchId) ||
      ftuPart.ftu_part_iri.includes(searchId),
  );

  // Return match digital object URL
  console.log(foundMatch);
  return foundMatch?.ftu_digital_object || null;
};

// Helper to check if platform is running a variation on MacOS
export const isMac = /mac/i.test(navigator.platform);

// A helper to determine if a raw API graph response object is empty
export const hasNodesInRawData = (data) => {
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    return false;
  }
  if (data.nodes && typeof data.nodes === "object") {
    return Object.values(data.nodes).some(
      (nodeArray) => Array.isArray(nodeArray) && nodeArray.length > 0,
    );
  }
  return false;
};
