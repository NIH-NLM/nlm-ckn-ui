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
      // History is a timeline of origin events, not a set of unique origins:
      // an origin toggled off and back on is captured again, so the earlier
      // card keeps describing the composition it was captured from. Callers
      // supply a unique id.
      state.originHistory.push({ thumbnail: null, ...entry });
      state.activeHistoryId = entry.id;
    },
    deleteHistoryEntry: (state, action) => {
      state.originHistory = state.originHistory.filter((h) => h.id !== action.payload);
      if (state.activeHistoryId === action.payload) state.activeHistoryId = null;
    },
    // Refreshes an existing history entry's captured graph (and optionally its
    // thumbnail) so it holds the most recent version rather than a stale
    // first-resolve snapshot. No-op if the entry no longer exists.
    //
    // Thumbnails are only ever replaced by a truthy one: captureGraphThumbnail
    // is best-effort and resolves to null on any failure, and a failed capture
    // must not destroy the good picture a card already holds — a card can be
    // frozen straight after such a write and would keep the blank forever. The
    // first real thumbnail still lands, since entries start out with none.
    updateHistoryEntry: (state, action) => {
      const { id, subgraph, thumbnail } = action.payload;
      const entry = state.originHistory.find((h) => h.id === id);
      if (!entry) return;
      if (subgraph) entry.subgraph = subgraph;
      if (thumbnail) entry.thumbnail = thumbnail;
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
  updateHistoryEntry,
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
  // Carry the captured composition's origins back with the subgraph. Without
  // them the reducer's isRestore branch cleared the live origins, so restoring
  // a card emptied the Origins panel and unmarked the origin nodes in a graph
  // that plainly still contained them. `originNodeIds` is the full set the
  // entry was captured from; `originId` alone is the fallback for an entry
  // recorded before the set was kept.
  const originNodeIds = entry.originNodeIds ?? (entry.originId ? [entry.originId] : []);
  dispatch(
    setGraphData({
      graphData: entry.subgraph,
      originNodeIds,
      isRestore: true,
      skipUndo: true,
    }),
  );
  dispatch(setActiveHistory(id));
};

/**
 * Keeps the currently active history entry's captured graph and thumbnail in
 * sync with the live graph, so restoring it later shows the most recent version
 * instead of the first-resolve snapshot.
 *
 * Callers capture the active entry id at the moment the graph settled and pass
 * it as `targetId`; the sync is dropped unless that entry is *still* the active
 * one. The thumbnail capture that precedes this dispatch is async, so the
 * active entry can be frozen and another one activated while it is in flight —
 * comparing ids (rather than merely checking that something is active) is what
 * keeps a settle's graph out of a card it never described.
 *
 * No-op when no entry is active, or when `targetId` is omitted.
 * @param {{ nodes: Array, links: Array }} subgraph
 * @param {string|null} thumbnail
 * @param {string} targetId - the entry that was active when the settle fired
 */
export const syncActiveHistoryEntry = (subgraph, thumbnail, targetId) => (dispatch, getState) => {
  const activeId = getState().savedGraphs.activeHistoryId;
  if (!activeId || activeId !== targetId) return;
  dispatch(updateHistoryEntry({ id: activeId, subgraph, thumbnail }));
};

export default savedGraphsSlice.reducer;
