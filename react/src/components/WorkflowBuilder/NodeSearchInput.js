import { DEFAULT_GRAPH_TYPE } from "constants/index";
import { useSearch } from "hooks";
import { useCallback, useMemo } from "react";
import { getCollectionColor, getCollectionDisplayName, getLabel } from "utils";

const NodeSearchInput = ({ onSelectNode, existingNodeIds = [] }) => {
  const {
    query,
    setQuery,
    results,
    isOpen,
    setIsOpen,
    isLoading,
    highlightedIndex,
    containerRef,
    clearSearch,
    handleKeyDown: handleSearchKeyDown,
  } = useSearch(DEFAULT_GRAPH_TYPE);

  const existingSet = useMemo(() => new Set(existingNodeIds), [existingNodeIds]);

  const handleSelect = useCallback(
    (nodeId) => {
      onSelectNode(nodeId);
      clearSearch();
    },
    [onSelectNode, clearSearch],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && isOpen && results.length > 0) {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          const nodeId = results[highlightedIndex]._id;
          if (!existingSet.has(nodeId)) {
            handleSelect(nodeId);
          }
        }
        return;
      }
      handleSearchKeyDown(e);
    },
    [isOpen, results, highlightedIndex, existingSet, handleSelect, handleSearchKeyDown],
  );

  return (
    <div className="node-search-input" ref={containerRef}>
      <input
        type="text"
        placeholder="Search by name (e.g., dendritic cell)..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setIsOpen(true);
        }}
      />
      {isOpen && (
        <div className="node-search-dropdown">
          {isLoading && <div className="node-search-status">Searching...</div>}
          {!isLoading && results.length === 0 && query.trim() && (
            <div className="node-search-status">No results found</div>
          )}
          {!isLoading &&
            results.map((item, index) => {
              const nodeId = item._id;
              const alreadyAdded = existingSet.has(nodeId);
              const color = getCollectionColor(nodeId);
              const collectionName = getCollectionDisplayName(nodeId?.split("/")[0] || "");
              return (
                <button
                  type="button"
                  key={nodeId}
                  className={`node-search-result ${alreadyAdded ? "already-added" : ""} ${index === highlightedIndex ? "highlighted" : ""}`}
                  onClick={() => {
                    if (!alreadyAdded) handleSelect(nodeId);
                  }}
                  disabled={alreadyAdded}
                >
                  <span
                    className="node-search-collection-badge"
                    style={{
                      backgroundColor: `${color}20`,
                      borderColor: color,
                      color: color,
                    }}
                  >
                    {collectionName}
                  </span>
                  <span className="node-search-label">{getLabel(item)}</span>
                  <span className="node-search-id">{nodeId}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
};

export default NodeSearchInput;
