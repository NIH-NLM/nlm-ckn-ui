/**
 * ResultsTable component for displaying workflow results in a table format.
 *
 * Shows nodes and edges from the executed workflow phase in clean, readable tables.
 * Uses collection maps to determine which fields to display for each collection type.
 * Supports CSV download of results.
 */

import collMaps from "assets/cell-kn-mvp-collection-maps.json";
import React, { memo, useCallback, useMemo, useState } from "react";

// Build collection config map from collection maps JSON (module-level for efficiency)
const collectionConfigMap = new Map();
for (const [key, value] of collMaps.maps) {
  collectionConfigMap.set(key, value);
}

/**
 * Get the collection color for a collection name.
 */
const getCollectionColor = (collection) => {
  return collectionConfigMap.get(collection)?.color || "#666666";
};

/**
 * Get the display name for a collection.
 */
const getCollectionDisplayName = (collection) => {
  return collectionConfigMap.get(collection)?.display_name || collection;
};

/**
 * Get the fields to display for a collection.
 * Returns an array of { fieldName, displayName } objects.
 */
const getCollectionFields = (collection) => {
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
 */
const getNodeLabel = (node, collection) => {
  const config = collectionConfigMap.get(collection);
  if (!config?.individual_labels) {
    // Fallback if no config
    return node.label || node.name || node._key || "-";
  }

  for (const labelConfig of config.individual_labels) {
    let value = node[labelConfig.field_to_use];
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

  return "-";
};

/**
 * Get the external URL for a node based on its collection config.
 */
const getNodeExternalUrl = (node, collection) => {
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
 * Format a field value for display (handles arrays, objects, etc.)
 */
const formatFieldValue = (value) => {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) {
    return value.length > 3 ? `${value.slice(0, 3).join(", ")}... (+${value.length - 3})` : value.join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

/**
 * Generate CSV content from nodes data.
 */
const generateNodesCsv = (nodes) => {
  if (!nodes.length) return "";

  // Collect all unique fields across all nodes
  const allFields = new Set(["_id", "_key"]);
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      // Skip internal/display fields
      if (!key.startsWith("__") && key !== "x" && key !== "y" && key !== "vx" && key !== "vy" && key !== "fx" && key !== "fy" && key !== "index") {
        allFields.add(key);
      }
    }
  }

  const fieldList = Array.from(allFields);

  // Build CSV header
  const header = fieldList.map((f) => `"${f}"`).join(",");

  // Build CSV rows
  const rows = nodes.map((node) => {
    return fieldList
      .map((field) => {
        let value = node[field];
        if (value === null || value === undefined) return '""';
        if (Array.isArray(value)) value = value.join("; ");
        if (typeof value === "object") value = JSON.stringify(value);
        // Escape quotes and wrap in quotes
        return `"${String(value).replace(/"/g, '""')}"`;
      })
      .join(",");
  });

  return [header, ...rows].join("\n");
};

/**
 * Generate CSV content from edges data.
 */
const generateEdgesCsv = (links) => {
  if (!links.length) return "";

  // Collect all unique fields across all edges
  const allFields = new Set(["_from", "_to", "_id", "_key"]);
  for (const link of links) {
    for (const key of Object.keys(link)) {
      if (!key.startsWith("__") && key !== "source" && key !== "target" && key !== "index") {
        allFields.add(key);
      }
    }
  }

  const fieldList = Array.from(allFields);

  // Build CSV header
  const header = fieldList.map((f) => `"${f}"`).join(",");

  // Build CSV rows
  const rows = links.map((link) => {
    return fieldList
      .map((field) => {
        let value = link[field];
        // Handle source/target objects
        if (field === "_from" && !value && link.source) {
          value = typeof link.source === "string" ? link.source : link.source._id;
        }
        if (field === "_to" && !value && link.target) {
          value = typeof link.target === "string" ? link.target : link.target._id;
        }
        if (value === null || value === undefined) return '""';
        if (Array.isArray(value)) value = value.join("; ");
        if (typeof value === "object") value = JSON.stringify(value);
        return `"${String(value).replace(/"/g, '""')}"`;
      })
      .join(",");
  });

  return [header, ...rows].join("\n");
};

/**
 * Download a string as a CSV file.
 */
const downloadCsv = (content, filename) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

/**
 * ResultsTable displays the workflow results as tables of nodes and edges.
 */
const ResultsTable = ({ graphData }) => {
  const [activeTab, setActiveTab] = useState("nodes");
  const [expandedRows, setExpandedRows] = useState(new Set());

  // Determine which additional columns to show based on what's in the data
  const { dynamicColumns, nodesByCollection } = useMemo(() => {
    if (!graphData?.nodes?.length) return { dynamicColumns: [], nodesByCollection: {} };

    // Group nodes by collection and track which fields have data
    const byCollection = {};
    const fieldCounts = {};

    for (const node of graphData.nodes) {
      const collection = node._id?.split("/")[0] || "unknown";
      if (!byCollection[collection]) byCollection[collection] = [];
      byCollection[collection].push(node);

      // Get fields for this collection
      const fields = getCollectionFields(collection);
      for (const { fieldName } of fields) {
        if (node[fieldName] !== undefined && node[fieldName] !== null && node[fieldName] !== "") {
          fieldCounts[fieldName] = (fieldCounts[fieldName] || 0) + 1;
        }
      }
    }

    // Find the most common fields that have data (limit to top 3 for readability)
    const sortedFields = Object.entries(fieldCounts)
      .filter(([field]) => field !== "label" && field !== "name") // Already shown in Label column
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([field]) => {
        // Find the display name from any collection that has this field
        for (const [, config] of collectionConfigMap) {
          const fieldConfig = config.individual_fields?.find((f) => f.field_to_display === field);
          if (fieldConfig) {
            return { fieldName: field, displayName: fieldConfig.display_field_as };
          }
        }
        return { fieldName: field, displayName: field };
      });

    return { dynamicColumns: sortedFields, nodesByCollection: byCollection };
  }, [graphData?.nodes]);

  // Toggle row expansion
  const toggleRowExpanded = useCallback((nodeId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Handle CSV download
  const handleDownloadCsv = useCallback(() => {
    if (!graphData) return;

    if (activeTab === "nodes") {
      const csv = generateNodesCsv(graphData.nodes || []);
      downloadCsv(csv, "workflow-nodes.csv");
    } else {
      const csv = generateEdgesCsv(graphData.links || []);
      downloadCsv(csv, "workflow-edges.csv");
    }
  }, [graphData, activeTab]);

  if (!graphData) {
    return null;
  }

  const { nodes = [], links = [] } = graphData;

  return (
    <div className="results-table-container">
      {/* Summary */}
      <div className="results-summary">
        <span className="summary-item">
          <strong>{nodes.length}</strong> nodes
        </span>
        <span className="summary-divider">|</span>
        <span className="summary-item">
          <strong>{links.length}</strong> edges
        </span>
        <span className="summary-divider">|</span>
        <span className="summary-item">
          <strong>{Object.keys(nodesByCollection).length}</strong> collections
        </span>
      </div>

      {/* Sub-tabs for Nodes / Edges */}
      <div className="results-tabs">
        <div className="results-tabs-left">
          <button
            type="button"
            className={`results-tab ${activeTab === "nodes" ? "active" : ""}`}
            onClick={() => setActiveTab("nodes")}
          >
            Nodes ({nodes.length})
          </button>
          <button
            type="button"
            className={`results-tab ${activeTab === "edges" ? "active" : ""}`}
            onClick={() => setActiveTab("edges")}
          >
            Edges ({links.length})
          </button>
        </div>
        <button type="button" className="download-csv-btn" onClick={handleDownloadCsv} title="Download as CSV">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 12l-4-4h2.5V3h3v5H12L8 12z" />
            <path d="M14 13v1H2v-1h12z" />
          </svg>
          Download CSV
        </button>
      </div>

      {/* Nodes Table */}
      {activeTab === "nodes" && (
        <div className="results-table-wrapper">
          <table className="results-table">
            <thead>
              <tr>
                <th className="expand-col"></th>
                <th>ID</th>
                <th>Label</th>
                <th>Collection</th>
                {dynamicColumns.map((col) => (
                  <th key={col.fieldName}>{col.displayName}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const collection = node._id?.split("/")[0] || "";
                const collectionColor = getCollectionColor(collection);
                const displayName = getCollectionDisplayName(collection);
                const externalUrl = getNodeExternalUrl(node, collection);
                const isExpanded = expandedRows.has(node._id);
                const collectionFields = getCollectionFields(collection);

                return (
                  <React.Fragment key={node._id}>
                    <tr className={isExpanded ? "expanded" : ""}>
                      <td className="expand-col">
                        {collectionFields.length > 0 && (
                          <button
                            type="button"
                            className="expand-btn"
                            onClick={() => toggleRowExpanded(node._id)}
                            title={isExpanded ? "Collapse" : "Expand to see all fields"}
                          >
                            {isExpanded ? "−" : "+"}
                          </button>
                        )}
                      </td>
                      <td className="id-cell" title={node._id}>
                        {externalUrl ? (
                          <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="external-link">
                            {node._id}
                          </a>
                        ) : (
                          node._id
                        )}
                      </td>
                      <td>{getNodeLabel(node, collection)}</td>
                      <td>
                        <span
                          className="collection-badge"
                          style={{
                            backgroundColor: `${collectionColor}20`,
                            color: collectionColor,
                            borderColor: collectionColor,
                          }}
                          title={displayName}
                        >
                          {collection}
                        </span>
                      </td>
                      {dynamicColumns.map((col) => (
                        <td key={col.fieldName} className="dynamic-cell" title={String(node[col.fieldName] || "")}>
                          {formatFieldValue(node[col.fieldName])}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr className="expanded-row">
                        <td colSpan={4 + dynamicColumns.length}>
                          <div className="expanded-content">
                            <div className="expanded-fields">
                              {collectionFields.map(({ fieldName, displayName: fieldDisplayName }) => {
                                const value = node[fieldName];
                                if (value === undefined || value === null || value === "") return null;
                                return (
                                  <div key={fieldName} className="expanded-field">
                                    <span className="field-label">{fieldDisplayName}:</span>
                                    <span className="field-value">{formatFieldValue(value)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {nodes.length === 0 && (
                <tr>
                  <td colSpan={4 + dynamicColumns.length} className="empty-message">
                    No nodes in results
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edges Table */}
      {activeTab === "edges" && (
        <div className="results-table-wrapper">
          <table className="results-table">
            <thead>
              <tr>
                <th>From</th>
                <th>Relationship</th>
                <th>To</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link, index) => {
                const fromId = typeof link._from === "string" ? link._from : link._from?._id || link.source;
                const toId = typeof link._to === "string" ? link._to : link._to?._id || link.target;
                const edgeLabel = link.Label || link.label || "-";
                const edgeSource = link.Source || link.source_info || "-";
                return (
                  <tr key={link._id || link._key || index}>
                    <td className="id-cell" title={fromId}>
                      {fromId}
                    </td>
                    <td>
                      <span className="edge-label">{edgeLabel}</span>
                    </td>
                    <td className="id-cell" title={toId}>
                      {toId}
                    </td>
                    <td className="source-cell">{edgeSource}</td>
                  </tr>
                );
              })}
              {links.length === 0 && (
                <tr>
                  <td colSpan="4" className="empty-message">
                    No edges in results
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default memo(ResultsTable);
