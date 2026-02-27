import { memo, useCallback } from "react";
import { useDispatch } from "react-redux";
import { setEdgeFilters } from "../../../store";
import EdgeFilterSelector from "../../EdgeFilterSelector";
import FilterableDropdown from "../../FilterableDropdown/FilterableDropdown";

/**
 * Filters panel for collection and edge filtering.
 * Controls which collections and edge types are visible in the graph.
 */
const FiltersPanel = ({
  settings,
  collectionMaps,
  availableEdgeFilters,
  edgeFilterStatus,
  onCollectionChange,
}) => {
  const dispatch = useDispatch();

  // Handle edge filter changes from EdgeFilterSelector.
  // Dispatches a partial update; the reducer merges it into existing filters.
  const handleEdgeFilterChange = useCallback(
    (propertyName, values) => {
      dispatch(setEdgeFilters({ [propertyName]: values }));
    },
    [dispatch],
  );

  return (
    // biome-ignore lint/correctness/useUniqueElementIds: legacy id
    <div id="tab-panel-collections" className="tab-panel active">
      <div className="collection-picker">
        <h3>Collection Filters:</h3>
        <FilterableDropdown
          key="collection-filter"
          label="Collections"
          options={settings.allCollections}
          selectedOptions={settings.allowedCollections}
          onOptionToggle={onCollectionChange}
          getOptionLabel={(collectionId) =>
            collectionMaps.has(collectionId)
              ? collectionMaps.get(collectionId).display_name
              : collectionId
          }
          getColorForOption={(collectionId) =>
            collectionMaps.has(collectionId) ? collectionMaps.get(collectionId).color : null
          }
        />
      </div>

      <div className="edge-filter-section">
        <h3>Edge Filters:</h3>
        <EdgeFilterSelector
          availableFilters={availableEdgeFilters}
          selectedFilters={settings.edgeFilters}
          onFilterChange={handleEdgeFilterChange}
          status={edgeFilterStatus}
        />
      </div>
    </div>
  );
};

export default memo(FiltersPanel);
