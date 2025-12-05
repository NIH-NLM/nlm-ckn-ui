import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { removeNodeFromSlice } from "../../store/nodesSlice";
import { LoadingBar } from "../../utils";

// Fetch details for the nodes in the global state and displays them.
const NodeListTable = () => {
  const dispatch = useDispatch();
  const nodesSliceNodeIds = useSelector((state) => state.nodesSlice.originNodeIds);
  const [nodeObjects, setNodeObjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Get details for nodesSlice
  const fetchNodeDetailsByIds = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return [];
    setIsLoading(true);
    try {
      const response = await fetch("/arango_api/nodes/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_ids: ids }),
      });
      if (!response.ok) throw new Error("Failed to fetch node details");
      return await response.json();
    } catch (error) {
      console.error("Error fetching node details:", error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncObjects = async () => {
      if (nodesSliceNodeIds.length > 0) {
        const objects = await fetchNodeDetailsByIds(nodesSliceNodeIds);
        setNodeObjects(objects);
      } else {
        setNodeObjects([]); // Clear the list if the cart is empty
      }
    };
    syncObjects();
  }, [nodesSliceNodeIds, fetchNodeDetailsByIds]);

  if (isLoading) {
    return <LoadingBar />;
  }

  if (nodeObjects.length === 0) {
    return <p>No nodes have been added to the graph yet. Add nodes from other pages to begin.</p>;
  }

  return (
    <div className="node-list-container">
      <h3>Nodes Added to Graph</h3>
      <table className="node-list-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {nodeObjects.map((item) => (
            <tr key={item._id}>
              <td>{item.label || item.name || item._id}</td>
              <td>{item._id.split("/")[0]}</td>
              <td>
                <button
                  type="button"
                  className="remove-button"
                  onClick={() => dispatch(removeNodeFromSlice(item._id))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default NodeListTable;
