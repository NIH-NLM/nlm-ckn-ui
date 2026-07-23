import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";
import { setGraphData } from "./graphSlice";

const initialState = {
  savedGraphs: [],
  activeGraphId: null,
  originHistory: [],
  activeHistoryId: null,
};

const savedGraphsSlice = createSlice({
  name: "savedGraphs",
  initialState,
  reducers: {
    saveGraph: (state, action) => {
      const { name, originNodeIds, settings, graphData, thumbnail } = action.payload;
      const newSavedGraph = {
        id: uuidv4(),
        name,
        timestamp: new Date().toISOString(),
        originNodeIds,
        settings,
        graphData,
        thumbnail: thumbnail ?? null,
      };
      state.savedGraphs.push(newSavedGraph);
      state.activeGraphId = newSavedGraph.id;
    },
    deleteGraph: (state, action) => {
      const idToDelete = action.payload;
      state.savedGraphs = state.savedGraphs.filter((g) => g.id !== idToDelete);
      if (state.activeGraphId === idToDelete) state.activeGraphId = null;
    },
    setActiveGraph: (state, action) => {
      state.activeGraphId = action.payload;
    },
    addHistoryEntry: (state, action) => {
      // Strip any incoming "checked" field (a UI-only selection flag); history
      // entries never persist it.
      // biome-ignore lint/correctness/noUnusedVariables: destructured only to omit it from entry
      const { checked, ...entry } = action.payload;
      // One entry per origin; re-adding an already-tracked origin doesn't
      // duplicate it, but still focuses it as the active version.
      if (!state.originHistory.some((e) => e.originId === entry.originId)) {
        state.originHistory.push({ thumbnail: null, ...entry });
      }
      state.activeHistoryId = entry.id;
    },
    deleteHistoryEntry: (state, action) => {
      state.originHistory = state.originHistory.filter((h) => h.id !== action.payload);
      if (state.activeHistoryId === action.payload) state.activeHistoryId = null;
    },
    setActiveHistory: (state, action) => {
      state.activeHistoryId = action.payload;
    },
  },
});

export const {
  saveGraph,
  deleteGraph,
  setActiveGraph,
  addHistoryEntry,
  deleteHistoryEntry,
  setActiveHistory,
} = savedGraphsSlice.actions;

// Stable empty reference so the fallback doesn't churn selector identity.
const EMPTY_SAVED_GRAPHS = [];

/**
 * Reads the saved-graph list, normalizing to an empty array. `savedGraphs` is
 * session-only, but a stale blob rehydrated from an older build can leave the
 * array undefined; every consumer goes through here so none of them crash on it.
 * @param {object} state
 * @returns {Array}
 */
export const selectSavedGraphs = (state) => state.savedGraphs.savedGraphs ?? EMPTY_SAVED_GRAPHS;

const EMPTY_HISTORY = [];

/**
 * Reads the origin-history list, normalizing to an empty array. `originHistory`
 * is session-only.
 * @param {object} state
 * @returns {Array}
 */
export const selectOriginHistory = (state) => state.savedGraphs.originHistory ?? EMPTY_HISTORY;

/**
 * Restores a history entry's subgraph into the live graph and marks it active,
 * preserving positions (no re-query, no re-simulation).
 * @param {string} id
 */
export const restoreHistoryEntry = (id) => (dispatch, getState) => {
  const entry = selectOriginHistory(getState()).find((e) => e.id === id);
  if (!entry) return;
  dispatch(setGraphData({ graphData: entry.subgraph, isRestore: true, skipUndo: true }));
  dispatch(setActiveHistory(id));
};

export default savedGraphsSlice.reducer;
