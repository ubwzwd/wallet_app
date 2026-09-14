"""Reading §5.37's request body (03-backend-api.md §5.37, 05 §2.1 ①-③).

**No ``router`` here** — ``app.api.iter_routers()`` imports this module and
skips it, exactly as it skips anything else without one.

One route of §5.37 accepts two content types, so the bytes arrive raw and are
taken apart here: a ``multipart/form-data`` envelope with a ``source_id`` and a
``file`` part, or a JSON ``PasteUploadRequest``. Both come out as the same
``(source_id, payload, filename)`` triple, which is what lets everything after
this point in ``create_import`` be one shared path.

The multipart half is parsed here rather than through ``request.form()``,
because Starlette's parser spools a part over 1 MB into a temporary *file* and
decision §14.28 leaves the backend no filesystem state at all. Bytes in, drafts
out, nothing touches disk.
"""
from __future__ import annotations

import uuid

from fastapi import Request
from pydantic import ValidationError

from app.api.import_support import MAX_BYTES, MAX_FILENAME, invalid_form, too_large
from app.schemas.importing import PasteUploadRequest

#: The slack a multipart envelope adds around a file that sits exactly at
#: §2.6's ceiling. The stream is cut at the sum; the 413 of §5.37 is decided on
#: the payload itself.
ENVELOPE_SLACK = 64 * 1024


async def read_request(request: Request) -> tuple[uuid.UUID, bytes | str, str | None]:
    """``(source_id, payload, filename)``; ``filename`` is ``None`` for a paste."""
    body = await _read_capped(request)
    content_type = request.headers.get("content-type", "")
    if content_type.lower().startswith("multipart/form-data"):
        fields = _parse_multipart(body, content_type)
        if "file" not in fields or "source_id" not in fields:
            raise invalid_form("multipart body needs a file and a source_id part")
        filename, data = fields["file"]
        return _as_uuid(fields["source_id"][1]), data, _clean_filename(filename)
    try:
        paste = PasteUploadRequest.model_validate_json(body)
    except ValidationError as exc:
        raise invalid_form(f"body: {exc.error_count()} invalid field(s)") from exc
    return paste.source_id, paste.text, None


async def _read_capped(request: Request) -> bytes:
    """Read the body, giving up as soon as it passes the ceiling (§5.37 step 4).

    The cap runs before the target account is looked up, because ``source_id``
    is *inside* the body: a body too large to read is a 413 with nothing to say
    about the account it names.
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BYTES + ENVELOPE_SLACK:
            raise too_large()
        chunks.append(chunk)
    return b"".join(chunks)


def _parse_multipart(body: bytes, content_type: str) -> dict[str, tuple[str | None, bytes]]:
    """Split a ``multipart/form-data`` body into ``{name: (filename, bytes)}``.

    Deliberately minimal: §5.37's form has exactly two parts, neither of which
    is streamed anywhere, and the whole upload stays in memory (§4.11).
    """
    boundary = _params(content_type.partition(";")[2]).get("boundary")
    if not boundary:
        raise invalid_form("multipart body has no boundary")
    fields: dict[str, tuple[str | None, bytes]] = {}
    for part in body.split(b"--" + boundary.encode("utf-8", "replace"))[1:-1]:
        head, sep, payload = part.lstrip(b"\r\n").partition(b"\r\n\r\n")
        if not sep:
            continue
        disposition: dict[str, str] = {}
        for line in head.decode("utf-8", "replace").splitlines():
            name, _, value = line.partition(":")
            if name.strip().lower() == "content-disposition":
                disposition = _params(value)
        if "name" in disposition:
            if payload.endswith(b"\r\n"):
                payload = payload[:-2]
            fields[disposition["name"]] = (disposition.get("filename"), payload)
    return fields


def _params(text: str) -> dict[str, str]:
    """``form-data; name="file"; filename="a.csv"`` -> its parameters, unquoted."""
    values: dict[str, str] = {}
    for chunk in text.split(";"):
        key, sep, value = chunk.partition("=")
        if sep:
            values[key.strip().lower()] = value.strip().strip('"')
    return values


def _clean_filename(name: str | None) -> str:
    """§5.37: display only — no path, no control characters, at most 200 chars."""
    text = "".join(ch for ch in (name or "") if ch.isprintable()).strip()
    text = text.replace("\\", "/").rsplit("/", 1)[-1]
    return text[:MAX_FILENAME] or "upload.csv"


def _as_uuid(raw: bytes) -> uuid.UUID:
    try:
        return uuid.UUID(raw.decode("utf-8", "replace").strip())
    except ValueError as exc:
        raise invalid_form("source_id is not a UUID") from exc
