# Testing and regression workflow

## Start with the relevant check

The project has named standalone and Playwright scripts, not one universal `npm test` command. [Script reference](reference/scripts.md) lists every npm entry and its executable.

```sh
npm ci
npx playwright install chromium
npm run dev
```

Keep Vite running in its own terminal and set its actual address in the test terminal:

```powershell
$env:APP_URL = 'http://localhost:5173'
npm run docs:check
npm run build
npm run test:cabinet-remedy
npm run test:kit-registry
```

Playwright installation downloads its browser runtime. Existing system browsers do not automatically replace that runtime. Scripts use different fallback ports, so always set `APP_URL` when testing another checkout or server instance.

## Choose checks by subsystem

| Change | Relevant commands |
| --- | --- |
| Council/provider/remit | `test:cabinet`, `test:cabinet-remedy`, `test:council-flow`, `test:council-authority`, `test:prompt`, `test:provider-matrix` |
| Land/site/housing | `test:perimeter`, `test:land-gate`, `test:resource-land`, `test:factory-site`, `test:housing-growth`, `test:housing-street-expansion`, `test:campus`, `test:resource-neighbour` |
| Kit/modularity | `test:kit-registry`, `test:kits`, `test:hardcode-audit`, `test:intents` |
| Economy/agency/work | `test:economy`, `test:fiscal-funding`, `test:agency-boundary`, `test:developer-independence`, `test:employment-mobility`, `test:workforce-training`, `test:private-queue` |
| Industry/trade/FDI | `test:factory-production`, `test:industry-planning`, `test:industry-expansion`, `test:market-chart`, `test:fdi` |
| Roads/vehicles/transit | `test:road`, `test:vehicle-parking`, `test:private-route-retry`, `test:transit-stop`, `test:society`, `test:bus-stuck` |
| Environment/UI | `test:weather`, `test:forest`, `test:vegetation-clear`, `test:lake`, `test:ui`, `test:glow` |
| Performance/evaluation | `test:performance`, `test:performance-stress`, `test:performance-grown`, `test:spatial-index`, `test:spatial-traffic`, `test:performance-meter`, `test:speed`, `test:kpi` |

Run heavy browser tests serially. Concurrent WebGL browsers can distort performance results and compete for CPU/GPU. A failing strict fixture should stay visible; do not relax a safety assertion merely to obtain a green log.

## Forced requests and horizons

`forceCouncilRequest` routes a specific request through enactment for deterministic mechanism checks:

```js
clock.speed = 0;
town.governance.auto = false;
const result = forceCouncilRequest('INTENT: BUILD_FACTORY type=cement');
```

A forced request retains current legality, finance and construction checks. It does not guarantee a start. Do not mix forced/manual interventions into autonomous-model KPI comparisons without labeling them.

Fast road/metropolis commands use forced requests to exercise long-horizon mechanisms without waiting for live LLM calls. They still have simulation costs and are not proof that a normal Council would select the same actions.

```powershell
$env:HORIZON_SEEDS = '1337'
$env:HORIZON_DAYS = '200'
$env:HORIZON_REQUEST_EVERY = '8'
npm run test:metropolis-fast
Remove-Item Env:HORIZON_SEEDS, Env:HORIZON_DAYS, Env:HORIZON_REQUEST_EVERY
```

`test:unemployment-horizon` defaults to 800 sampled days and supports `UNEMPLOYMENT_SEED`, `UNEMPLOYMENT_DAYS`, `UNEMPLOYMENT_REQUEST_EVERY`, `UNEMPLOYMENT_SNAPSHOT_EVERY`. Read its clock/agent stepping before equating a sampled day with a full real-time traffic day.

## Record evidence

Capture seed, settings, provider, script options, actual duration, invariant/audit results, first blocked/completed event, and the final state. Separate requested speed, measured calendar speed and agent budget. `AGENT_PROFILE=1` adds detailed timing to the grown benchmark and changes its instrumentation cost; ordinary frame measurements should leave it off.

The Cabinet-remedy fixture uses controlled provider replies and real plans/quotes/construction. Its 12-day chain verifies same-sitting correction and avoids live model/token costs. It also checks oversized reports, stale/in-flight directives, cap/resource guards and refusal without automatic spending.

The [TODO](../BuildContracts/TODO.md) records measured known failures, including the strict bus/refuelling horizon. Documentation checks validate local links, fragments and generated-reference freshness; they do not replace subsystem tests.
