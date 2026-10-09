# Architecture and runtime

TOMM is a client-side ES-module application. Vite serves/builds it; Three.js renders the scene. The default local server adds an LLM reverse proxy and a MapNow filesystem writer. There is no authoritative remote simulation server.

## Source map

| Location | Responsibility |
| --- | --- |
| `src/main.js` | Bootstrap, frame loop, settings UI/application, camera readout, diagnostic browser hooks |
| `src/core/` | Grid and enums, deterministic RNG, clock, events, graph/pathfinding, signals, settings and spatial indexes |
| `src/world/scene.js` | Renderer, camera/OrbitControls, lighting, fog/sky, weather visuals and render quality |
| `src/simulation/town.js` | Town ownership, generation/reset, subsystem composition, mutations and coordinated agent advancement |
| `src/simulation/governance.js` | Evidence report, prompt composition, parsing, Cabinet calls, enactment and decision lifecycle |
| `src/simulation/cabinet.js`, `mayor.js` | Department boundaries, motion parsing/mix and approval sequencing |
| `src/simulation/growth.js` | Site/plan selection, feasibility, quotes, reservations, projects and completion |
| `src/simulation/economy.js`, `industry.js` | Accounts, jobs, private decisions, money transfers, inventory and production |
| Other `src/simulation/` modules | Traffic/agents, population lifecycle, transport, society, policies, research, investment, environment, learning/KPIs and exports |
| `src/placement/` | Founding layout, parcel/parking allocation, site and connectivity rules, construction pipeline/validation |
| `src/kits/` | Registry/contracts, built-in manifests, building/road/vehicle/resource/public/foliage renderers and adapters |
| `src/data/` | Rule and catalogue JSON bundled with the client |
| `src/ui/` | HUD, interaction/inspection and escaping external text |
| `scripts/` | Browser and standalone regressions, benchmark fixtures, MapNow capture and docs generation/checking |
| `BuildContracts/` | Requirement history, TODO, hardcode audit and baseline records |

## Frame and game-time boundaries

The foreground loop uses `requestAnimationFrame`, caps elapsed frame time, updates the calendar, and computes scaled simulation time. During a pending governance request it holds speed for the frame and restores the user's selected speed in a `finally` path.

`Town.advance()` coordinates traffic, pedestrian, signal and incident fixed steps. Agent simulation has a finite budget so a large requested calendar jump does not run an unbounded collision loop. Lifecycle, economy, industry, construction and governance have their own game-time/day boundaries. Resources and scene updates use their documented clocks.

The implication is measurable: a displayed 50× calendar speed is not proof that every vehicle travelled 50 real-time seconds per second. The performance meter exposes achieved calendar progression and skipped agent time. Hidden tabs receive browser-throttled frames, and return gaps are not treated as full offline catch-up.

## State and invariants

The grid records cell kind, roads/features/classes, zones and ownership. The perimeter ledger records acquired cells separately. Buildings retain stable IDs, anchors, complete footprint cells, floors, capacities, owner and kit metadata. Vehicle ownership assets are separate from currently driving agents. Active projects retain target/site reservations and snapshot/rollback state.

Feasibility/report reads must not inadvertently consume simulation randomness. Mutation paths invalidate graph/stats/render state rather than rebuilding the whole town for every decorative change. Agent route caches key against graph versions; dynamic congestion/collision observations remain current where required.

Account transfers and project outcomes are auditable. A registered intent is vocabulary/routing metadata; neither an LLM sentence nor a manifest declaration by itself may bypass placement, financing or the executor. Council-created private opportunities retain independent acceptance.

## Events and diagnostic access

The shared event bus connects land changes to ground/camera updates, decisions to HUD/KPIs, and `map-now` to the local writer. Browser diagnostics include `town`, `clock`, `sceneMgr`, `planFor`, `parseIntent`, `forceCouncilRequest`, provider registration, construction palette, kit compatibility and benchmark helpers.

```js
const stats = town.stats();
const compatibility = kitCompatibility();
const palette = constructionPalette();
const mapText = mapNow.capture();
```

`Town.exportIntegrityState()` / `importIntegrityState()` exist for integrity/regression state boundaries. Kit state restore checks compatibility signatures. These are not a complete player-facing save/load system or a persistence backend; inspect the integrity implementation before relying on full runtime restoration.

## Modularity boundary

The kit registry, catalogue metadata, adapters and JSON rules are modular. Large `Town`, growth and governance modules still coordinate legacy subsystem logic and action branches. Hook adapters can receive both context and `town`; there is no sandbox isolating a third-party kit from all internal state. New behaviour generally requires code plus data, not one JSON row alone.

See [kit extension paths](kits.md) and the [SRS](../BuildContracts/SRS.md) before treating the architecture as a general plugin loader. A simulation Web Worker, further rendering batches and some service/justice detail remain planned work.
