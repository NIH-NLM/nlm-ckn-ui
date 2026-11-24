/**
 * LinkedNodes lists a node's neighbors across every executed step, grouped by
 * relationship and direction, for the expanded row of a results table.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { getNodeLabel } from "utils";
import { humanizeEdgeLabel, neighborsByRelationship } from "utils/solution";

const LinkedNodes = ({ nodeId, adjacency, nodeIndex }) => {
  const groups = useMemo(
    () => (adjacency ? neighborsByRelationship(nodeId, adjacency) : []),
    [nodeId, adjacency],
  );
  if (groups.length === 0) return null;

  return (
    <div className="expanded-linked">
      <h4>Linked nodes</h4>
      {groups.map(({ label, direction, nodeIds }) => (
        <div key={`${direction}|${typeof label}|${label}`} className="expanded-field">
          <span className="field-label">
            {humanizeEdgeLabel(label)} {direction === "out" ? "→" : "←"}{" "}
          </span>
          <span className="field-value">
            {nodeIds.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                {/* The full id is getNodeLabel's fallback for a missing node or label. */}
                <Link to={`/collections/${id}`}>{getNodeLabel(nodeIndex?.get(id), id)}</Link>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
};

export default LinkedNodes;
