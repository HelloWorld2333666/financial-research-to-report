# Layout and composition

**Principles:** LY1–LY10.

**Layouts are data:** a `columns` composition lists column spans (12-column grid) and the slots stacked in each, and objects name their slot. Options:
- `tint` (full-height panel when last);
- `split` (title field when first);
- `dividers`;
- `matrix`;
- `diagram`.

**Composition patterns (recipes):**

| Recipe | Layout | Principles |
|---|---|---|
| `chart-commentary` | 8/4: exhibit, plus a commentary panel with lead-ins and a conclusion | LY2, ST1 |
| `rank-table` | 8/4: ranked table, plus a figures panel | TB1, LY2 |
| `multi-module` | 4/4/4: two exhibits with dividers, plus a figures panel and motif | LY3, LY2, BG2 |
| `exec-split` | split 4/8: title field with motif, plus numbered findings with figures | LY4, TY6 |
| `risk-matrix` | 12: matrix | TB2 |
| `causal-chain` | 12: diagram | DG1, DG2 |
| `agenda`, `divider` | deck navigation | ST5 |

**Rules:**
- **Vary the composition between consecutive slides** (LY10); keep the frame and colour roles constant.
- **Prefer one strong anchor per slide:** a large figure, a highlighted increment, or a tinted row.
- **When a slot overflows,** shorten the text or move a block to the panel. Never shrink type below the scale.

**Implemented in:** `core/design/compose.ts` (`columns`, `matrix`, `diagram`, `asset`).
