/**
 * SolutionTable lists the nodes of a workflow's solution step, one collection
 * at a time, with that collection's own fields as columns.
 */

import { memo, useCallback, useMemo, useState } from "react";
import {
  downloadFile,
  generateCsv,
  getCollectionDisplayName,
  getCollectionFields,
  getNodeLabel,
} from "utils";
import { pickRowCollection } from "utils/solution";
import { formatFieldValue, SortableHeaders, sortRows } from "./ResultsTable";

// The CSV keeps every array element; the on-screen cell truncates.
const csvValue = (v) => (Array.isArray(v) ? v.join("; ") : v);

const collectionOf = (node) => String(node._id).split("/")[0];

const isScalar = (v) => ["string", "number", "boolean"].includes(typeof v);

// The first own field equal to the label on every row names the Label column
// instead of repeating it; with no rows, no field qualifies.
const findLabelField = (fields, rows, collection) =>
  rows.length
    ? fields.find(({ fieldName: f }) =>
        rows.every((r) => isScalar(r[f]) && String(r[f]) === getNodeLabel(r, collection)),
      )
    : undefined;

const SolutionTable = ({ phaseResult, solution, onChangeCollection }) => {
  const [sort, setSort] = useState({ column: null, direction: null });
  const nodes = phaseResult?.nodes;

  const collection = useMemo(
    () => pickRowCollection(nodes, solution?.collection),
    [nodes, solution?.collection],
  );
  const collections = useMemo(
    () =>
      [...new Set((nodes || []).map(collectionOf))].sort((a, b) =>
        getCollectionDisplayName(a).localeCompare(getCollectionDisplayName(b)),
      ),
    [nodes],
  );
  const rows = useMemo(
    () => (nodes || []).filter((n) => collectionOf(n) === collection),
    [nodes, collection],
  );
  const { header, ownFields } = useMemo(() => {
    const seen = new Set();
    const fields = getCollectionFields(collection).filter(({ fieldName }) => {
      if (seen.has(fieldName)) return false;
      seen.add(fieldName);
      return true;
    });
    const label = findLabelField(fields, rows, collection);
    return { header: label?.displayName ?? "Label", ownFields: fields.filter((f) => f !== label) };
  }, [collection, rows]);

  const columns = useMemo(() => {
    return [
      { key: "__label", label: header, accessor: (n) => getNodeLabel(n, collection) },
      ...ownFields.map(({ fieldName, displayName }) => ({
        key: fieldName,
        label: displayName,
        accessor: (n) => n[fieldName],
      })),
    ];
  }, [collection, header, ownFields]);

  // Ascending, then descending, then back to the order the traversal returned.
  const handleSort = useCallback((column) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "asc" };
      if (prev.direction === "asc") return { column, direction: "desc" };
      return { column: null, direction: null };
    });
  }, []);

  const handleCollection = (next) => {
    setSort({ column: null, direction: null });
    onChangeCollection(next);
  };

  const handleDownloadCsv = () => {
    // A repeated header (the fallback "Label" beside a field shown as "Label")
    // takes its field name, so neither column overwrites the other.
    const headers = columns.map((c, i) =>
      columns.findIndex((d) => d.label === c.label) === i ? c.label : `${c.label} (${c.key})`,
    );
    const data = rows.map((row) =>
      Object.fromEntries(columns.map((c, i) => [headers[i], csvValue(c.accessor(row))])),
    );
    downloadFile(generateCsv(data), "workflow-results.csv");
  };

  if (!phaseResult) return <p className="empty-message">Run the workflow to see its answer.</p>;

  const sorted = sortRows(
    rows,
    columns.find((c) => c.key === sort.column)?.accessor,
    sort.direction,
  );

  return (
    <div className="results-table-container">
      <div className="results-tabs">
        <div className="results-tabs-left">
          {collections.length > 1 && (
            <select
              aria-label="Collection"
              value={collection}
              onChange={(e) => handleCollection(e.target.value)}
            >
              {collections.map((c) => (
                <option key={c} value={c}>
                  {getCollectionDisplayName(c)}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="button"
          className="download-csv-btn"
          onClick={handleDownloadCsv}
          disabled={rows.length === 0}
        >
          Download CSV
        </button>
      </div>
      <div className="results-table-wrapper">
        <table className="results-table">
          <thead>
            <tr>
              <SortableHeaders columns={columns} sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((node) => (
              <tr key={node._id}>
                {columns.map((c) => (
                  <td key={c.key}>{formatFieldValue(c.accessor(node))}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="empty-message">
                  The answer step returned no rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default memo(SolutionTable);
