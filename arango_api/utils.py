import re
from itertools import chain
from rest_framework.response import Response
from rest_framework import status

from arango_api.db import (
    db_ontologies,
    GRAPH_NAME_ONTOLOGIES,
    GRAPH_NAME_PHENOTYPES,
    db_phenotypes,
)


def get_collections(collection_type, graph="ontologies"):
    # Filter for document collections
    if graph == "phenotypes":
        all_collections = db_phenotypes.collections()
    else:
        all_collections = db_ontologies.collections()
    collections = [
        collection
        for collection in all_collections
        if collection["type"] == collection_type
        and not collection["name"].startswith("_")
    ]
    return [collection["name"] for collection in collections]


def get_all_by_collection(coll, graph):
    if graph == "phenotypes":
        collection = db_phenotypes.collection(coll)
    else:
        collection = db_ontologies.collection(coll)

    if not collection:
        print(f"Collection '{coll}' not found.")
    return collection.all()


def get_by_id(coll, id):
    return db_ontologies.collection(coll).get(id)


def get_edges_by_id(edge_coll, dr, item_coll, item_id):
    return db_ontologies.collection(edge_coll).find({dr: f"{item_coll}/{item_id}"})


def get_graph(
    node_ids,
    depth,
    edge_direction,
    allowed_collections,
    graph,
    edge_filters,
):
    """
    Constructs and executes a graph traversal AQL query.

    Args:
        node_ids (list): A list of starting node _id strings.
        depth (int): The maximum depth for the graph traversal.
        edge_direction (str): 'INBOUND', 'OUTBOUND', or 'ANY'.
        allowed_collections (list): A list of vertex collection names to include.
        graph (str): The name of the graph to traverse.
        edge_filters (dict): A dictionary for filtering edges.
            Example: {'Label': ['IS_A'], 'Source': ['X']}

    Returns:
        dict: A dictionary with start node IDs as keys, each containing
              'nodes' and 'links' from the traversal.
    """
    # Input validation and sanitation.
    if edge_direction not in ["INBOUND", "OUTBOUND", "ANY"]:
        raise ValueError("edge_direction must be 'INBOUND', 'OUTBOUND', or 'ANY'")

    # Select Database.
    if graph == "phenotypes":
        graph_name = GRAPH_NAME_PHENOTYPES
        db = db_phenotypes
    else:
        graph_name = GRAPH_NAME_ONTOLOGIES
        db = db_ontologies

    bind_vars = {
        "node_ids": node_ids,
        "depth": depth,
        "graph": graph_name,
        "allowed_collections": allowed_collections,
    }

    # Build the filtering and pruning logic
    filter_string = ""
    prune_string = ""
    if edge_filters:
        positive_conditions = []
        negative_conditions = []

        for key, values in edge_filters.items():
            if values:
                bind_key = f"filter_value_{re.sub(r'[^a-zA-Z0-9_]', '', key)}"

                # Positive condition for FILTER: Attribute must exist and match.
                pos_cond = (
                    f"(e.`{key}` != null AND ("
                    f"(IS_STRING(e.`{key}`) AND e.`{key}` IN @{bind_key}) OR "
                    f"(IS_ARRAY(e.`{key}`) AND LENGTH(INTERSECTION(e.`{key}`, @{bind_key})) > 0)"
                    f"))"
                )
                positive_conditions.append(pos_cond)

                # Negative condition for PRUNE: Attribute must exist AND NOT match.
                # Edges missing the attribute will evaluate to false and not be pruned.
                neg_cond = (
                    f"(e.`{key}` != null AND NOT ("
                    f"(IS_STRING(e.`{key}`) AND e.`{key}` IN @{bind_key}) OR "
                    f"(IS_ARRAY(e.`{key}`) AND LENGTH(INTERSECTION(e.`{key}`, @{bind_key})) > 0)"
                    f"))"
                )
                negative_conditions.append(neg_cond)

                bind_vars[bind_key] = values

        if positive_conditions:
            # All positive conditions must be true to keep an edge.
            filter_string = f"FILTER {' AND '.join(positive_conditions)}"

            # If any negative condition is true, the edge is invalid and pruned.
            prune_string = f"PRUNE {' OR '.join(negative_conditions)}"

    # Construct the final AQL query
    aql_query = f"""
     FOR start_node_id IN @node_ids
         LET start_node_doc = DOCUMENT(start_node_id)

         LET traversal = (
             FOR v, e IN 1..@depth {edge_direction} start_node_id GRAPH @graph

                 {prune_string}

                 OPTIONS {{ vertexCollections: @allowed_collections }}

                 {filter_string}

                 RETURN DISTINCT {{ v: v, e: e }}
         )

         LET all_nodes = UNION_DISTINCT(
             traversal[*].v,
             [start_node_doc]
         )

         LET all_links = UNIQUE(traversal[*].e)

         RETURN {{
             "start_node_id": start_node_id,
             "data": {{
                 "nodes": all_nodes,
                 "links": all_links
             }}
         }}
     """

    # Execute the query
    cursor = db.aql.execute(aql_query, bind_vars=bind_vars)

    # Format the result
    results = {item["start_node_id"]: item["data"] for item in cursor}

    return results


def get_graph_advanced(
    node_ids,
    advanced_settings,
    graph,
):
    """
    Orchestrates multiple graph traversals based on per-node settings.

    This function iterates through the settings for each specified node,
    calling the `get_graph` worker function for each one and aggregating
    the individual results into a single response object.

    Args:
        node_ids (list): A list of starting node _id strings.
        advanced_settings (dict): A dictionary where keys are node_ids and
                                  values are settings objects for that node.
        graph (str): The name of the graph to traverse (a global setting).

    Returns:
        dict: A dictionary aggregating the results from all individual
              traversals, keyed by the start node ID.
    """
    aggregated_results = {}

    # Iterate over each node ID that has specific settings defined.
    for node_id, settings in advanced_settings.items():
        if node_id not in node_ids:
            continue  # Only process nodes explicitly requested.

        # Extract the specific settings for the current node from the payload.
        depth = settings.get("depth", 2)
        edge_direction = settings.get("edgeDirection", "ANY")
        allowed_collections = settings.get("allowedCollections", [])
        edge_filters = settings.get("edgeFilters", {})

        # Call the original get_graph function with the settings for this single node.
        result_for_node = get_graph(
            node_ids=[node_id],
            depth=depth,
            edge_direction=edge_direction,
            allowed_collections=allowed_collections,
            graph=graph,
            edge_filters=edge_filters,
        )

        # Merge the result into the final aggregated dictionary.
        if result_for_node:
            aggregated_results.update(result_for_node)

    return aggregated_results


def get_shortest_paths(node_ids, edge_direction="ANY"):
    """
    Finds all shortest paths between every unique pair of nodes in a list
    and returns a single, de-duplicated graph of the results.

    Args:
        node_ids (list): A list of 2 or more node _id strings.
        edge_direction (str, optional): Traversal direction.
            Defaults to 'ANY'. Can be 'INBOUND' or 'OUTBOUND'.

    Returns:
        dict: A dictionary with a flat list of unique 'nodes' and 'links'
              comprising all the found shortest paths.
    """
    # Validate input.
    if not isinstance(node_ids, list) or len(node_ids) < 2:
        return {"nodes": [], "links": []}

    if edge_direction not in ["INBOUND", "OUTBOUND", "ANY"]:
        raise ValueError("edge_direction must be 'INBOUND', 'OUTBOUND', or 'ANY'")

    # Prepare bind variables.
    bind_vars = {"node_ids": node_ids, "graph": GRAPH_NAME_ONTOLOGIES}

    # Construct AQL query.
    aql_query = f"""
        // Find all paths between all unique pairs.
        LET all_paths = (
            FOR start_node IN @node_ids
                FOR end_node IN @node_ids
                    // Process each unique pair only once.
                    FILTER start_node < end_node

                    // Find all shortest paths for the current pair.
                    LET p = FIRST(
                        FOR path IN {edge_direction} ALL_SHORTEST_PATHS start_node TO end_node GRAPH @graph
                        RETURN path
                    )

                    // Ignore pairs with no connecting path found.
                    FILTER p != null 
                    RETURN p
        )

        // Aggregate and de-duplicate all vertices from all found paths.
        LET all_nodes = UNIQUE(FLATTEN(all_paths[*].vertices))

        // Aggregate and de-duplicate all edges from all found paths.
        LET all_links = UNIQUE(FLATTEN(all_paths[*].edges))

        // Return flat graph object.
        RETURN {{
            "nodes": all_nodes,
            "links": all_links
        }}
        """

    # Execute the query.
    cursor = db_ontologies.aql.execute(aql_query, bind_vars=bind_vars)

    # The query returns a single document.
    result = cursor.next()

    return result


def get_all():
    collections = get_collections("document")

    # Create the base query
    union_queries = []

    for collection in collections:
        union_queries.append(
            f"""
            FOR doc IN {collection["name"]}
                RETURN doc
        """
        )

    # Combine all queries into a single AQL statement
    final_query = "RETURN UNION(" + ", ".join(union_queries) + ")"

    # Execute the query
    try:
        cursor = db_ontologies.aql.execute(final_query)
        results = list(cursor)  # Collect the results
    except Exception as e:
        print(f"Error executing query: {e}")
        results = []

    flat_results = list(chain.from_iterable(results))

    return flat_results


def search_by_term(search_term, search_fields, db):
    db_name_lower = db.lower()

    # Construct query from parameters
    query_beginning = f"""
            LET lower_search_term = LOWER(@search_term)
            LET sortedDocs = (
                FOR doc IN indexed
                    SEARCH
                    """

    # Levenshtein match with no substitutions, boosted
    levenshtein_string = " ANALYZER("
    for field in search_fields:
        levenshtein_string += (
            f"BOOST(LEVENSHTEIN_MATCH(doc.`{field}`, lower_search_term, 0), 100.0) OR "
        )
    levenshtein_string_0 = levenshtein_string[0:-3] + ', "text_en_no_stem")'

    # Levenshtein match with substitutions, boosted less
    levenshtein_string = " OR ANALYZER("
    for field in search_fields:
        levenshtein_string += (
            f"BOOST(LEVENSHTEIN_MATCH(doc.`{field}`, lower_search_term, 1), 5.0) OR "
        )
    levenshtein_string_1 = levenshtein_string[0:-3] + ', "text_en_no_stem")'

    # Exact match, boosted highest to appear first
    exact_match_string = " OR "
    for field in search_fields:
        exact_match_string += (
            f'BOOST(ANALYZER(doc.`{field}` == @search_term, "identity"), 1000.0) OR '
        )
    exact_match_string = exact_match_string[0:-3]

    # n-gram search for phrases
    n_gram_string = " OR "
    for field in search_fields:
        n_gram_string += f'ANALYZER(doc.`{field}` LIKE CONCAT("%", CONCAT(@search_term, "%")), "n-gram") OR '
    n_gram_string = n_gram_string[0:-3]

    query_end = """
                    SORT BM25(doc) DESC
                    RETURN doc
            )

            RETURN sortedDocs
            """
    query = (
        query_beginning
        + levenshtein_string_0
        + levenshtein_string_1
        + exact_match_string
        + n_gram_string
        + query_end
    )

    bind_vars = {"search_term": search_term}

    try:
        # db selection
        db_connection = (
            db_phenotypes if db_name_lower == "phenotypes" else db_ontologies
        )
        cursor = db_connection.aql.execute(query, bind_vars=bind_vars)
        results = cursor.next()

    except StopIteration:
        print("Query executed successfully but returned no results.")
        results = {}
    except Exception as e:
        import traceback

        print(f"Error executing query: {e}")
        traceback.print_exc()
        results = {}

    return results


def run_aql_query(query):
    # Execute the query
    try:
        cursor = db_ontologies.aql.execute(query)
        results = list(cursor)[
            0
        ]  # Collect the results - one element should be guaranteed
    except Exception as e:
        print(f"Error executing query: {e}")
        results = []

    return results


def get_phenotypes_sunburst(ignored_parent_id):
    """
    API endpoint for fetching the *entire* phenotype sunburst structure
    in one query, starting from NCBITaxon roots and traversing the specific path:
    NCBITaxon -> UBERON (filtered) -> CL -> GS -> (MONDO or (PR -> CHEMBL)).
    Uses hardcoded collection names and inline traversal options.

    NOTE: This ignores the parent_id and always loads the full structure.
          It may be slow or memory-intensive on larger datasets.
    """
    db = db_phenotypes
    graph_name = GRAPH_NAME_PHENOTYPES

    initial_root_ids = ["NCBITaxon/9606"]
    uberon_terms = [
        "UBERON/0002048",  # lung
        "UBERON/0000966",  # retina
        "UBERON/0000955",  # brain
    ]
    # Artificial root ID for the response
    graph_root_id = "root_phenotypes_full"

    # Collection and Edge Names
    EDGE_NC_UB = "UBERON-NCBITaxon"
    EDGE_UB_CL = "UBERON-CL"
    EDGE_CL_UB = "CL-UBERON"
    EDGE_CL_GS = "CL-GS"
    EDGE_GS_MO = "GS-MONDO"
    EDGE_GS_PR = "GS-PR"
    EDGE_PR_CH = "CHEMBL-PR"

    VC_NCBITAXON = "NCBITaxon"
    VC_UBERON = "UBERON"
    VC_CL = "CL"
    VC_GS = "GS"
    VC_MONDO = "MONDO"
    VC_CHEMBL = "CHEMBL"
    VC_PR = "PR"

    # Construct the edge collection list string for AQL
    allowed_edges_aql_string = (
        f'["{EDGE_NC_UB}", "{EDGE_UB_CL}", "{EDGE_CL_UB}", "{EDGE_CL_GS}", '
        f'"{EDGE_GS_MO}", "{EDGE_GS_PR}", "{EDGE_PR_CH}"]'
    )

    if db is None:
        return Response(
            {"error": "Database connection not available."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # AQL Query with hardcoded names and inline options
    query_full_structure = f"""
                LET ncbi_level_nodes = (
                    FOR ncbi_id IN @initial_root_ids
                        LET ncbi_node = DOCUMENT(ncbi_id)
                        FILTER ncbi_node != null AND IS_SAME_COLLECTION("{VC_NCBITAXON}", ncbi_node)

                        LET uberon_level_nodes = (
                            FOR uberon_node, edge1 IN 1..1 INBOUND ncbi_node._id GRAPH @graph_name
                                OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                FILTER IS_SAME_COLLECTION("{VC_UBERON}", uberon_node)
                                FILTER uberon_node._id IN @uberon_terms

                                LET cl_level_nodes = (
                                    FOR cl_node, edge2 IN 1..1 INBOUND uberon_node._id GRAPH @graph_name
                                        OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                        FILTER IS_SAME_COLLECTION("{VC_CL}", cl_node)

                                        LET gs_level_nodes = (
                                            FOR gs_node, edge3 IN 1..1 OUTBOUND cl_node._id GRAPH @graph_name
                                                OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                                FILTER IS_SAME_COLLECTION("{VC_GS}", gs_node)

                                                LET gs_children_processed = (
                                                    FOR gs_child_node, edge_gs_to_child IN 1..1 OUTBOUND gs_node._id GRAPH @graph_name
                                                        OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                                        FILTER IS_SAME_COLLECTION("{VC_MONDO}", gs_child_node) OR 
                                                               IS_SAME_COLLECTION("{VC_PR}", gs_child_node)

                                                        LET processed_node_details = (
                                                            IS_SAME_COLLECTION("{VC_MONDO}", gs_child_node)
                                                            ? // gs_child_node is MONDO
                                                                // MERGE MONDO node data (as leaf in this path)
                                                                MERGE(gs_child_node, {{ value: 1, _hasChildren: false, children: [] }})
                                                            : // gs_child_node is PR
                                                                (
                                                                    NOOPT((
                                                                        LET pr_node_intermediate = gs_child_node // This is the PR node
                                                                        LET chembl_children_of_pr = (
                                                                            FOR chembl_node, edge_pr_to_chembl IN 1..1 INBOUND pr_node_intermediate._id GRAPH @graph_name
                                                                                OPTIONS {{ edgeCollections: {allowed_edges_aql_string} }}
                                                                                FILTER IS_SAME_COLLECTION("{VC_CHEMBL}", chembl_node)
                                                                                AND IS_SAME_COLLECTION("{EDGE_PR_CH}", edge_pr_to_chembl)
                                                                            // MERGE CHEMBL node data
                                                                            RETURN MERGE(chembl_node, {{ value: 1, _hasChildren: false, children: [] }})
                                                                        ) // End CHEMBL children of PR nodes
                                                                        // MERGE PR node data
                                                                        RETURN MERGE(pr_node_intermediate, {{ 
                                                                            value: 1, 
                                                                            _hasChildren: COUNT(chembl_children_of_pr) > 0, 
                                                                            children: chembl_children_of_pr 
                                                                        }})
                                                                    ))
                                                                )[0] // Get the single document from the subquery's result array
                                                        )
                                                        RETURN processed_node_details
                                                ) // End gs_children_processed nodes

                                                // MERGE GS node data
                                                RETURN MERGE(gs_node, {{ value: 1, _hasChildren: COUNT(gs_children_processed) > 0, children: gs_children_processed }})
                                        ) // End GS nodes

                                        // MERGE CL node data
                                        RETURN MERGE(cl_node, {{ value: 1, _hasChildren: COUNT(gs_level_nodes) > 0, children: gs_level_nodes }})
                                ) // End CL nodes

                                // MERGE UBERON node data
                                RETURN MERGE(uberon_node, {{ value: 1, _hasChildren: COUNT(cl_level_nodes) > 0, children: cl_level_nodes }})
                        ) // End UBERON nodes

                        // MERGE NCBITaxon node data
                        RETURN MERGE(ncbi_node, {{ value: 1, _hasChildren: COUNT(uberon_level_nodes) > 0, children: uberon_level_nodes }})
                ) // End NCBITaxon nodes

                // Create the final top-level root object
                LET root_node = {{
                    _id: @graph_root_id,
                    label: "NLM Cell Knowledge Network", 
                    _hasChildren: COUNT(ncbi_level_nodes) > 0,
                    children: ncbi_level_nodes
                }}

                RETURN root_node
            """

    bind_vars = {
        "graph_name": graph_name,
        "initial_root_ids": initial_root_ids,
        "uberon_terms": uberon_terms,
        "graph_root_id": graph_root_id,
    }

    try:
        cursor = db.aql.execute(query_full_structure, bind_vars=bind_vars, stream=False)
        result_list = list(cursor)

        if not result_list:
            print("WARN: Full structure query returned no results.")
            empty_root = {
                "_id": graph_root_id,
                "label": "Phenotype Associations - No Data",
                "_hasChildren": False,
                "children": [],
            }
            # Return the Response object directly
            return Response(
                data=empty_root,
                status=status.HTTP_200_OK,
                content_type="application/json",
            )

        full_structure = result_list[0]
        # Return the Response object directly
        return Response(
            data=full_structure,
            status=status.HTTP_200_OK,
            content_type="application/json",
        )

    except Exception as e:
        print(f"ERROR: AQL Execution failed for full structure load: {e}")
        error_content = {"error": "Failed to fetch full phenotype structure."}
        if hasattr(e, "response") and hasattr(e.response, "text"):
            error_content["db_error"] = e.response.text
        return Response(
            data=error_content,
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content_type="application/json",
        )


def get_ontologies_sunburst(parent_id):
    """
    API endpoint for fetching sunburst data, supporting initial load (L0+L1)
    and loading children + grandchildren (L N+1, L N+2) on demand.
    """
    db = db_ontologies
    graph_name = GRAPH_NAME_ONTOLOGIES
    label_filter = "subClassOf"
    initial_root_ids = [
        "CL/0000000",
        "GO/0008150",  # biological_process
        "GO/0003674",  # molecular_function
        "GO/0005575",  # cellular_component
        "PATO/0000001",
        "MONDO/0000001",
        "UBERON/0000000",
    ]

    if db is None:
        return Response(
            {"error": "Database connection not available."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if parent_id:
        # AQL Query: Fetches C nodes and their G children
        query_children_grandchildren = """
            LET start_node_id = @parent_id // P

            // Find direct children (Level N+1, Nodes C)
            FOR child_node, edge1 IN 1..1 INBOUND start_node_id GRAPH @graph_name
                FILTER edge1.label == @label_filter

                // For each child_node (C), find its children (Level N+2, Nodes G)
                LET grandchildren = (
                    FOR grandchild_node, edge2 IN 1..1 INBOUND child_node._id GRAPH @graph_name
                        FILTER edge2.label == @label_filter

                        // Check if grandchild (G) has children (Level N+3)
                        LET grandchild_has_children = COUNT(
                            FOR great_grandchild, edge3 IN 1..1 INBOUND grandchild_node._id GRAPH @graph_name
                                FILTER edge3.label == @label_filter
                                LIMIT 1 RETURN 1
                        ) > 0

                        RETURN { // Format grandchild (G)
                            _id: grandchild_node._id,
                            label: grandchild_node.label || grandchild_node.name || grandchild_node._key,
                            value: 1,
                            _hasChildren: grandchild_has_children,
                            children: null // Level N+3 not loaded here
                        }
                ) // Collect grandchildren (G) into an array for this child (C)

                // Check if the child_node (C) itself has children (G) loaded above
                LET child_has_children = COUNT(grandchildren) > 0

                RETURN { // Format child (C)
                    _id: child_node._id,
                    label: child_node.label || child_node.name || child_node._key,
                    value: 1,
                    _hasChildren: child_has_children, // Does C have children G?
                    children: grandchildren // Attach the array of grandchildren (G)
                }
        """
        bind_vars = {
            "parent_id": parent_id,
            "graph_name": graph_name,
            "label_filter": label_filter,
        }

        try:
            cursor = db.aql.execute(query_children_grandchildren, bind_vars=bind_vars)
            results = list(cursor)

            return Response(results, status=status.HTTP_200_OK)

        except Exception as e:
            return Response(
                {
                    "error": f"Failed to fetch nested children data for {parent_id} with error: {e}"
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    else:
        # Fetch Initial Roots and their Children
        initial_nodes_with_children = []
        graph_root_id = "root_nlm"  # Unique ID for the artificial root

        # Loop through predefined starting nodes
        for node_id in initial_root_ids:

            # AQL Query: Fetches L0 node and its direct L1 children
            query_initial = """
                LET start_node_id = @node_id // This is L0

                // Get the L0 node details
                LET start_node_doc = DOCUMENT(start_node_id)
                FILTER start_node_doc != null // Ensure L0 exists

                // Check if L0 has children (L1)
                LET start_node_has_children = COUNT(
                    FOR c1, e1 IN 1..1 INBOUND start_node_id GRAPH @graph_name
                        FILTER e1.label == @label_filter
                        LIMIT 1 RETURN 1
                ) > 0

                // Get L1 children
                LET children_level1 = (
                    FOR child1_node, edge1 IN 1..1 INBOUND start_node_id GRAPH @graph_name
                        FILTER edge1.label == @label_filter

                        // Check if each L1 child has children (L2)
                        LET child1_has_children = COUNT(
                            FOR c2, e2 IN 1..1 INBOUND child1_node._id GRAPH @graph_name
                                FILTER e2.label == @label_filter
                                LIMIT 1 RETURN 1
                        ) > 0

                        RETURN { // Format Level 1 node
                            _id: child1_node._id,
                            label: child1_node.label || child1_node.name || child1_node._key,
                            value: 1,
                            _hasChildren: child1_has_children, // Does L1 have L2 children?
                            children: null // L2 not loaded here
                        }
                ) // Collect L1 children into an array

                // Return the formatted L0 node with its L1 children attached
                RETURN { // Format Level 0 node
                    _id: start_node_doc._id,
                    label: start_node_doc.label || start_node_doc.name || start_node_doc._key,
                    value: 1, 
                    _hasChildren: start_node_has_children, 
                    children: children_level1 
                }
            """
            bind_vars = {
                "node_id": node_id,
                "graph_name": graph_name,
                "label_filter": label_filter,
            }

            try:
                cursor = db.aql.execute(query_initial, bind_vars=bind_vars)
                # Expect only one result document per initial node_id
                node_data_list = list(cursor)
                if node_data_list:
                    node_data = node_data_list[0]
                    initial_nodes_with_children.append(node_data)

            except Exception as e:
                print(f"ERROR: AQL Execution failed for initial node {node_id}: {e}")

        # Create the final top-level root node structure
        graph_root = {
            "_id": graph_root_id,
            "label": "NLM Cell Knowledge Network",
            "_hasChildren": len(initial_nodes_with_children) > 0,
            "children": initial_nodes_with_children,  # Assign the list of L0 nodes
        }

        return Response(graph_root, status=status.HTTP_200_OK)


def get_collection_info(node_id, edge_collections):
    """Gets the edge collection based on the node ID prefix."""
    try:
        collection_type = node_id.split("/")[0]
        edge_col = edge_collections.get(collection_type)
        if not edge_col:
            return None
        return edge_col
    except (IndexError, AttributeError):
        # Handle cases where node_id is None or not in the expected format
        return None


def format_node_data(node_doc, has_children):
    """Helper to format node data consistently."""
    return {
        "_id": node_doc["_id"],
        "label": node_doc.get("label") or node_doc.get("name") or node_doc["_key"],
        "value": 1,
        "_hasChildren": has_children,
        "children": None,  # Always start with null children unless fetching them explicitly
    }


def query_edge_filter_options(fields_to_query):
    """
    Queries database for unique values for specified edge attributes.
    Returns dictionary of results or raises an exception on error.
    """
    if not fields_to_query:
        return {}

    # Query only larger db to get all filter options
    db = db_ontologies

    try:
        # Get list of all edge collection names for the specified graph.
        edge_collections = get_collections("edge")

        if not edge_collections:
            return {}

        # AQL Query Construction

        # Create list of subquery strings, one for each edge collection.
        union_subqueries = [
            f" (FOR doc IN `{coll}` RETURN doc) " for coll in edge_collections
        ]

        # Join subqueries into a single AQL UNION clause.
        all_edges_clause = "UNION(" + ", ".join(union_subqueries) + ")"

        # Construct final query using an f-string.
        # The `all_edges_clause` is injected directly into the query text.
        # This lets AQL operate on a pre-aggregated stream of documents.
        query = f"""
            LET all_edges = ({all_edges_clause})

            LET options_per_field = (
                FOR field_name IN @fields_to_query
                    LET values = (
                        FOR edge IN all_edges
                            FILTER HAS(edge, field_name) AND edge[field_name] != null AND edge[field_name] != ""
                            COLLECT value = edge[field_name]
                            RETURN value
                    )
                    RETURN {{ [field_name]: UNIQUE(values) }}
            )

            RETURN MERGE(options_per_field)
        """

        # Query Execution

        bind_vars = {
            "fields_to_query": fields_to_query,
        }

        cursor = db.aql.execute(query, bind_vars=bind_vars)
        results = list(cursor)[0]

        return results

    except Exception as e:
        print(f"Error executing edge_filter_options query: {e}")
        # Re-raise exception to be handled by the view layer.
        raise


def get_documents(document_ids, graph_name):
    """
    Fetches full document details for a list of document IDs, which may
    belong to different collections.
    """
    # Input Validation
    if not isinstance(document_ids, list) or not document_ids:
        return []

    # Group document keys by their collection name
    collections_to_keys = {}
    for doc_id in document_ids:
        try:
            # The _id format is "collection/key"
            collection_name, key = doc_id.split("/")
            # Use setdefault to initialize a list if the key is new, then append.
            collections_to_keys.setdefault(collection_name, []).append(key)
        except ValueError:
            # Handle potentially malformed IDs
            print(f"Warning: Skipping malformed document ID: {doc_id}")
            continue

    # If no valid IDs were found after parsing
    if not collections_to_keys:
        return []

    # Select the correct database connection
    try:
        db_name_lower = graph_name.lower()
        db_connection = (
            db_phenotypes if db_name_lower == "phenotypes" else db_ontologies
        )
    except Exception as e:
        print(f"Error selecting database connection: {e}")
        return []

    # Execute one query per collection and aggregate results
    all_results = []

    # Fetch all from single collection
    query = """
        FOR doc IN @@collection
            FILTER doc._key IN @keys
            RETURN doc
    """

    for collection, keys in collections_to_keys.items():
        bind_vars = {"@collection": collection, "keys": keys}
        try:
            cursor = db_connection.aql.execute(query, bind_vars=bind_vars)
            # Get all results
            results_for_collection = [doc for doc in cursor]
            all_results.extend(results_for_collection)

        except Exception as e:
            print(f"Error executing query for collection '{collection}': {e}")
            continue

    print(all_results)
    return all_results
