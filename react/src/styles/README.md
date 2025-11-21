# Styles Directory

This directory contains the modular CSS architecture for the Cell Knowledge Network MVP UI.

## File Structure

The CSS has been split into 8 logical files to improve maintainability and organization:

### 1. `variables.css` (~70 lines)
**CSS custom properties and theme definitions**
- Color palette definitions (`:root`)
- Dark theme overrides (`.dark`)
- Generic utility background classes

### 2. `base.css` (~95 lines)
**Global resets and base element styles**
- Universal selector reset
- Base typography (body, a)
- Default element styles (table, button, select, etc.)

### 3. `layout.css` (~155 lines)
**Page layouts and structural containers**
- Page layout patterns (`.search-page-layout`, `.collections-page-layout`, etc.)
- Content boxes (`.main-search-box`, `.content-box`, etc.)
- Page titles
- Image containers

### 4. `navigation.css` (~120 lines)
**Navigation and header components**
- App header (`.app-header`, `.navbar`)
- Footer (`.site-footer`)
- Navigation states (`.active-nav`)

### 5. `components.css` (~900 lines)
**Reusable component styles**
- Search components
- Buttons (action buttons, primary/secondary buttons, add-to-graph)
- Tables
- Forms and inputs
- Switches and toggles
- Pills
- Modals and popups
- Links

### 6. `graph.css` (~560 lines)
**Graph visualization components**
- Chart container
- Graph options panel
- Tab navigation
- Collection controls
- Node groups and lists
- Graph display area
- Settings and actions

### 7. `pages.css` (~650 lines)
**Page-specific styles**
- DocumentPage
- AboutPage
- CollectionsPage / BrowseBox
- SunburstPage
- FTU Explorer

### 8. `utilities.css` (~175 lines)
**Utility classes and helpers**
- Text utilities (`.nowrap`, `.wrap`)
- Display utilities (`.hidden`, `.flex-full`)
- Loading states
- Progress bars
- Messages
- Keyboard hints
- Animations (`@keyframes`)

## Import Order

**IMPORTANT**: The order of imports matters! Styles should be imported in this specific order:

```javascript
import "./styles/variables.css";    // 1. Variables first
import "./styles/base.css";         // 2. Base resets
import "./styles/layout.css";       // 3. Layout patterns
import "./styles/navigation.css";   // 4. Navigation
import "./styles/components.css";   // 5. Reusable components
import "./styles/graph.css";        // 6. Graph-specific
import "./styles/pages.css";        // 7. Page-specific
import "./styles/utilities.css";    // 8. Utilities last
```

Alternatively, use the single entry point:
```javascript
import "./styles/index.css";
```

## Adding New Styles

When adding new CSS:

1. **Determine the correct file** based on the style's purpose:
   - Is it a new color/variable? → `variables.css`
   - Is it for a new page? → `pages.css`
   - Is it a reusable component? → `components.css`
   - Is it graph-related? → `graph.css`
   - Is it a utility class? → `utilities.css`

2. **Follow existing patterns** in that file
3. **Document complex selectors** with comments
4. **Test in both light and dark themes** (if applicable)

## Legacy File

The original `App.css` (2747 lines) has been preserved in the root but is no longer imported. It can be removed once the refactoring is validated in production.

## Next Steps

- Part 2: Cross-check for unused classes
- Part 3: Consolidate duplicates and remove redundancy
- Part 4: Final reorganization based on findings
