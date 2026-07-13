import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { deleteGraph, renameGraph, restoreSavedGraph } from "store";

/**
 * Bottom filmstrip of session-saved graphs. Click a card to restore it; use the
 * rename control to rename it; use the delete control to remove it.
 */
const SavedGraphShelf = () => {
  const dispatch = useDispatch();
  const savedGraphs = useSelector((s) => s.savedGraphs.savedGraphs);
  const activeGraphId = useSelector((s) => s.savedGraphs.activeGraphId);
  const [editingId, setEditingId] = useState(null);
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (editingId !== null) {
      renameInputRef.current?.focus();
    }
  }, [editingId]);

  if (!savedGraphs.length) {
    return <div className="saved-graph-shelf saved-graph-shelf--empty">No saved graphs yet</div>;
  }

  return (
    <div className="saved-graph-shelf">
      {savedGraphs.map((g) => {
        const restore = () => dispatch(restoreSavedGraph(g.id));
        return (
          <div
            key={g.id}
            className={`saved-graph-card ${g.id === activeGraphId ? "saved-graph-card--active" : ""}`}
          >
            {editingId === g.id ? (
              <input
                ref={renameInputRef}
                className="saved-graph-card-title-input"
                defaultValue={g.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  // Ignore an empty/whitespace value so a card never ends up with a
                  // blank title and broken aria-labels; just leave rename mode.
                  if (name) dispatch(renameGraph({ id: g.id, name }));
                  setEditingId(null);
                }}
              />
            ) : (
              <button type="button" className="saved-graph-card-title" onClick={restore}>
                {g.name}
              </button>
            )}
            <button type="button" className="saved-graph-card-thumb" onClick={restore}>
              {g.thumbnail ? (
                <img src={g.thumbnail} alt={g.name} />
              ) : (
                <span className="thumb-placeholder" />
              )}
            </button>
            <button
              type="button"
              className="saved-graph-card-rename"
              aria-label={`Rename ${g.name}`}
              onClick={() => setEditingId(g.id)}
            >
              ✎
            </button>
            <button
              type="button"
              className="saved-graph-card-delete"
              aria-label={`Delete ${g.name}`}
              onClick={() => dispatch(deleteGraph(g.id))}
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
