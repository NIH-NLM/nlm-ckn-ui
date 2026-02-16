import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { updateSetting } from "../../../store";

// Whitelist of settings that can be configured on a per-node basis.
const PER_NODE_SETTINGS = [
  "depth",
  "edgeDirection",
  "allowedCollections",
  "nodeFontSize",
  "edgeFontSize",
  "labelStates",
  "collapseOnStart",
  "edgeFilters",
];

// Settings that take effect immediately (display-only) and should NOT
// trigger the "Apply Changes" banner when changed.
const DISPLAY_ONLY_SETTINGS = [
  "useFocusNodes",
  "labelStates",
  "nodeFontSize",
  "edgeFontSize",
];

/**
 * Hook for managing per-node settings in advanced mode.
 * @param {Object} settings - Current graph settings from Redux
 * @param {Array} originNodeIds - Array of origin node IDs
 * @param {Object} lastAppliedSettings - Last applied settings snapshot
 * @param {Object} lastAppliedPerNodeSettings - Last applied per-node settings snapshot
 * @returns {Object} Per-node settings state and handlers
 */
export function usePerNodeSettings(
  settings,
  originNodeIds,
  lastAppliedSettings,
  lastAppliedPerNodeSettings,
) {
  const dispatch = useDispatch();

  // State for advanced per-node settings.
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [perNodeSettings, setPerNodeSettings] = useState({});
  const [activeOriginNodeId, setActiveOriginNodeId] = useState(null);
  const settingsRef = useRef(settings);
  const perNodeSettingsRef = useRef(perNodeSettings);

  // Keep the refs updated with the latest state on every render.
  useEffect(() => {
    settingsRef.current = settings;
  });
  useEffect(() => {
    perNodeSettingsRef.current = perNodeSettings;
  });

  // Effect to synchronize Redux state with local per-node settings.
  useEffect(() => {
    if (isAdvancedMode && activeOriginNodeId) {
      // Use the refs to get the most up-to-date state without adding them as dependencies.
      const currentSettings = settingsRef.current;
      const currentPerNodeSettings = perNodeSettingsRef.current;

      const newActiveSettings = currentPerNodeSettings[activeOriginNodeId];
      if (!newActiveSettings) return; // Guard against race conditions

      for (const [settingKey, value] of Object.entries(newActiveSettings)) {
        if (PER_NODE_SETTINGS.includes(settingKey)) {
          if (JSON.stringify(currentSettings[settingKey]) !== JSON.stringify(value)) {
            dispatch(updateSetting({ setting: settingKey, value: value }));
          }
        }
      }
    }
  }, [isAdvancedMode, activeOriginNodeId, dispatch]);

  // Effect to sync filter changes back to local per-node state.
  useEffect(() => {
    // Only run this logic if advanced mode is active and a node is selected.
    if (isAdvancedMode && activeOriginNodeId) {
      // Check if the edgeFilters in Redux are different from what's stored locally.
      if (
        JSON.stringify(settings.edgeFilters) !==
        JSON.stringify(perNodeSettings[activeOriginNodeId]?.edgeFilters)
      ) {
        // If they are different, it means a filter was just changed.
        // Update the local perNodeSettings to reflect this change.
        setPerNodeSettings((prevSettings) => ({
          ...prevSettings,
          [activeOriginNodeId]: {
            ...prevSettings[activeOriginNodeId],
            edgeFilters: settings.edgeFilters,
          },
        }));
      }
    }
  }, [settings.edgeFilters, isAdvancedMode, activeOriginNodeId, perNodeSettings]);

  // Calculate if settings are stale (only for query-affecting settings).
  const isSettingsStale = useMemo(() => {
    // On the very first run, lastAppliedSettings is null, so nothing is stale.
    if (!lastAppliedSettings) {
      return false;
    }

    // Compare based on mode.
    if (isAdvancedMode) {
      // Compare perNodeSettings against snapshot in Redux.
      return JSON.stringify(perNodeSettings) !== JSON.stringify(lastAppliedPerNodeSettings);
    }
    // Compare only query-affecting settings, excluding display-only ones
    // that take immediate effect (labels, font sizes, focus nodes).
    const filterQuerySettings = (s) => {
      const filtered = {};
      for (const key of Object.keys(s)) {
        if (!DISPLAY_ONLY_SETTINGS.includes(key)) {
          filtered[key] = s[key];
        }
      }
      return filtered;
    };
    return (
      JSON.stringify(filterQuerySettings(settings)) !==
      JSON.stringify(filterQuerySettings(lastAppliedSettings))
    );
  }, [isAdvancedMode, settings, perNodeSettings, lastAppliedSettings, lastAppliedPerNodeSettings]);

  // Memoized handler for updating per-node or global settings.
  const handleSettingChange = useCallback(
    (setting, value) => {
      // If in advanced mode, update the local state for the active node.
      if (isAdvancedMode && activeOriginNodeId) {
        setPerNodeSettings((prevSettings) => ({
          ...prevSettings,
          [activeOriginNodeId]: {
            ...prevSettings[activeOriginNodeId],
            [setting]: value,
          },
        }));
      }
      // Always dispatch to sync the UI.
      dispatch(updateSetting({ setting, value }));
    },
    [dispatch, isAdvancedMode, activeOriginNodeId],
  );

  // Memoized handler for updating global Redux settings.
  const handleGlobalSettingChange = useCallback(
    (setting, value) => {
      dispatch(updateSetting({ setting, value }));
    },
    [dispatch],
  );

  const handleAdvancedModeToggle = useCallback(() => {
    const newMode = !isAdvancedMode;
    setIsAdvancedMode(newMode);

    if (newMode) {
      const initialPerNodeSettings = {};
      for (const nodeId of originNodeIds) {
        initialPerNodeSettings[nodeId] = { ...settings };
      }
      setPerNodeSettings(initialPerNodeSettings);
      setActiveOriginNodeId(originNodeIds[0]);
    } else {
      const firstNodeId = originNodeIds[0];
      if (perNodeSettings[firstNodeId]) {
        const firstNodeSettings = perNodeSettings[firstNodeId];
        // Only restore the per-node settings, leaving global settings intact.
        for (const [settingKey, value] of Object.entries(firstNodeSettings)) {
          if (PER_NODE_SETTINGS.includes(settingKey)) {
            dispatch(updateSetting({ setting: settingKey, value }));
          }
        }
      }
    }
  }, [isAdvancedMode, originNodeIds, settings, perNodeSettings, dispatch]);

  return {
    isAdvancedMode,
    perNodeSettings,
    activeOriginNodeId,
    setActiveOriginNodeId,
    isSettingsStale,
    handleSettingChange,
    handleGlobalSettingChange,
    handleAdvancedModeToggle,
    PER_NODE_SETTINGS,
  };
}

export default usePerNodeSettings;
