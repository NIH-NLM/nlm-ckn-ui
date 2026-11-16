import SearchResultsTable from "components/SearchResultsTable";
import { GraphContext } from "contexts";
import { useSearch } from "hooks";
import { useContext } from "react";

// Material Symbols "search", exported from Figma (683:5597). Fill follows the
// CSS `color` property so each host can set its own tone.
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="search-icon"
    aria-hidden="true"
  >
    <path d="M9.5 3.0127C11.3134 3.0127 12.8476 3.64055 14.1035 4.89648C15.3595 6.15242 15.9873 7.68657 15.9873 9.5C15.9873 10.2318 15.8714 10.9219 15.6387 11.5703C15.4058 12.219 15.0894 12.7932 14.6904 13.292L14.6836 13.3008L14.6914 13.3086L20.291 18.9092C20.4716 19.0898 20.5624 19.3195 20.5625 19.5996C20.5625 19.88 20.4718 20.1103 20.291 20.291C20.1103 20.4718 19.88 20.5625 19.5996 20.5625C19.3195 20.5624 19.0898 20.4716 18.9092 20.291L13.3086 14.6914L13.3008 14.6836L13.292 14.6904C12.7932 15.0894 12.219 15.4058 11.5703 15.6387C10.9219 15.8714 10.2318 15.9873 9.5 15.9873C7.68657 15.9873 6.15242 15.3595 4.89648 14.1035C3.64055 12.8476 3.0127 11.3134 3.0127 9.5C3.0127 7.68657 3.64055 6.15242 4.89648 4.89648C6.15242 3.64055 7.68657 3.0127 9.5 3.0127ZM9.5 4.9873C8.24672 4.9873 7.18108 5.42634 6.30371 6.30371C5.42634 7.18108 4.9873 8.24672 4.9873 9.5C4.9873 10.7533 5.42634 11.8189 6.30371 12.6963C7.18108 13.5737 8.24672 14.0127 9.5 14.0127C10.7533 14.0127 11.8189 13.5737 12.6963 12.6963C13.5737 11.8189 14.0127 10.7533 14.0127 9.5C14.0127 8.24672 13.5737 7.18108 12.6963 6.30371C11.8189 5.42634 10.7533 4.9873 9.5 4.9873Z" />
  </svg>
);

// Presentational bar driven by a provided search object (from useSearch).
const SearchBarView = ({ placeholder, search }) => {
  const { query, setQuery, results, isOpen, setIsOpen, isLoading, error, containerRef } = search;
  const shouldDropdownBeVisible = isOpen && query.trim() !== "";

  return (
    <div className="search-component-wrapper" ref={containerRef}>
      <div className="search-bar-container">
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
          />
          <SearchIcon />
        </div>
        <div className={`search-results-dropdown ${shouldDropdownBeVisible ? "show" : ""}`}>
          <SearchResultsTable searchResults={results} isLoading={isLoading} error={error} />
        </div>
      </div>
    </div>
  );
};

// Owns the search hook when no external search is provided.
const UncontrolledSearchBar = ({ placeholder }) => {
  const { graphType } = useContext(GraphContext);
  const search = useSearch(graphType);
  return <SearchBarView placeholder={placeholder} search={search} />;
};

const SearchBar = ({ placeholder = "Search NLM-CKN...", search = null }) =>
  search ? (
    <SearchBarView placeholder={placeholder} search={search} />
  ) : (
    <UncontrolledSearchBar placeholder={placeholder} />
  );

export default SearchBar;
