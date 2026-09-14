"""Decoding and RFC 4180 splitting of standard import files (05 §1, §7.1).

Nothing here touches the database: reading is pure bytes-in, RawFile-out.
"""
from pathlib import Path

import pytest

from app.services.importing.reading import RawFile, read_paste, read_upload
from app.services.importing.validation import COLUMNS, ImportFormatInvalid

FIXTURES = Path(__file__).parent / "fixtures" / "import"
HEADER_LINE = ",".join(COLUMNS)
VERSION_LINE = "# version: 2026-09-10"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_reads_a_plain_file() -> None:
    raw = read_upload(fixture_bytes("ok_credit_cny.csv"), "ok_credit_cny.csv")

    assert isinstance(raw, RawFile)
    assert raw.version_line == VERSION_LINE
    assert raw.header == list(COLUMNS)
    assert len(raw.rows) == 6
    # Data rows start on physical line 3: version is 1, header is 2.
    assert raw.row_numbers == [3, 4, 5, 6, 7, 8]
    assert raw.rows[0][6] == "盒马鲜生"


def test_strips_the_utf8_bom() -> None:
    data = fixture_bytes("ok_bom.csv")

    assert data.startswith(b"\xef\xbb\xbf")
    raw = read_upload(data, "ok_bom.csv")
    assert raw.version_line == VERSION_LINE
    assert raw.header == list(COLUMNS)
    assert raw.header[0] == "date"  # not "﻿date"


def test_reads_crlf_line_endings() -> None:
    data = fixture_bytes("ok_crlf.csv")

    assert b"\r\n" in data
    raw = read_upload(data, "ok_crlf.csv")
    assert raw.version_line == VERSION_LINE
    assert raw.header == list(COLUMNS)
    assert len(raw.rows) == 3
    assert all(not field.endswith("\r") for row in raw.rows for field in row)


def test_a_quoted_newline_shifts_the_physical_line_numbers() -> None:
    """A record that spans two lines makes row_no and line number diverge."""
    raw = read_upload(fixture_bytes("ok_crlf.csv"), "ok_crlf.csv")

    assert "\n" in raw.rows[1][7]  # the note really does contain a newline
    # Row 2 starts on line 4 and eats line 5, so row 3 starts on line 6.
    assert raw.row_numbers == [3, 4, 6]


def test_quoted_fields_keep_commas_and_escaped_quotes() -> None:
    raw = read_paste(fixture_text("ok_paste_alipay.txt"))

    assert raw.rows[0][7] == '午饭，备注写着 "少放辣"'
    assert raw.rows[5][6] == "张三"


def test_read_paste_strips_fences_and_blank_lines() -> None:
    text = fixture_text("ok_paste_alipay.txt")

    assert text.lstrip().startswith("```")
    raw = read_paste(text)
    assert raw.version_line == VERSION_LINE
    assert raw.header == list(COLUMNS)
    assert len(raw.rows) == 6
    assert raw.row_numbers[0] == 3


def test_read_paste_and_read_upload_agree() -> None:
    text = fixture_text("ok_credit_cny.csv")

    pasted = read_paste(text)
    uploaded = read_upload(text.encode("utf-8"), "ok_credit_cny.csv")
    assert pasted == uploaded


@pytest.mark.parametrize(
    "wrapper",
    [
        "```\n{body}\n```",
        "```csv\n{body}\n```\n",
        "\n\n```csv\n{body}\n```\n\n",
        "{body}",
    ],
    ids=["bare-fence", "tagged-fence", "blank-padded", "no-fence"],
)
def test_fence_variants_all_parse_the_same(wrapper: str) -> None:
    body = f"{VERSION_LINE}\n{HEADER_LINE}\n2026-08-03,-1.00,CNY,expense,,,店,,food,lunch,r1"

    raw = read_paste(wrapper.format(body=body))
    assert raw.version_line == VERSION_LINE
    assert raw.header == list(COLUMNS)
    assert raw.row_numbers == [3]


def test_gbk_file_is_rejected_as_not_utf8() -> None:
    with pytest.raises(ImportFormatInvalid) as excinfo:
        read_upload(fixture_bytes("bad_gbk.csv"), "bad_gbk.csv")

    error = excinfo.value
    assert error.status_code == 400
    assert error.code == "import_format_invalid"
    assert [item["line"] for item in error.errors] == [1]
    assert "UTF-8" in error.errors[0]["message"]
    assert error.body()["errors"] == error.errors


def test_binary_that_survives_the_decoder_is_still_rejected() -> None:
    # UTF-16 decodes as UTF-8 only by accident, and is full of NULs.
    with pytest.raises(ImportFormatInvalid):
        read_upload("# version: 2026-09-10\n".encode("utf-16-le"), "x.csv")


def test_missing_version_line_leaves_the_header_where_it_is() -> None:
    """Reading does not judge: check_shape() reports the missing line (§2.2)."""
    raw = read_upload(fixture_bytes("bad_no_version.csv"), "bad_no_version.csv")

    assert raw.version_line is None
    assert raw.header == list(COLUMNS)
    # Without a version line the first data row is physical line 2.
    assert raw.row_numbers == [2]


def test_a_non_version_comment_is_not_taken_for_a_version_line() -> None:
    raw = read_upload(f"# hello\n{HEADER_LINE}\n".encode(), "x.csv")

    assert raw.version_line is None
    assert raw.header == ["# hello"]


def test_version_line_tolerates_spacing() -> None:
    raw = read_upload(f"#version:2026-09-10\n{HEADER_LINE}\n".encode(), "x.csv")

    assert raw.version_line == "#version:2026-09-10"


def test_trailing_blank_lines_are_ignored() -> None:
    body = f"{VERSION_LINE}\n{HEADER_LINE}\n2026-08-03,-1.00,CNY,expense,,,店,,food,lunch,r1\n\n\n"

    raw = read_upload(body.encode(), "x.csv")
    assert len(raw.rows) == 1


def test_an_interior_blank_line_is_kept_as_a_bad_row() -> None:
    """§1.1 does not accept blank lines in the middle; §2.2 reports them."""
    body = (
        f"{VERSION_LINE}\n{HEADER_LINE}\n"
        "2026-08-03,-1.00,CNY,expense,,,店,,food,lunch,r1\n"
        "\n"
        "2026-08-04,-2.00,CNY,expense,,,店,,food,lunch,r2\n"
    )

    raw = read_upload(body.encode(), "x.csv")
    assert [len(row) for row in raw.rows] == [11, 0, 11]
    assert raw.row_numbers == [3, 4, 5]


def test_an_empty_file_has_no_header_and_no_rows() -> None:
    raw = read_upload(b"", "x.csv")

    assert raw.version_line is None
    assert raw.header is None
    assert raw.rows == []


def test_only_a_version_line_means_no_header() -> None:
    raw = read_upload(f"{VERSION_LINE}\n".encode(), "x.csv")

    assert raw.version_line == VERSION_LINE
    assert raw.header is None
    assert raw.rows == []


def test_filename_never_steers_the_parser() -> None:
    """Decision §6.1: the extension does not choose a reader."""
    body = f"{VERSION_LINE}\n{HEADER_LINE}\n".encode()

    assert read_upload(body, "statement.xlsx") == read_upload(body, "statement.csv")
