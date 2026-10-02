"""Backend reader of the shared collection maps (nlm-ckn-collection-maps.json)."""

import json

from django.conf import settings


def maps_path():
    # Resolved at call time so override_settings(BASE_DIR=...) takes effect.
    return (
        settings.BASE_DIR / "react" / "src" / "assets" / "nlm-ckn-collection-maps.json"
    )


def all_map_fields(path=None):
    """Union of individual_fields[].field_to_display over every collection."""
    with open(path or maps_path()) as fh:
        maps = dict(json.load(fh)["maps"])
    return frozenset(
        field["field_to_display"]
        for config in maps.values()
        for field in config.get("individual_fields", [])
    )
