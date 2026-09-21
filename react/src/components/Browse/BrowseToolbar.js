import { useId } from "react";

/**
 * Toolbar for the Browse page: the hierarchy predicate picker and the
 * sunburst/tree view toggle.
 *
 * @param {Array<{label: string}>} labels - Predicates present in the loaded data.
 * @param {string} label - The currently selected predicate.
 * @param {function} onLabelChange - Called with the newly picked predicate.
 * @param {string} view - The active view, "sunburst" or "tree".
 * @param {function} onViewChange - Called with the newly picked view.
 */
const BrowseToolbar = ({ labels, label, onLabelChange, view, onViewChange }) => {
  const labelSelectId = useId();

  return (
    <div className="option-group field-row browse-toolbar">
      <label htmlFor={labelSelectId}>Hierarchy</label>
      {/* biome-ignore lint/correctness/useUniqueElementIds: id only needs to be unique per instance, which useId already guarantees */}
      <select
        id={labelSelectId}
        value={label}
        onChange={(event) => onLabelChange(event.target.value)}
      >
        {labels.map((option) => (
          <option key={option.label} value={option.label}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`tab-button ${view === "sunburst" ? "active" : ""}`}
        onClick={() => onViewChange("sunburst")}
      >
        Sunburst
      </button>
      <button
        type="button"
        className={`tab-button ${view === "tree" ? "active" : ""}`}
        onClick={() => onViewChange("tree")}
      >
        Tree
      </button>
    </div>
  );
};

export default BrowseToolbar;
