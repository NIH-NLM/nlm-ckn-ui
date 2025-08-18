import React, { useContext, useEffect, useRef, useState, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import SelectedItemsTable from "../SelectedItemsTable/SelectedItemsTable";
import SearchResultsTable from "../SearchResultsTable/SearchResultsTable";
import { GraphContext } from "../../contexts/GraphContext";
import { addToCart, removeFromCart } from "../../store/cartSlice";

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

// SearchBar Component
const SearchBar = ({ onGenerateGraph }) => {
  const containerRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const dispatch = useDispatch();

  // State
  const cartNodeIds = useSelector((state) => state.cart.originNodeIds);
  const [selectedItemObjects, setSelectedItemObjects] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [input, setInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // For fetching node details

  const { graphType } = useContext(GraphContext);

  // Text search
  const getSearchTerms = useCallback(async (currentSearchTerm, db) => {
    try {
      const response = await fetch(`/arango_api/search/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search_term: currentSearchTerm, db: db }),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching search terms:", error);
      return [];
    }
  }, []);

  // Get details for cart
  const fetchNodeDetailsByIds = useCallback(async (ids, db) => {
    if (!ids || ids.length === 0) return [];
    setIsLoading(true);
    try {
      const response = await fetch(`/arango_api/document/details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_ids: ids, db: db }),
      });
      if (!response.ok) throw new Error(`Failed to fetch node details`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching node details:", error);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Effect for fetching search results when debounced search term changes.
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

  // Effect to synchronize local item objects with global cart IDs.
  useEffect(() => {
    const syncObjectsWithCart = async () => {
      const existingObjectIds = new Set(selectedItemObjects.map(item => item._id));
      const missingIds = cartNodeIds.filter(id => !existingObjectIds.has(id));
      const stillSelectedObjects = selectedItemObjects.filter(item => cartNodeIds.includes(item._id));

      if (missingIds.length > 0) {
        const newObjects = await fetchNodeDetailsByIds(missingIds, graphType);
        setSelectedItemObjects([...stillSelectedObjects, ...newObjects]);
      } else {
        setSelectedItemObjects(stillSelectedObjects);
      }
    };

    syncObjectsWithCart();
  }, [cartNodeIds, fetchNodeDetailsByIds]);

  // Effect for handling clicks outside the component.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, []);

  const handleSearch = (event) => {
    const value = event.target.value;
    setInput(value);
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => {
      setSearchTerm(value);
      if (value.trim() !== "") setShowResults(true);
    }, 250);
  };

  const handleSelectItem = (item) => {
    if (!cartNodeIds.includes(item._id)) {
      setSelectedItemObjects(prev => [...prev, item]);
      dispatch(addToCart(item._id));
    }
    setShowResults(false);
    setInput("");
    setSearchTerm("");
  };

  const handleRemoveItem = (item) => {
    dispatch(removeFromCart(item._id));
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
        <div className={`search-results-dropdown ${shouldDropdownBeVisible ? "show" : ""}`}>
          <SearchResultsTable
            searchResults={searchResults}
            handleSelectItem={handleSelectItem}
          />
        </div>
      </div>

      {isLoading && <p>Loading selected items...</p>}

      {!isLoading && selectedItemObjects.length > 0 && (
        <SelectedItemsTable
          selectedItems={selectedItemObjects}
          generateGraph={onGenerateGraph}
          removeSelectedItem={handleRemoveItem}
        />
      )}
    </div>
  );
};

export default SearchBar;