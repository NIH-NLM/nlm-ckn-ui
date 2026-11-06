"""
Structural and schema-drift checks for the workflow presets.

These run without a database so they gate every PR. They cannot prove a preset
returns data — only a sweep against a loaded dump can (see the `sweep_presets`
management command). What they do catch is the class of breakage that ETL v1
caused: presets pin edge predicates and node keys as bare strings, so a rename
in the data leaves the preset syntactically valid and silently wrong.
"""

import re
from unittest import TestCase

from arango_api.workflow_presets import PRESET_CATEGORIES, WORKFLOW_PRESETS

# Depth selector maximum in the UI (DEPTH_OPTIONS in react/src/constants/graph.js).
# A preset above this renders as "0" in the builder.
MAX_DEPTH = 9

# Predicates that existed in a previous ETL release and were renamed. Pinning one
# of these means the phase silently returns nothing.
RETIRED_LABELS = {
    # ETL v1: reversed and relabelled to CSD -IS_ABOUT-> CS.
    "MEMBER_OF",
    # ETL v1.8.0-rc.2: CSD -WAS_ATTRIBUTED_TO-> PUB relabelled to DESCRIBED_IN.
    "WAS_ATTRIBUTED_TO",
    # ETL v1.8.0-rc.1: GS -> MONDO relabelled DISEASE_HAS_FEATURE, the RO label of
    # RO:0004029 (ckn-schema alpha.6 is_associated_with); direction unchanged.
    "IS_GENETIC_BASIS_FOR_CONDITION",
}

# ETL v1 renamed the cell-set-to-gene-set hop CS -EXPRESSES-> GS to
# SELECTIVELY_EXPRESSES, but kept EXPRESSES on CS -EXPRESSES-> BGS. A phase that
# walks cell sets and still pins only the bare label therefore matches a real
# edge and fails silently instead of erroring.
SELECTIVE_EXPRESSES_GUARD = ("EXPRESSES", "SELECTIVELY_EXPRESSES")


def _iter_phases():
    """Yield (preset, phase) for every phase across every preset."""
    for preset in WORKFLOW_PRESETS:
        for phase in preset["phases"]:
            yield preset, phase


def _phase_origins(phase):
    """Every node id a phase anchors on, including per-node override keys."""
    origins = list(phase.get("originNodeIds") or [])
    origins += list((phase.get("perNodeSettings") or {}).keys())
    return origins


def _phase_labels(phase):
    """Every edge Label pinned by a phase, including per-node overrides."""
    labels = set()
    settings = phase.get("settings") or {}
    labels.update((settings.get("edgeFilters") or {}).get("Label") or [])
    for override in (phase.get("perNodeSettings") or {}).values():
        labels.update((override.get("edgeFilters") or {}).get("Label") or [])
    return labels


class PresetStructureTests(TestCase):
    """Internal consistency of the preset definitions."""

    def test_preset_ids_are_unique(self):
        ids = [p["id"] for p in WORKFLOW_PRESETS]
        self.assertEqual(sorted(ids), sorted(set(ids)))

    def test_phase_ids_are_globally_unique(self):
        ids = [phase["id"] for _, phase in _iter_phases()]
        self.assertEqual(sorted(ids), sorted(set(ids)))

    def test_categories_are_declared(self):
        known = {c["id"] for c in PRESET_CATEGORIES}
        for preset in WORKFLOW_PRESETS:
            self.assertIn(preset["category"], known, msg=preset["id"])

    def test_previous_phase_references_resolve(self):
        """A phase may only source from a phase declared before it."""
        for preset in WORKFLOW_PRESETS:
            seen = []
            for phase in preset["phases"]:
                prev = phase.get("previousPhaseId")
                if prev is not None:
                    self.assertIn(prev, seen, msg=f"{preset['id']}/{phase['id']}")
                for src in phase.get("previousPhaseIds") or []:
                    self.assertIn(src, seen, msg=f"{preset['id']}/{phase['id']}")
                seen.append(phase["id"])

    def test_depth_within_ui_selector_range(self):
        for preset, phase in _iter_phases():
            depth = (phase.get("settings") or {}).get("depth")
            if depth is not None:
                self.assertLessEqual(
                    depth, MAX_DEPTH, msg=f"{preset['id']}/{phase['id']}"
                )

    def test_every_preset_resolves_a_graph_type(self):
        """Phases may omit graphType, but the preset must declare one somewhere."""
        for preset in WORKFLOW_PRESETS:
            declared = [
                (p.get("settings") or {}).get("graphType") for p in preset["phases"]
            ]
            self.assertTrue(any(declared), msg=preset["id"])


class PresetSchemaDriftTests(TestCase):
    """Guards against pinning identifiers the ETL has since changed."""

    def test_no_retired_edge_labels(self):
        for preset, phase in _iter_phases():
            retired = _phase_labels(phase) & RETIRED_LABELS
            self.assertEqual(
                retired,
                set(),
                msg=(
                    f"{preset['id']}/{phase['id']} pins retired predicate(s) "
                    f"{sorted(retired)}; check the current data before replacing"
                ),
            )

    def test_cell_set_phases_pin_selective_expresses(self):
        """A cell-set phase pinning EXPRESSES must also pin SELECTIVELY_EXPRESSES.

        EXPRESSES still exists on CS -> BGS, so pinning it alone traverses a real
        but different edge: the phase returns a plausible, wrong result rather
        than an error.
        """
        bare, selective = SELECTIVE_EXPRESSES_GUARD
        for preset, phase in _iter_phases():
            settings = phase.get("settings") or {}
            allowed = settings.get("allowedCollections") or []
            labels = _phase_labels(phase)
            if "CS" in allowed and bare in labels:
                self.assertIn(
                    selective,
                    labels,
                    msg=(
                        f"{preset['id']}/{phase['id']} walks CS and pins "
                        f"{bare} without {selective}"
                    ),
                )

    def test_cell_set_dataset_origins_use_composite_keys(self):
        """CSD keys are `<dataset uuid>__<anatomical structure>` as of ETL v1.

        A bare uuid resolves to nothing, and an unresolvable origin used to reach
        the client as a null node.
        """
        for preset, phase in _iter_phases():
            for origin in _phase_origins(phase):
                if not origin.startswith("CSD/"):
                    continue
                context = (
                    f"{preset['id']}/{phase['id']} anchors on CSD key {origin!r}; "
                    "expected `<uuid>__<anatomy>`"
                )
                key = origin.split("/", 1)[1]
                uuid, sep, anatomy = key.partition("__")
                self.assertTrue(sep, msg=context)
                self.assertTrue(uuid, msg=context)
                self.assertTrue(anatomy, msg=context)

    def test_origin_ids_are_well_formed(self):
        """Every origin is `<COLLECTION>/<key>` with both parts present."""
        pattern = re.compile(r"^[A-Za-z][A-Za-z0-9_]*/.+$")
        for preset, phase in _iter_phases():
            for origin in _phase_origins(phase):
                self.assertRegex(origin, pattern, msg=f"{preset['id']}/{phase['id']}")
