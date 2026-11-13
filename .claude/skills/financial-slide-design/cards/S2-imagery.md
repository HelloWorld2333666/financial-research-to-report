---
id: S2
type: asset
layer: L4c (production: asset pipeline)
name: Imagery and linework (photos, cutouts, duotone, illustrations, line patterns, motifs)
aliases: [T73, T74, T75, T76, T77, T78, BG2, BG3, BG4]
refs: [u19, u20, u18, u05]
---

**Purpose:** reinforce the subject and the identity: architecture for a country deck, equipment for a medical company, ports for logistics.

**Treatments (R8):**
- **recolouring or duotone** into the palette (u19, u20);
- **cropping** into a field or by the slide edge (T73, u18);
- **cutouts** (T74);
- **layered compositions** (P7);
- **contained image cards**, also acceptable when well designed.

**Content:**
- photographs;
- illustrations (T75; in rings or as column headers);
- **dense abstract line patterns (T76):** scale well to large areas;
- **figurative line-art motifs (T77):** keep small. Crude, low-detail drawings should not be enlarged excessively (R12).

**Production (T78, the asset pipeline):**
1. Decide the visual need first: what the reader should recognise (the region at night, the strait from orbit, the port).
2. Source it: `python app/server/assets.py search "<subject>"` lists Wikimedia Commons files with their licences; only public domain, CC0, CC BY and CC BY-SA are accepted (NASA and other government imagery is usually public domain). Generation needs the user's approval (no paid tool without it).
3. Plan it as an `image` object (`role: photo`, `asset: "commons:<File>"`, `focus` [x, y] for the crop, `treatment`: `edge-left` to meet a title field, `fade-left`/`fade-bottom` for text over the picture, `duotone`/`tint` to bring a colour photo into the palette). The crop and treatment are computed for the box at build time.
4. Provenance is automatic: the picture's description holds key, author, licence and URL; the source line gets a credit.

**Where imagery is expected:** covers, dividers and closing pages (P5, P7) always carry a picture or a map; a blank title field needs a recorded reason.

**Hard constraints:**
- Recorded source and licence.
- Never data-like.
- Never obscures evidence.
- Charts and data stay native and editable.

**Risks:**
- **Works when** the image is the topic and integrated with the palette.
- **Fails when:**
  - unrelated stock imagery;
  - pictograms enlarged;
  - photos behind dense marks.

**Status**
| Dimension | State |
|---|---|
| Engine | Renders pictures |
| Builder | **Exposed:** Commons search and fetch with licence gate; `image` objects in slots and covers; crop to box (focus point), duotone, tint, fades and edge blends rendered to the picture; credits added to the source line |
| Editability | Picture (prepared per box; re-prepared on redesign) |
| Readiness | Photos designed (tested) on cover and closing pages; cutouts and line patterns not started |
| Visual gap | Medium (no cutouts, no layered compositions yet) |
