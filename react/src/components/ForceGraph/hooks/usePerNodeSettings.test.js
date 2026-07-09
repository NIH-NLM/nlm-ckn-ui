import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "react-redux";
import graphReducer from "../../../store/graphSlice";
import { usePerNodeSettings } from "./usePerNodeSettings";

const makeWrapper = (store) => {
  const Wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
  return Wrapper;
};

const baseSettings = () => ({
  depth: 1,
  edgeDirection: "ANY",
  allowedCollections: ["CL"],
  nodeFontSize: 12,
  edgeFontSize: 10,
  labelStates: {},
  collapseOnStart: false,
  edgeFilters: { Label: [] },
  edgeFilterModes: { Label: "include" },
});

describe("usePerNodeSettings edge filter modes", () => {
  it("flags settings stale when an edge filter mode changes in advanced mode", () => {
    const store = configureStore({ reducer: { graph: graphReducer } });
    const wrapper = makeWrapper(store);
    const originNodeIds = ["A", "B"];

    let settings = baseSettings();
    let lastAppliedSettings = null;
    let lastAppliedPerNodeSettings = null;

    const { result, rerender } = renderHook(
      (props) =>
        usePerNodeSettings(
          props.settings,
          originNodeIds,
          props.lastAppliedSettings,
          props.lastAppliedPerNodeSettings,
        ),
      {
        wrapper,
        initialProps: { settings, lastAppliedSettings, lastAppliedPerNodeSettings },
      },
    );

    // Enter advanced mode: initializes perNodeSettings for each node from settings.
    act(() => {
      result.current.handleAdvancedModeToggle();
    });

    // Snapshot the current per-node settings as the "applied" baseline.
    const applied = JSON.parse(JSON.stringify(result.current.perNodeSettings));
    lastAppliedSettings = JSON.parse(JSON.stringify(settings));
    lastAppliedPerNodeSettings = applied;

    rerender({ settings, lastAppliedSettings, lastAppliedPerNodeSettings });
    // Nothing changed since apply -> not stale.
    expect(result.current.isSettingsStale).toBe(false);

    // Change the global edge filter mode for the active node's field. The sync
    // effect should mirror this into the active node's per-node settings,
    // which makes perNodeSettings diverge from the applied snapshot.
    settings = { ...settings, edgeFilterModes: { Label: "exclude" } };
    rerender({ settings, lastAppliedSettings, lastAppliedPerNodeSettings });

    expect(result.current.isSettingsStale).toBe(true);
  });

  it("preserves each node's edge filter modes across active-node switches", () => {
    const store = configureStore({ reducer: { graph: graphReducer } });
    const wrapper = makeWrapper(store);
    const originNodeIds = ["A", "B"];

    let settings = baseSettings(); // edgeFilterModes: { Label: "include" }

    const { result, rerender } = renderHook(
      (props) =>
        usePerNodeSettings(
          props.settings,
          originNodeIds,
          props.lastAppliedSettings,
          props.lastAppliedPerNodeSettings,
        ),
      {
        wrapper,
        initialProps: {
          settings,
          lastAppliedSettings: null,
          lastAppliedPerNodeSettings: null,
        },
      },
    );

    // Enter advanced mode: active node = A, both nodes start at include.
    act(() => {
      result.current.handleAdvancedModeToggle();
    });

    // Toggle node A's Label mode to exclude by mirroring a global change while
    // A is active (this is how a real user toggle propagates through Redux).
    settings = { ...settings, edgeFilterModes: { Label: "exclude" } };
    rerender({
      settings,
      lastAppliedSettings: null,
      lastAppliedPerNodeSettings: null,
    });
    expect(result.current.perNodeSettings.A.edgeFilterModes).toEqual({
      Label: "exclude",
    });
    expect(result.current.perNodeSettings.B.edgeFilterModes).toEqual({
      Label: "include",
    });

    // Switch active node A -> B while global still holds A's (stale) exclude
    // value. Node B must keep its own include mode, not inherit A's.
    act(() => {
      result.current.setActiveOriginNodeId("B");
    });
    expect(result.current.perNodeSettings.B.edgeFilterModes).toEqual({
      Label: "include",
    });
    expect(result.current.perNodeSettings.A.edgeFilterModes).toEqual({
      Label: "exclude",
    });

    // Switch back B -> A; A must still hold its exclude mode.
    act(() => {
      result.current.setActiveOriginNodeId("A");
    });
    expect(result.current.perNodeSettings.A.edgeFilterModes).toEqual({
      Label: "exclude",
    });
    expect(result.current.perNodeSettings.B.edgeFilterModes).toEqual({
      Label: "include",
    });
  });
});
