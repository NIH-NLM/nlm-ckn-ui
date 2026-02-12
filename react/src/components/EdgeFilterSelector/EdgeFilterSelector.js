/**
 * EdgeFilterSelector - Unified component for selecting edge filters by property.
 *
 * Features:
 * - Dropdown to select which property to filter (Label, Source, etc.)
 * - Searchable list of values for the selected property
 * - Selected filters displayed as "Property:Value" chips
 * - Used by both ForceGraph FiltersPanel and WorkflowBuilder PhaseEditor
 */

import { memo, useCallback, useMemo, useState } from "react";
import "./EdgeFilterSelector.css";

/**
 * EdgeFilterSelector allows users to filter edges by selecting property-value pairs.
 *
 * @param {Object} availableFilters - Object mapping property names to arrays of available values
 *                                    e.g., { Label: ["SUB_CLASS_OF", "PART_OF"], Source: ["GO", "CL"] }
 * @param {Object} selectedFilters - Object mapping property names to arrays of selected values
 *                                   e.g., { Label: ["SUB_CLASS_OF"], Source: [] }
 * @param {Function} onFilterChange - Callback when filters change: (propertyName, newValuesArray) => void
 * @param {string} status - Loading status: "idle" | "loading" | "succeeded" | "failed"
 */
const EdgeFilterSelector = ({
  availableFilters = {},
  selectedFilters = {},
  onFilterChange,
  status = "succeeded",
}) => {
  const [selectedProperty, setSelectedProperty] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Get list of available properties
  const properties = useMemo(() => Object.keys(availableFilters), [availableFilters]);

  // Set default property if not set and properties are available
  useMemo(() => {
    if (!selectedProperty && properties.length > 0) {
      setSelectedProperty(properties[0]);
    }
  }, [properties, selectedProperty]);

  // Get values for the currently selected property
  const availableValues = useMemo(() => {
    return availableFilters[selectedProperty] || [];
  }, [availableFilters, selectedProperty]);

  // Filter values based on search term
  const filteredValues = useMemo(() => {
    if (!searchTerm) return availableValues;
    const term = searchTerm.toLowerCase();
    return availableValues.filter((value) => String(value).toLowerCase().includes(term));
  }, [availableValues, searchTerm]);

  // Get all selected filters as flat array of { property, value } objects
  const allSelectedFilters = useMemo(() => {
    const filters = [];
    for (const [property, values] of Object.entries(selectedFilters)) {
      for (const value of values || []) {
        filters.push({ property, value });
      }
    }
    return filters;
  }, [selectedFilters]);

  // Check if a value is selected for the current property
  const isValueSelected = useCallback(
    (value) => {
      return (selectedFilters[selectedProperty] || []).includes(value);
    },
    [selectedFilters, selectedProperty],
  );

  // Toggle a value for the current property
  const handleValueToggle = useCallback(
    (value) => {
      const currentValues = selectedFilters[selectedProperty] || [];
      const newValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];
      onFilterChange(selectedProperty, newValues);
    },
    [selectedProperty, selectedFilters, onFilterChange],
  );

  // Remove a specific filter
  const handleRemoveFilter = useCallback(
    (property, value) => {
      const currentValues = selectedFilters[property] || [];
      const newValues = currentValues.filter((v) => v !== value);
      onFilterChange(property, newValues);
    },
    [selectedFilters, onFilterChange],
  );

  // Handle property change
  const handlePropertyChange = useCallback((e) => {
    setSelectedProperty(e.target.value);
    setSearchTerm("");
  }, []);

  if (status === "loading") {
    return <div className="edge-filter-selector loading">Loading edge filters...</div>;
  }

  if (status === "failed") {
    return <div className="edge-filter-selector error">Failed to load edge filters.</div>;
  }

  if (properties.length === 0) {
    return null;
  }

  return (
    <div className="edge-filter-selector">
      {/* Selected filters as chips */}
      {allSelectedFilters.length > 0 && (
        <div className="selected-filters">
          {allSelectedFilters.map(({ property, value }) => (
            <span
              key={`${property}:${value}`}
              className="filter-chip"
              title={`${property}: ${value}`}
            >
              <span className="filter-property">{property}:</span>
              <span className="filter-value">{value}</span>
              <button
                type="button"
                className="filter-remove"
                onClick={() => handleRemoveFilter(property, value)}
                title="Remove filter"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Property selector and value search */}
      <div className="filter-input-row">
        <select
          className="property-selector"
          value={selectedProperty}
          onChange={handlePropertyChange}
        >
          {properties.map((prop) => (
            <option key={prop} value={prop}>
              {prop}
            </option>
          ))}
        </select>

        <div className="value-search-container">
          <input
            type="text"
            className="value-search-input"
            placeholder={`Search ${selectedProperty} values...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsDropdownOpen(true)}
          />

          {isDropdownOpen && (
            <>
              {/* Backdrop to close dropdown when clicking outside */}
              <button
                type="button"
                className="dropdown-backdrop"
                onClick={() => setIsDropdownOpen(false)}
                onKeyDown={(e) => e.key === "Escape" && setIsDropdownOpen(false)}
                tabIndex={-1}
                aria-label="Close dropdown"
              />

              <div className="value-dropdown">
                {filteredValues.length === 0 ? (
                  <div className="dropdown-empty">No matching values</div>
                ) : (
                  filteredValues.map((value) => (
                    <label key={value} className="dropdown-option" title={String(value)}>
                      <input
                        type="checkbox"
                        checked={isValueSelected(value)}
                        onChange={() => handleValueToggle(value)}
                      />
                      <span className="option-label">{value}</span>
                    </label>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(EdgeFilterSelector);
