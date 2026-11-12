---
id: M3
type: modifier
layer: L2
name: Reference markers (benchmark bar, benchmark line or band, shaded period, target)
aliases: [T11, T20, T44, CH9, CH6]
refs: [u09, "lib:fbbb35f9e3:44", "lib:51b7e6ea4f:5"]
---

**Purpose:** give every value its context: an average, a peer group, a threshold, a period of interest.

**Host:** V05, V07, V15, V16.

**Variants:**
- **Benchmark bar (T11):** an entity-like bar for an average or a group, in grey, labelled as a benchmark.
- **Benchmark line or band (T44):** a level across the plot.
- **Shaded period (T20):** a crisis or projection window, labelled with its years.
- **Target or threshold:** for example a deficit rule; actual against target.

**Hard constraints:**
- The benchmark has a stated source and derivation (an average is a derivation with provenance).
- Projections are visibly distinct.

**Risks:**
- **Works when** the reference changes how the values read.
- **Fails when** the average is unsourced, or several references compete.

**Execution:** neutral tones; a dashed or light treatment that never outweighs the data (R1, R5).

**Status**
| Dimension | State |
|---|---|
| Engine | Renders |
| Builder | **Partial:** shaded band on the designed line; the derivation mechanism exists for averages |
| Editability | Native shapes; bound |
| Readiness | Band designed (tested). Benchmark bar and target line not started |
| Visual gap | Medium |
