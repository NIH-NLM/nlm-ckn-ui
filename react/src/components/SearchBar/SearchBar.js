import { useContext, useEffect, useRef, useState } from "react";
import SelectedItemsTable from "../SelectedItemsTable/SelectedItemsTable";
import SearchResultsTable from "../SearchResultsTable/SearchResultsTable";
import { GraphContext } from "../../contexts/GraphContext";
import { getAllSearchableFields } from "../Utils/Utils";

const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
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

const SearchBar = ({
  generateGraph,
  selectedItems,
  removeSelectedItem,
  addSelectedItem,
}) => {
  const containerRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [input, setInput] = useState(""); // Current value in the input field
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  const { graphType } = useContext(GraphContext);

  const getSearchTerms = async (searchTerm, db) => {
    const searchableFields = getAllSearchableFields();

    try {
      const response = await fetch(`/arango_api/search/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          search_term: searchTerm,
          db: db,
          search_fields: Array.from(searchableFields),
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorBody}`,
        );
      }
      return response.json();
    } catch (error) {
      console.error("Error fetching search terms:", error);
      throw error; // Re-throw to be caught by caller
    }
  };

  useEffect(() => {
    const fetchSearchResults = async () => {
      try {
        const data = await getSearchTerms(searchTerm, graphType);
        setSearchResults(data);
      } catch (error) {
        setSearchResults([]); // Clear results on error
      }
    };

    if (searchTerm.trim() !== "") {
      fetchSearchResults();
    } else {
      setSearchResults([]);
    }
  }, [searchTerm, graphType]);

  const handleSearch = (event) => {
    const value = event.target.value;
    setInput(value);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      setSearchTerm(value);
      setShowResults(true);
    }, 250);
  };

  const showR = () => {
    setShowResults(true);
  };

  function handleSelectItem(item) {
    addSelectedItem(item);
    setShowResults(false);
    setInput("");
    setSearchTerm("");
  }

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
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Determine if the dropdown should actually be visible
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
            onMouseEnter={showR}
          />
          <SearchIcon />
        </div>
        <div
          className={`search-results-dropdown ${
            shouldDropdownBeVisible ? "show" : ""
          }`}
        >
          <SearchResultsTable
            searchResults={searchResults}
            handleSelectItem={handleSelectItem}
          />
        </div>
      </div>
      {selectedItems && selectedItems.length > 0 && (
        <SelectedItemsTable
          selectedItems={selectedItems}
          generateGraph={generateGraph}
          removeSelectedItem={removeSelectedItem}
        />
      )}
    </div>
  );
};

export default SearchBar;
