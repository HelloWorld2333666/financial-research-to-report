# China Re: FY2025 evidence bundle (real data)

`fy2025_bundle.json` is a hand-built evidence bundle for China Reinsurance (Group) Corporation (HKEX: 1508). It is drawn from two public HKEX filings. Unlike `fixtures/`, it contains **real figures**, so treat it as research material.

## Sources

| Source id | Document | Published | SHA-256 |
|---|---|---|---|
| `src.cr.fy2025_results` | [Announcement of Annual Results for the Year Ended 31 December 2025](https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0330/2026033002224.pdf) (74 pp.; printed page = PDF page) | 2026-03-30 | `2424ca31…9d0` |
| `src.cr.fy2025_sustainability` | [2025 Sustainability Report](https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0429/2026042902150.pdf) (138 pp.; printed page = PDF page − 1) | 2026-04-29 | `0c7f2c89…71f` |

The full hashes are in the bundle. The PDFs themselves are not committed.

## What's in it

- **35 evidence items**
  - 23 metric values covering:
    - total income, insurance revenue (group and segments), net profit attributable, weighted average ROE and total assets
    - combined ratios for three segments
    - group core and aggregated solvency ratios
  - 12 qualitative facts or quotes
- **7 findings and 6 claims**, all computed as `supported`
- **5 candidate slide modules** for an overview page: ownership, business mix, financials, underwriting, capital and ratings
- **7 gaps**: no geographic split found; no group combined ratio found; ratings only issuer-reported; C-ROSS minimums not sourced; 2025 solvency unaudited; shareholder support not assessed; issuer risk disclosures not reviewed

Every metric records its `subject` (group or segment), `period` and `unit`. Where the issuer's definition differs from the generic one, it is recorded in `issuer_definition`, for example ROE on weighted average equity, or the IFRS 17 combined ratio.

## How it was verified (2026-10-26)

1. Downloaded both PDFs from hkexnews.hk and recorded their SHA-256.
2. Extracted text with `pypdf` and located each figure. Recorded the PDF page and a verbatim excerpt.
3. `frr check-sources` confirmed each excerpt appears on its stated page, and each value appears in its excerpt: **35 ok, 0 failed**. The document hashes matched.
4. Rendered the table pages (results pp. 2, 4, 18, 19, 20, 21, 25, 28, 44; sustainability PDF p. 5) and read each value against its column header. This catches errors the excerpt check cannot, such as which year or ratio a number belongs to in "Group 155 189 159 194". The qualitative excerpts on pp. 1, 24 and 59 have no column ambiguity and were checked by excerpt match only.
5. Recomputed every derived number in the findings, such as +5.8%, −7.4%, −1.56 pp, 83.01% and the RMB bn roundings.

**The verification was done by an AI assistant (Claude), not a person.** Each item says so in `verified_by` ("human review pending"). Before relying on the figures, tick the checklist below against the PDFs.

## Re-running the checks

```bash
pip install -e ".[pdf]"
curl -L -o /tmp/cr_results.pdf https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0330/2026033002224.pdf
curl -L -o /tmp/cr_sr.pdf https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0429/2026042902150.pdf
frr check-sources --evidence research/china_re/fy2025_bundle.json \
    --file src.cr.fy2025_results=/tmp/cr_results.pdf \
    --file src.cr.fy2025_sustainability=/tmp/cr_sr.pdf
frr run --company "China Reinsurance (Group) Corporation" \
    --objective "Assess the company's business profile, financial strength and key credit risks for a short credit overview." \
    --sector insurance --period FY2024-FY2025 \
    --evidence research/china_re/fy2025_bundle.json --out output/china_re_fy2025
```

## Human review checklist

"Results" is the FY2025 results announcement; "Sustainability" is the 2025 sustainability report. Pages are PDF pages.

| # | Evidence | Source, PDF page | Recorded | Excerpt to find | Human OK |
|---|---|---|---|---|---|
| 1 | `ev.cr.total_income.fy2025` | Results, p.2 | 1.24928e+08 RMB thousand, FY2025 | Total income 124,927,594 118,132,916 | [ ] |
| 2 | `ev.cr.total_income.fy2024` | Results, p.2 | 1.18133e+08 RMB thousand, FY2024 | Total income 124,927,594 118,132,916 | [ ] |
| 3 | `ev.cr.insurance_revenue.fy2025` | Results, p.2 | 1.03087e+08 RMB thousand, FY2025 | Insurance revenue 4 103,087,051 101,363,282 | [ ] |
| 4 | `ev.cr.insurance_revenue.fy2024` | Results, p.2 | 1.01363e+08 RMB thousand, FY2024 | Insurance revenue 4 103,087,051 101,363,282 | [ ] |
| 5 | `ev.cr.net_profit_attr.fy2025` | Results, p.18 | 9.77114e+06 RMB thousand, FY2025 | Net profit attributable to shareholders of the parent company 9,771,143 10,556,993 | [ ] |
| 6 | `ev.cr.net_profit_attr.fy2024` | Results, p.18 | 1.0557e+07 RMB thousand, FY2024 | Net profit attributable to shareholders of the parent company 9,771,143 10,556,993 | [ ] |
| 7 | `ev.cr.roe.fy2025` | Results, p.21 | 9.18 percent, FY2025 | Weighted average return on equity (%) 1 9.18 10.74 | [ ] |
| 8 | `ev.cr.roe.fy2024` | Results, p.21 | 10.74 percent, FY2024 | Weighted average return on equity (%) 1 9.18 10.74 | [ ] |
| 9 | `ev.cr.total_assets.2025` | Results, p.4 | 5.27763e+08 RMB thousand, 31 Dec 2025 | Total assets 527,763,431 508,347,105 | [ ] |
| 10 | `ev.cr.total_assets.2024` | Results, p.4 | 5.08347e+08 RMB thousand, 31 Dec 2024 | Total assets 527,763,431 508,347,105 | [ ] |
| 11 | `ev.cr.seg_rev.pc_re.fy2025` | Results, p.19 | 45812 RMB million, FY2025 (P&C reinsurance segment) | P&C reinsurance 1 45,812 46,042 (0.5) | [ ] |
| 12 | `ev.cr.seg_rev.lh_re.fy2025` | Results, p.19 | 10088 RMB million, FY2025 (Life and health reinsurance segment) | Life and health reinsurance 1 10,088 9,846 2.5 | [ ] |
| 13 | `ev.cr.seg_rev.primary_pc.fy2025` | Results, p.19 | 48869 RMB million, FY2025 (Primary P&C insurance segment (China Continent Insurance)) | Primary P&C insurance 1 48,869 46,914 4.2 | [ ] |
| 14 | `ev.cr.cr.domestic_pc_re.fy2025` | Results, p.25 | 95.98 percent, FY2025 (Domestic P&C reinsurance (China Re P&C)) | Combined ratio (%) 3 95.98 92.77 | [ ] |
| 15 | `ev.cr.cr.domestic_pc_re.fy2024` | Results, p.25 | 92.77 percent, FY2024 (Domestic P&C reinsurance (China Re P&C)) | Combined ratio (%) 3 95.98 92.77 | [ ] |
| 16 | `ev.cr.cr.overseas_pc_chaucer.fy2025` | Results, p.28 | 81.19 percent, FY2025 (Overseas P&C reinsurance and Chaucer) | Combined ratio (%) 3 81.19 84.71 | [ ] |
| 17 | `ev.cr.cr.overseas_pc_chaucer.fy2024` | Results, p.28 | 84.71 percent, FY2024 (Overseas P&C reinsurance and Chaucer) | Combined ratio (%) 3 81.19 84.71 | [ ] |
| 18 | `ev.cr.cr.primary_pc.fy2025` | Results, p.44 | 99.17 percent, FY2025 (Primary P&C insurance (China Continent Insurance)) | Combined ratio (%) 3 99.17 97.67 | [ ] |
| 19 | `ev.cr.cr.primary_pc.fy2024` | Results, p.44 | 97.67 percent, FY2024 (Primary P&C insurance (China Continent Insurance)) | Combined ratio (%) 3 99.17 97.67 | [ ] |
| 20 | `ev.cr.cr.primary_pc_incl_finance` | Results, p.44 | fact | the calculation result of which was 100.41% | [ ] |
| 21 | `ev.cr.solvency_agg.2025` | Results, p.20 | 189 percent, 31 Dec 2025 | Group 155 189 159 194 | [ ] |
| 22 | `ev.cr.solvency_agg.2024` | Results, p.20 | 194 percent, 31 Dec 2024 | Group 155 189 159 194 | [ ] |
| 23 | `ev.cr.solvency_core.2025` | Results, p.20 | 155 percent, 31 Dec 2025 | Group 155 189 159 194 | [ ] |
| 24 | `ev.cr.solvency_core.2024` | Results, p.20 | 159 percent, 31 Dec 2024 | Group 155 189 159 194 | [ ] |
| 25 | `ev.cr.solvency_unaudited` | Results, p.20 | fact | The relevant solvency data as at 31 December 2025 has not been audited by the auditors of the Company | [ ] |
| 26 | `ev.cr.business_lines` | Results, p.19 | fact | The Group is engaged in P&C reinsurance, life and health reinsurance, primary P&C insurance, asset management, insurance intermediary business and other businesses. | [ ] |
| 27 | `ev.cr.history` | Sustainability, p.5 | fact | China Re is originally from the People's Insurance Company of China established in October 1949 and restructured into a joint-stock limited company in October 2007. | [ ] |
| 28 | `ev.cr.listing` | Sustainability, p.5 | fact | On 26 October 2015, China Re was listed on the Main Board of the Stock Exchange of Hong Kong Limited | [ ] |
| 29 | `ev.cr.shareholders` | Sustainability, p.5 | fact | Ministry of Finance holding 11.45% and Central Huijin Investment Ltd. holding 71.56%. | [ ] |
| 30 | `ev.cr.controlling_shareholder` | Results, p.59 | fact | the Company and Central Huijin, the controlling shareholder, complied | [ ] |
| 31 | `ev.cr.ratings_issuer` | Results, p.21 | quote | we maintained the "A (Excellent)" rating by A.M. Best and "A" by S&P Global Ratings | [ ] |
| 32 | `ev.cr.agri_decline` | Results, p.24 | fact | mainly due to the decline in scale of earned premiums from domestic agriculture insurance business | [ ] |
| 33 | `ev.cr.cat_losses` | Results, p.28 | fact | the first half of the year was impacted by catastrophic losses such as California wildfires in the United States and SCS | [ ] |
| 34 | `ev.cr.investment_yield` | Results, p.19 | fact | Total investment yield (%) 4 4.66 4.83 | [ ] |
| 35 | `ev.cr.ifrs17` | Results, p.1 | fact | "IFRS") 17 – Insurance Contracts | [ ] |
