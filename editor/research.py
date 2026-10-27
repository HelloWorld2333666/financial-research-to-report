"""Research-backed additions requested from the slide canvas.

Flow (see editor/RESEARCH_CONTRACT.md):
  1. classify(): decide whether an instruction is a layout edit, can be built
     from existing verified evidence, or needs new research. Deterministic
     keyword rules; no model calls.
  2. create_request(): store a structured Research Request in the project and
     put an editable "pending research" placeholder in the drawn region.
  3. A Research Engine (not part of this prototype) returns a response file.
  4. apply_response(): validate the response and either insert a chart /
     table / timeline / metric at the placeholder, or record that the data is
     not available. Existing evidence is never overwritten.
  5. revert_insertion(): put the placeholder back; the request returns to
     pending and its history keeps both events.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re

import slidemodel as sm

REQUEST_SCHEMA = "frr-research-request/0.1"
RESPONSE_SCHEMA = "frr-research-response/0.1"
OPEN_STATUSES = {"pending_research", "partially_fulfilled", "not_available"}
VISUAL_TYPES = {"barchart", "table", "timeline", "metric"}

CONTENT_TYPES = [  # (content_type, preferred visualization, patterns)
    ("barchart", "horizontal bar chart", r"\bbar ?chart|\bchart\b|\bgraph\b|\bbreakdown\b|\bdistribution\b"),
    ("timeline", "timeline", r"\btimeline\b|\bmilestones?\b|\bchronolog"),
    ("table", "table", r"\btable\b|\bmatrix\b"),
    ("metric", "metric cards", r"\bmetrics?\b|\bkpis?\b|\b2\s*[x×]\s*2\b"),
]
RESEARCH_VERBS = r"\bresearch\b|\blook up\b|\bfind (out|the)\b|\bverify\b|\bsource\b|\bdata (for|on)\b"
LAYOUT_VERBS = (r"\bmove\b|\bresize\b|\breorgani[sz]e\b|\brearrange\b|\balign\b|\bswap\b|\bcolumns?\b|\brows?\b|"
                r"\bgrid\b|\bshrink\b|\benlarge\b|\bbigger\b|\bsmaller\b|\brestyle\b|\bcolou?r\b|\bfont\b|"
                r"\bspacing\b|\bshorten\b|\brewrite\b|\bmerge\b|\bsplit\b|\breorder\b|\bdelete\b|\bremove\b")
ADD_VERBS = r"\badd\b|\binsert\b|\bshow\b|\binclude\b|\bcreate\b|\bnew\b|\bplace\b"

# Topic -> (instruction pattern, evidence predicate). A topic is "covered" when
# verified evidence matching the predicate exists in the project.
TOPICS = {
    "geography": (r"\bgeograph|\bcountr|\bregion(al)?\b|\boverseas\b|\bdomestic\b|\binternational\b",
                  lambda e: False),  # no evidence predicate: geographic splits must come from research
    "history": (r"\bmilestone|\bhistory\b|\bestablish|\bfounded|\blisting\b|\blisted\b|\bipo\b|\btimeline\b",
                lambda e: e.get("kind") == "fact" and bool(re.search(
                    r"establish|founded|restructur|listed|originat", e.get("statement", ""), re.I))),
    # Topics the current bundle has no evidence for at all.
    "business_developments": (r"\bbusiness developments?\b|\bacquisitions?\b|\bexpansion\b|\bstrategic (moves|events)\b",
                              lambda e: False),
    "ownership": (r"\bshareholder|\bownership|\bcontrol", lambda e: "shareholder" in e.get("statement", "").lower()),
    "revenue": (r"\brevenue\b|\bincome\b|\bsales\b|\bpremium",
                lambda e: e.get("metric_id") in ("m.revenue", "m.insurance_revenue")),
    "profit": (r"\bprofit\b|\bearnings\b|\bnet income\b", lambda e: e.get("metric_id") == "m.net_profit"),
    "roe": (r"\broe\b|\breturn on equity\b", lambda e: e.get("metric_id") == "m.roe"),
    "assets": (r"\bassets\b|\bbalance sheet\b", lambda e: e.get("metric_id") == "m.total_assets"),
    "underwriting": (r"\bcombined ratio\b|\bunderwriting\b|\bloss ratio\b", lambda e: e.get("metric_id") == "m.combined_ratio"),
    "solvency": (r"\bsolvency\b|\bcapital\b", lambda e: (e.get("metric_id") or "").startswith(("m.solvency", "m.core_solvency"))),
    "ratings": (r"\brating", lambda e: "rating" in e.get("statement", "").lower()),
    "financial_metrics": (r"\bfinancial metrics\b|\bkey metrics\b|\bkpis?\b",
                          lambda e: e.get("kind") == "metric_value"),
}


def _sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def classify(project: dict, instruction: str) -> dict:
    """Guess the intent of a canvas instruction. The user can always override it."""
    text = (instruction or "").lower()
    content_type, visualization = None, None
    for ct, vis, pat in CONTENT_TYPES:
        if re.search(pat, text):
            content_type, visualization = ct, vis
            break
    topics = [t for t, (pat, _) in TOPICS.items() if re.search(pat, text)]
    evidence = sm.evidence_map(project)
    verified = {k: v for k, v in evidence.items() if v.get("verification") == "verified"}
    matched, uncovered = {}, []
    for t in topics:
        ids = sorted(k for k, v in verified.items() if TOPICS[t][1](v))
        if ids:
            matched[t] = ids
        else:
            uncovered.append(t)
    wants_research = bool(re.search(RESEARCH_VERBS, text))
    adds_content = bool(re.search(ADD_VERBS, text)) and content_type is not None
    layout_only = bool(re.search(LAYOUT_VERBS, text)) and not adds_content and not wants_research

    reasons = []
    if layout_only or (not adds_content and not wants_research and not uncovered):
        intent = "layout"
        reasons.append("rearranges or restyles existing content")
    elif uncovered or (wants_research and not matched):
        intent = "research"
        if uncovered:
            reasons.append("no verified evidence yet for: " + ", ".join(uncovered))
        if wants_research:
            reasons.append("the instruction asks for research or verification")
    else:
        intent = "existing_data"
        reasons.append("can be built from verified evidence already in the project")
        if wants_research:
            reasons.append("existing evidence covers the requested topics, so no new research is triggered")
    gaps = [gid for gid, g in project.get("gaps", {}).items()
            if any(re.search(TOPICS[t][0], (g.get("description") or "").lower()) for t in uncovered)]
    period = re.search(r"\bfy\s?(20\d{2})\b|\b(20\d{2})\b", text)
    return {
        "intent": intent,
        "content_type": content_type or ("text" if intent != "layout" else None),
        "visualization": visualization,
        "topics": topics,
        "matched_evidence": matched,
        "uncovered_topics": uncovered,
        "related_gaps": gaps,
        "period": f"FY{period.group(1) or period.group(2)}" if period else None,
        "geographic_scope": ("country" if re.search(r"\bcountr", text) else
                             "region" if re.search(r"\bregion", text) else None),
        "excludes_estimates": bool(re.search(r"\bdo not estimate\b|\bno estimates?\b|\bundisclosed\b|\bdon't estimate\b", text)),
        "reasons": reasons,
    }


def create_request(project: dict, instruction: str, region: dict, overrides: dict | None = None) -> tuple[dict, dict]:
    """Add a pending Research Request and its placeholder. Returns (new_project, request)."""
    if not instruction or not instruction.strip():
        raise ValueError("instruction is required")
    if any(not isinstance(region.get(k), (int, float)) for k in ("x", "y", "w", "h")) or region["w"] < 8 or region["h"] < 8:
        raise ValueError("region needs numeric x, y, w, h of at least 8px")
    cls = classify(project, instruction)
    cls.update({k: v for k, v in (overrides or {}).items() if k in ("content_type", "visualization", "period", "geographic_scope")})
    new = copy.deepcopy(project)
    rid, pid = sm.new_id("rr"), sm.new_id("pending")
    related = sorted({i for ids in cls["matched_evidence"].values() for i in ids})
    company = new.get("generated_from", {}).get("company")
    required = [f"{t.replace('_', ' ')} data" + (f" ({cls['geographic_scope']} level)" if t == "geography" and cls["geographic_scope"] else "")
                + (f", {cls['period']}" if cls["period"] else "") for t in cls["uncovered_topics"]] or \
               ["data needed to fulfil the instruction (not identified automatically)"]
    request = {
        "schema": REQUEST_SCHEMA, "id": rid, "status": "pending_research", "kind": "research",
        "instruction": instruction.strip(), "created": sm.now_iso(),
        "slide_id": new.get("id"), "region": {k: round(region[k]) for k in ("x", "y", "w", "h")},
        "placeholder_element_id": pid,
        "content_type": cls["content_type"], "visualization": cls["visualization"],
        "objective": instruction.strip(),
        "company": company, "period": cls["period"], "geographic_scope": cls["geographic_scope"],
        "metric_definitions": [], "required_data": required,
        "constraints": (["Do not estimate undisclosed values."] if cls["excludes_estimates"] else [])
                       + ["Return only verified figures with source, page and excerpt."],
        "related_evidence_ids": related, "related_gaps": cls["related_gaps"],
        "classification": {k: cls[k] for k in ("intent", "topics", "uncovered_topics", "reasons")},
        "history": [{"at": sm.now_iso(), "event": "created", "detail": "pending research"}],
    }
    new["research_requests"].append(request)
    new["elements"].append({
        "id": pid, "type": "pending", "x": request["region"]["x"], "y": request["region"]["y"],
        "w": request["region"]["w"], "h": request["region"]["h"], "request_id": rid, "state": "pending_research",
        "title": f"Pending research: {cls['visualization'] or cls['content_type'] or 'content'}",
        "text": instruction.strip(), "refs": {}, "style": {},
    })
    return new, request


def export_request(project: dict, request_id: str) -> dict:
    """The handoff document a Research Engine receives."""
    req = _request(project, request_id)
    ev = sm.evidence_map(project)
    return {**copy.deepcopy(req), "project": project.get("id"),
            "related_evidence": {i: ev[i] for i in req.get("related_evidence_ids", []) if i in ev},
            "existing_evidence_ids": sorted(ev),
            "response_schema": RESPONSE_SCHEMA}


def _request(project: dict, request_id: str) -> dict:
    req = next((r for r in project.get("research_requests", []) if r.get("id") == request_id), None)
    if req is None:
        raise KeyError(f"unknown research request {request_id}")
    return req


def _visual_element(spec: dict, geom: dict, evidence: dict, rid: str) -> tuple[dict, list[str]]:
    errors: list[str] = []
    vtype = spec.get("type")
    base = {"id": sm.new_id("rs"), "x": geom["x"], "y": geom["y"], "w": geom["w"], "h": geom["h"],
            "refs": {}, "created_by": f"research:{rid}", "style": {"fill": "#ffffff", "borderColor": "#d5dbe3"}}
    if vtype == "barchart":
        items = spec.get("items") or []
        if not items:
            errors.append("barchart needs at least one item")
        ids = [i.get("evidence_id") for i in items]
        metas = [evidence.get(i, {}) for i in ids]
        for field in ("metric_id", "unit", "period"):
            vals = {m.get(field) for m in metas if m}
            if len(vals) > 1:
                errors.append(f"bars mix different {field}s ({', '.join(sorted(map(str, vals)))}); not comparable")
        el = {**base, "type": "barchart", "title": spec.get("title", ""), "fmt": spec.get("fmt", {}),
              "bars": [{"label": i.get("label", ""), "evidence_id": i.get("evidence_id")} for i in items]}
    elif vtype == "timeline":
        events = spec.get("events") or []
        if not events:
            errors.append("timeline needs at least one event")
        el = {**base, "type": "timeline", "title": spec.get("title", ""),
              "events": [{"label": e.get("label", ""), "text": e.get("text", ""), "evidence_id": e.get("evidence_id")}
                         for e in events]}
        el["refs"] = {"evidence": [e.get("evidence_id") for e in events if e.get("evidence_id")]}
    elif vtype == "table":
        el = {**base, "type": "table", "columns": spec.get("columns", []), "footnote": spec.get("footnote", ""),
              "rows": [{"label": r.get("label", ""), "cells": [{"evidence_id": c, "fmt": spec.get("fmt", {})}
                                                               for c in r.get("evidence_ids", [])]}
                       for r in spec.get("rows", [])]}
    elif vtype == "metric":
        el = {**base, "type": "metric", "label": spec.get("label", ""), "evidence_id": spec.get("evidence_id"),
              "fmt": spec.get("fmt", {}), "note": spec.get("note", "")}
    else:
        return {}, [f"unsupported visualization type {vtype!r}"]
    return el, errors


def apply_response(project: dict, response: dict) -> tuple[list[str], list[str], dict | None]:
    """Validate a Research Engine response and apply it. Returns (errors, warnings, new_project)."""
    errors: list[str] = []
    warnings: list[str] = []
    if response.get("schema") != RESPONSE_SCHEMA:
        return [f"response schema must be {RESPONSE_SCHEMA}"], [], None
    try:
        req = _request(project, response.get("request_id"))
    except KeyError as exc:
        return [str(exc)], [], None
    if req["status"] not in ("pending_research", "partially_fulfilled"):
        return [f"request {req['id']} is {req['status']}; revert the earlier result before applying another"], [], None
    status = response.get("status")
    if status not in ("fulfilled", "partially_fulfilled", "not_available"):
        return ["status must be fulfilled, partially_fulfilled or not_available"], [], None

    existing_ev, existing_src = sm.evidence_map(project), sm.source_map(project)
    new_src = {s["id"]: s for s in response.get("sources", []) if isinstance(s, dict) and s.get("id")}
    new_ev = {e["id"]: e for e in response.get("evidence", []) if isinstance(e, dict) and e.get("id")}
    for sid, s in new_src.items():
        if sid in existing_src and existing_src[sid] != s:
            errors.append(f"source {sid} already exists with different content; use a new id")
        if s.get("origin") == "fixture":
            warnings.append(f"source {sid} is a TEST FIXTURE; its figures are not real research")
    for eid, e in new_ev.items():
        if eid in existing_ev:
            errors.append(f"evidence {eid} already exists; responses may not overwrite existing evidence")
        if e.get("source_id") not in new_src and e.get("source_id") not in existing_src:
            errors.append(f"evidence {eid} cites unknown source {e.get('source_id')}")
        if e.get("verification") != "verified":
            errors.append(f"evidence {eid} is not verified")
        if e.get("kind") == "metric_value":
            missing = [f for f in ("metric_id", "value", "unit", "period") if e.get(f) in (None, "")]
            if missing:
                errors.append(f"evidence {eid} is missing {', '.join(missing)}")
        if not (e.get("page") and e.get("excerpt")):
            warnings.append(f"evidence {eid} has no page/excerpt locator")

    vis = response.get("visualization")
    if status == "not_available" and vis:
        errors.append("a not_available response must not include a visualization")
    if status != "not_available" and not vis:
        errors.append(f"a {status} response needs a visualization")
    if status == "not_available" and not response.get("unavailable"):
        errors.append("a not_available response must say what is unavailable and why")

    new = copy.deepcopy(project)
    merged = {**existing_ev, **new_ev}
    placeholder = next((e for e in new["elements"] if e["id"] == req.get("placeholder_element_id")), None)
    geom = placeholder or req["region"]
    element = None
    if vis and status != "not_available":
        element, verrs = _visual_element(vis, geom, merged, req["id"])
        errors += verrs
        if element:
            for ref in sm.bound_evidence_ids(element) + element.get("refs", {}).get("evidence", []):
                if ref not in merged:
                    errors.append(f"visualization references unknown evidence {ref}")
                elif merged[ref].get("verification") != "verified":
                    errors.append(f"visualization uses unverified evidence {ref}")
            supported = sm.evidence_numbers({"evidence": merged}, sm.element_evidence_ids(element))
            for text in sm.free_texts(element) + [ev.get("label", "") for ev in element.get("events", [])]:
                for n in sorted(sm.numbers_in(text) - supported):
                    errors.append(f"number {n} in visualization text is not backed by its evidence")
    if errors:
        return errors, warnings, None

    stored = {k: response.get(k) for k in ("schema", "request_id", "status", "sources", "evidence",
                                           "visualization", "unavailable", "notes", "produced_by")}
    new.setdefault("research_results", []).append({"request_id": req["id"], "accepted": sm.now_iso(),
                                                   "sha256": _sha(stored), "response": stored, "reverted": False})
    nreq = _request(new, req["id"])
    nreq["status"] = status
    if placeholder is not None:
        nreq["placeholder_snapshot"] = copy.deepcopy(placeholder)
        idx = new["elements"].index(placeholder)
        if element:
            new["elements"][idx] = element
            nreq["inserted_element_id"] = element["id"]
        else:  # not available: keep a visible, honest placeholder
            reasons = "; ".join(f"{u.get('description')}: {u.get('reason')}" for u in response.get("unavailable", []))
            alts = "; ".join(u["alternative"] for u in response.get("unavailable", []) if u.get("alternative"))
            new["elements"][idx] = {**placeholder, "state": "not_available",
                                    "title": "Not available: " + (req.get("visualization") or "requested content"),
                                    "text": reasons + (f"\nSuggested alternative: {alts}" if alts else "")}
    nreq["unresolved"] = response.get("unavailable", [])
    nreq["history"].append({"at": sm.now_iso(), "event": f"response:{status}",
                            "detail": response.get("notes") or "", "produced_by": response.get("produced_by")})
    return [], warnings, new


def revert_insertion(project: dict, request_id: str) -> dict:
    """Undo an applied response: restore the placeholder and reopen the request."""
    new = copy.deepcopy(project)
    req = _request(new, request_id)
    snap = req.get("placeholder_snapshot")
    if not snap:
        raise ValueError(f"request {request_id} has nothing to revert")
    target = req.get("inserted_element_id") or snap["id"]
    idx = next((i for i, e in enumerate(new["elements"]) if e["id"] == target), None)
    restored = {**snap, "state": "pending_research"}
    if idx is None:
        new["elements"].append(restored)
    else:
        restored.update({k: new["elements"][idx][k] for k in ("x", "y", "w", "h")})  # keep the user's layout
        new["elements"][idx] = restored
    for r in new.get("research_results", []):
        if r["request_id"] == request_id and not r["reverted"]:
            r["reverted"] = True
    req["status"] = "pending_research"
    req.pop("inserted_element_id", None)
    req.pop("placeholder_snapshot", None)
    req["history"].append({"at": sm.now_iso(), "event": "reverted", "detail": "inserted content removed; request reopened"})
    return new


def results_integrity(project: dict) -> list[dict]:
    issues = []
    for r in project.get("research_results", []):
        if r.get("sha256") != _sha(r.get("response")):
            issues.append(dict(level="error", code="research_result_modified", element_id=None,
                               message=f"stored research response for {r['request_id']} was modified after acceptance"))
    return issues
