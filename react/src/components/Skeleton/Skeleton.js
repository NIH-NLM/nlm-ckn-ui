/**
 * SkeletonWrapper — accessible loading region.
 * Wraps skeleton placeholders with role="status" + aria-live="polite"
 * so screen readers announce the loading state. The visible children
 * are purely decorative (aria-hidden) while the visually-hidden span
 * provides the spoken announcement.
 */
export function SkeletonWrapper({ children, label = "Loading..." }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: <output> cannot contain block-level children like <table>
    <div role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/**
 * SkeletonLine — animated placeholder for a single line of text.
 *
 * Props:
 *   width  — CSS width string, default "100%"
 *   height — CSS height string, default "1em"
 */
export function SkeletonLine({ width = "100%", height = "1em" }) {
  return <div className="skeleton skeleton-line" aria-hidden="true" style={{ width, height }} />;
}

/**
 * SkeletonCard — animated placeholder for a document card.
 * Mimics a title line, two body lines, and a short footer line.
 */
export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton skeleton-card-title" />
      <div className="skeleton skeleton-card-body" />
      <div className="skeleton skeleton-card-body skeleton-card-body--short" />
      <div className="skeleton skeleton-card-footer" />
    </div>
  );
}

/**
 * SkeletonTable — animated placeholder for a search results table.
 *
 * Props:
 *   rows    — number of placeholder rows to render, default 5
 *   columns — number of placeholder columns per row, default 3
 */
export function SkeletonTable({ rows = 5, columns = 3 }) {
  return (
    <table className="skeleton-table" aria-hidden="true">
      <thead>
        <tr>
          {Array.from({ length: columns }).map((_, colIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder, no stable key available
            <th key={colIndex}>
              <div className="skeleton skeleton-table-header" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder, no stable key available
          <tr key={rowIndex}>
            {Array.from({ length: columns }).map((_, colIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder, no stable key available
              <td key={colIndex}>
                <div className="skeleton skeleton-table-cell" />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
