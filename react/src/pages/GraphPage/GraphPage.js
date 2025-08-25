import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { useSelector, useDispatch } from "react-redux";
import { GraphContext } from "../../contexts/GraphContext";
import { initializeGraph } from "../../store/graphSlice";
import { removeNodeFromSlice } from "../../store/nodesSlice";
import SelectedItemsTable from "../../components/SelectedItemsTable/SelectedItemsTable";
import ForceGraph from "../../components/ForceGraph/ForceGraph";

const GraphPage = () => {
  const dispatch = useDispatch();
  const graphDisplayAreaRef = useRef(null);

  // State and Context
  const nodeIds = useSelector((state) => state.nodesSlice.originNodeIds);
  const { lastAppliedOriginNodeIds } = useSelector(
    (state) => state.graph.present,
  );

  const [selectedItemObjects, setSelectedItemObjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const { graphType } = useContext(GraphContext);

  // Add memoized calculation for stale state detection
  const isGraphStale = useMemo(() => {
    if (!showGraph) return false;
    return JSON.stringify(nodeIds) !== JSON.stringify(lastAppliedOriginNodeIds);
  }, [nodeIds, lastAppliedOriginNodeIds, showGraph]);

  // Data Fetching
  const fetchNodeDetailsByIds = useCallback(async (ids, db) => {
    if (!ids || ids.length === 0) return [];
    setIsLoading(true);
    try {
      const response = await fetch(`/arango_api/document/details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_ids: ids, db: db }),
      });
      if (!response.ok) throw new Error(`Failed to fetch node details`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching node details:", error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Effect to synchronize local objects with global node IDs.
  useEffect(() => {
    const syncObjectsWithNodeIds = async () => {
      // Logic to prevent re-fetching objects already existing
      const existingObjectIds = new Set(
        selectedItemObjects.map((item) => item._id),
      );
      const missingIds = nodeIds.filter((id) => !existingObjectIds.has(id));
      const stillSelectedObjects = selectedItemObjects.filter((item) =>
        nodeIds.includes(item._id),
      );

      if (missingIds.length > 0) {
        const newObjects = await fetchNodeDetailsByIds(missingIds, graphType);
        setSelectedItemObjects([...stillSelectedObjects, ...newObjects]);
      } else {
        setSelectedItemObjects(stillSelectedObjects);
      }
    };

    // Initial load or when the list of IDs changes.
    if (nodeIds.length > 0) {
      syncObjectsWithNodeIds();
    } else {
      setSelectedItemObjects([]);
    }
  }, [nodeIds, graphType, fetchNodeDetailsByIds, selectedItemObjects]);

  // Effect to scroll down
  useEffect(() => {
    if (showGraph && graphDisplayAreaRef.current) {
      graphDisplayAreaRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [showGraph, lastAppliedOriginNodeIds]);

  // Event Handlers
  const handleRemoveItem = (item) => {
    dispatch(removeNodeFromSlice(item._id));
  };

  // Update the generate graph handler
  const handleGenerateGraph = () => {
    if (nodeIds.length > 0) {
      // This now dispatches the action to trigger a new graph build.
      dispatch(initializeGraph({ nodeIds: nodeIds }));
      setShowGraph(true);
    } else {
      setShowGraph(false);
    }
  };

  return (
    <div className="graph-page-layout">
      <div className="graph-page-header">
        <h1>Graph Builder</h1>
        <br />
        <p>
          This is the workspace for building and exploring knowledge graphs. The
          selected nodes are listed below.
        </p>
      </div>

      {isGraphStale && (
        <div className="stale-graph-warning">
          Node selection has changed. Click "Generate Graph" to update the
          visualization.
        </div>
      )}

      <div className="node-list-section">
        {isLoading && <p>Loading selected items...</p>}

        {!isLoading && selectedItemObjects.length > 0 ? (
          <SelectedItemsTable
            selectedItems={selectedItemObjects}
            generateGraph={handleGenerateGraph}
            removeSelectedItem={handleRemoveItem}
            isStale={isGraphStale}
          />
        ) : (
          !isLoading && (
            <p>
              No nodes have been added to the graph yet. Add nodes from the rest
              of the site.
            </p>
          )
        )}
      </div>

      {showGraph && lastAppliedOriginNodeIds.length > 0 && (
        <div className="graph-display-area" ref={graphDisplayAreaRef}>
          <ForceGraph />
        </div>
      )}
    </div>
  );
};

export default GraphPage;
