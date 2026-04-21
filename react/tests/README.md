# NLM-CKN MVP UI - Playwright E2E Testing

## Overview

This test suite uses **Playwright** for end-to-end (E2E) testing of the NLM-CKN MVP UI. The tests validate:

- **Page navigation** and routing behavior
- **User interactions** with forms, search, and visualizations
- **Graph operations** including generation, filtering, and save/load
- **API integration** via mocked backend responses
- **Runtime error detection** using custom instrumentation

## File Structure

```
tests/
└── e2e/
    ├── about.spec.ts                           → About page content
    ├── browse-sunburst.spec.ts                 → Sunburst visualization
    ├── collections.spec.ts                     → Collection browsing & filtering
    ├── document-page.spec.ts                   → Document details & graph panel
    ├── explore-tree.spec.ts                    → Tree hierarchy exploration
    ├── ftu-explorer.spec.ts                    → FTU illustration component
    ├── graph-page-origin.spec.ts               → Multi-origin graph generation
    ├── graph-page-settings.spec.ts             → Graph settings & toggles
    ├── graph-page-settings-depth-filters.spec.ts → Depth & edge filters
    ├── graph-page-settings-operation-shortestpath.spec.ts → Shortest path operation
    ├── graph-save-load.spec.ts                 → Graph persistence lifecycle
    ├── header-navigation.spec.ts               → Navbar navigation & active states
    ├── not-found.spec.ts                       → 404 page handling
    ├── search.spec.ts                          → Search functionality
    └── utils/
        ├── errorInstrumentation.ts             → Runtime error capture
        └── testSeeds.ts                        → Reusable mock data generators
```

## Configuration Files

### `playwright.config.ts` (Default)

Standard configuration for development and CI:

```typescript
{
  testDir: "./tests/e2e",
  timeout: 30_000,                    // 30s per test
  fullyParallel: true,                // Run tests in parallel
  trace: "off",                       // Traces disabled by default
  screenshot: "only-on-failure",      // Capture on failure
  video: "off",                       // Video disabled by default
  baseURL: "http://localhost:3000",   // CRA dev server
}
```

### `playwright.artifacts.config.ts` (Debug Mode)

Extended configuration with full artifact capture:

```typescript
{
  trace: "on",     // Always capture traces
  video: "on",     // Always record video
}
```

Use when debugging flaky tests or investigating failures.

## Running Tests

### NPM Scripts

```bash
# Run all tests (headless)
npm run test:e2e

# Run tests with browser visible
npm run test:e2e:headed

# Run with full artifacts (trace + video)
npm run test:e2e:artifacts

# View HTML report after run
npm run e2e:report
```

### Direct Playwright Commands

```bash
# Run specific test file
npx playwright test tests/e2e/search.spec.ts

# Run tests matching pattern
npx playwright test -g "navigation"

# Debug mode with inspector
npx playwright test --debug

# UI mode (interactive runner)
npx playwright test --ui
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | Base URL for tests |
| `CI` | - | When set, forces fresh server start |

## Test Patterns & Best Practices

### 1. Error Instrumentation

Every test should install error instrumentation to catch runtime errors:

```typescript
import { 
  installErrorInstrumentation,
  getCollectedErrors,
  filterErrorsContaining 
} from "./utils/errorInstrumentation";

test("My test", async ({ page }) => {
  await installErrorInstrumentation(page);
  
  // ... test logic ...
  
  // Assert no specific errors occurred
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
```

**What it captures:**
- `window.onerror` events
- `console.error()` calls
- Playwright `pageerror` events
- Console error messages

### 2. API Mocking

Mock all ArangoDB API endpoints to ensure tests are deterministic and fast:

```typescript
// Mock collections endpoint
await page.route("**/arango_api/collections/", async (route) => {
  if (route.request().method() === "POST") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(["TEST_COLLECTION"]),
    });
  }
  return route.continue();
});

// Mock graph data
await page.route("**/arango_api/graph/", async (route) => {
  if (route.request().method() === "POST") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockGraphData),
    });
  }
  return route.continue();
});
```

**Commonly mocked endpoints:**
- `/arango_api/collections/` - Available collections
- `/arango_api/edge_filter_options/` - Edge filter metadata
- `/arango_api/graph/` - Graph traversal data
- `/arango_api/document/details` - Document metadata
- `/arango_api/search/` - Search results
- `/arango_api/sunburst/` - Sunburst hierarchy data
- `/arango_api/collection/{name}/` - Collection documents
- `/arango_api/collection/{name}/{key}/` - Single document

### 3. Test Seeds (`testSeeds.ts`)

Use the provided seed generators for consistent mock data:

```typescript
import { 
  doc,           // Create document with _id and label
  edge,          // Create edge document
  sunburstRoot,  // Create sunburst hierarchy root
  simpleChildren,// Create array of child documents
  deepChildren,  // Create nested hierarchy
  smallGraphWithEdges,    // Complete graph with nodes + edges
  twoOriginRawGraphs,     // Multi-origin graph scenario
  shortestPathGraph       // A→B→C path structure
} from "./utils/testSeeds";

// Example: Create a document
const lung = doc("0001", "lung");
// → { _id: "TEST_DOCUMENT_COLLECTION/0001", label: "lung" }

// Example: Create an edge
const rel = edge("E1", lung._id, other._id, "related_to");
// → { _id: "TEST_EDGE_COLLECTION/E1", _from: ..., _to: ..., Label: "related_to" }
```

### 4. Redux State Seeding

For tests requiring pre-populated Redux state, use `addInitScript`:

```typescript
await page.addInitScript((originId) => {
  const persistedRoot = {
    nodesSlice: JSON.stringify({ originNodeIds: [originId] }),
    savedGraphs: JSON.stringify({ graphs: [] }),
    _persist: JSON.stringify({ version: -1, rehydrated: true }),
  };
  localStorage.setItem("persist:root", JSON.stringify(persistedRoot));
}, "TEST_COLLECTION/ROOT");
```

### 5. Hash-Based Routing

The app uses HashRouter (`/#/path`). Account for this in URL assertions:

```typescript
// Navigate to hash route
await page.goto("/#/about");

// Assert URL matches hash pattern
await expect(page).toHaveURL(/#\/about$/);
await expect(page).toHaveURL(new RegExp(`#/collections/${collectionId}$`));
```

### 6. Waiting for Async Content

Use Playwright's built-in auto-waiting with appropriate locators:

```typescript
// Wait for element to be visible
await expect(page.locator(".graph-svg")).toBeVisible();

// Wait for text content
await expect(page.locator("h1")).toHaveText(/Expected Title/);

// Wait for navigation
await expect(page).toHaveURL(/expected-path/);
```

## Test Categories

### Navigation Tests
- `header-navigation.spec.ts` - Navbar links and active states
- `not-found.spec.ts` - 404 page for invalid routes

### Page-Specific Tests
- `about.spec.ts` - Static content rendering
- `collections.spec.ts` - Collection list, filtering, document navigation
- `document-page.spec.ts` - Document details panel and embedded graph
- `search.spec.ts` - Search input, results, and navigation

### Visualization Tests
- `browse-sunburst.spec.ts` - D3 sunburst chart interaction
- `explore-tree.spec.ts` - Tree hierarchy expansion
- `ftu-explorer.spec.ts` - FTU illustration component

### Graph Tests
- `graph-page-settings.spec.ts` - Settings panel, label toggles
- `graph-page-origin.spec.ts` - Multi-origin graph generation
- `graph-page-settings-depth-filters.spec.ts` - Depth and edge filters
- `graph-page-settings-operation-shortestpath.spec.ts` - Shortest path operation
- `graph-save-load.spec.ts` - Save, load, and delete graph workflows

## Debugging Tips

### View Failed Test Artifacts

```bash
# Open HTML report with screenshots and traces
npm run e2e:report
```

### Run Single Test in Debug Mode

```bash
npx playwright test tests/e2e/search.spec.ts --debug
```

### Use UI Mode for Development

```bash
npx playwright test --ui
```

UI mode provides:
- Test file tree navigation
- Watch mode for re-running on changes
- Time-travel debugging with DOM snapshots
- Network request inspection

### Capture Full Artifacts

```bash
npm run test:e2e:artifacts
```

Check `playwright-report/` for traces and `test-results/` for videos.

### Increase Timeout for Debugging

```typescript
test("slow test", async ({ page }) => {
  test.setTimeout(60_000); // 60 seconds
  // ...
});
```

## CI/CD Integration

The configuration automatically adapts for CI environments:

```typescript
webServer: {
  command: "npm start",
  reuseExistingServer: !process.env.CI,  // Fresh server in CI
}
```

### GitHub Actions Example

```yaml
- name: Install Playwright Browsers
  run: npx playwright install --with-deps chromium

- name: Run E2E Tests
  run: npm run test:e2e
  env:
    CI: true

- name: Upload Test Report
  if: failure()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: react/playwright-report/
```

## Writing New Tests

### Template

```typescript
import { expect, test } from "@playwright/test";
import {
  filterErrorsContaining,
  getCollectedErrors,
  installErrorInstrumentation,
} from "./utils/errorInstrumentation";

test("Feature description", async ({ page }) => {
  // 1. Install error instrumentation
  await installErrorInstrumentation(page);

  // 2. Set up API mocks
  await page.route("**/arango_api/endpoint/", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ /* mock data */ }),
    });
  });

  // 3. Navigate to page
  await page.goto("/#/target-page");

  // 4. Perform actions
  await page.getByRole("button", { name: "Action" }).click();

  // 5. Assert results
  await expect(page.locator(".result")).toBeVisible();
  await expect(page).toHaveURL(/expected-url/);

  // 6. Verify no runtime errors
  expect(filterErrorsContaining(await getCollectedErrors(page), "split").length).toBe(0);
});
```

### Naming Conventions

- **Files**: `feature-name.spec.ts` (kebab-case with `.spec.ts` suffix)
- **Tests**: Descriptive sentence starting with feature area
- **Mocks**: Use `TEST_` prefix for collection/document IDs

### Checklist for New Tests

- [ ] Error instrumentation installed
- [ ] All required API endpoints mocked
- [ ] Uses test seeds for consistent data
- [ ] Proper locator strategies (role-based preferred)
- [ ] Hash routing accounted for in URL assertions
- [ ] No hardcoded timeouts (use auto-wait)
- [ ] Error assertion at end of test

## Troubleshooting

### "Test timeout exceeded"

- Increase timeout: `test.setTimeout(60_000)`
- Check if API mocks are missing (test waits for real response)
- Verify web server is starting correctly

### "Element not found"

- Check if element is inside shadow DOM
- Verify correct hash route navigation
- Ensure API mock returns expected structure

### "Flaky tests"

- Use `test:e2e:artifacts` to capture traces
- Check for race conditions in API mocks
- Add explicit waits for dynamic content

### "Server not starting"

- Port 3000 may be in use: `lsof -i :3000`
- Check `reuseExistingServer` setting
- Verify `npm start` works independently

---

**Last Updated**: Dec 2025  
**Maintained by**: NLM-CKN Team  
**Framework**: Playwright 1.56+
