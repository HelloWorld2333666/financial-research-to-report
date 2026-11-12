"""Research runs (M5): evidence from uploaded agency PDFs and Eurostat data packs.

Rating actions from a PDF (decision D4: pypdf first):
1. pypdf gives the text of every page;
2. candidates come from the local model, which is asked to QUOTE (agency, action, rating, outlook,
   page, verbatim excerpt), and from a deterministic sentence finder (rating verb + rating token);
3. every candidate is verified in code, as ``frr.sourcecheck`` does for filings: the excerpt must
   appear on that page (whitespace- and quote-insensitive), the rating token and the action verb
   must be inside the excerpt, the agency must be named in the document, and the entity must be
   named on the page. Only verified candidates become evidence (page + excerpt + file hash).

This proves the evidence matches the document, not that the document is authentic: the user
chose the file, and the evidence says so (origin ``user_provided``).
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from datetime import date, datetime, timezone
from typing import Callable, Optional

from frr.sourcecheck import normalise

AGENCIES = ["S&P Global Ratings", "S&P", "Fitch Ratings", "Fitch", "Moody's", "Morningstar DBRS", "DBRS", "Scope Ratings", "Scope", "KBRA"]
VERBS = r"affirm(?:s|ed)?|confirm(?:s|ed)?|downgrad(?:e|es|ed)|upgrad(?:e|es|ed)|lower(?:s|ed)?|rais(?:e|es|ed)|assign(?:s|ed)?|revis(?:e|es|ed)|plac(?:e|es|ed)"
RATING = (r"AAA|AA\+|AA-|AA \((?:high|low)\)|AA|A\+|A-|A \((?:high|low)\)|BBB\+|BBB-|BBB|"
          r"Aaa|Aa1|Aa2|Aa3|A1|A2|A3|Baa1|Baa2|Baa3")
RATING_RE = re.compile(rf"(?<![A-Za-z])({RATING})(?![A-Za-z0-9+\-])")
VERB_RE = re.compile(rf"\b({VERBS})\b", re.I)
OUTLOOK_RE = re.compile(r"\b(stable|negative|positive|developing)\b(?:\s+(?:outlook|trend))?|\b(?:outlook|trend)s?\s+(?:to\s+|is\s+|at\s+)?(stable|negative|positive|developing)\b", re.I)
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
# the year may run into the next word in extracted text ("MARCH 22, 2024PRESS RELEASE"), so it ends at "no further digit"
DATE_RES = [re.compile(r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})(?!\d)", re.I),
            re.compile(r"\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),\s+(20\d{2})(?!\d)", re.I)]
ACTION = {"affirm": "affirmed", "confirm": "confirmed", "downgrad": "downgraded", "upgrad": "upgraded", "lower": "downgraded",
          "rais": "upgraded", "assign": "assigned", "revis": "outlook revised", "plac": "placed on watch"}
MAX_PDF = 20 * 1024 * 1024


class ResearchError(ValueError):
    pass


# ------------------------------------------------------------------ PDF
def pdf_pages(data: bytes) -> list[str]:
    if not data.startswith(b"%PDF-") or len(data) > MAX_PDF:
        raise ResearchError("not a PDF under 20 MB")
    from pypdf import PdfReader
    try:
        return [p.extract_text() or "" for p in PdfReader(io.BytesIO(data)).pages]
    except Exception as exc:  # pypdf raises many types on damaged files
        raise ResearchError(f"pypdf could not read the file: {exc}") from None


def _flat(text: str) -> str:
    """Normalised for matching: quotes, whitespace, and words hyphenated across lines."""
    return normalise(re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text.replace("­", "")))


def find_date(text: str) -> Optional[date]:
    for rx in DATE_RES:
        m = rx.search(text)
        if m:
            g = m.groups()
            day, month, year = (g[0], g[1], g[2]) if g[0].isdigit() else (g[1], g[0], g[2])
            mon = MONTHS.get(month.lower()) or next(v for k, v in MONTHS.items() if k.startswith(month.lower()[:3]))
            try:
                return date(int(year), mon, int(day))
            except ValueError:
                continue
    return None


def page_dates(text: str) -> set[date]:
    """Every date printed on a page (all formats)."""
    out = set()
    for rx in DATE_RES:
        for m in rx.finditer(text):
            d = find_date(m.group(0))
            if d:
                out.add(d)
    return out


def action_date(page_no: int, pages: list[str], release: Optional[date]) -> Optional[date]:
    """The date of an action found on a page: the release date for page 1 (the press release itself); on a later
    page only a single date printed on that page. A page with several dates (a rating-history table) or none gives
    no date: a wrong date would be a fabricated fact, a missing one is shown as missing."""
    if page_no == 1:
        return release
    ds = page_dates(_flat(pages[page_no - 1]))
    return next(iter(ds)) if len(ds) == 1 else None


def agency_of(pages: list[str]) -> Optional[str]:
    whole = _flat("\n".join(pages))
    counts = {a: whole.count(a) for a in AGENCIES}
    named = [a for a in AGENCIES if counts[a]]
    if not named:
        m = re.search(r"\b([A-Z][A-Za-z&]+(?: [A-Z][A-Za-z&]+)? Ratings)\b", whole)  # e.g. "Example Ratings"
        return m.group(1) if m else None
    best = max(named, key=lambda a: (counts[a], len(a)))
    longer = [a for a in named if best in a and a != best]
    return longer[0] if longer else best


# ------------------------------------------------------------------ candidates
def pattern_candidates(pages: list[str]) -> list[dict]:
    """Sentences and single lines (headlines have no full stop) with a rating verb and a rating token,
    quoted verbatim from the page; shortest first, so the tightest excerpt wins."""
    out = []
    for n, text in enumerate(pages, 1):
        pieces = re.split(r"(?<=[.;])\s+(?=[A-Z(])", _flat(text)) + [normalise(line) for line in text.splitlines()]
        for piece in {p.strip() for p in pieces}:
            if VERB_RE.search(piece) and RATING_RE.search(piece) and len(piece) <= 600:
                out.append({"page": n, "excerpt": piece, "found_by": "pattern"})
    return sorted(out, key=lambda c: (c["page"], len(c["excerpt"])))


QUOTER = ("You extract credit rating actions from a rating agency press release. Quote, do not paraphrase. Reply with a JSON array "
          "only, each item {\"page\": <page number>, \"excerpt\": <one sentence copied exactly from that page that states the action and "
          "the rating>}. Use [] if there is no rating action.")


async def model_candidates(pages: list[str], run_model: Callable[[str], "object"]) -> list[dict]:
    """Ask the model to quote; anything it returns is only a candidate until verified."""
    doc = "\n\n".join(f"--- page {i} ---\n{_flat(t)[:6000]}" for i, t in enumerate(pages[:6], 1))
    raw = await run_model(doc)
    m = re.search(r"\[.*\]", raw or "", re.S)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    return [{"page": int(i["page"]), "excerpt": str(i["excerpt"]), "found_by": "model"}
            for i in items if isinstance(i, dict) and str(i.get("page", "")).isdigit() and i.get("excerpt")]


# ------------------------------------------------------------------ verification
def verify(c: dict, pages: list[str], agency: Optional[str], entity_names: list[str], doc_year: Optional[int] = None) -> tuple[Optional[dict], str]:
    """A verified rating action, or None and the reason."""
    if not 1 <= c["page"] <= len(pages):
        return None, "page out of range"
    page, excerpt = _flat(pages[c["page"] - 1]), _flat(c["excerpt"])
    if len(excerpt) < 20 or len(excerpt) > 600:
        return None, "excerpt length"
    if excerpt not in page and excerpt.replace(" ", "") not in page.replace(" ", ""):
        return None, "excerpt not found verbatim on the page"
    r, v = RATING_RE.search(excerpt), VERB_RE.search(excerpt)
    if not r or not v:
        return None, "excerpt states no rating action (verb + rating)"
    if not agency:
        return None, "no rating agency named in the document"
    if not any(re.search(rf"\b{re.escape(e)}\b", page, re.I) for e in entity_names):
        return None, f"page does not name {entity_names[0]}"
    years = {int(y) for y in re.findall(r"\b(20\d{2})\b", excerpt)}
    if re.search(r"\b(previously|earlier|formerly|last year|in the past)\b", excerpt, re.I) or (doc_year and years - {doc_year}):
        return None, "refers to an earlier action, not this release's"
    verb = v.group(1).lower()
    action = next(a for k, a in ACTION.items() if verb.startswith(k))
    o = OUTLOOK_RE.search(excerpt) or OUTLOOK_RE.search(page)
    return {"agency": agency, "action": action, "rating": r.group(1), "outlook": (o.group(1) or o.group(2)).lower() if o else None,
            "excerpt": excerpt, "page": c["page"], "found_by": c["found_by"]}, "ok"


def rating_evidence(data: bytes, filename: str, entity: str, candidates: list[dict], pages: list[str]) -> tuple[list[dict], list[dict]]:
    """Verified evidence items (deduplicated) and the rejected candidates with reasons."""
    sha = hashlib.sha256(data).hexdigest()
    agency = agency_of(pages)
    when = find_date(_flat(pages[0])) if pages else None
    names = {"France": ["France", "French Republic", "Republic of France"]}.get(entity, [entity])
    evidence, rejected, seen = [], [], set()
    for c in candidates:
        ok, why = verify(c, pages, agency, names, when.year if when else None)
        if not ok:
            rejected.append({**c, "reason": why})
            continue
        key = (ok["rating"], ok["action"])  # the same action restated (headline, body, ratings table) is one row
        if key in seen:
            continue
        seen.add(key)
        eid = f"ev.pdf.{sha[:8]}.{len(evidence) + 1}"
        on = action_date(ok["page"], pages, when)
        evidence.append({"id": eid, "source_id": f"src.pdf.{sha[:10]}", "kind": "fact", "subject": entity,
                         "statement": f"{ok['agency']} {ok['action']} {entity} at {ok['rating']}" + (f", outlook {ok['outlook']}" if ok["outlook"] else "") + (f" ({on.isoformat()})" if on else ""),
                         "page": ok["page"], "excerpt": ok["excerpt"], "locator": f"{filename}, p. {ok['page']}",
                         "verification": "verified", "verified_by": f"frr-sourcecheck (excerpt on page; found by {ok['found_by']})",
                         "verified_on": datetime.now().astimezone().date().isoformat(),  # the user's calendar day
                         "rating": {"agency": ok["agency"], "action": ok["action"], "rating": ok["rating"], "outlook": ok["outlook"], "date": on.isoformat() if on else None},
                         "source_title": f"{ok['agency']} press release ({filename})", "source_url": None,
                         "retrieval": {"method": "pdf_upload", "query_url": None, "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                       "content_sha256": sha, "series_key": None, "note": f"uploaded by the user: {filename}; origin user_provided"}})
    return evidence, rejected


# ------------------------------------------------------------------ table text (mirrored in the client: core/evidence.ts ratingCells)
RATING_COLUMNS = ["Agency", "Date", "Action", "Rating", "Outlook"]


def rating_cells(ev: dict) -> list[str]:
    r = ev.get("rating") or {}
    return [r.get("agency") or "—", r.get("date") or "—", r.get("action") or "—", r.get("rating") or "—", r.get("outlook") or "—"]
