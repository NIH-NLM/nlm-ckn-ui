/**
 * ResultsTabs switches the results panel between the workflow's answer (Results)
 * and the selected step's results (Results in context).
 */

const TABS = [
  ["data", "Results"],
  ["context", "Results in context"],
];

const ResultsTabs = ({ tab, onChange }) => (
  <div role="tablist" aria-label="Results" className="results-view-tabs">
    {TABS.map(([value, label]) => (
      <button
        type="button"
        role="tab"
        key={value}
        aria-selected={tab === value}
        className={`view-tab${tab === value ? " active" : ""}`}
        onClick={() => onChange(value)}
      >
        {label}
      </button>
    ))}
  </div>
);

export default ResultsTabs;
