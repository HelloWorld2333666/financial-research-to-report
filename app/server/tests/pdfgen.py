"""A minimal PDF writer for test fixtures (text pages, Helvetica). No third-party dependency.

The fixture press release is from a FICTIONAL agency ("Example Ratings") and says so on every page;
it exists only to exercise pypdf extraction and the excerpt verification.
"""

from __future__ import annotations


def pdf(pages: list[list[str]]) -> bytes:
    objs: list[bytes] = []

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    kids, page_ids = [], []
    pages_id = len(objs) + 1 + 2 * len(pages)  # reserved below
    for lines in pages:
        ops = ["BT", "/F1 10 Tf", "13 TL", "56 780 Td"]
        for line in lines:
            esc = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"({esc}) '")
        ops.append("ET")
        stream = "\n".join(ops).encode("cp1252")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page_ids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Contents %d 0 R /Resources << /Font << /F1 %d 0 R >> >> >>" % (pages_id, content, font)))
    kids = b" ".join(b"%d 0 R" % i for i in page_ids)
    assert add(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(page_ids))) == pages_id
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, xref)
    return bytes(out)


FIXTURE_PAGES = [
    ["TEST FIXTURE - fictional agency, not a real rating action", "",
     "Example Ratings affirms France at AA-; Outlook Negative", "14 March 2025", "",
     "Example Ratings GmbH has affirmed the Republic of France's long-term", "issuer rating at AA- with a Negative Outlook.",
     "The affirmation reflects a large and diversified economy, offset by", "high public debt of 113% of GDP and persistent fiscal deficits.", "",
     "Example Ratings could downgrade the rating if the debt ratio does not stabilise."],
    ["TEST FIXTURE - fictional agency, not a real rating action", "",
     "KEY RATING DRIVERS", "France's fiscal deficit narrowed only slowly. The short-term rating", "was affirmed at S-1+.", "",
     "Example Ratings previously downgraded France to AA- in 2024."],
]


def fixture_pdf() -> bytes:
    return pdf(FIXTURE_PAGES)
