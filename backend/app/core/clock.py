"""The single "now" every module reads (03-backend-api.md §4.5).

Timestamps are stored in naive UTC ``DateTime`` columns (02-database.md §7.2),
so every writer needs the same two-step dance: ask for an aware UTC time, then
drop the tzinfo. Five modules used to carry a private ``_utcnow`` copy of it;
this is that function, once.
"""
import datetime as dt


def utcnow() -> dt.datetime:
    """Naive UTC ``now``, matching the naive ``DateTime`` columns (§4.5)."""
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)
