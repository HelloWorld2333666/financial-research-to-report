"""Cross-slide drag and drop as a semantic instruction.

Dropping modules from one slide onto another (or onto "new slide") can mean
very different things: put them there unchanged, or "build a support page
around this table", "use this chart as one proof block", "keep the evidence
but rewrite the message". transfer() applies the drop for the chosen mode:

    move / copy                     literal: the modules land on the target slide
                                    with their evidence bindings and refs intact
    move_adapt / split              the modules move, are flagged with the
                                    transfer id, and a Transfer Request asks the
                                    future AI to rework them for the target slide
    use_as_evidence / summarise     the source stays; a "Pending AI adaptation"
                                    placeholder on the target carries the
                                    modules' evidence / claim / gap links

If an adaptive drop's instruction asks for an exhibit the project cannot build
(research.classify -> "research"), a Research Request and its "Pending
research" placeholder are added on the target slide too; an exhibit that
existing evidence covers gets a "Pending chart/table/..." placeholder. No
model is called here: requests are stored for a later AI / Research Engine
step (see editor/TRANSFER_CONTRACT.md).
"""

from __future__ import annotations

import copy

import research
import slidemodel as sm

TRANSFER_SCHEMA = "frr-transfer-request/0.1"
CONTENT = {"x": 32, "y": 96, "w": 1216, "h": 512}  # below the title band, above the source line

MODES = {
    "move": dict(label="Move as-is", adaptive=False, keeps_source=False, target="modules", intent=""),
    "copy": dict(label="Copy as-is", adaptive=False, keeps_source=True, target="modules", intent=""),
    "move_adapt": dict(label="Move and adapt to target slide", adaptive=True, keeps_source=False, target="modules",
                       intent="Rework these modules to fit the target slide's message and layout. Keep every "
                              "evidence binding; change wording, emphasis and arrangement only."),
    "use_as_evidence": dict(label="Use as evidence for a new slide", adaptive=True, keeps_source=True,
                            target="placeholder",
                            intent="Build new slide content around these modules, citing their evidence and claims. "
                                   "The source modules stay where they are."),
    "split": dict(label="Split into multiple modules", adaptive=True, keeps_source=False, target="modules",
                  intent="Break these modules into smaller, separately placeable modules (for example one per "
                         "row, segment or point). Each figure keeps its evidence binding."),
    "summarise": dict(label="Summarise for target slide", adaptive=True, keeps_source=True, target="placeholder",
                      intent="Write a short summary of these modules for the target slide. Use only figures backed "
                             "by the linked evidence; the source modules stay where they are."),
}

RULES = [
    "Only change elements listed in target_element_ids / placeholder_element_ids, on the target slide.",
    "Keep evidence bindings: figures stay metric/table/barchart elements bound to an evidence_id; never type numbers as text.",
    "Cite claims and evidence from linked; do not introduce figures that no linked or project evidence supports.",
    "If the instruction needs data the project does not have, leave the Research Request open instead of estimating.",
]


# --------------------------------------------------------------------------- helpers

def linked_records(project: dict, elements: list[dict]) -> dict:
    """Structured links a set of modules carries (evidence, claims, metrics, sources, gaps)."""
    ev = sm.evidence_map(project)
    evidence = sorted(set().union(set(), *(sm.element_evidence_ids(e) for e in elements)))
    refs = lambda kind: {r for e in elements for r in e.get("refs", {}).get(kind, [])}
    return {
        "evidence_ids": evidence,
        "claim_ids": sorted(refs("claims")),
        "metric_ids": sorted({ev[i]["metric_id"] for i in evidence if ev.get(i, {}).get("metric_id")}),
        "source_ids": sorted(refs("sources") | {ev[i]["source_id"] for i in evidence if ev.get(i, {}).get("source_id")}),
        "gap_ids": sorted(refs("gaps") | {e["gap_id"] for e in elements if e.get("gap_id")}),
    }


def module_label(el: dict) -> str:
    if el["type"] == "panel":
        return "background panel"
    text = el.get("title") or el.get("label") or el.get("text") or (el.get("columns") or [""])[0] or el["type"]
    text = " ".join(str(text).split())
    return text[:72] + ("…" if len(text) > 72 else "")


def _clamp(r: dict) -> dict:
    w, h = min(r["w"], sm.SLIDE_W), min(r["h"], sm.SLIDE_H)
    return {"x": round(max(0, min(r["x"], sm.SLIDE_W - w))), "y": round(max(0, min(r["y"], sm.SLIDE_H - h))),
            "w": round(w), "h": round(h)}


def _free(r: dict, occupied: list[dict], gap: int = 8) -> bool:
    padded = {"x": r["x"] - gap, "y": r["y"] - gap, "w": r["w"] + 2 * gap, "h": r["h"] + 2 * gap}
    return not any(sm._intersects(e, padded) for e in occupied)


def find_spot(occupied: list[dict], w: float, h: float, prefer: dict | None = None) -> dict | None:
    """First free w×h rectangle in the content area (``prefer`` first), or None."""
    w, h = min(w, CONTENT["w"]), min(h, CONTENT["h"])
    if prefer is not None:
        p = _clamp({**prefer, "w": w, "h": h})
        if _free(p, occupied):
            return p
    for y in range(CONTENT["y"], int(CONTENT["y"] + CONTENT["h"] - h) + 1, 8):
        for x in range(CONTENT["x"], int(CONTENT["x"] + CONTENT["w"] - w) + 1, 16):
            r = {"x": x, "y": y, "w": round(w), "h": round(h)}
            if _free(r, occupied):
                return r
    return None


def _target_rect(project: dict, target: str, box: dict, drop: dict | None, ignore: set[str]) -> dict:
    """Where a w×h block lands: at the drop point (or its old position) if free, else the first free spot."""
    desired = dict(box)
    if drop and all(isinstance(drop.get(k), (int, float)) for k in ("x", "y")):
        desired.update(x=drop["x"] - box["w"] / 2, y=drop["y"] - box["h"] / 2)
    desired = _clamp(desired)
    occupied = [e for e in sm.slide_elements(project, target) if e["id"] not in ignore]
    return find_spot(occupied, box["w"], box["h"], prefer=desired) or desired


def _exhibit_spot(project: dict, target: str) -> dict:
    occupied = sm.slide_elements(project, target)
    return (find_spot(occupied, 560, 240) or find_spot(occupied, 400, 160) or find_spot(occupied, 300, 100)
            or {"x": CONTENT["x"] + CONTENT["w"] - 400, "y": CONTENT["y"] + CONTENT["h"] - 120, "w": 400, "h": 120})


def _request(project: dict, transfer_id: str) -> dict:
    req = next((t for t in project.get("transfer_requests", []) if t["id"] == transfer_id), None)
    if req is None:
        raise KeyError(f"unknown transfer request {transfer_id}")
    return req


# --------------------------------------------------------------------------- transfer

def transfer(project: dict, module_ids: list[str], target_slide_id: str | None, mode: str,
             instruction: str = "", drop: dict | None = None, new_slide_title: str = "") -> tuple[dict, dict]:
    """Apply a cross-slide drop. ``target_slide_id=None`` creates a new slide after the source.

    Returns (new_project, result); the input project is never modified."""
    if mode not in MODES:
        raise ValueError(f"unknown transfer mode {mode!r}")
    spec, instruction = MODES[mode], (instruction or "").strip()
    by_id = {e["id"]: e for e in project["elements"]}
    ids = list(dict.fromkeys(module_ids or []))
    if not ids:
        raise ValueError("select at least one module to transfer")
    unknown = [i for i in ids if i not in by_id]
    if unknown:
        raise ValueError(f"unknown element(s) {', '.join(unknown)}")
    groups = {by_id[i].get("group") for i in ids} - {None}  # whole groups travel together
    ids = [e["id"] for e in project["elements"] if e["id"] in ids or (e.get("group") and e["group"] in groups)]
    origins = {sm.slide_of(project, by_id[i]) for i in ids}
    if len(origins) != 1:
        raise ValueError("transfer modules from one slide at a time")
    source = origins.pop()
    types = {by_id[i]["type"] for i in ids}
    if "sources" in types:
        raise ValueError("the source line is generated per slide and cannot be transferred")
    if mode == "copy" and "pending" in types:
        raise ValueError("pending placeholders belong to one open request; move them instead of copying")
    if target_slide_id == source:
        raise ValueError("drop the modules on a different slide")

    new, created = project, target_slide_id is None
    if created:
        new, target = sm.add_slide(project, new_slide_title or "New slide", after=source)
    else:
        if target_slide_id not in sm.slide_ids(project):
            raise ValueError(f"unknown slide {target_slide_id}")
        new, target = copy.deepcopy(project), target_slide_id
    modules = [e for e in new["elements"] if e["id"] in ids]
    linked = linked_records(new, modules)
    snapshots = copy.deepcopy(modules)
    box = sm._bbox(modules)
    tid = sm.new_id("tr") if spec["adaptive"] else None
    element_ids, placeholder_ids = [], []

    if spec["target"] == "modules":
        dest = _target_rect(new, target, box, drop, set(ids))
        dx, dy = dest["x"] - box["x"], dest["y"] - box["y"]
        if spec["keeps_source"]:  # copy: new ids, same bindings, origin recorded
            regroup: dict[str, str] = {}
            for m in modules:
                c = copy.deepcopy(m)
                c.update(id=sm.new_id(m["type"][:2]), slide_id=target, x=m["x"] + dx, y=m["y"] + dy,
                         origin={"element_id": m["id"], "slide_id": source, "via": mode})
                if m.get("group"):
                    c["group"] = regroup.setdefault(m["group"], sm.new_id("g"))
                new["elements"].append(c)
                element_ids.append(c["id"])
        else:  # move: same element objects, so ids and links are untouched
            for m in modules:
                m.update(slide_id=target, x=m["x"] + dx, y=m["y"] + dy)
                if tid:
                    m["transfer_id"] = tid
                if m["type"] == "pending" and m.get("request_id"):
                    for r in new["research_requests"]:
                        if r.get("id") == m["request_id"]:
                            r["slide_id"] = target
                element_ids.append(m["id"])
    else:  # placeholder carrying the modules' links; the source stays as it is
        lo = (600, 280) if mode == "use_as_evidence" else (480, 160)  # room for the content the AI will build
        size = {"w": min(max(lo[0], box["w"]), CONTENT["w"]), "h": min(max(lo[1], box["h"]), CONTENT["h"])}
        occupied = sm.slide_elements(new, target)  # placed at the drop point or first free spot, not the old position
        prefer = _clamp({**size, "x": drop["x"] - size["w"] / 2, "y": drop["y"] - size["h"] / 2}) if drop else None
        dest = find_spot(occupied, size["w"], size["h"], prefer=prefer) or _clamp({**CONTENT, **size})
        ph = {"id": sm.new_id("pending"), "slide_id": target, "type": "pending", "state": "pending_adaptation",
              "transfer_id": tid, **dest,
              "title": "Pending summary" if mode == "summarise" else "Pending AI adaptation: " + spec["label"].lower(),
              "text": instruction or spec["intent"],
              "refs": {k: linked[f] for k, f in (("evidence", "evidence_ids"), ("claims", "claim_ids"),
                                                 ("gaps", "gap_ids")) if linked[f]},
              "style": {}}
        new["elements"].append(ph)
        placeholder_ids.append(ph["id"])

    request = None
    if spec["adaptive"]:
        classification, research_ids = None, []
        if instruction:
            cls = research.classify(new, instruction)
            classification = {k: cls[k] for k in ("intent", "content_type", "visualization", "topics",
                                                  "uncovered_topics", "matched_evidence", "reasons")}
            if cls["intent"] == "research":  # the exhibit needs data the project does not have
                new, rreq = research.create_request(new, instruction, _exhibit_spot(new, target), slide_id=target)
                stored = next(r for r in new["research_requests"] if r["id"] == rreq["id"])
                stored["transfer_id"] = tid
                research_ids.append(rreq["id"])
                placeholder_ids.append(rreq["placeholder_element_id"])
            elif cls["intent"] == "existing_data" and cls["content_type"] in research.VISUAL_TYPES:
                matched = sorted({i for v in cls["matched_evidence"].values() for i in v})
                ph = {"id": sm.new_id("pending"), "slide_id": target, "type": "pending", "state": "pending_adaptation",
                      "transfer_id": tid, **_exhibit_spot(new, target),
                      "title": f"Pending {cls['visualization'] or cls['content_type']} (from existing evidence)",
                      "text": instruction, "refs": {"evidence": matched} if matched else {}, "style": {}}
                new["elements"].append(ph)
                placeholder_ids.append(ph["id"])
        request = {
            "schema": TRANSFER_SCHEMA, "id": tid, "status": "pending_adaptation",
            "mode": mode, "mode_label": spec["label"], "intent": spec["intent"], "instruction": instruction,
            "created": sm.now_iso(),
            "source_slide_id": source, "source_slide_title": sm.slide_title(new, source),
            "target_slide_id": target, "target_slide_title": sm.slide_title(new, target), "target_is_new_slide": created,
            "module_ids": ids,
            "modules": [{"id": m["id"], "type": m["type"], "label": module_label(m)} for m in snapshots],
            "module_snapshots": snapshots,
            "source_kept": spec["keeps_source"],
            "target_element_ids": element_ids, "placeholder_element_ids": placeholder_ids,
            "linked": linked, "classification": classification, "research_request_ids": research_ids,
            "history": [{"at": sm.now_iso(), "event": "created",
                         "detail": f"{spec['label']}: {len(ids)} module(s) from {source} to {target}"}],
        }
        new["transfer_requests"].append(request)
    return new, {"mode": mode, "source_slide_id": source, "target_slide_id": target, "created_slide": created,
                 "module_ids": ids, "linked": linked, "element_ids": element_ids, "placeholder_ids": placeholder_ids, "transfer_request": request}


def preview(project: dict, module_ids: list[str], target_slide_id: str | None, mode: str,
            instruction: str = "") -> dict:
    """What a drop would do, without changing the project (for the drop menu)."""
    try:
        new, res = transfer(project, module_ids, target_slide_id, mode, instruction)
    except (ValueError, KeyError) as exc:
        return {"ok": False, "error": str(exc)}
    by_id = {e["id"]: e for e in new["elements"]}
    return {"ok": True, "module_ids": res["module_ids"], "linked": res["linked"],
            "placeholders": [by_id[i]["title"] for i in res["placeholder_ids"]],
            "classification": (res["transfer_request"] or {}).get("classification")}


def cancel_transfer(project: dict, transfer_id: str) -> dict:
    """Withdraw a pending transfer request. Its placeholders (and any research
    request it opened that is still pending) are removed; moved modules stay
    where they are and lose their pending flag (use Undo to move them back)."""
    new = copy.deepcopy(project)
    req = _request(new, transfer_id)
    if req["status"] != "pending_adaptation":
        raise ValueError(f"transfer {transfer_id} is {req['status']}")
    drop = set()
    for rid in req.get("research_request_ids", []):
        rr = next((r for r in new["research_requests"] if r.get("id") == rid), None)
        if rr and rr["status"] == "pending_research":
            rr["status"] = "closed"
            rr["history"].append({"at": sm.now_iso(), "event": "closed", "detail": f"transfer {transfer_id} cancelled"})
            drop.add(rr["placeholder_element_id"])
    keep = []
    for e in new["elements"]:
        if e["id"] in drop or (e.get("transfer_id") == transfer_id and e["type"] == "pending"):
            continue
        if e.get("transfer_id") == transfer_id:
            e.pop("transfer_id")
        keep.append(e)
    new["elements"] = keep
    req["status"] = "cancelled"
    req["history"].append({"at": sm.now_iso(), "event": "cancelled", "detail": "placeholders removed; modules kept"})
    return new


def export_transfer(project: dict, transfer_id: str) -> dict:
    """The handoff document a future AI adaptation step receives."""
    req = _request(project, transfer_id)
    ev, by_id = sm.evidence_map(project), {e["id"]: e for e in project["elements"]}
    target = req["target_slide_id"]
    return {
        **copy.deepcopy(req), "project": project.get("id"),
        "current_elements": [by_id[i] for i in req["target_element_ids"] + req["placeholder_element_ids"] if i in by_id],
        "target_slide": {"id": target, "title": sm.slide_title(project, target),
                         "elements": [{k: e.get(k) for k in ("id", "type", "x", "y", "w", "h")} | {"label": module_label(e)}
                                      for e in sm.slide_elements(project, target)]},
        "evidence": {i: ev[i] for i in req["linked"]["evidence_ids"] if i in ev},
        "claims": {i: project["claims"][i] for i in req["linked"]["claim_ids"] if i in project.get("claims", {})},
        "research_requests": [r for r in project["research_requests"] if r.get("id") in req["research_request_ids"]],
        "rules": RULES,
        "response": "A layout patch for the target slide (slidemodel.PATCH_SCHEMA), validated with the same rules "
                    "as region change requests. Not implemented in this prototype.",
        "slide_size": {"w": sm.SLIDE_W, "h": sm.SLIDE_H},
    }
