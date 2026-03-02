# Workflow Builder — Architecture Overview

## What It Does

The Workflow Builder is a **multi-phase graph query orchestrator**. Users build pipelines of sequential "phases," where each phase traverses a biomedical knowledge graph (ontologies or phenotypes stored in ArangoDB) starting from a set of origin nodes. Phases can be chained — one phase's output becomes the next phase's input — or combined via set operations (Union, Intersection, Symmetric Difference). Results are displayed as interactive tables and D3 force-directed graphs.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        WorkflowBuilderPage                              │
│  ┌────────────────────────────┐   ┌──────────────────────────────────┐  │
│  │     WorkflowBuilder        │   │         Results Area             │  │
│  │                            │   │                                  │  │
│  │  ┌──────────────────────┐  │   │  ┌─ Phase Tabs ──────────────┐  │  │
│  │  │   PresetSelector     │  │   │  │ [Phase 1] [Phase 2] [...]  │  │  │
│  │  │   (grid of presets)  │  │   │  └────────────────────────────┘  │  │
│  │  └──────────────────────┘  │   │                                  │  │
│  │           OR               │   │  ┌─ View Toggle ─────────────┐  │  │
│  │  ┌──────────────────────┐  │   │  │ [Table]  [Graph]          │  │  │
│  │  │   Phase Editor #1    │  │   │  └────────────────────────────┘  │  │
│  │  │  ┌────────────────┐  │  │   │                                  │  │
│  │  │  │ Origin Source   │  │  │   │  ┌────────────────────────────┐ │  │
│  │  │  │ ○ Manual        │  │  │   │  │     ResultsTable           │ │  │
│  │  │  │ ○ Collection    │  │  │   │  │  (Nodes tab / Edges tab)   │ │  │
│  │  │  │ ○ Prev Phase    │  │  │   │  │  + CSV download            │ │  │
│  │  │  │ ○ Combine       │  │  │   │  └────────────────────────────┘ │  │
│  │  │  └────────────────┘  │  │   │            OR                    │  │
│  │  │  ┌────────────────┐  │  │   │  ┌────────────────────────────┐ │  │
│  │  │  │ NodeSearchInput │  │  │   │  │     ForceGraph (D3.js)     │ │  │
│  │  │  │ (search nodes)  │  │  │   │  │  ┌──────────────────────┐ │ │  │
│  │  │  └────────────────┘  │  │   │  │  │  Force Simulation     │ │ │  │
│  │  │  ┌────────────────┐  │  │   │  │  │  • Charge repulsion   │ │ │  │
│  │  │  │ Settings        │  │  │   │  │  │  • Center gravity     │ │ │  │
│  │  │  │ • Depth (0-9)   │  │  │   │  │  │  • Link springs      │ │ │  │
│  │  │  │ • Direction     │  │  │   │  │  └──────────────────────┘ │ │  │
│  │  │  │ • Set Operation │  │  │   │  │  Drag / Zoom / Pan        │ │  │
│  │  │  │ • Collections   │  │  │   │  │  Right-click context menu  │ │  │
│  │  │  │ • Edge Filters  │  │  │   │  │  Expand / Collapse nodes   │ │  │
│  │  │  │ • Per-node      │  │  │   │  └────────────────────────────┘ │  │
│  │  │  │   overrides     │  │  │   │                                  │  │
│  │  │  └────────────────┘  │  │   └──────────────────────────────────┘  │
│  │  │  [Execute Phase]     │  │                                         │
│  │  └──────────────────────┘  │                                         │
│  │         ↕ connector        │                                         │
│  │  ┌──────────────────────┐  │                                         │
│  │  │   Phase Editor #2    │  │                                         │
│  │  │   (chains from #1)   │  │                                         │
│  │  └──────────────────────┘  │                                         │
│  │  [+ Add Phase]             │                                         │
│  │  [Execute All Phases]      │                                         │
│  └────────────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Redux State Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │              Redux Store                    │
                        ├─────────────────────────────────────────────┤
                        │                                             │
                        │  workflowBuilderSlice                       │
                        │  ├── phases[] (config + cached results)     │
                        │  ├── phaseResults{} (source of truth)       │
                        │  ├── nodeDetails{} (label cache)            │
                        │  ├── status, executingPhaseId, error        │
                        │  ├── activePhaseId, activeGraph             │
                        │  └── showPresetSelector                     │
                        │                                             │
                        │  graphSlice (wrapped in redux-undo)         │
                        │  ├── graphData (nodes + links for D3)       │
                        │  ├── settings (depth, fonts, labels, etc.)  │
                        │  ├── collapsed state                        │
                        │  ├── availableEdgeFilters                   │
                        │  └── past[] / future[] (undo/redo history)  │
                        │                                             │
                        └─────────────────────────────────────────────┘
```

---

## Phase Execution Data Flow

```
User configures phase
        │
        ▼
┌─ Origin Resolution ──────────────────────────────────┐
│                                                      │
│  "manual"        → use user-selected node IDs        │
│  "collection"    → fetch all IDs from collection     │
│  "previousPhase" → filter prior phase's result nodes │
│                    (all / leafNodes / originNodes)    │
│  "multiplePhases"→ combine results via set operation │
│                    (no API call — pure merge)         │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌─ Build Per-Node Settings ────────────────────────────┐
│  For each origin node:                               │
│    shared settings (depth, direction, collections,   │
│    edge filters) MERGED with per-node overrides      │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
            POST /arango_api/graph/
            { node_ids, advanced_settings, graph }
                           │
                           ▼
┌─ Backend Traversal ──────────────────────────────────┐
│  ArangoDB graph traversal per origin node             │
│  Returns { nodeId: { nodes[], links[] } }            │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌─ Frontend Merge ─────────────────────────────────────┐
│  performSetOperation(results, "Union"|"Intersection") │
│  Filter by returnCollections if specified             │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
    Cache in phaseResults[phaseId] + phase.result
    Invalidate all downstream phase caches
    Set activeGraph → render in table / D3 graph
```

---

## API Endpoints

```
┌───────────────────────────────────────────────────────┐
│              Django Backend                            │
│                                                       │
│  GET  /arango_api/workflow_presets/                    │
│       → returns preset definitions + categories       │
│                                                       │
│  POST /arango_api/graph/                              │
│       → traverses ArangoDB graph from origin nodes    │
│       → returns { nodeId: {nodes, links} }            │
│                                                       │
│  POST /arango_api/collection/{name}/                  │
│       → returns all documents in a collection         │
│                                                       │
│  POST /arango_api/document/details                    │
│       → returns node metadata by IDs                  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  workflow_service.py                             │  │
│  │  • execute_workflow(phases, graph)               │  │
│  │  • execute_preset(preset_id, overrides)          │  │
│  │  • _execute_phase() — resolves origins,          │  │
│  │    traverses graph, applies set operations       │  │
│  └─────────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────────┐  │
│  │  ArangoDB (Knowledge Graph)                      │  │
│  │  Collections: CL, MONDO, UBERON, HP, ...         │  │
│  │  Edges: SUB_CLASS_OF, PART_OF, etc.              │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
```

---

## Phase Data Model

Each phase in a workflow contains:

```javascript
{
  id: string,                      // Unique phase identifier
  name: string,                    // User-friendly display name

  // Where to get origin nodes
  originSource: "manual" | "collection" | "previousPhase" | "multiplePhases",
  originNodeIds: string[],         // For manual selection
  originCollection: string | null, // For collection-based origin
  previousPhaseId: string | null,  // For single-phase chaining
  previousPhaseIds: string[],      // For multi-phase combining
  phaseCombineOperation: "Union" | "Intersection" | "Symmetric Difference",
  originFilter: "all" | "leafNodes" | "originNodes",

  // Traversal settings
  settings: {
    depth: number,                 // 0-9 hops
    edgeDirection: "ANY" | "INBOUND" | "OUTBOUND",
    allowedCollections: string[],  // Filter traversal to these collections
    edgeFilters: { Label: [], Source: [] },
    setOperation: "Union" | "Intersection" | "Symmetric Difference",
    graphType: "ontologies" | "phenotypes",
    returnCollections: string[],   // Filter results to these collections
    includeInterNodeEdges: boolean,
    collapseLeafNodes: boolean,
    useFocusNodes: boolean,
  },

  // Optional per-node overrides (advanced mode)
  perNodeSettings: {
    [nodeId]: { depth, edgeDirection, allowedCollections, edgeFilters }
  },

  // Cached execution result
  result: { nodes: [], links: [] } | null,
}
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Dual result storage** (`phaseResults{}` + `phase.result`) | `phaseResults` is the source of truth for cross-phase lookups; `phase.result` is a convenience mirror for rendering |
| **Cascade invalidation** | When a phase changes, all downstream phases that depend on it have their cached results cleared automatically |
| **Per-node settings** | Advanced users can set different traversal depth/direction/filters per origin node within a single phase |
| **Custom D3 (no React Flow)** | Full control over force simulation physics, SVG rendering, and interactions for the biomedical graph domain |
| **URL-based sharing** | Workflows are base64-encoded into a `?w=` query parameter so users can share configurations via link |
| **Preset system** | Backend-defined preset workflows (with categories) give users starting templates for common exploration patterns |

---

## Graph Visualization

The results area renders an interactive **D3.js force-directed graph**:

- **Forces**: Charge repulsion (-1000), center gravity, link springs (175px target distance)
- **Nodes**: SVG circles colored by collection; origin nodes optionally rendered as "donut" rings
- **Edges**: Straight lines for single links, curved arcs for parallel links, loops for self-references; all with directional arrows
- **Labels**: Node ID, collection abbreviation, edge label, edge source — each independently toggleable, visibility tied to zoom level
- **Interactions**: Drag nodes, zoom/pan canvas, right-click context menu (expand, collapse leaves, remove node, open external link)
- **Color system**: Each ArangoDB collection (CL, MONDO, UBERON, HP, etc.) gets a consistent color from a config map; auto-generated legend

---

## File Inventory

### React Frontend (`react/src/`)

| File | Role |
|------|------|
| `pages/WorkflowBuilderPage/WorkflowBuilderPage.js` | Page layout: sidebar + results area with phase tabs |
| `components/WorkflowBuilder/WorkflowBuilder.js` | Main orchestrator: header, phases list, execute buttons, sharing |
| `components/WorkflowBuilder/PhaseEditor.js` | Single phase config: origin source, settings, per-node overrides |
| `components/WorkflowBuilder/PresetSelector.js` | Grid of preset workflow cards fetched from API |
| `components/WorkflowBuilder/NodeSearchInput.js` | Debounced search dropdown for selecting origin nodes |
| `components/WorkflowBuilder/ResultsTable.js` | Tabbed nodes/edges table with CSV export |
| `components/FilterableDropdown/FilterableDropdown.js` | Reusable multi-select dropdown for collections and edge filters |
| `components/ForceGraph/ForceGraph.js` | D3 graph React wrapper: lifecycle, settings sync, interactions |
| `components/ForceGraph/ForceGraphConstructor.js` | Core D3 engine: SVG setup, force simulation, zoom, drag |
| `store/workflowBuilderSlice.js` | Redux slice: phases, execution, caching, cascade invalidation |
| `store/graphSlice.js` | Redux slice: graph data, settings, collapse state, undo/redo |
| `constants/workflowPresets.js` | Default phase settings (`QUERY_DEFAULTS`, `UI_DEFAULTS`) |
| `utils/setOperations.js` | Union / Intersection / Symmetric Difference on graph results |
| `services/api/workflows.js` | `fetchWorkflowPresets()` API call |
| `services/api/graph.js` | `fetchGraphData()`, `expandNode()` API calls |
| `hooks/useSearch.js` | Debounced search with keyboard navigation |
| `styles/workflow-builder.css` | All workflow builder styling |

### Django Backend

| File | Role |
|------|------|
| `arango_api/views.py` | `WorkflowExecuteView`, `WorkflowPresetsView`, `GraphTraversalView` |
| `arango_api/serializers.py` | `PhaseSerializer`, `WorkflowExecuteSerializer`, validation |
| `arango_api/services/workflow_service.py` | Phase execution logic, origin resolution, set operations |
| `arango_api/workflow_presets.py` | Preset definitions with phases and categories |
| `arango_api/urls.py` | URL routing for all API endpoints |
