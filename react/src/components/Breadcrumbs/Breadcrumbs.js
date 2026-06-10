import { Link } from "react-router-dom";

/**
 * Breadcrumbs — explicit crumbs prop required.
 *
 * HashRouter with flat Routes does not support useMatches/route handle.
 * Each page must supply its own crumbs array. If route paths change,
 * the crumbs arrays in each page component will need to be updated manually.
 *
 * @param {Array<{label: string, path: string}>} crumbs
 */
function Breadcrumbs({ crumbs }) {
  if (!crumbs || crumbs.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol className="breadcrumbs-list">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.path} className="breadcrumbs-item">
              {isLast ? (
                <span aria-current="page">{crumb.label}</span>
              ) : (
                <>
                  <Link to={crumb.path}>{crumb.label}</Link>
                  <span className="breadcrumbs-separator" aria-hidden="true">
                    &gt;
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
