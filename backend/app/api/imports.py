"""Import batch and draft row endpoints (03-backend-api.md §5.37-§5.44).

Eight routes with almost no rules of their own: reading and validating a
standard CSV is ``services/importing`` (05 §2), the four flags are §3,
committing and reverting are §4.7-§4.8, and everything these routes then *do*
with a request — the two bodies of §5.37, the derived batch fields of §4.9, the
draft-row edit rules of §4.1 — lives in ``import_support.py`` next door. What
is left here is the HTTP surface: paths, parameters, status codes, and the
commit of the transaction the services only ever flush into.

Two things worth knowing before reading on:

* **§5.37 is one route for two content types.** FastAPI cannot declare a body
  that is *either* ``multipart/form-data`` *or* JSON, so the route takes the raw
  ``Request`` and branches on ``Content-Type``; both halves then walk the same
  validation, as decision §5 requires.
* **Three service errors carry more than ``{detail, code}``**
  (``ImportFormatInvalid`` / ``SkillOutdated`` / ``CommitRejected``). The shared
  handler in ``core/errors.py`` renders only those two keys, so the routes that
  can raise them catch them and render ``exc.body()`` themselves.

Logging follows §6.3 to the letter: ids, counts and the skill version — never a
filename, never a field of any row.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Path, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import import_support as support
from app.core import ratelimit
from app.core.categories import CATEGORY_VERSION
from app.core.clock import utcnow
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import (
    LedgerContext,
    Pagination,
    client_name,
    get_ledger_member,
    pagination,
)
from app.core.errors import ApiError, ErrorCode
from app.models.import_batch import ImportBatch, ImportRow
from app.schemas.common import ListResponse
from app.schemas.importing import (
    ImportBatchResponse,
    ImportBatchStatus,
    ImportCommitResult,
    ImportDeleteResult,
    ImportFlag,
    ImportRowPatch,
    ImportRowResponse,
    ImportRowsBulkPatch,
    ImportRowsBulkResult,
    ImportRowStatus,
    ImportUploadResult,
)
from app.services.importing import committing, flagging, reading, validation
from app.services.importing.commit_checks import CommitRejected
from app.services.importing.drafts import (
    ImportContext,
    ImportFormatInvalid,
    SkillOutdated,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ledgers/{id}/imports", tags=["Imports"])

#: Decision §5: ten batches per user per hour, one bucket (03 §8.2).
IMPORT_LIMIT = ratelimit.Limit(settings.RATE_LIMIT_IMPORTS_PER_HOUR, 3600.0)


# ---------------------------------------------------------------------------
# §5.37 POST /ledgers/{id}/imports
# ---------------------------------------------------------------------------


@router.post("", response_model=ImportUploadResult, status_code=status.HTTP_201_CREATED)
async def create_import(
    request: Request,
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
):
    """Validate a standard CSV and store it as a ``ready`` batch (§5.37, 05 §2.1).

    Synchronous end to end: no background task, no polling, no model call. The
    statements below are §2.1's order — rate limit, target account, size, decode,
    structure, version, row count — and none of the first six writes a row, so a
    file that trips any of them leaves no batch behind. From step 7 on every
    problem is a row-level ``hint`` the user settles in the review table.

    The bytes are dropped as soon as the drafts exist: nothing is written to
    disk, only ``filename`` and ``size_bytes`` survive (§4.11, decision §14.28).
    """
    ratelimit.check("import", str(ctx.user.id), IMPORT_LIMIT)
    source_id, payload, filename = await support.read_request(request)
    source = support.load_source(db, ctx, source_id)

    data = payload.encode("utf-8") if isinstance(payload, str) else payload
    if len(data) > support.MAX_BYTES:
        raise support.too_large()

    ictx = ImportContext(
        ledger_id=ctx.ledger.id,
        source_id=source.id,
        source_currency=source.default_currency,
        source_type=source.type,
        base_currency=ctx.ledger.base_currency,
        actor_id=ctx.user.id,
        category_version=CATEGORY_VERSION,
    )
    try:
        raw = (
            reading.read_paste(payload)
            if filename is None
            else reading.read_upload(data, filename)
        )
        validation.check_shape(raw)
        skill_version = validation.check_version(raw, CATEGORY_VERSION)
        drafts = validation.normalize_rows(raw, ictx)  # also §2.6's row ceiling
    except (ImportFormatInvalid, SkillOutdated) as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.body())

    flagging.flag_rows(db, ictx, drafts)
    now = utcnow()
    batch = ImportBatch(
        ledger_id=ctx.ledger.id,
        source_id=source.id,
        created_by=ctx.user.id,
        source="paste" if filename is None else "csv",
        filename=filename,
        size_bytes=len(data),
        skill_version=skill_version,
        status="ready",
        row_count=len(drafts),
        warnings=[],
        created_at=now,
        updated_at=now,
    )
    db.add(batch)
    db.flush()
    rows = [support.draft_row(batch.id, draft, now) for draft in drafts]
    db.add_all(rows)
    db.flush()

    result = ImportUploadResult(
        batch=support.batch_items(db, ctx, [batch])[0],
        rows=[ImportRowResponse.model_validate(row) for row in rows],
    )
    db.commit()
    logger.info(  # §6.3: ids, counts, version — no filename, no row content
        "import batch %s ledger %s source %s rows %d version %s",
        batch.id,
        ctx.ledger.id,
        source.id,
        len(rows),
        skill_version,
    )
    return result


# ---------------------------------------------------------------------------
# §5.38 / §5.39 batch history
# ---------------------------------------------------------------------------


@router.get("", response_model=ListResponse[ImportBatchResponse])
def list_imports(
    batch_status: Optional[list[ImportBatchStatus]] = Query(
        None, alias="status", description="Repeatable: ready | committed"
    ),
    page: Pagination = Depends(pagination),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> ListResponse[ImportBatchResponse]:
    """Batch history, newest first (§5.38).

    A reverted batch is gone rather than listed: there is no third status and no
    "reverted" row to show (decisions §14.22, §14.52 B1).
    """
    stmt = select(ImportBatch).where(ImportBatch.ledger_id == ctx.ledger.id)
    if batch_status:
        stmt = stmt.where(ImportBatch.status.in_(list(batch_status)))
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    batches = list(
        db.execute(
            stmt.order_by(ImportBatch.created_at.desc(), ImportBatch.id)
            .limit(page.limit)
            .offset(page.offset)
        )
        .scalars()
        .all()
    )
    return ListResponse(items=support.batch_items(db, ctx, batches), total=total)


@router.get("/{bid}", response_model=ImportBatchResponse)
def get_import(
    bid: uuid.UUID = Path(..., description="Import batch id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> ImportBatchResponse:
    """One batch, same shape as the list item (§5.39); its rows are §5.40.

    Not a polling target — there is no progress to poll. It is what the review
    page re-reads for the summary numbers after a few edits, and for
    ``committed_at`` after a commit.
    """
    return support.batch_items(db, ctx, [support.load_batch(db, ctx, bid)])[0]


# ---------------------------------------------------------------------------
# §5.40 - §5.42 draft rows
# ---------------------------------------------------------------------------


@router.get("/{bid}/rows", response_model=ListResponse[ImportRowResponse])
def list_import_rows(
    bid: uuid.UUID = Path(..., description="Import batch id"),
    row_status: Optional[list[ImportRowStatus]] = Query(
        None, alias="status", description="Repeatable: pending | edited | skipped"
    ),
    flag: Optional[list[ImportFlag]] = Query(
        None, description="Repeatable; a row carrying any of them is returned"
    ),
    flagged: Optional[bool] = Query(None, description="true: only rows with flags"),
    uncategorized: Optional[bool] = Query(
        None, description="true: only rows commit would refuse as uncategorized"
    ),
    limit: int = Query(100, ge=1, le=500, description="Page size, 1..500"),
    offset: int = Query(0, ge=0),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> ListResponse[ImportRowResponse]:
    """The batch's draft rows, ``row_no`` ascending, with §4.2's filters.

    ``flag`` / ``flagged`` are applied in Python because ``flags`` is a JSON
    column: a batch holds at most ``IMPORT_MAX_ROWS`` rows — the upload response
    already hands them over in one piece — so reading them to filter costs one
    query either way. The two booleans filter only when ``true``; ``false`` is
    read as "no opinion", since §5.40 gives them no negative meaning.
    """
    batch = support.load_batch(db, ctx, bid)
    stmt = select(ImportRow).where(ImportRow.batch_id == batch.id)
    if row_status:
        stmt = stmt.where(ImportRow.status.in_(list(row_status)))
    if uncategorized:
        stmt = stmt.where(
            ImportRow.status != "skipped",
            ImportRow.kind.is_distinct_from("transfer"),
            ImportRow.category_l1.is_(None),
        )
    rows = list(db.execute(stmt.order_by(ImportRow.row_no)).scalars().all())
    if flag:
        wanted = set(flag)
        rows = [row for row in rows if wanted & set(row.flags or ())]
    elif flagged:
        rows = [row for row in rows if row.flags]
    page = rows[offset : offset + limit]
    return ListResponse(
        items=[ImportRowResponse.model_validate(row) for row in page], total=len(rows)
    )


@router.patch("/{bid}/rows/{rid}", response_model=ImportRowResponse)
def patch_import_row(
    body: ImportRowPatch,
    bid: uuid.UUID = Path(..., description="Import batch id"),
    rid: uuid.UUID = Path(..., description="Draft row id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> ImportRowResponse:
    """Edit one draft row (§5.41).

    No optimistic concurrency — the body carries no ``updated_at`` and the last
    write wins; a batch being reviewed by two people at once is not what the
    lock of decision §2 is for. ``transactions`` is untouched and no event is
    written: a draft is not a transaction yet.
    """
    batch = support.ready_batch(db, ctx, bid)
    row = db.execute(
        select(ImportRow).where(ImportRow.id == rid, ImportRow.batch_id == batch.id)
    ).scalar_one_or_none()
    if row is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, "Draft row not found")
    support.patch_rows(db, ctx, batch, [row], body)
    result = ImportRowResponse.model_validate(row)
    db.commit()
    return result


@router.patch("/{bid}/rows", response_model=ImportRowsBulkResult)
def patch_import_rows(
    body: ImportRowsBulkPatch,
    bid: uuid.UUID = Path(..., description="Import batch id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    db: Session = Depends(get_db),
) -> ImportRowsBulkResult:
    """Apply one patch to 1..500 rows, all or nothing (§5.42).

    A row that fails validation takes the whole call down — including the rows
    already patched in it — and answers 400 naming the offending ``row_no``: 40
    rows set to "food" of which three are income rows must not leave a
    half-applied state nobody asked for.
    """
    batch = support.ready_batch(db, ctx, bid)
    wanted = list(dict.fromkeys(body.row_ids))
    found = {
        row.id: row
        for row in db.execute(
            select(ImportRow).where(
                ImportRow.batch_id == batch.id, ImportRow.id.in_(wanted)
            )
        )
        .scalars()
        .all()
    }
    if len(found) != len(wanted):
        raise ApiError(
            404,
            "not_found",
            f"{len(wanted) - len(found)} row(s) do not belong to this batch",
        )
    rows = sorted(found.values(), key=lambda row: row.row_no)
    support.patch_rows(db, ctx, batch, rows, body.patch)
    result = ImportRowsBulkResult(
        updated=len(rows),
        rows=[ImportRowResponse.model_validate(row) for row in rows],
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# §5.43 / §5.44 commit and undo
# ---------------------------------------------------------------------------


@router.post("/{bid}/commit", response_model=ImportCommitResult)
def commit_import(
    bid: uuid.UUID = Path(..., description="Import batch id"),
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
):
    """Book every non-skipped row of the batch in one transaction (§5.43).

    No request body (decision §14.18): a second click is stopped by the 409
    ``batch_already_committed`` the locked batch row produces, not by an
    ``updated_at`` the caller would have to carry around.
    """
    support.load_batch(db, ctx, bid)
    try:
        result = committing.commit_batch(db, bid, ctx.user.id, client)
    except ApiError as exc:
        db.rollback()  # §4.7: the batch stays `ready`, the drafts untouched
        if isinstance(exc, CommitRejected):
            return JSONResponse(status_code=exc.status_code, content=exc.body())
        raise
    db.commit()
    logger.info("import batch %s committed, %d transaction(s)", bid, result.transaction_count)
    return ImportCommitResult(
        batch_id=bid,
        status="committed",
        created_transactions=result.transaction_count,
        created_transfer_pairs=result.created_transfer_pairs,
        paired_existing_transfers=result.paired_count,
        linked_refunds=result.linked_refunds,
        skipped_rows=result.skipped_rows,
        committed_at=result.committed_at,
    )


@router.delete("/{bid}", response_model=ImportDeleteResult)
def delete_import(
    bid: uuid.UUID = Path(..., description="Import batch id"),
    dry_run: bool = Query(False, description="Only count what a real call would do"),
    ctx: LedgerContext = Depends(get_ledger_member),
    client: Optional[str] = Depends(client_name),
    db: Session = Depends(get_db),
) -> ImportDeleteResult:
    """Discard a ``ready`` batch or revert a ``committed`` one (§5.44).

    A member may do both (decision §14.52 B9). This is the one delete endpoint
    answering 200 with a body instead of 204, because the two counts of B24 are
    what the confirmation dialog is built from — and they mean opposite things:
    ``orphaned_refunds`` are refunds *outside* the batch losing their original,
    ``refunds_in_batch`` are refunds *inside* it whose originals get room back.
    """
    support.load_batch(db, ctx, bid)
    result = committing.delete_batch(db, bid, ctx.user.id, client, dry_run=dry_run)
    payload = ImportDeleteResult(
        batch_id=bid,
        mode=result.mode,
        would_delete_transactions=result.transaction_count if dry_run else None,
        deleted_transactions=None if dry_run else result.transaction_count,
        orphaned_refunds=result.orphaned_refunds,
        refunds_in_batch=result.refunds_in_batch,
        deleted=result.deleted,
    )
    if not dry_run:
        db.commit()
        logger.info(
            "import batch %s %s, %d transaction(s)", bid, result.mode, result.transaction_count
        )
    return payload
