import { useDispatch, useSelector } from "react-redux";
import { loadGraph } from "../../store/graphSlice";
import { deleteGraph } from "../../store/savedGraphsSlice";

const LoadGraphModal = ({ isOpen, onClose }) => {
  const dispatch = useDispatch();
  const { savedGraphs } = useSelector((state) => state.savedGraphs);

  if (!isOpen) {
    return null;
  }

  const handleLoad = (graph) => {
    // Dispatch with graph object.
    dispatch(loadGraph(graph));
    onClose();
  };

  const handleDelete = (graphId) => {
    if (window.confirm("Are you sure you want to delete this saved graph?")) {
      dispatch(deleteGraph(graphId));
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Load a Saved Graph</h2>
        <button type="button" className="modal-close-button" onClick={onClose}>
          ×
        </button>
        <div className="saved-graphs-list">
          {savedGraphs.length === 0 ? (
            <p>You have no saved graphs.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Graph Name</th>
                  <th>Date Saved</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedGraphs.map((graph) => (
                  <tr key={graph.id}>
                    <td>{graph.name}</td>
                    <td>{new Date(graph.timestamp).toLocaleString()}</td>
                    <td className="actions-cell">
                      <button type="button" onClick={() => handleLoad(graph)}>
                        Load
                      </button>
                      <button
                        type="button"
                        className="delete-button"
                        onClick={() => handleDelete(graph.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoadGraphModal;
