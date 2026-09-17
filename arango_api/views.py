"""
Django REST Framework views for the ArangoDB API.

Views handle HTTP concerns: parsing requests, calling services, returning responses.
Business logic lives in the services/ package.

Each view:
1. Validates request data using a serializer
2. Calls the appropriate service function
3. Returns a Response object

See: https://www.django-rest-framework.org/api-guide/views/
"""

import logging

from django.conf import settings
from django.http import HttpResponseNotFound
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from arango_api.serializers import (
    GraphRequestSerializer,
    GraphTraversalSerializer,
    AdvancedGraphTraversalSerializer,
    NeighborCollectionsSerializer,
    ShortestPathsSerializer,
    EdgesBetweenSerializer,
    SearchRequestSerializer,
    AQLQuerySerializer,
    SunburstRequestSerializer,
    EdgeFilterOptionsSerializer,
    DocumentsRequestSerializer,
    WorkflowExecuteSerializer,
)
from arango_api.services import collection_service, graph_service, search_service
from arango_api.services import document_service, sunburst_service, workflow_service
from arango_api.services import label_service, version_service
from arango_api.services.sunburst_service import SunburstServiceError

logger = logging.getLogger(__name__)


class CollectionListView(APIView):
    """List all collection names."""

    def post(self, request):
        serializer = GraphRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        collection_names = collection_service.get_collections(
            "document", serializer.validated_data.get("graph", "ontologies")
        )
        return Response(collection_names)


class CollectionDetailView(APIView):
    """List all documents in a collection."""

    def post(self, request, coll):
        serializer = GraphRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        objects = collection_service.get_all_by_collection(
            coll, serializer.validated_data.get("graph", "ontologies")
        )
        return Response(list(objects))


class CollectionCountView(APIView):
    """Return the document count for a collection."""

    def post(self, request, coll):
        serializer = GraphRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        count = collection_service.get_collection_count(
            coll, serializer.validated_data.get("graph", "ontologies")
        )
        return Response({"count": count})


class ObjectDetailView(APIView):
    """Get a single object by collection and ID."""

    def get(self, request, coll, pk):
        try:
            item = collection_service.get_by_id(coll, pk)
            if item:
                return Response(item)
            else:
                return HttpResponseNotFound("Object not found")
        except Exception as e:
            logger.exception("Error fetching object %s/%s", coll, pk)
            return Response(
                {"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class RelatedEdgesView(APIView):
    """Get edges related to a specific object."""

    def get(self, request, edge_coll, dr, item_coll, pk):
        edges = collection_service.get_edges_by_id(edge_coll, dr, item_coll, pk)
        return Response(list(edges))


class GraphTraversalView(APIView):
    """
    Fetch graph data via traversal.

    Dispatches to standard or advanced traversal based on payload structure.
    """

    def post(self, request):
        include_inter_node_edges = request.data.get("include_inter_node_edges", True)

        if "advanced_settings" in request.data:
            serializer = AdvancedGraphTraversalSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data

            results = graph_service.traverse_graph_advanced(
                node_ids=data["node_ids"],
                advanced_settings=data["advanced_settings"],
                graph=data.get("graph", "ontologies"),
                include_inter_node_edges=data.get("include_inter_node_edges", True),
            )
        else:
            serializer = GraphTraversalSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data

            results = graph_service.traverse_graph(
                node_ids=data["node_ids"],
                depth=data["depth"],
                edge_direction=data["edge_direction"],
                allowed_collections=data["allowed_collections"],
                graph=data.get("graph", "ontologies"),
                edge_filters=data.get("edge_filters"),
                exclude_edge_filters=data.get("exclude_edge_filters"),
                terminal_collections=data.get("terminal_collections") or [],
                include_inter_node_edges=data.get("include_inter_node_edges", True),
            )

        return Response(results)


class NeighborCollectionsView(APIView):
    """Return the distinct vertex collection names reachable in one hop from a node."""

    def post(self, request):
        serializer = NeighborCollectionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        collections = graph_service.get_neighbor_collections(
            node_id=data["node_id"],
            graph=data.get("graph", "ontologies"),
            edge_direction=data.get("edge_direction", "ANY"),
        )
        return Response({"collections": collections})


class ShortestPathsView(APIView):
    """Find shortest paths between nodes."""

    def post(self, request):
        serializer = ShortestPathsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        results = graph_service.find_shortest_paths(
            node_ids=data["node_ids"],
            edge_direction=data.get("edge_direction", "ANY"),
        )
        return Response(results)


class ConnectingPathsView(APIView):
    """Find paths connecting origin nodes through the graph."""

    def post(self, request):
        data = request.data
        node_ids = data.get("node_ids", [])
        if not isinstance(node_ids, list) or len(node_ids) < 2:
            return Response(
                {"error": "node_ids must contain at least 2 node IDs."},
                status=400,
            )
        results = graph_service.find_connecting_paths(
            node_ids=node_ids,
            graph=data.get("graph", "phenotypes"),
            allowed_collections=data.get("allowed_collections", []),
            edge_filters=data.get("edge_filters", {}),
            exclude_edge_filters=data.get("exclude_edge_filters", {}),
            path_limit=int(data.get("path_limit", 100)),
            max_depth=int(data["max_depth"]) if data.get("max_depth") else None,
        )
        return Response(results)


class EdgesBetweenView(APIView):
    """Find all edges between a given set of nodes."""

    def post(self, request):
        serializer = EdgesBetweenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        edges = graph_service.find_inter_node_edges(
            node_ids=data["node_ids"],
            graph=data.get("graph", "ontologies"),
            edge_filters=data.get("edge_filters") or {},
            exclude_edge_filters=data.get("exclude_edge_filters") or {},
        )
        return Response(edges)


class SearchView(APIView):
    """Search for items by term."""

    def post(self, request):
        serializer = SearchRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        results = search_service.search_by_term(
            search_term=data["search_term"],
            search_fields=data["search_fields"],
            graph=data.get("db", "ontologies"),
        )
        return Response(results)


class GetAllView(APIView):
    """Get all documents from all collections."""

    def get(self, request):
        results = search_service.get_all_documents()
        return Response(results)


class AQLQueryView(APIView):
    """Execute a raw AQL query."""

    def post(self, request):
        serializer = AQLQuerySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            results = search_service.run_aql_query(serializer.validated_data["query"])
            return Response(results)
        except Exception as e:
            logger.exception("Error running AQL query")
            return Response(
                {"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class SunburstView(APIView):
    """Get sunburst visualization data."""

    def post(self, request):
        serializer = SunburstRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        graph = data.get("graph", "ontologies")
        parent_id = data.get("parent_id")

        try:
            if graph == "phenotypes":
                results = sunburst_service.get_phenotypes_sunburst(parent_id)
            else:
                results = sunburst_service.get_ontologies_sunburst(parent_id)

            return Response(results)

        except SunburstServiceError as e:
            error_response = {"error": str(e)}
            if e.db_error:
                error_response["db_error"] = e.db_error
            return Response(
                error_response, status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class EdgeFilterOptionsView(APIView):
    """Get unique values for edge attributes."""

    def post(self, request):
        serializer = EdgeFilterOptionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            results = document_service.get_edge_filter_options(
                serializer.validated_data["fields"],
                graph=serializer.validated_data["graph"],
            )
            return Response(results)
        except ValueError as e:
            logger.warning("Invalid input for edge_filter_options: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Error fetching edge filter options")
            return Response(
                {"error": "An internal server error occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class DocumentsView(APIView):
    """Get document details by IDs."""

    def post(self, request):
        serializer = DocumentsRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        results = document_service.get_documents(
            document_ids=data["document_ids"],
            graph_name=data.get("db", "ontologies"),
        )
        return Response(results)


class WorkflowExecuteView(APIView):
    """Execute a multi-phase workflow or a preset."""

    def post(self, request):
        serializer = WorkflowExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        graph = data.get("graph", "ontologies")

        try:
            if data.get("preset_id"):
                result = workflow_service.execute_preset(
                    preset_id=data["preset_id"],
                    origin_overrides=data.get("origin_overrides"),
                    graph=graph,
                )
            else:
                result = workflow_service.execute_workflow(
                    phases=data["phases"],
                    graph=graph,
                )

            if result.get("errors"):
                # HTTP 207 Multi-Status: some phases succeeded while others
                # failed, so neither 200 nor 4xx/5xx fully describes the outcome.
                return Response(result, status=207)
            return Response(result)

        except ValueError as e:
            logger.warning("Workflow execution error: %s", e)
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Unexpected error executing workflow")
            return Response(
                {"error": "An internal server error occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class WorkflowPresetsView(APIView):
    """Return pre-built workflow presets (query-only schema).

    Each preset carries an `unknown_labels` list naming the edge predicates it
    filters on that are absent from the loaded dataset — the signal that an ETL
    rename has left the preset stale. Empty when the preset is valid, and also
    when the dataset could not be read (fail open).
    """

    def get(self, request):
        from arango_api.services import schema_guard
        from arango_api.workflow_presets import (
            PRESET_CATEGORIES,
            PRESET_SECTIONS,
            WORKFLOW_PRESETS,
        )

        labels_by_graph = {
            graph: schema_guard.get_dataset_labels(graph)
            for graph in ("ontologies", "phenotypes")
        }
        # Copy rather than mutate: WORKFLOW_PRESETS is module-level state shared
        # across requests.
        presets = [
            {
                **preset,
                "unknown_labels": schema_guard.find_unknown_labels(
                    preset, labels_by_graph
                ),
            }
            for preset in WORKFLOW_PRESETS
        ]

        return Response(
            {
                "presets": presets,
                "categories": PRESET_CATEGORIES,
                "sections": PRESET_SECTIONS,
            }
        )


class CellSetLabelLookupsView(APIView):
    """Return the citations and anatomical structure names cell set labels read."""

    def get(self, request):
        return Response(label_service.get_cell_set_label_lookups())


class VersionView(APIView):
    """Return the backend, dataset, and pinned dataset versions.

    ``backend_version`` is the backend image tag (the ``UI_VERSION`` setting,
    injected at build time). It is reported for diagnosis but not displayed: the
    UI version users see is baked into the frontend bundle, which deploys
    independently of this image.

    The ETL version is read from the ``ckn_meta`` marker stamped into ArangoDB by
    whichever script restored the data, so it describes the dataset actually
    loaded. ``pinned_etl_version`` is the committed ``ETL_VERSION`` file — the
    dataset this checkout intends to run — which lets the UI flag drift between
    the two.

    Answers even when ArangoDB is unreachable: the marker read collapses to
    "unknown" rather than raising. Deliberately unauthenticated.
    """

    permission_classes = []

    def get(self, request):
        try:
            pinned_etl_version = (
                settings.BASE_DIR / "ETL_VERSION"
            ).read_text().strip() or "unknown"
        except OSError:
            pinned_etl_version = "unknown"

        return Response(
            {
                "backend_version": settings.UI_VERSION,
                "etl_version": version_service.get_loaded_etl_version(),
                "pinned_etl_version": pinned_etl_version,
            }
        )
