# A. Competitive UX and implementation study

**Method and evidence level.** This study draws on official help-centre documentation, vendor product pages, developer docs and a few secondary sources. I did **not** have accounts for these products, so I didn't use them hands-on or take screenshots of my own. Where a claim rests only on marketing or a third-party write-up, it's labelled *(secondary)*. Vendor docs sometimes disagree with each other, usually because they describe different releases; those disagreements are noted. Treat this as a map of design patterns, not a feature audit.

## Summary: what to borrow

| Pattern | Seen in | Why it works | Fit for us |
|---|---|---|---|
| **Scope-explicit AI entry points** (an icon on each card or object, plus a deck-wide agent) | Gamma, PowerPoint Copilot | The user picks the blast radius before typing | **Core.** Our scope is Selection / Region / Slide / Deck |
| **Alternatives you can preview before choosing** ("Try new layout") | Gamma, PowerPoint Design Suggestions | Comparing beats describing | **Core.** Three layouts from the same verified content |
| **Selection pane with lock and z-order** | PowerPoint | Dense slides need object-level control that doesn't depend on the canvas | **Core** (Layers tab) |
| **Smart guides and snapping** | PowerPoint, Canva, Figma | Alignment without a dialog | Have it (Moveable). Keep it |
| **Grid view toggle** that hides or reveals the side panels | Figma Slides | Deck-level work gets the whole screen; panels appear only on selection | **Core** (slide overview mode) |
| **Charts linked to a data source**, updated when the source changes | Canva Sheets / Magic Charts | Data is authoritative; the chart is derived | **Core, stronger.** Our link carries provenance as well as values |
| **Style system** (brand kit, slide styles, "apply to all pages") | Canva, Pitch | Consistency without templating every slide | **Core**, as *Design DNA* tokens, not templates |
| **Show changes / diff between versions** | ChatGPT canvas, Cursor | Trust in AI edits comes from reviewable diffs | **Core** (proposal overlay on the canvas) |
| **One whole-deck agent action** ("organise this presentation") | PowerPoint Copilot, Gamma Agent, Pitch Agent | Storyline work is deck-scoped by nature | **Core** (deck conversation) |

## Canva (Presentations, Charts, Sheets, Brand Kit)

**Verified patterns**
- **Charts linked to sheet data.** Magic Charts work from a highlighted range in Canva Sheets, and linked charts update when the sheet changes ([Canva Help: Magic Charts](https://www.canva.com/help/magic-charts/), [Canva newsroom: Canva Sheets](https://www.canva.com/newsroom/news/introducing-canva-sheets)). This is the closest commercial analogue to our "dataset → chart" binding, but the link carries values, not provenance (source, page, verification).
- **Brand Kit text styles and colour themes**, with "Apply to all pages" ([Canva Help: Brand Kit text styles](https://www.canva.com/help/apply-brand-kit-text-styles/), [colours](https://www.canva.com/help/apply-brand-kit-colors/)). Locked elements block colour changes, so locks are respected by bulk restyling.
- **Canva AI "Make it on brand"** applies a Brand Kit to an existing design ([Canva Design School](https://www.canva.com/design-school/resources/create-on-brand-content-with-canva-ai)). *(Secondary)* commentary warns that brand-colour application is "broad rather than intelligent" and can hurt contrast. That is exactly the failure Design DNA must avoid by applying tokens by role (title, body, accent, chart series), not by colour.

**Adapt:** linked data charts; style roles; "apply to all pages" as an explicit, previewable action; the left-hand object panels (Elements, Uploads) as a compact insert library.
**Doesn't fit:** a template-first start, stock-asset marketplaces and decorative effects. Canva's chart cards are visually generic; institutional finance needs sourced axes, notes and footnotes.

## Microsoft PowerPoint (desktop/web, Copilot, Design Suggestions)

**Verified patterns**
- **Selection Pane.** It lists every object, front object first; you can reorder by dragging, rename, hide and **lock** (a locked object "can't be modified"). Grouped objects reorder only within their group ([Microsoft Support: Selection pane](https://support.microsoft.com/en-us/powerpoint/use-the-selection-pane-to-manage-objects-in-documents), [Layer objects](https://support.microsoft.com/en-us/office/layer-objects-on-slides-81cccf31-9219-4c89-b7ba-9f25ad429c4a)).
- **Designer has been renamed "Design Suggestions"**, on the Home tab. You select a slide and pick a suggestion from a pane of alternatives ([Microsoft Support](https://support.microsoft.com/office/create-a-slide-design-with-designer-de659061-5f5c-4591-b2df-c89215c03992)). Microsoft's pages differ on licensing; some say it needs Copilot plans *(secondary)*.
- **Copilot "Organize this presentation"** is a deck-scoped command in the Copilot pane ([Microsoft Support](https://support.microsoft.com/en-us/office/organize-this-presentation-with-copilot-in-powerpoint-a207eea3-7a56-4225-88f1-54dd37cdcf6a)). A *(secondary)* tutorial says multi-slide edits require selecting slides in the thumbnail rail and turning on "Edit with Copilot"; otherwise Copilot only chats. That shows how much the **chat vs. edit** distinction matters to users.
- **Smart Guides** show red alignment lines while dragging *(secondary: GoSkills, Simon Sez IT; not found on support.microsoft.com)*.

**Adapt:** Selection Pane semantics (order, lock, hide, rename); the thumbnail rail as a multi-slide scope selector for AI; a side pane of design alternatives; the keyboard model (arrows nudge, Shift for big steps, ⌘G group, ⌘D duplicate, ⌘C/⌘V).
**Doesn't fit:** the full ribbon (density without hierarchy), slide masters as the main styling tool (too rigid for varied analytical layouts), and animations or transitions at this stage.

## Figma Slides

**Verified patterns**
- **Slide view vs. grid view.** In grid view the left sidebar appears only when an object is selected, and the right sidebar follows the same rule ([Figma Help](https://help.figma.com/hc/en-us/articles/25423848723863), [Plugin API: slidesView](https://developers.figma.com/docs/plugins/api/properties/figma-viewport-slidesview)). The panels get out of the way for deck-level arranging.
- **A Design tab for object properties**; with nothing selected it edits the slide background (same help article).
- **AI tone dial** for text (Executive, Technical, Basic, Educational presets) with retry and reset ([Figma Help: Adjust tone](https://help.figma.com/hc/en-us/articles/24244814883735)). It's a bounded AI edit on a single text layer; the scope is the selection.
- *User feedback* (forum): layers are visible only in slide view ([Figma forum](https://forum.figma.com/t/how-can-i-turn-off-the-layout-grid-in-figma-slides/87378)). Hiding power-user panels has a cost.

**Adapt:** panels that appear on demand; the grid view as a first-class mode (reordering, moving content across slides, seeing the storyline); bounded AI controls (presets plus retry/reset) for small text edits.
**Doesn't fit:** the full Figma design surface (auto layout, components and variants). It's powerful, but too much for analysts who want PowerPoint-level object editing.

## Gamma

**Verified (from Gamma help and Gamma-published guides)**
- **A per-card AI entry point** (sparkle icon at the card's top left) for edits such as rewriting, translating and summarising ([Gamma Help: edit content using AI](https://help.gamma.app/en/articles/8033284-how-to-edit-content-using-ai)). An older article says the AI editor edits **one card at a time** and cannot change the theme.
- **"Try New Layout"** shows AI-suggested alternative layouts for a card, previewed live. The **Agent** (from September 2025, beta) applies natural-language changes across all cards, including the theme ([Gamma guide: layout customisation](https://gamma.app/explore/content/guides/gamma-ai-presentation-tool-flexible-layout-customization-guide), [Gamma 101 lesson](https://lab.gamma.app/gamma-101-module-2-lesson-3)).
- **Layouts come from Gamma's predefined options, not free placement** (same guide). A user idea-board post complains layouts feel "repetitive" ([Gamma ideas](https://ideas.gamma.app/ideas/p/improve-the-layouts-the-ai-generator-uses)).

**Adapt:** the card/object-level AI affordance; live previews of alternatives; separate per-object and deck-wide agents.
**Doesn't fit:** a card/flow document model (it isn't a precise 16:9 canvas) and template-bound layouts. The "repetitive layouts" complaint supports our plan: **archetypes chosen by analytical purpose, then placed precisely**.

## Pitch

**Verified / reported**
- **Slide styles and templates** live in a "Create Templates and Styles" help collection; custom fonts can be uploaded ([Pitch Help](https://help.pitch.com/en/collections/2056202-become-a-pitch-power-user)). A *(secondary)* review likens the Style Builder to PowerPoint's slide master.
- **AI:** generation from a prompt using expert-designed layouts, rewrites in a configured brand tone ([Pitch: AI presentation maker](https://pitch.com/use-cases/ai-presentation-maker), [Pitch blog](https://pitch.com/blog/11-ways-to-level-up-your-slides-with-ai), [How Pitch uses AI](https://pitch.com/ai-in-pitch)). A June 2026 report describes a **Pitch Agent** that refines a deck conversationally ([Gizmodo](https://gizmodo.com/pitch-launches-ai-presentation-agent-that-does-more-than-build-slides-also-chat-about-your-deck-2000779918)); Pitch's own early-access page still calls it rolling out, so status is unconfirmed.

**Adapt:** a style system separate from content; brand tone as a reusable setting (our analogue is a house style for commentary and footnotes); team workspace conventions for later.
**Doesn't fit:** marketing-deck aesthetics as the default; we need dense, sourced exhibits.

## AI-native interaction references (non-presentation)

- **ChatGPT canvas.** You select text to open an inline prompt; edit suggestions can be reviewed per paragraph; **"Show changes"** diffs versions ([OpenAI Help](https://help-lb.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it), [DataCamp guide (secondary)](https://www.datacamp.com/blog/chatgpt-canvas)). Lesson: **selection is context**, and diffs build trust.
- **Cursor.** Per-hunk accept/reject was a well-liked pattern. Users complained loudly when changes began auto-applying, and when review panels stopped clearing or didn't persist ([Cursor forum: bring back per-change apply](https://forum.cursor.com/t/bring-back-per-change-apply-inline-diff-review-you-re-throwing-away-your-best-ux-advantage/160856), [auto-apply regression](https://forum.cursor.com/t/regression-ai-edits-applying-automatically-without-diff-approval-ui/154887)). Lesson: **never auto-apply AI edits to a financial exhibit**; keep proposals persistent until resolved, and make bulk accept/reject explicit.
- **open-slide** (source inspected; see B). It has an agent dock with transcript and history views, an inspector with a comment layer and an inline text editor, and a command menu. The agent edits slide source code. Lesson: a dockable agent panel with persistent history works well, but **code-as-slide** is the wrong substrate for evidence-bound financial data.

## What would not fit our workflow (across products)

- Generating a slide as one image, or as an uneditable layout, for anything quantitative.
- Template marketplaces and stock-photo-first creation.
- Free-form "magic" restyling that changes facts, sources or number formatting.
- Hidden auto-apply of AI edits.
