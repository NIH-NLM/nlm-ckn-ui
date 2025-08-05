import collectionsMapData from "../../assets/collectionsMap.json";
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

export const parseCollections = (collections, collectionsMap = null) => {
  if (collectionsMap) {
    return collections.sort((a, b) => {
      const aDisplay =
        collectionsMap.get(a) && collectionsMap.get(a)["display_name"]
          ? collectionsMap.get(a)["display_name"]
          : a;
      const bDisplay =
        collectionsMap.get(b) && collectionsMap.get(b)["display_name"]
          ? collectionsMap.get(b)["display_name"]
          : b;

      return aDisplay.toLowerCase().localeCompare(bDisplay.toLowerCase());
    });
  } else {
    return collections.sort((a, b) => {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
  }
};

export const getLabel = (item) => {
  try {
    const collectionsMap = new Map(collectionsMapData);
    const itemCollection = item._id.split("/")[0];

    const labelOptions =
      collectionsMap.get(itemCollection)?.["individual_labels"] ??
      collectionsMap.get("edges")?.["individual_labels"];

    const label = labelOptions
      ?.map((key) => item[key])
      .find((value) => value !== undefined)
      ?.toString()
      .split(",")
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .join(" | ");

    // Return NAME UNKNOWN if undefined.
    return label ?? "NAME UNKNOWN";
  } catch (error) {
    console.error(`getLabel failed with exception: ${error}`);
  }
};

export const getUrl = (item) => {
  const collectionsMap = new Map(collectionsMapData);
  // Get item collection
  const itemCollection = item._id.split("/")[0];
  const collectionMap = collectionsMap.get(itemCollection);

  // Collection exists in map
  if (collectionMap) {
    const individualUrl = collectionMap?.["individual_url"];
    let replacement = item[collectionMap["field_to_use"]].replaceAll(
      collectionMap["to_be_replaced"],
      collectionMap["replace_with"],
    );
    if (collectionMap["make_lower_case"]) {
      replacement = replacement.toLowerCase();
    }
    // Create url
    const url = individualUrl.replace("<FIELD_TO_USE>", replacement);
    return url;
  } else {
    return null;
  }
};

export const getTitle = (item) => {
  const collectionsMap = new Map(collectionsMapData);
  // Get item collection
  const itemCollection = item._id.split("/")[0];
  const collectionMap = collectionsMap.get(itemCollection);

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
