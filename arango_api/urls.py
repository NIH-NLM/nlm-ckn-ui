"""
URL configuration for the ArangoDB API.
"""
from django.urls import path

from arango_api.views import (
    CollectionListView,
    CollectionDetailView,
    ObjectDetailView,
    RelatedEdgesView,
    GraphTraversalView,
    ShortestPathsView,
    SearchView,
    GetAllView,
    AQLQueryView,
    SunburstView,
    EdgeFilterOptionsView,
    DocumentsView,
    WorkflowPresetsView,
)

urlpatterns = [
    # Collection endpoints
    path("collections/", CollectionListView.as_view(), name="list_collection_names"),
    path(
        "collection/<str:coll>/",
        CollectionDetailView.as_view(),
        name="list_by_collection",
    ),
    path(
        "collection/<str:coll>/<str:pk>/", ObjectDetailView.as_view(), name="get_object"
    ),
    # Graph traversal endpoints
    path("graph/", GraphTraversalView.as_view(), name="get_graph"),
    path("shortest_paths/", ShortestPathsView.as_view(), name="get_shortest_paths"),
    # Edge endpoints
    path(
        "edges/<str:edge_coll>/<str:dr>/<str:item_coll>/<str:pk>/",
        RelatedEdgesView.as_view(),
        name="get_related_edges",
    ),
    # Search endpoints
    path("search/", SearchView.as_view(), name="get_search_items"),
    path("get_all/", GetAllView.as_view(), name="get_all"),
    path("aql/", AQLQueryView.as_view(), name="run_aql_query"),
    # Visualization endpoints
    path("sunburst/", SunburstView.as_view(), name="get_sunburst"),
    # Document endpoints
    path("document/details", DocumentsView.as_view(), name="document-details"),
    path(
        "edge_filter_options/",
        EdgeFilterOptionsView.as_view(),
        name="get_edge_filter_options",
    ),
    # Workflow presets
    path("workflow_presets/", WorkflowPresetsView.as_view(), name="workflow_presets"),
]
