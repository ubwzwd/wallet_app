"""The frozen category table, served publicly (03-backend-api.md §5.5).

No auth, no database, no upstream call: the body is a pure serialization of
``core/categories.category_table()``, so it is rendered once per process and
handed out from memory afterwards. ``immutable`` caching is safe because the
front end revalidates with ``If-None-Match`` carrying the version it cached,
and the version changes whenever the table does (decision §1.3, §14.21).
"""
import json
from typing import Optional

from fastapi import APIRouter, Header, Response

from app.core.categories import CATEGORY_VERSION, category_table

router = APIRouter(prefix="/categories", tags=["Categories"])

# One year, the longest max-age worth writing, plus immutable (§5.5).
CACHE_CONTROL = "public, max-age=31536000, immutable"

# The ETag is the category table's version, quoted as HTTP requires.
ETAG = f'"{CATEGORY_VERSION}"'

_serialized_body: Optional[bytes] = None


def _body() -> bytes:
    """The JSON body, built on first use and reused for the process's life."""
    global _serialized_body

    if _serialized_body is None:
        _serialized_body = json.dumps(
            category_table(), ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
    return _serialized_body


def _etag_matches(if_none_match: Optional[str]) -> bool:
    """Does the caller already hold this version? (RFC 9110 §13.1.2)

    A list of candidates, ``*``, and weak validators are all accepted; only an
    exact match on the current version counts as a hit.
    """
    if not if_none_match:
        return False

    for candidate in if_none_match.split(","):
        tag = candidate.strip()
        if tag == "*":
            return True
        if tag.startswith(("W/", "w/")):
            tag = tag[2:].strip()
        if tag == ETAG:
            return True
    return False


@router.get("", summary="The frozen category table")
def get_categories(
    if_none_match: Optional[str] = Header(None, alias="If-None-Match"),
) -> Response:
    """Return the whole category table, or 304 when the caller is current (§5.5)."""
    headers = {"Cache-Control": CACHE_CONTROL, "ETag": ETAG}

    if _etag_matches(if_none_match):
        return Response(status_code=304, headers=headers)

    return Response(content=_body(), media_type="application/json", headers=headers)
