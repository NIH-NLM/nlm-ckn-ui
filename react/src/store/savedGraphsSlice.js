import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid"; // A library for generating unique IDs

// Initial state for the saved graphs slice.
const initialState = {
  // An array to hold all the saved graph objects.
  savedGraphs: [],
};

const savedGraphsSlice = createSlice({
  name: "savedGraphs",
  initialState,
  reducers: {
    /**
     * Saves the current graph configuration to the list.
     * action.payload should be: { name: string, originNodeIds: string[], settings: object }
     */
    saveGraph: (state, action) => {
      const { name, originNodeIds, settings, graphData } = action.payload;
      const newSavedGraph = {
        id: uuidv4(),
        name: name,
        timestamp: new Date().toISOString(),
        originNodeIds: originNodeIds,
        settings: settings,
        graphData: graphData,
      };
      state.savedGraphs.push(newSavedGraph);
    },

    /**
     * Deletes a saved graph by its unique ID.
     * action.payload should be the ID of the graph to delete.
     */
    deleteGraph: (state, action) => {
      const idToDelete = action.payload;
      state.savedGraphs = state.savedGraphs.filter((graph) => graph.id !== idToDelete);
    },
  },
});

export const { saveGraph, deleteGraph } = savedGraphsSlice.actions;

export default savedGraphsSlice.reducer;
