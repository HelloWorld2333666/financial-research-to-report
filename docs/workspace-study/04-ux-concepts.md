# C. UX concepts and recommendation

## The problem the UX must solve

An analyst works between three things at once: **the slide** (layout and message), **the evidence** (numbers, sources, gaps) and **the AI** (research, reasoning, edits). Today these live in different tools, so context is lost at every switch.

The workspace has to keep all three visible without shrinking the canvas into a postage stamp. It also has to make every AI change **scoped, previewable and reversible**.

## Three concepts

### Concept 1: Classic professional editor with contextual AI

- **Layout:** a PowerPoint/Figma-like frame. Slide rail on the left, canvas in the centre, an inspector (Properties / Layers) on the right, and a slim top toolbar. AI appears as an **"Ask AI" action on the selection toolbar** and a chat drawer that slides in on demand.
- **Strengths:** familiar to analysts from day one; maximum canvas space; editing is fast and keyboard-driven.
- **Limits:** AI is a side feature. Conversations are easy to lose, research and data feel bolted on, and the proposal and review flow has no natural home.

### Concept 2: AI-first canvas and chat workspace

- **Layout:** the conversation is the primary surface, about 40–50% of the width, and the slide canvas is the "artifact" beside it, as in ChatGPT canvas or Claude artifacts. Every change starts as a message and comes back as a proposal.
- **Strengths:** the AI really is the editing interface; history and reasoning are visible; well suited to research-heavy pages.
- **Limits:** the canvas is permanently narrow, about 55% of a 1440 px laptop. Direct manipulation feels secondary, and precise layout work is frustrating. Users who know exactly what they want are slowed down by a chat-first workflow.

### Concept 3: Research-and-evidence-first workspace

- **Layout:** a left pane holds the **storyline and evidence library** (claims → evidence → datasets). Slides are views onto that structure; you build a slide by pulling evidence onto it.
- **Strengths:** the strongest research integrity; provenance is the backbone; duplicated or contradictory evidence shows up naturally.
- **Limits:** a steep learning curve and heavy navigation, and it feels like a research tool rather than a presentation editor. Visual design work is buried.

## Recommendation: "Canvas first, conversation always within reach, evidence one click away"

Concept 1's frame, with Concept 2's chat as the **default right panel**, and Concept 3's evidence as a **mode of that same panel plus a bottom Evidence Shelf**.

```
┌────────────────────────────── top bar: project · slide title · undo/redo · scope · tasks ● · share/export ─┐
│ slide rail │                       CANVAS (16:9, fit)                         │ CONTEXT PANEL (resizable)│
│ thumbnails │  selection toolbar floats on the selection                       │ [Chat|Data|Design|Layers]│
│ + storyline│                                                                   │  one mode at a time      │
│  (collaps.)│                                                                   │                          │
├────────────┴───────────────── Evidence Shelf (collapsible strip, drag sources) ─┴──────────────────────────┘
```

Rules that keep it manageable:
1. **One right panel, one mode at a time** (Chat · Data · Design · Layers; Properties appears inside Design when something is selected). No nested sidebars. The panel resizes from 300 to 560 px and collapses to a 44 px icon strip.
2. **Canvas protection.** Below a 1280 px viewport the slide rail collapses to numbered dots before the canvas is allowed to shrink. The canvas never drops below 60% of the width unless the user drags it there.
3. **Modes:** `F` full-screen canvas (the panels float as a mini toolbar and a chat bubble); `G` slide grid (deck overview, drag to reorder or move content); `⌘J` toggles chat; `⌘E` opens Data.
4. **Selection is context.** Whatever is selected on the canvas appears as chips in the chat composer (`▣ Chart · Debt/GDP`, `▦ Table · Ratings`). Drawing a region adds a `⬚ Region` chip. You never re-describe what's visible.

## Innovations, evaluated

Each was scored against: (1) the concrete problem, (2) the interaction, (3) why it beats existing tools, (4) research quality or efficiency, (5) performance and maintenance, (6) phase.

| Innovation | Problem solved | Interaction | Better than existing tools because | Research / efficiency | Performance and maintenance | Phase |
|---|---|---|---|---|---|---|
| **Per-slide persistent chat + deck chat** | AI context is lost per request; deck-level edits are dangerous | The chat panel follows the active slide. A "Deck" tab holds the global thread. Both read the same project store | Gamma and Copilot have one agent; we keep local memory per slide plus shared authority | Efficiency ↑: no re-explaining | Virtualise transcripts; store messages per slide | **P1** |
| **Selection chips + scope selector** (Selection / Region / Slide / Deck) | "Make this bigger": which "this"? Blast radius unclear | Chips appear automatically; the scope dropdown sits in the composer and is shown again on every proposal | Explicit scope before and after the request | Prevents unrelated changes | Trivial | **P1** |
| **Proposals with canvas overlay diff** | AI edits are silently destructive | Proposal card listing affected objects. Hover or "Preview" shows ghost outlines (new = blue, moved = dashed, removed = red) and a before/after slider. Then Apply / Reject / Regenerate | Cursor-style review, but visual; never auto-applied | Trust ↑; facts invariant checked before Apply | Proposal = patch; overlay renders only affected objects | **P1** |
| **Canvas ↔ chat drag** | Copy, export and recreate loops | Drag an object into the composer (becomes a chip). Drag a result card from chat onto the canvas, or press **Place…** then click a position or region (keyboard and small screens) | Nobody connects chat output to precise placement | Efficiency ↑ | DnD via pointer events; result cards are real elements | **P1 (place), P2 (drag polish)** |
| **Data panel with checkbox selection → exhibit** | Finding and charting verified data takes many steps | Data mode: datasets grouped by topic, checkboxes, a "Create ▾" (line / bar / table / metric) preview, then Insert or Place | Canva links values; we link **provenance**, with compatibility checks (unit, frequency, observation type) | Integrity ↑ | TanStack virtual lists | **P1** |
| **Evidence Shelf** (collected building blocks) | Re-searching the same data for each slide | A bottom strip of cards: verified (solid, ✓), provisional notes (dashed, "unverified"), research ideas (outline, "needs research"). Drag to a slide, copy, or attach to chat | No commercial equivalent | Reuse ↑; provisional is never confused with verified | Cards reference evidence ids only | **P2** |
| **Three layout alternatives from identical content** | "Make it look better" changes facts or produces random variety | "Alternatives" shows three archetypes (e.g. Hero chart + commentary · Two charts + conclusion · Table + interpretation), each with an invariant badge "Same 14 evidence items · same 3 claims · no number changes" | Gamma and PowerPoint suggest visuals; ours are argued strategies with a checked invariant | Quality ↑ | Layout engine plus archetypes; cheap to render; AI chooses and assigns | **P2** (one archetype engine in P1) |
| **Design DNA** (project tokens plus layout freedom) | Restyling every slide by hand; templates make every slide identical | Design mode: typography scale, palette roles, chart style, spacing grid, footnote and source conventions, learned from a reference slide. "Apply DNA to deck" shows a per-slide change list | Canva and Pitch apply brand values broadly; we apply roles and keep layouts | Consistency ↑ | Styles resolve through tokens, so a restyle is a token change, not N element edits | **P1 tokens; P2 learn-from-reference** |
| **Task center** (research, verify, layout tasks running in parallel) | Waiting on long AI work blocks editing; unclear what changed where | A top-bar pill "3 running · 1 needs review". A popover groups tasks by slide. Thumbnails carry badges. Objects in a running task's scope show a small "AI working" ring | No dashboard; ambient but legible | Fewer conflicts and duplicate research (tasks deduplicate by dataset and question) | Tasks are store records; UI subscribes per slide | **P2** (UI and state in P1 with simulated tasks) |
| **Reference image / screenshot as style context** | Users can show but not describe | Paste or drop an image into chat; it becomes a chip; scope = selection. The AI proposes style tokens or a layout change, and numbers stay bound | Image models regenerate everything; we keep structured exhibits | Quality ↑, no factual risk | The image is context only, never the output for exhibits | **P3** |
| **Comment pins → AI tasks** | Feedback gets lost between iterations | Drop a pin, write the comment, "Send to AI". It becomes a scoped proposal (pattern from open-slide's comment layer) | Turns review notes into scoped edits | Efficiency ↑ | Annotations already exist in our model | **P2** |

## Key interaction states (shown in mockups/)

1. **Workspace:** France debt slide, a chart selected; chat with a selection chip; a proposal card with overlay preview.
2. **Deck chat:** storyline outline, deck-level proposal "Page 2 → zoom in on France", consistency issues.
3. **Data mode:** three series checked, a compatibility check passed, line chart preview, Insert / Place.
4. **Chart editing:** source-data table (observations, frequency, source, verification); visual settings; "values locked" indicator; a revision flag on a user-corrected observation.
5. **Three alternatives:** side-by-side previews with invariant badges.
6. **Task center:** four slide tasks in different states; a conflict notice ("you edited the table while verification was running; re-run or accept against new values").
7. **Full-screen:** canvas maximised; floating toolbar; chat bubble with an unread proposal.
