# Town of Many Minds

**TOMM** is a browser-based 3D town simulator for observing how an LLM governs a changing town. Five Cabinet ministers propose actions, a sixth Council call selects priorities, and the Mayor validates the resulting motions. Residents, private developers, traffic, industry, and public services continue through their own simulation systems.

![Seed 1337 town in the simulator](docs/assets/town-preview.png)

The experiment measures decisions and consequences: Can a model maintain food supply, create viable jobs, manage public debt, and expand a road network without wasting land? Council traits emerge from choices and recorded outcomes rather than a prescribed personality.

## How governance works

Each scheduled sitting makes up to six provider calls: one per Cabinet department, then one Council synthesis call. The departments and their remits (from `src/data/cabinet.json`):

| Department | Remit | Example intents |
| --- | --- | --- |
| Treasury & Economy | Keep the town solvent, productive, employed, and supplied | `TRADE_BUY`, `BUILD_FACTORY`, `RAISE_TAX`, `BOND_ISSUE` |
| Land & Housing | Place homes safely; acquire frontier land only when serviced plots are exhausted | `ACQUIRE_LAND`, `DEVELOP_HOUSING`, `UPGRADE_BUILDING` |
| Infrastructure & Mobility | Relieve measured congestion and connect destinations | `EXTEND_STREET`, `UPGRADE_ROAD`, `BUILD_TRANSIT` |
| Public Services & Utilities | Maintain water, power, sewage, waste, and emergency coverage | `UPGRADE_RESOURCE`, `BUILD_CIVIC`, `DISPATCH_UNITS` |
| Society, Education & Culture | Respond to mood, approval, safety, education, and recreation demand | `HOST_EVENT`, `ENACT_SCHEME`, `PASS_LAW` |

The Mayor approves at most five motions per sitting (`motionsPerSitting: 5`), emergencies first. A sitting that runs past **20 s** is aborted and retried on the next slot; after **3 consecutive failures** the default mode stops asking the model and shows `Council paused · N failures` — it does not substitute automatic public construction. Bounded outcome memory lets later sittings weigh what earlier motions actually did.

## Run locally

Use **Node.js 22.12+**, npm, and a browser with WebGL support. Development and regression work has also used Node.js 24.

```sh
git clone https://github.com/abanerjee84/town-of-many-minds.git
cd town-of-many-minds
npm ci
npm run dev
```

Open the address Vite prints — its configured port is **5173**, and it picks another only if that one is busy. Do not open `index.html` from the filesystem; the app needs the Vite module server.

For autonomous public decisions, run an OpenAI-compatible local model server (for example LM Studio) with a loaded model at **http://localhost:1234**; Vite forwards `/lm/v1` requests to it and strips the `/lm` prefix. If your server requires an explicit model identifier, set it from the browser console — there is no provider form in Settings:

```js
town.governance.setProvider('openai-compatible', {
  endpoint: '/lm/v1',
  model: 'your-loaded-model-id'
});
```

See [local model setup](docs/getting-started.md) and the [provider contract](docs/council.md#connecting-a-provider).

**Without a responding model**, the town still runs: residents, traffic, industry, weather and manual construction all work. The Council card reads `offline · awaiting Council`, then `Council paused` once repeated calls fail, and no public work is commissioned by a rules fallback. Turn off *Automatic LLM Council* in Settings while inspecting a disconnected run to avoid repeated request waits.

## A verified default run

The following was captured with a headless Playwright probe (`scripts/_readme_probe.mjs`) against `npm run dev`, seed 1337, no model connected:

| Fact | Observed value |
| --- | --- |
| Opening state | Day 1, 07:30, Spring, Clear; **$1,000,000** treasury |
| Founding town | 30 residents in 6 households (30/30 beds), 15 buildings (6 homes), 8 vehicles, 80 road tiles |
| Default speed | 100×; the calendar advanced ~2 game days in 20 wall-clock seconds even under software rendering |
| Economy after 3 days | Treasury $997,778, tax 100%, unemployment 0%, congestion 0%, mood *Content* → *Settled* |
| Council without a model | `offline · awaiting Council` → `Council paused · 4 failures`; decision log stays empty; no fallback construction |
| KPI modal | `Run 1337 · day N · <provider>` with JSON export; sections **Decision quality** (constraint compliance, action throughput, priority response, repeat-blocked rate) and **Town outcomes** (treasury safety, congestion relief, population, approval/mood) |
| Trade modal | Per-product daily demand table — e.g. goods 20/day, packaged food 1.7/day, software 0.88/day — with stock days, priority and remedy |
| Palette modal | Quoted construction blocks, e.g. Town Hall $27,158 / 32 h, School $108,630 / 32 h, University $218,925 / 36 h |

Starting defaults (from `src/core/settings.js` and the rule files): **$1,000,000 treasury**, **30 founding residents**, **100× speed**, **two Council sittings per day**, **up to five approved motions per sitting**, **shadows off**, automatic LLM Council on, maximum population 1000. Residential capacity is **three residents per footprint tile per floor** (setting range 1–8). These are model rules, not real-world forecasts.

## What the town simulates

| Area | Implemented behaviour |
| --- | --- |
| Governance | Five department-specific calls, Council synthesis, Mayor validation, immediate remedy correction, bounded outcome memory |
| Land and buildings | A compact acquired founding town inside a 100 × 100 plate; paid frontier acquisition, horizontal footprints, floors, wings, civic upgrades, residential communities |
| Economy and work | Separate public/private accounts, taxes and municipal fees, household savings, wages, loans and bonds, developer acceptance, training and service-sector jobs |
| Industry | Capacity-scaled factories, input recipes, shared commodity inventories, dynamic prices, imports and exports, a daily demand ranking shared by the Cabinet |
| Mobility | Congestion evidence across sittings, graph-based street evaluation, road upgrades, bridges, parking, buses, signals and emergency fleets (founding fleet: 2 police, 1 fire, 1 ambulance) |
| Civic life | Schools and healthcare, neighbourhoods, mood and approval, crime and justice records, elections, schemes and laws |
| Environment | Seasons, visible weather, day/night lighting, fog and sky, woodland, clearing and planting linked to lumber |
| Evaluation | Inspectable decisions, KPI panel with JSON export, provider benchmarks, pre-sitting MapNow text exports, forced-request regressions |

## Interface tour

- **Left HUD** — population (with out/in split), households, buildings, vehicles, road tiles, mood; primary resource gauges (stock bar + daily flow); treasury, tax, unemployment, beds, debt, congestion; a collapsible Storehouse commodity table; and the town chatter log.
- **Top strip** — the clock (day, period, time, season, weather) beside the Decisions card (sitting count, state chip, latest motions with actor tags), plus Council evidence (current thought, measured self-learning) and a societal summary (approval, neighbourhoods, elections).
- **Right inspector** — town overview and fleet by default; click any citizen, vehicle, building or road tile to inspect it. Four buttons open full views: **Decisions** (who did what and why), **Trade** (industry demand & trade), **Palette** (quoted construction blocks), **KPIs** (filterable rows + JSON export).
- **Bottom ribbon** — twelve tools (Inspect, Road, Footway, Bulldoze, House, Factory, Park, Tree, Lamp, Stop, + Car, + Citizen), the speed cluster (paused through 100×), the seed field with **Regen**, **Fit Town**, Settings and **Reset**.
- **Camera rail** — orbit/tilt/zoom buttons, fit/home, and ISO / TOP / N / E presets; a readout chip shows orbit, zoom and pan. A second chip reports measured FPS, actual calendar rate, and traffic lag.

## Explore the documentation

- [Start and connect a local model](docs/getting-started.md)
- [Controls, panels and settings](docs/user-guide.md)
- [Council, Cabinet, Mayor and provider API](docs/council.md)
- [World, placement and building progression](docs/world-construction.md)
- [Economy, employment, factories and investment](docs/economy-employment.md)
- [Industry demand and supply chains](docs/industry-demand.md)
- [Road planning, traffic and public transport](docs/mobility.md)
- [Society, resources, seasons and forestry](docs/society-environment.md)
- [Kit system and extension guide](docs/kits.md)
- [KPIs, benchmarking and MapNow](docs/evaluation.md)
- [Architecture and runtime](docs/architecture.md) · [Configuration and rule ownership](docs/configuration.md)
- [Testing and regression selection](docs/testing.md) · [Deployment](docs/deployment.md) · [Troubleshooting](docs/troubleshooting.md)
- [All documentation and reference tables](docs/README.md)

## Develop and verify

```sh
npm run build
npm run docs:check
npx playwright install chromium
```

Browser regressions require a running Vite server. In another terminal, point the checks at it (the script fallback ports vary, so set `APP_URL` explicitly):

```powershell
$env:APP_URL = 'http://localhost:5173'
npm run test:cabinet-remedy
npm run test:kit-registry
```

`scripts/` holds 80+ Node regression checks (economy, housing, industry, traffic, governance, performance) plus Playwright browser checks; `npm run docs:check` verifies the documentation links and tables. The probe used for this README's "verified default run" table is [scripts/_readme_probe.mjs](scripts/_readme_probe.mjs). See [testing](docs/testing.md) for the full command list, forced requests, and horizon-test costs.

## Repository layout

```
src/core        config, clock, settings, events, performance meter
src/simulation  town, economy, governance, cabinet, industry, traffic, society, KPIs, …
src/kits        construction kits (houses, civic, resources, glow) and the kit registry
src/placement   founding layout, site rules, validation
src/world       three.js scene manager
src/ui          HUD, interaction tools, inspector modals
src/data        JSON rule files (cabinet, economy, world, KPI rules, …)
scripts/        Node + Playwright regression checks and doc tooling
docs/           usage guides, implementation docs, reference tables
BuildContracts/ SRS, TODO, hardcode audit
```

The live app exposes `window.town`, `window.clock`, `window.mapNow` (`capture()` / `save()`) and friends on the console for inspection; MapNow saves land in `MapNow/` via the Vite dev server.

## Project status

TOMM is an experimental simulator. The browser owns the live run; background tabs are throttled, and public decision calls temporarily hold simulation time. Large towns can advance the calendar faster than their bounded traffic budget (the performance chip reports the lag). A strict long-run bus/refuelling regression still has an unresolved queue/completion failure. A simulation Web Worker remains planned work.

See [known limitations](docs/troubleshooting.md#known-limitations), the [SRS](BuildContracts/SRS.md), and [TODO](BuildContracts/TODO.md) for measured status. Making this repository public does not introduce a software licence; no `LICENSE` file is currently supplied.
