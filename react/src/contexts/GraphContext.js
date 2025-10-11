import { createContext, useState } from "react";

const defaultGraphContextValue = {
  graphType: "phenotypes",
  setGraphType: () => {
    // Default no-op function
    console.warn("Attempted to set graph outside of GraphProvider");
  },
};

// Create a Provider Component
export const GraphProvider = ({ children }) => {
  const [graphType, setGraphType] = useState("phenotypes");
  const providerValue = {
    graphType,
    setGraphType,
  };
  return <GraphContext.Provider value={providerValue}>{children}</GraphContext.Provider>;
};

// Create context
export const GraphContext = createContext(defaultGraphContextValue);
