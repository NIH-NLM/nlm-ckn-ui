import { memo } from "react";
import { isMac } from "../../../utils";

/**
 * History panel for undo/redo and save/load functionality.
 */
const HistoryPanel = ({ canUndo, canRedo, onUndo, onRedo, onSave, onLoad }) => {
  return (
    // biome-ignore lint/correctness/useUniqueElementIds: legacy id
    <div id="tab-panel-history" className="tab-panel active">
      <div className="option-group">
        <h3 className="group-label">Graph History</h3>
        <div className="history-controls">
          <button type="button" onClick={onUndo} disabled={!canUndo}>
            <span className="history-icon">↶</span> Undo <kbd>{isMac ? "⌘Z" : "Ctrl+Z"}</kbd>
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo}>
            Redo <kbd>{isMac ? "⇧⌘Z" : "Ctrl+Y"}</kbd>
          </button>
        </div>
      </div>
      <div className="option-group">
        <h3 className="group-label">Saved Graphs</h3>
        <div className="save-load-controls">
          <button type="button" onClick={onSave}>
            Save Current Graph <kbd>{isMac ? "⌘S" : "Ctrl+S"}</kbd>
          </button>
          <button type="button" onClick={onLoad}>
            Load a Saved Graph <kbd>{isMac ? "⌘O" : "Ctrl+O"}</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};

export default memo(HistoryPanel);
