import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import collMaps from "../../assets/cell-kn-mvp-collection-maps.json";
import { getLabel } from "../Utils/Utils";
import { getColorForCollection } from "../../services/ColorServices/ColorServices";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";

/**
 * SearchResultsTable component.
 * Displays a list of search results with lazy loading on scroll.
 * Expects `searchResults` to be a flat array of item objects.
 */
const SearchResultsTable = ({ searchResults, handleSelectItem }) => {
  // Memoized map for collection display names, created once
  const collectionMaps = useMemo(() => new Map(collMaps.data), []);
  // Number of items to load/display initially and on each subsequent load
  const expandAmount = 20;

  // State to keep track of the number of items currently displayed from the searchResults
  const [displayLimit, setDisplayLimit] = useState(expandAmount);

  // Effect to reset the display limit when the searchResults array changes (e.g., new search)
  useEffect(() => {
    setDisplayLimit(expandAmount);
  }, [searchResults]);

  /**
   * Handles scroll events on the list container.
   * If the user scrolls near the bottom and more items are available,
   * it increases the displayLimit to load more items.
   * @param {React.SyntheticEvent} e - The scroll event.
   */
  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const threshold = 10; // Pixels from bottom to trigger loading more.

    // Check if searchResults is valid and if more items can be loaded.
    if (
      searchResults &&
      searchResults.length > 0 &&
      displayLimit < searchResults.length
    ) {
      // Check if scroll position is near the bottom.
      if (scrollHeight - scrollTop - clientHeight < threshold) {
        const newLimit = Math.min(
          displayLimit + expandAmount,
          searchResults.length,
        );
        setDisplayLimit(newLimit);
      }
    }
  };

  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    return <div className="no-results-message">No results found.</div>;
  }

  return (
    <div className="unified-search-results-list" onScroll={handleScroll}>
      {/* Render only the items up to the current displayLimit. */}
      {searchResults.slice(0, displayLimit).map((item, index) => {
        let collectionKey = "";
        let collectionDisplayName = "Unknown"; // Default display name

        // Derive collectionKey and collectionDisplayName
        if (item._id && typeof item._id === "string") {
          const parts = item._id.split("/");
          if (parts.length > 0) {
            collectionKey = parts[0];
            collectionDisplayName =
              collectionMaps.get(collectionKey)?.display_name || collectionKey;
          }
        }

        // Get dynamic background color for the collection tag.
        const tagBackgroundColor = getColorForCollection(collectionKey);

        /**
         * Determines if a background color is dark to apply contrasting text.
         * @param {string} color - The background color (hex format assumed).
         * @returns {boolean} True if the background is considered dark.
         */
        const isDarkBackground = (color) => {
          if (!color) return false;
          const hex = color.replace("#", "");
          // Basic validation for hex length (3 or 6 chars)
          if (hex.length !== 3 && hex.length !== 6) return false;
          const r = parseInt(
            hex.length === 3
              ? hex.substring(0, 1).repeat(2)
              : hex.substring(0, 2),
            16,
          );
          const g = parseInt(
            hex.length === 3
              ? hex.substring(1, 2).repeat(2)
              : hex.substring(2, 4),
            16,
          );
          const b = parseInt(
            hex.length === 3
              ? hex.substring(2, 3).repeat(2)
              : hex.substring(4, 6),
            16,
          );
          return r * 0.299 + g * 0.587 + b * 0.114 < 140;
        };

        // Determine text color for the tag based on background brightness for accessibility.
        const tagTextColor = isDarkBackground(tagBackgroundColor)
          ? "var(--color-text-on-dark, #ffffff)"
          : "var(--color-text, #212121)";

        return (
          // Main clickable row to select the item
          <div
            key={item._id || index}
            className="result-item-row selectable"
            onClick={() => handleSelectItem(item)}
            onKeyPress={(e) => {
              if (e.key === "Enter" || e.key === " ") handleSelectItem(item);
            }}
            tabIndex={0}
            role="button"
            aria-label={`Select ${getLabel(item)}`}
          >
            <div className="item-label-area">{getLabel(item)}</div>

            <div className="item-meta-actions">
              {/* Link to the overview page for the item's collection. */}
              <Link
                to={`/collections/${collectionKey}`}
                target="_blank"
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

              <Link
                to={`/collections/${item._id}`}
                target="_blank"
                className="item-action-button goto-button"
                onClick={(e) => e.stopPropagation()}
                aria-label={`View details for ${getLabel(item)}`}
              >
                <FontAwesomeIcon icon={faArrowRight} />
              </Link>
            </div>
          </div>
        );
      })}
      {/*/!* Display a "Loading more..." message if more items can be loaded. *!/*/}
      {/*{searchResults && displayLimit < searchResults.length && (*/}
      {/*  <div className="loading-more-results">Loading more...</div>*/}
      {/*)}*/}
    </div>
  );
};

export default SearchResultsTable;
