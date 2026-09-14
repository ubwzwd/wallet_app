"""Tests for the import batch / draft row schemas (03-backend-api.md §5.37-§5.44).

Pure pydantic unit tests, field-by-field against the sample JSON bodies in
03 §5.37-§5.44: shape, Decimal digit counts, the explicit-null semantics
§5.41 spells out (every editable field but ``status``), the "unset" vs.
"explicit null" distinction ``exclude_unset=True`` must expose, ``extra`` ==
"forbid" on the request models, and that the four read-only draft-row fields
(``row_no``/``source_ref``/``flags``/``hint``) plus ``transaction_id`` /
``source_id`` are unreachable through ``ImportRowPatch``. Business rules
(category legality, sign-vs-kind, refund/pair legality) are service-layer
territory and intentionally not exercised here.
"""
import datetime as dt
import json
import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.importing import (
    ImportBatchResponse,
    ImportCommitResult,
    ImportDeleteResult,
    ImportFlagsSummary,
    ImportRowPatch,
    ImportRowResponse,
    ImportRowStatusSummary,
    ImportRowsBulkPatch,
    ImportRowsBulkResult,
    ImportRowsBulkRowPatch,
    ImportUploadResult,
    PasteUploadRequest,
)

UID = uuid.uuid4


# ---------------------------------------------------------------------------
# helpers — kwargs mirroring the §5.37 sample JSON exactly
# ---------------------------------------------------------------------------


def _batch_kwargs(**overrides: object) -> dict:
    base = dict(
        id=uuid.UUID("d1e2f3a4-5566-4778-899a-bbccddeeff00"),
        ledger_id=uuid.UUID("8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31"),
        source_id=UID(),
        source_name="招商 信用卡",
        source="csv",
        filename="2026-08-cmb-credit.csv",
        size_bytes=18432,
        skill_version="2026-09-10",
        status="ready",
        row_count=128,
        net_amount=Decimal("-4210.55"),
        base_currency="CNY",
        flags_summary={
            "duplicate": 3,
            "refund_candidate": 1,
            "transfer_candidate": 2,
            "needs_review": 7,
        },
        row_status_summary={"pending": 128, "edited": 0, "skipped": 0},
        uncategorized_count=5,
        warnings=[],
        created_by=UID(),
        created_at=dt.datetime(2026, 9, 9, 7, 0, 0),
        updated_at=dt.datetime(2026, 9, 9, 7, 0, 0),
        committed_at=None,
    )
    base.update(overrides)
    return base


def _row1_kwargs(**overrides: object) -> dict:
    """The first sample row of §5.40 (plain expense, no candidates)."""
    base = dict(
        id=uuid.UUID("e5f6a7b8-0000-0000-0000-000000000000"),
        batch_id=uuid.UUID("d1e2f3a4-5566-4778-899a-bbccddeeff00"),
        row_no=1,
        status="pending",
        date=dt.date(2026, 8, 3),
        amount=Decimal("-128.50"),
        currency="CNY",
        kind="expense",
        merchant="全家便利店",
        note="FAMILYMART 3521",
        category_l1="food",
        category_l2="snacks_drinks",
        source_ref="p1:l14",
        flags=[],
        matched_transaction_id=None,
        counterpart_source_id=None,
        counterparty=None,
        transfer_role=None,
        transfer_subtype=None,
        hint=None,
        transaction_id=None,
    )
    base.update(overrides)
    return base


def _row2_kwargs(**overrides: object) -> dict:
    """The second sample row of §5.40 (transfer candidate,预填 matched_transaction_id)."""
    base = dict(
        id=uuid.UUID("f6a7b8c9-0000-0000-0000-000000000000"),
        batch_id=uuid.UUID("d1e2f3a4-5566-4778-899a-bbccddeeff00"),
        row_no=2,
        status="pending",
        date=dt.date(2026, 8, 5),
        amount=Decimal("3000"),
        currency="CNY",
        kind="transfer",
        merchant=None,
        note="AUTOPAY",
        category_l1=None,
        category_l2=None,
        source_ref="p1:l22",
        flags=["transfer_candidate"],
        matched_transaction_id=uuid.UUID("3c3c3c3c-4d4d-4e4e-8f8f-909090909090"),
        counterpart_source_id=uuid.UUID("34fa63d8-5776-4775-982b-4d58deb0ace9"),
        counterparty=None,
        transfer_role="in",
        transfer_subtype="repayment",
        hint="在「招商 储蓄卡」上找到 8 月 5 日同额转出，已默认勾选「关联为一笔转账」",
        transaction_id=None,
    )
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# PasteUploadRequest — §5.37 branch B
# ---------------------------------------------------------------------------


def test_paste_upload_request_shape():
    req = PasteUploadRequest(source_id=UID(), text="# version: 2026-09-10\n...")
    assert isinstance(req.source_id, uuid.UUID)


def test_paste_upload_request_forbids_extra_fields():
    with pytest.raises(ValidationError):
        PasteUploadRequest(source_id=UID(), text="x", filename="sneaky.csv")


def test_paste_upload_request_requires_both_fields():
    with pytest.raises(ValidationError):
        PasteUploadRequest(text="x")
    with pytest.raises(ValidationError):
        PasteUploadRequest(source_id=UID())


# ---------------------------------------------------------------------------
# ImportBatchResponse — §5.37 / §5.38 / §5.39
# ---------------------------------------------------------------------------


def test_import_batch_response_matches_5_37_sample_json_field_by_field():
    batch = ImportBatchResponse(**_batch_kwargs())
    data = json.loads(batch.model_dump_json())
    assert data == {
        "id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
        "ledger_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
        "source_id": str(batch.source_id),
        "source_name": "招商 信用卡",
        "source": "csv",
        "filename": "2026-08-cmb-credit.csv",
        "size_bytes": 18432,
        "skill_version": "2026-09-10",
        "status": "ready",
        "row_count": 128,
        "net_amount": "-4210.5500",
        "base_currency": "CNY",
        "flags_summary": {
            "duplicate": 3,
            "refund_candidate": 1,
            "transfer_candidate": 2,
            "needs_review": 7,
        },
        "row_status_summary": {"pending": 128, "edited": 0, "skipped": 0},
        "uncategorized_count": 5,
        "warnings": [],
        "created_by": str(batch.created_by),
        "created_at": "2026-09-09T07:00:00.000000Z",
        "updated_at": "2026-09-09T07:00:00.000000Z",
        "committed_at": None,
    }


def test_import_batch_response_net_amount_quantized_to_4dp():
    batch = ImportBatchResponse(**_batch_kwargs(net_amount=Decimal("-4210.55")))
    assert batch.net_amount == Decimal("-4210.5500")


def test_import_batch_response_source_is_csv_or_paste_only():
    with pytest.raises(ValidationError):
        ImportBatchResponse(**_batch_kwargs(source="json"))
    ImportBatchResponse(**_batch_kwargs(source="paste", filename=None))


def test_import_batch_response_status_is_ready_or_committed_only():
    with pytest.raises(ValidationError):
        ImportBatchResponse(**_batch_kwargs(status="parsing"))


def test_import_batch_response_committed_at_can_be_set():
    batch = ImportBatchResponse(
        **_batch_kwargs(status="committed", committed_at=dt.datetime(2026, 9, 9, 7, 20, 31))
    )
    data = json.loads(batch.model_dump_json())
    assert data["committed_at"] == "2026-09-09T07:20:31.000000Z"


def test_import_batch_response_warnings_null_column_normalizes_to_empty_list():
    """The ``warnings`` column is nullable; the wire contract never sends ``null``
    (03 §5.37: "没有警告时是空数组")."""
    batch = ImportBatchResponse(**_batch_kwargs(warnings=None))
    assert batch.warnings == []


def test_import_flags_summary_and_row_status_summary_are_exact_shapes():
    flags = ImportFlagsSummary(
        duplicate=3, refund_candidate=1, transfer_candidate=2, needs_review=7
    )
    statuses = ImportRowStatusSummary(pending=128, edited=0, skipped=0)
    assert flags.needs_review == 7
    assert statuses.skipped == 0


# ---------------------------------------------------------------------------
# ImportRowResponse — §5.40
# ---------------------------------------------------------------------------


def test_import_row_response_matches_5_40_sample_row_1():
    row = ImportRowResponse(**_row1_kwargs())
    data = json.loads(row.model_dump_json())
    assert data == {
        "id": "e5f6a7b8-0000-0000-0000-000000000000",
        "batch_id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
        "row_no": 1,
        "status": "pending",
        "date": "2026-08-03",
        "amount": "-128.5000",
        "currency": "CNY",
        "kind": "expense",
        "merchant": "全家便利店",
        "note": "FAMILYMART 3521",
        "category_l1": "food",
        "category_l2": "snacks_drinks",
        "source_ref": "p1:l14",
        "flags": [],
        "matched_transaction_id": None,
        "counterpart_source_id": None,
        "counterparty": None,
        "transfer_role": None,
        "transfer_subtype": None,
        "hint": None,
        "transaction_id": None,
    }


def test_import_row_response_matches_5_40_sample_row_2():
    row = ImportRowResponse(**_row2_kwargs())
    data = json.loads(row.model_dump_json())
    assert data["amount"] == "3000.0000"
    assert data["flags"] == ["transfer_candidate"]
    assert data["matched_transaction_id"] == "3c3c3c3c-4d4d-4e4e-8f8f-909090909090"
    assert data["counterpart_source_id"] == "34fa63d8-5776-4775-982b-4d58deb0ace9"
    assert data["transfer_role"] == "in"
    assert data["transfer_subtype"] == "repayment"
    assert data["hint"].startswith("在「招商 储蓄卡」")


def test_import_row_response_date_field_reads_occurred_at_orm_attribute():
    """Decision §14.41's 02-D-3: the column/dataclass field is ``occurred_at``,
    the wire field stays ``date`` — the response schema must bridge that."""

    class FakeOrmRow:
        """A stand-in for a SQLAlchemy ``ImportRow`` instance."""

        def __init__(self) -> None:
            self.id = UID()
            self.batch_id = UID()
            self.row_no = 3
            self.status = "pending"
            self.occurred_at = dt.date(2026, 8, 9)
            self.amount = Decimal("-68")
            self.currency = "CNY"
            self.kind = "expense"
            self.merchant = "星巴克"
            self.note = None
            self.category_l1 = "food"
            self.category_l2 = "snacks_drinks"
            self.source_ref = "p1:8"
            self.flags = []
            self.matched_transaction_id = None
            self.counterpart_source_id = None
            self.counterparty = None
            self.transfer_role = None
            self.transfer_subtype = None
            self.hint = None
            self.transaction_id = None

    row = ImportRowResponse.model_validate(FakeOrmRow())
    assert row.date == dt.date(2026, 8, 9)
    assert json.loads(row.model_dump_json())["date"] == "2026-08-09"


def test_import_row_response_flags_null_column_normalizes_to_empty_list():
    row = ImportRowResponse(**_row1_kwargs(flags=None))
    assert row.flags == []


def test_import_row_response_kind_and_flags_are_closed_enums():
    with pytest.raises(ValidationError):
        ImportRowResponse(**_row1_kwargs(kind="withdrawal"))
    with pytest.raises(ValidationError):
        ImportRowResponse(**_row1_kwargs(flags=["merged_duplicate"]))


def test_import_row_response_business_columns_can_all_be_null():
    """Decision §1.3: a draft row is allowed to have every business column
    empty except ``row_no``/``status`` — the response schema must not reject
    that (commit-time completeness is a service-layer 409, not a schema 422)."""
    row = ImportRowResponse(
        **_row1_kwargs(
            date=None,
            amount=None,
            currency=None,
            kind=None,
            merchant=None,
            note=None,
            category_l1=None,
            category_l2=None,
            source_ref=None,
        )
    )
    assert row.date is None and row.amount is None and row.kind is None


# ---------------------------------------------------------------------------
# ImportUploadResult — §5.37 201 body
# ---------------------------------------------------------------------------


def test_import_upload_result_carries_batch_and_all_rows():
    result = ImportUploadResult(
        batch=ImportBatchResponse(**_batch_kwargs()),
        rows=[ImportRowResponse(**_row1_kwargs()), ImportRowResponse(**_row2_kwargs())],
    )
    data = json.loads(result.model_dump_json())
    assert data["batch"]["row_count"] == 128
    assert len(data["rows"]) == 2
    assert data["rows"][0]["row_no"] == 1
    assert data["rows"][1]["row_no"] == 2


# ---------------------------------------------------------------------------
# ImportRowPatch — §5.41
# ---------------------------------------------------------------------------


def test_import_row_patch_all_fields_optional_and_extra_forbidden():
    patch = ImportRowPatch()
    assert patch.model_fields_set == set()
    with pytest.raises(ValidationError):
        ImportRowPatch(nonsense="x")


@pytest.mark.parametrize(
    "field,value",
    [
        ("date", None),
        ("amount", None),
        ("currency", None),
        ("kind", None),
        ("merchant", None),
        ("note", None),
        ("category_l1", None),
        ("category_l2", None),
        ("matched_transaction_id", None),
        ("counterpart_source_id", None),
        ("counterparty", None),
        ("transfer_role", None),
        ("transfer_subtype", None),
    ],
)
def test_import_row_patch_editable_fields_accept_explicit_null(field, value):
    """§5.41: every field in the table but ``status`` is typed ``... | null`` and
    an explicit ``null`` is a deliberate "clear"."""
    patch = ImportRowPatch(**{field: value})
    assert getattr(patch, field) is None
    assert field in patch.model_fields_set


def test_import_row_patch_status_rejects_explicit_null():
    """§5.41: ``status`` is the one field typed plain ``str``, not ``str | null`` —
    there is no "unset" row status to clear it to."""
    with pytest.raises(ValidationError):
        ImportRowPatch(status=None)


def test_import_row_patch_status_enum():
    ImportRowPatch(status="skipped")
    with pytest.raises(ValidationError):
        ImportRowPatch(status="confirmed")


def test_import_row_patch_omitted_vs_explicit_null_distinguishable():
    """The "not present at all" vs. "explicitly null" distinction the task spec
    calls out, read back via ``exclude_unset=True`` (the same technique
    ``TransactionPatch`` tests use)."""
    patch = ImportRowPatch(category_l1="food")
    dumped = patch.model_dump(exclude_unset=True)
    assert dumped == {"category_l1": "food"}
    assert "category_l2" not in dumped
    assert "date" not in dumped

    patch_cleared = ImportRowPatch(category_l1="food", category_l2=None)
    dumped_cleared = patch_cleared.model_dump(exclude_unset=True)
    assert dumped_cleared == {"category_l1": "food", "category_l2": None}


@pytest.mark.parametrize("field", ["row_no", "source_ref", "flags", "hint", "transaction_id"])
def test_import_row_patch_read_only_fields_are_422(field):
    """§5.41: ``row_no``/``source_ref``/``flags``/``hint``/``transaction_id`` are
    read-only and simply absent from the model, so sending them is an unknown
    field under ``extra='forbid'``."""
    with pytest.raises(ValidationError):
        ImportRowPatch(**{field: "x"})


def test_import_row_patch_source_id_is_not_editable():
    """Decision §14.52 A5: one file, one target account — ``source_id`` is not
    in the editable set (use ``counterpart_source_id`` for the other leg)."""
    with pytest.raises(ValidationError):
        ImportRowPatch(source_id=str(UID()))


def test_import_row_patch_currency_pattern_and_uppercase():
    patch = ImportRowPatch(currency="sgd")
    assert patch.currency == "SGD"
    with pytest.raises(ValidationError):
        ImportRowPatch(currency="sg1")


def test_import_row_patch_amount_rejects_zero_but_quantizes_nonzero():
    with pytest.raises(ValidationError):
        ImportRowPatch(amount=Decimal("0"))
    patch = ImportRowPatch(amount=Decimal("-128.5"))
    assert patch.amount == Decimal("-128.5000")


def test_import_row_patch_kind_and_transfer_enums():
    with pytest.raises(ValidationError):
        ImportRowPatch(kind="withdrawal")
    with pytest.raises(ValidationError):
        ImportRowPatch(transfer_role="left")
    with pytest.raises(ValidationError):
        ImportRowPatch(transfer_subtype="installment")


def test_import_row_patch_length_limits():
    with pytest.raises(ValidationError):
        ImportRowPatch(merchant="x" * 201)
    with pytest.raises(ValidationError):
        ImportRowPatch(note="x" * 501)
    with pytest.raises(ValidationError):
        ImportRowPatch(counterparty="x" * 101)


def test_import_row_patch_counterparty_strips_and_blank_becomes_null():
    """Decision §14.10: ``strip()`` first, an empty result stores as ``null``."""
    patch = ImportRowPatch(counterparty="  老婆  ")
    assert patch.counterparty == "老婆"
    patch_blank = ImportRowPatch(counterparty="   ")
    assert patch_blank.counterparty is None
    assert "counterparty" in patch_blank.model_fields_set


# ---------------------------------------------------------------------------
# ImportRowsBulkPatch / ImportRowsBulkResult — §5.42
# ---------------------------------------------------------------------------


def test_import_rows_bulk_patch_shape_and_row_id_bounds():
    bulk = ImportRowsBulkPatch(
        row_ids=[UID(), UID()], patch=ImportRowsBulkRowPatch(status="skipped")
    )
    assert len(bulk.row_ids) == 2
    with pytest.raises(ValidationError):
        ImportRowsBulkPatch(row_ids=[], patch=ImportRowsBulkRowPatch())
    with pytest.raises(ValidationError):
        ImportRowsBulkPatch(
            row_ids=[UID() for _ in range(501)], patch=ImportRowsBulkRowPatch()
        )


@pytest.mark.parametrize(
    "field,value",
    [
        ("matched_transaction_id", str(UID())),
        ("counterpart_source_id", str(UID())),
        ("counterparty", "老婆"),
        ("matched_transaction_id", None),  # not even an explicit "clear them all"
    ],
)
def test_bulk_patch_refuses_the_three_per_row_link_fields(field, value):
    """05 §4.1: those three name *one* counterpart for *one* row, so they are not
    in §5.42's set — the same ``matched_transaction_id`` on two rows is a
    guaranteed ``pair_invalid`` at commit. ``extra='forbid'`` makes it a 422.
    (03 §5.42's "same fields as §5.41" is the blanket cross-reference the
    ruling reads as losing to 05 §4.1's specific rule — schema docstring.)
    """
    with pytest.raises(ValidationError):
        ImportRowsBulkRowPatch(**{field: value})
    with pytest.raises(ValidationError):
        ImportRowsBulkPatch(row_ids=[UID()], patch={field: value})

    # ... while the single-row model of §5.41 still takes all three.
    assert field in ImportRowPatch(**{field: value}).model_fields_set


def test_bulk_patch_keeps_the_other_eleven_editable_fields():
    """Narrowed by exactly three: everything else §5.41 edits stays bulk-settable."""
    assert set(ImportRowsBulkRowPatch.model_fields) == set(ImportRowPatch.model_fields) - {
        "matched_transaction_id",
        "counterpart_source_id",
        "counterparty",
    }
    patch = ImportRowsBulkRowPatch(
        status="skipped",
        date=dt.date(2026, 8, 3),
        amount=Decimal("-128.5"),
        currency="sgd",
        kind="expense",
        merchant="盒马",
        note="n",
        category_l1="food",
        category_l2="lunch",
        transfer_role=None,
        transfer_subtype=None,
    )
    assert len(patch.model_fields_set) == 11
    assert patch.currency == "SGD"  # the shared validators come along
    assert patch.amount == Decimal("-128.5000")
    with pytest.raises(ValidationError):
        ImportRowsBulkRowPatch(status=None)
    with pytest.raises(ValidationError):
        ImportRowsBulkRowPatch(nonsense="x")


def test_import_rows_bulk_result_shape():
    result = ImportRowsBulkResult(updated=2, rows=[ImportRowResponse(**_row1_kwargs())])
    data = json.loads(result.model_dump_json())
    assert data["updated"] == 2
    assert len(data["rows"]) == 1


# ---------------------------------------------------------------------------
# ImportCommitResult — §5.43
# ---------------------------------------------------------------------------


def test_import_commit_result_matches_5_43_sample():
    result = ImportCommitResult(
        batch_id=uuid.UUID("d1e2f3a4-5566-4778-899a-bbccddeeff00"),
        status="committed",
        created_transactions=121,
        created_transfer_pairs=2,
        paired_existing_transfers=1,
        linked_refunds=3,
        skipped_rows=7,
        committed_at=dt.datetime(2026, 9, 9, 7, 20, 31),
    )
    data = json.loads(result.model_dump_json())
    assert data == {
        "batch_id": "d1e2f3a4-5566-4778-899a-bbccddeeff00",
        "status": "committed",
        "created_transactions": 121,
        "created_transfer_pairs": 2,
        "paired_existing_transfers": 1,
        "linked_refunds": 3,
        "skipped_rows": 7,
        "committed_at": "2026-09-09T07:20:31.000000Z",
    }


def test_import_commit_result_status_is_literal_committed():
    with pytest.raises(ValidationError):
        ImportCommitResult(
            batch_id=UID(),
            status="ready",
            created_transactions=0,
            created_transfer_pairs=0,
            paired_existing_transfers=0,
            linked_refunds=0,
            skipped_rows=0,
            committed_at=dt.datetime(2026, 9, 9, 7, 20, 31),
        )


# ---------------------------------------------------------------------------
# ImportDeleteResult — §5.44
# ---------------------------------------------------------------------------


def test_import_delete_result_dry_run_shape_matches_5_44_sample():
    result = ImportDeleteResult(
        batch_id=uuid.UUID("8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31"),
        mode="revert",
        would_delete_transactions=123,
        orphaned_refunds=2,
        refunds_in_batch=4,
        deleted=False,
    )
    data = json.loads(result.model_dump_json())
    assert data == {
        "batch_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
        "mode": "revert",
        "would_delete_transactions": 123,
        "orphaned_refunds": 2,
        "refunds_in_batch": 4,
        "deleted": False,
    }
    assert "deleted_transactions" not in data


def test_import_delete_result_real_delete_shape_matches_5_44_sample():
    result = ImportDeleteResult(
        batch_id=uuid.UUID("8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31"),
        mode="revert",
        deleted_transactions=123,
        orphaned_refunds=2,
        refunds_in_batch=4,
        deleted=True,
    )
    data = json.loads(result.model_dump_json())
    assert data == {
        "batch_id": "8f0f7b2e-2a20-4c39-9c0f-2a9d5a1b6c31",
        "mode": "revert",
        "deleted_transactions": 123,
        "orphaned_refunds": 2,
        "refunds_in_batch": 4,
        "deleted": True,
    }
    assert "would_delete_transactions" not in data


def test_import_delete_result_discard_mode_shape():
    result = ImportDeleteResult(
        batch_id=UID(),
        mode="discard",
        deleted_transactions=0,
        orphaned_refunds=0,
        refunds_in_batch=0,
        deleted=True,
    )
    data = json.loads(result.model_dump_json())
    assert data["mode"] == "discard"
    assert data["deleted_transactions"] == 0


def test_import_delete_result_mode_is_discard_or_revert_only():
    with pytest.raises(ValidationError):
        ImportDeleteResult(
            batch_id=UID(),
            mode="reverted",
            deleted_transactions=0,
            orphaned_refunds=0,
            refunds_in_batch=0,
            deleted=True,
        )
