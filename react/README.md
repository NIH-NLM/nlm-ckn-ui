# Cell Knowledge Network - React Frontend

This is the React frontend for the NLM Cell Knowledge Network MVP application. It provides interactive visualizations for exploring biological knowledge graphs including cell types, anatomical structures, and their relationships.

## 🛠 Tech Stack

- **React 19** - UI framework
- **Redux Toolkit** - State management with `redux-persist` for persistence and `redux-undo` for history
- **React Router 6** - Client-side routing (HashRouter for Django deployment)
- **D3.js v7** - Data visualizations (force graphs, sunbursts, trees)
- **Biome** - Linting and formatting
- **Jest + React Testing Library** - Unit testing
- **Playwright** - End-to-end testing

## 📁 Project Structure

```
react/
├── public/                  # Static assets and index.html
├── src/
│   ├── assets/              # Images and static resources
│   ├── components/          # Reusable UI components
│   │   ├── ForceGraph/      # Force-directed graph visualization
│   │   │   ├── hooks/       # Custom hooks for graph functionality
│   │   │   │   ├── useGraphData.js      # Graph data processing
│   │   │   │   ├── useGraphExport.js    # Export to PNG/SVG/PDF
│   │   │   │   └── useGraphSettings.js  # Settings management
│   │   │   ├── panels/      # UI panel components
│   │   │   │   ├── GraphLegend.js       # Collection legend
│   │   │   │   ├── GraphOriginList.js   # Origin node list
│   │   │   │   ├── GraphSettingsPanel.js # Settings drawer
│   │   │   │   ├── GraphToolbar.js      # Action buttons
│   │   │   │   └── SetOperationInfo.js  # Set operation display
│   │   │   └── ForceGraph.js  # Main graph container
│   │   ├── ForceGraphConstructor/  # D3 graph rendering logic
│   │   │   ├── graphDataProcessing.js   # Node/link processing
│   │   │   ├── graphRendering.js        # D3 rendering functions
│   │   │   ├── simulationUtils.js       # Force simulation setup
│   │   │   └── ForceGraphConstructor.js # Main D3 orchestration
│   │   ├── Sunburst/        # Hierarchical sunburst visualization
│   │   ├── SunburstConstructor/  # D3 sunburst rendering
│   │   ├── Tree/            # Tree structure visualization
│   │   ├── TreeConstructor/ # D3 tree rendering
│   │   └── ...              # Other UI components
│   ├── constants/           # Application-wide constants
│   │   ├── api.js           # API endpoint URLs
│   │   ├── external.js      # External service URLs (FTU, etc.)
│   │   ├── graph.js         # Graph-related constants & defaults
│   │   └── index.js         # Barrel exports
│   ├── contexts/            # React Context providers
│   │   ├── ActiveNavContext.js  # Navigation state
│   │   ├── FTUPartsContext.js   # FTU parts data
│   │   └── GraphContext.js      # Graph configuration
│   ├── hooks/               # Custom React hooks
│   │   ├── useHotkeys.js    # Keyboard shortcut handling
│   │   ├── useHotkeyHold.js # Hold-to-activate hotkey behavior
│   │   └── index.js         # Barrel exports
│   ├── pages/               # Page-level components (routes)
│   │   ├── AboutPage/
│   │   ├── CollectionsPage/
│   │   ├── DocumentPage/
│   │   ├── GraphPage/
│   │   ├── SearchPage/
│   │   └── ...
│   ├── services/            # API communication layer
│   │   └── api/
│   │       ├── collections.js  # Collection API calls
│   │       ├── graph.js        # Graph API calls
│   │       ├── search.js       # Search API calls
│   │       └── index.js
│   ├── store/               # Redux store configuration
│   │   ├── store.js         # Store setup with middleware
│   │   ├── graphSlice.js    # Graph state management
│   │   ├── nodesSlice.js    # Node selection state
│   │   └── savedGraphsSlice.js
│   ├── styles/              # CSS stylesheets
│   │   ├── global.css       # Global styles
│   │   └── ...              # Component-specific styles
│   ├── utils/               # Utility functions
│   │   ├── collections.js   # Collection helpers (getLabel, parseId)
│   │   ├── colors.js        # D3 color scales for collections
│   │   ├── graph.js         # Graph utilities (findNodeById, etc.)
│   │   ├── setOperations.js # Graph set operations (union, intersection)
│   │   ├── strings.js       # String formatting helpers
│   │   ├── platform.js      # Platform detection
│   │   └── index.js         # Barrel exports
│   ├── App.js               # Root component with routing
│   └── index.js             # Application entry point
├── tests/
│   └── e2e/                 # Playwright E2E tests
├── biome.json               # Biome config
├── playwright.config.ts     # Playwright config
└── package.json
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm
- Running Django backend (see main project README)
- ArangoDB database running via Docker

### Installation

```bash
# From the react/ directory
npm install
```

### Development

```bash
# Start development server (proxies API to Django on port 8000)
npm start
```

The React dev server runs on `http://localhost:3000` and proxies API requests to the Django backend at `http://127.0.0.1:8000`.

### Building for Production

```bash
# Build React app and run Django collectstatic
npm run build
```

This runs two commands:
1. `npm run build-react` - Creates production build in `build/`
2. `npm run collectstatic-django` - Copies static files to Django's staticfiles

## 🧪 Testing

### Unit Tests (Jest)

```bash
# Run all tests
npm test

# Run in watch mode
npm test -- --watch

# Run specific test file
npm test -- SearchBar.test.js

# Run with coverage
npm test -- --coverage
```

### End-to-End Tests (Playwright)

```bash
# Run E2E tests (headless)
npm run test:e2e

# Run E2E tests with browser UI
npm run test:e2e:headed

# View test report
npm run e2e:report
```

## 🔧 Code Quality

### Linting & Formatting (Biome)

```bash
# Check for issues
npm run check

# Fix all issues (lint + format)
npm run fix

# Format only
npm run format

# Lint only
npm run lint
```

**Important**: Always run `npm run fix` before committing to ensure consistent code style.

## 📊 Key Features

### Graph Visualization
The force-directed graph (`ForceGraph` component) allows exploring relationships between biological entities. Features include:
- Interactive node dragging
- Zoom and pan
- Configurable traversal depth and direction
- Node/edge filtering by collection type
- Export to PNG/SVG/PDF

### Sunburst Visualization
Hierarchical visualization of ontology structures (cell types, anatomical structures). Features:
- Click-to-zoom navigation
- Breadcrumb trail
- Color-coded by collection

### Search
Full-text search across collections with:
- Collection filtering
- Results with collection tags
- Direct navigation to entity details

## 🔗 API Integration

The frontend communicates with the Django backend through the proxy configuration. API modules are organized in `services/api/`:

- **collections.js** - Fetch collections, list documents
- **graph.js** - Fetch graph data, hierarchies
- **search.js** - Search across collections

Example usage:
```javascript
import { fetchCollections, fetchGraph } from '../services/api';

// Fetch all collections
const collections = await fetchCollections();

// Fetch graph for an entity
const graphData = await fetchGraph(entityId, depth, direction);
```

## 🏗 Architecture Patterns

### State Management
- **Redux** for global app state (graph data, selected nodes, saved graphs)
- **React Context** for feature-specific state (navigation, graph config)
- **Local state** for component-specific UI state

### Component Organization
Components follow the pattern:
```
ComponentName/
├── ComponentName.js       # Main component
├── ComponentName.test.js  # Unit tests
├── ComponentName.css      # Styles (when needed)
└── index.js               # Barrel export
```

### D3 Integration
D3 visualizations are implemented using a layered architecture:

**ForceGraph (React Layer)**
- Main component manages layout and UI panels
- `hooks/` directory contains data processing, export, and settings logic
- `panels/` directory contains toolbar, legend, and settings UI components

**ForceGraphConstructor (D3 Layer)**
- `ForceGraphConstructor.js` - Orchestrates D3 rendering
- `graphDataProcessing.js` - Processes nodes and links with colors/labels
- `graphRendering.js` - Handles D3 DOM updates and styling
- `simulationUtils.js` - Configures force simulation parameters

## 🔑 Environment Variables

Create a `.env` file in the `react/` directory if needed:

```env
# Example (most config handled by Django proxy)
REACT_APP_API_URL=/api
```

## 📝 Contributing

1. Create a feature branch from `main`
2. Make changes following existing patterns
3. Run `npm run fix` to lint/format
4. Run `npm test` to ensure tests pass
5. Submit a pull request

## 📚 Additional Resources

- [Main Project README](../README.md) - Backend setup and deployment
- [Django ArangoDB API](../arango_api/) - Backend API documentation
- [React Documentation](https://react.dev/)
- [D3.js Documentation](https://d3js.org/)
