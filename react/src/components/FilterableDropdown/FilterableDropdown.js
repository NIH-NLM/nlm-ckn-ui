import { useEffect, useMemo, useRef, useState } from "react";

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

// Gets consistent string representation for display.
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
  onClearAll,
  getOptionLabel = defaultGetOptionLabel,
  getColorForOption = () => null,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef(null);

  useClickOutside(wrapperRef, () => setIsOpen(false));

  // Memoized list of processed option objects.
  const processedOptions = useMemo(() => {
    const flatUniqueValues = [...new Set(options.flat().map(String))];
    const optionsWithLabels = flatUniqueValues.map((value) => ({
      original: value,
      display: getOptionLabel(value),
    }));

    optionsWithLabels.sort((a, b) =>
      a.display.toLowerCase().localeCompare(b.display.toLowerCase()),
    );

    return optionsWithLabels;
  }, [options, getOptionLabel]);

  // Memoized list of options filtered by search term.
  const filteredOptions = useMemo(() => {
    if (!searchTerm) return processedOptions;
    const normalizedSearchTerm = searchTerm.toLowerCase();

    // Filter based on display label or original value (e.g. abbreviation).
    return processedOptions.filter((option) => {
      const normalizedOptionDisplay = option.display.toLowerCase().replaceAll("_", " ");
      const normalizedOriginal = option.original.toLowerCase().replaceAll("_", " ");
      return (
        normalizedOptionDisplay.includes(normalizedSearchTerm) ||
        normalizedOriginal.includes(normalizedSearchTerm)
      );
    });
  }, [processedOptions, searchTerm]);

  return (
    <div className="filterable-dropdown" ref={wrapperRef}>
      <input
        type="text"
        className="dropdown-input"
        placeholder={`Filter by ${label}...`}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setIsOpen(true)}
      />

      {isOpen && (
        <ul className="dropdown-list">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <li key={option.original} className="dropdown-item">
                <button
                  type="button"
                  className={`dropdown-item-btn ${
                    selectedOptions.includes(option.original) ? "selected" : ""
                  }`}
                  onClick={() => onOptionToggle(option.original)}
                >
                  {getColorForOption(option.original) && (
                    <span
                      className="color-swatch"
                      style={{ backgroundColor: getColorForOption(option.original) }}
                    />
                  )}
                  {/* Render display label. */}
                  {option.display}
                </button>
              </li>
            ))
          ) : (
            <li className="dropdown-item-none">No matches found</li>
          )}
        </ul>
      )}

      <div className="selected-options-pills">
        {onClearAll && selectedOptions.length > 0 && (
          <button type="button" className="pill-clear-all" onClick={onClearAll}>
            Clear all
          </button>
        )}
        {selectedOptions.map((selectedString) => (
          <div key={selectedString} className="pill">
            {getColorForOption(selectedString) && (
              <span
                className="color-swatch"
                style={{ backgroundColor: getColorForOption(selectedString) }}
              />
            )}
            {/* Use getOptionLabel to show correct pill text. */}
            <span className="pill-text">{getOptionLabel(selectedString)}</span>
            <button
              type="button"
              className="pill-remove"
              onClick={() => onOptionToggle(selectedString)}
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
