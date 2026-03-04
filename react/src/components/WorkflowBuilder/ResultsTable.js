/**
 * ResultsTable component for displaying workflow results in a table format.
 *
 * Shows nodes and edges from the executed workflow phase in clean, readable tables.
 * Uses collection maps to determine which fields to display for each collection type.
 * Supports CSV download of results.
 */

import React, { memo, useCallback, useMemo, useState } from "react";
import {
  collectionConfigMap,
  downloadFile,
  generateCsv,
  getCollectionColor,
  getCollectionDisplayName,
  getCollectionFields,
  getNodeExternalUrl,
  getNodeLabel,
} from "utils";

/**
 * Format a field value for display (handles arrays, objects, etc.)
 */
const formatFieldValue = (value) => {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) {
    return value.length > 3
      ? `${value.slice(0, 3).join(", ")}... (+${value.length - 3})`
      : value.join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

/** Fields to skip when generating nodes CSV. */
const NODE_SKIP_FIELDS = ["x", "y", "vx", "vy", "fx", "fy", "index"];

/** Fields to skip when generating edges CSV. */
const EDGE_SKIP_FIELDS = ["source", "target", "index"];

/**
 * Value transform for edge CSV that resolves _from/_to from source/target when needed.
 */
const edgeValueTransform = (field, link) => {
  if (field === "_from" && !link._from && link.source) {
    return typeof link.source === "string" ? link.source : link.source._id;
  }
  if (field === "_to" && !link._to && link.target) {
    return typeof link.target === "string" ? link.target : link.target._id;
  }
  return link[field];
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
      const csv = generateCsv(graphData.nodes || [], {
        priorityFields: ["_id", "_key"],
        skipFields: NODE_SKIP_FIELDS,
      });
      downloadFile(csv, "workflow-nodes.csv");
    } else {
      const csv = generateCsv(graphData.links || [], {
        priorityFields: ["_from", "_to", "_id", "_key"],
        skipFields: EDGE_SKIP_FIELDS,
        valueTransform: edgeValueTransform,
      });
      downloadFile(csv, "workflow-edges.csv");
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
        <button
          type="button"
          className="download-csv-btn"
          onClick={handleDownloadCsv}
          title="Download as CSV"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
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
                          <a
                            href={externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="wb-external-link"
                          >
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
                          title={collection}
                        >
                          {displayName}
                        </span>
                      </td>
                      {dynamicColumns.map((col) => (
                        <td
                          key={col.fieldName}
                          className="dynamic-cell"
                          title={String(node[col.fieldName] || "")}
                        >
                          {formatFieldValue(node[col.fieldName])}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr className="expanded-row">
                        <td colSpan={4 + dynamicColumns.length}>
                          <div className="expanded-content">
                            <div className="expanded-fields">
                              {collectionFields.map(
                                ({ fieldName, displayName: fieldDisplayName }) => {
                                  const value = node[fieldName];
                                  if (value === undefined || value === null || value === "")
                                    return null;
                                  return (
                                    <div key={fieldName} className="expanded-field">
                                      <span className="field-label">{fieldDisplayName}:</span>
                                      <span className="field-value">{formatFieldValue(value)}</span>
                                    </div>
                                  );
                                },
                              )}
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
                const fromId =
                  typeof link._from === "string" ? link._from : link._from?._id || link.source;
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
