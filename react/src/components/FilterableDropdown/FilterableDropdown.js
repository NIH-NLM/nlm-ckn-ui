import React, { useState, useMemo, useRef, useEffect } from "react";

// Default function to get a display string if no custom one is provided.
const defaultGetOptionLabel = (value) => {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
};

// Helper hook to detect clicks outside a component.
const useClickOutside = (ref, handler) => {
  useEffect(() => {
    const listener = (event) => {
      if (!ref.current || ref.current.contains(event.target)) {
        return;
      }
      handler(event);
    };
    document.addEventListener("mousedown", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
    };
  }, [ref, handler]);
};

/**
 * A searchable, multi-select dropdown component for filtering.
 * Handle duplicates, mixed data types, and space/underscore matching.
 */
const FilterableDropdown = ({
  label,
  options,
  selectedOptions,
  onOptionToggle,
  getOptionLabel = defaultGetOptionLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef(null);

  useClickOutside(wrapperRef, () => setIsOpen(false));

  // Process options to be flat, unique, and mapped to original values.
  const processedOptions = useMemo(() => {
    const optionMap = new Map();
    options.forEach((originalOption) => {
      const displayString = getOptionLabel(originalOption);
      if (Array.isArray(originalOption)) {
        originalOption.forEach((subValue) => {
          if (!optionMap.has(subValue)) {
            optionMap.set(subValue, originalOption);
          }
        });
      } else {
        if (!optionMap.has(displayString)) {
          optionMap.set(displayString, originalOption);
        }
      }
    });
    return Array.from(optionMap.entries())
      .map(([display, original]) => ({ display, original }))
      .sort((a, b) =>
        a.display.toLowerCase().localeCompare(b.display.toLowerCase()),
      );
  }, [options, getOptionLabel]);

  // Memoized and filtered list to display in the dropdown.
  const filteredOptions = useMemo(() => {
    if (!searchTerm) {
      return processedOptions;
    }
    const normalizedSearchTerm = searchTerm.toLowerCase();
    return processedOptions.filter((option) => {
      const normalizedOptionDisplay = option.display
        .toLowerCase()
        .replaceAll("_", " ");
      return normalizedOptionDisplay.includes(normalizedSearchTerm);
    });
  }, [processedOptions, searchTerm]);

  // Helper to check if an option is selected.
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
            filteredOptions.map((option) => (
              <li
                key={option.display}
                className={`dropdown-item ${isSelected(option) ? "selected" : ""}`}
                onClick={() => onOptionToggle(option.original)}
              >
                {option.display}
              </li>
            ))
          ) : (
            <li className="dropdown-item-none">No matches found</li>
          )}
        </ul>
      )}

      <div className="selected-options-pills">
        {selectedOptions.map((originalOption) => (
          <div key={getOptionLabel(originalOption)} className="pill">
            {getOptionLabel(originalOption)}
            <button
              className="pill-remove"
              onClick={() => onOptionToggle(originalOption)}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FilterableDropdown;
