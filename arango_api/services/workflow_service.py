"""
Service for executing multi-phase workflow queries.

Translates the frontend executePhase orchestration logic into a server-side
service, enabling MCP server / agent integration without a browser client.

Reuses existing services:
    - graph_service.traverse_graph_advanced() for graph traversal
    - collection_service.get_all_by_collection() for collection origins
"""
import copy
import logging

from arango_api.services import collection_service, graph_service

logger = logging.getLogger(__name__)

DEFAULT_GRAPH_TYPE = "ontologies"
MAX_COLLECTION_ORIGIN_NODES = 500


def execute_workflow(phases, graph=DEFAULT_GRAPH_TYPE):
    """
    Execute a multi-phase workflow in order, chaining results between phases.

    Args:
        phases (list): List of phase dicts, each containing query configuration.
        graph (str): Default graph type ("ontologies" or "phenotypes").

    Returns:
        dict: {"phases": {phase_id: {nodes, links}}, "errors": {phase_id: str}}
    """
    phase_results = {}
    errors = {}

    # Build a lookup of origin node IDs actually used per phase (for originFilter)
    phase_origin_ids = {}

    for i, phase in enumerate(phases):
        phase_id = phase["id"]
        try:
            result, origin_ids = _execute_phase(
                phase, phases, phase_results, phase_origin_ids, graph
            )
            phase_results[phase_id] = result
            phase_origin_ids[phase_id] = origin_ids
        except Exception as e:
            logger.exception("Error executing phase '%s'", phase_id)
            errors[phase_id] = str(e)
            # Mark remaining downstream phases as skipped
            for remaining in phases[i + 1 :]:
                errors[remaining.get("id", f"phase-{i+1}")] = (
                    "Skipped due to earlier phase failure"
                )
            break  # Downstream phases depend on prior results

    return {"phases": phase_results, "errors": errors}


def execute_preset(preset_id, origin_overrides=None, graph=DEFAULT_GRAPH_TYPE):
    """
    Look up a preset by ID and execute its phases.

    Args:
        preset_id (str): The preset ID from WORKFLOW_PRESETS.
        origin_overrides (dict, optional): {phase_id: [node_ids]} to replace
            originNodeIds for specific phases.
        graph (str): Default graph type.

    Returns:
        dict: Same as execute_workflow().

    Raises:
        ValueError: If preset_id is not found.
    """
    from arango_api.workflow_presets import WORKFLOW_PRESETS

    preset = None
    for p in WORKFLOW_PRESETS:
        if p["id"] == preset_id:
            preset = p
            break

    if preset is None:
        raise ValueError(f"Preset '{preset_id}' not found.")

    phases = copy.deepcopy(preset["phases"])

    if origin_overrides:
        for phase in phases:
            if phase["id"] in origin_overrides:
                phase["originNodeIds"] = origin_overrides[phase["id"]]

    return execute_workflow(phases, graph)


def _execute_phase(phase, all_phases, phase_results, phase_origin_ids, graph):
    """
    Execute a single phase, resolving origins from prior results if needed.

    Returns:
        tuple: (result_dict, origin_node_ids) where result_dict has {nodes, links}
            and origin_node_ids is the list of IDs actually used as origins.

    Raises:
        ValueError: On invalid configuration or missing dependencies.
    """
    origin_source = phase.get("originSource", "manual")
    settings = phase.get("settings", {})
    phase_graph = settings.get("graphType") or graph

    # --- Handle multiplePhases combine (no API call) ---
    if origin_source == "multiplePhases":
        return _execute_combine_phase(
            phase, all_phases, phase_results, phase_origin_ids, settings
        )

    # --- Resolve origin node IDs ---
    origin_node_ids = _resolve_origin_node_ids(
        phase, all_phases, phase_results, phase_origin_ids, phase_graph
    )

    if not origin_node_ids:
        raise ValueError("No origin nodes specified for this phase.")

    # --- Build per-node advanced settings ---
    per_node_settings = phase.get("perNodeSettings", {})
    advanced_settings = {}

    for node_id in origin_node_ids:
        node_overrides = per_node_settings.get(node_id, {})
        advanced_settings[node_id] = {
            "depth": node_overrides.get("depth", settings.get("depth", 2)),
            "edgeDirection": node_overrides.get(
                "edgeDirection", settings.get("edgeDirection", "ANY")
            ),
            "allowedCollections": node_overrides.get(
                "allowedCollections", settings.get("allowedCollections", [])
            ),
            "edgeFilters": node_overrides.get(
                "edgeFilters", settings.get("edgeFilters", {})
            ),
        }

    # --- Call graph traversal ---
    include_inter_node_edges = settings.get("includeInterNodeEdges", True)

    raw_data = graph_service.traverse_graph_advanced(
        node_ids=origin_node_ids,
        advanced_settings=advanced_settings,
        graph=phase_graph,
        include_inter_node_edges=include_inter_node_edges,
    )

    # --- Apply set operation ---
    graphs_array = [
        {"nodes": data.get("nodes", []), "links": data.get("links", [])}
        for data in raw_data.values()
    ]

    set_operation = settings.get("setOperation", "Union")
    merged_result = _perform_set_operation(graphs_array, set_operation)

    # --- Apply returnCollections filter ---
    return_collections = settings.get("returnCollections", [])
    if return_collections:
        merged_result = _apply_return_collections_filter(
            merged_result, return_collections
        )

    return merged_result, origin_node_ids


def _execute_combine_phase(
    phase, all_phases, phase_results, phase_origin_ids, settings
):
    """Handle multiplePhases origin: combine results from multiple prior phases."""
    source_phase_ids = phase.get("previousPhaseIds", [])
    if len(source_phase_ids) < 2:
        raise ValueError("Combine phase requires at least 2 source phases.")

    origin_filter = phase.get("originFilter", "all")
    source_graphs = []

    for src_id in source_phase_ids:
        src_result = phase_results.get(src_id)
        if not src_result or not src_result.get("nodes"):
            raise ValueError(f"Source phase '{src_id}' has no results.")

        src_origin_ids = phase_origin_ids.get(src_id, [])
        filtered_ids = _filter_nodes_for_next_phase(
            src_result["nodes"], origin_filter, src_origin_ids
        )
        filtered_id_set = set(filtered_ids)

        filtered_nodes = [
            n for n in src_result["nodes"] if n.get("_id") in filtered_id_set
        ]
        filtered_links = [
            link
            for link in (src_result.get("links") or [])
            if link.get("_from") in filtered_id_set
            and link.get("_to") in filtered_id_set
        ]
        source_graphs.append({"nodes": filtered_nodes, "links": filtered_links})

    combine_op = phase.get("phaseCombineOperation", "Intersection")
    combined_result = _perform_set_operation(source_graphs, combine_op)

    return_collections = settings.get("returnCollections", [])
    if return_collections:
        combined_result = _apply_return_collections_filter(
            combined_result, return_collections
        )

    return combined_result, source_phase_ids


def _resolve_origin_node_ids(
    phase, all_phases, phase_results, phase_origin_ids, graph
):
    """Resolve origin node IDs based on the phase's originSource type."""
    origin_source = phase.get("originSource", "manual")

    if origin_source == "collection":
        collection_name = phase.get("originCollection")
        if not collection_name:
            raise ValueError("originCollection is required for collection origin.")
        docs = collection_service.get_all_by_collection(collection_name, graph)
        node_ids = [doc["_id"] for doc in docs if doc.get("_id")]
        if not node_ids:
            raise ValueError(
                f'No nodes found in collection "{collection_name}".'
            )
        if len(node_ids) > MAX_COLLECTION_ORIGIN_NODES:
            logger.warning(
                "Collection '%s' has %d nodes, truncating to %d",
                collection_name,
                len(node_ids),
                MAX_COLLECTION_ORIGIN_NODES,
            )
            node_ids = node_ids[:MAX_COLLECTION_ORIGIN_NODES]
        return node_ids

    if origin_source == "previousPhase":
        prev_phase_id = phase.get("previousPhaseId")
        if not prev_phase_id:
            raise ValueError("previousPhaseId is required for previousPhase origin.")
        prev_result = phase_results.get(prev_phase_id)
        if not prev_result or not prev_result.get("nodes"):
            raise ValueError("Previous phase has no results.")
        prev_origin_ids = phase_origin_ids.get(prev_phase_id, [])
        origin_filter = phase.get("originFilter", "all")
        return _filter_nodes_for_next_phase(
            prev_result["nodes"], origin_filter, prev_origin_ids
        )

    # manual (default)
    return phase.get("originNodeIds", [])


def _filter_nodes_for_next_phase(nodes, filter_type, origin_node_ids=None):
    """
    Filter nodes to determine which become origins for the next phase.

    Args:
        nodes (list): Node dicts from a phase result.
        filter_type (str): "all", "leafNodes", "nonOriginNodes", or "originNodes".
            "nonOriginNodes" (preferred) and "leafNodes" (backward-compatible alias)
            both return nodes that were NOT in the origin set -- i.e. non-origin
            nodes discovered during traversal, not true graph leaves.
        origin_node_ids (list): The origin node IDs used in the source phase.

    Returns:
        list: Filtered node ID strings.
    """
    if not nodes:
        return []

    origin_node_ids = origin_node_ids or []

    if filter_type in ("leafNodes", "nonOriginNodes"):
        origin_set = set(origin_node_ids)
        return [n["_id"] for n in nodes if n.get("_id") and n["_id"] not in origin_set]

    if filter_type == "originNodes":
        result_ids = {n["_id"] for n in nodes if n.get("_id")}
        return [nid for nid in origin_node_ids if nid in result_ids]

    # "all" and any other value
    return [n["_id"] for n in nodes if n.get("_id")]


def _perform_set_operation(graphs, operation):
    """
    Apply a set operation across multiple graph results.

    Args:
        graphs (list): List of {nodes: [], links: []} dicts.
        operation (str): "Union", "Intersection", or "Symmetric Difference".

    Returns:
        dict: Merged {nodes, links}.
    """
    safe_graphs = [g for g in (graphs or []) if g]

    if not safe_graphs:
        return {"nodes": [], "links": []}
    if len(safe_graphs) == 1:
        return safe_graphs[0]

    op = (operation or "Union").lower()

    # Count node frequency across graphs
    node_frequency = {}  # node_id -> {"node": dict, "count": int}
    for graph in safe_graphs:
        for node in (graph.get("nodes") or []):
            node_id = node.get("_id") or node.get("id")
            if not node_id:
                continue
            if node_id in node_frequency:
                node_frequency[node_id]["count"] += 1
            else:
                node_frequency[node_id] = {"node": node, "count": 1}

    # Select nodes based on operation
    if op == "intersection":
        required = len(safe_graphs)
        final_nodes = [
            entry["node"]
            for entry in node_frequency.values()
            if entry["count"] == required
        ]
    elif op in ("symmetric difference", "symmetric_difference", "xor"):
        final_nodes = [
            entry["node"]
            for entry in node_frequency.values()
            if entry["count"] == 1
        ]
    else:
        # Union
        final_nodes = [entry["node"] for entry in node_frequency.values()]

    final_node_ids = {
        n.get("_id") or n.get("id")
        for n in final_nodes
        if (n.get("_id") or n.get("id"))
    }

    # Collect unique links
    unique_links = {}
    for graph in safe_graphs:
        for link in (graph.get("links") or []):
            if not link:
                continue
            key = (
                link.get("_id")
                or link.get("_key")
                or f"{link.get('_from', '?')}->{link.get('_to', '?')}|{link.get('Label', '')}"
            )
            if key not in unique_links:
                unique_links[key] = link

    # Keep only links with both endpoints in final node set
    filtered_links = [
        link
        for link in unique_links.values()
        if link.get("_from") in final_node_ids and link.get("_to") in final_node_ids
    ]

    return {"nodes": final_nodes, "links": filtered_links}


def _apply_return_collections_filter(result, return_collections):
    """
    Filter nodes by collection prefix, prune orphaned links.

    Args:
        result (dict): {nodes: [], links: []}.
        return_collections (list): Collection name prefixes to keep (e.g. ["CL", "GS"]).

    Returns:
        dict: Filtered {nodes, links}.
    """
    filtered_nodes = [
        node
        for node in result.get("nodes", [])
        if node.get("_id", "").split("/")[0] in return_collections
    ]

    remaining_ids = {n["_id"] for n in filtered_nodes if n.get("_id")}

    filtered_links = [
        link
        for link in result.get("links", [])
        if link.get("_from") in remaining_ids and link.get("_to") in remaining_ids
    ]

    return {"nodes": filtered_nodes, "links": filtered_links}
