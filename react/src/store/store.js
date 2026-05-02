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
import workflowBuilderReducer from "./workflowBuilderSlice";

const persistConfig = {
  key: "root",
  storage,
  whitelist: ["nodesSlice", "savedGraphs"],
};

const rootReducer = combineReducers({
  graph: graphReducer,
  nodesSlice: nodesSliceReducer,
  savedGraphs: savedGraphsReducer,
  workflowBuilder: workflowBuilderReducer,
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

// Expose store for E2E/tests. Always on in dev; in production builds gated on
// REACT_APP_EXPOSE_STORE so the e2e CI webServer (which serves the production
// bundle) can still drive the store. The CRA build inlines REACT_APP_* vars at
// compile time, so this stays out of real production deployments.
if (
  typeof window !== "undefined" &&
  (process.env.NODE_ENV !== "production" || process.env.REACT_APP_EXPOSE_STORE === "true")
) {
  window.__STORE__ = store;
  window.__ACTIONS__ = window.__ACTIONS__ || {};
  window.__ACTIONS__.fetchNow = () => store.dispatch(fetchAndProcessGraph());
}
