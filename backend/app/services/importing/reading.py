"""Decode an uploaded or pasted standard CSV and split it (05 §1).

This module answers exactly one question: *what are the physical pieces of
this file?* — the ``# version:`` line, the header line, and the data records
with the line number each of them starts on. It judges no meaning at all;
every semantic rule is §2, i.e. ``validation.py``.

Two things are worth spelling out:

* **Row numbers are physical line numbers** (1-based, the ``# version:`` line
  is line 1 and the header is line 2). A quoted field may contain newlines, so
  a record's line number is *not* its index — §2.2's error list points users at
  a line in their own editor, so it has to be the real one.
* **Nothing is interpreted.** A ``.csv`` is split by RFC 4180 and by nothing
  else: no format sniffing, no alias headers, no decompression (§6.1).
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass

from app.services.importing.drafts import (
    DECODE_MESSAGE,
    VERSION_RE,
    ImportFormatInvalid,
)

# A chat client often wraps the answer in a ``` fence; §1.4 says strip the
# fence lines and the blank lines around them, then treat the rest as CSV.
_FENCE_RE = re.compile(r"[ \t]*`{3,}[A-Za-z0-9_+-]*[ \t]*")

#: Byte-order mark, as a character — ``utf-8-sig`` eats it for uploads, pasted
#: text arrives as a ``str`` that may still carry one.
_BOM = "﻿"


@dataclass(frozen=True)
class RawFile:
    """A decoded standard file, split by RFC 4180 and not yet interpreted."""

    version_line: str | None  # first line verbatim, e.g. "# version: 2026-09-10"
    header: list[str] | None  # column names split out of the second line
    rows: list[list[str]]  # data records; a record's length may not be 11
    row_numbers: list[int]  # physical 1-based line each record starts on


def read_upload(data: bytes, filename: str) -> RawFile:
    """Split an uploaded ``.csv``.

    UTF-8 with an optional BOM; anything else is 400 ``import_format_invalid``
    (§1.1, §2.2). ``filename`` is carried by the batch row but never steers the
    parser — the extension does not pick a reader (§6.1).
    """
    del filename  # deliberately unused: no format sniffing by extension (§6.1)
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise _decode_error() from exc
    if "\x00" in text:
        # UTF-16/binary that happened to survive the UTF-8 decoder.
        raise _decode_error()
    return _split(text)


def read_paste(text: str) -> RawFile:
    """Split pasted CSV text.

    Same rules as :func:`read_upload` (decision §5); the only difference is
    that a paste comes out of a chat code block, so the leading and trailing
    ``` fence lines and blank lines are stripped first (§1.4).
    """
    return _split(_strip_fences(text))


def _decode_error() -> ImportFormatInvalid:
    """The one-line error list §2.2 shows for an unreadable file."""
    return ImportFormatInvalid(
        [{"line": 1, "message": DECODE_MESSAGE}],
        detail="CSV structure is invalid: file is not UTF-8 text",
    )


def _split(text: str) -> RawFile:
    """Take the version line off the top, then split the rest by RFC 4180."""
    if text.startswith(_BOM):
        text = text[len(_BOM) :]
    version_line, body = _take_version_line(text)
    offset = 1 if version_line is not None else 0

    records: list[list[str]] = []
    starts: list[int] = []
    reader = csv.reader(io.StringIO(body, newline=""))
    previous = 0
    for record in reader:
        starts.append(previous + 1 + offset)
        records.append(record)
        previous = reader.line_num

    # Trailing blank lines are ignored (§1.1); interior ones are not, and fall
    # through to the column-count check of §2.2 as a record of the wrong width.
    while records and _is_blank(records[-1]):
        records.pop()
        starts.pop()

    header = records[0] if records else None
    return RawFile(
        version_line=version_line,
        header=header,
        rows=records[1:],
        row_numbers=starts[1:],
    )


def _take_version_line(text: str) -> tuple[str | None, str]:
    """Return ``(version line or None, the rest of the text)``.

    The version line is matched on the raw first physical line, before CSV
    splitting: it is a comment, not a record. A first line that is not a
    ``# version: <value>`` line is left in the body, where it will be read as
    the header and reported by ``check_shape()`` (decision §14.53d).
    """
    first, rest = _pop_first_line(text)
    if first is None or VERSION_RE.match(first) is None:
        return None, text
    return first.strip(), rest


def _pop_first_line(text: str) -> tuple[str | None, str]:
    """Split off the first physical line, dropping its terminator."""
    if not text:
        return None, text
    index = text.find("\n")
    if index == -1:
        return text.rstrip("\r"), ""
    return text[:index].rstrip("\r"), text[index + 1 :]


def _strip_fences(text: str) -> str:
    """Drop leading/trailing ``` fence lines and blank lines (§1.4)."""
    while True:
        first, rest = _pop_first_line(text)
        if first is None or not _is_fence_or_blank(first):
            break
        text = rest
    text = text.rstrip("\r\n")
    while True:
        index = text.rfind("\n")
        last = text if index == -1 else text[index + 1 :]
        if not _is_fence_or_blank(last.rstrip("\r")):
            break
        text = "" if index == -1 else text[:index].rstrip("\r\n")
        if not text:
            break
    return text


def _is_fence_or_blank(line: str) -> bool:
    return not line.strip() or _FENCE_RE.fullmatch(line) is not None


def _is_blank(record: list[str]) -> bool:
    return all(not field.strip() for field in record)
