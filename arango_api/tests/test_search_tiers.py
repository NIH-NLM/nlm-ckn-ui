"""Unit tests for the collection-maps reader (no database)."""

import json
import tempfile
from pathlib import Path

from unittest import mock

from django.apps import apps
from django.test import SimpleTestCase, override_settings

from arango_api import search_tiers
from arango_api.search_tiers import (
    all_map_fields,
    analyzers_of,
    load_search_tiers,
    tier_of,
)


class AllMapFieldsTestCase(SimpleTestCase):
    def test_union_of_field_to_display_across_collections(self):
        maps = {
            "maps": [
                ["CL", {"individual_fields": [{"field_to_display": "label"}]}],
                [
                    "GS",
                    {
                        "individual_fields": [
                            {"field_to_display": "label"},
                            {"field_to_display": "symbol"},
                        ]
                    },
                ],
                ["NOFIELDS", {}],
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp) / "react" / "src" / "assets"
            assets.mkdir(parents=True)
            (assets / "nlm-ckn-collection-maps.json").write_text(json.dumps(maps))
            with override_settings(BASE_DIR=Path(tmp)):
                self.assertEqual(all_map_fields(), frozenset({"label", "symbol"}))

    def test_real_repo_file_contains_known_fields(self):
        fields = all_map_fields()
        self.assertTrue({"label", "_from", "gene_symbol"} <= fields)


def _maps(fields, tiers=None):
    """A minimal maps file: one collection per (collection, field, tier)."""
    by_coll = {}
    for coll, name, tier in fields:
        by_coll.setdefault(coll, []).append(
            {"field_to_display": name, "search_tier": tier}
        )
    return {
        "search_tiers": tiers
        or {t: ["identity"] for t in ("label", "synonym", "identifier", "text")},
        "maps": [[c, {"individual_fields": f}] for c, f in by_coll.items()],
    }


class LoadSearchTiersTestCase(SimpleTestCase):
    def setUp(self):
        self.addCleanup(search_tiers.reset_cache)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "maps.json"

    def _load(self, fields, tiers=None):
        self.path.write_text(json.dumps(_maps(fields, tiers)))
        return load_search_tiers(self.path)

    def test_real_repo_maps_load(self):
        # The same field name may be searched in one collection and not another.
        self.assertIsNone(tier_of("CS", "dataset_name"))
        self.assertEqual(tier_of("CSD", "dataset_name"), "label")
        self.assertEqual(tier_of("CL", "label"), "label")
        self.assertIn("norm-lower", analyzers_of("label"))
        self.assertIsNone(tier_of("CL", "not_a_field"))

    def test_tiers_are_read_only(self):
        tiers = self._load([("CL", "label", "label")])
        with self.assertRaises(TypeError):
            tiers.field_tiers[("CL", "label")] = "text"

    def test_unknown_tier_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown search tier"):
            self._load([("CL", "label", "headline")])

    def test_unknown_tier_definition_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown tiers"):
            self._load([("CL", "label", "headline")], tiers={"headline": ["identity"]})

    def test_every_tier_must_be_defined(self):
        with self.assertRaisesRegex(ValueError, "missing tiers"):
            self._load([("CL", "label", "label")], tiers={"label": ["identity"]})

    def test_every_field_must_state_its_tier(self):
        maps = _maps([("CL", "label", "label")])
        del maps["maps"][0][1]["individual_fields"][0]["search_tier"]
        self.path.write_text(json.dumps(maps))
        with self.assertRaisesRegex(ValueError, "missing search_tier"):
            load_search_tiers(self.path)

    def test_analyzers_must_be_a_list_of_names(self):
        with self.assertRaisesRegex(ValueError, "list of analyzer names"):
            self._load([("CL", "label", "label")], tiers={"label": "norm-lower"})

    def test_repeated_field_must_keep_its_tier(self):
        tiers = self._load([("PR", "label", "label"), ("PR", "label", "label")])
        self.assertEqual(tiers.field_tiers[("PR", "label")], "label")
        with self.assertRaisesRegex(ValueError, "listed twice"):
            self._load([("PR", "label", "label"), ("PR", "label", None)])

    def test_unsafe_field_name_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "not a safe AQL identifier"):
            self._load([("CL", "label`) OR true //", "label")])

    def test_one_name_in_two_tiers_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "conflicts"):
            self._load([("CL", "name", "label"), ("GS", "name", "text")])

    def test_untiered_use_of_a_tiered_name_is_allowed(self):
        tiers = self._load(
            [("CS", "dataset_name", None), ("CSD", "dataset_name", "label")]
        )
        self.assertIsNone(tiers.field_tiers[("CS", "dataset_name")])

    def test_missing_file_raises(self):
        with self.assertRaises(OSError):
            load_search_tiers(self.path)

    def test_base_dir_change_reloads(self):
        load_search_tiers()
        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp) / "react" / "src" / "assets"
            assets.mkdir(parents=True)
            maps = _maps([("CL", "label", "text")])
            (assets / "nlm-ckn-collection-maps.json").write_text(json.dumps(maps))
            with override_settings(BASE_DIR=Path(tmp)):
                self.assertEqual(tier_of("CL", "label"), "text")
        self.assertEqual(tier_of("CL", "label"), "label")

    def test_app_ready_fails_when_maps_are_invalid(self):
        with mock.patch.object(search_tiers, "load_search_tiers", side_effect=OSError):
            with self.assertRaises(OSError):
                apps.get_app_config("arango_api").ready()
