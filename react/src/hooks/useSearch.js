import { useCallback, useEffect, useRef, useState } from "react";
import { searchDocuments } from "services";
import { getAllSearchableFields } from "utils";

const DEBOUNCE_MS = 250;

const useSearch = (graphType) => {
  const containerRef = useRef(null);
  const debounceTimeoutRef = useRef(null);
  const mountedRef = useRef(true);

  const [query, setQueryState] = useState("");
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Track mount state for async safety
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Click-outside to close
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, []);

  const setQuery = useCallback(
    (value) => {
      setQueryState(value);
      setHighlightedIndex(-1);

      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);

      if (!value.trim()) {
        setResults([]);
        setIsOpen(false);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      debounceTimeoutRef.current = setTimeout(async () => {
        const searchFields = Array.from(getAllSearchableFields());
        const data = await searchDocuments(value, graphType, searchFields);
        if (!mountedRef.current) return;
        setResults(data || []);
        setIsOpen(true);
        setIsLoading(false);
      }, DEBOUNCE_MS);
    },
    [graphType],
  );

  const clearSearch = useCallback(() => {
    setQueryState("");
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setHighlightedIndex(-1);
  }, []);

  const handleKeyDown = useCallback(
    (e) => {
      if (!isOpen || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    },
    [isOpen, results],
  );

  return {
    query,
    setQuery,
    results,
    isOpen,
    setIsOpen,
    isLoading,
    highlightedIndex,
    setHighlightedIndex,
    containerRef,
    clearSearch,
    handleKeyDown,
  };
};

export { useSearch };
