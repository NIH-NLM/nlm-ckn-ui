import { memo } from "react";
import { useDispatch } from "react-redux";
import { updateEdgeFilter } from "../../../store";
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

      {edgeFilterStatus === "loading" && (
        <output className="option-group" aria-live="polite">
          Loading edge filters...
        </output>
      )}

      {edgeFilterStatus === "failed" && (
        <div className="option-group error-message" role="alert">
          Failed to load edge filters.
        </div>
      )}

      {edgeFilterStatus === "succeeded" && Object.keys(availableEdgeFilters).length > 0 && (
        <div className="edge-filter-section">
          <h3>Edge Filters:</h3>
          {Object.entries(availableEdgeFilters).map(([field, values]) => (
            <FilterableDropdown
              key={field}
              label={field}
              options={values}
              selectedOptions={settings.edgeFilters[field] || []}
              onOptionToggle={(value) => dispatch(updateEdgeFilter({ field, value }))}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(FiltersPanel);
