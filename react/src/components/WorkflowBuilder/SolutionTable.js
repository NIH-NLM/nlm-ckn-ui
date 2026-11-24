/**
 * SolutionTable lists the nodes of a workflow's solution step, one collection
 * at a time, with that collection's own fields as columns.
 */

import { memo, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  downloadFile,
  generateCsv,
  getCollectionDisplayName,
  getCollectionFields,
  getNodeLabel,
} from "utils";
import {
  buildAdjacency,
  buildEdgePool,
  buildNodeIndex,
  formatLinkedLabels,
  humanizeEdgeLabel,
  listLinkOptions,
  pickRowCollection,
  resolvePath,
} from "utils/solution";
import LinkedColumnsMenu from "./LinkedColumnsMenu";
import { formatFieldValue, SortableHeaders, sortRows } from "./ResultsTable";

// The CSV joins array elements with semicolons.
const csvValue = (v) => (Array.isArray(v) ? v.join("; ") : v);

const collectionOf = (node) => String(node._id).split("/")[0];

const pathKey = (path) => path.map((s) => `${s.label}|${s.collection}`).join(">");

// Own fields shown when the solution does not choose any.
const DEFAULT_FIELD_COUNT = 6;

// An array counts only if some element, at any depth, has a value.
const hasValue = (v) =>
  Array.isArray(v) ? v.some(hasValue) : v !== null && v !== undefined && v !== "";

const isScalar = (v) => ["string", "number", "boolean"].includes(typeof v);

// The first own field equal to the label on every row names the Label column
// instead of repeating it; with no rows, no field qualifies.
const findLabelField = (fields, rows, collection) =>
  rows.length
    ? fields.find(({ fieldName: f }) =>
        rows.every((r) => isScalar(r[f]) && String(r[f]) === getNodeLabel(r, collection)),
      )
    : undefined;

// Every array element is shown, and the cell wraps rather than truncating.
const cellText = (v) => (Array.isArray(v) ? v.map(cellText).join(", ") : formatFieldValue(v));

// Header text must be unique in the CSV, or a repeated header overwrites its twin.
// A repeated own header (the fallback "Label" beside a field shown as "Label")
// takes its field name, a linked column is marked (linked), and a header
// still repeated is numbered after that.
const uniqueHeaders = (columns) => {
  const used = new Set();
  return columns.map((c) => {
    let header = c.linked ? `${c.label} (linked)` : c.label;
    if (used.has(header) && !c.linked) header = `${c.label} (${c.key})`;
    const base = header;
    for (let n = 2; used.has(header); n++) header = `${base} (${n})`;
    used.add(header);
    return header;
  });
};

const LinkedCell = ({ nodes }) => {
  const shown = nodes.slice(0, 3);
  return (
    <td title={nodes.map((n) => n.label).join(", ")}>
      {nodes.length === 0 && formatLinkedLabels([])}
      {shown.map((n, i) => (
        <span key={n.id}>
          {i > 0 && ", "}
          <Link to={`/collections/${n.id}`}>{n.label}</Link>
        </span>
      ))}
      {nodes.length > shown.length && ` +${nodes.length - shown.length}`}
    </td>
  );
};

const FieldCell = ({ value }) => {
  const text = cellText(value);
  return (
    <td className="solution-cell" title={hasValue(value) ? text : undefined}>
      {text}
    </td>
  );
};

const SolutionTable = ({
  phaseResult,
  allPhaseResults,
  nodeDetails,
  solution,
  onChangeCollection,
  onChangeLinkedColumns,
  onChangeFields,
}) => {
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
  const adjacency = useMemo(
    () => buildAdjacency(buildEdgePool(allPhaseResults)),
    [allPhaseResults],
  );
  const nodeIndex = useMemo(
    () => buildNodeIndex(allPhaseResults, nodeDetails),
    [allPhaseResults, nodeDetails],
  );
  const rowIds = useMemo(() => rows.map((r) => r._id), [rows]);
  const linkOptions = useMemo(() => listLinkOptions(rowIds, adjacency), [rowIds, adjacency]);
  const linkedColumns = solution?.linkedColumns || [];

  const linkedNodes = useCallback(
    (row, path) =>
      // The full id is getNodeLabel's fallback for a missing node or label.
      resolvePath(row._id, path, adjacency).map((id) => ({
        id,
        label: getNodeLabel(nodeIndex.get(id), id),
      })),
    [adjacency, nodeIndex],
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
  const filledFields = useMemo(
    () => ownFields.filter(({ fieldName }) => rows.some((r) => hasValue(r[fieldName]))),
    [ownFields, rows],
  );
  // A hand-edited link can carry any value; only a non-empty list chooses fields.
  const shownFields = useMemo(() => {
    if (!Array.isArray(solution?.fields) || !solution.fields.length)
      return filledFields.slice(0, DEFAULT_FIELD_COUNT);
    return [...new Set(solution.fields)]
      .map((name) => ownFields.find((f) => f.fieldName === name))
      .filter(Boolean);
  }, [solution?.fields, filledFields, ownFields]);
  // The menu offers filled fields, plus any shown field left empty so it can be unticked.
  const menuFields = useMemo(
    () => ownFields.filter((f) => filledFields.includes(f) || shownFields.includes(f)),
    [ownFields, filledFields, shownFields],
  );

  const columns = useMemo(() => {
    return [
      { key: "__label", label: header, accessor: (n) => getNodeLabel(n, collection) },
      ...shownFields.map(({ fieldName, displayName }) => ({
        key: fieldName,
        label: displayName,
        accessor: (n) => n[fieldName],
      })),
      ...linkedColumns.map(({ path }) => {
        const last = path[path.length - 1];
        return {
          key: `link:${pathKey(path)}`,
          label: getCollectionDisplayName(last.collection),
          title: path
            .map((s) => `${humanizeEdgeLabel(s.label)} → ${getCollectionDisplayName(s.collection)}`)
            .join(" → "),
          linked: path,
          accessor: (n) => {
            const labels = linkedNodes(n, path).map((l) => l.label);
            return labels.length ? labels.join("; ") : undefined;
          },
        };
      }),
    ];
  }, [collection, header, shownFields, linkedColumns, linkedNodes]);

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
    const headers = uniqueHeaders(columns);
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
          <LinkedColumnsMenu
            options={linkOptions}
            chosen={linkedColumns}
            onChange={onChangeLinkedColumns}
            fields={menuFields}
            shownFields={shownFields.map((f) => f.fieldName)}
            onChangeFields={onChangeFields}
            loadNextHop={(prefix) => listLinkOptions(rowIds, adjacency, prefix)}
          />
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
        <table className="results-table solution-table">
          <thead>
            <tr>
              <SortableHeaders columns={columns} sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((node) => (
              <tr key={node._id}>
                {columns.map((c) =>
                  c.linked ? (
                    <LinkedCell key={c.key} nodes={linkedNodes(node, c.linked)} />
                  ) : (
                    <FieldCell key={c.key} value={c.accessor(node)} />
                  ),
                )}
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
