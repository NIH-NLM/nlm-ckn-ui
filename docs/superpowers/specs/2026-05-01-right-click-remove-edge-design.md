# Right-Click "Remove Edge" — Design

**Date:** 2026-05-01
**Status:** Approved (pending implementation plan)
**Owner:** Will Spear

## Problem

The graph already opens a context popup (`DocumentPopup`) on right-click for both nodes and edges. For nodes, the menu offers Expand / Collapse Leaves / Remove Node / Add to Graph. For edges, the menu currently offers only a single "Go To" link to the edge's document detail page.

Users want the ability to remove a single edge from the current graph view from that same popup.

## Goals

- Add a "Remove Edge" action to the edge right-click popup.
- Removal is session-only — it modifies the in-memory rendered graph, not the backend.
- Removal is undoable through the existing undo (Cmd+Z / undo button) by leveraging redux-undo's `setGraphData` checkpoint.
- Both endpoint nodes remain in the graph after edge removal, even if a node becomes orphaned.

## Non-Goals

- No backend mutation (the underlying graph in ArangoDB is not changed).
- No automatic cleanup of orphaned nodes.
- No bulk edge removal (only one edge at a time, via the popup).
- No new "Remove Edge" affordance outside the right-click popup.
- No confirmation dialog (matches Remove Node, which has none).

## Behavior Contract

- Right-clicking an edge opens the existing `DocumentPopup`. The popup gains a "Remove Edge" button below the existing "Go To" link.
- Clicking "Remove Edge":
  - Removes the link from the rendered graph.
  - Leaves both source and target nodes in place, even if one becomes disconnected.
  - Creates a redux-undo checkpoint so the action can be undone.
  - Closes the popup.
- Self-loops (source.id === target.id) are removable using the same mechanism.
- Re-applying settings (which triggers a re-fetch via `initializeGraph` / `fetchAndProcessGraph`) restores the removed edge — consistent with how Remove Node works today.

## Architecture

The change mirrors the existing "Remove Node" idiom one-for-one. Three touch points:

### 1. `react/src/components/ForceGraph/ForceGraph.js`

Add a new handler alongside `handleRemove`:

```js
const handleRemoveEdge = () => {
  if (!popup.nodeId || !popup.isEdge) return;
  const linkId = popup.nodeId;
  const currentGraph = graphInstanceRef.current?.getCurrentGraph?.();
  if (currentGraph) {
    const newLinks = currentGraph.links.filter((l) => (l._id ?? null) !== linkId);
    dispatch(
      setGraphData({ nodes: currentGraph.nodes, links: newLinks }),
    );
  }
  graphInstanceRef.current?.updateGraph({
    removeLink: linkId,
    labelStates: settings.labelStates,
  });
  handlePopupClose();
};
```

Add a button to `DocumentPopup` shown only when `popup.isEdge` is true:

```jsx
<button
  type="button"
  className="document-popup-button"
  onClick={handleRemoveEdge}
  style={{ display: popup.isEdge ? "block" : "none" }}
>
  Remove Edge
</button>
```

The popup's `popup.nodeId` field already stores the edge's `_id` when `popup.isEdge` is true (`handleNodeClick` sets it from `nodeData._id`).

### 2. `react/src/components/ForceGraphConstructor/ForceGraphConstructor.js`

Extend the `updateGraph` signature with a new optional parameter:

```js
function updateGraph({
  ...
  removeLink = null,
  ...
} = {}) {
  ...
  // After the collapseNodes/removeNode block:
  if (removeLink) {
    processedLinks = processedLinks.filter((l) => l._id !== removeLink);
  }
  ...
}
```

The filter runs after the existing `collapseNodes` block but before `simulation.nodes(...)` / `forceLink.links(...)` so the simulation reflects the removal.

### 3. `react/src/store/graphSlice.js`

No change required. `setGraphData` is already in the redux-undo filter (it creates an undo checkpoint when `skipUndo` is not set), and the dispatch in `handleRemoveEdge` does not pass `skipUndo`.

## Data Flow

```text
user right-clicks edge
  → onNodeClick (existing) opens DocumentPopup with popup.isEdge=true, popup.nodeId=edge._id
user clicks "Remove Edge"
  → handleRemoveEdge fires
    → reads current rendered graph from D3 instance
    → dispatches setGraphData({ nodes, links-without-edge })   ← undo checkpoint
    → calls graphInstance.updateGraph({ removeLink: edgeId })
      → filters processedLinks
      → simulation.nodes / forceLink.links updated
      → renderGraph re-runs (D3 data join removes the link's <g class="link">)
    → closes popup
```

## Edge Cases

- **Self-loops:** The link's `_id` is unique whether or not source.id === target.id. The filter in `updateGraph` runs on `_id`, so self-loops are handled the same way. The constructor's separate `selfLinkEnter` rendering branch is also keyed on `_id` via the existing data join, so the removed self-loop is cleanly removed.
- **Edge clicked while filtered out:** Cannot happen — the popup is only opened when an edge is clicked, and a filtered-out edge isn't rendered.
- **Edge re-added by re-fetch:** Expected. Re-fetch produces a fresh edge list. Identical to the Remove Node behavior; no special handling.
- **Undo after re-fetch:** A re-fetch dispatches `initializeGraph` (which is in the undo filter and creates its own checkpoint). Undoing past a re-fetch goes to the pre-fetch state, which already does not include the removed edge — correct behavior, no special handling needed.

## Testing

Two new tests:

### `ForceGraphConstructor.test.js`
- After calling `updateGraph({ removeLink: someLinkId })`, the resulting `getCurrentGraph().links` does not contain a link with that `_id`. Both endpoint nodes are still present.

### `ForceGraph.test.js`
- After right-clicking a rendered edge, the popup shows a "Remove Edge" button.
- After right-clicking a node, the popup does not show "Remove Edge".
- Clicking "Remove Edge" dispatches `setGraphData` with the target edge's `_id` absent from `links`.

Manual verification: with `npm run watch` running, right-click an edge in the graph, click "Remove Edge", confirm the edge disappears, both endpoint nodes remain, and Cmd+Z restores the edge.

## Risks

- **Low.** The change is surgical, mirrors an existing pattern, touches two component files, and adds no new dependencies or state shape.
- The constructor's `updateGraph` already accepts several optional parameters; adding one more follows the same shape.
