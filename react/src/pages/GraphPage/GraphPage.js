import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import ErrorBoundary from "components/ErrorBoundary";
import ForceGraph from "components/ForceGraph/ForceGraph";
import LoadGraphModal from "components/LoadGraphModal";
import SelectedItemsTable from "components/SelectedItemsTable";
import { GraphContext } from "contexts";
import { fetchNodeDetailsByIds } from "services";
import { initializeGraph, loadGraphFromJson, removeNodeFromSlice } from "store";

const GraphPage = () => {
  const dispatch = useDispatch();
  const graphDisplayAreaRef = useRef(null);
  const fileInputRef = useRef(null);

  // State and Context
  const nodeIds = useSelector((state) => state.nodesSlice.originNodeIds);
  const { lastAppliedOriginNodeIds } = useSelector((state) => state.graph.present);

  const [selectedItemObjects, setSelectedItemObjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const { graphType } = useContext(GraphContext);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);

  // Add memoized calculation for stale state detection
  const isGraphStale = useMemo(() => {
    if (!showGraph) return false;
    return JSON.stringify(nodeIds) !== JSON.stringify(lastAppliedOriginNodeIds);
  }, [nodeIds, lastAppliedOriginNodeIds, showGraph]);

  // Init graph on component load.
  useEffect(() => {
    dispatch(initializeGraph({}));
  }, [dispatch]);

  // Effect to synchronize local objects with global node IDs.
  useEffect(() => {
    const syncObjectsWithNodeIds = async () => {
      // Logic to prevent re-fetching objects already existing
      const existingObjectIds = new Set(selectedItemObjects.map((item) => item._id));
      const missingIds = nodeIds.filter((id) => !existingObjectIds.has(id));
      const stillSelectedObjects = selectedItemObjects.filter((item) => nodeIds.includes(item._id));

      if (missingIds.length > 0) {
        setIsLoading(true);
        const newObjects = await fetchNodeDetailsByIds(missingIds, graphType);
        setSelectedItemObjects([...stillSelectedObjects, ...newObjects]);
        setIsLoading(false);
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
  }, [nodeIds, graphType, fetchNodeDetailsByIds]);

  // Effect to scroll down
  useEffect(() => {
    if (showGraph && graphDisplayAreaRef.current) {
      graphDisplayAreaRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [showGraph, lastAppliedOriginNodeIds]);

  // E2E-only: if tests set window.__E2E__, always show the graph area so ForceGraph mounts.
  useEffect(() => {
    if (typeof window !== "undefined" && window.__E2E__ && !showGraph) {
      setShowGraph(true);
    }
  }, [showGraph]);

  // Test hook: expose a method to force-show the graph area under E2E/non-production.
  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      window.__GRAPH__ = window.__GRAPH__ || {};
      window.__GRAPH__.show = () => setShowGraph(true);
    }
  }, []);

  // Test-only helper: if running under E2E (window.__E2E__) and nodes are pre-seeded, auto-generate graph
  useEffect(() => {
    if (typeof window !== "undefined" && window.__E2E__ && nodeIds.length > 0 && !showGraph) {
      dispatch(initializeGraph({ nodeIds }));
      setShowGraph(true);
    }
  }, [dispatch, nodeIds, showGraph]);

  // Event Handlers
  const handleRemoveItem = (item) => {
    dispatch(removeNodeFromSlice(item._id));
  };

  // Update the generate graph handler
  const handleGenerateGraph = () => {
    if (nodeIds.length > 0) {
      // This dispatches the action to trigger a new graph build.
      dispatch(initializeGraph({ nodeIds: nodeIds }));
      setShowGraph(true);
    } else {
      setShowGraph(false);
    }
  };

  const handleLoad = useCallback(() => {
    // Init empty graph
    setIsLoadModalOpen(true);
    setShowGraph(true);
  }, [dispatch]);

  const handleLoadFromJson = () => {
    fileInputRef.current.click();
  };

  const handleFileSelected = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    setShowGraph(true); // Make the graph area visible.
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        const jsonData = JSON.parse(content);

        // Basic validation to ensure it's a valid graph file
        if (jsonData && Array.isArray(jsonData.nodes) && Array.isArray(jsonData.links)) {
          dispatch(loadGraphFromJson(jsonData));
        } else {
          alert("Error: The selected JSON file does not appear to be a valid graph export.");
        }
      } catch (error) {
        console.error("Failed to parse JSON file:", error);
        alert("Error: Could not read or parse the selected file.");
      }
    };
    reader.readAsText(file);

    // Reset the input value to allow loading the same file again
    event.target.value = null;
  };

  return (
    <div className="graph-page-layout">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelected}
        style={{ display: "none" }}
        accept=".json"
      />
      <div className="graph-page-header">
        <h1>Graph Builder</h1>
        <br />
        <p>
          This is the workspace for building and exploring knowledge graphs. The selected nodes are
          listed below.
        </p>
      </div>

      <div className="graph-management-actions">
        <button type="button" onClick={handleLoad} className="secondary-action-button">
          Load Saved Graph
        </button>
        <button type="button" onClick={handleLoadFromJson} className="secondary-action-button">
          Load from File
        </button>
      </div>

      {isGraphStale && (
        <div className="stale-graph-warning">
          Node selection below is different than in graph. Click "Generate Graph" if you would like
          create a visualization with the nodes below.
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
            <p>No nodes have been added to the graph yet. Add nodes from the rest of the site.</p>
          )
        )}
      </div>

      <div className={!showGraph ? "hidden" : "graph-display-area"} ref={graphDisplayAreaRef}>
        <ErrorBoundary>
          <ForceGraph />
        </ErrorBoundary>
      </div>
      <LoadGraphModal isOpen={isLoadModalOpen} onClose={() => setIsLoadModalOpen(false)} />
    </div>
  );
};

export default GraphPage;
