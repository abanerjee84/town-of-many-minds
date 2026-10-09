# Troubleshooting

| Observation | Check |
| --- | --- |
| Browser cannot load the app | Run `npm ci` and `npm run dev`; use the printed URL rather than a guessed port or `file://` |
| Council disconnected or HTTP error | Confirm a loaded model and compatible completions endpoint; check the local server, `/lm` proxy, model ID and provider error |
| Thinking appears to hold time | Public decisions intentionally pause the snapshot; default requests receive a 20-second abort signal. Custom adapters must honor it |
| Every motion deferred for a resource remedy | Inspect the mandatory line, resource production/demand, active project and financing. A same-sitting owner correction now runs once; malformed/refused replies still take no automatic action |
| Housing requested but no home started | Check the developer's immediate accept/reject response, demand, contractor/project slots, acquired frontage, buffers and finance |
| Grass visible but factory cannot build | Verify acquired membership, complete contiguous footprint, industrial siting, access and material/capital eligibility |
| High congestion but no street started | A threshold does not establish a useful legal candidate. Check hotspot/trip evidence, occupied land, reservations, acquisition and financing |
| Unemployed residents but `HIRE_WORKERS` does nothing | Hiring requires vacancies and fundable suitable posts; local training or viable new capacity may be the remedy |
| Resource bar full while supply is inadequate | The bar is stock fill. Compare daily production and consumption and future capacity |
| Factory has zero staff/output | Inspect education matching, payroll/arrears, vacancies, working capital, inputs and utilities rather than only floors |
| Treasury rises during construction | Identify the payer and ledger category; private/PPP finance, bond inflows and fees are not the same as government spending |
| Camera keeps reverting | Turn Fit Town off. It reframes on acquisitions and every three game hours |
| Different defaults after refresh | Settings are persisted for this browser origin; search Settings or reset its defaults |
| Browser regression connects to another town/port | Set `APP_URL` explicitly in the test terminal |
| Playwright executable missing | Run `npx playwright install chromium` |
| MapNow folder is not updated on a hosted site | Static hosting lacks the local writer; configure `/__mapnow` or capture the text in the browser |

## Known limitations

- The strict bus/refuelling horizon has an unresolved queue/completion failure. A diagnostic completed refuelling, but later fixtures still exceeded hold limits or commissioned too late to complete. The existing assertions remain intact; this is not listed as solved.
- Grown-town performance is limited by active agents and rendering. A recorded RTX 5060 Ti fixture with 170 residents, 51 buildings and 38 vehicles averaged 43.7 ms/frame (about 23 FPS), with 66.6 ms p95. These are hardware/fixture-specific observations, not a universal target or latest-device benchmark.
- Calendar speed can outrun the bounded agent budget; use the lag readout. The simulation has not yet migrated to a Web Worker.
- The browser owns live progression and settings. There is no authoritative hosted/offline simulation or finished player save/load backend.
- Model quality and serving throughput remain external variables. Mocked tests verify boundaries and orchestration, not a guarantee of autonomous choices from every local model.
- Kit contracts/adapters coexist with large legacy coordinator modules. Arbitrary new behaviours and untrusted plugin isolation are not JSON-only features.
- Justice detail, some essential fleet-financing edge cases and normal-provider long-horizon comparisons remain in the [TODO](../BuildContracts/TODO.md).

## Report a reproducible issue

Include the seed, day/time, settings, provider/model, request/decision detail, inspected object, browser and whether the run was foreground/manual/forced. For performance, include achieved calendar speed and agent lag as well as FPS. For accounting, include source/destination/category and the relevant period; a screenshot of treasury alone cannot identify its cash flows.

Use [testing](testing.md) to isolate the subsystem. Preserve failures and rollback/audit evidence when updating the [SRS](../BuildContracts/SRS.md).
