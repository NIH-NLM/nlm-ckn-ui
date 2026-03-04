import SearchResultsTable from "components/SearchResultsTable";
import { GraphContext } from "contexts";
import { useSearch } from "hooks";
import { useContext } from "react";

// SVG Icon Component
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24"
    fill="currentColor"
    className="search-icon"
  >
    <title>Search</title>
    <path
      fillRule="evenodd"
      d="M10.5 3.75a6.75 6.75 0 100 13.5 6.75 6.75 0 000-13.5zM2.25 10.5a8.25 8.25 0 1114.59 5.28l4.69 4.69a.75.75 0 11-1.06 1.06l-4.69-4.69A8.25 8.25 0 012.25 10.5z"
      clipRule="evenodd"
    />
  </svg>
);

const SearchBar = () => {
  const { graphType } = useContext(GraphContext);

  const { query, setQuery, results, isOpen, setIsOpen, containerRef } = useSearch(graphType);

  const shouldDropdownBeVisible = isOpen && query.trim() !== "";

  return (
    <div className="search-component-wrapper" ref={containerRef}>
      <div className="search-bar-container">
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="Search NCKN..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
          />
          <SearchIcon />
        </div>
        <div className={`search-results-dropdown ${shouldDropdownBeVisible ? "show" : ""}`}>
          <SearchResultsTable searchResults={results} />
        </div>
      </div>
    </div>
  );
};

export default SearchBar;
