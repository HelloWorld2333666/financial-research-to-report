"""Export policy (Phase 1's rule, now enforced by the server against the saved deck).

- A **draft** can always be exported. If anything below is unresolved, every slide gets a small
  "DRAFT" banner so the file cannot pass for a final report.
- A **final** export is refused while the saved deck disagrees with the data (integrity mismatch:
  re-project or fix the text first). Everything else that is not certain must be explicitly
  acknowledged: unverified manual edits, placeholders pending research, and figures in text
  without a source. Acknowledgements are recorded with the export.

"A final export certifies nothing on its own" (Phase 1): it records what the analyst accepted.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timezone

import integrity

BANNER = "DRAFT — contains unverified or unresolved content"


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def policy(bundle: dict, deck: bytes | None) -> dict:
    res = integrity.check(deck, bundle["project"], bundle["sidecar"])
    blocking, acknowledge = [], []
    if deck is None:
        blocking.append({"key": "empty", "text": "The project has no deck yet."})
    if res["mismatch"]:
        blocking.append({"key": "integrity", "text": f"{_plural(len(res['mismatch']), 'value')} on the saved deck {'disagrees' if len(res['mismatch']) == 1 else 'disagree'} with the data. "
                         "Re-project from data (or correct the text), save, and export again.", "items": res["mismatch"]})
    if res["unverified"]:
        acknowledge.append({"key": "edits", "text": f"{_plural(len(res['unverified']), 'manually edited value')} not yet verified", "items": res["unverified"]})
    if res["placeholders"]:
        acknowledge.append({"key": "placeholders", "text": f"{_plural(len(res['placeholders']), 'placeholder')} pending research (no data yet)", "items": res["placeholders"]})
    if res["unsourced"]:
        acknowledge.append({"key": "numbers", "text": f"{_plural(len(res['unsourced']), 'number')} in text without a source", "items": res["unsourced"]})
    return {"integrity": {k: v for k, v in res.items() if not isinstance(v, list)} | {"mismatch": len(res["mismatch"])},
            "blocking": blocking, "acknowledge": acknowledge,
            "final_allowed_with": [a["key"] for a in acknowledge] if not blocking else None}


def decide(pol: dict, mode: str, acknowledged: list[str]) -> tuple[bool, str]:
    if mode not in ("draft", "final"):
        return False, "mode must be 'draft' or 'final'"
    if any(b["key"] == "empty" for b in pol["blocking"]):
        return False, "nothing to export"
    if mode == "draft":
        return True, ""
    if pol["blocking"]:
        return False, pol["blocking"][0]["text"]
    missing = [a["text"] for a in pol["acknowledge"] if a["key"] not in acknowledged]
    if missing:
        return False, "Acknowledge before a final export: " + "; ".join(missing)
    return True, ""


def stamp_draft(deck: bytes) -> bytes:
    """Add a small red DRAFT banner to the top-right corner of every slide."""
    src = zipfile.ZipFile(io.BytesIO(deck))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if re.fullmatch(r"ppt/slides/slide\d+\.xml", info.filename):
                xml = data.decode("utf-8")
                nid = 1 + max([int(x) for x in re.findall(r'<p:cNvPr\b[^>]*\bid="(\d+)"', xml)] or [1])
                cx, cy = 3_048_000, 228_600  # 320 x 24 px
                sp = (f'<p:sp><p:nvSpPr><p:cNvPr id="{nid}" name="Draft banner"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
                      f'<p:spPr><a:xfrm><a:off x="{12_192_000 - cx - 381_000}" y="114300"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
                      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="C8102E"/></a:solidFill></p:spPr>'
                      '<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>'
                      '<a:r><a:rPr lang="en-US" sz="800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Inter"/></a:rPr>'
                      f'<a:t>{BANNER}</a:t></a:r></a:p></p:txBody></p:sp>')
                data = xml.replace("</p:spTree>", sp + "</p:spTree>", 1).encode("utf-8")
            dst.writestr(info, data)
    return out.getvalue()


def build(bundle: dict, deck: bytes, mode: str, acknowledged: list[str], pol: dict) -> tuple[bytes, dict]:
    """The exported file and the log record that goes with it."""
    unresolved = bool(pol["acknowledge"] or pol["blocking"])
    data = stamp_draft(deck) if mode == "draft" and unresolved else deck
    record = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "mode": mode, "draft_banner": mode == "draft" and unresolved,
              "acknowledged": [{"key": a["key"], "text": a["text"]} for a in pol["acknowledge"] if mode == "final" and a["key"] in acknowledged],
              "integrity": pol["integrity"]}
    return data, record


def log_line(record: dict) -> str:
    return json.dumps(record, ensure_ascii=False) + "\n"
