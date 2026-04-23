import AddToGraphButton from "components/AddToGraphButton";
import DocumentPopup from "components/DocumentPopup";
import SunburstConstructor from "components/SunburstConstructor";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHierarchyData } from "services";
import { getLabel, LoadingBar, mergeChildren } from "utils";

const PREFETCH_CONCURRENCY = 4;
const PREFETCH_SKIP_PREFIXES = ["CL/", "GS/", "MONDO/", "PR/", "CHEMBL/"];

const Sunburst = ({ addSelectedItem }) => {
  const [graphData, setGraphData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [clickedItem, setClickedItem] = useState(null);
  const [popupVisible, setPopupVisible] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [zoomedNodeId, setZoomedNodeId] = useState(null);

  const svgContainerRef = useRef(null);
  const svgNodeRef = useRef(null);
  const popupRef = useRef(null);
  const currentHierarchyRootRef = useRef(null);
  const isLoadingRef = useRef(isLoading);
  const isInitialMountRef = useRef(true);

  const d3ClickedRef = useRef(null);
  const handleNodeClickRef = useRef(null);
  const handleCenterClickRef = useRef(null);
  const handleSunburstClickRef = useRef(null);

  // Mount-once refs for the d3 update function
  const updateRef = useRef(null);
  const bloomInRef = useRef(null);
  const mountedRef = useRef(false);
  const justMountedRef = useRef(false); // skip update effect on the mount render

  // Drilldown: store overview data so center-click can return to it
  const overviewDataRef = useRef(null);
  const isDrilledDownRef = useRef(false);
  const shouldBloomRef = useRef(false);

  // Prefetch state
  const prefetchInFlightRef = useRef(new Set());
  const prefetchFetchedRef = useRef(new Set());
  const prefetchGenerationRef = useRef(0);

  // Debounce queue: accumulate merges, flush once per rAF
  const mergeQueueRef = useRef([]);
  const rafIdRef = useRef(null);

  const returnTimerRef = useRef(null);

  const graphType = "phenotypes";

  // --- Debounced merge: batches multiple prefetch results into one setState ---
  const flushMergeQueue = useCallback(() => {
    rafIdRef.current = null;
    const queue = mergeQueueRef.current;
    if (queue.length === 0) return;
    mergeQueueRef.current = [];
    setGraphData((prev) => {
      if (!prev) return prev;
      let result = prev;
      for (const { parentId, data } of queue) {
        result = mergeChildren(result, parentId, data);
      }
      return result;
    });
  }, []);

  const scheduleMerge = useCallback(
    (parentId, data) => {
      mergeQueueRef.current.push({ parentId, data });
      if (rafIdRef.current == null) {
        rafIdRef.current = requestAnimationFrame(flushMergeQueue);
      }
    },
    [flushMergeQueue],
  );

  // --- Primary data fetch (shows loading bar) ---
  const fetchSunburstData = useCallback(async (parentId = null, isInitialLoad = false) => {
    if (!isInitialLoad && isLoadingRef.current) return;
    if (returnTimerRef.current != null) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    }
    setIsLoading(true);
    isLoadingRef.current = true;
    try {
      const data = await fetchHierarchyData(parentId, graphType);
      if (parentId) {
        if (!Array.isArray(data)) throw new Error(`API error for parent ${parentId}`);
        prefetchFetchedRef.current.add(parentId);
        setGraphData((prevData) => {
          if (!prevData) return null;
          return mergeChildren(prevData, parentId, data);
        });
      } else {
        if (typeof data !== "object" || data === null || Array.isArray(data))
          throw new Error("API error for initial load/root");
        prefetchGenerationRef.current += 1;
        prefetchInFlightRef.current = new Set();
        prefetchFetchedRef.current = new Set();
        mergeQueueRef.current = [];
        if (rafIdRef.current != null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        overviewDataRef.current = data;
        isDrilledDownRef.current = false;
        setGraphData(data);
        setZoomedNodeId(null);
        currentHierarchyRootRef.current = null;
      }
    } catch (error) {
      console.error("Fetch/Process Error:", error);
      setGraphData(null);
      setZoomedNodeId(null);
      currentHierarchyRootRef.current = null;
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, []);

  // --- Drilldown: zoom → fetch → full SVG rebuild ---
  const drillIntoOrgan = useCallback(async (organNode, d3Node, event) => {
    if (isLoadingRef.current) return;

    prefetchGenerationRef.current += 1;
    mergeQueueRef.current = [];
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (returnTimerRef.current != null) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    }

    const drilldownGeneration = prefetchGenerationRef.current;

    // 1. Zoom + fetch in parallel
    if (d3ClickedRef.current && d3Node) {
      d3ClickedRef.current(event, d3Node);
    }
    setZoomedNodeId(organNode._id);

    isLoadingRef.current = true;
    try {
      const [clList] = await Promise.all([
        fetchHierarchyData(organNode._id, graphType),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);

      if (drilldownGeneration !== prefetchGenerationRef.current) return;
      if (!Array.isArray(clList)) throw new Error(`Drilldown error for ${organNode._id}`);

      const drilldownRoot = {
        _id: organNode._id,
        _key: organNode._key,
        label: organNode.label,
        value: organNode.value,
        subtree_size: organNode.subtree_size,
        _hasChildren: clList.length > 0,
        children: clList,
      };

      // 2. Fade out old SVG
      const oldSvg = svgNodeRef.current;
      if (oldSvg) {
        oldSvg.style.transition = "opacity 200ms ease-out";
        oldSvg.style.opacity = "0";
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (drilldownGeneration !== prefetchGenerationRef.current) return;

      // 3. Full rebuild — clean slate, no stale d3 state
      isDrilledDownRef.current = true;
      mountedRef.current = false;
      setGraphData(drilldownRoot);
      setZoomedNodeId(null);
    } catch (error) {
      console.error("Drilldown error:", error);
    } finally {
      isLoadingRef.current = false;
    }
  }, []);

  // --- Return to overview: full SVG rebuild ---
  const returnToOverview = useCallback(() => {
    if (!overviewDataRef.current) return;

    prefetchGenerationRef.current += 1;
    isLoadingRef.current = false;

    const oldSvg = svgNodeRef.current;
    if (oldSvg) {
      oldSvg.style.transition = "opacity 200ms ease-out";
      oldSvg.style.opacity = "0";
    }

    if (returnTimerRef.current != null) {
      clearTimeout(returnTimerRef.current);
    }
    returnTimerRef.current = setTimeout(() => {
      returnTimerRef.current = null;
      isDrilledDownRef.current = false;
      mountedRef.current = false;
      setGraphData({ ...overviewDataRef.current });
      setZoomedNodeId(null);
    }, 200);
  }, []);

  // --- Background prefetch (silent, no loading bar) ---
  const prefetchNode = useCallback(
    async (parentId, generation) => {
      if (prefetchInFlightRef.current.has(parentId)) return;
      prefetchInFlightRef.current.add(parentId);
      try {
        const data = await fetchHierarchyData(parentId, graphType);
        if (generation !== prefetchGenerationRef.current) return;
        if (!Array.isArray(data)) return;
        prefetchFetchedRef.current.add(parentId);
        scheduleMerge(parentId, data);
      } catch (err) {
        console.debug(`Prefetch failed for ${parentId}:`, err);
      } finally {
        prefetchInFlightRef.current.delete(parentId);
      }
    },
    [scheduleMerge],
  );

  const collectUnfetchedIds = useCallback((node, ids) => {
    if (!node) return;
    const id = node._id;
    if (id && PREFETCH_SKIP_PREFIXES.some((p) => id.startsWith(p))) return;
    if (
      node._hasChildren &&
      !node.children &&
      id &&
      !prefetchFetchedRef.current.has(id) &&
      !prefetchInFlightRef.current.has(id)
    ) {
      ids.push(id);
    }
    if (node.children) {
      for (const child of node.children) collectUnfetchedIds(child, ids);
    }
  }, []);

  // Drive prefetch on graphData changes
  useEffect(() => {
    if (!graphData) return;
    const generation = prefetchGenerationRef.current;
    const ids = [];
    collectUnfetchedIds(graphData, ids);
    const free = PREFETCH_CONCURRENCY - prefetchInFlightRef.current.size;
    for (let i = 0; i < ids.length && i < free; i++) {
      prefetchNode(ids[i], generation);
    }
  }, [graphData, collectUnfetchedIds, prefetchNode]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    return () => {
      if (returnTimerRef.current != null) {
        clearTimeout(returnTimerRef.current);
        returnTimerRef.current = null;
      }
    };
  }, []);

  // Initial data fetch on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - only run on mount
  useEffect(() => {
    if (!graphData && !isLoadingRef.current) fetchSunburstData(null, true);
  }, []);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    setGraphData(null);
    setZoomedNodeId(null);
    currentHierarchyRootRef.current = null;
    setClickedItem(null);
    setPopupVisible(false);
    fetchSunburstData(null, false);
  }, [fetchSunburstData]);

  // --- Needs-load check ---
  const checkNeedsLoad = useCallback((d) => {
    if (!d) return false;
    if (d.data._hasChildren) {
      if (!d.children) return true;
      for (const child of d.children) {
        if (child.data._hasChildren && !child.children) return true;
      }
    }
    return false;
  }, []);

  // --- Click handlers ---
  const latestHandleNodeClick = useCallback(
    (event, d3Node) => {
      if (!d3Node.data._hasChildren) return false;
      const currentIsLoading = isLoadingRef.current;
      if (currentIsLoading) return false;

      // If we're at the overview level and clicking an organ, drilldown
      if (!isDrilledDownRef.current && d3Node.data._id?.startsWith("UBERON/")) {
        drillIntoOrgan(d3Node.data, d3Node, event);
        return true; // Animate the zoom first, swap happens after
      }

      // Normal navigation within the drilled-down chart
      const needsLoad = checkNeedsLoad(d3Node);
      if (d3Node.data._id === zoomedNodeId && !needsLoad) return false;
      if (needsLoad && !currentIsLoading) {
        if (zoomedNodeId !== d3Node.data._id) setZoomedNodeId(d3Node.data._id);
        fetchSunburstData(d3Node.data._id, false);
        return true;
      }
      if (!needsLoad && d3Node.children) {
        if (zoomedNodeId !== d3Node.data._id) setZoomedNodeId(d3Node.data._id);
        return true;
      }
      return false;
    },
    [checkNeedsLoad, fetchSunburstData, zoomedNodeId, drillIntoOrgan],
  );

  const latestHandleCenterClick = useCallback(() => {
    const currentHierarchy = currentHierarchyRootRef.current;
    const currentCenterId = zoomedNodeId;
    const currentIsLoading = isLoadingRef.current;
    if (!currentHierarchy) return;

    // If we're drilled down and at the organ root (no zoom or depth-0 zoom),
    // return to the overview instead of trying to go up further.
    let centeredNode;
    if (currentCenterId) {
      centeredNode = currentHierarchy.find((node) => node.data._id === currentCenterId);
    } else {
      centeredNode = currentHierarchy.find((node) => node.depth === 0);
    }

    if (isDrilledDownRef.current && centeredNode && !centeredNode.parent) {
      returnToOverview();
      return;
    }
    if (!centeredNode) {
      const absoluteRoot = currentHierarchy.find((d) => d.depth === 0);
      if (absoluteRoot) {
        if (zoomedNodeId !== null) setZoomedNodeId(null);
        if (d3ClickedRef.current) d3ClickedRef.current(null, absoluteRoot);
      }
      return;
    }
    const parentNode = centeredNode.parent;
    if (parentNode) {
      const newZoomTargetId = parentNode.depth === 0 ? null : parentNode.data._id;
      if (zoomedNodeId !== newZoomTargetId) setZoomedNodeId(newZoomTargetId);
      if (d3ClickedRef.current) d3ClickedRef.current(null, parentNode);
      const needsLoadForParent = checkNeedsLoad(parentNode);
      if (
        needsLoadForParent &&
        !currentIsLoading &&
        parentNode.data?._id &&
        parentNode.depth !== 0
      ) {
        fetchSunburstData(parentNode.data._id, false);
      }
    } else {
      if (zoomedNodeId !== null) setZoomedNodeId(null);
      if (d3ClickedRef.current && centeredNode) d3ClickedRef.current(null, centeredNode);
    }
  }, [checkNeedsLoad, zoomedNodeId, fetchSunburstData, returnToOverview]);

  const latestHandleSunburstClick = useCallback((e, dataNode) => {
    setClickedItem(dataNode.data);
    setPopupPosition({ x: e.clientX + 10 + window.scrollX, y: e.clientY + 10 + window.scrollY });
    setPopupVisible(true);
  }, []);

  useEffect(() => {
    handleNodeClickRef.current = latestHandleNodeClick;
    handleCenterClickRef.current = latestHandleCenterClick;
    handleSunburstClickRef.current = latestHandleSunburstClick;
  }, [latestHandleNodeClick, latestHandleCenterClick, latestHandleSunburstClick]);

  // --- MOUNT EFFECT: build SVG once ---
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container || !graphData || mountedRef.current) return;

    const sunburstInstance = SunburstConstructor(
      graphData,
      928,
      handleSunburstClickRef,
      handleNodeClickRef,
      handleCenterClickRef,
      zoomedNodeId,
    );

    if (sunburstInstance.svgNode) {
      svgNodeRef.current = sunburstInstance.svgNode;
      container.appendChild(svgNodeRef.current);
      currentHierarchyRootRef.current = sunburstInstance.hierarchyRoot;
      d3ClickedRef.current = sunburstInstance.d3Clicked;
      updateRef.current = sunburstInstance.update;
      bloomInRef.current = sunburstInstance.bloomIn;
      mountedRef.current = true;

      justMountedRef.current = true; // prevent update effect from firing this cycle

      if (bloomInRef.current) {
        bloomInRef.current(400);
      }
    }

    return () => {
      if (svgNodeRef.current && container.contains(svgNodeRef.current)) {
        container.removeChild(svgNodeRef.current);
      }
      svgNodeRef.current = null;
      currentHierarchyRootRef.current = null;
      d3ClickedRef.current = null;
      updateRef.current = null;
      bloomInRef.current = null;
      mountedRef.current = false;
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData]);

  // --- UPDATE EFFECT: patch existing SVG when data changes ---
  useEffect(() => {
    if (justMountedRef.current) {
      justMountedRef.current = false;
      return; // skip — mount effect already handled this render
    }
    if (!mountedRef.current || !updateRef.current || !graphData) return;
    const newRoot = updateRef.current(graphData, zoomedNodeId);
    // Re-expose the current hierarchy root after data-join rebuild.
    // update() now returns the rebuilt root directly so we don't have to
    // fish it out of DOM-bound data (which includes fading-out exit nodes
    // that still carry the OLD hierarchy).
    if (newRoot) {
      currentHierarchyRootRef.current = newRoot;
    }
  }, [graphData]);

  // --- Popup ---
  const handlePopupClose = useCallback(() => {
    setPopupVisible(false);
    setClickedItem(null);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) handlePopupClose();
    };
    if (popupVisible) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popupVisible, handlePopupClose]);

  function _handleSelectItem() {
    if (clickedItem) addSelectedItem(clickedItem);
    handlePopupClose();
  }

  return (
    <div className="sunburst-component-wrapper">
      {/* biome-ignore lint/correctness/useUniqueElementIds: legacy id */}
      <div
        data-testid="sunburst-container"
        id="sunburst-container"
        ref={svgContainerRef}
        className="sunburst-svg-container"
        style={{
          position: "relative",
          minHeight: "600px",
          width: "100%",
          maxWidth: "928px",
          margin: "0 auto",
        }}
      >
        {isLoading && <LoadingBar />}
      </div>

      {popupVisible && clickedItem && (
        <DocumentPopup isVisible={popupVisible} position={popupPosition} onClose={handlePopupClose}>
          {clickedItem && (
            <>
              <p
                style={{
                  margin: "0 0 5px 0",
                  fontWeight: "bold",
                  borderBottom: "1px solid #ccc",
                  paddingBottom: "3px",
                }}
              >
                {getLabel(clickedItem)}
              </p>
              <a
                className="document-popup-button"
                href={`/#/collections/${clickedItem._id}`}
                rel="noopener noreferrer"
              >
                Go To Page
              </a>
              <AddToGraphButton nodeId={clickedItem._id} text="Add to Graph" />
            </>
          )}
        </DocumentPopup>
      )}
    </div>
  );
};

export default Sunburst;
