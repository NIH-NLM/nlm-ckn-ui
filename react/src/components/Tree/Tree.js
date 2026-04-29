import AddToGraphButton from "components/AddToGraphButton";
import TreeConstructor from "components/TreeConstructor";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { fetchHierarchyData } from "services";
import { LoadingBar } from "utils";

/**
 * Tree Page Component.
 * Container that fetches hierarchical data and manages the
 * integration between the D3-based TreeConstructor and the React application.
 */
const Tree = () => {
  // Init states.
  const [treeData, setTreeData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const isLoadingRef = useRef(false);

  // State to manage the DOM elements provided by D3 for React Portals.
  const [mountPoints, setMountPoints] = useState(new Map());

  // Static configuration for the data source.
  const graphTypeForTree = "phenotypes";

  /**
   * Callback passed to the D3 constructor.
   * D3 calls this function whenever it creates a new node in the visualization,
   * providing the node's ID and a placeholder DOM element for React to render into.
   */
  const handleNodeEnter = useCallback((nodeId, element) => {
    // Add the new placeholder element to map, triggering a re-render.
    setMountPoints((prev) => new Map(prev).set(nodeId, element));
  }, []);

  /**
   * Callback passed to the D3 constructor.
   * D3 calls this function whenever it removes a node from the visualization,
   * allowing React to clean up the corresponding portal and component.
   */
  const handleNodeExit = useCallback((nodeId) => {
    // Remove the placeholder from our map.
    setMountPoints((prev) => {
      const newMap = new Map(prev);
      newMap.delete(nodeId);
      return newMap;
    });
  }, []);

  /**
   * Lazy-load children for a node in the tree.
   */
  const fetchTreeChildren = useCallback(async (parentId) => {
    const data = await fetchHierarchyData(parentId, graphTypeForTree);
    if (!Array.isArray(data)) throw new Error(`Expected array for ${parentId}`);
    return data;
  }, []);

  /**
   * Fetches the hierarchical tree data from the backend API.
   */
  const fetchTreeData = useCallback(async () => {
    if (isLoadingRef.current) {
      return;
    }
    setIsLoading(true);
    isLoadingRef.current = true;
    setError(null);

    try {
      const data = await fetchHierarchyData(null, graphTypeForTree);

      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error("Invalid data format: Expected a single root object.");
      }

      // Root is Homo sapiens directly (no wrapper node).
      setTreeData(data);
    } catch (fetchError) {
      console.error("Failed to fetch or process tree data:", fetchError);
      setError(fetchError.message);
      setTreeData(null);
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, []);

  // Trigger the initial data fetch when the component mounts.
  useEffect(() => {
    fetchTreeData();
  }, [fetchTreeData]);

  // Render
  if (isLoading) {
    return <LoadingBar />;
  }

  if (error) {
    return (
      <div>
        <p>Error loading tree data: {error}</p>
        <button type="button" onClick={fetchTreeData}>
          Try Again
        </button>
      </div>
    );
  }

  if (!treeData) {
    return <p>No tree data available.</p>;
  }

  return (
    <div className="tree-container">
      {/* Render d3 tree */}
      <TreeConstructor
        data={treeData}
        onNodeEnter={handleNodeEnter}
        onNodeExit={handleNodeExit}
        fetchChildren={fetchTreeChildren}
      />
      {Array.from(mountPoints.entries()).map(([nodeId, element]) =>
        ReactDOM.createPortal(<AddToGraphButton nodeId={nodeId} />, element),
      )}
    </div>
  );
};

export default Tree;
