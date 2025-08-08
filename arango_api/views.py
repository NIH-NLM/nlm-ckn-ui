from django.http import JsonResponse, HttpResponseNotFound
from rest_framework.decorators import api_view
from rest_framework import status

from arango_api import utils


@api_view(["POST"])
def list_collection_names(request):
    graph = request.data.get("graph")
    collection_names = utils.get_document_collections(graph)
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
    search_results = utils.search_by_term(search_term, graph)
    return JsonResponse(search_results, safe=False)


@api_view(["POST"])
def get_graph(request):
    node_ids = request.data.get("node_ids")
    depth = request.data.get("depth")
    edge_direction = request.data.get("edge_direction")
    allowed_collections = request.data.get("allowed_collections")
    node_limit = request.data.get("node_limit", 100)
    graph = request.data.get("graph")
    edge_filters = request.data.get("edge_filters", {})

    search_results = utils.get_graph(
        node_ids,
        depth,
        edge_direction,
        allowed_collections,
        node_limit,
        graph,
        edge_filters,
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
        ##TODO: Handle errors
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
        graph = data.get("graph")
        fields_to_query = data.get("fields")

        # Get data.
        query_results = utils.query_edge_filter_options(graph, fields_to_query)

        # Create Response.
        return JsonResponse(query_results, status=status.HTTP_200_OK)

    except ValueError as e:
        # Handle specific input errors raised by the utility.
        return JsonResponse({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        # Handle all other errors.
        return JsonResponse(
            {"error": "An internal server error occurred."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
