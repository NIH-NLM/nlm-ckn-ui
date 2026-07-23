import { useDispatch, useSelector } from "react-redux";
import { deleteHistoryEntry, restoreHistoryEntry, selectOriginHistory } from "store";

/**
 * Bottom filmstrip of auto-captured origin snapshots. Click a card to restore
 * it in place (positions preserved); use the delete control to remove it.
 */
const SavedGraphShelf = () => {
  const dispatch = useDispatch();
  const originHistory = useSelector(selectOriginHistory);
  const activeHistoryId = useSelector((s) => s.savedGraphs.activeHistoryId);

  // selectOriginHistory normalizes a stale/undefined array to [], so the shelf
  // never crashes the surrounding workspace.
  if (!originHistory.length) {
    return (
      <div className="saved-graph-shelf saved-graph-shelf--empty">
        Your graph history will appear here
      </div>
    );
  }

  return (
    <div className="saved-graph-shelf">
      {originHistory.map((entry) => {
        const restore = () => dispatch(restoreHistoryEntry(entry.id));
        return (
          <div
            key={entry.id}
            className={`saved-graph-card ${entry.id === activeHistoryId ? "saved-graph-card--active" : ""}`}
          >
            <button
              type="button"
              className="saved-graph-card-thumb"
              aria-label={`Restore ${entry.label}`}
              onClick={restore}
            >
              {entry.thumbnail ? (
                <img src={entry.thumbnail} alt={entry.label} />
              ) : (
                <span className="thumb-placeholder" />
              )}
            </button>
            <button type="button" className="saved-graph-card-title" onClick={restore}>
              {entry.label}
            </button>
            <button
              type="button"
              className="saved-graph-card-delete"
              aria-label={`Delete ${entry.label}`}
              onClick={() => dispatch(deleteHistoryEntry(entry.id))}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default SavedGraphShelf;
