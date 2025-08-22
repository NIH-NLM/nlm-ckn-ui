import React, {
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import SearchResultsTable from "../SearchResultsTable/SearchResultsTable";
import { GraphContext } from "../../contexts/GraphContext";
import { getAllSearchableFields } from "../Utils/Utils";

// SVG Icon Component
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24"
    fill="currentColor"
    className="search-icon"
  >
    <path
      fillRule="evenodd"
      d="M10.5 3.75a6.75 6.75 0 100 13.5 6.75 6.75 0 000-13.5zM2.25 10.5a8.25 8.25 0 1114.59 5.28l4.69 4.69a.75.75 0 11-1.06 1.06l-4.69-4.69A8.25 8.25 0 012.25 10.5z"
      clipRule="evenodd"
    />
  </svg>
);

const SearchBar = () => {
  const containerRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [input, setInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  const { graphType } = useContext(GraphContext);

  // Text search function
  const getSearchTerms = useCallback(async (currentSearchTerm, db) => {
    const searchableFields = getAllSearchableFields();
    try {
      const response = await fetch(`/arango_api/search/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_term: currentSearchTerm,
          db: db,
          search_fields: Array.from(searchableFields),
        }),
      });
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching search terms:", error);
      return [];
    }
  }, []);

  // Effect for fetching search results
  useEffect(() => {
    const fetchSearchResults = async () => {
      if (searchTerm.trim() !== "") {
        const data = await getSearchTerms(searchTerm, graphType);
        setSearchResults(data);
      } else {
        setSearchResults([]);
      }
    };

    fetchSearchResults();
  }, [searchTerm, graphType, getSearchTerms]);

  // Effect for handling clicks outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, []);

  // Search input handler
  const handleSearch = (event) => {
    const value = event.target.value;
    setInput(value);
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => {
      setSearchTerm(value);
      if (value.trim() !== "") setShowResults(true);
    }, 250);
  };

  const shouldDropdownBeVisible = showResults && input.trim() !== "";

  return (
    <div className="search-component-wrapper" ref={containerRef}>
      <div className="search-bar-container">
        <div className="search-input-wrapper">
          <input
            type="text"
            className="search-input"
            placeholder="Search NCKN..."
            value={input}
            onChange={handleSearch}
            onFocus={() => setShowResults(true)}
          />
          <SearchIcon />
        </div>
        <div
          className={`search-results-dropdown ${shouldDropdownBeVisible ? "show" : ""}`}
        >
          <SearchResultsTable searchResults={searchResults} />
        </div>
      </div>
    </div>
  );
};

export default SearchBar;
