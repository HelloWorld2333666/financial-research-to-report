---
id: P4
type: pattern
layer: L3
name: Summary to detail (bracketed detail, aligned metric rows)
aliases: [T27, T15, LY5, TB4, CH13]
refs: [u16, u04, "lib:4c2bb634d8:9"]
---

**Purpose:** carry the reader from a summary (a composition or a grouped chart) to the evidence that explains part of it.

**Applies when:** a composition whose segments have their own detail, or a grouped chart whose groups have derived measures.

**Variants:**
- **Bracketed detail (T27):** a summary stacked column with grey minor segments and coloured key segments; a bracket from the key segments to detail tables; **in-cell bars in the matching segment colours**; logos as row identifiers.
- **Aligned metric rows (T15):** signed-change pills aligned exactly under the groups they describe.

**Hard constraints:** the detail sums to, or is a subset of, the summary segment, and the note says which.

**Combines with:** V04, V09 (two-level headers, in-cell bars), S1 logos, D1 colour link and bracket, C1 numbered footnotes.

**Risks:**
- **Works when** colour and the bracket make one chain.
- **Fails when** the colours don't match, or the bracket points at nothing specific.

**Execution:** the summary narrow; the detail wide; one colour per linked segment across both (R2, R10).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Partial:** brackets drawable as line decoration; tables and in-cell bars exist |
| Editability | Native, bound |
| Readiness | Not started as a pattern |
| Visual gap | High |
