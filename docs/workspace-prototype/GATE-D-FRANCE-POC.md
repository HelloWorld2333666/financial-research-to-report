# Gate D: France visual proof of concept, built through the chat

**Branch:** `feature/workspace-v2`, local commit only. **Date:** 2026-11-11.
**Status:** a proof of concept for your visual review. The engineering checks pass; the design verdict is yours.

## Setup
- **Test copy:** project `france-sovereign-credit-gate-d-test-copy-6bb0dd` ("France sovereign credit · Gate D test copy"), a copy of `france-sovereign-credit-5f2c97`. **The original was not changed.**
- **The real product path:** the local model `qwen3.8:27b` (Ollama) in the app's chat, the app server with the private design library configured, and the chat card's previews and **Apply**.
- **The requests:** typed as a user would type them. For three of the content slides I added "find a layout reference first"; for the risk slide I didn't, and the model looked one up on its own anyway.

## The deck (`gated/deck.png`; slides 14–21 of the test copy, rendered from the saved project)

| # | Slide | Recipe | Chosen by the model | QA |
|---|---|---|---|---|
| 1 | Contents: Sovereign debt, Fiscal position, Credit risk (01 marked) | R9 agenda | `design_slide(purpose=agenda, section=0)` | clean |
| 2 | 01 Sovereign debt | R9 divider | `design_slide(purpose=divider, section=0)` | clean |
| 3 | "France's debt kept rising while Germany's and Italy's fell", with a tinted "Where France stands" rail | R1 | It asked for `trend-annotated`. R3 doesn't fit this data (France's peak is its latest point), so I applied the R1 design the card offered | clean |
| 4 | 02 Fiscal position | R9 divider | `section=1` | clean |
| 5 | "France ran the second-largest deficit of the seven", ranked on a panel, France rank 2 | R2 | `recipe=ranked-bars` | clean |
| 6 | "France's deficit stopped narrowing after 2022 and stayed wider than Germany's every year", 2022–2025 shaded, "Low 2020" callout | R3 | `recipe=trend-annotated` (second attempt; see the defects below) | clean |
| 7 | 03 Credit risk | R9 divider | `section=2` | clean |
| 8 | "Debt, deficit and funding cost: three pressures on France's credit", in three figure bands | PD2 bands | It asked for `chart-rail`. The planner said no R1 design fits and offered the bands | clean |

## Verification on the saved copy

| Check | Result |
|---|---|
| Client integrity (editor) | OK: 244/244 bindings, 203 chart points, 93/93 figures in text sourced, 0 unverified edits |
| Server integrity | OK and identical: 244/244, 203 points, 93/93, 0 unsourced, 0 mismatches |
| Editability | The draft PPTX export was read back through the design-library extractor. Slides 14–21 contain only native shapes, text and groups; **no pictures**. Fonts are Inter and Source Serif 4; nothing is below 8 pt |
| Save and reload | The project was reloaded several times during the session (including after server restarts); every applied slide and binding persisted |
| Undo | Each Apply is one undoable step (shown on the card; covered by the existing tests) |

## How the local model did
- **Recipe choice was sensible:**
  - `trend-annotated` for both trend requests;
  - `ranked-bars` for the ranking;
  - the navigation purposes for the agenda and the dividers.
  - For the risk summary it asked for `chart-rail`, which doesn't fit a three-pressure summary; the planner explained that and offered the bands.
- **It used `find_layout_references` unprompted** for the risk slide.
- **Mistakes it made, all caught:**
  - **It omitted `metric` on the deficit trend.** Before this gate the agent silently defaulted to debt, and the card showed debt slides for a deficit request. **Fixed:** the agent now takes the metric from the model's own wording, or asks for it.
  - **It proposed a false headline,** saying France's deficit "widened since 2020"; it narrowed from −8.9% to −5.1%. The planner refused the wording and used computed statements only.
  - **One malformed tool call** (an argument the tool doesn't have) was rejected harmlessly, and the model retried.
- **Latency:** 60–120 s per request on this machine.

## Defects found in this gate, and fixed

| Defect | Fix |
|---|---|
| A recipe the data couldn't carry was silently ignored | The planner now says so ("No "trend-annotated" design fits this data …") and offers the closest designs. Tested |
| An explicit peer list stopped the editorial ranking, and the card fell back to the older PD1 layouts | The ranking accepts explicit peers. Tested with the model's exact arguments |
| A missing metric silently became debt | The metric is inferred from the request's wording, or the model is asked for it |
| The card read "Plan a agenda slide" | "Plan an agenda slide" |
| Saved chat cards kept plans made under the old rules | `PLAN_VERSION` is now 4, so they re-plan |

## Weaknesses for your review
1. **A figure repeats on adjacent slides.** Slides 5 and 6 both lead their rail with −5.1%. No check looks across slides; a deck-level check for repeated focal figures belongs in Gate E.
2. **The editor has no Delete slide action** (the store has the command, but nothing in the UI calls it). The test copy therefore still holds its 13 earlier slides ahead of the deck, and the deck is slides 14–21.
3. **No cover slide or deck title page.** That needs its own recipe and has no reference set yet.
4. **The three dividers are identical apart from the numeral and text.** That's intended for rhythm; a variant (for example, an agenda before each section) is possible.
5. **Recipes cover four patterns.** Other requests fall back to the PD2 and PD1 designs.

## Tests
- vitest **165 passed**, including three new tests built from the model's actual arguments.
- pytest **260 passed**, including the browser end-to-end checks.
