import { createSlice } from "@reduxjs/toolkit";

// Initial state for cart slice.
const initialState = {
  originNodeIds: [],
};

// Redux slice for managing user's selection of origin nodes.
const cartSlice = createSlice({
  name: "cart",
  initialState,
  // Synchronous actions and reducers.
  reducers: {
    /**
     * Adds single node ID to cart.
     * Prevents duplicate entries.
     */
    addToCart: (state, action) => {
      const nodeId = action.payload;
      if (!state.originNodeIds.includes(nodeId)) {
        state.originNodeIds.push(nodeId);
      }
    },
    /**
     * Removes single node ID from cart.
     */
    removeFromCart: (state, action) => {
      const nodeIdToRemove = action.payload;
      state.originNodeIds = state.originNodeIds.filter(
        (id) => id !== nodeIdToRemove,
      );
    },
    /**
     * Clears all node IDs from cart.
     */
    clearCart: (state) => {
      state.originNodeIds = [];
    },
    /**
     * Replaces entire cart with new array of node IDs.
     */
    setCart: (state, action) => {
      state.originNodeIds = action.payload;
    },
    /**
     * Adds node ID to cart if not present, or removes it if it is.
     */
    toggleCartItem: (state, action) => {
      const nodeId = action.payload;
      const index = state.originNodeIds.indexOf(nodeId);
      if (index >= 0) {
        // If item exists, remove it.
        state.originNodeIds.splice(index, 1);
      } else {
        // If item does not exist, add it.
        state.originNodeIds.push(nodeId);
      }
    },
  },
});

// Export action creators for use in components.
export const {
  addToCart,
  removeFromCart,
  clearCart,
  setCart,
  toggleCartItem,
} = cartSlice.actions;

// Export reducer for inclusion in Redux store.
export default cartSlice.reducer;