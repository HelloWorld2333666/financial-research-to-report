---
name: financial-slide-design
description: Plan, design and render financial and economic research decks or slides in this project (financial-research-to-report) to a consulting-report standard, from verified evidence, as editable native objects with sourced imagery, maps, flags, icons and logos. Use when asked to create a presentation or deck on a topic, a new slide or section, to make slides look professional, or to redesign a slide. Do not use for text edits, number or data changes, chart-type switches, small moves, or questions about the evidence.
---

# Financial slide design

You are the design model. You decide what each slide argues, which visual techniques carry it, what the deck looks like
and which pictures it needs. The application does everything mechanical: fetching and verifying data, resolving
figures from evidence, sourcing licensed assets, laying out, drawing, checking and saving. **No deck needs code of its
own.** If a design needs something the engine cannot draw, follow "Renderer limits" below; do not hand-draw a slide.

The Middle East deck (`renders/middle-east-deck-v2-…` in the private library) is a **quality benchmark, not a template**:
match its finish, not its layouts, palette, image choices or slide count.

## The loop

**1. Research and evidence** (no figure is ever typed by hand):
- datasets: `app/server/imf.py create --title … --countries … [--editions growth,debt --forecast-year 2026] [--commodities brent]`
  (any IMF WEO country; forecast revisions between editions; world prices), or the app's Eurostat research (fiscal
  metrics, maturity buckets, yield curves) through the workspace agent or `agent.fetch_verified`;
- facts from the web (rating actions, agency statements, traffic figures): `deck.py fact <pid> … --excerpt "…"`; the
  excerpt is checked on the page (`verified`) or the fact is marked `reported`, which the slide must say;
- then `deck.py profile <pid>`: datasets, periods, units, parts-of-a-whole, facts. **Plan from this, not from memory.**

**2. Storyboard and identity** (load `cards/DK-deck.md`):
- write `plans/deck.json`: `{"title", "slides": [...], "storyboard": [{"slide", "role", "message", "cards", "assets"}]}`;
  the action titles in order must read as the executive summary;
- choose the identity for **this** topic and audience: `deck.py identity <pid> --id <name> --primary "#hex" [--type serif|sans]
  [--base-language atlas|burgundy|institutional] [--paper "#hex"]`. One identity per deck; plans then omit `language`.
  Pick the primary colour for the subject and the reader (a central bank deck, an energy deck and a credit deck should
  not look alike); never reuse a previous deck's identity by default.

**3. Each slide** (load `cards/ROUTER.md` first, then only the cards in play):
analyse the claim → shortlist families from the router table → decide with the family cards → compose with a pattern
card (P1–P7) and the modifier, anchor and device cards → list the assets (S1, S2, V10) → write the plan.

**4. Write the plan** `plans/<slide>.json` in the format of `PLANS.md` (frr-design JSON with figure tokens). Record the
cards you used and why alternatives were rejected in `rationale`.

**5. Build and inspect** (the app server must run; `preview_start workspace-v2` serves it on port 8791):
```bash
.venv/bin/python app/server/deck.py build <pid>            # renders/<slide>.png, overview.png, report.md
```
Then **look at every rendered PNG** (Read the images, not only the report) and critique against `cards/R-refinement.md`:
hard constraints first, then practice, then judgement. Typical defects: crowded columns, a title running to four lines,
a map framed so the mechanism is cut off, labels over data, a card or legend over something that matters, weak focal
point, empty fields. Revise the plan (not the engine) and rebuild with `--only <slide>`; at most two rounds per slide.
`report.md` lists QA errors, missing assets and **deck checks** (runs of one composition, too many commentary panels,
covers without imagery, country tables without flags, identity drift, the visual mix). Act on them or record why not.

**6. Deliver**: `deck.py apply <pid>` puts the slides into the live project as editable, evidence-bound slides (the app's
integrity checks and export apply). Show the user the overview and the individual PNGs, and list the sources.

## Visual assets (S1, S2, V10)

- **Covers, dividers, closings:** a photograph or a map of the subject (`cover` composition, `image` object). Search
  licensed files with `python app/server/assets.py search "<subject>"`; only public domain, CC0, CC BY and CC BY-SA are
  accepted; credits are added to the source line automatically.
- **Maps** when geography is part of the mechanism (routes, chokepoints, exposure by place, contagion), not because
  countries are mentioned. Figures go on the map as anchored, bound objects.
- **Flags** beside countries in tables and rankings and on country figures; **logos** for companies and agencies (identification
  only); **icons** (one set, Lucide) for findings, process steps, lead-ins and watch items. Don't decorate: one marker per
  row or block, and none where it adds nothing.

## Renderer limits

When a technique a card recommends is not drawable: name the limit; solve it with asset sourcing, preparation, editable
shape composition or a small, reusable engine addition (with a test); otherwise use the card's fallback **and record what
it loses**. An empty field, an omitted map or a plain table is never a silent fallback. Engine additions belong in
`app/web/src/core/design/` (layout, drawing, assets) or `app/server/` (data, assets), never in a plan.

## Reference material

- `cards/`: the design knowledge (router, 16 families, modifiers, patterns, devices, anchors, assets, conventions,
  refinement R1–R14, deck). The full technique catalogue (T01–T84), its refinement and the reference mappings are in the
  private library (`frr-design-library/reports/`); the cards cite them by id.
- `PLANS.md`: the plan format.
- `knowledge/principles.json`, `modules/`, `design_library.retrieve`: the earlier recipe catalogue used by the in-app
  agent's `design_slide` tool (single slides from recipes); still valid for quick in-app redesigns.

## Privacy

Reference decks, images and records stay in the private library (outside the repository). Cards are written in our own
words. Fetched assets stay in `app/server/assets_cache/` (git-ignored) with their licences in the manifest. No paid image
or model service without the user's approval.
