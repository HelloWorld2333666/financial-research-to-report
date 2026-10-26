"""Runtime configuration from environment variables (see .env.example).

Phase 0 makes no LLM calls. The provider setting is recorded in output so
records stay traceable once an LLM-backed step is added, and paid calls stay
off unless FRR_ALLOW_PAID_CALLS is explicitly set.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    llm_provider: str  # "none" or a provider name such as "anthropic" / "openai"
    llm_model: str | None
    allow_paid_calls: bool


def load_settings(env: dict[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    return Settings(
        llm_provider=(env.get("FRR_LLM_PROVIDER") or "none").strip().lower(),
        llm_model=(env.get("FRR_LLM_MODEL") or "").strip() or None,
        allow_paid_calls=(env.get("FRR_ALLOW_PAID_CALLS") or "").strip().lower() in {"1", "true", "yes"},
    )
