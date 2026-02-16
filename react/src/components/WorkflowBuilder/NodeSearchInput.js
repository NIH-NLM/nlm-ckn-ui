import collMaps from "assets/cell-kn-mvp-collection-maps.json";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchDocuments } from "services";
import { getAllSearchableFields, getLabel } from "utils";

const collectionConfigMap = new Map(collMaps.maps);

const getCollectionColor = (nodeId) => {
  const collection = nodeId?.split("/")[0] || "";
  return collectionConfigMap.get(collection)?.color || "#666666";
};

const getCollectionDisplayName = (nodeId) => {
  const collection = nodeId?.split("/")[0] || "";
  return collectionConfigMap.get(collection)?.display_name || collection;
};

const NodeSearchInput = ({ onSelectNode, existingNodeIds = [] }) => {
  const containerRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const [input, setInput] = useState("");
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const existingSet = new Set(existingNodeIds);

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
    },
    [onSelectNode],
  );

  return (
    <div className="node-search-input" ref={containerRef}>
      <input
        type="text"
        placeholder="Search by name (e.g., dendritic cell)..."
        value={input}
        onChange={handleInputChange}
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
            results.map((item) => {
              const nodeId = item._id;
              const alreadyAdded = existingSet.has(nodeId);
              const color = getCollectionColor(nodeId);
              const collectionName = getCollectionDisplayName(nodeId);
              return (
                <button
                  type="button"
                  key={nodeId}
                  className={`node-search-result ${alreadyAdded ? "already-added" : ""}`}
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
