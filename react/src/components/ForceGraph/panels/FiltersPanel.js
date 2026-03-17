import { memo, useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import { updateEdgeFilter, updateNumericEdgeFilter } from "../../../store";
import FilterableDropdown from "../../FilterableDropdown/FilterableDropdown";
import RangeSliderFilter from "../../RangeSliderFilter/RangeSliderFilter";

/**
 * Filters panel for collection and edge filtering.
 * Controls which collections and edge types are visible in the graph.
 * Renders range sliders for numeric fields and dropdowns for categorical fields.
 * Only shows edge filters for fields present on the current graph's edges.
 */
const FiltersPanel = ({
  settings,
  collectionMaps,
  availableEdgeFilters,
  edgeFilterStatus,
  onCollectionChange,
  graphLinks = [],
}) => {
  const dispatch = useDispatch();

  const handleNumericRangeChange = useCallback(
    (field, min, max) => {
      dispatch(updateNumericEdgeFilter({ field, min, max }));
    },
    [dispatch],
  );

  // Filter to only fields present on current graph edges, sorted alphabetically
  const relevantEdgeFilters = useMemo(() => {
    if (!availableEdgeFilters || graphLinks.length === 0) return [];

    const fieldsInGraph = new Set();
    for (const link of graphLinks) {
      for (const key of Object.keys(link)) {
        if (key[0] !== "_") fieldsInGraph.add(key);
      }
    }

    return Object.entries(availableEdgeFilters).filter(([field]) => fieldsInGraph.has(field));
  }, [availableEdgeFilters, graphLinks]);

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

      {edgeFilterStatus === "succeeded" && relevantEdgeFilters.length > 0 && (
        <div className="edge-filter-section">
          <h3>Edge Filters:</h3>
          {relevantEdgeFilters.map(([field, filterData]) =>
            filterData.type === "numeric" ? (
              <RangeSliderFilter
                key={field}
                field={field}
                min={filterData.min}
                max={filterData.max}
                currentMin={settings.edgeFilters[field]?.min}
                currentMax={settings.edgeFilters[field]?.max}
                onRangeChange={handleNumericRangeChange}
              />
            ) : (
              <FilterableDropdown
                key={field}
                label={field}
                options={filterData.values || filterData}
                selectedOptions={settings.edgeFilters[field] || []}
                onOptionToggle={(value) => dispatch(updateEdgeFilter({ field, value }))}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
};

export default memo(FiltersPanel);
