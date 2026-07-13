import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";
import { setGraphData } from "./graphSlice";

const initialState = {
  savedGraphs: [],
  activeGraphId: null,
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
    renameGraph: (state, action) => {
      const { id, name } = action.payload;
      const graph = state.savedGraphs.find((g) => g.id === id);
      if (graph) graph.name = name;
    },
    setActiveGraph: (state, action) => {
      state.activeGraphId = action.payload;
    },
  },
});

export const { saveGraph, deleteGraph, renameGraph, setActiveGraph } = savedGraphsSlice.actions;

/**
 * Restores a saved graph into the live graph and marks it active.
 * @param {string} id
 */
export const restoreSavedGraph = (id) => (dispatch, getState) => {
  const graph = getState().savedGraphs.savedGraphs.find((g) => g.id === id);
  if (!graph) return;
  dispatch(
    setGraphData({
      graphData: graph.graphData,
      originNodeIds: graph.originNodeIds,
      settings: graph.settings,
      skipUndo: true,
    }),
  );
  dispatch(setActiveGraph(id));
};

/**
 * Snapshots the current live graph onto the shelf. No-op if the graph is empty.
 * @param {{ name?: string, thumbnail?: string|null }} [opts]
 */
export const snapshotCurrentGraph =
  ({ name = "Graph Title", thumbnail = null } = {}) =>
  (dispatch, getState) => {
    const present = getState().graph.present;
    const nodes = present?.graphData?.nodes ?? [];
    if (!nodes.length) return;
    dispatch(
      saveGraph({
        name,
        originNodeIds: present.originNodeIds ?? [],
        settings: present.settings ?? {},
        graphData: present.graphData,
        thumbnail,
      }),
    );
  };

export default savedGraphsSlice.reducer;
