import * as d3 from "d3";
import { faArrowUpRightFromSquare, faCircleQuestion, faFloppyDisk } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  DEFAULT_COLLAPSE_ON_START,
  DEFAULT_DEPTH,
  DEFAULT_EDGE_DIRECTION,
  DEFAULT_EDGE_FONT_SIZE,
  DEFAULT_FIND_SHORTEST_PATHS,
  DEFAULT_GRAPH_TYPE,
  DEFAULT_INCLUDE_INTER_NODE_EDGES,
  DEFAULT_LABEL_STATES,
  DEFAULT_NODE_FONT_SIZE,
  DEFAULT_NODE_LIMIT,
  DEFAULT_SET_OPERATION,
  DEFAULT_USE_FOCUS_NODES,
} from "constants";
import { askQuestion, fetchNodeQuestionSuggestions, summarizeQuestionResult } from "services";
import { saveGraph } from "store";
import { getUrl } from "utils";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*\/[A-Za-z0-9_.:-]+$/;
const COLLECTION_COLORS = {
  MONDO: "#c44536",
  GS: "#227c9d",
  CL: "#4f8a3b",
  CHEMBL: "#7b4ab2",
  CHEBI: "#6b5b95",
  UBERON: "#d58936",
  CSD: "#0f766e",
  CS: "#2a9d8f",
  PR: "#8f5f2a",
  NCT: "#a23e8c",
};

const COLLECTION_LABELS = {
  MONDO: "Disease",
  GS: "Gene",
  CL: "Cell type",
  CHEMBL: "Drug",
  CHEBI: "Chemical entity",
  UBERON: "Anatomy",
  CSD: "Dataset",
  CS: "Cell set",
  PR: "Protein",
  NCT: "Clinical trial",
};
const DEFAULT_NODE_COLOR = "#5f6c7b";
const NODE_SUGGESTION_PRIORITY = [
  "GS",
  "MONDO",
  "CL",
  "CHEMBL",
  "PR",
  "CSD",
  "CS",
  "NCT",
  "PUB",
  "UBERON",
  "GO",
  "HP",
  "NCBITaxon",
  "PATO",
  "CHEBI",
  "HsapDv",
  "BMC",
  "BGS",
];
const NODE_SUGGESTION_PROMPTS = {
  GS: "genes",
  MONDO: "diseases",
  CL: "cell types",
  CHEMBL: "drugs",
  PR: "proteins",
  CSD: "datasets",
  CS: "cell sets",
  NCT: "clinical trials",
  PUB: "publications",
  UBERON: "anatomical structures",
  GO: "biological processes",
  HP: "phenotypes",
  NCBITaxon: "species",
  PATO: "phenotypic qualities",
  CHEBI: "chemicals",
  HsapDv: "development stages",
  BMC: "biomarker combinations",
  BGS: "gene sets",
};
const STARTER_QUESTION_EXAMPLES = [
  "What genes are associated with Alzheimer's disease?",
  "What clinical trials are available for Alzheimer's disease?",
  "What genes are expressed by retinal cell types?",
  "Starting from asthma, show connected genes, proteins, drugs, clinical trials, and related diseases.",
  "Find paths from retina to genes, datasets, and publications.",
];
const MORE_QUESTION_EXAMPLES = [
  "What cell types are associated with glaucoma?",
  "What drugs are connected to COPD?",
  "What proteins are connected to COPD through drugs or genes?",
  "Show me diseases connected to the drug revefenacin.",
  "What diseases are connected to clinical trial NCT03095456?",
  "What genes and proteins are connected to clinical trial NCT03095456?",
  "What datasets are connected to retina cell types?",
  "What publications support datasets related to retina?",
  "What biological processes are connected to asthma-associated genes?",
  "What anatomical structures are connected to retinal cell sets?",
  "How are COPD and revefenacin connected in the knowledge graph?",
  "Find drugs connected to emphysema and show the genes or proteins that explain the connection.",
  "Which cell types connect asthma to genes and biological processes?",
  "Show the path from retina cell sets to datasets and publications.",
  "What biomarker combinations or gene sets are connected to retinal cell sets?",
  "Why is COPD connected to clinical trial NCT03095456?",
  "Expand clinical trial NCT03095456 to diseases, drugs, genes, and proteins within two hops.",
  "Find paths from asthma to clinical trials within three hops.",
];

const getNestedValue = (obj, path, labelById = {}) => {
  const value = path.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
  return formatCellValue(value, labelById);
};

const formatCellValue = (value, labelById = {}) => {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => formatCellValue(item, labelById)).join(", ");
  if (typeof value === "object") return getDisplayLabel(value);
  const text = String(value);
  return labelById[text] || (ID_PATTERN.test(text) ? text.split("/", 1)[0] : text);
};

const getDisplayLabel = (item) => {
  if (!item) return "";
  const candidates = [
    item.label,
    item.Label,
    item.name,
    item.Name,
    item.title,
    item.Title,
    item.preferred_name,
    item.preferredName,
    item.display_name,
    item.displayName,
    item.gene_symbol,
    item.symbol,
    item.Symbol,
    item.drug_name,
    item.disease_name,
    item.cell_name,
    item.study_title,
    item.brief_title,
    item.official_title,
    item.study_name,
  ];
  const match = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
  if (match) return String(match);
  if (item.study_id) return `Clinical trial ${String(item.study_id).toUpperCase()}`;
  const synonyms = item.exact_synonym || item.hasExactSynonym || item.synonym || item.synonyms;
  if (Array.isArray(synonyms) && synonyms.length) return String(synonyms[0]);
  if (synonyms) return String(synonyms);
  const identifier = item._id || item.id || "";
  if (ID_PATTERN.test(identifier)) {
    const [collection, key] = identifier.split("/");
    return `${getCollectionLabel(collection)} ${key}`;
  }
  return identifier || "Record";
};

const getEdgeRelationshipLabel = (link) => {
  if (!link) return "";
  const candidates = [
    link.relationshipLabel,
    link.relationship_label,
    link.edgeLabel,
    link.edge_label,
    link.predicate,
    link.Predicate,
    link.relation,
    link.relationship,
    link.type,
    link.label,
    link.Label,
    link.name,
    link.Name,
  ];
  const match = candidates.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
  if (match) {
    const text = String(match);
    return ID_PATTERN.test(text) ? text.split("/", 1)[0] : text;
  }
  const identifier = link._id || link.id || "";
  return identifier.includes("/") ? identifier.split("/", 1)[0] : identifier;
};

const getNodeTooltip = (item) => {
  if (!item) return "";
  const collection = getCollection(item);
  const details = [
    getDisplayLabel(item),
    `Type: ${getCollectionLabel(collection)}`,
    item.study_id ? `Study ID: ${String(item.study_id).toUpperCase()}` : "",
    item.gene_symbol ? `Gene symbol: ${item.gene_symbol}` : "",
    item.definition ? `Definition: ${item.definition}` : "",
    item.refseq_summary ? `Summary: ${item.refseq_summary}` : "",
    item._id || item.id ? `Internal ID: ${item._id || item.id}` : "",
  ].filter(Boolean);
  return details.join("\n");
};

const compactTooltipValue = (value, maxLength = 180) => {
  if (value === undefined || value === null || value === "") return "";
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
};

const uniqueNonEmpty = (values) => Array.from(new Set(values.filter(Boolean)));

const getGraphNodeTooltipLines = (item, nodes = [], links = []) => {
  if (!item) return [];
  const collection = getCollection(item);
  const nodeId = item._id || item.id;
  const nodeById = new Map(nodes.map((node) => [node._id || node.id, node]).filter(([id]) => id));

  if (collection !== "NCT") {
    return getNodeTooltip(item).split("\n").filter(Boolean);
  }

  const incidentLinks = links.filter(
    (link) => getLinkEndpoint(link, "source") === nodeId || getLinkEndpoint(link, "target") === nodeId,
  );
  const connectedNodes = incidentLinks
    .map((link) => {
      const source = getLinkEndpoint(link, "source");
      const target = getLinkEndpoint(link, "target");
      return nodeById.get(source === nodeId ? target : source);
    })
    .filter(Boolean);
  const connectedDrugs = connectedNodes.filter((node) => getCollection(node) === "CHEMBL");
  const drugIds = new Set(connectedDrugs.map((drug) => drug._id || drug.id).filter(Boolean));
  const connectedDiseases = links
    .filter((link) => {
      const source = getLinkEndpoint(link, "source");
      const target = getLinkEndpoint(link, "target");
      return drugIds.has(source) || drugIds.has(target);
    })
    .map((link) => {
      const source = getLinkEndpoint(link, "source");
      const target = getLinkEndpoint(link, "target");
      const otherId = drugIds.has(source) ? target : source;
      return nodeById.get(otherId);
    })
    .filter((node) => getCollection(node) === "MONDO");

  const edgeLabels = uniqueNonEmpty(incidentLinks.map((link) => getEdgeRelationshipLabel(link)));
  const edgeSources = uniqueNonEmpty(incidentLinks.map((link) => link.Source || link.source_name));
  const studyId = compactTooltipValue(item.study_id || nodeId?.split("/")[1]).toUpperCase();
  const primaryDrug = connectedDrugs[0];

  const lines = [
    getDisplayLabel(item),
    "Type: Clinical trial",
    studyId ? `Study ID: ${studyId}` : "",
    primaryDrug ? `Evaluated drug: ${getDisplayLabel(primaryDrug)}` : "",
    primaryDrug?.drug_type ? `Drug type: ${compactTooltipValue(primaryDrug.drug_type)}` : "",
    primaryDrug?.approval_status ? `Approval status: ${compactTooltipValue(primaryDrug.approval_status)}` : "",
    primaryDrug?.mechanism_of_action ? `Mechanism: ${compactTooltipValue(primaryDrug.mechanism_of_action)}` : "",
    primaryDrug?.protein ? `Target/protein: ${compactTooltipValue(primaryDrug.protein)}` : "",
    primaryDrug?.trade_names ? `Trade names: ${compactTooltipValue(primaryDrug.trade_names)}` : "",
    connectedDiseases.length
      ? `Connected disease${connectedDiseases.length === 1 ? "" : "s"}: ${compactTooltipValue(
          uniqueNonEmpty(connectedDiseases.map(getDisplayLabel)).join(", "),
        )}`
      : "",
    edgeLabels.length ? `Relationship: ${compactTooltipValue(edgeLabels.join(", "))}` : "",
    edgeSources.length ? `Source: ${compactTooltipValue(edgeSources.join(", "))}` : "",
  ];

  if (!primaryDrug && incidentLinks.length) {
    lines.push(`Connected nodes: ${compactTooltipValue(uniqueNonEmpty(connectedNodes.map(getDisplayLabel)).join(", "))}`);
  }

  return lines.filter(Boolean);
};

const getCollection = (item) => {
  if (!item) return "Other";
  return item.collection || (item._id || item.id || "").split("/")[0] || "Other";
};

const getCollectionLabel = (collection) => COLLECTION_LABELS[collection] || collection || "Other";

const getCollectionColor = (collection) => COLLECTION_COLORS[collection] || DEFAULT_NODE_COLOR;

const getNodeDegreeMap = (links = []) => {
  const degreeMap = new Map();
  links.forEach((link) => {
    const source = getLinkEndpoint(link, "source");
    const target = getLinkEndpoint(link, "target");
    if (source) degreeMap.set(source, (degreeMap.get(source) || 0) + 1);
    if (target) degreeMap.set(target, (degreeMap.get(target) || 0) + 1);
  });
  return degreeMap;
};

const inferSuggestedQuestionFocusNodeId = (suggestion, result) => {
  const nodes = result?.nodes || [];
  if (!nodes.length) return null;

  const normalized = String(suggestion || "").toLowerCase();
  const sourceCollections = [];
  const addSourceCollection = (collection) => {
    if (collection && !sourceCollections.includes(collection)) sourceCollections.push(collection);
  };

  if (/these diseases|those diseases|these conditions|those conditions/.test(normalized)) addSourceCollection("MONDO");
  if (/these genes|those genes/.test(normalized)) addSourceCollection("GS");
  if (/these cell types|those cell types|those cells|these cells/.test(normalized)) addSourceCollection("CL");
  if (/these drugs|those drugs/.test(normalized)) addSourceCollection("CHEMBL");
  if (/these datasets|those datasets/.test(normalized)) {
    addSourceCollection("CSD");
    addSourceCollection("CS");
  }
  if (/these proteins|those proteins/.test(normalized)) addSourceCollection("PR");

  if (!sourceCollections.length) return null;

  const degreeMap = getNodeDegreeMap(result?.links || []);
  const match = nodes
    .filter((node) => sourceCollections.includes(getCollection(node)))
    .sort((a, b) => {
      const aId = a._id || a.id;
      const bId = b._id || b.id;
      return (degreeMap.get(bId) || 0) - (degreeMap.get(aId) || 0);
    })[0];

  return match?._id || match?.id || null;
};

const getNctIdentifier = (item) => {
  if (!item) return "";
  const candidates = [
    item.study_id,
    item.nct_id,
    item.nctId,
    item.NCTId,
    item._key,
    (item._id || item.id || "").split("/").pop(),
  ];
  const match = candidates
    .map((candidate) => String(candidate || "").trim().toUpperCase())
    .find((candidate) => /^NCT\d{8}$/.test(candidate));
  return match || "";
};

const getNodeLinkouts = (item) => {
  if (!item) return [];
  const collection = getCollection(item);
  const linkouts = [];

  if (collection === "NCT") {
    const nctId = getNctIdentifier(item);
    if (nctId) {
      linkouts.push({
        label: `ClinicalTrials.gov ${nctId}`,
        url: `https://clinicaltrials.gov/study/${nctId}`,
      });
    }
  }

  const configuredUrl = getUrl(item);
  if (configuredUrl && !linkouts.some((linkout) => linkout.url === configuredUrl)) {
    linkouts.push({
      label: `${getCollectionLabel(collection)} source page`,
      url: configuredUrl,
    });
  }

  return linkouts;
};

const buildLocalNodeSuggestions = (node, nodes = [], links = []) => {
  const nodeId = node?._id || node?.id;
  if (!nodeId) return [];

  const nodeCollection = getCollection(node);
  const nodeById = new Map(nodes.map((item) => [item._id || item.id, item]).filter(([id]) => id));
  const collectionCounts = new Map();
  let oneHopCount = 0;

  links.forEach((link) => {
    const source = getLinkEndpoint(link, "source");
    const target = getLinkEndpoint(link, "target");
    if (source !== nodeId && target !== nodeId) return;
    const otherNode = nodeById.get(source === nodeId ? target : source);
    const collection = getCollection(otherNode);
    oneHopCount += 1;
    if (collection && collection !== nodeCollection) {
      collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + 1);
    }
  });

  const visibleOneHopCount = oneHopCount;
  const label = getDisplayLabel(node);
  const suggestions = [];
  NODE_SUGGESTION_PRIORITY.forEach((collection) => {
    const targetLabel = NODE_SUGGESTION_PROMPTS[collection];
    const count = collectionCounts.get(collection) || 0;
    const visibleCount = collectionCounts.get(collection) || 0;
    if (count > visibleCount && targetLabel) {
      suggestions.push(`Show ${targetLabel} reachable from ${label}. (${count})`);
    }
  });
  if (oneHopCount > visibleOneHopCount) {
    suggestions.push(`Expand ${label} by one graph hop. (${oneHopCount})`);
  }
  return Array.from(new Set(suggestions)).slice(0, 10);
};

const summarizeVisibleNodeEdges = (node, nodes = [], links = []) => {
  const nodeId = node?._id || node?.id;
  if (!nodeId) return { visibleEdgeCount: 0, visibleNeighborCounts: {}, visibleNeighborIds: {} };

  const nodeById = new Map(nodes.map((item) => [item._id || item.id, item]).filter(([id]) => id));
  const visibleNeighborCounts = {};
  const visibleNeighborIds = {};
  let visibleEdgeCount = 0;

  links.forEach((link) => {
    const source = getLinkEndpoint(link, "source");
    const target = getLinkEndpoint(link, "target");
    if (source !== nodeId && target !== nodeId) return;

    visibleEdgeCount += 1;
    const otherNodeId = source === nodeId ? target : source;
    const otherNode = nodeById.get(otherNodeId);
    const collection = getCollection(otherNode);
    if (collection) {
      visibleNeighborCounts[collection] = (visibleNeighborCounts[collection] || 0) + 1;
      visibleNeighborIds[collection] = visibleNeighborIds[collection] || [];
      if (otherNodeId && !visibleNeighborIds[collection].includes(otherNodeId)) {
        visibleNeighborIds[collection].push(otherNodeId);
      }
    }
  });

  return { visibleEdgeCount, visibleNeighborCounts, visibleNeighborIds };
};

const createGraphSaveId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `ask-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const sanitizeFilenamePart = (value) =>
  String(value || "ask-graph")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "ask-graph";

const buildAskGraphSettings = (graphType) => ({
  depth: DEFAULT_DEPTH,
  edgeDirection: DEFAULT_EDGE_DIRECTION,
  setOperation: DEFAULT_SET_OPERATION,
  allowedCollections: [],
  availableCollections: [],
  allCollections: [],
  nodeFontSize: DEFAULT_NODE_FONT_SIZE,
  edgeFontSize: DEFAULT_EDGE_FONT_SIZE,
  nodeLimit: DEFAULT_NODE_LIMIT,
  labelStates: { ...DEFAULT_LABEL_STATES },
  findShortestPaths: DEFAULT_FIND_SHORTEST_PATHS,
  useFocusNodes: false,
  collapseOnStart: DEFAULT_COLLAPSE_ON_START,
  graphType: graphType || DEFAULT_GRAPH_TYPE,
  includeInterNodeEdges: DEFAULT_INCLUDE_INTER_NODE_EDGES,
  layoutMode: "force",
  edgeFilters: {},
});

const buildSavableAskGraphData = (nodes = [], links = []) => {
  const graphNodes = nodes.map((node) => {
    const nodeId = node._id || node.id;
    const collection = getCollection(node);
    return {
      ...node,
      id: nodeId,
      _id: node._id || nodeId,
      nodeLabel: getDisplayLabel(node),
      nodeHover: getNodeTooltip(node),
      color: getCollectionColor(collection),
    };
  });

  const graphLinks = links.map((link, index) => {
    const source = getLinkEndpoint(link, "source");
    const target = getLinkEndpoint(link, "target");
    const linkId = link._id || link.id || `${source || "source"}-${target || "target"}-${index}`;
    const relationshipLabel = getEdgeRelationshipLabel(link);
    return {
      ...link,
      id: link.id || linkId,
      _id: link._id || linkId,
      _key: link._key || String(linkId).split("/").pop(),
      source,
      target,
      _from: link._from || source,
      _to: link._to || target,
      label: relationshipLabel,
      Label: relationshipLabel,
      name: relationshipLabel,
      relationshipLabel,
      relationship_label: relationshipLabel,
      edgeLabel: relationshipLabel,
      edgeCollection: link.edgeCollection || link.edge_collection || (link._id || link.id || "").split("/", 1)[0],
      Source: link.Source || link.sourceText || link.source_name || "",
      sourceText: link.sourceText || link.Source || link.source_name || "",
    };
  });

  return { nodes: graphNodes, links: graphLinks };
};

const isIdentifierColumn = (column) => {
  const lastPart = column.split(".").pop();
  return ["_id", "id", "_key", "_from", "_to"].includes(lastPart);
};

const getLinkEndpoint = (link, field) => {
  const value = link[field] || link[field === "source" ? "_from" : "_to"];
  return typeof value === "object" ? value._id || value.id : value;
};

const valueContainsId = (value, nodeId) => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value === nodeId;
  if (Array.isArray(value)) return value.some((item) => valueContainsId(item, nodeId));
  if (typeof value === "object") {
    if (value._id === nodeId || value.id === nodeId || value._from === nodeId || value._to === nodeId) {
      return true;
    }
    return Object.values(value).some((item) => valueContainsId(item, nodeId));
  }
  return false;
};

const withPrunedAql = (result, nodeIds) => {
  const idsToExclude = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
  const excludedNodeIds = Array.from(
    new Set([...(result.excluded_node_ids || []), ...idsToExclude].filter(Boolean)),
  );
  const baseAql = result.base_aql || result.aql || "";

  return {
    aql: `LET excludedNodeIds = @excluded_node_ids
LET sourceRows = (
${baseAql}
)
FOR row IN sourceRows
  FILTER (row.path == null OR LENGTH(INTERSECTION(row.path, excludedNodeIds)) == 0)
  FILTER (row.disease == null OR row.disease._id NOT IN excludedNodeIds)
  FILTER (row.gene == null OR row.gene._id NOT IN excludedNodeIds)
  FILTER (row.cell_type == null OR row.cell_type._id NOT IN excludedNodeIds)
  FILTER (row.drug == null OR row.drug._id NOT IN excludedNodeIds)
  FILTER (row.protein == null OR row.protein._id NOT IN excludedNodeIds)
  FILTER (row.dataset == null OR row.dataset._id NOT IN excludedNodeIds)
  FILTER (row.clinical_trial == null OR row.clinical_trial._id NOT IN excludedNodeIds)
  FILTER (row.start == null OR row.start._id NOT IN excludedNodeIds)
  FILTER (row.neighbor == null OR row.neighbor._id NOT IN excludedNodeIds)
  RETURN row`,
    bind_vars: {
      ...(result.bind_vars || {}),
      excluded_node_ids: excludedNodeIds,
    },
    base_aql: baseAql,
    excluded_node_ids: excludedNodeIds,
  };
};

const summarizeResultForHistory = (result) => {
  if (!result) return null;
  return {
    answer: result.answer,
    aql: result.aql,
    bind_vars: result.bind_vars,
    excluded_node_ids: result.excluded_node_ids || [],
    graph: result.graph,
    row_count: result.rows?.length || 0,
    columns: result.columns || [],
    nodes: (result.nodes || []).slice(0, 80).map((node) => ({
      id: node._id || node.id,
      label: getDisplayLabel(node),
      collection: node.collection || (node._id || node.id || "").split("/")[0],
    })),
    links: (result.links || []).slice(0, 120).map((link) => ({
      id: link._id || link.id,
      source: link._from || link.source,
      target: link._to || link.target,
      label: getEdgeRelationshipLabel(link),
      Label: getEdgeRelationshipLabel(link),
      relationshipLabel: getEdgeRelationshipLabel(link),
    })),
  };
};

const sortForStableJson = (value) => {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = sortForStableJson(value[key]);
      return sorted;
    }, {});
};

const getRowMergeKey = (row) => {
  try {
    return JSON.stringify(sortForStableJson(row));
  } catch {
    return String(row);
  }
};

const mergeGraphContext = (result, baseResult) => {
  if (!result || !baseResult) return result;

  const nodesById = new Map();
  for (const node of baseResult.nodes || []) {
    const id = node._id || node.id;
    if (id) nodesById.set(id, node);
  }
  for (const node of result.nodes || []) {
    const id = node._id || node.id;
    if (id) nodesById.set(id, { ...nodesById.get(id), ...node });
  }

  const linksById = new Map();
  for (const link of baseResult.links || []) {
    const id = link._id || link.id || `${link._from || link.source}-${link._to || link.target}`;
    if (id) linksById.set(id, link);
  }
  for (const link of result.links || []) {
    const id = link._id || link.id || `${link._from || link.source}-${link._to || link.target}`;
    if (id) linksById.set(id, { ...linksById.get(id), ...link });
  }

  const rowsByKey = new Map();
  for (const row of baseResult.rows || []) {
    rowsByKey.set(getRowMergeKey(row), row);
  }
  for (const row of result.rows || []) {
    rowsByKey.set(getRowMergeKey(row), row);
  }

  const mergedColumns = Array.from(
    new Set([...(baseResult.columns || []), ...(result.columns || [])]),
  );

  return {
    ...result,
    rows: Array.from(rowsByKey.values()),
    columns: mergedColumns.length ? mergedColumns : result.columns,
    nodes: Array.from(nodesById.values()),
    links: Array.from(linksById.values()),
    graph_context_expanded: true,
  };
};

const removeNodeFromResult = (result, nodeId) => {
  return removeNodesFromResult(result, [nodeId]);
};

const removeNodesFromResult = (result, nodeIds) => {
  if (!result) return result;
  const idsToRemove = new Set((nodeIds || []).filter(Boolean));
  if (!idsToRemove.size) return result;

  const removedNodes = (result.nodes || []).filter((node) => idsToRemove.has(node._id || node.id));
  const removedLinks = (result.links || []).filter(
    (link) => idsToRemove.has(getLinkEndpoint(link, "source")) || idsToRemove.has(getLinkEndpoint(link, "target")),
  );
  const prunedAql = withPrunedAql(result, Array.from(idsToRemove));

  return {
    ...result,
    ...prunedAql,
    rows: (result.rows || []).filter((row) => !Array.from(idsToRemove).some((nodeId) => valueContainsId(row, nodeId))),
    nodes: (result.nodes || []).filter((node) => !idsToRemove.has(node._id || node.id)),
    links: (result.links || []).filter(
      (link) => !idsToRemove.has(getLinkEndpoint(link, "source")) && !idsToRemove.has(getLinkEndpoint(link, "target")),
    ),
    graph_context_pruned: true,
    pruned_graph_items: [
      ...(result.pruned_graph_items || []),
      ...Array.from(idsToRemove).map((nodeId) => ({
        node_id: nodeId,
        label: getDisplayLabel(removedNodes.find((node) => (node._id || node.id) === nodeId)) || nodeId,
        removed_link_count: removedLinks.length,
      })),
    ],
  };
};

const GraphLegend = ({ nodes, deEmphasizedCollections = [], onToggleCollection }) => {
  const legendItems = useMemo(() => {
    const collections = Array.from(new Set(nodes.map((node) => getCollection(node)))).filter(Boolean);
    return collections.sort().map((collection) => ({
      collection,
      label: getCollectionLabel(collection),
      color: getCollectionColor(collection),
    }));
  }, [nodes]);

  if (!legendItems.length) return null;

  return (
    <div className="ask-graph-legend" aria-label="Graph legend">
      {legendItems.map((item) => (
        <button
          key={item.collection}
          type="button"
          className={
            deEmphasizedCollections.includes(item.collection)
              ? "ask-legend-item de-emphasized"
              : "ask-legend-item"
          }
          onClick={() => onToggleCollection?.(item.collection)}
          title={`Toggle focus for ${item.label}`}
        >
          <span className="ask-legend-swatch" style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};

const ResultGraph = forwardRef(
  (
    {
      nodes,
      links,
      onNodeClick,
      selectedNodeId,
      selectedNodeIds = [],
      selectionMode = false,
      onSelectionChange,
      lockedNodePositions = {},
      onToggleNodeLock,
      layoutVersion = 0,
      focusNodeId = null,
      deEmphasizedCollections = [],
    },
    ref,
  ) => {
  const svgRef = useRef(null);
  const graphStateRef = useRef(null);
  const selectionModeRef = useRef(selectionMode);
  const selectedNodeSetRef = useRef(new Set(selectedNodeIds));
  const onSelectionChangeRef = useRef(onSelectionChange);
  const lockedNodePositionsRef = useRef(lockedNodePositions);
  const tooltipRef = useRef(null);
  const tooltipHideTimeoutRef = useRef(null);
  const tooltipShowTimeoutRef = useRef(null);
  const tooltipVisibleRef = useRef(false);
  const pendingTooltipRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [tooltipHasOverflow, setTooltipHasOverflow] = useState(false);
  const selectedNodeSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const deEmphasizedCollectionSet = useMemo(
    () => new Set(deEmphasizedCollections),
    [deEmphasizedCollections],
  );
  const tooltipByNodeId = useMemo(() => {
    return new Map(
      nodes
        .map((node) => [node._id || node.id, getGraphNodeTooltipLines(node, nodes, links)])
        .filter(([id, lines]) => id && lines.length),
    );
  }, [nodes, links]);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
    selectedNodeSetRef.current = new Set(selectedNodeIds);
    onSelectionChangeRef.current = onSelectionChange;
    if (selectionMode) setTooltip(null);
  }, [selectionMode, selectedNodeIds, onSelectionChange]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll(".ask-graph-nodes g").classed("selected", (d) => {
      const nodeId = d?._id || d?.id;
      return nodeId === selectedNodeId || selectedNodeSet.has(nodeId);
    });
  }, [selectedNodeId, selectedNodeSet]);

  useEffect(() => {
    const previousLockedPositions = lockedNodePositionsRef.current;
    lockedNodePositionsRef.current = lockedNodePositions;

    const state = graphStateRef.current;
    if (!state) return;

    state.graphNodes.forEach((node) => {
      const nodeId = node._id || node.id;
      const lockedPosition = lockedNodePositions[nodeId];
      if (lockedPosition) {
        node.fx = lockedPosition.x;
        node.fy = lockedPosition.y;
      } else if (previousLockedPositions[nodeId]) {
        node.fx = null;
        node.fy = null;
      }
    });

    d3.select(svgRef.current)
      .selectAll(".ask-graph-nodes g")
      .select(".ask-graph-lock-icon")
      .style("display", (d) => (lockedNodePositions[d._id || d.id] ? null : "none"));
  }, [lockedNodePositions]);

  const clearTooltipHideTimeout = () => {
    if (!tooltipHideTimeoutRef.current) return;
    window.clearTimeout(tooltipHideTimeoutRef.current);
    tooltipHideTimeoutRef.current = null;
  };

  const clearTooltipShowTimeout = () => {
    if (!tooltipShowTimeoutRef.current) return;
    window.clearTimeout(tooltipShowTimeoutRef.current);
    tooltipShowTimeoutRef.current = null;
  };

  const scheduleTooltipShow = (event, d) => {
    if (selectionModeRef.current) return;
    clearTooltipHideTimeout();
    const rect = svgRef.current.getBoundingClientRect();
    const nodeId = d._id || d.id;
    const nextTooltip = {
      lines: tooltipByNodeId.get(nodeId) || getGraphNodeTooltipLines(d, nodes, links),
      linkouts: getNodeLinkouts(d),
      x: event.clientX - rect.left + 14,
      y: event.clientY - rect.top + 14,
    };
    pendingTooltipRef.current = nextTooltip;

    if (tooltipVisibleRef.current) {
      setTooltip(nextTooltip);
      return;
    }

    if (tooltipShowTimeoutRef.current) return;
    tooltipShowTimeoutRef.current = window.setTimeout(() => {
      setTooltip(pendingTooltipRef.current);
      tooltipShowTimeoutRef.current = null;
    }, 500);
  };

  const scheduleTooltipHide = () => {
    clearTooltipShowTimeout();
    clearTooltipHideTimeout();
    tooltipHideTimeoutRef.current = window.setTimeout(() => {
      setTooltip(null);
      tooltipHideTimeoutRef.current = null;
    }, 260);
  };

  useEffect(() => {
    tooltipVisibleRef.current = Boolean(tooltip?.lines?.length);

    if (!tooltip) {
      setTooltipHasOverflow(false);
      return undefined;
    }

    const tooltipElement = tooltipRef.current;
    if (!tooltipElement) return undefined;

    const updateOverflowState = () => {
      setTooltipHasOverflow(tooltipElement.scrollHeight > tooltipElement.clientHeight + 2);
    };
    const animationFrame = window.requestAnimationFrame(updateOverflowState);

    const handleKeyDown = (event) => {
      if (event.key.toLowerCase() === "l" && tooltip.linkouts?.[0]?.url) {
        event.preventDefault();
        window.open(tooltip.linkouts[0].url, "_blank", "noopener,noreferrer");
        return;
      }
      if (!["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) return;
      if (tooltipElement.scrollHeight <= tooltipElement.clientHeight) return;

      event.preventDefault();
      const scrollAmount = event.key === "ArrowDown" || event.key === "ArrowUp" ? 36 : tooltipElement.clientHeight * 0.75;
      if (event.key === "ArrowDown") tooltipElement.scrollTop += scrollAmount;
      if (event.key === "ArrowUp") tooltipElement.scrollTop -= scrollAmount;
      if (event.key === "PageDown") tooltipElement.scrollTop += scrollAmount;
      if (event.key === "PageUp") tooltipElement.scrollTop -= scrollAmount;
      if (event.key === "Home") tooltipElement.scrollTop = 0;
      if (event.key === "End") tooltipElement.scrollTop = tooltipElement.scrollHeight;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateOverflowState);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateOverflowState);
    };
  }, [tooltip]);

  useEffect(() => {
    return () => {
      clearTooltipHideTimeout();
      clearTooltipShowTimeout();
    };
  }, []);

  useImperativeHandle(ref, () => ({
    fitToView: () => {
      const state = graphStateRef.current;
      if (!state || !state.graphNodes.length) return;
      const { svg, zoom, graphNodes, width, height } = state;
      const displayRect = svgRef.current?.getBoundingClientRect();
      const displayWidth = displayRect?.width || width;
      const displayHeight = displayRect?.height || height;
      const nodeRadius = 24;
      const labelPadding = 130;
      const xs = graphNodes.map((node) => node.x ?? width / 2).filter(Number.isFinite);
      const ys = graphNodes.map((node) => node.y ?? height / 2).filter(Number.isFinite);
      if (!xs.length || !ys.length) return;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const padding = 28;
      const graphWidth = Math.max(maxX - minX + labelPadding + nodeRadius * 2, 1);
      const graphHeight = Math.max(maxY - minY + nodeRadius * 2, 1);
      const scale = Math.min(
        2.4,
        Math.max(
          0.02,
          Math.min((displayWidth - padding * 2) / graphWidth, (displayHeight - padding * 2) / graphHeight),
        ),
      );
      const centerX = (minX + maxX) / 2 + labelPadding / 2;
      const centerY = (minY + maxY) / 2;
      const transform = d3.zoomIdentity
        .translate(width / 2 - centerX * scale, height / 2 - centerY * scale)
        .scale(scale);
      svg.interrupt().transition().duration(360).call(zoom.transform, transform);
    },
    focusNode: (nodeId, desiredScale = 1.28) => {
      const state = graphStateRef.current;
      if (!state || !nodeId) return;
      const { svg, zoom, graphNodes, width, height } = state;
      const graphNode = graphNodes.find((node) => (node._id || node.id) === nodeId);
      if (!graphNode) return;
      const scale = Math.max(0.8, Math.min(desiredScale, 1.65));
      const nodeX = graphNode.x ?? width / 2;
      const nodeY = graphNode.y ?? height / 2;
      const transform = d3.zoomIdentity
        .translate(width / 2 - nodeX * scale, height / 2 - nodeY * scale)
        .scale(scale);
      svg.transition().duration(360).call(zoom.transform, transform);
    },
    getNodePositions: (nodeIds = []) => {
      const state = graphStateRef.current;
      if (!state) return {};
      const requestedIds = new Set(nodeIds);
      return Object.fromEntries(
        state.graphNodes
          .filter((node) => requestedIds.has(node._id || node.id))
          .map((node) => [node._id || node.id, { x: node.x ?? state.width / 2, y: node.y ?? state.height / 2 }]),
      );
    },
  }));

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    setTooltip(null);

    if (!nodes.length) return;

    const width = 920;
    const height = 520;
    const graphNodes = nodes.map((node) => {
      const nodeId = node._id || node.id;
      const lockedPosition = lockedNodePositionsRef.current[nodeId];
      const shouldFocusNode = !lockedPosition && focusNodeId && nodeId === focusNodeId;
      return {
        ...node,
        x: lockedPosition?.x ?? (shouldFocusNode ? width / 2 : undefined),
        y: lockedPosition?.y ?? (shouldFocusNode ? height / 2 : undefined),
        fx: lockedPosition?.x ?? (shouldFocusNode ? width / 2 : node.fx),
        fy: lockedPosition?.y ?? (shouldFocusNode ? height / 2 : node.fy),
      };
    });
    const graphLinks = links.map((link) => ({
      ...link,
      source: link.source || link._from,
      target: link.target || link._to,
      relationshipLabel: getEdgeRelationshipLabel(link),
    }));

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const zoomLayer = svg.append("g");
    const selectionLayer = svg.append("g").attr("class", "ask-graph-selection-layer");
    const zoom = d3.zoom().filter((event) => !selectionModeRef.current).on("zoom", (event) => {
        zoomLayer.attr("transform", event.transform);
    });
    svg.call(zoom);

    const simulation = d3
      .forceSimulation(graphNodes)
      .force(
        "link",
        d3
          .forceLink(graphLinks)
          .id((node) => node.id || node._id)
          .distance(120),
      )
      .force("charge", d3.forceManyBody().strength(focusNodeId ? -560 : -360))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(focusNodeId ? 48 : 38))
      .alpha(focusNodeId ? 0.95 : 1)
      .alphaDecay(focusNodeId ? 0.018 : 0.022);

    if (focusNodeId) {
      simulation.force(
        "selected-node-focus",
        d3
          .forceRadial(
            (node) => ((node._id || node.id) === focusNodeId ? 0 : 245),
            width / 2,
            height / 2,
          )
          .strength((node) => ((node._id || node.id) === focusNodeId ? 1 : 0.34)),
      );
    }

    const link = zoomLayer
      .append("g")
      .attr("class", "ask-graph-links")
      .selectAll("line")
      .data(graphLinks)
      .join("line");

    const linkLabel = zoomLayer
      .append("g")
      .attr("class", "ask-graph-link-labels")
      .selectAll("text")
      .data(graphLinks.filter((graphLink) => getEdgeRelationshipLabel(graphLink)))
      .join("text")
      .attr("dy", -4)
      .text((d) => getEdgeRelationshipLabel(d));

    const node = zoomLayer
      .append("g")
      .attr("class", "ask-graph-nodes")
      .selectAll("g")
      .data(graphNodes)
      .join("g")
      .call(
        d3
          .drag()
          .filter(() => !selectionModeRef.current)
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = d.x;
            d.fy = d.y;
          }),
      );

    node
      .classed("selected", (d) => (d._id || d.id) === selectedNodeId || selectedNodeSet.has(d._id || d.id))
      .on("click", (event, d) => {
        event.stopPropagation();
        d.fx = d.x;
        d.fy = d.y;
        clearTooltipShowTimeout();
        if (selectionModeRef.current) {
          const nodeId = d._id || d.id;
          if (!nodeId) return;
          const next = new Set(selectedNodeSetRef.current);
          if (next.has(nodeId)) next.delete(nodeId);
          else next.add(nodeId);
          onSelectionChangeRef.current?.(Array.from(next));
          return;
        }
        onNodeClick?.(d);
      })
      .on("contextmenu", (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        const nodeId = d._id || d.id;
        if (!nodeId) return;
        const isLocked = Boolean(lockedNodePositionsRef.current[nodeId]);
        if (isLocked) {
          d.fx = null;
          d.fy = null;
        } else {
          d.fx = d.x;
          d.fy = d.y;
        }
        onToggleNodeLock?.(nodeId, { x: d.x ?? width / 2, y: d.y ?? height / 2 });
      })
      .on("mouseenter", (event, d) => {
        scheduleTooltipShow(event, d);
      })
      .on("mousemove", (event, d) => {
        scheduleTooltipShow(event, d);
      })
      .on("mouseleave", () => {
        if (selectionModeRef.current) return;
        scheduleTooltipHide();
      });

    node
      .append("circle")
      .attr("r", (d) => (deEmphasizedCollectionSet.has(getCollection(d)) ? 4.5 : 18))
      .attr("fill", (d) => getCollectionColor(getCollection(d)))
      .attr("opacity", (d) => (deEmphasizedCollectionSet.has(getCollection(d)) ? 0.42 : 1));
    node
      .append("text")
      .attr("x", (d) => (deEmphasizedCollectionSet.has(getCollection(d)) ? 8 : 24))
      .attr("y", (d) => (deEmphasizedCollectionSet.has(getCollection(d)) ? 3 : 5))
      .style("font-size", (d) => (deEmphasizedCollectionSet.has(getCollection(d)) ? "6px" : "12px"))
      .style("opacity", (d) => (deEmphasizedCollectionSet.has(getCollection(d)) ? 0.55 : 1))
      .text((d) => getDisplayLabel(d));
    node
      .append("text")
      .attr("class", "ask-graph-lock-icon")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .style("display", (d) => (lockedNodePositionsRef.current[d._id || d.id] ? null : "none"))
      .text("🔒");

    link.append("title").text((d) => getEdgeRelationshipLabel(d) || d._id || "");

    svg.on("mousedown.selection", (event) => {
        if (!selectionModeRef.current || event.button !== 0) return;
        event.preventDefault();
        const [startX, startY] = d3.pointer(event, svg.node());
        let rect = selectionLayer
          .append("rect")
          .attr("class", "ask-graph-selection-rect")
          .attr("x", startX)
          .attr("y", startY)
          .attr("width", 0)
          .attr("height", 0);

        const handleMove = (moveEvent) => {
          const [currentX, currentY] = d3.pointer(moveEvent, svg.node());
          rect
            .attr("x", Math.min(startX, currentX))
            .attr("y", Math.min(startY, currentY))
            .attr("width", Math.abs(currentX - startX))
            .attr("height", Math.abs(currentY - startY));
        };

        const handleUp = (upEvent) => {
          const [endX, endY] = d3.pointer(upEvent, svg.node());
          const x1 = Math.min(startX, endX);
          const x2 = Math.max(startX, endX);
          const y1 = Math.min(startY, endY);
          const y2 = Math.max(startY, endY);
          const transform = d3.zoomTransform(svg.node());
          const selectedIds = graphNodes
            .filter((graphNode) => {
              const screenX = transform.applyX(graphNode.x ?? width / 2);
              const screenY = transform.applyY(graphNode.y ?? height / 2);
              return screenX >= x1 && screenX <= x2 && screenY >= y1 && screenY <= y2;
            })
            .map((graphNode) => graphNode._id || graphNode.id)
            .filter(Boolean);
          rect.remove();
          rect = null;
          svg.on("mousemove.selection", null).on("mouseup.selection", null).on("mouseleave.selection", null);
          if (selectedIds.length) onSelectionChangeRef.current?.(selectedIds);
        };

        svg
          .on("mousemove.selection", handleMove)
          .on("mouseup.selection", handleUp)
          .on("mouseleave.selection", () => {
            rect?.remove();
            svg.on("mousemove.selection", null).on("mouseup.selection", null).on("mouseleave.selection", null);
          });
      });

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);

      linkLabel
        .attr("x", 0)
        .attr("y", 0)
        .attr("transform", (d) => {
          const sourceX = d.source.x ?? 0;
          const sourceY = d.source.y ?? 0;
          const targetX = d.target.x ?? 0;
          const targetY = d.target.y ?? 0;
          const midX = (sourceX + targetX) / 2;
          const midY = (sourceY + targetY) / 2;
          let angle = (Math.atan2(targetY - sourceY, targetX - sourceX) * 180) / Math.PI;
          if (angle > 90 || angle < -90) angle += 180;
          return `translate(${midX},${midY}) rotate(${angle})`;
        });

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    graphStateRef.current = { svg, zoom, graphNodes, width, height };

    return () => simulation.stop();
  }, [
    nodes,
    links,
    onNodeClick,
    tooltipByNodeId,
    layoutVersion,
    onToggleNodeLock,
    focusNodeId,
    deEmphasizedCollectionSet,
  ]);

  return (
    <>
      <svg ref={svgRef} className="ask-result-graph" role="img" aria-label="Result graph" />
      {tooltip?.lines?.length > 0 && (
        <div
          ref={tooltipRef}
          className="ask-graph-tooltip"
          style={{
            left: `${Math.min(tooltip.x, 620)}px`,
            top: `${Math.min(tooltip.y, 360)}px`,
          }}
          tabIndex={-1}
          onMouseEnter={clearTooltipHideTimeout}
          onMouseLeave={scheduleTooltipHide}
        >
          <div className="ask-graph-tooltip-title">{tooltip.lines[0]}</div>
          {tooltip.linkouts?.length > 0 && (
            <div className="ask-graph-tooltip-linkouts">
              {tooltip.linkouts.slice(0, 1).map((linkout) => (
                <a
                  key={linkout.url}
                  href={linkout.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ask-graph-tooltip-linkout"
                  title={linkout.label}
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                  <span>press L - to visit</span>
                </a>
              ))}
            </div>
          )}
          {tooltipHasOverflow && (
            <div className="ask-graph-tooltip-scroll-hint">Use arrows to scroll</div>
          )}
          {tooltip.lines.slice(1).map((line) => (
            <div key={line} className="ask-graph-tooltip-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </>
  );
  },
);

const AskQuestionPage = () => {
  const dispatch = useDispatch();
  const messagesRef = useRef(null);
  const graphRef = useRef(null);
  const nodeSuggestionCacheRef = useRef(new Map());
  const graphDownloadUrlRef = useRef("");
  const [question, setQuestion] = useState("");
  const [graph] = useState("auto");
  const [messages, setMessages] = useState([]);
  const [showMoreExamples, setShowMoreExamples] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const [queryMode, setQueryMode] = useState("new");
  const [isGraphExpanded, setIsGraphExpanded] = useState(false);
  const [isGraphSelectMode, setIsGraphSelectMode] = useState(false);
  const [selectedGraphNodeIds, setSelectedGraphNodeIds] = useState([]);
  const [lockedGraphNodePositions, setLockedGraphNodePositions] = useState({});
  const [nodeSuggestions, setNodeSuggestions] = useState({
    isLoading: false,
    isEnriching: false,
    isExpanding: false,
    error: "",
    node: null,
    questions: [],
  });
  const [isSaveGraphFormOpen, setIsSaveGraphFormOpen] = useState(false);
  const [saveGraphName, setSaveGraphName] = useState("");
  const [saveGraphMessage, setSaveGraphMessage] = useState("");
  const [saveGraphDownload, setSaveGraphDownload] = useState(null);
  const [graphLayoutVersion, setGraphLayoutVersion] = useState(0);
  const [focusSelectedGraphNode, setFocusSelectedGraphNode] = useState(true);
  const [deEmphasizedCollections, setDeEmphasizedCollections] = useState([]);
  const [graphSearchTerm, setGraphSearchTerm] = useState("");
  const [graphSearchMatchId, setGraphSearchMatchId] = useState(null);
  const [graphSearchStatus, setGraphSearchStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [error, setError] = useState("");

  const activeResult = activeResultIndex !== null ? messages[activeResultIndex]?.result : null;
  const columns = activeResult?.columns || [];
  const rows = activeResult?.rows || [];
  const nodes = useMemo(() => activeResult?.nodes || [], [activeResult]);
  const links = useMemo(() => activeResult?.links || [], [activeResult]);
  const hasRefinableResult = Boolean(activeResult && (activeResult.nodes?.length || 0) > 0);
  const labelById = useMemo(
    () =>
      Object.fromEntries(
        nodes
          .map((node) => [node._id || node.id, getDisplayLabel(node)])
          .filter(([id, label]) => id && label),
      ),
    [nodes],
  );
  const visibleColumns = useMemo(
    () => columns.filter((column) => !isIdentifierColumn(column)),
    [columns],
  );
  const singletonGraphNodeIds = useMemo(() => {
    const linkedNodeIds = new Set();
    links.forEach((link) => {
      const source = getLinkEndpoint(link, "source");
      const target = getLinkEndpoint(link, "target");
      if (source) linkedNodeIds.add(source);
      if (target) linkedNodeIds.add(target);
    });
    return nodes
      .map((node) => node._id || node.id)
      .filter((nodeId) => nodeId && !linkedNodeIds.has(nodeId));
  }, [links, nodes]);

  useEffect(() => {
    const searchText = graphSearchTerm.trim().toLowerCase();
    if (!searchText) {
      setGraphSearchMatchId(null);
      setGraphSearchStatus("");
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const scoredMatches = nodes
        .map((node) => {
          const nodeId = node._id || node.id;
          const label = getDisplayLabel(node);
          const searchableValues = [
            label,
            node.name,
            node.label,
            node.title,
            node.gene_symbol,
            node.symbol,
            node._key,
            node.id,
            node._id,
          ]
            .filter(Boolean)
            .map((value) => String(value).toLowerCase());

          if (!nodeId || !searchableValues.some((value) => value.includes(searchText))) {
            return null;
          }

          const bestScore = Math.max(
            ...searchableValues.map((value) => {
              if (value === searchText) return 4;
              if (value.startsWith(searchText)) return 3;
              if (value.split(/\s+/).some((word) => word.startsWith(searchText))) return 2;
              return 1;
            }),
          );

          return { nodeId, label, score: bestScore };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.label.length - b.label.length);

      const match = scoredMatches[0];
      if (!match) {
        setGraphSearchMatchId(null);
        setGraphSearchStatus("No match");
        return;
      }

      setGraphSearchMatchId(match.nodeId);
      setGraphSearchStatus(match.label);
      graphRef.current?.focusNode(match.nodeId, 1.32);
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [graphSearchTerm, nodes]);

  const toggleGraphCollectionFocus = useCallback((collection) => {
    setDeEmphasizedCollections((currentCollections) =>
      currentCollections.includes(collection)
        ? currentCollections.filter((item) => item !== collection)
        : [...currentCollections, collection],
    );
  }, []);

  const toggleGraphNodeLock = useCallback((nodeId, position) => {
    if (!nodeId) return;
    setLockedGraphNodePositions((currentPositions) => {
      const nextPositions = { ...currentPositions };
      if (nextPositions[nodeId]) {
        delete nextPositions[nodeId];
      } else if (position) {
        nextPositions[nodeId] = position;
      }
      return nextPositions;
    });
  }, []);

  const toggleSelectedGraphNodeLocks = useCallback(() => {
    if (!selectedGraphNodeIds.length) return;
    const allSelectedLocked = selectedGraphNodeIds.every((nodeId) => lockedGraphNodePositions[nodeId]);
    if (allSelectedLocked) {
      setLockedGraphNodePositions((currentPositions) => {
        const nextPositions = { ...currentPositions };
        selectedGraphNodeIds.forEach((nodeId) => delete nextPositions[nodeId]);
        return nextPositions;
      });
      return;
    }

    const currentPositions = graphRef.current?.getNodePositions(selectedGraphNodeIds) || {};
    setLockedGraphNodePositions((currentLockedPositions) => ({
      ...currentLockedPositions,
      ...currentPositions,
    }));
  }, [lockedGraphNodePositions, selectedGraphNodeIds]);

  const clearNodeSuggestions = () => {
    setNodeSuggestions({
      isLoading: false,
      isEnriching: false,
      isExpanding: false,
      error: "",
      node: null,
      questions: [],
    });
  };

  const submitQuestion = async (
    submittedQuestion = question,
    requestedMode = queryMode,
    historyMessages = null,
    canRefine = hasRefinableResult,
    mergeBaseResult = null,
    options = {},
  ) => {
    const trimmed = submittedQuestion.trim();
    if (!trimmed || isLoading) return;

    const effectiveMode = requestedMode === "refine" && canRefine ? "refine" : "new";

    const userMessage = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setQuestion("");
    setQueryMode(effectiveMode);
    setError("");
    setIsLoading(true);
    if (effectiveMode === "new") {
      setLockedGraphNodePositions({});
    } else {
      clearNodeSuggestions();
    }

    try {
      const contextHistoryMessages =
        historyMessages ||
        (effectiveMode === "refine" && activeResultIndex !== null
          ? messages.slice(0, activeResultIndex + 1)
          : messages);
      const requestHistory =
        effectiveMode === "refine"
          ? contextHistoryMessages.map(({ role, content, result }) => ({
              role,
              content,
              result_summary: summarizeResultForHistory(result),
            }))
          : [];
      let result = await askQuestion({
        question: trimmed,
        graph,
        mode: effectiveMode,
        history: requestHistory,
      });
      const baseResultForMerge =
        effectiveMode === "refine" ? mergeBaseResult || activeResult : mergeBaseResult;
      result = mergeGraphContext(result, baseResultForMerge);
      const assistantMessage = {
        role: "assistant",
        content: result.answer || "I generated and ran a read-only AQL query.",
        result,
      };
      const resultIndex = nextMessages.length;
      setMessages([...nextMessages, assistantMessage]);
      setActiveResultIndex(resultIndex);
      setViewMode(result.nodes?.length ? "graph" : "table");
      setSelectedGraphNodeIds([]);
      if ((result.nodes?.length || 0) > 0) setQueryMode("refine");
      if (options.resetGraphView && (result.nodes?.length || 0) > 0) {
        const focusNodeId = options.focusNodeId;
        setFocusSelectedGraphNode(Boolean(focusNodeId));
        setGraphSearchMatchId(focusNodeId || null);
        setGraphLayoutVersion((version) => version + 1);
        const refreshView = () => {
          if (focusNodeId) graphRef.current?.focusNode(focusNodeId, options.focusScale || 1.18);
          else graphRef.current?.fitToView();
        };
        window.setTimeout(refreshView, 220);
        window.setTimeout(refreshView, 760);
        window.setTimeout(refreshView, 1350);
      }
    } catch (err) {
      setError(err.message || "The question could not be answered.");
      setMessages(nextMessages);
    } finally {
      setIsLoading(false);
      setNodeSuggestions((currentSuggestions) => ({
        ...currentSuggestions,
        isExpanding: false,
      }));
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    submitQuestion();
  };

  const handleQuestionKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const modeForSubmit = queryMode === "refine" && hasRefinableResult ? "refine" : "new";
      submitQuestion(question, modeForSubmit);
    }
  };

  const handleNewSearchClick = () => {
    setQueryMode("new");
    setLockedGraphNodePositions({});
    if (question.trim()) submitQuestion(question, "new", messages, false);
  };

  const handleRefineClick = () => {
    setQueryMode("refine");
    if (question.trim()) submitQuestion(question, "refine");
  };

  const summarizeActiveResult = async () => {
    if (!activeResult || activeResultIndex === null || isSummaryLoading) return;

    const sourceQuestion =
      messages[activeResultIndex - 1]?.role === "user" ? messages[activeResultIndex - 1].content : "";
    setError("");
    setIsSummaryLoading(true);
    try {
      const response = await summarizeQuestionResult({
        question: sourceQuestion,
        answer: messages[activeResultIndex]?.content || activeResult.answer || "",
        graph: activeResult.graph || graph,
        columns: visibleColumns,
        rows,
        nodes,
        links,
      });
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          content: `Experimental summary\n\n${response.summary}`,
        },
      ]);
    } catch (err) {
      setError(err.message || "The experimental summary could not be generated.");
    } finally {
      setIsSummaryLoading(false);
    }
  };

  const showResult = (index) => {
    setActiveResultIndex(index);
    setSelectedGraphNodeIds([]);
    if ((messages[index]?.result?.nodes?.length || 0) > 0) setQueryMode("refine");
  };

  const runSuggestedQuestion = (suggestedQuestion, messageIndex) => {
    const result = messages[messageIndex]?.result;
    if (!result || isLoading) return;
    const focusNodeId = inferSuggestedQuestionFocusNodeId(suggestedQuestion, result);
    setActiveResultIndex(messageIndex);
    setQueryMode("refine");
    submitQuestion(
      suggestedQuestion,
      "refine",
      messages.slice(0, messageIndex + 1),
      (result.nodes?.length || 0) > 0,
      result,
      { resetGraphView: true, focusNodeId, focusScale: 1.24 },
    );
  };

  const handleGraphNodeClick = useCallback(async (node) => {
    const nodeId = node._id || node.id;
    if (!nodeId) return;
    const visibleEdgeSummary = summarizeVisibleNodeEdges(node, nodes, links);
    const cacheKey = `${graph}:${nodeId}:${visibleEdgeSummary.visibleEdgeCount}:${JSON.stringify({
      counts: visibleEdgeSummary.visibleNeighborCounts,
      ids: visibleEdgeSummary.visibleNeighborIds,
    })}`;
    const cached = nodeSuggestionCacheRef.current.get(cacheKey);
    setFocusSelectedGraphNode(false);
    if (cached) {
      setNodeSuggestions({
        isLoading: false,
        isEnriching: false,
        isExpanding: false,
        error: "",
        node: cached.node || node,
        questions: cached.questions || [],
      });
      return;
    }

    const localQuestions = buildLocalNodeSuggestions(node, nodes, links);

    setNodeSuggestions({
      isLoading: localQuestions.length === 0,
      isEnriching: localQuestions.length > 0,
      isExpanding: false,
      error: "",
      node,
      questions: localQuestions,
    });

    try {
      const response = await fetchNodeQuestionSuggestions({
        nodeId,
        graph,
        visibleEdgeCount: visibleEdgeSummary.visibleEdgeCount,
        visibleNeighborCounts: visibleEdgeSummary.visibleNeighborCounts,
        visibleNeighborIds: visibleEdgeSummary.visibleNeighborIds,
      });
      const nextSuggestions = {
        isLoading: false,
        isEnriching: false,
        isExpanding: false,
        error: "",
        node: response.node || node,
        questions: response.suggested_questions?.length ? response.suggested_questions : localQuestions,
      };
      nodeSuggestionCacheRef.current.set(cacheKey, nextSuggestions);
      setNodeSuggestions(nextSuggestions);
    } catch (err) {
      setNodeSuggestions({
        isLoading: false,
        isEnriching: false,
        isExpanding: false,
        error: "",
        node,
        questions: localQuestions,
      });
    }
  }, [graph, links, nodes]);

  const runNodeSuggestedQuestion = (suggestedQuestion) => {
    const node = nodeSuggestions.node;
    const nodeId = node?._id || node?.id;
    if (!activeResult || !nodeId || isLoading) return;

    const focusedLinks = links.filter((link) => {
      const source = typeof link.source === "object" ? link.source.id || link.source._id : link.source || link._from;
      const target = typeof link.target === "object" ? link.target.id || link.target._id : link.target || link._to;
      return source === nodeId || target === nodeId;
    });
    const focusedResult = {
      ...activeResult,
      nodes: [node],
      links: focusedLinks,
      rows: [],
      columns: [],
    };

    setQueryMode("refine");
    setNodeSuggestions((currentSuggestions) => ({
      ...currentSuggestions,
      isExpanding: true,
      isEnriching: false,
      error: "",
    }));
    submitQuestion(
      suggestedQuestion,
      "refine",
      [
        {
          role: "assistant",
          content: `Selected graph node: ${getDisplayLabel(node)}`,
          result: focusedResult,
        },
      ],
      true,
      activeResult,
      { resetGraphView: true, focusNodeId: nodeId, focusScale: 1.12 },
    );
  };

  const refitGraphAfterUpdate = () => {
    const fit = () => graphRef.current?.fitToView();
    window.setTimeout(fit, 120);
    window.setTimeout(fit, 420);
  };

  const deleteSelectedNodeFromGraph = () => {
    const nodeId = nodeSuggestions.node?._id || nodeSuggestions.node?.id;
    if (!nodeId || activeResultIndex === null || !activeResult) return;

    const nextMessages = messages.map((message, index) => {
      if (index !== activeResultIndex || !message.result) return message;
      return {
        ...message,
        result: removeNodeFromResult(message.result, nodeId),
      };
    });

    setMessages(nextMessages);
    setNodeSuggestions({
      isLoading: false,
      isEnriching: false,
      isExpanding: false,
      error: "",
      node: null,
      questions: [],
    });
    refitGraphAfterUpdate();
  };

  const deleteGraphSelectionFromGraph = () => {
    if (!selectedGraphNodeIds.length || activeResultIndex === null || !activeResult) return;

    const nextMessages = messages.map((message, index) => {
      if (index !== activeResultIndex || !message.result) return message;
      return {
        ...message,
        result: removeNodesFromResult(message.result, selectedGraphNodeIds),
      };
    });

    setMessages(nextMessages);
    setSelectedGraphNodeIds([]);
    setNodeSuggestions({
      isLoading: false,
      isEnriching: false,
      isExpanding: false,
      error: "",
      node: null,
      questions: [],
    });
    refitGraphAfterUpdate();
  };

  const deleteSingletonNodesFromGraph = () => {
    if (!singletonGraphNodeIds.length || activeResultIndex === null || !activeResult) return;

    const singletonIds = new Set(singletonGraphNodeIds);
    const nextMessages = messages.map((message, index) => {
      if (index !== activeResultIndex || !message.result) return message;
      return {
        ...message,
        result: removeNodesFromResult(message.result, singletonGraphNodeIds),
      };
    });

    setMessages(nextMessages);
    setSelectedGraphNodeIds((ids) => ids.filter((id) => !singletonIds.has(id)));
    if (singletonIds.has(nodeSuggestions.node?._id || nodeSuggestions.node?.id)) {
      setNodeSuggestions({
        isLoading: false,
        isEnriching: false,
        isExpanding: false,
        error: "",
        node: null,
        questions: [],
      });
    }
    refitGraphAfterUpdate();
  };

  const showExamplesInChat = () => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        role: "assistant",
        content: "Example questions",
        isExampleQuestions: true,
      },
    ]);
  };

  const runExampleQuestion = (exampleQuestion) => {
    submitQuestion(exampleQuestion, "new", messages, false, null, { resetGraphView: true });
  };

  const renderExampleQuestions = (includeIntro = false, keyPrefix = "examples") => (
    <div className={includeIntro ? "ask-empty-state" : "ask-message assistant ask-example-message"}>
      {!includeIntro && <div className="ask-message-role">NLM-CKN</div>}
      <div className={includeIntro ? "" : "ask-message-content"}>
        {includeIntro
          ? "Ask about entities, collections, paths, relationships, genes, cell types, diseases, drugs, anatomy, datasets, or identifiers. The search will use the available CKN graphs automatically."
          : "Example questions"}
      </div>
      <div className="ask-suggestions ask-starter-suggestions" aria-label="Example questions">
        {includeIntro && <div className="ask-suggestions-title">Example questions</div>}
        <div className="ask-suggestion-list">
          {STARTER_QUESTION_EXAMPLES.map((exampleQuestion) => (
            <button
              key={`${keyPrefix}-${exampleQuestion}`}
              type="button"
              className="ask-suggestion-button"
              onClick={() => runExampleQuestion(exampleQuestion)}
              disabled={isLoading}
            >
              {exampleQuestion}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ask-more-examples-button"
          onClick={() => setShowMoreExamples((isOpen) => !isOpen)}
          aria-expanded={showMoreExamples}
        >
          {showMoreExamples ? "Fewer examples" : "More examples"}
        </button>
        {showMoreExamples && (
          <div className="ask-more-examples">
            <div className="ask-suggestions-title">More ways to explore the CKN</div>
            <div className="ask-suggestion-list">
              {MORE_QUESTION_EXAMPLES.map((exampleQuestion) => (
                <button
                  key={`${keyPrefix}-${exampleQuestion}`}
                  type="button"
                  className="ask-suggestion-button"
                  onClick={() => runExampleQuestion(exampleQuestion)}
                  disabled={isLoading}
                >
                  {exampleQuestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const openSaveGraphForm = () => {
    if (!activeResult || !nodes.length) return;
    setSaveGraphName((currentName) => currentName || `Ask graph ${new Date().toLocaleString()}`);
    setIsSaveGraphFormOpen(true);
    setSaveGraphMessage("");
    setSaveGraphDownload(null);
  };

  const saveAndDownloadCurrentGraph = () => {
    if (!activeResult || !nodes.length) return;

    const graphName = saveGraphName.trim();
    if (!graphName) return;

    const timestamp = new Date().toISOString();
    const graphData = buildSavableAskGraphData(nodes, links);
    const originNodeIds = nodes
      .map((node) => node._id || node.id)
      .filter(Boolean)
      .slice(0, 20);
    const savedGraph = {
      id: createGraphSaveId(),
      name: graphName,
      timestamp,
      originNodeIds,
      settings: buildAskGraphSettings(graph),
      graphData,
      source: "ask-question",
      askQuestion: messages[activeResultIndex - 1]?.role === "user" ? messages[activeResultIndex - 1].content : "",
      answer: messages[activeResultIndex]?.content || "",
      aql: activeResult.aql || "",
      graph,
    };

    dispatch(saveGraph(savedGraph));
    if (graphDownloadUrlRef.current) {
      URL.revokeObjectURL(graphDownloadUrlRef.current);
    }
    const downloadGraph = {
      ...graphData,
      settings: savedGraph.settings,
      originNodeIds,
      metadata: {
        source: "ask-question",
        name: graphName,
        timestamp,
        askQuestion: savedGraph.askQuestion,
        answer: savedGraph.answer,
        graph,
      },
    };
    const blob = new Blob([JSON.stringify(downloadGraph, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const filename = `${sanitizeFilenamePart(graphName)}.nlm-ckn-graph.json`;
    const url = URL.createObjectURL(blob);
    graphDownloadUrlRef.current = url;
    setSaveGraphDownload({ url, filename });
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setSaveGraphMessage(`Saved "${graphName}". If the file did not download automatically, use the link below.`);
    setIsSaveGraphFormOpen(false);
    setSaveGraphName("");
  };

  const renderNodeSuggestions = () => {
    if (!nodeSuggestions.node && !nodeSuggestions.isLoading && !nodeSuggestions.isExpanding && !nodeSuggestions.error) return null;

    return (
      <div className="ask-message assistant ask-node-suggestion-message">
        <div className="ask-message-role">NLM-CKN</div>
        <div className="ask-message-content">
          Node suggestions
          {nodeSuggestions.node ? ` for ${getDisplayLabel(nodeSuggestions.node)}` : ""}
        </div>
        {nodeSuggestions.isLoading && (
          <div className="ask-node-suggestions-status">
            <span className="ask-spinner" aria-hidden="true" />
            Inspecting graph neighbors
          </div>
        )}
        {nodeSuggestions.isExpanding && (
          <div className="ask-node-suggestions-status">
            <span className="ask-spinner" aria-hidden="true" />
            Expanding selected node
          </div>
        )}
        {nodeSuggestions.error && (
          <div className="ask-node-suggestions-error">{nodeSuggestions.error}</div>
        )}
        {nodeSuggestions.questions.length > 0 && (
          <div className="ask-suggestions" aria-label="Selected node suggested questions">
            <div className="ask-suggestions-title">
              Click a chip to refine the current graph. Delete removes the selected node from view.
            </div>
            <div className="ask-suggestion-list">
            {nodeSuggestions.questions.slice(0, 10).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="ask-suggestion-button"
                onClick={() => runNodeSuggestedQuestion(suggestion)}
                disabled={isLoading || nodeSuggestions.isExpanding}
              >
                {suggestion}
              </button>
            ))}
            </div>
          </div>
        )}
        {nodeSuggestions.isEnriching && (
          <div className="ask-node-suggestions-status">
            <span className="ask-spinner" aria-hidden="true" />
            Checking for more suggestions
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, nodeSuggestions, showMoreExamples]);

  useEffect(() => {
    return () => {
      if (graphDownloadUrlRef.current) URL.revokeObjectURL(graphDownloadUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const isTextInput =
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        target?.isContentEditable;
      if (isTextInput || viewMode !== "graph") return;

      if (event.code === "Space" && isGraphSelectMode && selectedGraphNodeIds.length) {
        event.preventDefault();
        toggleSelectedGraphNodeLocks();
        return;
      }

      if (!["Delete", "Backspace"].includes(event.key) || !nodeSuggestions.node) return;

      event.preventDefault();
      if (selectedGraphNodeIds.length) {
        deleteGraphSelectionFromGraph();
        return;
      }
      deleteSelectedNodeFromGraph();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeResult,
    activeResultIndex,
    isGraphSelectMode,
    messages,
    nodeSuggestions.node,
    selectedGraphNodeIds,
    toggleSelectedGraphNodeLocks,
    viewMode,
  ]);

  return (
    <main className="ask-page">
      <section className="ask-chat-panel">
        <div className="ask-page-header">
          <h1>Ask a Question</h1>
          <button
            type="button"
            className="ask-examples-icon-button"
            onClick={showExamplesInChat}
            aria-label="Click for examples"
            data-tooltip="click for examples"
          >
            <FontAwesomeIcon icon={faCircleQuestion} />
          </button>
        </div>

        <div className="ask-messages" aria-live="polite" ref={messagesRef}>
          {messages.length === 0 && renderExampleQuestions(true, "initial-examples")}
          {messages.map((message, index) => (
            message.isExampleQuestions ? (
              <div key={`${message.role}-${index}`}>{renderExampleQuestions(false, `examples-${index}`)}</div>
            ) : (
              <div key={`${message.role}-${index}`} className={`ask-message ${message.role}`}>
                <div className="ask-message-role">
                  {message.role === "user" ? "You" : "NLM-CKN"}
                </div>
                <div className="ask-message-content">{message.content}</div>
                {message.result && (
                  <>
                    <button
                      type="button"
                      className="ask-result-button"
                      onClick={() => showResult(index)}
                    >
                      View {message.result.rows?.length || 0} rows
                    </button>
                    {message.result.suggested_questions?.length > 0 && (
                      <div className="ask-suggestions" aria-label="Suggested follow-up questions">
                        <div className="ask-suggestions-title">Suggested next questions</div>
                        <div className="ask-suggestion-list">
                          {message.result.suggested_questions.map((suggestion) => (
                            <button
                              key={suggestion}
                              type="button"
                              className="ask-suggestion-button"
                              onClick={() => runSuggestedQuestion(suggestion, index)}
                              disabled={isLoading}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          ))}
          {renderNodeSuggestions()}
        </div>

        <form className="ask-input-row" onSubmit={handleSubmit}>
          <div className="ask-input-main">
            <div className="ask-mode-toggle" aria-label="Question mode">
              <button
                type="button"
                className={queryMode === "new" ? "active" : ""}
                onClick={handleNewSearchClick}
                disabled={isLoading}
              >
                New search
              </button>
              <button
                type="button"
                className={queryMode === "refine" ? "active" : ""}
                onClick={handleRefineClick}
                disabled={isLoading || !hasRefinableResult}
              >
                Refine current graph
              </button>
            </div>
            <div className="ask-input-box">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={handleQuestionKeyDown}
                placeholder={
                  queryMode === "refine" && hasRefinableResult
                    ? "Ask a follow-up that expands or filters the current graph"
                    : "Ask a new question about the knowledge graph"
                }
                rows={3}
                disabled={isLoading}
              />
              {isLoading && (
                <div className="ask-loading-indicator" role="status" aria-live="polite">
                  <span className="ask-spinner" aria-hidden="true" />
                  Searching
                </div>
              )}
            </div>
          </div>
        </form>
        {error && <div className="error-message">{error}</div>}
      </section>

      <section className="ask-results-panel">
        <div className="ask-results-header">
          <h2>Results</h2>
          <div className="ask-view-toggle" aria-label="Result view mode">
            <button
              type="button"
              className={viewMode === "table" ? "active" : ""}
              onClick={() => setViewMode("table")}
              disabled={!activeResult}
            >
              Table
            </button>
            <button
              type="button"
              className={viewMode === "graph" ? "active" : ""}
              onClick={() => setViewMode("graph")}
              disabled={!activeResult}
            >
              Graph
            </button>
          </div>
        </div>

        {!activeResult && <div className="ask-empty-state">Results will appear here.</div>}

        {activeResult && (
          <>
            <details className="ask-aql-details">
              <summary>{activeResult.recovered ? "Recovered AQL" : "Generated AQL"}</summary>
              {activeResult.recovered && (
                <p className="ask-recovery-note">
                  The first generated query returned no rows, so a schema-aware fallback query was
                  used.
                </p>
              )}
              {activeResult.expanded_graph_context && (
                <p className="ask-recovery-note">
                  The generated answer was expanded with source nodes and relationship edges so the
                  graph can show the association context.
                </p>
              )}
              {activeResult.graph_context_expanded && (
                <p className="ask-recovery-note">
                  The focused expansion was merged into the existing graph context.
                </p>
              )}
              {activeResult.graph_context_pruned && (
                <p className="ask-recovery-note">
                  Selected graph nodes were removed from this visualization context and the displayed
                  AQL was updated with an exclusion filter.
                </p>
              )}
              <pre>{activeResult.aql}</pre>
            </details>

            {viewMode === "table" && (
              <div className="ask-table-wrapper">
                <div className="ask-table-toolbar">
                  <button
                    type="button"
                    className="ask-secondary-action-button"
                    onClick={summarizeActiveResult}
                    disabled={isSummaryLoading || rows.length === 0}
                  >
                    {isSummaryLoading ? (
                      <>
                        <span className="ask-spinner" aria-hidden="true" />
                        Summarizing
                      </>
                    ) : (
                      "Experimental summary"
                    )}
                  </button>
                </div>
                <table className="ask-results-table">
                  <thead>
                    <tr>
                      {visibleColumns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        {visibleColumns.map((column) => (
                          <td key={`${rowIndex}-${column}`}>
                            {getNestedValue(row, column, labelById)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewMode === "graph" && (
              <div className={isGraphExpanded ? "ask-graph-expanded-shell" : "ask-graph-wrapper"}>
                {nodes.length > 0 ? (
                  <>
                    <div className="ask-graph-toolbar">
                      <div className="ask-graph-counts">
                        {nodes.length} nodes · {links.length} links
                        {selectedGraphNodeIds.length > 0 ? ` · ${selectedGraphNodeIds.length} selected` : ""}
                      </div>
                      {isGraphSelectMode && (
                        <div className="ask-graph-select-hint" role="status">
                          Delete removes items · Space locks/unlocks items
                        </div>
                      )}
                      <div className="ask-graph-actions">
                        <label className="ask-graph-search" htmlFor="ask-graph-search-input">
                          <span>Find</span>
                          <input
                            id="ask-graph-search-input"
                            type="search"
                            value={graphSearchTerm}
                            onChange={(event) => setGraphSearchTerm(event.target.value)}
                            placeholder="node label"
                            aria-label="Find node in graph"
                            disabled={!nodes.length}
                          />
                          {graphSearchStatus && (
                            <span className="ask-graph-search-status" title={graphSearchStatus}>
                              {graphSearchStatus}
                            </span>
                          )}
                        </label>
                        <button
                          type="button"
                          className="ask-graph-tool-button"
                          onClick={() => graphRef.current?.fitToView()}
                        >
                          Home
                        </button>
                        <button
                          type="button"
                          className={isGraphSelectMode ? "ask-graph-tool-button active" : "ask-graph-tool-button"}
                          onClick={() => {
                            setIsGraphSelectMode((value) => !value);
                            setSelectedGraphNodeIds([]);
                          }}
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          className="ask-graph-tool-button"
                          onClick={deleteGraphSelectionFromGraph}
                          disabled={!selectedGraphNodeIds.length}
                        >
                          Delete selected
                        </button>
                        <button
                          type="button"
                          className="ask-graph-tool-button"
                          onClick={deleteSingletonNodesFromGraph}
                          disabled={!singletonGraphNodeIds.length}
                        >
                          Delete singlets
                        </button>
                        <button
                          type="button"
                          className="ask-graph-icon-button"
                          onClick={openSaveGraphForm}
                          disabled={!nodes.length}
                          title="Save graph and download JSON"
                          aria-label="Save graph and download JSON"
                        >
                          <FontAwesomeIcon icon={faFloppyDisk} />
                        </button>
                        <button
                          type="button"
                          className="ask-graph-expand-button"
                          onClick={() => setIsGraphExpanded((value) => !value)}
                        >
                          {isGraphExpanded ? "Collapse graph" : "Expand graph"}
                        </button>
                      </div>
                    </div>
                    {isSaveGraphFormOpen && (
                      <form
                        className="ask-graph-save-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveAndDownloadCurrentGraph();
                        }}
                      >
                        <label htmlFor="ask-save-graph-name">Graph name</label>
                        <input
                          id="ask-save-graph-name"
                          type="text"
                          value={saveGraphName}
                          onChange={(event) => setSaveGraphName(event.target.value)}
                          autoFocus
                        />
                        <button type="submit" disabled={!saveGraphName.trim()}>
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsSaveGraphFormOpen(false);
                            setSaveGraphName("");
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    )}
                    {saveGraphMessage && (
                      <div className="ask-graph-save-message" role="status">
                        <span>{saveGraphMessage}</span>
                        {saveGraphDownload && (
                          <a href={saveGraphDownload.url} download={saveGraphDownload.filename}>
                            Download graph JSON
                          </a>
                        )}
                      </div>
                    )}
                    <div className="ask-graph-canvas">
                      <ResultGraph
                        ref={graphRef}
                        nodes={nodes}
                        links={links}
                        onNodeClick={handleGraphNodeClick}
                        selectedNodeId={
                          graphSearchMatchId || nodeSuggestions.node?._id || nodeSuggestions.node?.id
                        }
                        selectedNodeIds={selectedGraphNodeIds}
                        selectionMode={isGraphSelectMode}
                        onSelectionChange={setSelectedGraphNodeIds}
                        lockedNodePositions={lockedGraphNodePositions}
                        onToggleNodeLock={toggleGraphNodeLock}
                        layoutVersion={graphLayoutVersion}
                        focusNodeId={
                          focusSelectedGraphNode
                            ? nodeSuggestions.node?._id || nodeSuggestions.node?.id
                            : null
                        }
                        deEmphasizedCollections={deEmphasizedCollections}
                      />
                    </div>
                    <GraphLegend
                      nodes={nodes}
                      deEmphasizedCollections={deEmphasizedCollections}
                      onToggleCollection={toggleGraphCollectionFocus}
                    />
                  </>
                ) : (
                  <div className="ask-empty-state">
                    This result did not include graph-shaped documents.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
};

export default AskQuestionPage;
