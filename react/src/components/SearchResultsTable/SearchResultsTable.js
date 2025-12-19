import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import collMaps from "assets/cell-kn-mvp-collection-maps.json";
import AddToGraphButton from "components/AddToGraphButton";
import { getColorForCollection, getLabel } from "utils";

/**
 * SearchResultsTable component.
 * Displays a list of search results.
 */
const SearchResultsTable = ({ searchResults }) => {
  const collectionMaps = useMemo(() => new Map(collMaps.maps), []);
  const expandAmount = 20;
  const [displayLimit, setDisplayLimit] = useState(expandAmount);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset display when results change
  useEffect(() => {
    setDisplayLimit(expandAmount);
  }, [searchResults]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const threshold = 20;

    if (searchResults && searchResults.length > 0 && displayLimit < searchResults.length) {
      if (scrollHeight - scrollTop - clientHeight < threshold) {
        const newLimit = Math.min(displayLimit + expandAmount, searchResults.length);
        setDisplayLimit(newLimit);
      }
    }
  };

  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    return <div className="no-results-message">No results found.</div>;
  }

  return (
    <div className="unified-search-results-list" onScroll={handleScroll}>
      {searchResults.slice(0, displayLimit).map((item, index) => {
        let collectionKey = "";
        let collectionDisplayName = "Unknown";

        if (item._id && typeof item._id === "string") {
          const parts = item._id.split("/");
          if (parts.length > 0) {
            collectionKey = parts[0];
            collectionDisplayName =
              collectionMaps.get(collectionKey)?.display_name || collectionKey;
          }
        }

        const tagBackgroundColor = getColorForCollection(collectionKey);

        const isDarkBackground = (color) => {
          if (!color) return false;
          const hex = color.replace("#", "");
          if (hex.length !== 3 && hex.length !== 6) return false;
          const r = Number.parseInt(
            hex.length === 3 ? hex.substring(0, 1).repeat(2) : hex.substring(0, 2),
            16,
          );
          const g = Number.parseInt(
            hex.length === 3 ? hex.substring(1, 2).repeat(2) : hex.substring(2, 4),
            16,
          );
          const b = Number.parseInt(
            hex.length === 3 ? hex.substring(2, 3).repeat(2) : hex.substring(4, 6),
            16,
          );
          return r * 0.299 + g * 0.587 + b * 0.114 < 140;
        };

        const tagTextColor = isDarkBackground(tagBackgroundColor)
          ? "var(--color-text-on-dark, #ffffff)"
          : "var(--color-text, #212121)";

        return (
          <Link
            key={item._id || index}
            to={`/collections/${item._id}`}
            className="result-item-row-link"
          >
            <div className="item-label-area">{getLabel(item)}</div>
            <div className="item-meta-actions">
              <Link
                to={`/collections/${collectionKey}`}
                className="item-collection-tag"
                style={{
                  backgroundColor: tagBackgroundColor,
                  color: tagTextColor,
                  textDecoration: "none",
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={`View collection ${collectionDisplayName}`}
              >
                {collectionDisplayName}
              </Link>
              <AddToGraphButton nodeId={item._id} />
            </div>
          </Link>
        );
      })}
    </div>
  );
};

export default SearchResultsTable;
