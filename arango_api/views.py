import logging

from django.http import HttpResponseNotFound, JsonResponse
from rest_framework import status
from rest_framework.decorators import api_view

from arango_api import utils

logger = logging.getLogger(__name__)


@api_view(["POST"])
def list_collection_names(request):
    graph = request.data.get("graph")
    collection_names = utils.get_collections("document", graph)
    return JsonResponse(collection_names, safe=False)


@api_view(["POST"])
def list_by_collection(request, coll):
    graph = request.data.get("graph")
    objects = utils.get_all_by_collection(coll, graph)
    return JsonResponse(list(objects), safe=False)


@api_view(["GET", "PUT", "DELETE"])
def get_object(request, coll, pk):
    try:
        item = utils.get_by_id(coll, pk)
        if item:
            return JsonResponse(item, safe=False)
        else:
            return HttpResponseNotFound("Object not found")
    except Exception as e:
        logger.exception("Error fetching object %s/%s", coll, pk)
        return JsonResponse({"error": str(e)}, status=500)


@api_view(["GET"])
def get_related_edges(request, edge_coll, dr, item_coll, pk):
    # TODO: Document arguments
    edges = utils.get_edges_by_id(edge_coll, dr, item_coll, pk)
    return JsonResponse(list(edges), safe=False)


@api_view(["POST"])
def get_search_items(request):
    graph = request.data.get("db")
    search_term = request.data.get("search_term")
    search_fields = request.data.get("search_fields")
    search_results = utils.search_by_term(search_term, search_fields, graph)
    return JsonResponse(search_results, safe=False)


@api_view(["POST"])
def get_graph(request):
    """
    API endpoint to fetch graph data.

    Acts as a dispatcher:
    - If 'advanced_settings' is in the payload, it routes to the advanced
      orchestrator which handles per-node settings.
    - Otherwise, it performs a standard traversal with global settings.
    """
    # Extract the inter-node edges parameter (default to True)
    include_inter_node_edges = request.data.get("include_inter_node_edges", True)
    
    # Route request based on payload structure
    if "advanced_settings" in request.data:
        # Handle advanced per-node settings request.
        node_ids = request.data.get("node_ids")
        advanced_settings = request.data.get("advanced_settings")
        graph = request.data.get("graph")  # Graph type is a global setting.

        # Call the new orchestrator utility function.
        search_results = utils.get_graph_advanced(
            node_ids,
            advanced_settings,
            graph,
            include_inter_node_edges,
        )
        return JsonResponse(search_results, safe=False)
    else:
        # Handle standard request with global settings
        node_ids = request.data.get("node_ids")
        depth = request.data.get("depth")
        edge_direction = request.data.get("edge_direction")
        allowed_collections = request.data.get("allowed_collections")
        graph = request.data.get("graph")
        edge_filters = request.data.get("edge_filters", None)

        search_results = utils.get_graph(
            node_ids,
            depth,
            edge_direction,
            allowed_collections,
            graph,
            edge_filters,
            include_inter_node_edges,
        )
        return JsonResponse(search_results, safe=False)


@api_view(["POST"])
def get_shortest_paths(request):
    node_ids = request.data.get("node_ids")
    edge_direction = request.data.get("edge_direction")

    search_results = utils.get_shortest_paths(
        node_ids,
        edge_direction,
    )
    return JsonResponse(search_results, safe=False)


@api_view(["GET"])
def get_all(request):
    search_results = utils.get_all()
    return JsonResponse(search_results, safe=False)


@api_view(["POST"])
def run_aql_query(request):
    # Extract the AQL query from the request body
    query = request.data.get("query")
    if not query:
        return JsonResponse({"error": "No query provided"}, status=400)

    # Run the AQL query
    try:
        search_results = utils.run_aql_query(query)
        return JsonResponse(search_results, safe=False)
    except Exception as e:
        logger.exception("Error running AQL query")
        return JsonResponse({"error": str(e)}, status=500)


@api_view(["POST"])
def get_sunburst(request):
    parent_id = request.data.get("parent_id", None)
    graph = request.data.get("graph")

    if graph == "phenotypes":
        return utils.get_phenotypes_sunburst(parent_id)
    else:
        return utils.get_ontologies_sunburst(parent_id)


@api_view(["POST"])
def get_edge_filter_options(request):
    """
    Handles POST request to fetch unique values for specified edge attributes.
    Constructs an HTTP response from data returned by utility function.
    """
    try:
        data = request.data
        fields_to_query = data.get("fields")

        # Get data.
        query_results = utils.query_edge_filter_options(fields_to_query)

        # Create Response.
        return JsonResponse(query_results, status=status.HTTP_200_OK)

    except ValueError as e:
        # Handle specific input errors raised by the utility.
        logger.warning("Invalid input for edge_filter_options: %s", e)
        return JsonResponse({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        # Handle all other errors.
        logger.exception("Error fetching edge filter options")
        return JsonResponse(
            {"error": "An internal server error occurred."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["POST"])
def get_documents(request):
    graph = request.data.get("db")
    document_ids = request.data.get("document_ids")
    results = utils.get_documents(document_ids, graph)
    return JsonResponse(results, safe=False)
