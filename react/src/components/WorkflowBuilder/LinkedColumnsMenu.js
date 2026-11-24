/**
 * LinkedColumnsMenu lets the user pick which linked-node columns the solution
 * table shows. Each option is one edge hop; expanding it offers a second hop.
 */

import { useState } from "react";
import { getCollectionDisplayName } from "utils";
import { humanizeEdgeLabel } from "utils/solution";

// typeof keeps a missing label apart from the string "undefined".
const stepKey = (s) => `${typeof s.label}|${s.label}|${s.collection}`;
const pathKey = (path) => path.map(stepKey).join(">");
const optionText = (o) =>
  `${humanizeEdgeLabel(o.label)} → ${getCollectionDisplayName(o.collection)} (${o.count})`;

const LinkedColumnsMenu = ({
  options,
  chosen,
  onChange,
  loadNextHop,
  fields = [],
  shownFields = [],
  onChangeFields,
}) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const toggle = (path) => {
    const key = pathKey(path);
    const has = chosen.some((c) => pathKey(c.path) === key);
    onChange(has ? chosen.filter((c) => pathKey(c.path) !== key) : [...chosen, { path }]);
  };

  const toggleField = (name) =>
    onChangeFields(
      shownFields.includes(name) ? shownFields.filter((f) => f !== name) : [...shownFields, name],
    );

  // Chosen columns the current rows no longer offer (e.g. after switching the
  // row collection) stay listed so they can be removed.
  const reachable = (path) => {
    const first = options.find((o) => stepKey(o) === stepKey(path[0]));
    if (!first) return false;
    return (
      path.length === 1 ||
      loadNextHop(path.slice(0, 1)).some((o) => stepKey(o) === stepKey(path[1]))
    );
  };
  const orphans = chosen.filter((c) => !reachable(c.path));

  const renderOption = (option, prefix, expandable) => {
    const path = [...prefix, { label: option.label, collection: option.collection }];
    const key = pathKey(path);
    return (
      <li key={key}>
        <label>
          <input
            type="checkbox"
            checked={chosen.some((c) => pathKey(c.path) === key)}
            onChange={() => toggle(path)}
          />
          {optionText(option)}
        </label>
        {expandable && (
          <button
            type="button"
            aria-label={`Expand ${humanizeEdgeLabel(option.label)} → ${getCollectionDisplayName(option.collection)}`}
            aria-expanded={expanded === key}
            onClick={() => setExpanded(expanded === key ? null : key)}
          >
            {expanded === key ? "−" : "+"}
          </button>
        )}
        {expanded === key && <ul>{loadNextHop(path).map((o) => renderOption(o, path, false))}</ul>}
      </li>
    );
  };

  return (
    <div className="linked-columns-menu">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Columns
      </button>
      {open && (
        <ul>
          {fields.length > 0 && onChangeFields && (
            <li>
              Fields
              <ul>
                {fields.map(({ fieldName, displayName }) => (
                  <li key={fieldName}>
                    <label>
                      <input
                        type="checkbox"
                        checked={shownFields.includes(fieldName)}
                        onChange={() => toggleField(fieldName)}
                      />
                      {displayName}
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          )}
          {options.length === 0 && orphans.length === 0 && <li>No linked nodes</li>}
          {orphans.map(({ path }) => (
            <li key={pathKey(path)}>
              <label>
                <input type="checkbox" checked onChange={() => toggle(path)} />
                {path
                  .map(
                    (s) =>
                      `${humanizeEdgeLabel(s.label)} → ${getCollectionDisplayName(s.collection)}`,
                  )
                  .join(" → ")}{" "}
                (0)
              </label>
            </li>
          ))}
          {options.map((o) => renderOption(o, [], true))}
        </ul>
      )}
    </div>
  );
};

export default LinkedColumnsMenu;
