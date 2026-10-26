"""Editable slide project model and its integrity rules.

A project is one JSON file holding:
  - ``evidence`` / ``sources`` / ``claims`` / ``gaps``: a read-only snapshot of
    research records, guarded by ``snapshot_sha256``;
  - ``elements``: what appears on the exported slide (text, panels, metric
    cards, tables, bar charts, source notes, gap placeholders);
  - ``annotations``: editing instructions (region or element scoped) that are
    never exported;
  - ``research_requests``: unresolved data needs raised instead of inventing
    numbers.

Bound elements (metric / table cells / chart bars) store an ``evidence_id``,
never the number itself, so moving or restyling them cannot change a figure.
This module is plain Python (stdlib only) and does not import the research
pipeline; it reads the evidence bundle as data.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

SCHEMA = "frr-slide/0.1"
SLIDE_W, SLIDE_H = 1280, 720
ELEMENT_TYPES = {"text", "panel", "metric", "table", "barchart", "timeline", "sources", "gap", "pending"}
GEOMETRY = ("x", "y", "w", "h")
# Fields an AI patch may change on an existing element. Bound-evidence fields,
# refs, ids, types and audit fields are deliberately absent.
PATCHABLE = {"x", "y", "w", "h", "style", "text", "label", "title", "note", "fmt", "group",
             "shape", "footnote", "prefix", "columns", "rows", "bars"}
NUMBER_RE = re.compile(r"(?<![\w.])[-+−]?\d[\d,]*(?:\.\d+)?")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------- snapshot

def snapshot_hash(project: dict) -> str:
    payload = {k: project.get(k, {}) for k in ("evidence", "sources", "claims", "gaps")}
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- evidence views

def _accepted_results(project: dict) -> list[dict]:
    return [r["response"] for r in project.get("research_results", []) if not r.get("reverted")]


def evidence_map(project: dict) -> dict:
    """Bundle snapshot plus evidence from accepted (not reverted) research responses.

    The snapshot itself is never modified; research adds alongside it."""
    merged = dict(project.get("evidence", {}))
    for resp in _accepted_results(project):
        for e in resp.get("evidence") or []:
            merged.setdefault(e["id"], {k: v for k, v in e.items() if k != "id"})
    return merged


def source_map(project: dict) -> dict:
    merged = dict(project.get("sources", {}))
    for resp in _accepted_results(project):
        for s in resp.get("sources") or []:
            merged.setdefault(s["id"], {k: v for k, v in s.items() if k != "id"})
    return merged


# --------------------------------------------------------------------------- bound refs

def bound_evidence_ids(el: dict) -> list[str]:
    """Evidence ids an element renders as numbers (order preserved, duplicates kept)."""
    ids: list[str] = []
    if el.get("type") == "metric":
        ids.append(el.get("evidence_id"))
        if el.get("delta"):
            ids.append(el["delta"].get("from"))
    elif el.get("type") == "table":
        for row in el.get("rows", []):
            for c in row.get("cells", []):
                if "evidence_id" in c:
                    ids.append(c["evidence_id"])
                elif "delta" in c:  # computed change between two evidence values
                    ids += [c["delta"].get("from"), c["delta"].get("to")]
    elif el.get("type") == "barchart":
        ids += [b.get("evidence_id") for b in el.get("bars", [])]
    return [i for i in ids if i]


def element_evidence_ids(el: dict) -> set[str]:
    return set(bound_evidence_ids(el)) | set(el.get("refs", {}).get("evidence", []))


def free_texts(el: dict) -> list[str]:
    """Human-entered text on an element (not rendered from evidence)."""
    texts = [el.get(k) for k in ("text", "label", "title", "note", "footnote", "prefix")]
    if el.get("type") == "table":
        texts += el.get("columns", [])
        for row in el.get("rows", []):
            texts.append(row.get("label"))
            texts += [c.get("text") for c in row.get("cells", []) if "text" in c]
    if el.get("type") == "barchart":
        texts += [b.get("label") for b in el.get("bars", [])]
    if el.get("type") == "timeline":
        for ev in el.get("events", []):
            texts += [ev.get("label"), ev.get("text")]
    if el.get("type") == "pending":  # the user's instruction, not slide content
        texts = []
    return [t for t in texts if isinstance(t, str) and t]


def numbers_in(text: str) -> set[str]:
    out = set()
    for m in NUMBER_RE.findall(text):
        n = m.replace(",", "").replace("−", "-").lstrip("+-")
        if n:
            out.add(n.rstrip("0").rstrip(".") if "." in n else n)
    return out


def _value_forms(value: float) -> set[str]:
    forms = set()
    for scale in (1, 1e3, 1e6, 1e9):
        v = value / scale
        for d in (0, 1, 2):
            s = f"{v:.{d}f}"
            forms.add(s.rstrip("0").rstrip(".") if "." in s else s)
    return forms


def evidence_numbers(project: dict, evidence_ids: set[str]) -> set[str]:
    """Numbers a citation can legitimately support: values (rescaled) and excerpt/statement figures."""
    nums: set[str] = set()
    for eid in evidence_ids:
        ev = evidence_map(project).get(eid)
        if not ev:
            continue
        if isinstance(ev.get("value"), (int, float)):
            nums |= _value_forms(float(ev["value"]))
        nums |= numbers_in(ev.get("excerpt", "")) | numbers_in(ev.get("statement", ""))
        nums |= numbers_in(ev.get("period", ""))
    return nums


# --------------------------------------------------------------------------- structure

def validate_project(project: dict) -> list[str]:
    """Structural errors that make a project unusable (empty list = OK)."""
    errors: list[str] = []
    if project.get("schema") != SCHEMA:
        errors.append(f"schema must be {SCHEMA}")
    project.setdefault("research_results", [])
    for key in ("elements", "annotations", "research_requests", "research_results"):
        if not isinstance(project.get(key), list):
            errors.append(f"{key} must be a list")
    for key in ("evidence", "sources", "claims", "gaps"):
        if not isinstance(project.get(key), dict):
            errors.append(f"{key} must be an object")
    if errors:
        return errors
    seen: set[str] = set()
    for el in project["elements"]:
        eid = el.get("id")
        if not isinstance(eid, str) or not eid:
            errors.append("element without id")
            continue
        if eid in seen:
            errors.append(f"duplicate element id {eid}")
        seen.add(eid)
        if el.get("type") not in ELEMENT_TYPES:
            errors.append(f"{eid}: unknown type {el.get('type')!r}")
        for g in GEOMETRY:
            if not isinstance(el.get(g), (int, float)):
                errors.append(f"{eid}: {g} must be a number")
        if isinstance(el.get("w"), (int, float)) and el["w"] <= 0 or \
                isinstance(el.get("h"), (int, float)) and el["h"] <= 0:
            errors.append(f"{eid}: width and height must be positive")
    for a in project["annotations"]:
        if a.get("kind") not in ("region", "element"):
            errors.append(f"annotation {a.get('id')}: kind must be region or element")
    return errors


# --------------------------------------------------------------------------- integrity

def check_integrity(project: dict) -> list[dict]:
    """Data-safety report. Levels: error (do not export), warning (review), info."""
    issues: list[dict] = []

    def add(level, code, element_id, message):
        issues.append(dict(level=level, code=code, element_id=element_id, message=message))

    if project.get("snapshot_sha256") != snapshot_hash(project):
        add("error", "snapshot_modified", None,
            "The research snapshot (evidence/sources/claims/gaps) differs from the one built from the bundle.")

    evidence, claims = evidence_map(project), project.get("claims", {})
    sources, gaps = source_map(project), project.get("gaps", {})
    from research import results_integrity  # local import: research imports this module
    issues += results_integrity(project)
    shown: set[str] = set()
    for el in project.get("elements", []):
        eid = el["id"]
        refs = el.get("refs", {})
        for kind, table in (("evidence", evidence), ("claims", claims), ("sources", sources), ("gaps", gaps)):
            for ref in refs.get(kind, []):
                if ref not in table:
                    add("error", "dangling_ref", eid, f"references unknown {kind[:-1] if kind != 'evidence' else kind} {ref}")
        for ref in bound_evidence_ids(el):
            if ref not in evidence:
                add("error", "dangling_ref", eid, f"bound to unknown evidence {ref}")
            elif evidence[ref].get("verification") != "verified":
                add("warning", "unverified_value", eid, f"shows unverified evidence {ref}")
        if el.get("type") == "gap" and el.get("gap_id") not in gaps:
            add("error", "dangling_ref", eid, f"gap placeholder for unknown gap {el.get('gap_id')}")
        if el.get("type") == "pending":
            if el.get("state") == "not_available":
                add("info", "research_not_available", eid, "requested data is not available; placeholder kept")
            else:
                add("warning", "pending_research", eid, f"placeholder waiting for research request {el.get('request_id')}")
        fixture = sorted(i for i in element_evidence_ids(el)
                         if sources.get(evidence.get(i, {}).get("source_id"), {}).get("origin") == "fixture")
        if fixture:
            add("error", "fixture_data_on_slide", eid,
                f"shows TEST FIXTURE evidence ({', '.join(fixture)}); not real research, do not publish")
        shown |= element_evidence_ids(el)

        if el.get("detached_from"):
            add("warning", "detached_citation", eid,
                f"value detached from evidence {el['detached_from']}; the shown text is no longer source-bound")
        original = el.get("cited_text_original")
        if original is not None and el.get("text") != original:
            add("warning", "cited_text_edited", eid, "cited text was edited; check it still matches the evidence")
        supported = evidence_numbers(project, element_evidence_ids(el))
        for text in free_texts(el):
            for n in sorted(numbers_in(text) - supported):
                add("warning", "unsourced_number", eid, f"number {n} in text is not found in any cited evidence")

    for eid in project.get("baseline_evidence_shown", []):
        if eid not in shown:
            add("info", "evidence_removed", None, f"evidence {eid} is no longer shown on the slide")
    return issues


# --------------------------------------------------------------------------- change requests

def _bbox(els: list[dict]) -> dict:
    x0 = min(e["x"] for e in els); y0 = min(e["y"] for e in els)
    x1 = max(e["x"] + e["w"] for e in els); y1 = max(e["y"] + e["h"] for e in els)
    return dict(x=x0, y=y0, w=x1 - x0, h=y1 - y0)


def _intersects(el: dict, r: dict) -> bool:
    return el["x"] < r["x"] + r["w"] and el["x"] + el["w"] > r["x"] and \
        el["y"] < r["y"] + r["h"] and el["y"] + el["h"] > r["y"]


def scope_of(project: dict, annotation: dict) -> tuple[list[str], dict]:
    """Element ids in scope and the rectangle new content must stay inside."""
    els = project["elements"]
    if annotation["kind"] == "region":
        r = annotation["rect"]
        return [e["id"] for e in els if _intersects(e, r)], r
    ids = [i for i in annotation.get("element_ids", []) if any(e["id"] == i for e in els)]
    chosen = [e for e in els if e["id"] in ids]
    return ids, (_bbox(chosen) if chosen else dict(x=0, y=0, w=0, h=0))


PATCH_SCHEMA = {
    "type": "object",
    "required": ["request_id", "ops"],
    "properties": {
        "request_id": {"type": "string"},
        "summary": {"type": "string"},
        "ops": {"type": "array", "items": {"type": "object", "required": ["op"], "properties": {
            "op": {"enum": ["update", "add", "delete"]},
            "id": {"type": "string"},
            "set": {"type": "object"},
            "element": {"type": "object"}}}},
        "research_requests": {"type": "array", "items": {"type": "object", "required": ["description"],
                                                         "properties": {"description": {"type": "string"}}}},
    },
}

RULES = [
    "Only change elements listed in scope_element_ids; new elements must fit inside scope_rect.",
    "Never write financial figures as text. Show numbers with metric/table/barchart elements bound to an "
    "evidence_id from evidence_available.",
    "Do not change evidence_id, refs, ids or types of existing elements, and do not remove citations.",
    "If the instruction needs data that is not in evidence_available, add a research_requests entry "
    "instead of inventing a number.",
    "Keep text concise and factual; interpretations must stay consistent with the cited claims.",
]


def build_change_request(project: dict, annotation_id: str) -> dict:
    ann = next((a for a in project["annotations"] if a["id"] == annotation_id), None)
    if ann is None:
        raise KeyError(f"unknown annotation {annotation_id}")
    ids, rect = scope_of(project, ann)
    by_id = {e["id"]: e for e in project["elements"]}
    used = set().union(*(element_evidence_ids(by_id[i]) for i in ids)) if ids else set()
    evmap = evidence_map(project)
    return {
        "schema": "frr-slide-change-request/0.1",
        "request_id": annotation_id,
        "project": project.get("id"),
        "created": now_iso(),
        "instruction": ann.get("instruction", ""),
        "kind": ann["kind"],
        "slide_size": {"w": SLIDE_W, "h": SLIDE_H},
        "scope_rect": rect,
        "scope_element_ids": ids,
        "elements_in_scope": [by_id[i] for i in ids],
        "other_elements": [{k: e[k] for k in ("id", "type", "x", "y", "w", "h")}
                           for e in project["elements"] if e["id"] not in ids],
        "evidence_in_scope": {k: evmap[k] for k in sorted(used) if k in evmap},
        "evidence_available": {k: {f: v.get(f) for f in ("metric_id", "subject", "period", "value", "unit",
                                                          "kind", "statement", "verification")}
                               for k, v in evmap.items() if v.get("verification") == "verified"},
        "gaps": project.get("gaps", {}),
        "rules": RULES,
        "patch_schema": PATCH_SCHEMA,
    }


def render_prompt(request: dict) -> str:
    return (
        "You are editing one region of a financial research slide. Reply with JSON only, matching "
        "patch_schema. Coordinates are slide pixels (1280x720).\n\nRules:\n- "
        + "\n- ".join(request["rules"])
        + f"\n\nInstruction: {request['instruction']}\n\nChange request:\n"
        + json.dumps(request, ensure_ascii=False, indent=1)
    )


# --------------------------------------------------------------------------- patch validation

def _inside(el: dict, r: dict, tol: float = 8) -> bool:
    return el["x"] >= r["x"] - tol and el["y"] >= r["y"] - tol and \
        el["x"] + el["w"] <= r["x"] + r["w"] + tol and el["y"] + el["h"] <= r["y"] + r["h"] + tol


def validate_patch(project: dict, annotation_id: str, patch: dict) -> tuple[list[str], dict | None]:
    """Check a proposed patch against its request scope and data rules.

    Returns (errors, patched_project). The patch is applied all-or-nothing:
    any error returns (errors, None) and the project is untouched.
    """
    errors: list[str] = []
    ann = next((a for a in project["annotations"] if a["id"] == annotation_id), None)
    if ann is None:
        return [f"unknown annotation {annotation_id}"], None
    if patch.get("request_id") != annotation_id:
        errors.append("patch request_id does not match the annotation")
    if not isinstance(patch.get("ops"), list):
        return errors + ["patch.ops must be a list"], None

    scope_ids, rect = scope_of(project, ann)
    new = copy.deepcopy(project)
    by_id = {e["id"]: e for e in new["elements"]}
    evidence = evidence_map(new)

    def check_numbers(el: dict, where: str) -> None:
        supported = evidence_numbers(new, element_evidence_ids(el))
        for text in free_texts(el):
            for n in sorted(numbers_in(text) - supported):
                errors.append(f"{where}: number {n} in text is not backed by cited evidence")

    def check_bound(el: dict, where: str) -> None:
        for ref in bound_evidence_ids(el):
            if ref not in evidence:
                errors.append(f"{where}: unknown evidence {ref}")
            elif evidence[ref].get("verification") != "verified":
                errors.append(f"{where}: evidence {ref} is not verified")
        for ref in el.get("refs", {}).get("evidence", []):
            if ref not in evidence:
                errors.append(f"{where}: unknown evidence {ref}")

    for i, op in enumerate(patch["ops"]):
        where = f"op {i} ({op.get('op')})"
        kind = op.get("op")
        if kind in ("update", "delete"):
            target = by_id.get(op.get("id"))
            if target is None:
                errors.append(f"{where}: unknown element {op.get('id')}")
                continue
            if op["id"] not in scope_ids:
                errors.append(f"{where}: element {op['id']} is outside the request scope")
                continue
            if kind == "delete":
                new["elements"].remove(target)
                del by_id[op["id"]]
                continue
            changes = op.get("set") or {}
            illegal = set(changes) - PATCHABLE
            if illegal:
                errors.append(f"{where}: may not change {', '.join(sorted(illegal))} on {op['id']}")
                continue
            before = sorted(bound_evidence_ids(target))
            target.update(copy.deepcopy(changes))
            if sorted(bound_evidence_ids(target)) != before:
                errors.append(f"{where}: changes which evidence {op['id']} displays")
            if any(not isinstance(target[g], (int, float)) for g in GEOMETRY):
                errors.append(f"{where}: geometry must be numeric")
            elif not _inside(target, rect) and any(g in changes for g in GEOMETRY):
                errors.append(f"{where}: moves {op['id']} outside the request region")
            check_numbers(target, where)
        elif kind == "add":
            el = copy.deepcopy(op.get("element") or {})
            if el.get("type") not in ELEMENT_TYPES - {"sources"}:
                errors.append(f"{where}: unsupported element type {el.get('type')!r}")
                continue
            if any(not isinstance(el.get(g), (int, float)) for g in GEOMETRY):
                errors.append(f"{where}: new element needs numeric x, y, w, h")
                continue
            if not _inside(el, rect):
                errors.append(f"{where}: new element lies outside the request region")
            for audit in ("cited_text_original", "detached_from"):
                el.pop(audit, None)
            el["id"] = new_id("ai")
            el.setdefault("refs", {})
            el["created_by"] = f"patch:{annotation_id}"
            check_bound(el, where)
            check_numbers(el, where)
            new["elements"].append(el)
            by_id[el["id"]] = el
        else:
            errors.append(f"{where}: unknown op")

    for rr in patch.get("research_requests", []) or []:
        desc = (rr or {}).get("description", "").strip()
        if not desc:
            errors.append("research request without description")
            continue
        new["research_requests"].append(dict(id=new_id("rr"), description=desc, status="open",
                                             source=f"patch:{annotation_id}", created=now_iso()))

    errors += validate_project(new)
    if errors:
        return errors, None
    for a in new["annotations"]:
        if a["id"] == annotation_id:
            a["status"] = "applied"
            a["applied"] = now_iso()
            a["patch_summary"] = patch.get("summary", "")
    return [], new
