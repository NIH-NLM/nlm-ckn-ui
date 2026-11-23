/**
 * ResultsTabs switches the results panel between the workflow's answer (Results)
 * and the selected step's results (Results in context).
 */
import { useRef } from "react";

const TABS = [
  ["data", "Results"],
  ["context", "Results in context"],
];

// Props that make an element the panel for a tab. tabIndex lets Tab reach a
// panel whose content has nothing focusable, such as a step that has not run.
export const resultsPanelProps = (value) => ({
  role: "tabpanel",
  tabIndex: 0,
  id: `results-panel-${value}`,
  "aria-labelledby": `results-tab-${value}`,
});

const ResultsTabs = ({ tab, onChange }) => {
  const buttons = useRef({});
  // Left and Right move to the other tab, wrapping, and select it.
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: TABS.length - 1 }[e.key];
    if (!step) return;
    const next = TABS[(TABS.findIndex(([v]) => v === tab) + step) % TABS.length][0];
    onChange(next);
    buttons.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Results" className="results-view-tabs">
      {TABS.map(([value, label]) => (
        <button
          type="button"
          role="tab"
          key={value}
          id={`results-tab-${value}`}
          aria-controls={`results-panel-${value}`}
          aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1}
          ref={(el) => {
            buttons.current[value] = el;
          }}
          className={`view-tab${tab === value ? " active" : ""}`}
          onClick={() => onChange(value)}
          onKeyDown={onKeyDown}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

export default ResultsTabs;
