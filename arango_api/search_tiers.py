"""Backend reader of the shared collection maps (nlm-ckn-collection-maps.json).

Each map field carries a `search_tier` (label, synonym, identifier, text, or
null for fields search ignores), and the top-level `search_tiers` lists each
tier's analyzers. The ETL links the search view from the same file, so the
backend reading it here keeps the query and the view in step (#345).
"""

import json
from types import MappingProxyType
from typing import NamedTuple

from django.conf import settings
from django.core.signals import setting_changed
from django.dispatch import receiver

from arango_api.aql_safety import is_safe_aql_identifier


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


# The tiers the ETL's create_view links fields by; any other name is a typo.
TIERS = frozenset({"label", "synonym", "identifier", "text"})


class SearchTiers(NamedTuple):
    """Read-only view of the maps' search tiers."""

    analyzers: MappingProxyType  # tier -> tuple of analyzer names
    field_tiers: MappingProxyType  # (collection, field) -> tier or None


_cache = None


def load_search_tiers(path=None):
    """Read and validate the search tiers; the default file is read once.

    Raises:
        OSError: the maps file cannot be read.
        ValueError: a tier is unknown, a field name is not a safe AQL
            identifier, one field name carries two different tiers, or one
            collection lists a field twice with different tiers.
    """
    global _cache
    if path is None and _cache is not None:
        return _cache
    with open(path or maps_path()) as fh:
        data = json.load(fh)
    analyzers = {}
    for tier, names in data["search_tiers"].items():
        # A bare string would become a tuple of its characters.
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise ValueError(f"search_tiers.{tier} must be a list of analyzer names")
        analyzers[tier] = tuple(names)
    if unknown := set(analyzers) - TIERS:
        raise ValueError(f"search_tiers defines unknown tiers {sorted(unknown)}")
    if missing := TIERS - set(analyzers):
        raise ValueError(f"search_tiers is missing tiers {sorted(missing)}")
    field_tiers, tier_by_name = {}, {}
    for collection, config in data["maps"]:
        for field in config.get("individual_fields", []):
            name = field["field_to_display"]
            # Every field states its tier, null included, as the ETL requires.
            if "search_tier" not in field:
                raise ValueError(f"{collection}.{name}: missing search_tier")
            tier = field["search_tier"]
            if not is_safe_aql_identifier(name):
                raise ValueError(f"{collection}.{name}: not a safe AQL identifier")
            if tier is not None and tier not in analyzers:
                raise ValueError(f"{collection}.{name}: unknown search tier {tier!r}")
            # The view links a field name once per collection with its
            # tier's analyzers; one name in two tiers would contradict itself.
            if tier is not None and tier_by_name.setdefault(name, tier) != tier:
                raise ValueError(
                    f"{collection}.{name}: tier {tier!r} conflicts with "
                    f"{tier_by_name[name]!r} elsewhere"
                )
            # A field listed twice in one collection (PR label is) must keep
            # one tier, or the later entry would silently replace it.
            if field_tiers.get((collection, name), tier) != tier:
                raise ValueError(f"{collection}.{name}: listed twice, tiers differ")
            field_tiers[(collection, name)] = tier
    tiers = SearchTiers(MappingProxyType(analyzers), MappingProxyType(field_tiers))
    if path is None:
        _cache = tiers
    return tiers


def tier_of(collection, field):
    """The field's search tier in that collection, or None when it is unsearched."""
    return load_search_tiers().field_tiers.get((collection, field))


def analyzers_of(tier):
    """The analyzers the view links a tier's fields with."""
    return load_search_tiers().analyzers[tier]


def reset_cache():
    """Forget the loaded tiers. Intended for tests."""
    global _cache
    _cache = None


@receiver(setting_changed)
def _reset_on_base_dir_change(*, setting, **kwargs):
    if setting == "BASE_DIR":
        reset_cache()
