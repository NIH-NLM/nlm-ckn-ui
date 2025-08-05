import { configureStore } from "@reduxjs/toolkit";
import graphReducer from "./graphSlice";

export const store = configureStore({
  reducer: {
    graph: graphReducer,
  },
  // redux-undo expected to be non-serializable
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ["graph/undo", "graph/redo", "graph/jump"],
        ignoredPaths: ["graph.past", "graph.future", "graph._latestUnfiltered"],
      },
    }),
});
