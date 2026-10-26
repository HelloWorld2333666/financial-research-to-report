"""Deterministic check of evidence against local copies of its source PDFs.

For each evidence item with a ``page`` and ``excerpt`` this confirms that:
  1. the local file matches the source's recorded SHA-256 (same document);
  2. the excerpt appears verbatim on that PDF page (whitespace/quote-insensitive);
  3. for metric values, the recorded number appears inside the excerpt.

This proves the record matches the document, not that the document is right
or that the excerpt was read in the correct table column. A human or visual
check is still needed for the latter.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from frr.schema import EvidenceBundle, EvidenceKind

_QUOTES = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})


@dataclass(frozen=True)
class CheckResult:
    evidence_id: str
    status: str  # "ok" | "fail" | "skipped"
    detail: str

    def to_dict(self) -> dict:
        return asdict(self)


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text.translate(_QUOTES)).strip()


def number_forms(value: float) -> set[str]:
    """Ways a number may be printed in a filing."""
    forms = {f"{value:g}", f"{value:.2f}", f"{value:,.2f}"}
    if float(value).is_integer():
        forms |= {f"{int(value)}", f"{int(value):,}"}
    return forms


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_pdf_pages(path: Path) -> list[str]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # optional dependency
        raise RuntimeError("PDF checks need pypdf: pip install -e '.[pdf]'") from exc
    return [page.extract_text() or "" for page in PdfReader(str(path)).pages]


def check_bundle(bundle: EvidenceBundle, pages_by_source: dict[str, list[str]],
                 sha_by_source: dict[str, str] | None = None) -> list[CheckResult]:
    """Check evidence against already-extracted page texts (index 0 = PDF page 1)."""
    sources = {s.id: s for s in bundle.sources}
    sha_by_source = sha_by_source or {}
    results: list[CheckResult] = []
    for e in bundle.evidence:
        if not (e.page and e.excerpt):
            results.append(CheckResult(e.id, "skipped", "no page/excerpt"))
            continue
        if e.source_id not in pages_by_source:
            results.append(CheckResult(e.id, "skipped", f"no local copy of {e.source_id}"))
            continue
        expected_sha = sources[e.source_id].content_sha256 if e.source_id in sources else None
        actual_sha = sha_by_source.get(e.source_id)
        if expected_sha and actual_sha and expected_sha != actual_sha:
            results.append(CheckResult(e.id, "fail", "local file does not match source content_sha256"))
            continue
        pages = pages_by_source[e.source_id]
        if e.page > len(pages):
            results.append(CheckResult(e.id, "fail", f"page {e.page} beyond document length {len(pages)}"))
            continue
        excerpt = normalise(e.excerpt)
        if excerpt not in normalise(pages[e.page - 1]):
            results.append(CheckResult(e.id, "fail", f"excerpt not found on PDF page {e.page}"))
            continue
        if e.kind == EvidenceKind.metric_value and e.value is not None:
            if not any(form in excerpt for form in number_forms(e.value)):
                results.append(CheckResult(e.id, "fail", f"value {e.value:g} not present in excerpt"))
                continue
        results.append(CheckResult(e.id, "ok", f"excerpt found on PDF page {e.page}"))
    return results


def check_bundle_files(bundle: EvidenceBundle, files: dict[str, Path]) -> list[CheckResult]:
    pages = {sid: read_pdf_pages(path) for sid, path in files.items()}
    shas = {sid: sha256_file(path) for sid, path in files.items()}
    return check_bundle(bundle, pages, shas)
