import React from "react";
import { useDispatch, useSelector } from "react-redux";
import { toggleNodesSliceItem } from "../../store/nodesSlice";

/**
 * A  button to add or remove a node from the graph list.
 * It displays an icon-only state by default, with option for text passed in props.
 * @param {string} nodeId - The ID of the node this button controls.
 * @param {string} [text] - Optional text to display next to the icon.
 */
const AddToGraphButton = ({ nodeId, text }) => {
  const dispatch = useDispatch();
  // Select the list of node IDs from slice.
  const nodesSliceNodeIds = useSelector((state) => state.nodesSlice.originNodeIds);
  // Check if the specific node for this button is already in the list.
  const isAdded = nodesSliceNodeIds.includes(nodeId);

  const handleToggle = (e) => {
    // Stop the click from propagating to a parent link or element.
    e.preventDefault();
    e.stopPropagation();
    dispatch(toggleNodesSliceItem(nodeId));
  };

  // Adjust class if text is present.
  const buttonClass = `add-to-graph-button ${isAdded ? "added" : ""} ${text ? "has-text" : ""}`;

  return (
    <button
      className={buttonClass}
      onClick={handleToggle}
      title={isAdded ? "Remove from Graph" : "Add to Graph"}
    >
      {/* Icon target */}
      <span className="icon-container"></span>
      {/* Render text if prop provided */}
      {text && <span className="text-container">{text}</span>}
    </button>
  );
};

export default AddToGraphButton;
