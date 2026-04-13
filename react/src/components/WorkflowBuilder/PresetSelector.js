/**
 * PresetSelector component for displaying and selecting workflow presets.
 *
 * Shows pre-built workflow examples that users can load, explore, and modify.
 * Presets and categories are fetched from the backend API.
 */

import { memo, useEffect, useMemo, useState } from "react";
import { fetchWorkflowPresets } from "services";

/**
 * PresetSelector displays available workflow presets grouped by section and category.
 */
const PresetSelector = ({ onSelectPreset, onStartFromScratch }) => {
  const [presets, setPresets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorkflowPresets()
      .then((data) => {
        if (cancelled) return;
        const presetList = Array.isArray(data) ? data : data?.presets;
        const categoryList = data?.categories;
        const sectionList = data?.sections;
        if (Array.isArray(presetList)) {
          setPresets(presetList);
        }
        if (Array.isArray(categoryList)) {
          setCategories(categoryList);
        }
        if (Array.isArray(sectionList)) {
          setSections(sectionList);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load presets.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Group presets by category
  const groupedPresets = useMemo(() => {
    const groups = {};
    for (const preset of presets) {
      const category = preset.category || "Other";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(preset);
    }
    return groups;
  }, [presets]);

  // Derive display categories: use API categories if available, otherwise
  // fall back to the order in which categories appear in the presets array.
  const displayCategories = useMemo(() => {
    if (categories.length > 0) return categories;
    const seen = new Set();
    const derived = [];
    for (const preset of presets) {
      const cat = preset.category || "Other";
      if (!seen.has(cat)) {
        seen.add(cat);
        derived.push({ id: cat, label: cat });
      }
    }
    return derived;
  }, [categories, presets]);

  // Build section -> categories mapping
  const sectionStructure = useMemo(() => {
    if (sections.length === 0) {
      // No sections — flat category list (backward compatible)
      return null;
    }
    // Map each section to its categories
    const categoryBySection = {};
    for (const section of sections) {
      categoryBySection[section.id] = [];
    }
    // Collect categories without a section
    const unsectioned = [];
    for (const cat of displayCategories) {
      const sectionId = cat.section;
      if (sectionId && categoryBySection[sectionId]) {
        categoryBySection[sectionId].push(cat);
      } else {
        unsectioned.push(cat);
      }
    }
    return { categoryBySection, unsectioned };
  }, [sections, displayCategories]);

  const renderCategory = (category) => {
    const categoryPresets = groupedPresets[category.id];
    if (!categoryPresets || categoryPresets.length === 0) return null;

    return (
      <div key={category.id} className="preset-category">
        <h5 className="category-label">{category.label}</h5>
        <div className="preset-cards">
          {categoryPresets.map((preset) => (
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
  };

  return (
    <div className="preset-selector custom-scrollbar">
      <div className="preset-selector-header">
        <h3>Start from a preset, or build your own</h3>
        <p className="preset-description">
          Presets are pre-built workflows that demonstrate common use cases. Load one, see how it
          works, then modify it to explore your own questions.
        </p>
      </div>

      <div className="preset-custom">
        <button type="button" className="preset-card custom" onClick={onStartFromScratch}>
          <span className="preset-name">+ Start from scratch</span>
          <span className="preset-card-description">Build a custom workflow step by step</span>
        </button>
      </div>

      {loading ? (
        <div className="preset-loading">Loading presets...</div>
      ) : error ? (
        <div className="preset-error">
          <p>Unable to load presets: {error}</p>
          <p>You can still build a workflow from scratch.</p>
        </div>
      ) : sectionStructure ? (
        <div className="preset-categories">
          {sections.map((section) => {
            const sectionCats = sectionStructure.categoryBySection[section.id] || [];
            const hasPresets = sectionCats.some((cat) => groupedPresets[cat.id]?.length > 0);
            if (!hasPresets) return null;

            return (
              <div key={section.id} className="preset-section">
                <h4 className="section-label">{section.label}</h4>
                {sectionCats.map(renderCategory)}
              </div>
            );
          })}
          {/* Render any unsectioned categories */}
          {sectionStructure.unsectioned.map(renderCategory)}
        </div>
      ) : (
        <div className="preset-categories">{displayCategories.map(renderCategory)}</div>
      )}
    </div>
  );
};

export default memo(PresetSelector);
