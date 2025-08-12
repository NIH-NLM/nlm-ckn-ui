import React, { useState, useMemo, useRef, useEffect } from "react";

// Hook detects clicks outside a referenced element.
const useClickOutside = (ref, handler) => {
  useEffect(() => {
    const listener = (event) => {
      if (!ref.current || ref.current.contains(event.target)) return;
      handler(event);
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler]);
};

// Helper function gets consistent string representation for display.
const defaultGetOptionLabel = (value) => {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
};

/**
 * Searchable, multi-select dropdown component.
 */
const FilterableDropdown = ({
  label,
  options,
  selectedOptions,
  onOptionToggle,
  getOptionLabel = defaultGetOptionLabel,
  getColorForOption = () => null,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef(null);

  useClickOutside(wrapperRef, () => setIsOpen(false));

  // Memoized, processed list of flattened, unique, and sorted options.
  const processedOptions = useMemo(() => {
    const optionMap = new Map();
    options.forEach((originalOption) => {
      if (Array.isArray(originalOption)) {
        originalOption.forEach((subValue) => {
          if (!optionMap.has(subValue)) optionMap.set(subValue, originalOption);
        });
      } else {
        const displayString = getOptionLabel(originalOption);
        if (!optionMap.has(displayString))
          optionMap.set(displayString, originalOption);
      }
    });
    return Array.from(optionMap.entries())
      .map(([display, original]) => ({ display, original }))
      .sort((a, b) =>
        a.display.toLowerCase().localeCompare(b.display.toLowerCase()),
      );
  }, [options, getOptionLabel]);

  // Memoized list of options filtered by search term.
  const filteredOptions = useMemo(() => {
    if (!searchTerm) return processedOptions;
    const normalizedSearchTerm = searchTerm.toLowerCase();
    return processedOptions.filter((option) => {
      const normalizedOptionDisplay = option.display
        .toLowerCase()
        .replaceAll("_", " ");
      return normalizedOptionDisplay.includes(normalizedSearchTerm);
    });
  }, [processedOptions, searchTerm]);

  // Helper function checks if an option is currently selected.
  const isSelected = (option) => {
    const originalValue = option.original;
    if (Array.isArray(originalValue)) {
      const optAsString = JSON.stringify(originalValue);
      return selectedOptions.some(
        (item) => JSON.stringify(item) === optAsString,
      );
    }
    return selectedOptions.includes(originalValue);
  };

  return (
    <div className="filterable-dropdown" ref={wrapperRef}>
      <input
        type="text"
        className="dropdown-input"
        placeholder={`Search ${label}...`}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setIsOpen(true)}
      />

      {isOpen && (
        <ul className="dropdown-list">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              // Get color for this list item.
              const color = getColorForOption(option.original);
              return (
                <li
                  key={option.display}
                  className={`dropdown-item ${isSelected(option) ? "selected" : ""}`}
                  onClick={() => onOptionToggle(option.original)}
                >
                  {/* Render color swatch if color exists. */}
                  {color && (
                    <span
                      className="color-swatch"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {option.display}
                </li>
              );
            })
          ) : (
            <li className="dropdown-item-none">No matches found</li>
          )}
        </ul>
      )}

      <div className="selected-options-pills">
        {selectedOptions.map((originalOption) => {
          // Get color for this pill item.
          const color = getColorForOption(originalOption);
          return (
            <div key={getOptionLabel(originalOption)} className="pill">
              {/* Render color swatch if color exists. */}
              {color && (
                <span
                  className="color-swatch"
                  style={{ backgroundColor: color }}
                />
              )}
              <span className="pill-text">
                {getOptionLabel(originalOption)}
              </span>
              <button
                className="pill-remove"
                onClick={() => onOptionToggle(originalOption)}
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FilterableDropdown;
