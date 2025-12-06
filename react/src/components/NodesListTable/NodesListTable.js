import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchNodesDetails } from "../../services";
import { removeNodeFromSlice } from "../../store/nodesSlice";
import { LoadingBar } from "../../utils";

// Fetch details for the nodes in the global state and displays them.
const NodeListTable = () => {
  const dispatch = useDispatch();
  const nodesSliceNodeIds = useSelector((state) => state.nodesSlice.originNodeIds);
  const [nodeObjects, setNodeObjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const syncObjects = async () => {
      if (nodesSliceNodeIds.length > 0) {
        setIsLoading(true);
        try {
          const objects = await fetchNodesDetails(nodesSliceNodeIds);
          setNodeObjects(objects);
        } finally {
          setIsLoading(false);
        }
      } else {
        setNodeObjects([]); // Clear the list if the cart is empty
      }
    };
    syncObjects();
  }, [nodesSliceNodeIds]);

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
