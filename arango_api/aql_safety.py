"""
Shared guards for values interpolated into AQL.

Anything in here protects a query-construction path, so it is deliberately
dependency-free: it must stay importable from both the serializer layer (whose
tests run without a database) and the service layer.
"""

import re

# Field names reach AQL as attribute accessors (doc.`<field>`, e.`<field>`), so
# each must be a plain identifier. Rejecting anything else -- backticks, dots,
# whitespace -- prevents AQL injection.
#
# Leading underscores are allowed because the frontend searches system and edge
# attributes such as _from, _to and _key.
#
# \Z (not $) so a trailing newline (e.g. "Label\n") is not accepted.
SAFE_AQL_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\Z")


def is_safe_aql_identifier(name):
    """True if `name` is safe to interpolate into an AQL attribute accessor.

    Anything that is not a string is unsafe by definition, and is reported as
    such rather than raising: a guard that throws where a caller expects a
    predicate invites the failure it exists to prevent.
    """
    return isinstance(name, str) and bool(SAFE_AQL_IDENTIFIER.match(name))


# LIKE treats % and _ as wildcards and \ as their escape. A typed term is
# matched literally, so each gets a backslash, in one pass so the backslashes
# added for % and _ are not escaped again.
_LIKE_SPECIAL = re.compile(r"[\\%_]")


def escape_like(term):
    """Escape `term` so an AQL LIKE pattern matches it literally."""
    return _LIKE_SPECIAL.sub(lambda m: "\\" + m.group(), term)
