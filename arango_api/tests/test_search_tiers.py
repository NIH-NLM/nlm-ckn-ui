"""Unit tests for the collection-maps reader (no database)."""

import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings

from arango_api.search_tiers import all_map_fields


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
