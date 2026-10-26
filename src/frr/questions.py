"""Research question templates and metric definitions for company/credit research.

Deterministic on purpose: the question frame is a checklist an analyst would
apply to any public company. An LLM may later refine or extend it, but the
baseline must not depend on one.
"""

from __future__ import annotations

from frr.schema import MetricDefinition, ResearchQuestion, Scope

SUPPORTED_USE_CASES = {"company_credit"}
SUPPORTED_SECTORS = {"general", "insurance"}

METRICS: dict[str, MetricDefinition] = {
    m.id: m
    for m in [
        MetricDefinition(
            id="m.revenue",
            name="Total revenue",
            definition="Total operating revenue as reported in the consolidated income statement.",
            unit="currency",
            caveats="For insurers, use the reported revenue line; IFRS 17 changed presentation from 2023.",
        ),
        MetricDefinition(
            id="m.net_profit",
            name="Net profit attributable to shareholders",
            definition="Profit for the period attributable to owners of the parent.",
            unit="currency",
        ),
        MetricDefinition(
            id="m.roe",
            name="Return on equity",
            definition="Net profit attributable to shareholders divided by average shareholders' equity.",
            unit="percent",
            formula="net_profit / ((equity_open + equity_close) / 2)",
            caveats="Issuers sometimes use closing rather than average equity; record which.",
        ),
        MetricDefinition(
            id="m.total_assets",
            name="Total assets",
            definition="Total assets on the consolidated balance sheet at period end.",
            unit="currency",
        ),
        MetricDefinition(
            id="m.debt_to_equity",
            name="Debt to equity",
            definition="Interest-bearing debt divided by total shareholders' equity at period end.",
            unit="ratio",
            formula="interest_bearing_debt / total_equity",
            caveats="Definition of interest-bearing debt varies; record the components used.",
        ),
        MetricDefinition(
            id="m.interest_coverage",
            name="Interest coverage",
            definition="Earnings before interest and tax divided by interest expense.",
            unit="ratio",
            formula="EBIT / interest_expense",
        ),
        MetricDefinition(
            id="m.combined_ratio",
            name="Combined ratio",
            definition="Loss ratio plus expense ratio for property & casualty (re)insurance business; "
            "below 100% indicates an underwriting profit.",
            unit="percent",
            formula="(incurred_losses + underwriting_expenses) / earned_premiums",
            caveats="Measurement basis changed under IFRS 17; compare only like-for-like periods.",
        ),
        MetricDefinition(
            id="m.solvency_ratio",
            name="Comprehensive solvency adequacy ratio",
            definition="Actual capital divided by minimum capital under the applicable regime "
            "(C-ROSS for PRC insurers).",
            unit="percent",
            formula="actual_capital / minimum_capital",
            caveats="Regime changes (e.g. C-ROSS Phase II) break comparability across years.",
        ),
    ]
}

_GENERAL_QUESTIONS: list[dict] = [
    dict(
        id="q.profile",
        text="What does the company do, and how has it developed?",
        rationale="Readers need a factual baseline before any credit judgement.",
        evidence_needed=["business description", "key corporate history milestones", "listing venue"],
    ),
    dict(
        id="q.ownership",
        text="Who controls the company, and could the controlling shareholder provide support?",
        rationale="Ownership and potential state or parent support are central to credit assessment.",
        evidence_needed=["major shareholders and stakes", "ultimate controller"],
    ),
    dict(
        id="q.business_mix",
        text="How is revenue split by business line and geography?",
        rationale="Concentration and diversification drive earnings stability.",
        evidence_needed=["revenue by segment", "revenue by geography (only as disclosed)"],
        metric_ids=["m.revenue"],
    ),
    dict(
        id="q.performance",
        text="How have scale and profitability evolved over the review period?",
        rationale="Earnings capacity is the first line of defence for creditors.",
        evidence_needed=["multi-year revenue and profit", "return on equity"],
        metric_ids=["m.revenue", "m.net_profit", "m.roe", "m.total_assets"],
    ),
    dict(
        id="q.balance_sheet",
        text="How strong are leverage, liquidity and debt service capacity?",
        rationale="Directly determines ability to meet obligations.",
        evidence_needed=["debt and equity levels", "interest expense", "liquidity position"],
        metric_ids=["m.debt_to_equity", "m.interest_coverage"],
    ),
    dict(
        id="q.ratings",
        text="What are the current credit ratings and outlooks, and the agencies' stated rationale?",
        rationale="External ratings anchor and cross-check the analysis.",
        evidence_needed=["issuer/financial strength ratings with agency and date", "rating rationale"],
    ),
    dict(
        id="q.risks",
        text="What are the key credit risks and mitigants?",
        rationale="Synthesises the analysis into risk implications.",
        evidence_needed=["disclosed risk factors", "recent material events"],
    ),
]

_INSURANCE_OVERRIDES: dict[str, dict] = {
    # Insurers are assessed on underwriting and regulatory capital, not corporate leverage.
    "q.balance_sheet": dict(
        id="q.capital",
        text="How strong are underwriting results and regulatory capital?",
        rationale="Underwriting profitability and solvency are the core credit drivers for (re)insurers.",
        evidence_needed=["combined ratio by segment", "solvency adequacy ratios", "capital actions"],
        metric_ids=["m.combined_ratio", "m.solvency_ratio"],
    ),
}


def validate_scope(scope: Scope) -> None:
    """Raise ValueError for requests the Phase 0 engine cannot handle."""
    if scope.use_case not in SUPPORTED_USE_CASES:
        raise ValueError(
            f"Unsupported use case '{scope.use_case}'. Phase 0 supports only: "
            f"{', '.join(sorted(SUPPORTED_USE_CASES))}."
        )
    if scope.sector not in SUPPORTED_SECTORS:
        raise ValueError(
            f"Unsupported sector '{scope.sector}'. Choose one of: {', '.join(sorted(SUPPORTED_SECTORS))}."
        )


def plan_questions(scope: Scope) -> tuple[list[ResearchQuestion], list[MetricDefinition]]:
    """Return the research questions and the metric definitions they require."""
    validate_scope(scope)
    specs = list(_GENERAL_QUESTIONS)
    if scope.sector == "insurance":
        specs = [_INSURANCE_OVERRIDES.get(s["id"], s) for s in specs]
    questions = [ResearchQuestion(**s) for s in specs]
    metric_ids = list(dict.fromkeys(m for q in questions for m in q.metric_ids))
    return questions, [METRICS[m] for m in metric_ids]
