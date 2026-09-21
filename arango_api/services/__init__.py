"""
Services package - business logic layer.

Services contain the core logic for interacting with ArangoDB. They are called
by views and return Python objects (dicts, lists), not HTTP responses.

Modules:
    base: Shared utilities (database selection)
    collection_service: Operations on collections
    document_service: Fetching documents by ID, edge filter options
    graph_service: Graph traversal queries
    hierarchy_service: The CL hierarchy rendered by the Browse page
    label_service: Names cell set labels read by reference
    search_service: Full-text search, AQL queries
    workflow_service: Multi-phase workflow orchestration
"""
