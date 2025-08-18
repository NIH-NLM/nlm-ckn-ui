import { configureStore, combineReducers } from "@reduxjs/toolkit";
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from "redux-persist";
import storage from "redux-persist/lib/storage";
import graphReducer from "./graphSlice";
import cartReducer from "./cartSlice";

// Configuration object for redux-persist.
const persistConfig = {
  key: "root",
  storage,
  whitelist: ["cart"],
};

// Combine all reducers into a single root reducer.
const rootReducer = combineReducers({
  graph: graphReducer,
  cart: cartReducer,
});

// Create a new persist reducer.
const persistedReducer = persistReducer(persistConfig, rootReducer);

// Configure the store with the persisted reducer.
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

// Create a persistor object that will be used to wrap the application.
export const persistor = persistStore(store);