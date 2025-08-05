import React, { useEffect, useState, useRef, useContext, memo } from "react";
import * as d3 from "d3";
import ForceGraphConstructor from "../ForceGraphConstructor/ForceGraphConstructor";
import collMaps from "../../assets/cell-kn-mvp-collection-maps.json";
import {
  LoadingBar,
  fetchCollections,
  getLabel,
  hasAnyNodes,
  parseCollections,
} from "../Utils/Utils";
import { GraphContext } from "../../contexts/GraphContext";

const ForceGraph = ({
  nodeIds: originNodeIds,
  heightRatio = 0.5,
  settings = {},
}) => {
  // Init refs
  const chartContainerRef = useRef();

  // Init setting states
  const [depth, setDepth] = useState(settings["defaultDepth"] ?? 2);
  const [edgeDirection, setEdgeDirection] = useState(
    settings["edgeDirection"] ?? "ANY",
  );
  const [setOperation, setSetOperation] = useState(
    settings["setOperation"] ?? "Union",
  );
  const [allowedCollections, setAllowedCollections] = useState([]);
  const [nodeFontSize, setNodeFontSize] = useState(
    settings["nodeFontSize"] ?? 12,
  );
  const [edgeFontSize, setEdgeFontSize] = useState(
    settings["edgeFontSize"] ?? 8,
  );
  const [nodeLimit, setNodeLimit] = useState(settings["nodeLimit"] ?? 5000);
  const [labelStates, setLabelStates] = useState(
    settings["labelStates"] ?? {
      "collection-label": false,
      "link-source": false,
      "link-label": true,
      "node-label": true,
    },
  );
  const [findShortestPaths, setFindShortestPaths] = useState(
    settings["findShortestPaths"] ?? false,
  );
  const [useFocusNodes] = useState(settings["useFocusNodes"] ?? true);

  // Init other states
  const [graphNodeIds, setGraphNodeIds] = useState(originNodeIds);
  const [rawData, setRawData] = useState({});
  const [graphData, setGraphData] = useState({});
  const [collections, setCollections] = useState([]);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [clickedNodeId, setClickedNodeId] = useState(null);
  const [clickedNodeLabel, setClickedNodeLabel] = useState(null);
  const [popupVisible, setPopupVisible] = useState(false);
  const [popupIsEdge, setPopupIsEdge] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [graph, setGraph] = useState(null);
  const collectionMaps = new Map(collMaps.data);
  const [showNoDataPopup, setShowNoDataPopup] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [collapseOnStart, setCollapseOnStart] = useState(true);
  const [activeTab, setActiveTab] = useState("general");

  const { graphType, setGraphType } = useContext(GraphContext);

  useEffect(() => {
    fetchCollections(graphType).then((data) => {
      let tempCollections = parseCollections(data);
      setCollections(tempCollections);
      // Determine allowedCollections based on incoming settings:
      if (settings["allowedCollections"]) {
        // Use the explicitly provided allowed collections
        setAllowedCollections(settings["allowedCollections"]);
      } else if (settings["collectionsToPrune"]) {
        // If a prune list is provided, set allowedCollections to the complement
        const pruneList = settings["collectionsToPrune"];
        const allowed = tempCollections.filter(
          (collection) => !pruneList.includes(collection),
        );
        setAllowedCollections(allowed);
      } else {
        // By default, allow all collections
        setAllowedCollections(tempCollections);
      }
    });
  }, [graphType, settings]);

  // Set event listeners for popup close
  useEffect(() => {
    document.addEventListener("click", handlePopupClose);
    return () => {
      document.removeEventListener("click", handlePopupClose);
    };
  }, []);

  // Reset expanding and pruning when creating a new graph
  useEffect(() => {
    setGraphNodeIds(originNodeIds);
  }, [originNodeIds]);

  // Fetch new graph data on change
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    // Debounce or delay slightly to avoid rapid fetches if multiple states change
    const timerId = setTimeout(() => {
      getGraphData(
        graphNodeIds,
        findShortestPaths,
        depth,
        edgeDirection,
        allowedCollections,
        nodeLimit,
      )
        .then((data) => {
          if (isMounted) {
            if (originNodeIds.some((nodeId) => hasAnyNodes(data, nodeId))) {
              setRawData(data);
            } else {
              setGraphType("ontologies");
            }
          }
        })
        .catch((error) => {
          console.error("Failed to fetch graph data:", error);
          if (isMounted) {
            setRawData({}); // Clear data on error
            setShowNoDataPopup(true); // Show error/no data message
            setIsLoading(false);
          }
        });
    }, 100); // Small delay

    return () => {
      isMounted = false;
      clearTimeout(timerId); // Clear timeout on unmount or dependency change
    };
  }, [
    originNodeIds,
    graphNodeIds,
    depth,
    edgeDirection,
    allowedCollections,
    findShortestPaths,
    nodeLimit,
    graphType,
    setGraphType,
    collapseOnStart,
  ]);

  useEffect(() => {
    if (Object.keys(rawData).length !== 0) {
      const processedData = performSetOperation(rawData, setOperation);

      if (
        !processedData ||
        ((processedData.nodes == null || processedData.nodes.length === 0) &&
          (processedData.links == null || processedData.links.length === 0))
      ) {
        setGraphData(processedData); // Set potentially empty data
        setShowNoDataPopup(true);
      } else {
        setGraphData(processedData);
        setShowNoDataPopup(false);
      }
    } else if (!isLoading) {
      // Handle case where rawData is empty
      setGraphData({});
      setShowNoDataPopup(true);
    }
  }, [rawData, setOperation]);

  useEffect(() => {
    const updateGraph = async () => {
      // Only update if data is present and not showing the 'no data' popup
      if (
        !showNoDataPopup &&
        graphData &&
        graphData.nodes &&
        graphData.nodes.length > 0
      ) {
        // Ensure graph is cleared if new data results in no nodes/links
        const g = await new Promise((resolve) => {
          // Use requestAnimationFrame for smoother rendering updates
          requestAnimationFrame(() => {
            const graphInstance = ForceGraphConstructor(graphData, {
              nodeGroup: (d) => d._id.split("/")[0],
              nodeGroups: collections,
              collectionsMap: collectionMaps,
              originNodeIds: useFocusNodes ? originNodeIds : [],
              nodeFontSize: nodeFontSize,
              linkFontSize: edgeFontSize,
              nodeHover: (d) => (d.label ? `${d._id}\n${d.label}` : `${d._id}`),
              label: getLabel,
              onNodeClick: handleNodeClick,
              interactionCallback: handlePopupClose,
              nodeStrength: -100,
              width: chartContainerRef.current?.clientWidth || "2560",
              height: chartContainerRef.current?.clientHeight,
              labelStates: labelStates,
            });
            resolve(graphInstance);
          });
        });

        setGraph(g);
        setIsLoading(false); // Stop loading indicator after graph instance is created
      } else {
        // Clear graph and stop loading if no data or error
        setGraph(null);
        // Ensure loading is false
        if (isLoading) setIsLoading(false);
      }
    };
    updateGraph();
  }, [graphData]);

  // Effect for collapsing nodes after graph is ready and if collapseOnStart is true
  useEffect(() => {
    if (
      collapseOnStart &&
      graph &&
      typeof graph.updateGraph === "function" &&
      graphData &&
      graphData.nodes &&
      graphData.nodes.length > 0
    ) {
      const nodeIds = graphData.nodes
        // Ensure node and _id exist and avoid collapsing origin node on single origin graphs for depth 1
        .filter(
          (node) =>
            node &&
            typeof node._id !== "undefined" &&
            ((originNodeIds.length == 1 && !originNodeIds.includes(node._id)) ||
              depth !== 1 ||
              originNodeIds.length > 1),
        )
        .map((node) => node._id);

      const nodesToCollapse = new Set(nodeIds);

      if (nodesToCollapse.size > 0) {
        graph.updateGraph({
          collapseNodes: [...nodesToCollapse], // Convert set to array to pass into updateGraph
        });
      }
      setIsLoading(false); // Stop loading after graph is initialized and (potentially) collapsed
    }
  }, [graph]);

  useEffect(() => {
    const containerEl = chartContainerRef.current;
    if (!containerEl) {
      return;
    }

    const chartContainer = d3.select(containerEl);
    chartContainer.selectAll("*").remove();

    if (!graph) {
      return;
    }

    chartContainer.append(() => graph);

    if (typeof graph.resize === "function") {
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const { width, height } = entry.contentRect;
          graph.resize(width, height);
        }
      });

      resizeObserver.observe(containerEl);

      // Perform an initial resize
      graph.resize(containerEl.clientWidth, containerEl.clientHeight);

      return () => {
        resizeObserver.disconnect();
      };
    }
  }, [graph]);

  useEffect(() => {
    if (graph !== null && typeof graph.toggleLabels === "function") {
      for (let labelClass in labelStates) {
        graph.toggleLabels(labelStates[labelClass], labelClass);
      }
    }
  }, [labelStates]);

  let getGraphData = async (
    nodeIds,
    shortestPaths,
    depth,
    edgeDirection,
    allowedCollections,
    nodeLimit,
  ) => {
    if (shortestPaths && nodeIds.length > 1) {
      let response = await fetch("/arango_api/shortest_paths/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          node_ids: nodeIds,
          edge_direction: edgeDirection,
        }),
      });

      if (!response.ok) {
        console.error(
          "Shortest path fetch failed:",
          response.status,
          await response.text(),
        );
        throw new Error(`Network response was not ok (${response.status})`);
      }
      return response.json();
    } else {
      // Regular graph traversal
      let response = await fetch("/arango_api/graph/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          node_ids: nodeIds,
          depth: depth,
          edge_direction: edgeDirection,
          allowed_collections: allowedCollections,
          node_limit: nodeLimit,
          graph: graphType,
        }),
      });

      if (!response.ok) {
        console.error(
          "Graph fetch failed:",
          response.status,
          await response.text(),
        );
        throw new Error(`Network response was not ok (${response.status})`);
      }
      return response.json();
    }
  };

  function performSetOperation(data, operation) {
    if (!data || !data.nodes) {
      console.warn("performSetOperation called with invalid data:", data);
      return { nodes: [], links: [] };
    }

    const nodes = data.nodes;
    const links = data.links || [];

    const getAllNodeIdsFromOrigins = (operation) => {
      // Ensure nodes is an object before trying Object.values
      if (typeof nodes !== "object" || nodes === null) return new Set();

      const nodeIdsPerOrigin = Object.values(nodes).map((originGroup) => {
        // Ensure originGroup is an array and items have node._id
        if (!Array.isArray(originGroup)) return new Set();
        return new Set(
          originGroup
            .filter((item) => item && item.node && item.node._id)
            .map((item) => item.node._id),
        );
      });

      if (nodeIdsPerOrigin.length === 0) return new Set(); // Handle empty results

      if (operation === "Intersection") {
        if (nodeIdsPerOrigin.length < 2) return new Set(); // Intersection requires at least 2 sets

        let intersectionResult = new Set(nodeIdsPerOrigin[0]);
        for (let i = 1; i < nodeIdsPerOrigin.length; i++) {
          intersectionResult = new Set(
            [...intersectionResult].filter((id) => nodeIdsPerOrigin[i].has(id)),
          );
        }
        return intersectionResult;
      } else if (operation === "Union") {
        return new Set(
          nodeIdsPerOrigin.flatMap((nodeIdsSet) => [...nodeIdsSet]),
        );
      } else if (operation === "Symmetric Difference") {
        // SD requires at least 2 sets, return first if only one
        if (nodeIdsPerOrigin.length < 2)
          return new Set(nodeIdsPerOrigin[0] || []);

        let result = new Set(nodeIdsPerOrigin[0]);
        for (let i = 1; i < nodeIdsPerOrigin.length; i++) {
          const currentSet = nodeIdsPerOrigin[i];
          const nextResult = new Set();
          // Elements in result but not in currentSet
          result.forEach((id) => {
            if (!currentSet.has(id)) nextResult.add(id);
          });
          // Elements in currentSet but not in result
          currentSet.forEach((id) => {
            if (!result.has(id)) nextResult.add(id);
          });
          result = nextResult;
        }
        return result;
      }

      console.error("Unknown set operation:", operation);
      return new Set(); // Default fallback
    };

    const addNodesFromPathsToSet = (nodeIdsSet) => {
      if (typeof nodes !== "object" || nodes === null) return; // Guard

      Object.values(nodes).forEach((originGroup) => {
        if (!Array.isArray(originGroup)) return; // Guard

        originGroup.forEach((item) => {
          // Check item structure carefully
          if (
            item &&
            item.node &&
            item.node._id &&
            item.path &&
            Array.isArray(item.path.vertices)
          ) {
            if (nodeIdsSet.has(item.node._id)) {
              item.path.vertices.forEach((vertex) => {
                if (vertex && vertex._id) {
                  // Ensure vertex is valid
                  nodeIdsSet.add(vertex._id);
                }
              });
            }
          }
        });
      });
    };

    let nodeIds = getAllNodeIdsFromOrigins(operation);

    // Only add path nodes if not doing shortest paths
    if (!findShortestPaths) {
      addNodesFromPathsToSet(nodeIds);
    }

    const seenLinks = new Set();
    const filteredLinks = links.filter((link) => {
      // Ensure link structure is valid
      if (!link || !link._from || !link._to) return false;

      if (nodeIds.has(link._from) && nodeIds.has(link._to)) {
        const linkKey = `${link._from}-${link._to}`;

        if (seenLinks.has(linkKey)) {
          return false;
        } else {
          seenLinks.add(linkKey);
          return true;
        }
      }
      return false;
    });

    const finalNodes = new Set();
    const addedNodeIds = new Set(); // Track added nodes to avoid duplicates

    // Add nodes that are part of the filtered links
    filteredLinks.forEach((link) => {
      if (link._from) finalNodes.add(link._from);
      if (link._to) finalNodes.add(link._to);
    });

    // Find the actual node objects corresponding to the IDs in finalNodes
    const filteredNodes = [];
    if (typeof nodes === "object" && nodes !== null) {
      Object.values(nodes).forEach((originGroup) => {
        if (Array.isArray(originGroup)) {
          originGroup.forEach((item) => {
            if (
              item &&
              item.node &&
              item.node._id &&
              finalNodes.has(item.node._id) &&
              !addedNodeIds.has(item.node._id)
            ) {
              filteredNodes.push(item.node);
              addedNodeIds.add(item.node._id);
            }
          });
        }
      });
    }

    // Ensure origin nodes are included if they weren't part of any links
    if (Array.isArray(originNodeIds)) {
      originNodeIds.forEach((originId) => {
        if (!addedNodeIds.has(originId)) {
          // Find the origin node object in the original data
          let foundNode = null;
          if (typeof nodes === "object" && nodes !== null) {
            Object.values(nodes).find((originGroup) => {
              if (Array.isArray(originGroup)) {
                const nodeItem = originGroup.find(
                  (item) => item && item.node && item.node._id === originId,
                );
                if (nodeItem) {
                  foundNode = nodeItem.node;
                  return true;
                }
              }
              return false;
            });
          }
          if (foundNode) {
            filteredNodes.push(foundNode);
            addedNodeIds.add(originId);
          }
        }
      });
    }

    return {
      nodes: filteredNodes,
      links: filteredLinks,
    };
  }

  const handleNodeClick = (e, nodeData) => {
    setClickedNodeId(nodeData._id);
    setClickedNodeLabel(getLabel(nodeData));
    let collection = nodeData._id.split("/")[0];

    if (chartContainerRef.current) {
      const chartRect = chartContainerRef.current.getBoundingClientRect();
      const xRelativeToChart = e.clientX - chartRect.left;
      const yRelativeToChart = e.clientY - chartRect.top;

      setPopupPosition({
        x: xRelativeToChart + 30,
        y: yRelativeToChart + 30,
      });
      // Edge collection
      if (collection.includes("-")) {
        setPopupIsEdge(true);
      } else {
        setPopupIsEdge(false);
      }
      setPopupVisible(true);
    } else {
      console.error("Chart container ref not found for popup positioning.");
      setPopupPosition({
        x: e.clientX + 10 + window.scrollX,
        y: e.clientY + 10 + window.scrollY,
      });
      // Edge collection
      if (collection.includes("-")) {
        setPopupIsEdge(true);
      } else {
        setPopupIsEdge(false);
      }
      setPopupVisible(true);
    }
  };

  const handleLeafToggle = () => {
    setCollapseOnStart(!collapseOnStart);
  };

  const handleGraphToggle = () => {
    const newGraphValue =
      graphType === "phenotypes" ? "ontologies" : "phenotypes";
    setGraphType(newGraphValue);
  };

  const handlePopupClose = () => {
    setPopupVisible(false);
  };

  const handleExpand = () => {
    if (!clickedNodeId) return;
    // Use the current settings for the expansion fetch
    getGraphData(
      [clickedNodeId],
      false,
      1,
      "ANY",
      allowedCollections,
      nodeLimit,
    )
      .then((data) => {
        if (graph && data && data.nodes && data.nodes[clickedNodeId]) {
          graph.updateGraph({
            newNodes: data.nodes[clickedNodeId].map((d) => d.node),
            newLinks: data.links || [],
            centerNodeId: clickedNodeId,
          });
        } else {
          console.warn(
            "Expansion data not found or graph not ready for:",
            clickedNodeId,
          );
        }
      })
      .catch((error) => console.error("Expansion failed:", error));
    handlePopupClose(); // Close popup after action
  };

  const handleCollapse = () => {
    if (graph && clickedNodeId) {
      graph.updateGraph({
        collapseNodes: [clickedNodeId], // Pass node ID to collapse around
      });
    }
    handlePopupClose();
  };

  const handleRemove = () => {
    if (graph && clickedNodeId) {
      graph.updateGraph({
        collapseNodes: [clickedNodeId], // Collapse first
        removeNode: true, // Then mark for removal
      });
    }
    handlePopupClose(); // Close popup after action
  };

  const handleDepthChange = (event) => {
    setDepth(Number(event.target.value));
  };

  const handleNodeLimitChange = (event) => {
    setNodeLimit(Number(event.target.value));
  };

  const handleEdgeDirectionChange = (event) => {
    setEdgeDirection(event.target.value);
  };

  const handleOperationChange = (event) => {
    setSetOperation(event.target.value);
  };

  const handleNodeFontSizeChange = (event) => {
    const newFontSize = parseInt(event.target.value, 10);
    setNodeFontSize(newFontSize);
    if (graph?.updateNodeFontSize) {
      graph.updateNodeFontSize(newFontSize);
    }
  };

  const handleEdgeFontSizeChange = (event) => {
    const newFontSize = parseInt(event.target.value, 10);
    setEdgeFontSize(newFontSize);
    if (graph?.updateLinkFontSize) {
      graph.updateLinkFontSize(newFontSize);
    }
  };

  // Updated handler for toggling allowedCollections
  const handleCollectionChange = (collectionName) => {
    setAllowedCollections((prev) =>
      prev.includes(collectionName)
        ? prev.filter((name) => name !== collectionName)
        : [...prev, collectionName],
    );
  };

  const handleAllOn = () => {
    setAllowedCollections(collections.map((c) => c));
  };

  const handleAllOff = () => {
    setAllowedCollections([]);
  };

  const handleLabelToggle = (labelClass) => {
    setLabelStates((prevStates) => ({
      ...prevStates,
      [labelClass]: !prevStates[labelClass],
    }));
    // The actual toggling happens in the useEffect watching labelStates
  };

  const handleShortestPathToggle = () => {
    setFindShortestPaths(!findShortestPaths);
  };

  const handleSimulationRestart = () => {
    if (graph?.updateGraph) {
      graph.updateGraph({
        simulate: true,
      });
    }
  };

  const exportGraph = (format) => {
    if (!chartContainerRef.current) return;
    const svgElement = chartContainerRef.current.querySelector("svg");
    if (!svgElement) {
      console.error("SVG element not found for export.");
      return;
    }

    svgElement.style.backgroundColor = "white"; // Ensure white background

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], {
      type: "image/svg+xml;charset=utf-8",
    }); // Specify charset

    // Reset styles
    svgElement.style.backgroundColor = "";

    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      // Consider dynamic scaling based on SVG size or user input
      let scaleFactor = 4; // Increased scale factor for better resolution

      // Use viewBox for sizing if available, otherwise use width/height attributes
      const viewBox = svgElement.viewBox.baseVal;
      const svgWidth =
        viewBox && viewBox.width
          ? viewBox.width
          : svgElement.width.baseVal.value;
      const svgHeight =
        viewBox && viewBox.height
          ? viewBox.height
          : svgElement.height.baseVal.value;

      canvas.width = svgWidth * scaleFactor;
      canvas.height = svgHeight * scaleFactor;

      // Draw white background on canvas
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.scale(scaleFactor, scaleFactor); // Scale context
      ctx.drawImage(img, 0, 0, svgWidth, svgHeight); // Draw image at original size

      let downloadUrl;
      let filename;

      if (format === "png") {
        downloadUrl = canvas.toDataURL("image/png");
        filename = "graph.png";
      } else if (format === "jpeg") {
        downloadUrl = canvas.toDataURL("image/jpeg", 0.9); // Quality setting for JPEG
        filename = "graph.jpeg";
      } else if (format === "svg") {
        // For SVG, just use the blob URL directly
        downloadUrl = url;
        filename = "graph.svg";
      } else {
        console.error("Unsupported export format:", format);
        URL.revokeObjectURL(url); // Clean up blob URL
        return;
      }

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link); // Append link to body for Firefox compatibility
      link.click();
      document.body.removeChild(link); // Clean up link

      // Revoke object URLs after download is initiated
      if (format !== "svg") {
        // SVG uses the url directly for download href
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = (e) => {
      console.error("Error loading SVG blob into image:", e);
      URL.revokeObjectURL(url); // Clean up blob URL on error
    };
    img.src = url; // Load the SVG blob URL into the Image object
  };

  const toggleOptionsVisibility = () => {
    setOptionsVisible(!optionsVisible);
  };

  return (
    <div
      className={`graph-component-wrapper ${optionsVisible ? "options-open" : "options-closed"}`}
    >
      <div className="graph-main-area">
        <button
          onClick={toggleOptionsVisibility}
          className="toggle-options-button"
          aria-expanded={optionsVisible}
          aria-controls="graph-options-panel"
        >
          {optionsVisible ? "> Hide Options" : "< Show Options"}{" "}
        </button>

        {isLoading && <LoadingBar />}
        <div
          id="chart-container"
          ref={chartContainerRef}
          style={{
            minHeight: "500px",
            position: "relative",
            flexGrow: 1,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {!isLoading && !graph && showNoDataPopup && (
            <div className="no-data-message">
              No data meets the current criteria. Please adjust options or
              search terms.
            </div>
          )}
          {!isLoading &&
            !graph &&
            !showNoDataPopup &&
            !originNodeIds?.length && (
              <div className="no-data-message">
                Please search for nodes to visualize a graph.
              </div>
            )}
        </div>
        <div
          className="node-popup"
          style={
            popupVisible
              ? {
                  display: "flex",
                  position: "absolute",
                  left: `${popupPosition.x}px`,
                  top: `${popupPosition.y}px`,
                }
              : { display: "none" }
          }
        >
          <a
            className="popup-button"
            href={`/#/collections/${clickedNodeId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Go To "{clickedNodeLabel}"
          </a>
          <button
            className="popup-button"
            onClick={handleExpand}
            style={
              !popupIsEdge
                ? {
                    display: "block",
                  }
                : { display: "none" }
            }
          >
            Expand from "{clickedNodeLabel}"
          </button>
          <button
            className="popup-button"
            onClick={handleCollapse}
            style={
              !popupIsEdge
                ? {
                    display: "block",
                  }
                : { display: "none" }
            }
          >
            Collapse Leaf Nodes
          </button>
          <button
            className="popup-button"
            onClick={handleRemove}
            style={
              !popupIsEdge
                ? {
                    display: "block",
                  }
                : { display: "none" }
            }
          >
            Remove {clickedNodeLabel} & Leaf nodes
          </button>
          <button
            className="popup-close-button"
            onClick={handlePopupClose}
            aria-label="Close popup"
          >
            ×
          </button>
        </div>
      </div>{" "}
      <div
        id="graph-options-panel"
        className="graph-options-side-panel"
        data-testid="graph-options"
        style={{ display: optionsVisible ? "block" : "none" }}
      >
        <div className="options-tabs-nav">
          <button
            className={`tab-button ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
            aria-controls="tab-panel-general"
            aria-selected={activeTab === "general"}
            role="tab"
          >
            General
          </button>
          {graphNodeIds && graphNodeIds.length >= 2 && (
            <button
              className={`tab-button ${activeTab === "multiNode" ? "active" : ""}`}
              onClick={() => setActiveTab("multiNode")}
              aria-controls="tab-panel-multiNode"
              aria-selected={activeTab === "multiNode"}
              role="tab"
            >
              Multi-Node
            </button>
          )}
          <button
            className={`tab-button ${activeTab === "collections" ? "active" : ""}`}
            onClick={() => setActiveTab("collections")}
            aria-controls="tab-panel-collections"
            aria-selected={activeTab === "collections"}
            role="tab"
          >
            Collections
          </button>
          <button
            className={`tab-button ${activeTab === "export" ? "active" : ""}`}
            onClick={() => setActiveTab("export")}
            aria-controls="tab-panel-export"
            aria-selected={activeTab === "export"}
            role="tab"
          >
            Export
          </button>
        </div>

        <div className="options-tabs-content">
          {activeTab === "general" && (
            <div
              id="tab-panel-general"
              role="tabpanel"
              className="tab-panel active"
            >
              <div className="option-group">
                <label htmlFor="depth-select">Depth:</label>
                <select
                  id="depth-select"
                  value={depth}
                  onChange={handleDepthChange}
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <label htmlFor="edge-direction">Edge Direction:</label>
                <select
                    id="edge-direction"
                    value={edgeDirection}
                    onChange={handleEdgeDirectionChange}
                >
                  {["ANY", "INBOUND", "OUTBOUND"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                  ))}
                </select>
              </div>
              <div className="option-group font-size-picker">
                <div className="node-font-size-picker">
                  <label htmlFor="node-font-size-select">Node font size:</label>
                  <select
                    id="node-font-size-select"
                    value={nodeFontSize}
                    onChange={handleNodeFontSizeChange}
                  >
                    {[
                      4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32,
                    ].map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </div>
                <div className="edge-font-size-picker">
                  <label htmlFor="edge-font-size-select">Edge font size:</label>
                  <select
                    id="edge-font-size-select"
                    value={edgeFontSize}
                    onChange={handleEdgeFontSizeChange}
                  >
                    {[2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28].map(
                      (size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>
              <div className="option-group labels-toggle-container">
                <label>Toggle Labels:</label>
                <div className="labels-toggle">
                  <div className="label-toggle-item">
                    Collection
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={labelStates["collection-label"]}
                        onChange={() => handleLabelToggle("collection-label")}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                  <div className="label-toggle-item">
                    Edge
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={labelStates["link-label"]}
                        onChange={() => handleLabelToggle("link-label")}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                  <div className="label-toggle-item">
                    Source
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={labelStates["link-source"]}
                        onChange={() => handleLabelToggle("link-source")}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                  <div className="label-toggle-item">
                    Node
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={labelStates["node-label"]}
                        onChange={() => handleLabelToggle("node-label")}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="option-group labels-toggle-container">
                {" "}
                <label>Collapse Leaf Nodes:</label>
                <div className="labels-toggle graph-source-toggle">
                  {" "}
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={collapseOnStart}
                      onChange={handleLeafToggle}
                      aria-label="Toggle whether to show leaf nodes by default"
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>

              <div className="option-group labels-toggle-container">
                {" "}
                <label>Graph Source:</label>
                <div className="labels-toggle graph-source-toggle">
                  {" "}
                  Evidence
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={graphType === "ontologies"}
                      onChange={handleGraphToggle}
                      aria-label="Toggle between Phenotypes and Ontologies"
                    />
                    <span className="slider round"></span>
                  </label>
                  Knowledge
                </div>
              </div>
              <div className="option-group checkbox-container">
                <button
                  className="simulation-toggle background-color-bg"
                  onClick={handleSimulationRestart}
                >
                  Restart Simulation
                </button>
              </div>
            </div>
          )}
          {activeTab === "multiNode" &&
            graphNodeIds &&
            graphNodeIds.length >= 2 && (
              <div
                id="tab-panel-multiNode"
                role="tabpanel"
                className="tab-panel active"
              >
                <div className="option-group multi-node">
                  <label htmlFor="set-operation-select">Graph operation:</label>
                  <select
                    id="set-operation-select"
                    value={setOperation}
                    onChange={handleOperationChange}
                  >
                    {["Intersection", "Union", "Symmetric Difference"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div className="option-group multi-node">
                  Shortest Path
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={findShortestPaths}
                      onChange={handleShortestPathToggle}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>
              </div>
            )}
          {activeTab === "collections" && (
            <div
              id="tab-panel-collections"
              role="tabpanel"
              className="tab-panel active"
            >
              <div className="option-group collection-picker">
                <label>Active Collections:</label>
                <div className="checkboxes-container">
                  {collections.map((collection) => (
                    <div key={collection} className="checkbox-container">
                      <button
                        id={collection}
                        onClick={() => handleCollectionChange(collection)}
                        className={
                          allowedCollections.includes(collection)
                            ? "collection-button-selected"
                            : "collection-button-deselected"
                        }
                      >
                        {collectionMaps.has(collection)
                          ? collectionMaps.get(collection)["display_name"]
                          : collection}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="checkboxes-container collection-controls">
                  <button
                    onClick={handleAllOn}
                    className={
                      allowedCollections.length === collections.length
                        ? "collection-button-selected collection-button-all"
                        : "collection-button-deselected collection-button-all"
                    }
                    disabled={allowedCollections.length === collections.length}
                  >
                    All On
                  </button>
                  <button
                    onClick={handleAllOff}
                    className={
                      allowedCollections.length === 0
                        ? "collection-button-selected collection-button-all"
                        : "collection-button-deselected collection-button-all"
                    }
                    disabled={allowedCollections.length === 0}
                  >
                    All Off
                  </button>
                </div>
              </div>
            </div>
          )}
          {activeTab === "export" && (
            <div
              id="tab-panel-export"
              role="tabpanel"
              className="tab-panel active"
            >
              <div className="option-group export-buttons">
                <label>Export Graph:</label>
                <button onClick={() => exportGraph("svg")}>
                  Download as SVG
                </button>
                <button onClick={() => exportGraph("png")}>
                  Download as PNG
                </button>
              </div>
            </div>
          )}
        </div>
      </div>{" "}
    </div>
  );
};

export default memo(ForceGraph);
