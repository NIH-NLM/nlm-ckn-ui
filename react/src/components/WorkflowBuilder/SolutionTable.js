/**
 * SolutionTable lists the nodes of a workflow's solution step, one collection
 * at a time, with that collection's own fields as columns.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { getCollectionFields, getNodeLabel } from "utils";
import { pickRowCollection } from "utils/solution";
import { formatFieldValue, SortableHeaders, sortRows } from "./ResultsTable";

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

const SolutionTable = ({ phaseResult, solution }) => {
  const [sort, setSort] = useState({ column: null, direction: null });
  const nodes = phaseResult?.nodes;

  const collection = useMemo(
    () => pickRowCollection(nodes, solution?.collection),
    [nodes, solution?.collection],
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

  if (!phaseResult) return <p className="empty-message">Run the workflow to see its answer.</p>;

  const sorted = sortRows(
    rows,
    columns.find((c) => c.key === sort.column)?.accessor,
    sort.direction,
  );

  return (
    <div className="results-table-container">
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
