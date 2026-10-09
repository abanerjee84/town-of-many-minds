# KPIs, benchmarking and map exports

## KPI panel and JSON

Open **KPIs** from the right inspector, filter rows, and choose **Export JSON**. The download is named `tomm-kpi-<seed>.json`. Schema version 1 contains run metadata, counters, scores, targets, current measured state, decision records and day snapshots.

```js
const payload = town.kpi.export();
```

Configured retention is 512 decision records and 365 snapshots. Counters can span the run while their retained underlying rows have already rolled off. The panel exposes shorter recent lists; `export()` includes the retained histories.

| Score | Current calculation | Interpretation limit |
| --- | --- | --- |
| Constraint compliance | accepted statuses / attempted decisions | Acceptance is defined by code statuses; it is not factual truth of LLM prose |
| Action throughput | `done` count / accepted count | Started/advisory/noop count as accepted; this is not matched project completion probability |
| Priority response | accepted priority decisions / priority decisions | Priority classification uses action/evidence heuristics |
| Repeat blocked rate | repeated intents following blocked/rejected / blocked count | A following retry can be successful; this is a repeat diagnostic and can exceed 1 |
| Treasury safety | clamp(treasury / operating-reserve target, 0, 1) | Cash safety relative to the current reserve target, not net worth |
| Congestion relief | clamp((previous - current congestion) / max(0.05, previous), 0, 1) | Day-over-day positive change; deterioration clips to zero |

Missing denominators can produce `null`; do not interpret no observations as a perfect score. Read the counters, retained decision detail and snapshots together. Manual, private and system-origin activity can enter shared histories; inspect `source`/`origin` before attributing every town outcome to the Council.

Current measures include population, buildings, treasury, unemployment, approval, mood, congestion, food reserve, beds and bed pressure. `kpiRules.json` supplies target values, not hidden rewards that alter the model's objectives.

## Compare models

Browser helpers expose `councilSnapshot`, `scoreCouncilRun` and `runCouncilBenchmark`; implementation is in [councilBenchmark.js](../src/simulation/councilBenchmark.js). The provider boundary keeps messages/parsing/execution comparable, including custom adapters.

For a useful comparison record seed, provider/model version, temperature, settings, rule/catalogue version, horizon, initial and final state, failures and request latency/usage. Hold those constant across models. Temperature zero reduces sampling variation but does not guarantee deterministic remote inference or identical asynchronous browser execution.

Distinguish four measurements: orchestration with controlled replies; single-provider decisions on fixtures; long-horizon town outcomes; and real foreground CPU/GPU performance. Forced build requests test the execution system, not autonomous model judgment. Read [testing](testing.md) for the scripted fixtures.

## MapNow

Governance emits a diagnostic map immediately before a sitting. Local Vite middleware accepts `POST /__mapnow`, writes `MapNow/latest.map.txt`, and retains up to 48 timestamped maps in `MapNow/history/`. These generated files are ignored by Git.

**MapNow is not fed to LLMs.** It is for inspection before experimenting with spatial evidence. The planning code currently consumes the town/grid/traffic structures directly, not this text export.

```powershell
$env:APP_URL = 'http://localhost:5173'
npm run mapnow:capture
```

Or inspect from the browser:

```js
console.log(mapNow.capture());
await mapNow.save();
```

The payload begins `TOMM-MAP/1`, with day/time, grid and cell/scale metadata, a padded acquired envelope, resource/mobility summaries, a coarse dominant-symbol map and small exact windows around pressure/frontier observations. `ACQUIRED_BOUNDS` includes the export's one-cell inspection padding; it is not an exact membership list. A coarse block can hide minority features.

| Symbol | Meaning |
| --- | --- |
| `.` / `_` | Frontier/unacquired / acquired vacant |
| `r` / `c` / `i` / `u` | Residential / commercial / industrial / civic or service |
| `f` / `e` / `g` / `w` | Food/farm / energy / fuel / water resource |
| `p` / `P` / `~` | Park / plaza / water |
| `#` / `+` / `o` / `t` | Street / four-lane street / roundabout / transit stop |
| `:` / `!` | Footway / pressure overlay |

Zone symbols can also represent acquired zoned cells without a built structure. `!` overrides the underlying feature where the overlay threshold applies. Inspect the exact windows and legends before using the coarse map as placement evidence.

A static deployment cannot write to a local MapNow folder without a compatible service. The browser still creates text; [deployment](deployment.md) covers the writer boundary.

## Learning evidence

The Council learning panel holds bounded outcome comparisons, separate from KPI scoring. It exposes observed before/after deltas; it does not fine-tune model weights or establish causal attribution. Elections, weather, private development and other simultaneous changes can affect the next sample.
