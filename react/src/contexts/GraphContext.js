import { createContext, useState } from "react";
import { DEFAULT_GRAPH_TYPE } from "../constants";

const defaultGraphContextValue = {
  graphType: DEFAULT_GRAPH_TYPE,
  setGraphType: () => {
    // Default no-op function
    console.warn("Attempted to set graph outside of GraphProvider");
  },
};

// Create a Provider Component
export const GraphProvider = ({ children }) => {
  const [graphType, setGraphType] = useState(DEFAULT_GRAPH_TYPE);
  const providerValue = {
    graphType,
    setGraphType,
  };
  return <GraphContext.Provider value={providerValue}>{children}</GraphContext.Provider>;
};

// Create context
export const GraphContext = createContext(defaultGraphContextValue);
