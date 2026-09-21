import AddToGraphButton from "components/AddToGraphButton";
import TreeConstructor from "components/TreeConstructor";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { fetchHierarchyData } from "services";
import { LoadingBar, mergeChildren, pathKey } from "utils";

/**
 * Walk a path of ids down from the root of a hierarchy data tree, returning
 * the node it addresses, or null if the path doesn't resolve.
 */
const findNodeByPath = (root, path) => {
  let node = root;
  for (let i = 1; i < path.length && node; i++) {
    node = node.children?.find((child) => child._id === path[i]);
  }
  return node ?? null;
};

/**
 * Tree Page Component.
 * Container that fetches hierarchical data and manages the
 * integration between the D3-based TreeConstructor and the React application.
 *
 * @param {string} [label] - The edge predicate the hierarchy follows.
 * @param {object} [data] - Hierarchy data to render. When omitted, Tree fetches its own root.
 * @param {function} [fetchChildren] - Async callback(parentId) returning that node's children.
 * @param {Array<Array<string>>} [expandedPaths] - Controlled set of expanded root-to-node paths.
 * @param {function} [onExpandedPathsChange] - Called with the new expandedPaths array on toggle.
 * @param {function} [onFocusChange] - Called with the toggled node's root-to-node id path
 *   whenever a node is expanded or collapsed, so a caller hosting both the tree and the
 *   sunburst can centre the sunburst there on switching views.
 */
const Tree = ({
  label = "SUB_CLASS_OF",
  data,
  fetchChildren,
  expandedPaths,
  onExpandedPathsChange,
  onFocusChange,
}) => {
  // Init states, used only when Tree fetches and owns its own data/expansion state.
  const [ownTreeData, setOwnTreeData] = useState(null);
  const [ownExpandedPaths, setOwnExpandedPaths] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Bumped on every root fetch. A request applies its result only if it is
  // still the most recent one when it resolves, so a label change that
  // starts a new request while an older one is in flight can't have the
  // older response overwrite the newer label's data.
  const latestRequestIdRef = useRef(0);

  // State to manage the DOM elements provided by D3 for React Portals.
  const [mountPoints, setMountPoints] = useState(new Map());

  const isControlledData = data !== undefined;
  const treeData = isControlledData ? data : ownTreeData;
  const paths = expandedPaths ?? ownExpandedPaths;
  const reportExpandedPaths = onExpandedPathsChange ?? setOwnExpandedPaths;

  /**
   * Callback passed to the D3 constructor.
   * D3 calls this function whenever it creates a new node in the visualization,
   * providing the node's root-to-node id path and a placeholder DOM element for
   * React to render into. Keyed by path, not the bare node id: the hierarchy is
   * a DAG, so one id can be visible at more than one position at once, and an
   * id-keyed map would let the second occurrence's entry overwrite the first's.
   */
  const handleNodeEnter = useCallback((path, element) => {
    setMountPoints((prev) =>
      new Map(prev).set(pathKey(path), { nodeId: path[path.length - 1], element }),
    );
  }, []);

  /**
   * Callback passed to the D3 constructor.
   * D3 calls this function whenever it removes a node from the visualization,
   * allowing React to clean up the corresponding portal and component.
   */
  const handleNodeExit = useCallback((path) => {
    setMountPoints((prev) => {
      const newMap = new Map(prev);
      newMap.delete(pathKey(path));
      return newMap;
    });
  }, []);

  /**
   * Lazy-load children for a node in the tree. Used only when Tree owns its
   * own data (no `fetchChildren` prop override).
   */
  const fetchTreeChildren = useCallback(
    async (parentId) => {
      const result = await fetchHierarchyData(label, parentId);
      if (!Array.isArray(result)) throw new Error(`Expected array for ${parentId}`);
      return result;
    },
    [label],
  );

  /**
   * Fetches the hierarchical tree data from the backend API.
   */
  const fetchTreeData = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const rootData = await fetchHierarchyData(label, null);

      if (typeof rootData !== "object" || rootData === null || Array.isArray(rootData)) {
        throw new Error("Invalid data format: Expected a single root object.");
      }

      // A newer request has since started (e.g. the label changed while this
      // one was in flight) -- drop this response rather than let it clobber
      // the newer request's data.
      if (latestRequestIdRef.current !== requestId) return;
      setOwnTreeData(rootData);
    } catch (fetchError) {
      if (latestRequestIdRef.current !== requestId) return;
      console.error("Failed to fetch or process tree data:", fetchError);
      setError(fetchError.message);
      setOwnTreeData(null);
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [label]);

  // Trigger the initial data fetch when the component mounts, unless data is
  // supplied by a parent.
  useEffect(() => {
    if (!isControlledData) fetchTreeData();
  }, [isControlledData, fetchTreeData]);

  /**
   * Toggles a node's expansion by path, and lazily fetches its children the
   * first time it is expanded, if they aren't already loaded.
   */
  const handleToggle = useCallback(
    (path) => {
      const key = pathKey(path);
      const isExpanded = paths.some((p) => pathKey(p) === key);
      const nextPaths = isExpanded ? paths.filter((p) => pathKey(p) !== key) : [...paths, path];
      reportExpandedPaths(nextPaths);
      if (onFocusChange) onFocusChange(path);

      if (isExpanded) return;

      const node = findNodeByPath(treeData, path);
      const alreadyLoaded = Array.isArray(node?.children) && node.children.length > 0;
      if (!node?._hasChildren || alreadyLoaded) return;

      const nodeId = path[path.length - 1];
      const loadChildren = fetchChildren ?? fetchTreeChildren;
      loadChildren(nodeId)
        .then((childrenData) => {
          if (!isControlledData && Array.isArray(childrenData) && childrenData.length > 0) {
            setOwnTreeData((prev) => (prev ? mergeChildren(prev, nodeId, childrenData) : prev));
          }
        })
        .catch((fetchError) => {
          console.error(`Failed to fetch children for ${nodeId}:`, fetchError);
        });
    },
    [
      paths,
      reportExpandedPaths,
      onFocusChange,
      treeData,
      fetchChildren,
      fetchTreeChildren,
      isControlledData,
    ],
  );

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
        expandedPaths={paths}
        onToggle={handleToggle}
      />
      {Array.from(mountPoints.entries()).map(([key, { nodeId, element }]) =>
        ReactDOM.createPortal(<AddToGraphButton nodeId={nodeId} />, element, key),
      )}
    </div>
  );
};

export default Tree;
