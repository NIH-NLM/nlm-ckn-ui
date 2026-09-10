import { memo, useCallback, useMemo } from "react";
import { useDispatch } from "react-redux";
import {
  setEdgeFilterMode,
  setEdgeFilters,
  updateEdgeFilter,
  updateNumericEdgeFilter,
} from "../../../store";
import FilterableDropdown from "../../FilterableDropdown/FilterableDropdown";
import RangeSliderFilter from "../../RangeSliderFilter/RangeSliderFilter";

/**
 * Filters panel for collection and edge filtering.
 * Controls which collections and edge types are visible in the graph.
 * Renders range sliders for numeric fields and dropdowns for categorical fields.
 * Only shows edge filters for fields present on the current graph's edges, or
 * holding a selection.
 */
const FiltersPanel = ({
  settings,
  collectionMaps,
  availableEdgeFilters,
  edgeFilterStatus,
  onCollectionChange,
  onCollectionsClearAll,
  onTerminalCollectionChange,
  onTerminalCollectionsClearAll,
  graphLinks = [],
}) => {
  const dispatch = useDispatch();

  const handleNumericRangeChange = useCallback(
    (field, min, max) => {
      dispatch(updateNumericEdgeFilter({ field, min, max }));
    },
    [dispatch],
  );

  // Show a field when the current graph has an edge carrying it, or when it
  // holds a selection.
  //
  // The second half is what keeps the panel escapable. A selection matching no
  // edges empties the graph, which empties graphLinks -- so sourcing the field
  // list from graphLinks alone withdrew the very dropdown holding the selection
  // that caused it, and the only way back was a page reload.
  const relevantEdgeFilters = useMemo(() => {
    if (!availableEdgeFilters) return [];

    const fieldsInGraph = new Set();
    for (const link of graphLinks) {
      for (const key of Object.keys(link)) {
        if (key[0] !== "_") fieldsInGraph.add(key);
      }
    }

    // A categorical selection is a non-empty list. Numeric fields are seeded
    // with their full {min, max} on load, so only a range narrowed off one of
    // those bounds counts -- otherwise every numeric field would pin itself open.
    const isSelected = (field, filterData) => {
      const current = settings.edgeFilters?.[field];
      if (!current) return false;
      if (Array.isArray(current)) return current.length > 0;
      return current.min !== filterData.min || current.max !== filterData.max;
    };

    return Object.entries(availableEdgeFilters).filter(
      ([field, filterData]) => fieldsInGraph.has(field) || isSelected(field, filterData),
    );
  }, [availableEdgeFilters, graphLinks, settings.edgeFilters]);

  return (
    // biome-ignore lint/correctness/useUniqueElementIds: legacy id
    <div id="tab-panel-collections" className="tab-panel active">
      <p className="setting-hint filters-panel-hint">
        These sections combine: a collection allowed below is still unreachable if the edge type
        that leads to it is filtered out.
      </p>

      <div className="collection-picker">
        <h3>Collection Filters:</h3>
        <FilterableDropdown
          key="collection-filter"
          label="Collections"
          options={settings.availableCollections}
          selectedOptions={settings.allowedCollections}
          onOptionToggle={onCollectionChange}
          onClearAll={onCollectionsClearAll}
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
              <div key={field} className="edge-filter-field">
                <fieldset className="edge-filter-mode-toggle" aria-label={`${field} filter mode`}>
                  <button
                    type="button"
                    className={
                      (settings.edgeFilterModes?.[field] ?? "include") === "include" ? "active" : ""
                    }
                    aria-pressed={(settings.edgeFilterModes?.[field] ?? "include") === "include"}
                    onClick={() => dispatch(setEdgeFilterMode({ field, mode: "include" }))}
                  >
                    Include
                  </button>
                  <button
                    type="button"
                    className={settings.edgeFilterModes?.[field] === "exclude" ? "active" : ""}
                    aria-pressed={settings.edgeFilterModes?.[field] === "exclude"}
                    onClick={() => dispatch(setEdgeFilterMode({ field, mode: "exclude" }))}
                  >
                    Exclude
                  </button>
                </fieldset>
                <FilterableDropdown
                  label={field}
                  options={filterData.values || []}
                  selectedOptions={settings.edgeFilters[field] || []}
                  onOptionToggle={(value) => dispatch(updateEdgeFilter({ field, value }))}
                  onClearAll={() => dispatch(setEdgeFilters({ [field]: [] }))}
                />
              </div>
            ),
          )}
        </div>
      )}

      <fieldset className="collection-picker" aria-label="Stop traversal at">
        <h3>Stop traversal at:</h3>
        <p className="setting-hint">
          These collections are shown but not expanded through. Use this to keep a high-degree node
          like an organ from pulling in everything attached to it.
        </p>
        <FilterableDropdown
          key="terminal-collection-filter"
          label="Terminal collections"
          options={settings.allowedCollections}
          selectedOptions={settings.terminalCollections || []}
          onOptionToggle={onTerminalCollectionChange}
          onClearAll={onTerminalCollectionsClearAll}
          getOptionLabel={(collectionId) =>
            collectionMaps.has(collectionId)
              ? collectionMaps.get(collectionId).display_name
              : collectionId
          }
          getColorForOption={(collectionId) =>
            collectionMaps.has(collectionId) ? collectionMaps.get(collectionId).color : null
          }
        />
      </fieldset>
    </div>
  );
};

export default memo(FiltersPanel);
