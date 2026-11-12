"""IMF World Economic Outlook research (Stage 4, first step): verified datasets for any country the WEO covers.

Mirrors agent.fetch_verified for Eurostat: one request per country reads every indicator, a second independent request
must return the same value before an observation is accepted, and each accepted value becomes an evidence record with
its query URL, retrieval time and response hash. Values from the projection years are IMF projections; the dataset's
source note says which vintage, so slide wording can say "projected".

Derived series (interest, interest as a share of revenue) are computed from accepted evidence only. Their evidence
records carry the formula and the input evidence ids, so every derived figure can be recomputed.

    python app/server/imf.py create --title "Middle East conflicts and sovereign credit risk" \
        --countries IL,IR,IQ,LB,EG,JO,BH,QA,KW,SA,AE,OM --since 2019
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import httpx

SDMX = "https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/{flow}/+/{key}"
HEADERS = {"Accept": "application/vnd.sdmx.data+json;version=2.0.0", "User-Agent": "frr-workspace/0.3 (research-to-report prototype)"}
FLOWS = {"WEO": "IMF World Economic Outlook, October 2026", "WEO_2025_OCT_VINTAGE": "IMF World Economic Outlook, October 2025 vintage"}

# metric key -> (WEO indicator, label, unit, measure)
INDICATORS = {
    "growth": ("NGDP_RPCH", "Real GDP growth", "%", {"kind": "rate", "of": None, "signed": True, "additive_parts_of": None, "scale": "interval"}),
    "debt": ("GGXWDG_NGDP", "General government gross debt", "% of GDP", {"kind": "ratio", "of": "GDP", "signed": False, "additive_parts_of": None, "scale": "interval"}),
    "deficit": ("GGXCNL_NGDP", "General government net lending (+) / borrowing (-)", "% of GDP", {"kind": "balance_ratio", "of": "GDP", "signed": True, "additive_parts_of": None, "scale": "interval"}),
    "primary": ("GGXONLB_NGDP", "General government primary net lending (+) / borrowing (-)", "% of GDP", {"kind": "balance_ratio", "of": "GDP", "signed": True, "additive_parts_of": None, "scale": "interval"}),
    "revenue": ("GGR_NGDP", "General government revenue", "% of GDP", {"kind": "ratio", "of": "GDP", "signed": False, "additive_parts_of": None, "scale": "interval"}),
    "inflation": ("PCPIPCH", "Inflation, average consumer prices", "%", {"kind": "rate", "of": None, "signed": True, "additive_parts_of": None, "scale": "interval"}),
    "current_account": ("BCA_NGDPD", "Current account balance", "% of GDP", {"kind": "balance_ratio", "of": "GDP", "signed": True, "additive_parts_of": None, "scale": "interval"}),
}
VINTAGE_METRICS = {"growth": "growth_oct25", "debt": "debt_oct25", "inflation": "inflation_oct25", "deficit": "deficit_oct25"}  # the earlier edition, same indicators
COUNTRIES = {"IL": ("ISR", "Israel"), "IR": ("IRN", "Iran"), "IQ": ("IRQ", "Iraq"), "LB": ("LBN", "Lebanon"), "EG": ("EGY", "Egypt"),
             "JO": ("JOR", "Jordan"), "BH": ("BHR", "Bahrain"), "QA": ("QAT", "Qatar"), "KW": ("KWT", "Kuwait"), "SA": ("SAU", "Saudi Arabia"),
             "AE": ("ARE", "United Arab Emirates"), "OM": ("OMN", "Oman"), "SY": ("SYR", "Syria"), "YE": ("YEM", "Yemen"), "TR": ("TUR", "Türkiye"),
             "US": ("USA", "United States"), "JP": ("JPN", "Japan"), "GB": ("GBR", "United Kingdom"), "DE": ("DEU", "Germany"), "FR": ("FRA", "France"),
             "IT": ("ITA", "Italy"), "CA": ("CAN", "Canada"), "ES": ("ESP", "Spain"), "GR": ("GRC", "Greece"), "PT": ("PRT", "Portugal"), "CN": ("CHN", "China"),
             "IN": ("IND", "India"), "ID": ("IDN", "Indonesia"), "KR": ("KOR", "Korea"), "AU": ("AUS", "Australia"), "BR": ("BRA", "Brazil"), "MX": ("MEX", "Mexico"),
             "AR": ("ARG", "Argentina"), "CL": ("CHL", "Chile"), "CO": ("COL", "Colombia"), "PE": ("PER", "Peru"), "ZA": ("ZAF", "South Africa"),
             "NG": ("NGA", "Nigeria"), "KE": ("KEN", "Kenya"), "GH": ("GHA", "Ghana"), "PK": ("PAK", "Pakistan"), "PL": ("POL", "Poland"), "HU": ("HUN", "Hungary"),
             "UA": ("UKR", "Ukraine"), "TH": ("THA", "Thailand"), "MY": ("MYS", "Malaysia"), "PH": ("PHL", "Philippines"), "VN": ("VNM", "Vietnam")}
# world commodity prices (WEO area G001): key -> (indicator, label, unit)
# units short enough to follow a figure ("99.1 US$/bbl"); the label spells them out
COMMODITIES = {"brent": ("POILBRE", "Brent crude oil price, annual average (US$ per barrel)", "US$/bbl"), "gas_eu": ("PNGASEU", "Natural gas price, Europe (US$ per MMBtu)", "US$/MMBtu"),
               "copper": ("PCOPP", "Copper price, annual average (US$ per metric ton)", "US$/t"), "wheat": ("PWHEAMT", "Wheat price, annual average (US$ per metric ton)", "US$/t")}


def http_get(url: str) -> bytes:
    r = httpx.get(url, timeout=90, headers=HEADERS)
    r.raise_for_status()
    return r.content


def read(get: Callable[[str], bytes], flow: str, iso3: str, codes: list[str]) -> tuple[str, bytes, dict[tuple[str, str], float]]:
    """One SDMX request: {(indicator, year): value} for one country."""
    url = SDMX.format(flow=flow, key=f"{iso3}.{'+'.join(codes)}.A")
    body = get(url)
    d = json.loads(body)["data"]
    st, ds = d["structures"][0], d["dataSets"][0]
    dims = st["dimensions"]["series"]
    ind = [v["id"] for v in dims[1]["values"]]
    years = [v["value"] for v in st["dimensions"]["observation"][0]["values"]]
    out: dict[tuple[str, str], float] = {}
    for key, s in (ds.get("series") or {}).items():
        code = ind[int(key.split(":")[1])]
        for i, v in s["observations"].items():
            if v and v[0] not in (None, ""):
                out[(code, years[int(i)])] = float(v[0])
    return url, body, out


def fetch_country(get: Callable[[str], bytes], geo: str, since: str, flow: str = "WEO", metrics: dict[str, str] | None = None) -> list[dict]:
    """Datasets and evidence for one country, each value confirmed by a second, independent request."""
    iso3, name = COUNTRIES[geo]
    metrics = metrics or {m: m for m in INDICATORS}
    codes = [INDICATORS[m][0] for m in metrics]
    url, body, obs = read(get, flow, iso3, codes)
    _, _, again = read(get, flow, iso3, codes)
    now = datetime.now(timezone.utc)
    sha, day = hashlib.sha256(body).hexdigest(), now.date().isoformat()
    out = []
    for m, key in metrics.items():
        code, label, unit, measure = INDICATORS[m]
        did = f"ds.{geo.lower()}.{key}"
        evidence, observations, rejected = {}, [], 0
        for (c, p), v in sorted(obs.items()):
            if c != code or p < since:
                continue
            if again.get((c, p)) != v:
                rejected += 1
                continue
            v = round(v, 1)  # WEO tables print one decimal; the API carries more
            eid = f"ev.imf.{geo.lower()}.{key}.{p}"
            evidence[eid] = {"id": eid, "source_id": f"src.imf.{flow.lower()}.{geo.lower()}", "kind": "metric_value", "subject": name,
                             "statement": f"{label} [{FLOWS[flow]} {iso3}] {p}: {v:g}", "metric_id": key, "value": v, "unit": unit, "period": p,
                             "locator": f"{flow} {iso3}.{code}.A @ {p}", "verification": "verified",
                             "verified_by": "frr-imf-validator (independent re-fetch)", "verified_on": day,
                             "source_title": FLOWS[flow], "source_url": url,
                             "retrieval": {"method": "api", "query_url": url, "retrieved_at": now.isoformat(timespec="seconds"), "content_sha256": sha,
                                           "series_key": f"{flow} {iso3}.{code}.A", "note": "IMF SDMX 3.0 API (data+json 2.0)"}}
            observations.append({"date": p, "value": v, "status": "verified", "evidence_id": eid})
        if not observations:
            continue
        vint = "October 2025 vintage" if flow != "WEO" else "October 2026"
        out.append({"dataset": {"id": did, "title": f"{name} · {label.lower()}" + (" (October 2025 vintage)" if flow != "WEO" else ""),
                                "entity": name, "geo": geo, "metric": key, "unit": unit, "measure": measure, "frequency": "annual",
                                "origin": "imf", "verification": "verified", "source_url": url,
                                "source_note": f"IMF WEO {vint} ({day}; projections from 2026)", "observations": observations, "working": {}},
                    "evidence": evidence, "rejected": rejected})
    return out


def derive_interest(project: dict, geo: str) -> list[dict]:
    """Interest = primary balance − overall balance (% of GDP); interest share of revenue = interest / revenue × 100."""
    g = geo.lower()
    P, B, R = (project["datasets"].get(f"ds.{g}.{k}") for k in ("primary", "deficit", "revenue"))
    if not (P and B):
        return []
    name = P["entity"]
    by = lambda d: {o["date"]: o for o in d["observations"]} if d else {}
    p, b, r = by(P), by(B), by(R)
    out = []
    for key, label, unit, formula in (("interest", "General government interest (primary minus overall balance)", "% of GDP", "primary - balance"),
                                      ("interest_rev", "Interest as a share of government revenue", "% of revenue", "(primary - balance) / revenue * 100")):
        if key == "interest_rev" and not R:
            continue
        evidence, observations = {}, []
        for y in sorted(set(p) & set(b) & (set(r) if key == "interest_rev" else set(p))):
            inputs = {"primary": p[y]["evidence_id"], "balance": b[y]["evidence_id"], **({"revenue": r[y]["evidence_id"]} if key == "interest_rev" else {})}
            env = {"primary": p[y]["value"], "balance": b[y]["value"], "revenue": r[y]["value"] if key == "interest_rev" else 1}
            if key == "interest_rev" and not env["revenue"]:
                continue
            interest = env["primary"] - env["balance"]
            v = round(interest / env["revenue"] * 100 if key == "interest_rev" else interest, 1)
            eid = f"ev.imf.{g}.{key}.{y}"
            evidence[eid] = {"id": eid, "source_id": f"src.imf.derived.{g}", "kind": "derived_value", "subject": name,
                             "statement": f"{label} {y}: {v:g} = {formula}", "metric_id": key, "value": v, "unit": unit, "period": y,
                             "formula": formula, "inputs": inputs, "verification": "verified", "verified_by": "frr-imf-derivation (recomputed from verified inputs)",
                             "verified_on": datetime.now(timezone.utc).date().isoformat(), "source_title": "Derived from IMF WEO October 2026", "source_url": None,
                             "retrieval": {"method": "derived", "query_url": None, "retrieved_at": None, "content_sha256": None, "series_key": None,
                                           "note": f"{formula}; inputs are verified IMF WEO evidence"}}
            observations.append({"date": y, "value": v, "status": "verified", "evidence_id": eid})
        out.append({"dataset": {"id": f"ds.{g}.{key}", "title": f"{name} · {label.lower()}", "entity": name, "geo": geo, "metric": key, "unit": unit,
                                "measure": {"kind": "ratio", "of": "GDP" if key == "interest" else "revenue", "signed": False, "additive_parts_of": None, "scale": "interval"},
                                "frequency": "annual", "origin": "imf-derived", "verification": "verified", "source_url": None,
                                "source_note": f"Derived from IMF WEO October 2026 ({formula})", "observations": observations, "working": {}},
                    "evidence": evidence, "rejected": 0})
    return out


def forecast_editions(project: dict, geo: str, metric: str, year: str) -> dict | None:
    """The value for `year` as published in the October 2025 and October 2026 editions: one dataset with two periods
    (2025-10, 2026-10), each observation re-using the verified evidence of its edition (a forecast revision)."""
    g = geo.lower()
    old, new = project["datasets"].get(f"ds.{g}.{VINTAGE_METRICS.get(metric, metric + '_oct25')}"), project["datasets"].get(f"ds.{g}.{metric}")
    pick = lambda d: next((o for o in (d or {}).get("observations", []) if o["date"] == year), None)  # noqa: E731
    o, n = pick(old), pick(new)
    if not o or not n:
        return None
    key, evidence, obs = f"{metric}_f{year}", {}, []
    for date, src, ed in (("2025-10", o, "October 2025"), ("2026-10", n, "October 2026")):
        base = project["evidence"][src["evidence_id"]]
        eid = f"ev.imf.{g}.{key}.{date}"
        evidence[eid] = {**base, "id": eid, "metric_id": key, "period": date, "statement": base["statement"] + f" (the {year} value as published in the {ed} WEO)",
                         "retrieval": {**base["retrieval"], "note": base["retrieval"]["note"] + f"; same value as {src['evidence_id']}"}}
        obs.append({"date": date, "value": src["value"], "status": "verified", "evidence_id": eid})
    return {"dataset": {"id": f"ds.{g}.{key}", "title": f"{new['entity']} · {INDICATORS[metric][1].lower()} forecast for {year}, by WEO edition", "entity": new["entity"],
                        "geo": geo, "metric": key, "unit": new["unit"], "measure": dict(new["measure"]), "frequency": "monthly", "origin": "imf", "verification": "verified",
                        "source_url": new["source_url"], "source_note": f"IMF WEO October 2025 and October 2026 editions ({datetime.now(timezone.utc).date().isoformat()})",
                        "observations": obs, "working": {}}, "evidence": evidence, "rejected": 0}


def fetch_commodity(get: Callable[[str], bytes], key: str, since: str) -> dict:
    code, label, unit = COMMODITIES[key]
    url, body, obs = read(get, "WEO", "G001", [code])
    _, _, again = read(get, "WEO", "G001", [code])
    now = datetime.now(timezone.utc); day = now.date().isoformat(); sha = hashlib.sha256(body).hexdigest()
    evidence, observations = {}, []
    for (c, y), v in sorted(obs.items()):
        if y < since or again.get((c, y)) != v:
            continue
        v = round(v, 1); eid = f"ev.imf.w.{key}.{y}"
        evidence[eid] = {"id": eid, "source_id": "src.imf.weo.commodities", "kind": "metric_value", "subject": label, "statement": f"{label} [IMF WEO October 2026] {y}: {v:g}",
                         "metric_id": key, "value": v, "unit": unit, "period": y, "locator": f"WEO G001.{code}.A @ {y}", "verification": "verified",
                         "verified_by": "frr-imf-validator (independent re-fetch)", "verified_on": day, "source_title": "IMF World Economic Outlook, October 2026 (commodity prices)",
                         "source_url": url, "retrieval": {"method": "api", "query_url": url, "retrieved_at": now.isoformat(timespec="seconds"), "content_sha256": sha,
                                                          "series_key": f"WEO G001.{code}.A", "note": "IMF SDMX 3.0 API"}}
        observations.append({"date": y, "value": v, "status": "verified", "evidence_id": eid})
    return {"dataset": {"id": f"ds.w.{key}", "title": label, "entity": label.split(",")[0].replace(" price", ""), "geo": "W", "metric": key, "unit": unit,
                        "measure": {"kind": "price", "of": None, "signed": False, "additive_parts_of": None, "scale": "interval"}, "frequency": "annual", "origin": "imf",
                        "verification": "verified", "source_url": url, "source_note": f"IMF WEO October 2026 ({day}; projections from 2026)", "observations": observations,
                        "working": {}}, "evidence": evidence, "rejected": 0}


def main(argv: list[str]):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--title", required=True)
    c.add_argument("--countries", required=True)
    c.add_argument("--since", default="2019")
    c.add_argument("--projects", default=str(Path(__file__).resolve().parent / "projects"))
    c.add_argument("--project", default="", help="add to this existing project instead of creating one")
    c.add_argument("--editions", default="", help="metrics to compare across WEO editions, e.g. growth,debt")
    c.add_argument("--forecast-year", default="2026")
    c.add_argument("--commodities", default="", help=f"world prices: {','.join(COMMODITIES)}")
    a = ap.parse_args(argv)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from projects import ProjectStore  # noqa: E402
    store = ProjectStore(Path(a.projects))
    b = store.load(a.project) if a.project else store.create("blank", a.title)
    pid = b["project"]["id"]
    project = b["project"]
    report = []
    for geo in [g.strip().upper() for g in a.countries.split(",") if g.strip()]:
        parts = fetch_country(http_get, geo, a.since) + fetch_country(http_get, geo, a.since, "WEO_2025_OCT_VINTAGE", VINTAGE_METRICS)
        for x in parts:
            project["datasets"][x["dataset"]["id"]] = x["dataset"]
            project["evidence"].update(x["evidence"])
        for x in derive_interest(project, geo) + [y for m in filter(None, a.editions.split(",")) if (y := forecast_editions(project, geo, m.strip(), a.forecast_year))]:
            project["datasets"][x["dataset"]["id"]] = x["dataset"]
            project["evidence"].update(x["evidence"])
        report.append({"geo": geo, "datasets": sorted(d["dataset"]["metric"] for d in parts), "rejected": sum(d["rejected"] for d in parts)})
    for k in filter(None, a.commodities.split(",")):
        x = fetch_commodity(http_get, k.strip(), a.since)
        project["datasets"][x["dataset"]["id"]] = x["dataset"]; project["evidence"].update(x["evidence"])
    b["project"] = project
    store.save(pid, b)
    print(json.dumps({"project": pid, "countries": report}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
