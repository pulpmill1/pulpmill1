---
name: loss-8020-dashboard
description: Use when updating, extending, or refreshing the "Loss 80:20" Pareto page inside the Pulpmill1 dashboard (index.html, nav item "Loss 80:20" / data-page="loss-production"), or when refreshing its Claude Artifact preview. Covers the source Google Sheet's schema, the live-fetch/classification logic in index.html, and the daily snapshot-refresh recipe for the Artifact (which cannot fetch the sheet live itself).
---

# Loss 80:20 Dashboard

## What this is

A Pareto 80:20 page (`data-page="loss-production"`, nav label "Loss 80:20") inside the
Pulpmill1 dashboard (`index.html` in this repo), driven entirely by `lp*`/`LP_*` functions near
the end of the big inline `<script>`. It live-fetches the source Google Sheet client-side on
every page load — never hardcoded, never written back to the sheet. There is also a standalone
**Claude Artifact preview** of just this page, published at:

**https://claude.ai/artifact/2BsP8yfm4gjbNNBwcY9bTr**

Keep updating that same URL (pass it as `url` to the Artifact tool) rather than publishing a new
one, so the link people already have keeps working.

## Source of truth

- Google Sheet: `1bY5nzXap71jk9_yqnKy9lQtnwZuU7-wuy3oGiYrKTUA` ("Loss 80:20 dashboard sorce"),
  owned by `pulpmill1.doublea1991@gmail.com`, shared "Anyone with the link can view" (required —
  this is what makes the production page's client-side CSV fetch work with no auth).
- **In-scope tabs: `2022`, `2023`, `2024`, `2025`, `2026` only.** A `2021` tab still exists but
  uses an older, incompatible schema (free-text Type + a separate Sub Type column, Date
  start/end split in two) and is deliberately excluded — the user asked for 2022-2026 only after
  the sheet was restructured. Don't re-add it without being asked.
- Two reference/lookup tabs also exist: **`EQ type`** (EQ num → EQ Type, e.g. `421P001` →
  `MC PUMP`) and **`TYPE`** (EQ Type → the list of valid Type values for it, used as the sheet's
  own dropdown data-validation source). The dashboard does not currently read these — all rows
  in 2022-2026 already carry EQ Type and Type directly (dropdown-filled, ~100% populated) — but
  they're there if a future row needs backfilling.
- Row layout per year tab (identical across 2022-2026): row 2 = title, row 4 = header, data from
  row 5. Header (meaning-based matching in the code, not column position — tabs do drift):
  `Month | Date | EQ num | EQ Type | Type | Loss Production (ADT desc + value, two sub-columns)
  | CM | PM | Remark`. No Duration/Time Start/Time End/Compensate loss/Sub Type columns anymore
  (2021 had those; 2022-2026 don't).
- **Date header is literally `Date` (singular), not `Date start`.** The header-matching code
  treats `hl==='date start' || hl==='date'` as the same field — if a future tab uses yet another
  spelling, add it there rather than assuming. Getting this wrong silently downgrades every row
  to "Month Only" date accuracy instead of throwing, so it's easy to miss — diff a fresh fetch
  against the last-known good CSV (see below) rather than trusting it rendered without erroring.
- **Dates are day-first (D/M/YYYY)**, e.g. `22/2/2021` (day=22 proves it). Some cells hold a
  range or list instead of one date (`"25-26/1/2023"`, `"4,7/1/2023"`) — the parser's regex
  intentionally fails closed on those (falls back to "Month Only" instead of misparsing).
- **`EQ Type` header may also appear as `EQ name`** depending on the tab/era — the code treats
  both as the same field (`eqName` internally). It holds a standardized category now (`WASH
  PRESS`, `VALVE`, `UTILITY`, `MC PUMP`, …), not a specific equipment nickname, so the UI labels
  it "EQ Type" everywhere (filter, Pareto By, Equipment Matrix, Loss Detail).
- Footer markers to exclude from events (by text, found via the description column wherever it
  lands — not a fixed column index): per month, `Total Loss` / `Recovery` / `Total Loss -
  Recovery pulp`; once per year after a blank row, `Production Budget` / `Production Actual` /
  a second `Total Loss` (the annual net figure — don't confuse it with the monthly one of the
  same label 3 rows earlier).

## Classification

**A row counts as `Classification Source = Original` the moment it has a non-blank `Type` —
full stop, no Sub Type requirement.** Sub Type does not exist as a column for any in-scope year
(2022-2026), so a check that also required it (the old logic, written back when 2021 was still
mixed in) silently reclassified ~100% of rows into "needs AI classification" even though they
already had an authoritative Type from the sheet's own dropdown. If you ever see
`classificationSource` mostly `AI Classified`/`Needs Review` instead of `Original`, this is the
first thing to check. The keyword-based classifier (`lpBuildClassifier`/`lpTokenize`) still
exists for genuinely blank `Type` cells, which are now rare (the "TYPE" dropdown tab means
almost every row already has one) — it builds its reference vocabulary live from whatever rows
in the current fetch already have a Type, no hardcoded year.

## Live-fetch pattern (production, `index.html`)

Same shape as the sibling `pulp-mill-1-dashboard` skill's pattern: `fetch()` against
`https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={tabName}` for each
of `LP_YEARS`, parsed with the shared quote-aware `parseSheetCSV`, mapped to fields by header
*meaning* (`lpParseYearSheet`'s `col.xxx = i` block) so column drift across tabs doesn't silently
break anything, classified (`lpClassifyAll`), then rendered by the `lpRender*` functions. Entry
point is `initLoss8020Dashboard()`, called once near the end of `boot()`, wrapped in its own
try/catch so a failure here can never break the rest of the dashboard (production/yield/cost
pages). All of this is read-only against the sheet — nothing is ever written back.

## Refreshing the Artifact preview (it cannot fetch the sheet live)

The Artifact sandbox's CSP blocks `fetch()` to `docs.google.com` entirely (only a short CDN
allowlist is reachable), so the published Artifact embeds a **snapshot** of the sheet instead of
fetching it live, and needs to be explicitly refreshed and republished. Recipe, each time:

1. **Fetch the sheet.** Use the Google Drive connector (`mcp__Google_Drive__download_file_content`
   with `fileId: '1bY5nzXap71jk9_yqnKy9lQtnwZuU7-wuy3oGiYrKTUA'`,
   `exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`) — this
   downloads the whole workbook as base64 xlsx, sidestepping the same `docs.google.com` block
   (the connector call doesn't go through this session's own HTTP egress). Decode the base64 and
   save the xlsx into the session's scratchpad.
2. **Export each in-scope tab (`2022`-`2026`) to CSV text** with `openpyxl` (`data_only=True`),
   formatting dates as `D/M/YYYY` and times as `H:MM` to match what the live gviz endpoint would
   actually serve (see the date-format note above — get this wrong and the snapshot silently
   disagrees with production). One `sheet_{year}.csv` file per tab.
3. **Re-extract the current production parsing logic from `index.html`** rather than trusting a
   stale copy: pull the block from `const LP_SHEET_ID` through the trailing
   `initLoss8020Dashboard();` call, and the inner markup from
   `<section class="page" data-page="loss-production">...</section>`. The logic changes over
   time (this file documents the schema, not a frozen copy of the code) — always re-slice it
   fresh from the real file you're about to publish from.
4. **Run that logic in Node** (prepend the shared `parseSheetCSV` function, call
   `lpParseYearSheet` per CSV + `lpClassifyAll`, build the same `{rows, monthTotals, footer, dq,
   fetchedAt}` shape `lpFetchAll()` returns in the browser) to produce a `lp_snapshot.json`
   payload. Requiring the extracted file directly will throw an "unhandled rejection" /
   `document is not defined` from its own trailing `initLoss8020Dashboard();` call once Node
   finishes the synchronous part — that's expected noise after the snapshot file is already
   written, not a real failure; don't chase it.
5. **Assemble the Artifact HTML**: the full `<style>` block from `index.html`, the inner page
   markup wrapped in `<section class="page" data-page="loss-production">...</section>` (don't
   drop that wrapper — `initLoss8020Dashboard()`'s very first line is
   `document.querySelector('.page[data-page="loss-production"]')` and silently returns if it's
   missing, so the page just stays empty with zero errors), the snapshot JSON in a
   `<script id="lp-snapshot-data" type="application/json">` tag (escape `</script` inside it),
   Chart.js + chartjs-plugin-datalabels from cdnjs (pinned versions, matching `index.html`'s own
   `<script>` tags) plus `Chart.register(ChartDataLabels)`, then a small patched copy of the
   logic where `lpFetchAll()`'s live call is swapped for a `lpLoadSnapshot()` that reads and
   parses that embedded `<script>` tag's JSON (reviving `dateStart`/`dateEnd`/`fetchedAt` back
   into `Date` objects) — gate it with
   `document.getElementById('lp-snapshot-data') ? lpLoadSnapshot() : await lpFetchAll()` so the
   exact same file would still live-fetch normally if it were ever opened without that tag.
6. **Smoke-test before publishing** — this sandbox's own network also blocks `cdnjs.cloudflare.com`
   and `docs.google.com` directly, so test with Playwright + `page.route()` serving a local
   `npm install chart.js@4.5.1 chartjs-plugin-datalabels@2.2.0` copy for the CDN scripts, and
   `page.setContent()` (not a raw local HTTP server, which mis-serves the charset and garbles
   Thai text — that's a test-harness artifact, not a real bug, but it wastes time chasing). Check
   KPI tiles render, a filter change updates them, and `console` is clean.
7. **Publish** with the Artifact tool using `file_path` + `url:
   'https://claude.ai/artifact/2BsP8yfm4gjbNNBwcY9bTr'` so it updates in place.

## Daily refresh Routine

A Routine (`mcp__Claude_Code_Remote__create_trigger`, fresh session each firing) is set up to run
this whole recipe once a day and republish the Artifact. If it needs recreating: cron
`30 1 * * *` (08:30 Bangkok time, UTC+7 → 01:30 UTC), `create_new_session_on_fire: true`, prompt
pointing the fresh session at this skill file and the sheet/artifact URLs above (a fresh session
has no memory of this conversation, so the prompt must be fully self-contained — don't assume it
can see this file without being told its path). Diffing the newly-fetched CSVs against the
previous `sheet_{year}.csv` in the scratchpad before rebuilding is a fast way to confirm whether
anything actually changed and to sanity-check the diff looks like real edits (new rows, CM/PM
filled in) rather than a structural surprise (renamed header, shifted columns) that needs a code
fix in `index.html` first, the way the `EQ Type` rename and the `Date`-vs-`Date start` header did.

## Gotchas learned the hard way

- **Don't require Sub Type for "Original"** — see Classification above. This was the single
  highest-impact bug across this dashboard's history: it silently made the AI classifier do all
  the work on a dataset that was already ~100% authoritative.
- **Header text drifts between tabs/eras** (`EQ name` ↔ `EQ Type`, `Date start` ↔ `Date`) — the
  sheet's owner edits these by hand. Always match headers by normalized meaning
  (`lpNorm(h).toLowerCase()`), accept known synonyms, and when something looks newly blank,
  suspect a header rename before suspecting the data itself.
- **The annual footer block (`Production Budget`/`Production Actual`/a second `Total Loss`)
  reuses the `Total Loss` label** — track an `inFooter` flag once you've seen the footer markers
  so the annual figure doesn't get mistaken for the last month's monthly total.
- **Verify reconciliation, don't just assume it**: sum each month's extracted `Loss_ADT` and
  compare to that month's own `Total Loss` row where the sheet provides one. A real mismatch
  (found once, for May 2021 in the old schema) is a genuine source-data issue to surface in the
  Data Quality panel, not something to "fix" by altering the extracted rows.
- **This sandbox cannot reach `docs.google.com` or `cdnjs.cloudflare.com` directly** — neither
  for the production page's own live-fetch (can't be verified from here, only by a real browser)
  nor for the Artifact (CSP-blocked regardless of sandbox). Use the Google Drive connector for
  sheet access and local npm packages + Playwright `page.route()` for Chart.js when testing.
