import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchDocuments } from "services";
import { getCollectionColor, getCollectionDisplayName } from "utils/collectionHelpers";
import { getAllSearchableFields, getLabel } from "utils";

const NodeSearchInput = ({ onSelectNode, existingNodeIds = [] }) => {
  const containerRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const mountedRef = useRef(true);
  const [input, setInput] = useState("");
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const existingSet = useMemo(() => new Set(existingNodeIds), [existingNodeIds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Click-outside to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, []);

  const handleInputChange = useCallback((e) => {
    const value = e.target.value;
    setInput(value);
    setHighlightedIndex(-1);

    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);

    if (!value.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    debounceTimeoutRef.current = setTimeout(async () => {
      const searchFields = Array.from(getAllSearchableFields());
      const data = await searchDocuments(value, "ontologies", searchFields);
      if (!mountedRef.current) return;
      setResults(data || []);
      setIsOpen(true);
      setIsLoading(false);
    }, 250);
  }, []);

  const handleSelect = useCallback(
    (nodeId) => {
      onSelectNode(nodeId);
      setInput("");
      setResults([]);
      setIsOpen(false);
      setHighlightedIndex(-1);
    },
    [onSelectNode],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (!isOpen || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < results.length) {
          const nodeId = results[highlightedIndex]._id;
          if (!existingSet.has(nodeId)) {
            handleSelect(nodeId);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    },
    [isOpen, results, highlightedIndex, existingSet, handleSelect],
  );

  return (
    <div className="node-search-input" ref={containerRef}>
      <input
        type="text"
        placeholder="Search by name (e.g., dendritic cell)..."
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (results.length > 0) setIsOpen(true);
        }}
      />
      {isOpen && (
        <div className="node-search-dropdown">
          {isLoading && <div className="node-search-status">Searching...</div>}
          {!isLoading && results.length === 0 && input.trim() && (
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
