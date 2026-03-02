import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { fetchCollections } from "services";
import { fetchEdgeFilterOptions, setAllCollections, setAvailableCollections } from "store";
import { parseCollections } from "utils";

/**
 * Shared hook for initializing graph collections and edge filter options.
 *
 * Fetches available collections for the given graphType, fetches all collections
 * (ontologies), and dispatches fetchEdgeFilterOptions when needed.
 *
 * @param {string} graphType - The graph type to fetch available collections for
 *   (e.g., "phenotypes" or "ontologies"). Refetches when this value changes.
 */
const useGraphDataInit = (graphType) => {
  const dispatch = useDispatch();

  useEffect(() => {
    fetchCollections(graphType).then((data) => {
      dispatch(setAvailableCollections(parseCollections(data)));
    });
    fetchCollections("ontologies").then((data) => {
      dispatch(setAllCollections(parseCollections(data)));
    });
  }, [dispatch, graphType]);

  useEffect(() => {
    dispatch(fetchEdgeFilterOptions());
  }, [dispatch, graphType]);
};

export { useGraphDataInit };
