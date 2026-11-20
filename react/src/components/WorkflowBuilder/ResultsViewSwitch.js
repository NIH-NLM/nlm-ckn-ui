/**
 * ResultsViewSwitch chooses whether a step's results show as a graph or a table.
 */

const VIEWS = [
  ["graph", "Graph"],
  ["table", "Table"],
];

const ResultsViewSwitch = ({ view, onChange }) => (
  <fieldset aria-label="Show results as" className="results-view-switch">
    {VIEWS.map(([value, label]) => (
      <button
        type="button"
        key={value}
        aria-pressed={view === value}
        onClick={() => onChange(value)}
      >
        {label}
      </button>
    ))}
  </fieldset>
);

export default ResultsViewSwitch;
