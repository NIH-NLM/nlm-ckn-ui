import { combineReducers, configureStore } from "@reduxjs/toolkit";
import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  persistReducer,
  persistStore,
  REGISTER,
  REHYDRATE,
} from "redux-persist";
import storage from "redux-persist/lib/storage";
import graphReducer, { fetchAndProcessGraph } from "./graphSlice";
import nodesSliceReducer from "./nodesSlice";
import savedGraphsReducer from "./savedGraphsSlice";

const persistConfig = {
  key: "root",
  storage,
  whitelist: ["nodesSlice", "savedGraphs"],
};

const rootReducer = combineReducers({
  graph: graphReducer,
  nodesSlice: nodesSliceReducer,
  savedGraphs: savedGraphsReducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          FLUSH,
          REHYDRATE,
          PAUSE,
          PERSIST,
          PURGE,
          REGISTER,
          "graph/undo",
          "graph/redo",
          "graph/jump",
        ],
        ignoredPaths: ["graph.past", "graph.future", "graph._latestUnfiltered"],
      },
    }),
});

export const persistor = persistStore(store);

// Expose store for E2E/tests in non-production environments
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  window.__STORE__ = store;
  window.__ACTIONS__ = window.__ACTIONS__ || {};
  window.__ACTIONS__.fetchNow = () => store.dispatch(fetchAndProcessGraph());
}
