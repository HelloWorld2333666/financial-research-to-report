"""Shared helpers for editor tests."""


def el(project, element_id):
    return next(e for e in project["elements"] if e["id"] == element_id)


def add_region(project, rect, instruction="test"):
    project["annotations"].append(dict(id="req-test", kind="region", rect=rect, instruction=instruction, status="open"))
    return "req-test"
