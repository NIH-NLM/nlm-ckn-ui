/**
 * PresetSelector component for displaying and selecting workflow presets.
 *
 * Shows pre-built workflow examples that users can load, explore, and modify.
 */

import { PRESET_CATEGORIES, WORKFLOW_PRESETS } from "constants/index";
import { memo, useMemo } from "react";

/**
 * PresetSelector displays available workflow presets grouped by category.
 */
const PresetSelector = ({ onSelectPreset, onStartFromScratch }) => {
  // Group presets by category
  const groupedPresets = useMemo(() => {
    const groups = {};
    for (const preset of WORKFLOW_PRESETS) {
      const category = preset.category || "Other";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(preset);
    }
    return groups;
  }, []);

  return (
    <div className="preset-selector">
      <div className="preset-selector-header">
        <h3>Start from a preset, or build your own</h3>
        <p className="preset-description">
          Presets are pre-built workflows that demonstrate common use cases. Load one, see how it
          works, then modify it to explore your own questions.
        </p>
      </div>

      <div className="preset-categories">
        {PRESET_CATEGORIES.map((category) => {
          const presets = groupedPresets[category.id];
          if (!presets || presets.length === 0) return null;

          return (
            <div key={category.id} className="preset-category">
              <h4 className="category-label">{category.label}</h4>
              <div className="preset-cards">
                {presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className="preset-card"
                    onClick={() => onSelectPreset(preset)}
                  >
                    <span className="preset-name">{preset.name}</span>
                    <span className="preset-card-description">{preset.description}</span>
                    <span className="preset-phases-count">
                      {preset.phases.length} phase{preset.phases.length > 1 ? "s" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="preset-custom">
        <button type="button" className="preset-card custom" onClick={onStartFromScratch}>
          <span className="preset-name">+ Start from scratch</span>
          <span className="preset-card-description">Build a custom workflow step by step</span>
        </button>
      </div>
    </div>
  );
};

export default memo(PresetSelector);
