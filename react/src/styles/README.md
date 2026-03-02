# NLM-CKN MVP UI - CSS Architecture

## Overview

This stylesheet system has been modernized to align with **NCBI Style Guide** and **USWDS (U.S. Web Design System)** standards, with a focus on:

- **Modularity**: Reusable components and utility classes
- **Responsiveness**: Mobile-first design with breakpoints
- **Maintainability**: CSS variables for consistency
- **Accessibility**: WCAG-compliant colors and touch targets

## File Structure & Import Order

Files are imported in the following cascade order (see `index.css`):

```
variables.css     → Design tokens (colors, spacing, breakpoints)
base.css          → Global resets and element defaults
layout.css        → Page structure and containers
navigation.css    → Header, navbar, footer
components.css    → Reusable components (buttons, cards, tables)
graph.css         → Graph visualization specific styles
pages.css         → Page-specific layouts
utilities.css     → Utility classes (flexbox, spacing, display)
responsive.css    → Responsive utilities and overrides
```

**Order matters**: Later files can override earlier ones. Responsive utilities come last to ensure they take precedence.

## Design Tokens (variables.css)

### Color Palette (USWDS Compliant)

**Primary Blues**
- `--color-primary`: #0071bc (Main brand blue)
- `--color-primary-dark`: #205493
- `--color-primary-darker`: #112e51

**Secondary & Accents**
- `--color-secondary`: #e31c3d (Red for alerts/danger)
- `--color-focus`: #3e94cf (Focus states)
- `--color-visited`: #4c2c92 (Visited links)

**Tertiary**
- `--color-tertiary-green`: #2e8540
- `--color-tertiary-gold`: #fdb81e

**Neutrals**
- Grays from `--color-gray-lightest` (#f1f1f1) to `--color-gray-dark` (#323a45)

### Spacing Scale (USWDS Standard)

```css
--spacing-xs: 0.375rem;   /* 6px */
--spacing-sm: 0.9375rem;  /* 15px - USWDS unit */
--spacing-md: 1.25rem;    /* 20px - USWDS unit */
--spacing-lg: 1.875rem;   /* 30px - USWDS unit */
--spacing-xl: 3.75rem;    /* 60px - USWDS unit */
```

### Typography Scale

```css
--font-size-sm: 0.875rem;   /* 14px */
--font-size-base: 1rem;     /* 16px */
--font-size-lg: 1.125rem;   /* 18px */
--font-size-xl: 1.5rem;     /* 24px */
--font-size-2xl: 2rem;      /* 32px */
--font-size-3xl: 2.5rem;    /* 40px */
```

**Font Family**: Roboto (not Roboto Mono), with Roboto Mono reserved for `<code>` and `<pre>` elements only.

### Breakpoints (Mobile-First)

```css
--breakpoint-mobile: 640px;   /* Tablet start */
--breakpoint-tablet: 768px;   /* Standard tablet */
--breakpoint-desktop: 1024px; /* Desktop start */
--breakpoint-wide: 1200px;    /* Wide screens */
```

### Dark Theme

Dark mode uses semantic variable remapping:
- `--color-white` → `#323a45` (dark background)
- `--color-text` → `#f1f1f1` (light text)
- **Brand colors do NOT change** in dark mode (maintains USWDS compliance)

## Component Patterns

### Button System

Base class with size and variant modifiers:

```css
.btn               /* Base button */
.btn-primary       /* Blue, primary action */
.btn-secondary     /* Gray, secondary action */
.btn-danger        /* Red, destructive action */
.btn-sm            /* Small size */
.btn-lg            /* Large size */
```

**Legacy classes preserved**: `.action-button`, `.remove-button`, etc. still work for backward compatibility.

### Card System

```css
.card              /* Base card component */
.card-sm           /* Small card (reduced padding) */
.card-lg           /* Large card (increased padding) */
```

### Tables

Wrap tables in `.table-wrapper` for horizontal scroll on mobile:

```html
<div class="table-wrapper">
  <table class="search-results-table">
    <!-- table content -->
  </table>
</div>
```

## Utility Classes

### Flexbox Utilities

```css
.flex              /* display: flex */
.flex-col          /* flex-direction: column */
.flex-row          /* flex-direction: row */
.items-center      /* align-items: center */
.items-start       /* align-items: flex-start */
.items-end         /* align-items: flex-end */
.justify-between   /* justify-content: space-between */
.justify-center    /* justify-content: center */
.justify-end       /* justify-content: flex-end */
```

### Spacing Utilities

```css
.gap-xs, .gap-sm, .gap-md, .gap-lg, .gap-xl    /* Gap using spacing scale */
.p-*, .px-*, .py-*, .pt-*, .pr-*, .pb-*, .pl-* /* Padding */
.m-*, .mx-*, .my-*, .mt-*, .mr-*, .mb-*, .ml-* /* Margin */
```

### Display Utilities

```css
.block             /* display: block */
.inline-block      /* display: inline-block */
.hidden            /* display: none */
.w-full            /* width: 100% */
.h-full            /* height: 100% */
```

## Responsive Design

### Mobile-First Approach

All base styles are designed for mobile (<640px) first. Media queries progressively enhance for larger screens:

```css
/* Mobile base (no media query) */
.app-header {
  flex-direction: column;
  padding: var(--spacing-md);
}

/* Tablet and up */
@media (min-width: 640px) {
  .app-header {
    flex-direction: row;
    padding: var(--spacing-lg);
  }
}

/* Desktop and up */
@media (min-width: 1024px) {
  .app-header {
    padding: calc(var(--spacing-lg) * 1.5);
  }
}
```

### Responsive Utilities (responsive.css)

```css
.container           /* Responsive container with max-width and padding */
.mobile-full         /* width: 100% on mobile */
.mobile-hide         /* Hidden on mobile (<640px) */
.desktop-only        /* Only visible on desktop (≥1024px) */
.tablet-up           /* Visible on tablet and up (≥640px) */
```

### Key Responsive Patterns

**Navigation**
- Mobile: Vertical stack, reduced padding
- Desktop: Horizontal layout with spacing

**Document Page**
- Mobile: `.document-card-panel` and `.force-graph-panel` stack vertically
- Tablet+: Side-by-side layout (40% / 60% split)

**Graph Side Panel**
- Mobile: Full-screen overlay (slides in from right)
- Desktop: Fixed sidebar (300px width)

**Tables**
- Mobile: Horizontal scroll with touch support
- Desktop: Full width display

## Accessibility Features

- **Touch Targets**: Minimum 44x44px on interactive elements (WCAG AAA)
- **Color Contrast**: USWDS colors meet WCAG AA standards
- **Focus States**: Visible focus indicators using `--color-focus`
- **Semantic HTML**: Proper use of headings, landmarks, ARIA labels

## Migration Notes

### Using New Components

**Before** (legacy):
```html
<button class="action-button">Submit</button>
<div class="content-box">...</div>
```

**After** (recommended):
```html
<button class="btn btn-primary">Submit</button>
<div class="card">...</div>
```

**Both still work** due to backward compatibility.

## Testing Checklist

Test responsive behavior at these widths:

- **480px**: Mobile small (phones in portrait)
- **640px**: Mobile large / Tablet small (breakpoint)
- **768px**: Tablet (standard iPad)
- **1024px**: Desktop (breakpoint)
- **1200px**: Wide desktop (breakpoint)

**What to test**:
- [ ] Navigation stacks properly on mobile
- [ ] Touch targets are 44px minimum
- [ ] Tables scroll horizontally on mobile
- [ ] Document page panels stack vertically on mobile
- [ ] Graph side panel overlays on mobile
- [ ] Forms and inputs are usable on touch devices
- [ ] No horizontal scrolling on any viewport
- [ ] Dark mode works across all breakpoints

---

**Last Updated**: Dec 2025
**Maintained by**: NLM-CKN Team
**Standards**: NCBI Style Guide + USWDS 2.x
