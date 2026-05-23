"""
Natural-language question answering over ArangoDB.

The service converts user questions into read-only AQL, executes the query, and
normalizes the result for table and graph views. If OpenAI is not configured, it
falls back to a broad text search so the UI remains useful in local development.
"""

import json
import logging
import re
import time
from collections import OrderedDict

import requests
from django.conf import settings
from rest_framework import serializers

from arango_api.serializers import AQLQuerySerializer
from arango_api.services.base import get_db_and_graph

logger = logging.getLogger(__name__)

DEFAULT_SEARCH_FIELDS = [
    "id",
    "label",
    "name",
    "title",
    "description",
    "definition",
    "symbol",
    "synonyms",
]

MAX_SCHEMA_COLLECTIONS = 40
MAX_SAMPLE_FIELDS = 20
DEFAULT_LIMIT = 50
NODE_SUGGESTION_CACHE_LIMIT = 512
NODE_SUGGESTION_CACHE = OrderedDict()
NODE_SUGGESTION_TIME_BUDGET_SECONDS = 4.5
NODE_SUGGESTION_REACHABILITY_LIMIT = 25
UMLS_SEARCH_URL = "https://uts-ws.nlm.nih.gov/rest/search/current"
UMLS_COLLECTION_SABS = {
    "MONDO": ["MONDO", "MSH", "SNOMEDCT_US", "OMIM"],
    "CL": ["CL", "SNOMEDCT_US"],
    "UBERON": ["UBERON", "FMA", "SNOMEDCT_US"],
    "GS": ["HGNC", "NCBI"],
    "CHEMBL": ["RXNORM", "MSH", "SNOMEDCT_US"],
}

CKN_SCHEMA_CONCEPTS = {
    "CellType": {
        "collection": "CL",
        "description": "cell type ontology terms",
        "aliases": ["cell", "cells", "cell type", "cell types"],
    },
    "CellSet": {
        "collection": "CS",
        "description": "sets or clusters of cells from datasets",
        "aliases": ["cell set", "cell sets", "cluster", "clusters"],
    },
    "CellSetDataset": {
        "collection": "CSD",
        "description": "single-cell datasets and CELLxGENE datasets",
        "aliases": ["dataset", "datasets", "cellxgene dataset"],
    },
    "Gene": {
        "collection": "GS",
        "description": "genes and gene symbols",
        "aliases": ["gene", "genes", "marker", "markers"],
    },
    "Disease": {
        "collection": "MONDO",
        "description": "diseases and conditions",
        "aliases": ["disease", "diseases", "condition", "conditions"],
    },
    "Drug": {
        "collection": "CHEMBL",
        "description": "drugs and drug products",
        "aliases": ["drug", "drugs", "compound", "compounds"],
    },
    "Protein": {
        "collection": "PR",
        "description": "proteins",
        "aliases": ["protein", "proteins", "target", "targets"],
    },
    "AnatomicalStructure": {
        "collection": "UBERON",
        "description": "anatomical structures, organs, and tissues",
        "aliases": ["anatomy", "anatomical structure", "anatomical structures", "organ", "organs", "tissue", "tissues"],
    },
    "BiologicalProcess": {
        "collection": "GO",
        "description": "Gene Ontology biological processes and related functions",
        "aliases": ["biological process", "biological processes", "process", "processes", "function", "functions"],
    },
    "ClinicalTrial": {
        "collection": "NCT",
        "description": "clinical trials",
        "aliases": ["clinical trial", "clinical trials", "trial", "trials", "study", "studies"],
    },
    "Publication": {
        "collection": "PUB",
        "description": "publications",
        "aliases": ["publication", "publications", "paper", "papers", "article", "articles", "pubmed"],
    },
    "Phenotype": {
        "collection": "HP",
        "description": "Human Phenotype Ontology phenotypes",
        "aliases": ["phenotype", "phenotypes", "symptom", "symptoms", "sign", "signs"],
    },
    "Taxon": {
        "collection": "NCBITaxon",
        "description": "species and taxa",
        "aliases": ["taxon", "taxa", "species", "organism", "organisms"],
    },
    "PhenotypicQuality": {
        "collection": "PATO",
        "description": "phenotypic qualities",
        "aliases": ["quality", "qualities", "phenotypic quality", "phenotypic qualities"],
    },
    "ChemicalEntity": {
        "collection": "CHEBI",
        "description": "chemical entities",
        "aliases": ["chemical", "chemicals", "chemical entity", "chemical entities", "chebi"],
    },
    "HumanDevelopmentStage": {
        "collection": "HsapDv",
        "description": "human developmental stages",
        "aliases": ["development stage", "developmental stage", "human developmental stage", "age stage"],
    },
    "BiomarkerCombination": {
        "collection": "BMC",
        "description": "biomarker combinations and marker sets",
        "aliases": ["biomarker", "biomarkers", "marker set", "marker sets", "biomarker combination"],
    },
    "BinaryGeneSet": {
        "collection": "BGS",
        "description": "binary gene sets",
        "aliases": ["binary gene set", "binary gene sets", "gene set", "gene sets"],
    },
}

CKN_SCHEMA_ASSOCIATIONS = [
    {
        "name": "CellSetExpressesGene",
        "subject": "CellSet",
        "predicate": "expresses",
        "object": "Gene",
        "edge_hint": "CS-GS or CL-GS depending on loaded graph",
    },
    {
        "name": "CellTypeHasExemplarDataCellSetDataset",
        "subject": "CellType",
        "predicate": "has exemplar data",
        "object": "CellSetDataset",
        "edge_hint": "CL-CSD",
    },
    {
        "name": "CellSetComposedPrimarilyOfCellType",
        "subject": "CellSet",
        "predicate": "composed primarily of",
        "object": "CellType",
        "edge_hint": "CS-CL",
    },
    {
        "name": "CellSetDerivesFromAnatomicalStructure",
        "subject": "CellSet",
        "predicate": "derives from",
        "object": "AnatomicalStructure",
        "edge_hint": "CS-UBERON",
    },
    {
        "name": "CellSetDatasetIsAboutAnatomicalStructure",
        "subject": "CellSetDataset",
        "predicate": "is about",
        "object": "AnatomicalStructure",
        "edge_hint": "CSD/CS to UBERON edges when available",
    },
    {
        "name": "GeneAssociatedWithDisease",
        "subject": "Gene",
        "predicate": "genetic basis for condition / associated with disease",
        "object": "Disease",
        "edge_hint": "GS-MONDO",
    },
    {
        "name": "DrugTreatsDisease",
        "subject": "Drug",
        "predicate": "treats disease",
        "object": "Disease",
        "edge_hint": "CHEMBL-MONDO when available",
    },
    {
        "name": "DrugMolecularlyInteractsWithProteinOrGene",
        "subject": "Drug",
        "predicate": "molecularly interacts with",
        "object": "Protein/Gene",
        "edge_hint": "CHEMBL-PR or CHEMBL-GS",
    },
    {
        "name": "ProteinEncodedByOrLinkedToGene",
        "subject": "Protein",
        "predicate": "related to gene",
        "object": "Gene",
        "edge_hint": "GS-PR / PR-GS style edges when available",
    },
    {
        "name": "DrugEvaluatedInClinicalTrial",
        "subject": "Drug",
        "predicate": "evaluated in",
        "object": "ClinicalTrial",
        "edge_hint": "CHEMBL-NCT",
    },
    {
        "name": "CellTypeCapableOfBiologicalProcess",
        "subject": "CellType",
        "predicate": "capable of / involved in",
        "object": "BiologicalProcess",
        "edge_hint": "CL-GO",
    },
]

MULTI_TARGET_CONNECTORS = [" and ", ",", " plus ", " or "]
CONNECTABLE_COLLECTION_PRIORITY = [
    "UBERON",
    "MONDO",
    "CL",
    "CS",
    "CSD",
    "GS",
    "PR",
    "CHEMBL",
    "CHEBI",
    "GO",
    "HP",
    "NCT",
    "PUB",
    "NCBITaxon",
    "PATO",
    "HsapDv",
    "BMC",
    "BGS",
]


class QuestionServiceError(Exception):
    """Raised when question-to-AQL conversion or execution fails."""


def answer_question(question, graph="ontologies", history=None, mode="new"):
    if graph == "auto":
        return answer_question_auto(question, history=history, mode=mode)

    return answer_question_single(question, graph=graph, history=history, mode=mode)


def answer_question_auto(question, history=None, mode="new"):
    """Answer by trying both CKN graphs and merging successful graph-shaped results."""
    results = []
    errors = []
    for graph_name in graph_order_for_question(question):
        try:
            result = answer_question_single(question, graph=graph_name, history=history, mode=mode)
        except QuestionServiceError as exc:
            errors.append(f"{graph_name}: {exc}")
            continue
        except Exception as exc:
            logger.exception("Unexpected error answering question on graph %s", graph_name)
            errors.append(f"{graph_name}: {exc}")
            continue
        if result_is_missing_collection_notice(result):
            continue
        if result.get("rows") or result.get("nodes") or result.get("links"):
            results.append(result)

    if not results:
        if errors:
            return build_question_failure_response(question, errors)
        return answer_question_single(question, graph="ontologies", history=history, mode=mode)

    return merge_auto_graph_answers(results)


def build_question_failure_response(question, errors):
    """Return a user-actionable response instead of surfacing raw backend failures."""
    suggested_questions = suggested_rephrases_for_failed_question(question)
    explanation = (
        "I could not run a safe graph query for that wording. I may need the concepts "
        "or entity types to be stated a little more explicitly."
    )
    if suggested_questions:
        explanation += " Try one of the suggested rephrasings below."
    return {
        "answer": explanation,
        "aql": "",
        "bind_vars": {},
        "columns": ["message"],
        "rows": [{"message": explanation}],
        "nodes": [],
        "links": [],
        "graph": "auto",
        "queried_graphs": [],
        "schema_summary": "The question could not be converted into a safe executable graph query.",
        "used_openai": bool(getattr(settings, "OPENAI_API_KEY", "")),
        "recovered": False,
        "expanded_graph_context": False,
        "suggested_questions": suggested_questions,
        "errors": errors[:3],
    }


def suggested_rephrases_for_failed_question(question):
    connect_terms = extract_connect_terms(question)
    if connect_terms:
        left, right = connect_terms
        return [
            f"Find paths connecting {left} and {right} across the CKN graphs.",
            f"Find paths between anatomy terms matching {left} and disease terms matching {right}.",
            f"Show genes, cell types, and anatomy that connect {left} and {right}.",
        ]
    term = normalize_seed_term(extract_search_term(question))
    if not term:
        return []
    return [
        f"Show graph entities matching {term}.",
        f"Find genes, diseases, drugs, cell types, and anatomy connected to {term}.",
    ]


def result_is_missing_collection_notice(result):
    rows = result.get("rows") or []
    return bool(rows) and all(isinstance(row, dict) and row.get("missing_collection") for row in rows)


def graph_order_for_question(question):
    normalized = (question or "").lower()
    asks_trials = any(word in normalized for word in ["trial", "trials", "study", "studies", "nct"])
    asks_phenotypes = any(word in normalized for word in ["phenotype", "phenotypes", "symptom", "symptoms"])
    if asks_trials:
        return ["ontologies", "phenotypes"]
    if asks_phenotypes:
        return ["phenotypes", "ontologies"]
    return ["ontologies", "phenotypes"]


def merge_auto_graph_answers(results):
    rows = []
    columns = OrderedDict([("source_graph", True)])
    nodes = OrderedDict()
    links = OrderedDict()
    answers = []
    suggested_questions = []
    aql_parts = []
    recovered = False
    expanded_graph_context = False
    used_openai = False

    for result in results:
        graph_name = result.get("graph", "")
        if result.get("answer") and result.get("answer") not in answers:
            answers.append(result["answer"])
        if result.get("aql"):
            aql_parts.append(f"/* {graph_name} */\n{result['aql']}")
        for row in result.get("rows") or []:
            merged_row = {"source_graph": graph_name, **row}
            rows.append(merged_row)
            for column in infer_columns([merged_row]):
                columns[column] = True
        for node in result.get("nodes") or []:
            node_id = node.get("_id") or node.get("id")
            if not node_id:
                continue
            existing = nodes.get(node_id, {})
            source_graphs = list(OrderedDict.fromkeys([*(existing.get("source_graphs") or []), graph_name]))
            nodes[node_id] = {**existing, **node, "source_graphs": source_graphs}
        for link in result.get("links") or []:
            link_id = link.get("_id") or link.get("id") or f"{link.get('_from') or link.get('source')}-{link.get('_to') or link.get('target')}"
            if not link_id:
                continue
            existing = links.get(link_id, {})
            source_graphs = list(OrderedDict.fromkeys([*(existing.get("source_graphs") or []), graph_name]))
            links[link_id] = {**existing, **link, "source_graphs": source_graphs}
        for suggestion in result.get("suggested_questions") or []:
            if suggestion not in suggested_questions:
                suggested_questions.append(suggestion)
        recovered = recovered or bool(result.get("recovered"))
        expanded_graph_context = expanded_graph_context or bool(result.get("expanded_graph_context"))
        used_openai = used_openai or bool(result.get("used_openai"))

    answer = " ".join(answers) if answers else "I searched the available CKN graphs."
    return {
        "answer": answer,
        "aql": "\n\n".join(aql_parts),
        "bind_vars": {},
        "columns": list(columns.keys()),
        "rows": rows,
        "nodes": list(nodes.values()),
        "links": list(links.values()),
        "graph": "auto",
        "queried_graphs": [result.get("graph") for result in results],
        "schema_summary": "Auto mode searched the ontology and phenotype CKN graphs and merged successful results.",
        "used_openai": used_openai,
        "recovered": recovered,
        "expanded_graph_context": expanded_graph_context,
        "suggested_questions": suggested_questions[:5],
    }


def answer_question_single(question, graph="ontologies", history=None, mode="new"):
    """
    Answer a natural-language question using the selected Arango graph.

    Args:
        question (str): User question.
        graph (str): "ontologies" or "phenotypes".
        history (list): Optional conversation history from the client.
        mode (str): "new" starts without prior graph context; "refine" expands
            from the latest result summary when possible.

    Returns:
        dict: AQL, rows, columns, graph data, and explanatory metadata.
    """
    history = history or []
    mode = mode if mode in {"new", "refine"} else "new"

    followup_plan = (
        generate_followup_plan(question, history, graph=graph, require_context_reference=False)
        if mode == "refine"
        else None
    )
    deterministic_plan = (
        followup_plan
        or generate_traversal_plan(question, graph=graph)
    )
    schema = None
    if not deterministic_plan:
        schema = get_schema_context(graph)
        deterministic_plan = generate_deterministic_plan(question, schema)

    if deterministic_plan:
        plan = deterministic_plan
    elif getattr(settings, "OPENAI_API_KEY", ""):
        try:
            plan = generate_aql_with_openai(question, graph, schema, history, mode=mode)
        except QuestionServiceError as exc:
            plan = generate_recovery_plan(question, graph) or generate_fallback_plan(question, graph, schema)
            plan["answer"] = (
                f"{plan.get('answer', 'I used a deterministic fallback query.')} "
                "The OpenAI AQL generator was unavailable, so I used a local schema-aware traversal."
            )
    else:
        plan = generate_fallback_plan(question, graph, schema)

    query = normalize_query(plan["aql"])
    validate_read_only_query(query)

    recovered = False
    try:
        rows = execute_query(query, graph, plan.get("bind_vars") or {})
    except QuestionServiceError as exc:
        recovery_plan = generate_recovery_plan(question, graph)
        if not recovery_plan:
            raise
        recovery_query = normalize_query(recovery_plan["aql"])
        validate_read_only_query(recovery_query)
        try:
            rows = execute_query(
                recovery_query, graph, recovery_plan.get("bind_vars") or {}
            )
        except QuestionServiceError:
            raise exc
        plan = recovery_plan
        query = recovery_query
        recovered = True

    if not rows:
        recovery_plan = generate_recovery_plan(question, graph)
        if recovery_plan:
            recovery_query = normalize_query(recovery_plan["aql"])
            validate_read_only_query(recovery_query)
            recovery_rows = execute_query(
                recovery_query, graph, recovery_plan.get("bind_vars") or {}
            )
            if recovery_rows:
                plan = recovery_plan
                query = recovery_query
                rows = recovery_rows
                recovered = True

    graph_data = extract_graph(rows, graph=graph)
    expanded_graph_context = False
    context_plan = generate_graph_context_plan(question, graph_data)
    if context_plan:
        context_query = normalize_query(context_plan["aql"])
        validate_read_only_query(context_query)
        context_rows = execute_query(
            context_query, graph, context_plan.get("bind_vars") or {}
        )
        if context_rows:
            plan = context_plan
            query = context_query
            rows = context_rows
            graph_data = extract_graph(rows, graph=graph)
            expanded_graph_context = True

    columns = infer_columns(rows)
    suggested_questions = generate_suggested_questions(question, graph_data, graph)

    return {
        "answer": plan.get("answer", ""),
        "aql": query,
        "bind_vars": plan.get("bind_vars") or {},
        "columns": columns,
        "rows": rows,
        "nodes": graph_data["nodes"],
        "links": graph_data["links"],
        "graph": graph,
        "schema_summary": schema["summary"] if schema else "Used deterministic prompt normalization and schema-aware traversal.",
        "used_openai": bool(getattr(settings, "OPENAI_API_KEY", "")),
        "recovered": recovered,
        "expanded_graph_context": expanded_graph_context,
        "suggested_questions": suggested_questions,
    }


def generate_recovery_plan(question, graph="ontologies"):
    """Fallback to schema-aware traversals when generated AQL returns no rows."""
    return generate_traversal_plan(question, graph=graph)


def generate_graph_context_plan(question, graph_data):
    """
    Re-run a richer schema-aware traversal when a generated answer omits
    relationship context needed to draw the graph.
    """
    normalized = question.lower()
    nodes = graph_data.get("nodes", []) if isinstance(graph_data, dict) else []
    links = graph_data.get("links", []) if isinstance(graph_data, dict) else []
    collections = {node.get("collection") for node in nodes if node.get("collection")}

    asks_association = any(
        word in normalized
        for word in ["associated", "assocaited", "related", "connected", "linked", "involved"]
    )
    asks_gene = "gene" in normalized or "genes" in normalized
    mentions_disease = any(
        word in normalized
        for word in ["disease", "diseases", "condition", "conditions", "heart", "asthma", "alzheimer"]
    )

    if asks_association and asks_gene and mentions_disease and (
        "MONDO" not in collections or "GS" not in collections or not links
    ):
        return generate_traversal_plan(question)

    return None


def generate_followup_plan(question, history, graph="ontologies", require_context_reference=True):
    """Generate graph expansion plans from the previous result context."""
    normalized = question.lower()
    context_tokens = ["this", "these", "those", "them", "that", "current", "previous", "result"]
    if require_context_reference and not any(token in normalized for token in context_tokens):
        return None

    context = latest_result_context(history)
    if not context:
        return None

    node_ids = [node.get("id") for node in context.get("nodes", []) if node.get("id")]
    if not node_ids:
        return None

    asks_drugs = any(word in normalized for word in ["drug", "drugs", "compound", "compounds", "treatment", "treatments"])
    asks_genes = any(word in normalized for word in ["gene", "genes", "marker", "markers"])
    asks_cells = any(word in normalized for word in ["cell", "cells", "cell type", "cell types"])
    asks_diseases = any(word in normalized for word in ["disease", "diseases", "condition", "conditions"])
    asks_trials = any(word in normalized for word in ["trial", "trials", "study", "studies"])
    asks_datasets = any(word in normalized for word in ["dataset", "datasets"])
    asks_proteins = any(word in normalized for word in ["protein", "proteins"])
    asks_publications = any(word in normalized for word in ["publication", "publications", "paper", "papers", "article", "articles", "pubmed"])
    asks_anatomy = any(word in normalized for word in ["anatomy", "anatomical", "organ", "organs", "tissue", "tissues"])
    asks_processes = any(word in normalized for word in ["biological process", "biological processes", "process", "processes", "function", "functions"])
    asks_cell_sets = any(word in normalized for word in ["cell set", "cell sets", "cluster", "clusters"])
    asks_phenotypes = any(word in normalized for word in ["phenotype", "phenotypes", "phenotypic"])
    asks_expand = any(phrase in normalized for phrase in ["expand", "one more hop", "another hop"])

    if asks_drugs:
        return expand_context_to_drugs_plan(node_ids, graph)
    if asks_genes:
        return expand_context_to_genes_plan(node_ids, graph)
    if asks_cells:
        return expand_context_to_cells_plan(node_ids)
    if asks_diseases:
        return expand_context_to_diseases_plan(node_ids, graph)
    if asks_trials:
        return expand_context_to_trials_plan(node_ids, graph)
    if asks_datasets:
        return expand_context_to_datasets_plan(node_ids)
    if asks_proteins:
        return expand_context_to_proteins_plan(node_ids, graph)
    if asks_publications:
        return expand_context_to_publications_plan(node_ids, graph)
    if asks_anatomy:
        return expand_context_to_collection_plan(node_ids, graph, "UBERON", "anatomical structures")
    if asks_processes:
        return expand_context_to_collection_plan(node_ids, graph, "GO", "biological processes")
    if asks_cell_sets:
        return expand_context_to_collection_plan(node_ids, graph, "CS", "cell sets")
    if asks_phenotypes:
        return expand_context_to_collection_plan(node_ids, graph, "HP", "phenotypes")
    if asks_expand:
        return expand_context_one_hop_plan(node_ids, graph)
    return None


def generate_suggested_questions(question, graph_data, graph="ontologies"):
    """Suggest follow-up questions only when they can add reachable graph data."""
    nodes = graph_data.get("nodes", []) if isinstance(graph_data, dict) else []
    links = graph_data.get("links", []) if isinstance(graph_data, dict) else []
    collections = {node.get("collection") for node in nodes if node.get("collection")}
    if not collections:
        return []

    additional_counts = count_additional_reachable_collections(nodes, graph)
    suggestions = []

    def add(prompt, target_collection):
        count_info = additional_counts.get(target_collection) or {}
        count = count_info.get("count", 0)
        if count <= 0:
            return
        suffix = f" ({count}{'+' if count_info.get('capped') else ''})"
        prompt = f"{prompt}{suffix}"
        if prompt not in suggestions:
            suggestions.append(prompt)

    if "MONDO" in collections:
        add("What genes are connected to these diseases?", "GS")
        add("Can you show me drugs associated with these diseases?", "CHEMBL")
        add("What cell types are connected through these disease-associated genes?", "CL")

    if "GS" in collections:
        add("Can you show me drugs associated with these genes?", "CHEMBL")
        add("What cell types are connected to these genes?", "CL")
        add("Which diseases are connected to these genes?", "MONDO")
        add("What proteins are connected to these genes?", "PR")

    if "CL" in collections:
        add("What genes are connected to these cell types?", "GS")
        add("Which datasets include these cell types?", "CSD")
        add("Which diseases are connected through genes from these cell types?", "MONDO")

    if "CHEMBL" in collections:
        add("What genes are targeted by these drugs?", "GS")
        add("Which diseases are connected to these drugs?", "MONDO")
        add("Are there clinical trials connected to these drugs?", "NCT")

    if "CSD" in collections or "CS" in collections:
        add("What cell types are represented in these datasets?", "CL")
        add("What genes are connected to those cell types?", "GS")

    if "PR" in collections:
        add("What genes encode or connect to these proteins?", "GS")
        add("Which drugs are connected to these proteins?", "CHEMBL")

    one_hop_count = count_additional_one_hop(nodes, graph)
    if links and one_hop_count > 0:
        suggestions.append(f"Can you expand this graph by one more hop? ({one_hop_count})")

    return suggestions[:5]


def count_additional_reachable_collections(nodes, graph="ontologies"):
    """Count additional reachable target collections not already present in the graph."""
    node_ids = [node.get("_id") or node.get("id") for node in nodes if node.get("_id") or node.get("id")]
    existing_ids = set(node_ids)
    if not node_ids:
        return {}

    _, graph_name = get_db_and_graph(graph)
    try:
        cursor = execute_query(
            f"""
            FOR startId IN @node_ids
              LET start = DOCUMENT(startId)
              FILTER start != null
              FOR vertex, edge, path IN 1..3 ANY start GRAPH @graph_name
                FILTER vertex._id NOT IN @existing_ids
                FILTER PARSE_IDENTIFIER(vertex._id).collection IN @target_collections
                LIMIT {DEFAULT_LIMIT}
                COLLECT collection = PARSE_IDENTIFIER(vertex._id).collection, target_id = vertex._id
                COLLECT collection_name = collection WITH COUNT INTO count
                RETURN {{
                  collection: collection_name,
                  count,
                  capped: count >= {DEFAULT_LIMIT}
                }}
            """,
            graph,
            {
                "node_ids": node_ids[:80],
                "existing_ids": list(existing_ids),
                "graph_name": graph_name,
                "target_collections": suggestion_target_collections(),
            },
        )
    except QuestionServiceError:
        logger.exception("Could not count additional suggestion targets")
        return {}

    return {item["collection"]: item for item in cursor if item.get("collection")}


def count_additional_one_hop(nodes, graph="ontologies"):
    node_ids = [node.get("_id") or node.get("id") for node in nodes if node.get("_id") or node.get("id")]
    existing_ids = set(node_ids)
    if not node_ids:
        return 0

    _, graph_name = get_db_and_graph(graph)
    try:
        rows = execute_query(
            f"""
            FOR startId IN @node_ids
              LET start = DOCUMENT(startId)
              FILTER start != null
              FOR vertex, edge IN 1..1 ANY start GRAPH @graph_name
                FILTER vertex._id NOT IN @existing_ids
                COLLECT target_id = vertex._id
                LIMIT {DEFAULT_LIMIT}
                RETURN target_id
            """,
            graph,
            {
                "node_ids": node_ids[:80],
                "existing_ids": list(existing_ids),
                "graph_name": graph_name,
            },
        )
        return len(rows)
    except QuestionServiceError:
        logger.exception("Could not count one-hop suggestion targets")
        return 0


def suggest_questions_for_node(
    node_id,
    graph="ontologies",
    visible_edge_count=0,
    visible_neighbor_counts=None,
    visible_neighbor_ids=None,
):
    if graph == "auto":
        return suggest_questions_for_node_auto(
            node_id,
            visible_edge_count=visible_edge_count,
            visible_neighbor_counts=visible_neighbor_counts,
            visible_neighbor_ids=visible_neighbor_ids,
        )

    return suggest_questions_for_node_single(
        node_id,
        graph=graph,
        visible_edge_count=visible_edge_count,
        visible_neighbor_counts=visible_neighbor_counts,
        visible_neighbor_ids=visible_neighbor_ids,
    )


def suggest_questions_for_node_auto(
    node_id,
    visible_edge_count=0,
    visible_neighbor_counts=None,
    visible_neighbor_ids=None,
):
    results = []
    errors = []
    for graph_name in ["ontologies", "phenotypes"]:
        try:
            results.append(
                suggest_questions_for_node_single(
                    node_id,
                    graph=graph_name,
                    visible_edge_count=visible_edge_count,
                    visible_neighbor_counts=visible_neighbor_counts,
                    visible_neighbor_ids=visible_neighbor_ids,
                )
            )
        except QuestionServiceError as exc:
            errors.append(str(exc))

    if not results:
        raise QuestionServiceError("; ".join(errors) or f"Node not found: {node_id}")

    primary = results[0]
    questions = []
    reachable = []
    edge_collections = []
    neighbors = []
    for result in results:
        for question in result.get("suggested_questions") or []:
            if question not in questions:
                questions.append(question)
        reachable.extend(result.get("reachable") or [])
        edge_collections.extend(result.get("edge_collections") or [])
        neighbors.extend(result.get("neighbors") or [])

    return {
        **primary,
        "graph": "auto",
        "queried_graphs": [result.get("graph") for result in results],
        "neighbors": neighbors,
        "reachable": reachable,
        "edge_collections": edge_collections,
        "suggested_questions": questions[:10],
    }


def suggest_questions_for_node_single(
    node_id,
    graph="ontologies",
    visible_edge_count=0,
    visible_neighbor_counts=None,
    visible_neighbor_ids=None,
):
    """Inspect a selected graph node and suggest focused refinement questions."""
    visible_neighbor_counts = visible_neighbor_counts or {}
    visible_neighbor_ids = visible_neighbor_ids or {}
    visible_edge_count = visible_edge_count or 0
    visible_id_key = tuple(
        sorted((collection, tuple(sorted(ids or []))) for collection, ids in visible_neighbor_ids.items())
    )
    cache_key = (
        graph,
        node_id,
        visible_edge_count,
        tuple(sorted(visible_neighbor_counts.items())),
        visible_id_key,
    )
    cached = NODE_SUGGESTION_CACHE.get(cache_key)
    if cached:
        NODE_SUGGESTION_CACHE.move_to_end(cache_key)
        return cached

    db, graph_name = get_db_and_graph(graph)
    deadline = time.monotonic() + NODE_SUGGESTION_TIME_BUDGET_SECONDS
    try:
        cursor = db.aql.execute(
            """
            LET start = DOCUMENT(@node_id)
            FILTER start != null
            LET neighbors = (
              FOR vertex, edge IN 1..1 ANY start GRAPH @graph_name
                FILTER vertex._id NOT IN @visible_node_ids
                COLLECT neighbor_collection = PARSE_IDENTIFIER(vertex._id).collection WITH COUNT INTO count
                SORT count DESC
                RETURN { collection: neighbor_collection, count, min_depth: 1 }
            )
            LET reachable = neighbors
            LET edgeCollections = (
              FOR vertex, edge IN 1..1 ANY start GRAPH @graph_name
                COLLECT edge_collection = PARSE_IDENTIFIER(edge._id).collection WITH COUNT INTO count
                SORT count DESC
                RETURN { collection: edge_collection, count }
            )
            RETURN { node: start, neighbors, reachable, edge_collections: edgeCollections }
            """,
            bind_vars={
                "node_id": node_id,
                "graph_name": graph_name,
                "visible_node_ids": flatten_visible_neighbor_ids(visible_neighbor_ids),
            },
            batch_size=1,
        )
        payload = next(iter(cursor), None)
    except Exception as exc:
        logger.exception("Node suggestion query failed")
        raise QuestionServiceError(f"Could not inspect selected node: {exc}") from exc

    if not payload or not payload.get("node"):
        raise QuestionServiceError(f"Node not found: {node_id}")

    node = normalize_result_item(payload["node"])
    source_collection = node.get("_id", node_id).split("/", 1)[0]
    reachable = []
    seen_reachable = {item.get("collection") for item in reachable if item.get("collection")}
    for target_collection in prioritized_suggestion_collections(source_collection):
        if time.monotonic() >= deadline:
            break
        reachability = count_reachable_collection_for_node(
            db,
            graph_name,
            node_id,
            target_collection,
            NODE_SUGGESTION_REACHABILITY_LIMIT,
            visible_neighbor_ids.get(target_collection, []),
        )
        if reachability and reachability.get("count", 0) > 0:
            reachability["hidden_only"] = True
            reachable.append(reachability)
            seen_reachable.add(target_collection)

    suggestions = generate_node_suggestion_prompts(
        node,
        payload.get("neighbors") or [],
        reachable,
        payload.get("edge_collections") or [],
        visible_edge_count=visible_edge_count,
        visible_neighbor_counts=visible_neighbor_counts,
        visible_neighbor_ids=visible_neighbor_ids,
    )
    result = {
        "node": node,
        "node_id": node.get("_id", node_id),
        "label": preferred_display_name(node, node_id),
        "collection": source_collection,
        "graph": graph,
        "neighbors": payload.get("neighbors") or [],
        "reachable": reachable,
        "edge_collections": payload.get("edge_collections") or [],
        "visible_edge_count": visible_edge_count,
        "visible_neighbor_counts": visible_neighbor_counts,
        "visible_neighbor_ids": visible_neighbor_ids,
        "suggested_questions": suggestions[:10],
    }
    NODE_SUGGESTION_CACHE[cache_key] = result
    if len(NODE_SUGGESTION_CACHE) > NODE_SUGGESTION_CACHE_LIMIT:
        NODE_SUGGESTION_CACHE.popitem(last=False)
    return result


def prioritized_suggestion_collections(source_collection):
    priority = [
        "GS", "MONDO", "CL", "CHEMBL", "PR", "CSD", "CS", "NCT", "PUB",
        "UBERON", "GO", "HP", "NCBITaxon", "PATO", "CHEBI", "HsapDv", "BMC", "BGS",
    ]
    return [collection for collection in priority if collection != source_collection]


def flatten_visible_neighbor_ids(visible_neighbor_ids):
    ids = []
    for value in (visible_neighbor_ids or {}).values():
        if isinstance(value, list):
            ids.extend(item for item in value if item)
    return list(OrderedDict.fromkeys(ids))


def count_reachable_collection_for_node(db, graph_name, node_id, target_collection, limit, visible_target_ids=None):
    try:
        cursor = db.aql.execute(
            """
            LET start = DOCUMENT(@node_id)
            FILTER start != null
            LET candidates = (
              FOR vertex, edge, path IN 1..2 ANY start GRAPH @graph_name
                OPTIONS { bfs: true, uniqueVertices: "global" }
                FILTER IS_SAME_COLLECTION(@target_collection, vertex)
                FILTER vertex._id != @node_id
                FILTER vertex._id NOT IN @visible_target_ids
                LIMIT @limit
                RETURN { id: vertex._id, depth: LENGTH(path.edges) }
            )
            LET hits = (
              FOR candidate IN candidates
                COLLECT target_id = candidate.id AGGREGATE min_depth = MIN(candidate.depth)
                RETURN { id: target_id, min_depth }
            )
            FILTER LENGTH(hits) > 0
            RETURN {
              collection: @target_collection,
              count: LENGTH(hits),
              min_depth: MIN(hits[*].min_depth),
              capped: LENGTH(candidates) >= @limit
            }
            """,
            bind_vars={
                "node_id": node_id,
                "graph_name": graph_name,
                "target_collection": target_collection,
                "limit": limit,
                "visible_target_ids": visible_target_ids or [],
            },
            batch_size=1,
        )
        return next(iter(cursor), None)
    except Exception:
        logger.exception("Could not count reachable %s suggestions for %s", target_collection, node_id)
        return None


def generate_node_suggestion_prompts(
    node,
    neighbors,
    reachable,
    edge_collections,
    visible_edge_count=0,
    visible_neighbor_counts=None,
    visible_neighbor_ids=None,
):
    """Create up to 10 focused questions from selected-node neighbor metadata."""
    visible_neighbor_counts = visible_neighbor_counts or {}
    visible_neighbor_ids = visible_neighbor_ids or {}
    node_id = node.get("_id", "")
    collection = node_id.split("/", 1)[0] if "/" in node_id else ""
    label = preferred_display_name(node, node_id)
    reachable_by_collection = OrderedDict()
    reachable_counts = {}
    for item in reachable or neighbors:
        collection_name = item.get("collection")
        if not collection_name:
            continue
        depth = item.get("depth") or item.get("min_depth") or 1
        count = item.get("count") or 1
        current = reachable_counts.setdefault(
            collection_name, {"collection": collection_name, "count": 0, "min_depth": depth}
        )
        current["count"] += count
        current["min_depth"] = min(current["min_depth"], depth)

    for item in sorted(reachable_counts.values(), key=lambda row: (row.get("min_depth", 1), -row.get("count", 0))):
        if item.get("collection") and item.get("count", 0) > 0:
            reachable_by_collection[item["collection"]] = item
    edge_names = {
        item.get("collection")
        for item in edge_collections
        if item.get("collection") and item.get("count", 0) > 0
    }
    suggestions = []

    def add(prompt):
        if prompt not in suggestions:
            suggestions.append(prompt)

    prompt_by_collection = {
        "GS": f"Show genes reachable from {label}.",
        "MONDO": f"Show diseases reachable from {label}.",
        "CL": f"Show cell types reachable from {label}.",
        "CHEMBL": f"Show drugs reachable from {label}.",
        "PR": f"Show proteins reachable from {label}.",
        "CSD": f"Show datasets reachable from {label}.",
        "CS": f"Show cell sets reachable from {label}.",
        "NCT": f"Show clinical trials reachable from {label}.",
        "PUB": f"Show publications reachable from {label}.",
        "UBERON": f"Show anatomical structures reachable from {label}.",
        "GO": f"Show biological processes reachable from {label}.",
        "HP": f"Show phenotypes reachable from {label}.",
        "NCBITaxon": f"Show species reachable from {label}.",
        "PATO": f"Show phenotypic qualities reachable from {label}.",
        "CHEBI": f"Show chemicals reachable from {label}.",
        "HsapDv": f"Show development stages reachable from {label}.",
        "BMC": f"Show biomarker combinations reachable from {label}.",
        "BGS": f"Show gene sets reachable from {label}.",
    }
    priority = [
        "GS", "MONDO", "CL", "CHEMBL", "PR", "CSD", "CS", "NCT", "PUB",
        "UBERON", "GO", "HP", "NCBITaxon", "PATO", "CHEBI", "HsapDv", "BMC", "BGS",
    ]
    for target_collection in priority:
        if target_collection in reachable_by_collection and target_collection != collection:
            item = reachable_by_collection[target_collection]
            result_count = item.get("count", 0)
            visible_count = (
                0
                if item.get("hidden_only")
                else len(visible_neighbor_ids.get(target_collection, []))
                or visible_neighbor_counts.get(target_collection, 0)
            )
            additional_count = result_count if item.get("hidden_only") else max(result_count - visible_count, 0)
            if additional_count > 0:
                suffix = f" ({additional_count}{'+' if item.get('capped') else ''})"
                add(f"{prompt_by_collection[target_collection]}{suffix}")

    one_hop_count = sum(item.get("count", 0) for item in neighbors or [])
    additional_one_hop_count = one_hop_count
    if edge_names and additional_one_hop_count > 0:
        add(f"Expand {label} by one graph hop. ({additional_one_hop_count})")

    return suggestions[:10]


def suggestion_target_collections():
    """Collections from the LinkML concept map worth suggesting in the UI."""
    collections = [metadata["collection"] for metadata in CKN_SCHEMA_CONCEPTS.values()]
    collections.extend(["HP", "NCBITaxon", "PATO"])
    return list(OrderedDict.fromkeys(collections))


def latest_result_context(history):
    """Return the newest assistant result summary from chat history."""
    for message in reversed(history or []):
        summary = message.get("result_summary") if isinstance(message, dict) else None
        if summary and summary.get("nodes"):
            return summary
    return None


def expand_context_to_drugs_plan(node_ids, graph="ontologies"):
    _, graph_name = get_db_and_graph(graph)
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..2 ANY start GRAPH @graph_name
            OPTIONS {{ bfs: true, uniqueVertices: "global" }}
            FILTER IS_SAME_COLLECTION("CHEMBL", vertex)
            FILTER vertex._id != start._id
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              drug: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {"node_ids": node_ids[:80], "graph_name": graph_name},
        "answer": "Here are drugs connected to the previous result set.",
    }


def expand_context_to_genes_plan(node_ids, graph="ontologies"):
    _, graph_name = get_db_and_graph(graph)
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..2 ANY start GRAPH @graph_name
            OPTIONS {{ bfs: true, uniqueVertices: "global" }}
            FILTER IS_SAME_COLLECTION("GS", vertex)
            FILTER vertex._id != start._id
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              gene: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {"node_ids": node_ids[:80], "graph_name": graph_name},
        "answer": "Here are genes connected to the previous result set.",
    }


def expand_context_to_cells_plan(node_ids):
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..2 ANY start
            `GS-MONDO`, `CL-GS`, `CL-CSD`, `CS-CL`
            FILTER IS_SAME_COLLECTION("CL", vertex)
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              cell_type: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {"node_ids": node_ids[:80]},
        "answer": "Here are cell types connected to the previous result set.",
    }


def expand_context_to_diseases_plan(node_ids, graph="ontologies"):
    _, graph_name = get_db_and_graph(graph)
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..2 ANY start GRAPH @graph_name
            OPTIONS {{ bfs: true, uniqueVertices: "global" }}
            FILTER IS_SAME_COLLECTION("MONDO", vertex)
            FILTER vertex._id != start._id
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              disease: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {"node_ids": node_ids[:80], "graph_name": graph_name},
        "answer": "Here are diseases connected to the previous result set.",
    }


def expand_context_to_trials_plan(node_ids, graph="ontologies"):
    db, _ = get_db_and_graph(graph)
    if not db.has_collection("NCT") or not db.has_collection("CHEMBL-NCT"):
        return {
            "aql": """
            RETURN {
              notice: "The selected graph does not contain clinical trial records.",
              missing_collection: "NCT",
              selected_graph: @graph,
              suggested_graph: "ontologies"
            }
            """,
            "bind_vars": {"graph": graph},
            "answer": "The selected graph does not contain clinical trial records. I can find clinical trials from the ontology graph.",
        }

    return {
        "aql": f"""
        LET starts = (
          FOR startId IN @node_ids
            LET start = DOCUMENT(startId)
            FILTER start != null
            LIMIT 80
            RETURN start
        )
        LET drugStarts = (FOR start IN starts FILTER IS_SAME_COLLECTION("CHEMBL", start) RETURN start)
        LET geneStarts = (FOR start IN starts FILTER IS_SAME_COLLECTION("GS", start) RETURN start)
        LET diseaseStarts = (FOR start IN starts FILTER IS_SAME_COLLECTION("MONDO", start) RETURN start)
        LET fromDrug = (
          FOR drug IN drugStarts
            FOR trial, trialEdge IN 1..1 OUTBOUND drug `CHEMBL-NCT`
              LIMIT {DEFAULT_LIMIT}
              RETURN {{
                start: drug,
                drug,
                clinical_trial: trial,
                edges: [trialEdge],
                path: [drug._id, trial._id]
              }}
        )
        LET fromGene = (
          FOR gene IN geneStarts
            LET linkedDrugs = (
              FOR drug, drugGeneEdge IN 1..1 INBOUND gene `CHEMBL-GS`
                LIMIT 25
                RETURN {{ drug, drugGeneEdge }}
            )
            FOR linkedDrug IN linkedDrugs
              FOR trial, trialEdge IN 1..1 OUTBOUND linkedDrug.drug `CHEMBL-NCT`
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  start: gene,
                  gene,
                  drug: linkedDrug.drug,
                  clinical_trial: trial,
                  edges: [linkedDrug.drugGeneEdge, trialEdge],
                  path: [gene._id, linkedDrug.drug._id, trial._id]
                }}
        )
        LET fromDiseaseDirect = (
          FOR disease IN diseaseStarts
            LET linkedDrugs = (
              FOR drug, diseaseDrugEdge IN 1..1 INBOUND disease `CHEMBL-MONDO`
                LIMIT 25
                RETURN {{ drug, diseaseDrugEdge }}
            )
            FOR linkedDrug IN linkedDrugs
              FOR trial, trialEdge IN 1..1 OUTBOUND linkedDrug.drug `CHEMBL-NCT`
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  start: disease,
                  disease,
                  drug: linkedDrug.drug,
                  clinical_trial: trial,
                  edges: [linkedDrug.diseaseDrugEdge, trialEdge],
                  path: [disease._id, linkedDrug.drug._id, trial._id]
                }}
        )
        LET fromDiseaseGene = (
          FOR disease IN diseaseStarts
            LET linkedGenes = (
              FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
                LIMIT 25
                RETURN {{ gene, diseaseGeneEdge }}
            )
            FOR linkedGene IN linkedGenes
              LET linkedDrugs = (
                FOR drug, drugGeneEdge IN 1..1 INBOUND linkedGene.gene `CHEMBL-GS`
                  LIMIT 10
                  RETURN {{ drug, drugGeneEdge }}
              )
              FOR linkedDrug IN linkedDrugs
                FOR trial, trialEdge IN 1..1 OUTBOUND linkedDrug.drug `CHEMBL-NCT`
                  LIMIT {DEFAULT_LIMIT}
                  RETURN {{
                    start: disease,
                    disease,
                    gene: linkedGene.gene,
                    drug: linkedDrug.drug,
                    clinical_trial: trial,
                    edges: [linkedGene.diseaseGeneEdge, linkedDrug.drugGeneEdge, trialEdge],
                    path: [disease._id, linkedGene.gene._id, linkedDrug.drug._id, trial._id]
                  }}
        )
        LET rows = APPEND(APPEND(fromDrug, fromGene), APPEND(fromDiseaseDirect, fromDiseaseGene))
        FOR row IN rows
          COLLECT trial_id = row.clinical_trial._id, drug_id = row.drug._id INTO grouped
          LIMIT {DEFAULT_LIMIT}
          RETURN FIRST(grouped[*].row)
        """,
        "bind_vars": {"node_ids": node_ids[:80]},
        "answer": "Here are clinical trials connected to the previous result set.",
    }


def expand_context_to_datasets_plan(node_ids):
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..2 ANY start
            `CL-CSD`, `CS-CL`
            FILTER IS_SAME_COLLECTION("CSD", vertex)
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              dataset: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {"node_ids": node_ids[:80]},
        "answer": "Here are datasets connected to the previous result set.",
    }


def expand_context_to_proteins_plan(node_ids, graph="ontologies"):
    _, graph_name = get_db_and_graph(graph)
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..2 ANY start GRAPH @graph_name
            OPTIONS {{ bfs: true, uniqueVertices: "global" }}
            FILTER IS_SAME_COLLECTION("PR", vertex)
            FILTER vertex._id != start._id
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              protein: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {"node_ids": node_ids[:80], "graph_name": graph_name},
        "answer": "Here are proteins connected to the previous result set.",
    }


def expand_context_to_collection_plan(node_ids, graph, target_collection, target_label, max_depth=3):
    _, graph_name = get_db_and_graph(graph)
    result_key = re.sub(r"[^a-z0-9_]+", "_", target_label.lower()).strip("_") or "result"
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..@max_depth ANY start GRAPH @graph_name
            FILTER IS_SAME_COLLECTION(@target_collection, vertex)
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              {result_key}: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {
            "node_ids": node_ids[:80],
            "graph_name": graph_name,
            "target_collection": target_collection,
            "max_depth": max_depth,
        },
        "answer": f"Here are {target_label} reachable from the previous result set.",
    }


def expand_context_to_publications_plan(node_ids, graph):
    _, graph_name = get_db_and_graph(graph)
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR dataset, datasetEdge, datasetPath IN 1..3 ANY start GRAPH @graph_name
            FILTER IS_SAME_COLLECTION("CSD", dataset)
            FOR publication, pubEdge IN 1..1 OUTBOUND dataset `CSD-PUB`
              LIMIT {DEFAULT_LIMIT}
              RETURN {{
                start,
                dataset,
                publication,
                edges: APPEND(datasetPath.edges, [pubEdge]),
                path: APPEND(APPEND([start._id], datasetPath.vertices[*]._id), [publication._id])
              }}
        """,
        "bind_vars": {"node_ids": node_ids[:80], "graph_name": graph_name},
        "answer": "Here are publications reachable from the previous result set through connected datasets.",
    }


def expand_context_one_hop_plan(node_ids, graph="ontologies"):
    _, graph_name = get_db_and_graph(graph)
    return {
        "aql": f"""
        FOR startId IN @node_ids
          LET start = DOCUMENT(startId)
          FILTER start != null
          FOR vertex, edge, path IN 1..1 ANY start GRAPH @graph_name
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              start,
              neighbor: vertex,
              edges: path.edges,
              path: APPEND([start._id], path.vertices[*]._id)
            }}
        """,
        "bind_vars": {"node_ids": node_ids[:80], "graph_name": graph_name},
        "answer": "Here is the current result set expanded by one graph hop.",
    }


def generate_deterministic_plan(question, schema):
    """
    Handle explicit collection label searches without calling OpenAI.

    Broader natural-language questions go through OpenAI with live schema
    context so users are not constrained to hard-coded examples/templates.
    """
    collection_names = {item["name"] for item in schema["collections"]}
    collection_pattern = "|".join(sorted(re.escape(name) for name in collection_names))
    match = re.search(
        rf"\b({collection_pattern})\b.*\blabel\s+(?:contains|containing|like|matching)\s+(.+)$",
        question,
        re.IGNORECASE,
    )
    if not match:
        return None

    collection = next(
        item["name"] for item in schema["collections"] if item["name"].lower() == match.group(1).lower()
    )
    term = match.group(2).strip().strip("\"'")
    if not term:
        return None

    return {
        "aql": f"""
        FOR doc IN `{collection}`
          FILTER doc.label != null
          FILTER CONTAINS(LOWER(TO_STRING(doc.label)), LOWER(@term))
          LIMIT {DEFAULT_LIMIT}
          RETURN doc
        """,
        "bind_vars": {"term": term},
        "answer": f"Matched {collection} documents whose label contains '{term}'.",
    }


def generate_traversal_plan(question, graph="ontologies"):
    """Generate deterministic plans for common multi-hop graph traversals."""
    normalized = question.lower()
    connecting_plan = connecting_two_terms_plan(question, graph)
    if connecting_plan:
        return connecting_plan

    target_info = detect_target_concept(question)
    target_collections = detect_requested_target_collections(question)
    asks_disease = any(
        word in normalized
        for word in [
            "disease",
            "diseases",
            "mondo",
            "condition",
            "conditions",
            "asthma",
            "alzheimer",
            "copd",
            "emphysema",
            "glaucoma",
            "macular degeneration",
        ]
    )
    asks_cell = any(word in normalized for word in ["cell", "cells", "cell type", "cell types"]) or "cl " in f"{normalized} "
    asks_gene = "gene" in normalized or "genes" in normalized or "gs " in f"{normalized} "
    asks_drug = "drug" in normalized or "drugs" in normalized or "chembl" in normalized
    asks_trial = any(word in normalized for word in ["trial", "trials", "study", "studies", "nct"])
    asks_dataset = "dataset" in normalized or "datasets" in normalized or "csd" in normalized
    asks_processes = any(word in normalized for word in ["biological process", "biological processes", "process", "processes", "function", "functions"])
    asks_association = (
        "associated" in normalized
        or "assocaited" in normalized
        or "related" in normalized
        or "connected" in normalized
        or "linked" in normalized
        or "involved" in normalized
        or "expressed" in normalized
        or "expresses" in normalized
    )
    cell_first = keyword_position(normalized, ["cell", "cells", "cell type", "cell types", "cl "]) < keyword_position(
        normalized, ["disease", "diseases", "mondo", "condition", "conditions"]
    )

    term = extract_question_focus(
        question,
        ask_flags={
            "disease": asks_disease,
            "cell": asks_cell,
            "gene": asks_gene,
            "drug": asks_drug,
            "trial": asks_trial,
            "dataset": asks_dataset,
        },
    )

    if not term:
        return None

    seed_is_trial = bool(re.search(r"\bnct\s*\d+|\bclinical trial\b", normalized))

    if target_collections and seed_is_trial:
        return generic_multi_target_traversal_plan(question, term, target_collections, graph)

    if asks_disease and len(target_collections) >= 4 and {"GS", "CHEMBL", "NCT"}.intersection(target_collections):
        return disease_broad_overview_plan(term, graph)

    if target_collections and len(target_collections) >= 4:
        return generic_multi_target_traversal_plan(question, term, target_collections, graph)

    if asks_disease and ("GO" in target_collections or asks_processes):
        return disease_gene_process_plan(term, include_cells="CL" in target_collections, graph=graph)

    if asks_disease and "CHEMBL" in target_collections and ("GS" in target_collections or "PR" in target_collections):
        return disease_drug_mechanism_plan(term)

    if asks_disease and {"CL", "GS", "GO"}.intersection(target_collections) and len(target_collections) > 1:
        return disease_cell_gene_process_plan(term, target_collections)

    if target_collections and is_anatomy_seed_question(question, term):
        anatomy_plan = anatomy_target_traversal_plan(term, target_collections, graph, question)
        if anatomy_plan:
            return anatomy_plan

    if target_collections and (len(target_collections) > 1 or target_collections[0] not in {"GS", "CL"}):
        return generic_multi_target_traversal_plan(question, term, target_collections, graph)

    if asks_cell and asks_gene and asks_disease and cell_first:
        return cell_gene_disease_plan(term)

    if asks_cell and asks_association:
        return disease_gene_cell_plan(term)

    if asks_gene and asks_association:
        return disease_gene_plan(term, sort_by_score="top" in normalized)

    if asks_drug and asks_association:
        return disease_gene_drug_plan(term)

    if asks_trial and asks_disease:
        return disease_trial_plan(term)

    if asks_disease and asks_gene and asks_cell:
        return disease_gene_cell_plan(term)

    if asks_disease and asks_gene and asks_drug:
        return disease_gene_drug_plan(term)

    if asks_cell and asks_dataset:
        return cell_dataset_plan(term)

    if target_collections:
        return generic_multi_target_traversal_plan(question, term, target_collections, graph)

    if target_info:
        return generic_schema_traversal_plan(question, term, target_info, graph)

    return None


def detect_target_concept(question):
    """Find the entity type being requested from LinkML-derived aliases."""
    normalized = question.lower()
    matches = []
    for concept, metadata in CKN_SCHEMA_CONCEPTS.items():
        aliases = [concept, concept.lower(), metadata["collection"], *metadata.get("aliases", [])]
        for alias in aliases:
            alias_text = str(alias).lower().replace("_", " ")
            if not alias_text:
                continue
            pattern = rf"\b{re.escape(alias_text)}\b"
            match = re.search(pattern, normalized)
            if match:
                matches.append((match.start(), -len(alias_text), concept, metadata))
                break

    if not matches:
        return None

    _, _, concept, metadata = sorted(matches)[0]
    return {
        "concept": concept,
        "collection": metadata["collection"],
        "description": metadata["description"],
    }


def schema_alias_matches(text):
    """Return concept collection mentions in text ordered by position and specificity."""
    normalized = (text or "").lower().replace("_", " ")
    matches = []
    for concept, metadata in CKN_SCHEMA_CONCEPTS.items():
        aliases = [concept, metadata["collection"], *metadata.get("aliases", [])]
        for alias in aliases:
            alias_text = str(alias).lower().replace("_", " ")
            if not alias_text:
                continue
            for match in re.finditer(rf"\b{re.escape(alias_text)}\b", normalized):
                matches.append(
                    {
                        "start": match.start(),
                        "end": match.end(),
                        "alias": alias_text,
                        "concept": concept,
                        "collection": metadata["collection"],
                        "description": metadata["description"],
                    }
                )
    matches.sort(key=lambda item: (item["start"], -(item["end"] - item["start"])))
    deduped = []
    occupied = []
    for match in matches:
        if any(not (match["end"] <= start or match["start"] >= end) for start, end in occupied):
            continue
        deduped.append(match)
        occupied.append((match["start"], match["end"]))
    return deduped


def detect_requested_target_collections(question):
    """Infer the entity type(s) the user wants returned, not merely mentioned as seed context."""
    normalized = (question or "").lower()
    spans = []
    patterns = [
        r"\b(?:what|which|show|find|list|return|get)\b(?P<span>.+?)(?:\b(?:associated|connected|related|reachable|available|for|from|to|with|in|within|through|that|are|is)\b|[?.]|$)",
        r"\bshow\s+connected\s+(?P<span>.+?)(?:\bwithin\b|[?.]|$)",
        r"\bstarting\s+from\b.+?\bshow\s+(?:connected\s+)?(?P<span>.+?)(?:\bwithin\b|[?.]|$)",
        r"\bexpand\b.+?\bto\s+(?P<span>.+?)(?:\bwithin\b|[?.]|$)",
        r"\bpaths?\s+from\b.+?\bto\s+(?P<span>.+?)(?:\bwithin\b|[?.]|$)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, normalized, flags=re.IGNORECASE):
            span = cleanup_target_span(match.group("span"))
            if span:
                spans.append(span)

    collections = []
    for span in spans:
        for match in schema_alias_matches(span):
            collection = match["collection"]
            if collection not in collections:
                collections.append(collection)

    if collections:
        return collections

    target = detect_target_concept(question)
    return [target["collection"]] if target else []


def cleanup_target_span(span):
    span = re.sub(r"\b(?:me|the|a|an|all|connected|reachable|associated|related|available|show|find|list|get|return)\b", " ", span or "")
    span = re.sub(r"\s+", " ", span)
    return span.strip(" :?!.\"'")


def source_collections_for_question(question, target_collection):
    """Infer likely source collections from the user's focus phrase."""
    normalized = question.lower()
    target_metadata = next(
        (metadata for metadata in CKN_SCHEMA_CONCEPTS.values() if metadata["collection"] == target_collection),
        None,
    )
    if target_metadata:
        target_aliases = [target_collection, *target_metadata.get("aliases", [])]
        for alias in sorted(target_aliases, key=lambda item: len(str(item)), reverse=True):
            alias_text = str(alias).lower().replace("_", " ")
            normalized = re.sub(rf"\b{re.escape(alias_text)}\b", " ", normalized)

    source_collections = []
    for _, metadata in CKN_SCHEMA_CONCEPTS.items():
        collection = metadata["collection"]
        aliases = [collection, *metadata.get("aliases", [])]
        if any(re.search(rf"\b{re.escape(str(alias).lower())}\b", normalized) for alias in aliases):
            source_collections.append(collection)

    source_collections = [collection for collection in source_collections if collection != target_collection]
    if source_collections:
        inferred = infer_source_collections_from_question_shape(question, target_collection)
        return list(OrderedDict.fromkeys([*inferred, *source_collections]))

    inferred = infer_source_collections_from_question_shape(question, target_collection)
    if inferred:
        return inferred

    collections = [metadata["collection"] for metadata in CKN_SCHEMA_CONCEPTS.values()]
    return [collection for collection in OrderedDict.fromkeys(collections) if collection != target_collection]


def infer_source_collections_from_question_shape(question, target_collection=None):
    """Use common user wording to choose likely seed collections for the focus term."""
    normalized = (question or "").lower()
    if re.search(r"\bnct\s*\d+|\bclinical trial\b|\btrial\b|\bstudy\b", normalized):
        return ["NCT"] if target_collection != "NCT" else []
    if any(word in normalized for word in ["disease", "condition", "copd", "asthma", "emphysema", "glaucoma", "alzheimer", "macular degeneration"]):
        if target_collection != "MONDO":
            return ["MONDO"]
    if any(word in normalized for word in ["drug", "compound", "treatment", "revefenacin", "tiotropium"]):
        if target_collection != "CHEMBL":
            return ["CHEMBL"]
    if any(word in normalized for word in ["retina", "anatom", "organ", "tissue"]):
        if target_collection != "UBERON":
            return ["UBERON", "CL", "CS", "CSD"]
    if any(word in normalized for word in ["cell set", "cell sets", "cluster"]):
        if target_collection != "CS":
            return ["CS"]
    if any(word in normalized for word in ["cell type", "cell types", "cells"]):
        if target_collection != "CL":
            return ["CL", "CS"]
    if "gene" in normalized and target_collection != "GS":
        return ["GS"]
    if "protein" in normalized and target_collection != "PR":
        return ["PR"]
    return []


def generic_schema_traversal_plan(question, term, target_info, graph="ontologies"):
    """Use the named graph to find requested LinkML entity types from a matched focus term."""
    return generic_multi_target_traversal_plan(question, term, [target_info["collection"]], graph)


def generic_multi_target_traversal_plan(question, term, target_collections, graph="ontologies"):
    """Find one or more requested target entity types from seed terms using bounded graph paths."""
    _, graph_name = get_db_and_graph(graph)
    target_collections = list(OrderedDict.fromkeys(collection for collection in target_collections if collection))
    if not target_collections:
        return None

    if target_collections == ["CS"]:
        return anatomical_structure_cell_sets_plan(term, graph_name)

    source_collections = source_collections_for_question(question, target_collections[0])
    source_collections = [collection for collection in source_collections if collection not in target_collections]
    if not source_collections:
        source_collections = infer_source_collections_from_question_shape(question)
    source_collections = source_collections[:8]
    start_parts = []
    for collection in source_collections:
        start_parts.append(
            f"""
            (
              FOR start IN `{collection}`
                FILTER {match_terms_expr("start")}
                LIMIT 12
                RETURN MERGE(start, {{ _matched_collection: "{collection}" }})
            )
            """
        )

    if not start_parts:
        return None

    starts_expr = start_parts[0] if len(start_parts) == 1 else f"UNION({', '.join(start_parts)})"
    max_depth = requested_max_depth(question, default=4 if "PUB" in target_collections else 3)
    target_label = ", ".join(collection_display_label(collection).lower() for collection in target_collections)
    return {
        "aql": f"""
        LET starts = {starts_expr}
        FOR requested_collection IN @target_collections
          FOR start IN starts
            FOR target, edge, path IN 1..@max_depth ANY start GRAPH @graph_name
              OPTIONS {{ bfs: true, uniqueVertices: "path" }}
              LET target_collection = PARSE_IDENTIFIER(target._id).collection
              FILTER target_collection == requested_collection
              FILTER target._id != start._id
              SORT LENGTH(path.edges), target.label || target.name || target._key
              LIMIT 25
              RETURN {{
                source: start,
                target,
                target_collection,
                path_vertices: path.vertices,
                edges: path.edges,
                path: APPEND([start._id], path.vertices[*]._id)
              }}
        """,
        "bind_vars": {
            "terms": resolve_terms_for_collections(term, source_collections),
            "graph_name": graph_name,
            "target_collections": target_collections,
            "max_depth": max_depth,
        },
        "answer": f"Here are {target_label} reachable from terms matching '{term}' in the knowledge graph.",
    }


def requested_max_depth(question, default=3):
    normalized = (question or "").lower()
    if "one hop" in normalized or "1 hop" in normalized:
        return 1
    if "two hop" in normalized or "two hops" in normalized or "2 hop" in normalized or "2 hops" in normalized:
        return 2
    if "three hop" in normalized or "three hops" in normalized or "3 hop" in normalized or "3 hops" in normalized:
        return 3
    if "multiple hop" in normalized or "multi-hop" in normalized or "multi hop" in normalized:
        return max(default, 4)
    match = re.search(r"\bwithin\s+(\d+)\s+hops?\b", normalized)
    if match:
        return max(1, min(int(match.group(1)), 5))
    return max(1, min(default, 5))


def connecting_two_terms_plan(question, graph="ontologies"):
    connect_terms = extract_connect_terms(question)
    if not connect_terms:
        return None
    left, right = connect_terms
    if not left or not right:
        return None

    _, graph_name = get_db_and_graph(graph)
    available_collections = connectable_collections_for_graph(graph)
    left_collections = candidate_collections_for_connect_term(left, available_collections)
    right_collections = candidate_collections_for_connect_term(right, available_collections)
    searched_collections = list(OrderedDict.fromkeys([*left_collections, *right_collections]))
    if not left_collections or not right_collections:
        return None

    left_parts = build_connect_term_collection_parts(left_collections, "leftTerms", "left_primary")
    right_parts = build_connect_term_collection_parts(right_collections, "rightTerms", "right_primary")
    max_depth = requested_max_depth(question, default=4)

    return {
        "aql": f"""
        LET leftTerms = @left_terms
        LET rightTerms = @right_terms
        LET leftNodes = UNION({", ".join(left_parts)})
        LET rightNodes = UNION({", ".join(right_parts)})
        LET pathRows = (
          FOR leftNode IN leftNodes
            FOR rightNode IN rightNodes
              FILTER leftNode._id != rightNode._id
              FOR connectedVertex, connectedEdge, connectedPath IN 1..@max_depth ANY leftNode GRAPH @graph_name
                OPTIONS {{ bfs: true, uniqueVertices: "path" }}
                FILTER connectedVertex._id == rightNode._id
                SORT LENGTH(connectedPath.edges)
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  source: leftNode,
                  target: rightNode,
                  path_vertices: connectedPath.vertices,
                  edges: connectedPath.edges,
                  path: APPEND([leftNode._id], connectedPath.vertices[*]._id),
                  interpreted_question: {{
                    intent: "connect_concepts",
                    left: @left_primary,
                    right: @right_primary,
                    left_collections: @left_collections,
                    right_collections: @right_collections,
                    searched_collections: @searched_collections,
                    max_depth: @max_depth
                  }}
                }}
        )
        FOR row IN (
          LENGTH(pathRows) > 0
            ? pathRows
            : [
                {{
                  left_nodes: leftNodes,
                  right_nodes: rightNodes,
                  no_connecting_path: true,
                  max_depth: @max_depth,
                  interpreted_question: {{
                    intent: "connect_concepts",
                    left: @left_primary,
                    right: @right_primary,
                    left_collections: @left_collections,
                    right_collections: @right_collections,
                    searched_collections: @searched_collections,
                    max_depth: @max_depth
                  }}
                }}
              ]
        )
          RETURN row
        """,
        "bind_vars": {
            "left_terms": resolve_terms_for_collections(left, left_collections),
            "right_terms": resolve_terms_for_collections(right, right_collections),
            "left_primary": left,
            "right_primary": right,
            "graph_name": graph_name,
            "left_collections": left_collections,
            "right_collections": right_collections,
            "searched_collections": searched_collections,
            "max_depth": max_depth,
        },
        "answer": (
            f"I interpreted this as a request to connect '{left}' and '{right}'. "
            f"I searched matching concepts across the loaded CKN collections and looked for paths up to {max_depth} hops."
        ),
    }


def extract_connect_terms(question):
    """Normalize natural wording into two graph concepts to connect."""
    cleaned = re.sub(r"\s+", " ", (question or "").strip())
    patterns = [
        r"\b(?:can\s+you\s+)?connect\s+(.+?)\s+(?:and|with)\s+(.+?)(?:[?.]|$)",
        r"\b(?:can\s+you\s+)?connect\s+(.+?)\s+to\s+(.+?)(?:[?.]|$)",
        r"\bhow\s+are\s+(.+?)\s+and\s+(.+?)\s+connected\b",
        r"\bwhy\s+is\s+(.+?)\s+connected\s+to\s+(.+?)(?:[?.]|$)",
        r"\b(?:what\s+is\s+)?(?:the\s+)?relationship\s+between\s+(.+?)\s+and\s+(.+?)(?:[?.]|$)",
        r"\b(?:find|show|return)\s+paths?\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)(?:[?.]|$)",
        r"\bpaths?\s+(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+?)(?:[?.]|$)",
        r"\bis\s+(.+?)\s+connected\s+to\s+(.+?)(?:[?.]|$)",
    ]
    for pattern in patterns:
        match = re.search(pattern, cleaned, flags=re.IGNORECASE)
        if not match:
            continue
        left = cleanup_connect_term(match.group(1))
        right = cleanup_connect_term(match.group(2))
        if left and right:
            return left, right
    return None


def cleanup_connect_term(term):
    cleaned = re.sub(
        r"\b(?:the|a|an|all|concept|concepts|term|terms|entity|entities)\b",
        " ",
        term or "",
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned)
    return normalize_seed_term(cleaned.strip(" :?!.\"'"))


def connectable_collections_for_graph(graph):
    """Return schema-prioritized document collections without live DB introspection.

    This keeps prompt normalization fast and prevents connection problems from
    creating planning-time retry loops. Actual query execution remains the
    bounded database attempt.
    """
    return CONNECTABLE_COLLECTION_PRIORITY


def candidate_collections_for_connect_term(term, available_collections):
    """Guess the most likely seed collections for a concept in a path question."""
    normalized = (term or "").lower()
    candidates = []

    def add(collection):
        if collection in available_collections and collection not in candidates:
            candidates.append(collection)

    if re.search(r"\bnct\s*-?\d{6,}\b|\bclinical trial\b|\btrial\b|\bstudy\b", normalized):
        add("NCT")
    if any(word in normalized for word in ["disease", "condition", "glaucoma", "asthma", "alzheimer", "copd", "emphysema", "macular degeneration"]):
        add("MONDO")
    if any(word in normalized for word in ["eye", "retina", "retinal", "anatomy", "organ", "tissue", "lung", "heart", "kidney", "liver", "brain"]):
        add("UBERON")
    if any(word in normalized for word in ["cell set", "cluster"]):
        add("CS")
    if any(word in normalized for word in ["cell", "cells", "cell type"]):
        add("CL")
        add("CS")
    if any(word in normalized for word in ["drug", "compound", "treatment", "therapeutic"]):
        add("CHEMBL")
        add("CHEBI")
    if any(word in normalized for word in ["chemical", "chebi"]):
        add("CHEBI")
    if "protein" in normalized:
        add("PR")
    if "gene" in normalized or re.fullmatch(r"[A-Z0-9-]{2,12}", term or ""):
        add("GS")
    if any(word in normalized for word in ["phenotype", "symptom", "sign"]):
        add("HP")
    if any(word in normalized for word in ["process", "function"]):
        add("GO")
    if any(word in normalized for word in ["dataset", "cellxgene"]):
        add("CSD")
    if any(word in normalized for word in ["publication", "paper", "article", "pubmed"]):
        add("PUB")

    if candidates:
        return candidates[:4]

    fallback_priority = ["MONDO", "UBERON", "CL", "CS", "GS", "CHEMBL", "PR", "GO", "HP"]
    return [collection for collection in fallback_priority if collection in available_collections][:5]


def build_connect_term_collection_parts(collections, terms_var_name, primary_bind_name):
    parts = []
    for collection in collections:
        parts.append(
            f"""
            (
              FOR doc IN `{collection}`
                FILTER {match_terms_expr_with_param("doc", terms_var_name)}
                LET display = LOWER(TO_STRING(doc.label || doc.name || doc.title || doc.gene_symbol || doc._key))
                SORT display == LOWER(@{primary_bind_name}) DESC,
                     STARTS_WITH(display, LOWER(@{primary_bind_name})) DESC,
                     LENGTH(display)
                LIMIT 5
                RETURN MERGE(doc, {{ _matched_collection: "{collection}" }})
            )
            """
        )
    return parts


def match_terms_expr_with_param(var_name, terms_var_name):
    """Variant of match_terms_expr for local AQL variables instead of @terms."""
    return match_terms_expr(var_name).replace("@terms", terms_var_name)


def disease_gene_process_plan(term, include_cells=False, graph="ontologies"):
    terms = resolve_terms_for_collection(term, "MONDO")
    _, graph_name = get_db_and_graph(graph)
    cell_rows = """
        LET cellRows = (
          FOR row IN geneRows
            FOR cell, cellGeneEdge IN 1..1 INBOUND row.gene `CL-GS`
              LIMIT 25
              RETURN {
                disease: row.disease,
                gene: row.gene,
                cell_type: cell,
                target: cell,
                target_collection: "CL",
                edges: APPEND(row.edges, [cellGeneEdge]),
                path: APPEND(row.path, [cell._id])
              }
        )
    """ if include_cells else "LET cellRows = []"
    return {
        "aql": f"""
        LET geneRows = (
          FOR disease IN `MONDO`
            FILTER {match_terms_expr("disease")}
            FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
              LIMIT 40
              RETURN {{
                disease,
                gene,
                edges: [diseaseGeneEdge],
                path: [disease._id, gene._id]
              }}
        )
        LET processRows = (
          FOR row IN geneRows
            FOR process, processEdge, processPath IN 1..2 ANY row.gene GRAPH @graph_name
              OPTIONS {{ bfs: true, uniqueVertices: "path" }}
              FILTER PARSE_IDENTIFIER(process._id).collection == "GO"
              LIMIT {DEFAULT_LIMIT}
              RETURN {{
                disease: row.disease,
                gene: row.gene,
                target: process,
                target_collection: "GO",
                edges: APPEND(row.edges, processPath.edges),
                path: APPEND(row.path, processPath.vertices[*]._id)
              }}
        )
        {cell_rows}
        FOR row IN UNION(processRows, cellRows)
          LIMIT {DEFAULT_LIMIT}
          RETURN row
        """,
        "bind_vars": {"terms": terms, "graph_name": graph_name},
        "answer": f"Here are biological processes connected to disease terms matching '{term}' through genes and proteins.",
    }


def disease_drug_mechanism_plan(term):
    terms = resolve_terms_for_collection(term, "MONDO")
    return {
        "aql": f"""
        FOR disease IN `MONDO`
          FILTER {match_terms_expr("disease")}
          FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
            LET directDrugRows = (
              FOR drug, drugGeneEdge IN 1..1 INBOUND gene `CHEMBL-GS`
                LIMIT 25
                RETURN {{
                  disease,
                  gene,
                  drug,
                  target: drug,
                  target_collection: "CHEMBL",
                  edges: [diseaseGeneEdge, drugGeneEdge],
                  path: [disease._id, gene._id, drug._id]
                }}
            )
            LET proteinDrugRows = (
              FOR protein, proteinEdge IN 1..1 ANY gene `GS-PR`
                FOR drug, drugProteinEdge IN 1..1 ANY protein `CHEMBL-PR`
                  LIMIT 25
                  RETURN {{
                    disease,
                    gene,
                    protein,
                    drug,
                    target: drug,
                    target_collection: "CHEMBL",
                    edges: [diseaseGeneEdge, proteinEdge, drugProteinEdge],
                    path: [disease._id, gene._id, protein._id, drug._id]
                  }}
            )
            LET proteinContextRows = (
              FOR protein, proteinEdge IN 1..1 ANY gene `GS-PR`
                LIMIT 25
                RETURN {{
                  disease,
                  gene,
                  protein,
                  target: protein,
                  target_collection: "PR",
                  edges: [diseaseGeneEdge, proteinEdge],
                  path: [disease._id, gene._id, protein._id]
                }}
            )
            FOR row IN UNION(directDrugRows, proteinDrugRows, proteinContextRows)
              LIMIT {DEFAULT_LIMIT}
              RETURN row
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are drugs connected to disease terms matching '{term}' with genes/proteins explaining the connection.",
    }


def disease_broad_overview_plan(term, graph="ontologies"):
    terms = resolve_terms_for_collection(term, "MONDO")
    _, graph_name = get_db_and_graph(graph)
    return {
        "aql": f"""
        LET diseases = (
          FOR disease IN `MONDO`
            FILTER {match_terms_expr("disease")}
            LIMIT 8
            RETURN disease
        )
        LET geneRows = (
          FOR disease IN diseases
            FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
              LIMIT 25
              RETURN {{
                disease,
                gene,
                target: gene,
                target_collection: "GS",
                edges: [diseaseGeneEdge],
                path: [disease._id, gene._id]
              }}
        )
        LET proteinRows = (
          FOR row IN geneRows
            FOR protein, proteinEdge IN 1..1 ANY row.gene `GS-PR`
              LIMIT 25
              RETURN {{
                disease: row.disease,
                gene: row.gene,
                protein,
                target: protein,
                target_collection: "PR",
                edges: APPEND(row.edges, [proteinEdge]),
                path: APPEND(row.path, [protein._id])
              }}
        )
        LET directDrugRows = (
          FOR disease IN diseases
            FOR drug, diseaseDrugEdge IN 1..1 INBOUND disease `CHEMBL-MONDO`
              LIMIT 25
              RETURN {{
                disease,
                drug,
                target: drug,
                target_collection: "CHEMBL",
                edges: [diseaseDrugEdge],
                path: [disease._id, drug._id]
              }}
        )
        LET geneDrugRows = (
          FOR row IN geneRows
            FOR drug, drugGeneEdge IN 1..1 INBOUND row.gene `CHEMBL-GS`
              LIMIT 25
              RETURN {{
                disease: row.disease,
                gene: row.gene,
                drug,
                target: drug,
                target_collection: "CHEMBL",
                edges: APPEND(row.edges, [drugGeneEdge]),
                path: APPEND(row.path, [drug._id])
              }}
        )
        LET drugRows = UNION(directDrugRows, geneDrugRows)
        LET trialRows = (
          FOR row IN drugRows
            FOR trial, trialEdge, trialPath IN 1..2 ANY row.drug GRAPH @graph_name
              OPTIONS {{ bfs: true, uniqueVertices: "path" }}
              FILTER PARSE_IDENTIFIER(trial._id).collection == "NCT"
              LIMIT 25
              RETURN {{
                disease: row.disease,
                gene: row.gene,
                drug: row.drug,
                clinical_trial: trial,
                target: trial,
                target_collection: "NCT",
                edges: APPEND(row.edges, trialPath.edges),
                path: APPEND(row.path, trialPath.vertices[*]._id)
              }}
        )
        LET diseaseTrialRows = (
          FOR disease IN diseases
            FOR trial, trialEdge, trialPath IN 1..4 ANY disease GRAPH @graph_name
              OPTIONS {{ bfs: true, uniqueVertices: "path" }}
              FILTER PARSE_IDENTIFIER(trial._id).collection == "NCT"
              LIMIT 25
              RETURN {{
                disease,
                clinical_trial: trial,
                target: trial,
                target_collection: "NCT",
                edges: trialPath.edges,
                path: APPEND([disease._id], trialPath.vertices[*]._id)
              }}
        )
        LET relatedDiseaseRows = (
          FOR row IN drugRows
            FOR relatedDisease, relatedDiseaseEdge IN 1..1 OUTBOUND row.drug `CHEMBL-MONDO`
              FILTER relatedDisease._id != row.disease._id
              LIMIT 25
              RETURN {{
                disease: row.disease,
                drug: row.drug,
                related_disease: relatedDisease,
                target: relatedDisease,
                target_collection: "MONDO",
                edges: APPEND(row.edges, [relatedDiseaseEdge]),
                path: APPEND(row.path, [relatedDisease._id])
              }}
        )
        FOR row IN UNION(geneRows, proteinRows, drugRows, diseaseTrialRows, trialRows, relatedDiseaseRows)
          RETURN row
        """,
        "bind_vars": {"terms": terms, "graph_name": graph_name},
        "answer": f"Here are genes, proteins, drugs, clinical trials, and related diseases connected to disease terms matching '{term}'.",
    }


def disease_cell_gene_process_plan(term, target_collections):
    base_plan = disease_gene_process_plan(term, include_cells="CL" in target_collections)
    base_plan["answer"] = f"Here are cell types, genes, and biological processes connected to disease terms matching '{term}'."
    return base_plan


def is_anatomy_seed_question(question, term):
    normalized = f"{question} {term}".lower()
    return any(word in normalized for word in ["retina", "retinal", "anatomy", "anatomical", "tissue", "organ"])


def anatomy_target_traversal_plan(term, target_collections, graph="ontologies", question=""):
    target_collections = list(OrderedDict.fromkeys(target_collections or []))
    supported = {"GS", "CSD", "PUB", "CL", "CS", "UBERON", "BMC", "BGS"}
    if not target_collections or not set(target_collections).issubset(supported):
        return None

    terms = resolve_terms_for_collection(term, "UBERON")
    _, graph_name = get_db_and_graph(graph)
    target_label = ", ".join(collection_display_label(collection).lower() for collection in target_collections)
    return {
        "aql": f"""
        FOR anatomy IN `UBERON`
          FILTER {match_terms_expr("anatomy")}
          LIMIT 12
          LET cellTypeRows = (
            FOR cellType, anatomyCellTypeEdge IN 1..1 ANY anatomy `UBERON-CL`, `CL-UBERON`
              LIMIT 35
              RETURN {{ anatomy, cell_type: cellType, edges: [anatomyCellTypeEdge], path: [anatomy._id, cellType._id] }}
          )
          LET cellSetRows = (
            FOR cellSet, anatomyCellSetEdge IN 1..1 ANY anatomy `CS-UBERON`
              LIMIT 35
              RETURN {{ anatomy, cell_set: cellSet, edges: [anatomyCellSetEdge], path: [anatomy._id, cellSet._id] }}
          )
          LET geneRows = (
            FOR row IN cellTypeRows
              FOR gene, cellGeneEdge IN 1..1 ANY row.cell_type `CL-GS`
                FILTER "GS" IN @target_collections
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  anatomy,
                  cell_type: row.cell_type,
                  target: gene,
                  target_collection: "GS",
                  edges: APPEND(row.edges, [cellGeneEdge]),
                  path: APPEND(row.path, [gene._id])
                }}
          )
          LET datasetRowsFromCellType = (
            FOR row IN cellTypeRows
              FOR dataset, cellDatasetEdge IN 1..1 ANY row.cell_type `CL-CSD`
                FILTER "CSD" IN @target_collections OR "PUB" IN @target_collections
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  anatomy,
                  cell_type: row.cell_type,
                  dataset,
                  target: dataset,
                  target_collection: "CSD",
                  edges: APPEND(row.edges, [cellDatasetEdge]),
                  path: APPEND(row.path, [dataset._id])
                }}
          )
          LET datasetRowsFromCellSet = (
            FOR row IN cellSetRows
              FOR dataset, cellSetDatasetEdge IN 1..1 ANY row.cell_set `CS-CSD`
                FILTER "CSD" IN @target_collections OR "PUB" IN @target_collections
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  anatomy,
                  cell_set: row.cell_set,
                  dataset,
                  target: dataset,
                  target_collection: "CSD",
                  edges: APPEND(row.edges, [cellSetDatasetEdge]),
                  path: APPEND(row.path, [dataset._id])
                }}
          )
          LET datasetRows = APPEND(datasetRowsFromCellType, datasetRowsFromCellSet)
          LET biomarkerRows = (
            FOR row IN cellSetRows
              FOR biomarker, biomarkerEdge IN 1..1 ANY row.cell_set `CS-BMC`
                FILTER "BMC" IN @target_collections
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  anatomy,
                  cell_set: row.cell_set,
                  target: biomarker,
                  target_collection: "BMC",
                  edges: APPEND(row.edges, [biomarkerEdge]),
                  path: APPEND(row.path, [biomarker._id])
                }}
          )
          LET geneSetRows = (
            FOR row IN cellSetRows
              FOR geneSet, geneSetEdge IN 1..1 ANY row.cell_set `CS-BGS`
                FILTER "BGS" IN @target_collections
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  anatomy,
                  cell_set: row.cell_set,
                  target: geneSet,
                  target_collection: "BGS",
                  edges: APPEND(row.edges, [geneSetEdge]),
                  path: APPEND(row.path, [geneSet._id])
                }}
          )
          LET publicationRows = (
            FOR row IN datasetRows
              FOR publication, publicationEdge IN 1..1 ANY row.dataset `CSD-PUB`
                FILTER "PUB" IN @target_collections
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  anatomy,
                  cell_type: row.cell_type,
                  cell_set: row.cell_set,
                  dataset: row.dataset,
                  target: publication,
                  target_collection: "PUB",
                  edges: APPEND(row.edges, [publicationEdge]),
                  path: APPEND(row.path, [publication._id])
                }}
          )
          LET cellTypeTargets = (
            FOR row IN cellTypeRows
              FILTER "CL" IN @target_collections
              RETURN MERGE(row, {{ target: row.cell_type, target_collection: "CL" }})
          )
          LET cellSetTargets = (
            FOR row IN cellSetRows
              FILTER "CS" IN @target_collections
              RETURN MERGE(row, {{ target: row.cell_set, target_collection: "CS" }})
          )
          LET anatomyTargetsFromCellSets = (
            FOR row IN cellSetRows
              FILTER "UBERON" IN @target_collections
              RETURN MERGE(row, {{ target: anatomy, target_collection: "UBERON" }})
          )
          LET requestedDatasetRows = (
            FOR row IN datasetRows
              FILTER "CSD" IN @target_collections
              RETURN row
          )
          LET rows = UNION(geneRows, requestedDatasetRows, publicationRows, cellTypeTargets, cellSetTargets, anatomyTargetsFromCellSets, biomarkerRows, geneSetRows)
          FOR row IN rows
            LIMIT {DEFAULT_LIMIT}
            RETURN row
        """,
        "bind_vars": {
            "terms": terms,
            "target_collections": target_collections,
        },
        "answer": f"Here are {target_label} reachable from anatomical terms matching '{term}'.",
    }


def anatomical_structure_cell_sets_plan(term, graph_name):
    terms = resolve_terms_for_collection(term, "UBERON")
    return {
        "aql": f"""
        FOR anatomy IN `UBERON`
          FILTER {match_terms_expr("anatomy")}
          FOR cell_set, edge IN 1..1 INBOUND anatomy `CS-UBERON`
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              anatomical_structure: anatomy,
              cell_set,
              edges: [edge],
              path: [anatomy._id, cell_set._id]
            }}
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are cell sets reachable from anatomical structure terms matching '{term}'.",
    }


def likely_focus_collection(question):
    normalized = question.lower()
    for _, metadata in CKN_SCHEMA_CONCEPTS.items():
        collection = metadata["collection"]
        aliases = [collection, *metadata.get("aliases", [])]
        if any(re.search(rf"\b{re.escape(str(alias).lower())}\b", normalized) for alias in aliases):
            return collection
    return None


def collection_result_key(collection):
    return {
        "MONDO": "disease",
        "GS": "gene",
        "CL": "cell_type",
        "CHEMBL": "drug",
        "PR": "protein",
        "CSD": "dataset",
        "CS": "cell_set",
        "NCT": "clinical_trial",
        "PUB": "publication",
        "UBERON": "anatomical_structure",
        "GO": "go_term",
        "HP": "phenotype",
        "NCBITaxon": "taxon",
        "PATO": "phenotypic_quality",
        "CHEBI": "chemical",
        "HsapDv": "development_stage",
        "BMC": "biomarker_combination",
        "BGS": "binary_gene_set",
    }.get(collection, "target")


def collection_display_label(collection):
    for metadata in CKN_SCHEMA_CONCEPTS.values():
        if metadata["collection"] == collection:
            return metadata["description"]
    return collection


def extract_question_focus(question, ask_flags):
    """Extract the biological entity being asked about from human phrasing."""
    quoted = re.search(r"['\"]([^'\"]+)['\"]", question)
    if quoted:
        return normalize_seed_term(quoted.group(1).strip())

    patterns = [
        r"\bstarting\s+from\s+(.+?)(?:,?\s+(?:show|find|list|return|get)\b|[?.]|$)",
        r"\bexpand\s+(.+?)\s+to\b",
        r"\bpaths?\s+from\s+(.+?)\s+to\b",
        r"\bconnects?\s+(.+?)\s+to\b",
        r"\b(?:associated|assocaited|related|connected|linked|involved)\s+(?:with|to)\s+(.+)$",
        r"\breachable\s+from\s+(.+)$",
        r"\bby\s+(.+)$",
        r"\bfrom\s+(.+)$",
        r"\bfor\s+(.+)$",
        r"\bin\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, question, re.IGNORECASE)
        if match:
            candidate = cleanup_focus_candidate(match.group(1), ask_flags)
            if candidate:
                return normalize_seed_term(candidate)

    return normalize_seed_term(extract_search_term(question))


def cleanup_focus_candidate(candidate, ask_flags):
    """Remove requested output words from a candidate focus phrase."""
    cleaned = candidate.strip(" :?!.\"'")
    cleaned = re.sub(r"\band\s+(?:show|include|return|explain|display)\b.*$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bthrough\b.*$", "", cleaned, flags=re.IGNORECASE)

    if ask_flags.get("drug"):
        match = re.search(r"\b(?:to|for|with|in)\s+(.+)$", cleaned, re.IGNORECASE)
        if match:
            cleaned = match.group(1)

    if ask_flags.get("dataset"):
        cleaned = re.sub(r"\b(?:contain|contains|containing|include|includes|with)\b", " ", cleaned, flags=re.IGNORECASE)
    remove_words = [
        "genes",
        "gene",
        "cells",
        "cell sets",
        "cell set",
        "cell types",
        "cell type",
        "cell",
        "diseases",
        "disease",
        "conditions",
        "condition",
        "drugs",
        "drug",
        "trials",
        "trial",
        "studies",
        "study",
        "clinical",
        "available",
        "publications",
        "publication",
        "papers",
        "paper",
        "articles",
        "article",
        "phenotypes",
        "phenotype",
        "symptoms",
        "symptom",
        "proteins",
        "protein",
        "anatomical",
        "anatomy",
        "structures",
        "structure",
        "tissues",
        "tissue",
        "processes",
        "process",
        "functions",
        "function",
        "species",
        "organisms",
        "organism",
        "datasets",
        "dataset",
        "terms",
        "term",
        "that",
        "are",
        "reachable",
        "from",
        "the",
        "via",
        "through",
        "and",
        "or",
    ]
    for word in remove_words:
        cleaned = re.sub(rf"\b{re.escape(word)}\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def keyword_position(text, keywords):
    positions = [text.find(keyword) for keyword in keywords if text.find(keyword) >= 0]
    return min(positions) if positions else 10**9


def extract_quoted_or_after_keywords(question, keywords):
    """Extract a traversal seed term from common question phrasings."""
    quoted = re.search(r"['\"]([^'\"]+)['\"]", question)
    if quoted:
        return normalize_seed_term(quoted.group(1).strip())

    association_match = re.search(
        r"\b(?:associated|related|connected|linked)\s+(?:with|to)\s+(.+)$",
        question,
        re.IGNORECASE,
    )
    if association_match:
        return normalize_seed_term(association_match.group(1).strip(" :?!.\"'"))

    lowered = question.lower()
    for keyword in keywords:
        index = lowered.rfind(keyword)
        if index >= 0:
            candidate = question[index + len(keyword):].strip(" :?!.\"'")
            candidate = re.sub(r"\b(to|through|via|and|with|linked|connected|related)\b.*$", "", candidate, flags=re.IGNORECASE).strip()
            if candidate:
                return normalize_seed_term(candidate)

    return normalize_seed_term(extract_search_term(question))


def normalize_seed_term(term):
    """Normalize common user spellings before matching ontology labels."""
    normalized = term.strip()
    normalized = re.sub(r"\balzheimer['’]?s\b", "alzheimer", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bretinal\b", "retina", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"[-\s]+associated\b", "", normalized, flags=re.IGNORECASE)
    return normalized


def disease_gene_cell_plan(term):
    terms = resolve_terms_for_collection(term, "MONDO")
    return {
        "aql": f"""
        FOR disease IN `MONDO`
          FILTER {match_terms_expr("disease")}
          FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
            FOR cell, cellGeneEdge IN 1..1 INBOUND gene `CL-GS`
              LIMIT {DEFAULT_LIMIT}
              RETURN {{
                disease,
                gene,
                cell_type: cell,
                edges: [diseaseGeneEdge, cellGeneEdge],
                path: [disease._id, gene._id, cell._id]
              }}
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are cell types connected to disease terms matching '{term}' through associated genes.",
    }


def disease_gene_plan(term, sort_by_score=False):
    terms = resolve_terms_for_collection(term, "MONDO")
    sort_clause = "SORT TO_NUMBER(diseaseGeneEdge.Score) DESC" if sort_by_score else ""
    return {
        "aql": f"""
        FOR disease IN `MONDO`
          FILTER {match_terms_expr("disease")}
          FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
            {sort_clause}
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              disease,
              gene,
              score: diseaseGeneEdge.Score,
              edges: [diseaseGeneEdge],
              path: [disease._id, gene._id]
            }}
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are genes connected to disease terms matching '{term}'.",
    }


def disease_gene_drug_plan(term):
    terms = resolve_terms_for_collection(term, "MONDO")
    return {
        "aql": f"""
        FOR disease IN `MONDO`
          FILTER {match_terms_expr("disease")}
          FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
            FOR drug, drugGeneEdge IN 1..1 INBOUND gene `CHEMBL-GS`
              LIMIT {DEFAULT_LIMIT}
              RETURN {{
                disease,
                gene,
                drug,
                edges: [diseaseGeneEdge, drugGeneEdge],
                path: [disease._id, gene._id, drug._id]
              }}
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are drugs connected to disease terms matching '{term}' through associated genes.",
    }


def disease_trial_plan(term):
    terms = resolve_terms_for_collection(term, "MONDO")
    return {
        "aql": f"""
        LET directRows = (
          FOR disease IN `MONDO`
            FILTER {match_terms_expr("disease")}
            FOR drug, diseaseDrugEdge IN 1..1 INBOUND disease `CHEMBL-MONDO`
              FOR trial, trialEdge IN 1..1 OUTBOUND drug `CHEMBL-NCT`
                LIMIT {DEFAULT_LIMIT}
                RETURN {{
                  disease,
                  drug,
                  clinical_trial: trial,
                  route: "drug-disease",
                  edges: [diseaseDrugEdge, trialEdge],
                  path: [disease._id, drug._id, trial._id]
                }}
        )
        LET geneRows = (
          FOR disease IN `MONDO`
            FILTER {match_terms_expr("disease")}
            FOR gene, diseaseGeneEdge IN 1..1 INBOUND disease `GS-MONDO`
              FOR drug, drugGeneEdge IN 1..1 INBOUND gene `CHEMBL-GS`
                FOR trial, trialEdge IN 1..1 OUTBOUND drug `CHEMBL-NCT`
                  LIMIT {DEFAULT_LIMIT}
                  RETURN {{
                    disease,
                    gene,
                    drug,
                    clinical_trial: trial,
                    route: "gene-drug",
                    edges: [diseaseGeneEdge, drugGeneEdge, trialEdge],
                    path: [disease._id, gene._id, drug._id, trial._id]
                  }}
        )
        FOR row IN APPEND(directRows, geneRows)
          COLLECT trial_id = row.clinical_trial._id, drug_id = row.drug._id INTO grouped
          LIMIT {DEFAULT_LIMIT}
          RETURN FIRST(grouped[*].row)
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are clinical trials connected to disease terms matching '{term}' through drugs and disease-associated genes.",
    }


def cell_gene_disease_plan(term):
    terms = resolve_terms_for_collection(term, "CL")
    return {
        "aql": f"""
        FOR cell IN `CL`
          FILTER {match_terms_expr("cell")}
          FOR gene, cellGeneEdge IN 1..1 OUTBOUND cell `CL-GS`
            FOR disease, diseaseGeneEdge IN 1..1 OUTBOUND gene `GS-MONDO`
              LIMIT {DEFAULT_LIMIT}
              RETURN {{
                cell_type: cell,
                gene,
                disease,
                edges: [cellGeneEdge, diseaseGeneEdge],
                path: [cell._id, gene._id, disease._id]
              }}
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are diseases connected to cell type terms matching '{term}' through associated genes.",
    }


def cell_dataset_plan(term):
    terms = resolve_terms_for_collection(term, "CL")
    return {
        "aql": f"""
        FOR cell IN `CL`
          FILTER {match_terms_expr("cell")}
          FOR dataset, datasetEdge IN 1..1 OUTBOUND cell `CL-CSD`
            LIMIT {DEFAULT_LIMIT}
            RETURN {{
              cell_type: cell,
              dataset,
              edges: [datasetEdge],
              path: [cell._id, dataset._id]
            }}
        """,
        "bind_vars": {"terms": terms},
        "answer": f"Here are datasets connected to cell type terms matching '{term}'.",
    }


def match_terms_expr(var_name):
    """Return an AQL expression that matches @terms against common document fields."""
    return f"""
    LENGTH(
      FOR term IN @terms
        LET lower_term = LOWER(TO_STRING(term))
        FILTER lower_term != ""
        FILTER (
          ({var_name}._id != null AND LOWER(TO_STRING({var_name}._id)) == lower_term)
          OR ({var_name}.id != null AND LOWER(TO_STRING({var_name}.id)) == lower_term)
          OR ({var_name}.label != null AND CONTAINS(LOWER(TO_STRING({var_name}.label)), lower_term))
          OR ({var_name}.name != null AND CONTAINS(LOWER(TO_STRING({var_name}.name)), lower_term))
          OR ({var_name}.title != null AND CONTAINS(LOWER(TO_STRING({var_name}.title)), lower_term))
          OR ({var_name}.study_id != null AND CONTAINS(LOWER(TO_STRING({var_name}.study_id)), lower_term))
          OR ({var_name}.brief_title != null AND CONTAINS(LOWER(TO_STRING({var_name}.brief_title)), lower_term))
          OR ({var_name}.official_title != null AND CONTAINS(LOWER(TO_STRING({var_name}.official_title)), lower_term))
          OR ({var_name}.preferred_name != null AND CONTAINS(LOWER(TO_STRING({var_name}.preferred_name)), lower_term))
          OR ({var_name}.drug_name != null AND CONTAINS(LOWER(TO_STRING({var_name}.drug_name)), lower_term))
          OR ({var_name}.definition != null AND CONTAINS(LOWER(TO_STRING({var_name}.definition)), lower_term))
          OR ({var_name}.gene_symbol != null AND LOWER(TO_STRING({var_name}.gene_symbol)) == lower_term)
          OR ({var_name}.exact_synonym != null AND CONTAINS(LOWER(TO_STRING({var_name}.exact_synonym)), lower_term))
          OR ({var_name}.hasExactSynonym != null AND CONTAINS(LOWER(TO_STRING({var_name}.hasExactSynonym)), lower_term))
          OR ({var_name}.hasRelatedSynonym != null AND CONTAINS(LOWER(TO_STRING({var_name}.hasRelatedSynonym)), lower_term))
        )
        LIMIT 1
        RETURN 1
    ) > 0
    """


def resolve_terms_for_collection(term, collection):
    """Build local/UMLS candidate terms for matching a specific Arango collection."""
    candidates = OrderedDict()
    for candidate in [term, normalize_seed_term(term)]:
        if candidate:
            candidates[candidate] = True

    for candidate in search_umls_candidates(term, collection):
        if candidate:
            candidates[candidate] = True

    return list(candidates.keys())[:12]


def resolve_terms_for_collections(term, collections):
    """Build candidate terms across several possible seed collections."""
    candidates = OrderedDict()
    for collection in collections or []:
        for candidate in resolve_terms_for_collection(term, collection):
            if candidate:
                candidates[candidate] = True
    for candidate in [term, normalize_seed_term(term), normalize_identifier_like_term(term)]:
        if candidate:
            candidates[candidate] = True
    return list(candidates.keys())[:20]


def normalize_identifier_like_term(term):
    normalized = normalize_seed_term(term)
    nct_match = re.search(r"\bnct\s*-?(\d{6,})\b", normalized, flags=re.IGNORECASE)
    if nct_match:
        return nct_match.group(1)
    return normalized


def search_umls_candidates(term, collection):
    """Use UMLS search to expand a user term into candidate names/source IDs."""
    api_key = getattr(settings, "UMLS_API_KEY", "")
    if not api_key:
        return []

    candidates = []
    sabs = UMLS_COLLECTION_SABS.get(collection, [])
    search_configs = [{"returnIdType": "concept"}]
    for sab in sabs[:4]:
        search_configs.append({"sabs": sab, "returnIdType": "sourceUi"})

    for config in search_configs:
        params = {
            "apiKey": api_key,
            "string": term,
            "pageSize": 5,
        }
        params.update(config)
        try:
            response = requests.get(UMLS_SEARCH_URL, params=params, timeout=8)
            response.raise_for_status()
            results = response.json().get("result", {}).get("results", [])
        except Exception:
            logger.exception("UMLS search failed for term %s", term)
            continue

        for result in results:
            name = result.get("name")
            ui = result.get("ui")
            if name and name.upper() != "NO RESULTS":
                candidates.append(name)
            if config.get("returnIdType") == "sourceUi" and ui and ui.upper() != "NONE":
                candidates.extend(format_source_ids_for_collection(ui, collection))

    return candidates


def format_source_ids_for_collection(ui, collection):
    """Map UMLS source UI formats into local Arango id variants."""
    normalized = ui.replace(":", "/")
    variants = [ui, normalized]
    if "/" not in normalized and collection in {"MONDO", "CL", "UBERON"}:
        variants.append(f"{collection}/{normalized}")
    return variants


def get_schema_context(graph):
    """Build compact schema context from the live Arango database."""
    db, graph_name = get_db_and_graph(graph)
    collections = []

    for collection in db.collections():
        name = collection.get("name")
        if not name or name.startswith("_"):
            continue
        collections.append(
            {
                "name": name,
                "type": collection.get("type"),
                "fields": sample_collection_fields(db, name),
                "count": safe_collection_count(db, name),
            }
        )

    collections = sorted(collections, key=lambda item: item["name"])
    edge_definitions = get_edge_definitions(db, graph_name)

    summary_lines = [
        f"Database graph target: {graph}",
        f"Named graph: {graph_name}",
        "Schema concept to loaded collection mapping:",
    ]
    for concept, metadata in CKN_SCHEMA_CONCEPTS.items():
        summary_lines.append(
            f"- {concept} -> {metadata['collection']}: {metadata['description']}; aliases: {', '.join(metadata['aliases'])}"
        )

    summary_lines.append("Schema association hints:")
    for association in CKN_SCHEMA_ASSOCIATIONS:
        summary_lines.append(
            "- {name}: {subject} --[{predicate}]--> {object}; likely edge(s): {edge_hint}".format(
                **association
            )
        )

    summary_lines.append("Loaded Arango collections:")
    for collection in collections[:MAX_SCHEMA_COLLECTIONS]:
        collection_type = "edge" if collection["type"] == 3 else "document"
        fields = ", ".join(collection["fields"][:MAX_SAMPLE_FIELDS]) or "no sampled fields"
        summary_lines.append(
            f"- {collection['name']} ({collection_type}, count={collection['count']}): {fields}"
        )

    if edge_definitions:
        summary_lines.append("Graph edge definitions:")
        for edge in edge_definitions:
            from_colls = ", ".join(
                edge.get("from")
                or edge.get("from_vertex_collections")
                or []
            )
            to_colls = ", ".join(
                edge.get("to")
                or edge.get("to_vertex_collections")
                or []
            )
            summary_lines.append(
                f"- {edge.get('edge_collection')}: from [{from_colls}] to [{to_colls}]"
            )

    return {
        "collections": collections,
        "edge_definitions": edge_definitions,
        "summary": "\n".join(summary_lines),
    }


def sample_collection_fields(db, collection_name):
    """Return a sorted list of fields found in a small sample of documents."""
    query = f"""
    FOR doc IN `{collection_name}`
      LIMIT 5
      RETURN ATTRIBUTES(doc, true)
    """
    try:
        cursor = db.aql.execute(query)
        fields = set()
        for item in cursor:
            fields.update(item)
        return sorted(fields)
    except Exception:
        logger.exception("Could not sample fields for collection %s", collection_name)
        return []


def safe_collection_count(db, collection_name):
    """Return collection count, or unknown when not available."""
    try:
        return db.collection(collection_name).count()
    except Exception:
        return "unknown"


def get_edge_definitions(db, graph_name):
    """Return graph edge definitions where available."""
    try:
        graph_obj = db.graph(graph_name)
        definitions = graph_obj.edge_definitions()
        return definitions if isinstance(definitions, list) else []
    except Exception:
        logger.debug("Could not load edge definitions for graph %s", graph_name)
        return []


def generate_aql_with_openai(question, graph, schema, history, mode="new"):
    """Use the OpenAI Responses API to produce structured read-only AQL."""
    prompt = build_generation_prompt(question, graph, schema, history, mode=mode)
    payload = {
        "model": getattr(settings, "OPENAI_AQL_MODEL", "gpt-4.1-mini"),
        "input": [
            {
                "role": "system",
                "content": (
                    "You translate biomedical knowledge graph questions into ArangoDB AQL. "
                    "Return only JSON matching the requested schema. Generate read-only AQL only."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "text": {"format": {"type": "json_object"}},
    }

    try:
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=45,
        )
        response.raise_for_status()
        content = extract_openai_text(response.json())
        parsed = json.loads(content)
        return {
            "aql": parsed["aql"],
            "bind_vars": parsed.get("bind_vars") or {},
            "answer": parsed.get("answer") or "Generated a read-only AQL query.",
        }
    except Exception as exc:
        logger.exception("OpenAI question-to-AQL generation failed")
        raise QuestionServiceError(f"Could not generate AQL from the question: {exc}") from exc


def summarize_question_result(question="", answer="", graph="auto", columns=None, rows=None, nodes=None, links=None):
    """Create a concise narrative summary of an ask-a-question result."""
    columns = columns or []
    rows = rows or []
    nodes = nodes or []
    links = links or []
    summary_context = build_result_summary_context(question, answer, graph, columns, rows, nodes, links)

    if getattr(settings, "OPENAI_API_KEY", ""):
        try:
            summary = generate_result_summary_with_openai(summary_context)
            return {"summary": summary, "used_ai": True}
        except Exception:
            logger.exception("OpenAI experimental summary failed; using local summary")

    return {"summary": generate_local_result_summary(summary_context), "used_ai": False}


def build_result_summary_context(question, answer, graph, columns, rows, nodes, links):
    """Compress table and graph result data into a prompt-friendly summary payload."""
    node_counts = OrderedDict()
    node_examples = OrderedDict()
    for node in nodes[:300]:
        if not isinstance(node, dict):
            continue
        collection = node.get("collection") or str(node.get("_id") or node.get("id") or "").split("/", 1)[0] or "Record"
        label = preferred_display_name(node, node.get("label") or node.get("name") or collection)
        node_counts[collection] = node_counts.get(collection, 0) + 1
        node_examples.setdefault(collection, [])
        if label and label not in node_examples[collection] and len(node_examples[collection]) < 6:
            node_examples[collection].append(label)

    relationship_counts = OrderedDict()
    relationship_examples = []
    label_by_id = {
        node.get("_id") or node.get("id"): preferred_display_name(node, node.get("label") or node.get("name") or "")
        for node in nodes
        if isinstance(node, dict) and (node.get("_id") or node.get("id"))
    }
    for link in links[:400]:
        if not isinstance(link, dict):
            continue
        relationship = (
            link.get("relationshipLabel")
            or link.get("edgeLabel")
            or link.get("label")
            or link.get("predicate")
            or link.get("relationship")
            or link.get("edgeCollection")
            or "connected to"
        )
        relationship = str(relationship)
        relationship_counts[relationship] = relationship_counts.get(relationship, 0) + 1
        if len(relationship_examples) < 10:
            source = label_by_id.get(link.get("_from") or link.get("source"), link.get("_from") or link.get("source") or "")
            target = label_by_id.get(link.get("_to") or link.get("target"), link.get("_to") or link.get("target") or "")
            if source and target:
                relationship_examples.append({"source": source, "relationship": relationship, "target": target})

    return {
        "question": question,
        "answer": answer,
        "graph": graph,
        "row_count": len(rows),
        "column_names": columns[:30],
        "rows_sample": rows[:20],
        "node_count": len(nodes),
        "link_count": len(links),
        "node_counts": node_counts,
        "node_examples": node_examples,
        "relationship_counts": relationship_counts,
        "relationship_examples": relationship_examples,
    }


def generate_result_summary_with_openai(summary_context):
    """Use OpenAI to turn result context into a thoughtful result interpretation."""
    payload = {
        "model": getattr(settings, "OPENAI_AQL_MODEL", "gpt-4.1-mini"),
        "input": [
            {
                "role": "system",
                "content": (
                    "You summarize biomedical knowledge graph query results for scientists. "
                    "Write a thoughtful 1-2 paragraph narrative, not a raw list. "
                    "Explain what entity types and relationships are represented, categorize themes when possible, "
                    "and make cautious insight-oriented observations grounded only in the provided data. "
                    "Do not invent facts or imply causal conclusions unless the relationship data supports it."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Summarize this NLM CKN ask-a-question result.\n\n"
                    f"{json.dumps(summary_context, indent=2, default=str)[:16000]}"
                ),
            },
        ],
        "temperature": 0.35,
    }
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=45,
    )
    response.raise_for_status()
    return extract_openai_text(response.json()).strip()


def generate_local_result_summary(summary_context):
    """Provide a deterministic narrative when OpenAI is unavailable."""
    node_counts = summary_context["node_counts"]
    relationship_counts = summary_context["relationship_counts"]
    node_examples = summary_context["node_examples"]
    type_summary = ", ".join(
        f"{count} {friendly_collection_name(collection)}"
        for collection, count in list(node_counts.items())[:8]
    )
    relationship_summary = ", ".join(
        f"{count} {relationship}"
        for relationship, count in list(relationship_counts.items())[:8]
    )
    example_parts = []
    for collection, examples in list(node_examples.items())[:4]:
        if examples:
            example_parts.append(f"{friendly_collection_name(collection)} examples include {', '.join(examples[:4])}")

    first_paragraph = (
        f"This result contains {summary_context['row_count']} table rows and a graph context with "
        f"{summary_context['node_count']} nodes and {summary_context['link_count']} relationships. "
        f"The main entity groups represented are {type_summary or 'records from the selected result'}, "
        f"with relationship evidence including {relationship_summary or 'the links returned by the query'}."
    )
    second_paragraph = (
        "A useful way to read this result is as a local evidence neighborhood rather than a ranked conclusion: "
        "the returned rows identify entities that are connected in the CKN, while the graph shows which source "
        "concepts and intermediate relationships support those connections."
    )
    if example_parts:
        second_paragraph = f"{second_paragraph} {'. '.join(example_parts)}."
    return f"{first_paragraph}\n\n{second_paragraph}"


def friendly_collection_name(collection):
    """Turn common CKN collection names into readable entity categories."""
    return {
        "MONDO": "diseases",
        "GS": "genes",
        "CL": "cell types",
        "CS": "cell sets",
        "CSD": "datasets",
        "CHEMBL": "drugs",
        "PR": "proteins",
        "NCT": "clinical trials",
        "PUB": "publications",
        "UBERON": "anatomy terms",
        "GO": "biological processes",
        "HP": "phenotypes",
    }.get(collection, str(collection).replace("_", " ").lower())


def build_generation_prompt(question, graph, schema, history, mode="new"):
    """Build compact prompt context for AQL generation."""
    recent_history = history[-6:] if isinstance(history, list) else []
    return f"""
Question:
{question}

Selected graph/database:
{graph}

Question mode:
{mode}

Recent conversation:
{json.dumps(recent_history, indent=2)}

Live ArangoDB schema context:
{schema["summary"]}

Rules:
- Return a single JSON object with keys: aql, bind_vars, answer.
- AQL must be read-only. Do not use INSERT, UPDATE, REPLACE, REMOVE, UPSERT, CREATE, DROP, or TRUNCATE.
- Prefer bind variables for user-provided terms.
- Use backticks around collection names.
- Include LIMIT {DEFAULT_LIMIT} or lower unless the question clearly asks for a small aggregation.
- Return complete documents or objects with enough fields for a table.
- If returning relationships, include node documents and edge documents when possible.
- Relationship answers should show the full context needed for a graph, not just the requested target type. For example, a disease-to-gene answer must return the matched MONDO disease documents, the GS gene documents, and the GS-MONDO edge documents.
- For graph traversal, use the named graph from the schema context.
- IDs use slash form such as CL/0002062 or MONDO/0004979, not colon form.
- Common collection meanings: CL=cell types, GS=genes, MONDO=diseases, CHEMBL=drugs, UBERON=anatomy, CS=cell sets, CSD=datasets, PR=proteins.
- Edge collection names usually identify the endpoint collection types; use the live graph edge definitions to choose valid hops.
- For broad entity lookups, search the `label`, `definition`, `gene_symbol`, `exact_synonym`, and `hasExactSynonym` fields when those fields exist.
- For phrase searches, prefer CONTAINS(LOWER(TO_STRING(field)), LOWER(@term)) over exact equality unless the user gives an exact ID.
- If the user asks for associations between two entity types, infer source and target collections from the collection catalog, choose a valid path through edge definitions, and return each participating document and edge.
- Use AQL graph traversals or explicit edge collection traversals as appropriate. Preserve returned edges in an `edges` array when possible so the frontend can draw a graph.
- When question mode is `refine`, treat the newest result_summary as the current graph in memory. Reuse its node IDs, labels, previous AQL, and bind vars as context instead of starting from scratch.
- When question mode is `new`, do not depend on prior result summaries.
"""


def extract_openai_text(response_json):
    """Extract text output from a Responses API response."""
    if response_json.get("output_text"):
        return response_json["output_text"]

    parts = []
    for item in response_json.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                parts.append(content["text"])
    if parts:
        return "".join(parts)
    raise QuestionServiceError("OpenAI response did not contain text output.")


def generate_fallback_plan(question, graph, schema):
    """Generate a broad search query when OpenAI is not configured."""
    query_collections = [
        item["name"]
        for item in schema["collections"]
        if item.get("type") != 3 and item.get("fields")
    ][:20]

    if not query_collections:
        raise QuestionServiceError("No searchable document collections were found.")

    union_parts = []
    for collection in query_collections:
        conditions = []
        sampled_fields = {
            field for field in schema_field_names(schema, collection) if field in DEFAULT_SEARCH_FIELDS
        }
        if not sampled_fields:
            sampled_fields = {"label", "name", "description"}
        for field in sorted(sampled_fields):
            conditions.append(
                f"doc.`{field}` != null AND CONTAINS(LOWER(TO_STRING(doc.`{field}`)), LOWER(@term))"
            )
        union_parts.append(
            f"""
            (
              FOR doc IN `{collection}`
                FILTER {" OR ".join(conditions)}
                LIMIT 10
                RETURN MERGE(doc, {{ _matched_collection: "{collection}" }})
            )
            """
        )

    aql = f"""
    LET matches = UNION({", ".join(union_parts)})
    FOR doc IN matches
      LIMIT {DEFAULT_LIMIT}
      RETURN doc
    """
    return {
        "aql": aql,
        "bind_vars": {"term": extract_search_term(question)},
        "answer": (
            "OpenAI is not configured, so I ran a broad text search across sampled "
            "document collections instead of generating custom AQL."
        ),
    }


def schema_field_names(schema, collection_name):
    for collection in schema["collections"]:
        if collection["name"] == collection_name:
            return collection.get("fields", [])
    return []


def extract_search_term(question):
    """Pick a reasonable search term from a natural-language question."""
    cleaned = re.sub(r"[^A-Za-z0-9:_\\-\\s]", " ", question)
    words = [word for word in cleaned.split() if len(word) > 2]
    stop_words = {
        "what", "which", "show", "find", "does", "are", "the", "and", "with",
        "for", "about", "between", "connected", "related", "relationship",
    }
    filtered = [word for word in words if word.lower() not in stop_words]
    return " ".join(filtered[:4]) or question


def normalize_query(query):
    """Normalize generated AQL before validation/execution."""
    normalized = query.strip()
    if normalized.endswith(";"):
        normalized = normalized[:-1].strip()
    return normalized


def validate_read_only_query(query):
    """Reuse the existing serializer-level read-only AQL validation."""
    serializer = AQLQuerySerializer(data={"query": query})
    try:
        serializer.is_valid(raise_exception=True)
    except serializers.ValidationError as exc:
        raise QuestionServiceError(str(exc)) from exc


def execute_query(query, graph, bind_vars):
    """Execute AQL and return JSON-serializable rows."""
    db, _ = get_db_and_graph(graph)
    try:
        cursor = db.aql.execute(
            query,
            bind_vars=bind_vars,
            batch_size=100,
            count=True,
            max_runtime=25,
        )
        return [normalize_result_item(item) for item in cursor][:DEFAULT_LIMIT]
    except Exception as exc:
        logger.exception("Question AQL execution failed")
        raise QuestionServiceError(f"AQL execution failed: {exc}") from exc


def normalize_result_item(item):
    """Keep result rows JSON-friendly and table-friendly."""
    if isinstance(item, dict):
        return item
    return {"value": item}


def infer_columns(rows):
    """Infer stable table columns from result rows."""
    columns = OrderedDict()
    for row in rows:
        flatten_for_table(row, columns=columns)
    return list(columns.keys())[:30]


def flatten_for_table(value, prefix="", columns=None):
    """Collect flattened column names for display."""
    columns = columns if columns is not None else OrderedDict()
    if isinstance(value, dict):
        for key, child in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else key
            if isinstance(child, (dict, list)):
                columns.setdefault(next_prefix, True)
            else:
                columns.setdefault(next_prefix, True)
    else:
        columns.setdefault(prefix or "value", True)
    return columns


def preferred_display_name(value, fallback=""):
    """Choose a human-readable label from common CKN and ontology fields."""
    if not isinstance(value, dict):
        return fallback

    field_candidates = [
        "label",
        "Label",
        "name",
        "Name",
        "title",
        "Title",
        "preferred_name",
        "preferredName",
        "display_name",
        "displayName",
        "gene_symbol",
        "symbol",
        "Symbol",
        "drug_name",
        "disease_name",
        "cell_name",
        "study_title",
        "brief_title",
        "official_title",
        "study_name",
        "study_id",
    ]
    for field in field_candidates:
        candidate = value.get(field)
        if candidate:
            if field == "study_id":
                return f"Clinical trial {str(candidate).upper()}"
            return str(candidate)

    for field in ["exact_synonym", "hasExactSynonym", "synonym", "synonyms"]:
        candidate = value.get(field)
        if isinstance(candidate, list) and candidate:
            return str(candidate[0])
        if candidate:
            return str(candidate)

    doc_id = value.get("_id") or value.get("id") or fallback
    if doc_id and "/" in doc_id:
        collection, key = doc_id.split("/", 1)
        friendly_collection = {
            "NCT": "Clinical trial",
            "MONDO": "Disease",
            "GS": "Gene",
            "CL": "Cell type",
            "CHEMBL": "Drug",
            "PR": "Protein",
            "CSD": "Dataset",
            "CS": "Cell set",
            "UBERON": "Anatomy",
        }.get(collection, collection)
        return f"{friendly_collection} {key}" if key else friendly_collection
    return fallback or "Record"


def fetch_documents_by_id(node_ids, graph):
    """Fetch documents for edge endpoints so the UI can show names instead of IDs."""
    if not node_ids:
        return {}

    db, _ = get_db_and_graph(graph)
    try:
        cursor = db.aql.execute(
            """
            FOR nodeId IN @node_ids
              LET doc = DOCUMENT(nodeId)
              FILTER doc != null
              RETURN doc
            """,
            bind_vars={"node_ids": list(node_ids)},
            batch_size=100,
        )
        return {doc["_id"]: doc for doc in cursor if isinstance(doc, dict) and doc.get("_id")}
    except Exception:
        logger.exception("Could not hydrate graph endpoint labels")
        return {}


def extract_graph(rows, graph=None):
    """Extract nodes and links from documents in arbitrary query results."""
    nodes = OrderedDict()
    links = OrderedDict()

    def visit(value):
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return

        doc_id = value.get("_id")
        if doc_id and value.get("_from") and value.get("_to"):
            relationship_label = preferred_display_name(
                value,
                value.get("predicate")
                or value.get("Predicate")
                or value.get("relationship")
                or value.get("relation")
                or value.get("type")
                or doc_id.split("/", 1)[0],
            )
            links[doc_id] = {
                **value,
                "id": doc_id,
                "_id": doc_id,
                "_key": value.get("_key", doc_id),
                "source": value["_from"],
                "target": value["_to"],
                "_from": value["_from"],
                "_to": value["_to"],
                "label": relationship_label,
                "relationshipLabel": relationship_label,
                "edgeLabel": relationship_label,
                "edgeCollection": doc_id.split("/", 1)[0],
            }
        elif doc_id:
            display_name = preferred_display_name(value, doc_id)
            nodes[doc_id] = {
                **value,
                "id": doc_id,
                "_id": doc_id,
                "_key": value.get("_key", doc_id),
                "name": display_name,
                "label": display_name,
                "collection": doc_id.split("/", 1)[0],
            }

        for child in value.values():
            if isinstance(child, (dict, list)):
                visit(child)

    visit(rows)

    missing_endpoint_ids = {
        endpoint
        for link in links.values()
        for endpoint in (link["_from"], link["_to"])
        if endpoint not in nodes
    }
    if graph and missing_endpoint_ids:
        for doc_id, doc in fetch_documents_by_id(missing_endpoint_ids, graph).items():
            display_name = preferred_display_name(doc, doc_id)
            nodes[doc_id] = {
                **doc,
                "id": doc_id,
                "_id": doc_id,
                "_key": doc.get("_key", doc_id),
                "name": display_name,
                "label": display_name,
                "collection": doc_id.split("/", 1)[0],
            }

    for link in links.values():
        for endpoint in (link["_from"], link["_to"]):
            if endpoint not in nodes:
                collection = endpoint.split("/", 1)[0]
                nodes[endpoint] = {
                    "id": endpoint,
                    "_id": endpoint,
                    "label": f"{collection} record",
                    "name": f"{collection} record",
                    "collection": collection,
                }

    return {"nodes": list(nodes.values()), "links": list(links.values())}
