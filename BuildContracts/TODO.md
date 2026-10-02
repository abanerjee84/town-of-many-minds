# Construction and metropolis roadmap

Updated 2026-10-02 after the population-cap, factory-archetype, fuel-siting, founding-frame, progression, and weather audit.

## Completed

- [x] Shared immutable catalogue covers 64 blocks across housing, commerce, civic, industry, resources, utilities, roads, public space, and props.
- [x] Catalogue rows have stable IDs, kit/family labels, footprints, module roles, bills of materials, labour hours, and audit coverage.
- [x] HouseKit supports accessible entrances, balconies, solar roofs, planted roofs, deterministic rebuilds, and inspection metadata.
- [x] CivicKit includes courthouse, emergency shelter, transit hub, recycling centre, college, and university. College/university capacity is a measured `tertiary` service; lifecycle graduation waits for available higher-education capacity.
- [x] LANDMARKS retains the university campus milestone with a tertiary-capacity contract and a population/treasury gate.
- [x] PublicSpaceKit and PropKit cover paths, sports, community gardens, playgrounds, planters, picnic tables, bike racks, lamps, benches, and play structures without overlap.
- [x] Utility, solar, and farm upgrades add visible cabinets, treatment blocks, battery banks, and greenhouse extensions.
- [x] Battery storage is a first-class energy site. It is added only when storage capacity, rather than generation, is the measured binding constraint.
- [x] Waste flow is auditable in the resource report: generated, processing capacity, processed, recycled, composted, landfill, and diversion percentage.
- [x] Road/public furniture blocks expose measured demand gates for complete streets, cycle corridors, transit stops, and mobility/charging bays.
- [x] Construction palette UI groups blocks, shows module roles, filters by connected footprint and zone, and checks treasury runway and demand gates.
- [x] `IMAGINE_ARCHETYPE block=<id>` validates the shared block, carries its modules and flags into the project/building/decision record, and preserves its frozen quote through project start.
- [x] Building inspection shows block ID, module roles, accessibility, solar, planted-roof, and balcony flags.
- [x] Council benchmark snapshots include construction blocks, accessible-building coverage, tertiary capacity, waste diversion, and a construction outcome score.
- [x] Council provider adapters are registered through a stable normalized interface and can be compared on identical seeded scenarios with intelligence, resident-impact (historical `empathy` field), safety, progress, execution, construction, and fiscal diagnostics.
- [x] Founding lifecycle honours the exact 30-person founding contract before applying the normal 90% occupancy band, so the council can establish a growth runway instead of shrinking the hamlet on day one.
- [x] Construction-material bootstrap prevents the first lumber/steel/cement works from deadlocking on inputs; later works consume peer-factory stock before requesting imports.
- [x] Essential water, resource upgrades, utility expansions, and civic capacity floors can use the bounded developer PPP pool while the public operating reserve remains protected.
- [x] Utility coverage measures the connected network after expansion, and bounded water imports prevent a one-unit rounding shortfall from freezing progression.
- [x] Overloaded clinic, waste, mail, visitor, and other civic services now rank the correct capacity contract and finance that public outcome through PPP, so service pull cannot remain at zero behind the treasury reserve. Outpatient demand maps to clinics (not inpatient beds), visitor demand maps to libraries, and waste demand maps to recycling.
- [x] Initial load and Reset restore a wide elevated overview pivoted toward the far side of the playable map, keeping the full road network readable around the town.
- [x] Campus-like civic facilities now consume catalogue-sized horizontal lots (school, hospital, college, university and related public buildings); bills and service capacity scale with area instead of forcing every upgrade vertical.
- [x] WING is a demand response for an overloaded civic facility when its parcel has a free strip, and it scales the building's service capacity with the new area.
- [x] Council prompt now treats traits as emergent evidence: it is provider-neutral, does not prescribe empathy or a personality, protects interfaces and solvency through explicit constraints, exposes valid archetype IDs and footprints, and stays within a 4,000-token approximation budget.
- [x] Added bounded council self-learning: enacted choices receive delayed before/after measurements, repeated action estimates, and recent outcome lessons. The learning record is descriptive, waits one simulation day before evaluation, survives 24 lessons/16 pending observations, and cannot mutate rules, gates, placement, catalogue, or accounting.
- [x] Facility-only archetype replies infer `zone=civic` and the matching `civic.<facility>` block, while explicit undersized lots are clamped to the facility minimum.
- [x] Added `scripts/_metropolis_horizon_check.mjs` and `npm run test:metropolis`; the probe now reports population stage, factory/college/university milestones, floor/wing/tier-up counts, first skyscraper day, maximum footprint, occupied floor area, treasury runway, and audit failures. The corrected forced 2,200-day seed-42 audit reaches vertical metropolis on day 1,823, university on day 930, first skyscraper on day 2,153, 390 residents, one 3×3+ factory campus, 217 completed floor upgrades, positive $250,036 minimum treasury, and clean audits.
- [x] Occupancy follows the corrected footprint contract: residential homes house three residents per tiled footprint per floor (a three-storey one-tile home holds nine), commerce/factory capacity scales with area × floors, and civic capacity keeps its catalogue `capacityPerFloor` contract across floors and wings.
- [x] Staffing uses the same floor-area model for private and public buildings. Civic schools, clinics, colleges, offices, and other public facilities now appear in the Staff line, settler work posts, and `HIRE_WORKERS`; civic hires are assigned only to civic buildings.
- [x] Commerce tier-ups preserve horizontal area and all existing floors. New rung capacity is normalized to the selected lot, vertical expansion multiplies only once, and wings scale legacy and `capacityPerFloor` records without double-counting.
- [x] `EXPAND_STREET` aliases (`EXPAND STREET`, `EXPAND THE ROAD`, and related phrasing) resolve to `EXTEND_STREET`; declared aliases are checked before loose intent matching.
- [x] `EXTEND_STREET` is gated at congestion > 0.34 and a legal 3–4-cell planner run. Runs are straight road-end continuations or opposing-end gap closures; junction-side branches, middle side-touching, and parallel one-cell corridors are rejected. With fewer than four trip observations it may join disconnected components or touch a measured hotspot; with enough observations it prefers positive OD trip benefit and falls back only to a measured live hotspot.
- [x] Housing progression has a two-bed rounding cushion around the proportional spare-bed gate, preventing a town from parking just below the college/university milestone with no home ranked.
- [x] Civic load routing is facility-specific: `patients/day` expands clinics, `beds` expands hospitals, `visitors` expands libraries, and `waste` expands recycling. This prevents repeated builds that increase the wrong service kind.
- [x] Progression audit covers tier-ups, vertical upgrades, civic-first wings, housing bootstrap pressure, college/university gates, recycling, resource/utility gates, and 2,200-day vertical-metropolis growth.
- [x] Added a persisted Settings cog to the bottom ribbon. The modal exposes residents per tiled residential floor (default 3), night-glow intensity (default 1.0×), council creativity/temperature (default 0.15), automatic council control (default on), and the speed restored by Reset (default 100×).
- [x] Extended the Council temperature setting and runtime clamp to 0–1.0; the Settings slider now reaches 1.0 and the UI regression verifies persistence and live wiring.
- [x] Settings are validated at the simulation boundary: residential density affects new homes and vertical growth, glow and council controls apply live, and Reset/re-generation reapply the chosen council and speed settings without corrupting the founding five-bed contract.
- [x] Added a procedural day/dusk/night skybox with sun glow and night stars, plus tightened color-matched horizon fog (120–460 m) that fades the plate's diagonal corners while keeping the acquired town readable.
- [x] Added centered camera readouts immediately above the bottom ribbon for live orbit yaw/tilt, zoom distance, and right-drag pan target X/Z. Camera defaults are persisted alongside the other settings (34.5° yaw, 64° tilt, 228 m distance, target -20/-40) and are restored on load and Reset; tilt now permits a true 0° top-down audit while retaining the requested yaw in the readout.
- [x] Replaced Town Centre with a persisted Fit Town toggle, enabled by default. It frames the complete acquired perimeter after load, Reset, land acquisition, and growth while preserving the current orbit orientation; the camera rail also exposes a one-shot fit action.
- [x] Settings is now a vertically scrollable, searchable modal with Simulation, Council, Visuals, and Camera sections; search hides unrelated sections without losing the live controls.
- [x] Added a compact Blender-style vertical camera rail beside the left HUD with orbit, tilt, zoom, home, whole-town fit, and ISO/TOP/N/E presets; Playwright verifies the rail geometry and that every pose updates the readout without NaN values.
- [x] Road demand keeps a bounded completed-trip history, samples live vehicle pressure, and memoizes planner input only while its measured state is unchanged. Hotspot fallback now prevents persistent congestion from starving `EXTEND_STREET` when OD trips are sparse.
- [x] Added 100× simulation speed to the ribbon, Clock, and validated Settings default; Reset and reload now restore 100×.
- [x] Agriculture yards now start as exact 7×4 rectangles (28 tiles) and expand to 8×5 and 9×6 tiers for farms, livestock, and poultry, with matching catalogue footprints.
- [x] `UPDATE_RESOURCE` now emits an auditable event, a transient world-space pulse at the upgraded yard, and a visible HUD notice that reports the site, level change, and yard area.
- [x] Added the `UPDATE_RESOURCE` parser spelling as a canonical alias for `UPGRADE_RESOURCE`, so provider wording and the visible feedback use the same resource-upgrade path.
- [x] Added a compact Council evidence panel beside Decisions. It shows the latest model thought, delayed self-learning lesson count/pending observations, and the latest resource-upgrade feedback without prescribing a Council trait.
- [x] Refit the narrow 1024px ribbon after adding 100× so all speed, seed, camera, Settings, and Reset controls remain contained.
- [x] Footways are now explicit pedestrian-access work. The growth ranking no longer invents them as filler, and target selection excludes park/public parcels and requires a useful inland link; the Road tool can convert an intentional footway cell to asphalt.
- [x] Construction and road access now fell trees before reservation/paving. `BUILD_SITE`, `EXTEND_STREET`, and specialist resource spurs clear vegetation, credit four lumber per tree, and restore the forest/lumber state on rollback; a rebuild guard removes stale props before road meshes render.
- [x] Added a synchronous `GovernanceSystem.forceRequest()` test boundary. Horizon probes can inject a deterministic intent through the real parser, planner, finance, decision ledger, and learning path without an LLM request or cadence wait.
- [x] Added `--fast` modes (`test:metropolis-fast`, `test:road-horizon-fast`) and `HORIZON_*_REQUEST_EVERY` controls so long runs evaluate/force requests periodically instead of sweeping the planner every day.
- [x] Population ceiling is now 1,000 by default and is persisted as a validated Settings control; lifecycle admission, reports, Reset, and headless runs read the same live `SIM.maxCitizens` value.
- [x] Factory lots now start at 3×3 cells and can rise through 4×3, 3×4, 4×4, and 5×4 candidates. Factory types carry distinct floor counts and modules; steelworks add cooling towers/blast furnaces/ore yards, cement works add kilns/silos/conveyors, textile and sawmill plants use sawtooth bays, software plants use office/data halls, and goods/furniture plants use assembly/showroom/loading modules.
- [x] Factory plans are strict about their multi-cell footprint; a failed campus search can no longer silently fall back to a one-cell shed. Factory occupancy and staffing therefore use the same area × floors contract as the catalogue.
- [x] Factory campus surveys now evaluate free footprint cells instead of rejecting a whole 1–2-cell parcel because a neighbouring cell is occupied. Expansion surveys include factory zoning, can use vacant interior cells in an already-fronted block, and project the road plus parcel rebuild before paving; a street is not left behind unless it unlocks the requested campus.
- [x] Fuel stations remain resource-system pump/tank sites for production accounting but are explicitly tagged `planningClass=civic`, `publicFacing`, and `facility=fuel-station`; they are sited in a shallow civic belt around the measured town core, with short access spurs and government ownership, instead of being treated as remote factories.
- [x] Resource siting now protects a shared two-tile facility buffer: reservoirs, silos, wind, solar, farms, husbandry, poultry, and battery yards are kept away from residential, commercial, and civic buildings in both founding/later resource placement and Council/final building placement. Industrial supplier adjacency remains legal, while fuel stations and lakes retain their public-facing/amenity exceptions.
- [x] The founding road frame is wider but intentionally sparse (22–24 × 19–21 cells), leaving an open expansion ring on all sides. Junction-adjacent zebra passes now skip a neighbouring junction approach so tight intersections do not stack markings.
- [x] Added population-earned progression rungs (4 floors at 60 residents, 6 at 120, 9 at 200, 12 at 320, 16 at 600, 20 at 800). Vertical upgrades and same-parcel wings are core progression once the town has 60/90 residents, and the first ten-storey building emits a visible “skyscraper milestone” event.
- [x] Metropolis horizon output now reports maximum floors, maximum footprint, first skyscraper day, tier-ups, floor upgrades, wings, and factory design modules so long runs expose stalled progression instead of hiding it behind population alone.
- [x] Metropolis stage measurement accepts vertical/campus density: population plus occupied `footprint × floors` area, rather than a raw count of building records, recognizes a dense high-rise town as a metropolis.
- [x] Progression financing no longer follows an empty building owner's wallet when a plan explicitly selects the developer PPP leg. Floors, wings, and commerce tier-ups can import their bounded missing material bill through the contractor account; named education/recycling campuses use the same bounded input path.
- [x] Education and industry are explicit growth rungs: college/university/recycling rows carry priority scores, a first factory campus is offered from 80 residents when none exists, and a failed civic wing candidate no longer suppresses the fallback floor upgrade.
- [x] Growth keeps lifetime `tierUps`, `floorUpgrades`, and `wings` counters; the horizon report no longer undercounts completed work after the eight-line HUD history rolls over.
- [x] Vehicle parking deadlock audit: a vehicle executing the final docking leg is excluded from wait-for cycle breaking; stale reverse commands release the bay and retry the legal approach instead of reversing out and re-parking. Parked bodies remain stationary while their dwell is active.
- [x] Vehicle footprints are now rendered and simulated from a shared 0.68 scale. The largest emergency/service body is 1.36 m wide against 1.6 m opposing lane-centre spacing, leaving a small passing buffer while keeping parking eligibility and SAT collision envelopes consistent.
- [x] Idle emergency/service bay holds are now one-way state transitions: ambulance/fire/police station bays wake only after a matching call is successfully assigned and routed; utility/refuse vehicles retry unreachable work from their current bay without releasing and re-claiming it.

## Regression coverage

- [x] `npm run build`
- [x] `npm run test:ui` (restored the missing UI probe referenced by package scripts)
- [x] `npm run test:kits`
- [x] `npm run test:economy`
- [x] `npm run test:governor`
- [x] `npm run test:glow`
- [x] `npm run test:council`
- [x] `npm run test:soak`
- [x] `HORIZON_DAYS=1200 HORIZON_SEEDS=42,1337,9001 npm run test:metropolis` (legacy matrix remains a clean-audit smoke; milestone assertions now use the expanded metrics rather than the retired metropolis-day expectation)
- [x] `node scripts/_governor_parser_check.mjs` (including `EXPAND_STREET` aliases)
- [x] `node scripts/_buildings_check.mjs` (floor-area staffing monotonicity and post-market sanity)
- [x] UI probe opens the Settings modal and verifies the documented defaults and controls.
- [x] UI probe verifies camera readouts, pan-target wiring, camera defaults, section filtering, Fit Town persistence/perimeter framing, and ribbon containment at 1024px.
- [x] Added `scripts/_council_prompt_check.mjs` / `npm run test:prompt`; it checks the emergent-traits wording, dynamic learning context, catalogue exposure, lesson creation, and the 4,000-token approximation cap.
- [x] Added `scripts/_resource_feedback_check.mjs` / `npm run test:resources`; it upgrades a real founding farm, checks the 40-cell tier-2 yard, verifies the world pulse, and verifies the HUD `UPDATE_RESOURCE` notice and Council evidence panel.
- [x] Added `scripts/_resource_neighbour_check.mjs` / `npm run test:resource-neighbour`; it checks the two-tile rule in both directions, the industrial exception, clean seed-1337 founding placement, and Council survey rejection.
- [x] Added `scripts/_housing_growth_check.mjs` / `npm run test:housing-growth`; it checks full-bed founding housing, acquired-frontage ranking, the explicit `DEVELOP_HOUSING` start, and the frontier-only land gate.
- [x] Added `scripts/_footway_check.mjs` / `npm run test:footway`; it verifies that footways stay out of automatic growth, explicit links can still be laid, the Road tool converts one to asphalt, and a forced request makes no provider call.
- [x] Added `scripts/_road_extension_check.mjs` / `npm run test:road`; it checks bounded trip retention, live queue sampling, hotspot selection, legal geometry, aliases, and cache invalidation.
- [x] Junction-adjacent curve markings no longer overlap the junction zebra pass, removing the stray diagonal white bars visible beside tight intersections while retaining markings on standalone bends.
- [x] Tightened asphalt placement after visual audit: only aligned road-end continuations and opposing-end gap closures can be selected, preventing repeated hotspot decisions from forming artificial checkerboard intersections.
- [x] Vehicle routes now validate their first access segment, reject illegal backing, and re-anchor any active trip that drifts into an unmarked cell; the horizon probe records `maxOffRoadUnmarked` for this invariant.
- [x] Ran the final 800-day seed-42 road horizon: asphalt roads increased 120→402 (+282), 20 aligned `EXTEND_STREET` decisions completed, the final network stayed at one connected component with zero off-network buildings and zero unmarked active vehicle cells, and final congestion was 0.43 (peak 0.85).
- [x] Ran the final seed-42 road horizon in normal and `--fast` modes: normal reached 378 road tiles, one connected component, zero off-network/unmarked vehicles, clean audit; fast completed the same 800-day request smoke in ~30 seconds with 100 forced requests, one connected component, zero off-network/unmarked vehicles, and a clean audit.
- [x] Ran a 2,200-day fast growth smoke for seed 42: 275 forced requests, university day 930, metropolis day 1,823, first skyscraper day 2,153, one type-specific 3×3+ factory, 217 completed floor upgrades, positive $250,036 minimum treasury, and clean audit.
- [x] Re-ran the 800-day fast road horizon after the wider founding frame and fuel/campus changes: seed 42 added 252 asphalt tiles, completed five legal street extensions, stayed at one connected component with zero off-road or unmarked vehicle cells, and kept a positive $250,048 treasury.
- [x] Final focused regression pass: UI/settings, construction kits (all three seeds), resources, roads, glow, prompt, footways, banking, governor, council providers, soak, and direct Vite build all pass; the kits probe now disables its provider boundary so endpoint 400s cannot contaminate a geometry-only test.
- [x] Re-ran the UI and construction-kit probes after the 64-row catalogue and population setting; settings default to 1,000 and the three deterministic kit seeds pass.
- [x] Added `scripts/_vehicle_parking_check.mjs` / `npm run test:vehicle-parking`; an 80-day seed-42 run verifies no claimed/docking vehicle backs, no parked vehicle moves during its dwell, idle station holds do not release without a routed call, and no vehicle exceeds the lane-width envelope. The focused probe and the 800-day fast road horizon pass after the resize.
- [x] Added `scripts/_factory_site_regression.mjs` / `npm run test:factory-site`; seed 1337 now commissions a 3×3+ factory campus without an unnecessary street carve, and the projected expansion path is site-aware for later blocked campuses.
- [x] Added shared agricultural setbacks: farm, husbandry, and poultry yards reserve a two-tile buffer; Council footprint/cell surveys and final player/Council placement reject residential, commercial, civic, and industrial buildings inside it. Added `npm run test:agriculture` for the exact boundary and seed-1337 placement audit.
- [x] Hardened `EXTEND_STREET` against checkerboard corridors: runs that touch a busy junction at either endpoint or create more than one new junction are rejected before demand scoring, while straight open-end continuations remain eligible. Added a regression for a two-sided busy-junction closure.
- [x] Tightened the founding perimeter envelope: seed 1337 now reports the 33×27 bounding rectangle of actual founding roads, buildings, public cells, and resource installations, with no empty apron acquired. Added `npm run test:perimeter`.
- [x] Expanded the finite build plate to 100×100 tiles (10,000 cells / 400×400m). The deterministic ForestSystem now keeps the acquired town sparse and seeds a dense, irregular woodland ring at its edge, with light foliage across the future frontier.
- [x] Added a shared `foliageKit` with tree, pine, and low-shrub variants plus a `prop.foliage` construction block. The founding envelope receives about 50 intentional canopy specimens and a 12-cell understory layer, while natural woodland remains governed by ForestSystem.
- [x] Linked plantation, road/building/bulldozer deforestation, and natural tree fall to one timber ledger. Every felled tree returns four lumber units, natural fall is day based and bounded, and `Town.stats().forest` exposes coverage, planted, felled, natural falls, and timber recovered.
- [x] Added `npm run test:forest`; it verifies seed-1337 coverage, deforestation lumber credit, player/council plantation accounting, natural fall, and no page errors.
- [x] Added `npm run test:vegetation-clear`; seed 1337 verifies both a building footprint and a road expansion fell an obstructing tree and credited the lumber ledger.
- [x] Re-ran the deterministic 800-day seed-1337 forest horizon after the foliage-kit balance: 580 natural falls, 2,320 lumber recovered, no renderer errors, and a valid town; weekly batching reduced tree coverage 19%→13% while the 12-cell decorative understory remained.
- [x] Added a seeded WeatherSystem with a 120-day four-season calendar, bounded rain/storm/heatwave/snow states, HUD and Council evidence, and shared effects on food yield, utility demand, traffic speed, and citizen mood. Added `npm run test:weather` for deterministic season-boundary and Council-report coverage.

## Optional operator experiments (require external provider credentials)

- [ ] Compare multiple LLM providers on the same 1,200-day seed matrix and tune college/university gates only from measured outcomes.
- [ ] Compare provider creativity at temperature 0, 0.15, and 0.3 on the same seeded archetype scenarios; score footprint diversity, fiscal safety, accessibility, and resident outcomes separately from prose quality.
- [ ] Add outcome traces (accessibility, service load, waste diversion, affordability, and fiscal runway) to the provider leaderboard UI as diagnostics; do not convert them into hidden prompt rewards.
- [ ] Add a 2,000-day soak that exercises developer-capital exhaustion and records the council's transition from PPP builds to public-only operating decisions.
- [ ] Run a normal (non-forced) 1,200-day progression matrix after factory campus placement is tuned; require a recorded tier-up/wing and compare its first skyscraper day with the forced-request baseline above.

## Current sprint (2026-10-02)

- [x] Added a perimeter land ledger. The founding rectangle is acquired up front; frontier cells are surveyed, priced, and bought before a growth street is paved, so outward growth has a finite land cost and a visible audit trail.
- [x] Added a public transport system with bus-stop routes, transit hubs/depot unlocks, government bus procurement, route agents, ridership, coverage, and UI stats.
- [x] Added neighbourhood rows, granular resident mood dimensions, crime reports, police/court case resolution, policy-law synchronisation, approval rate, and deterministic elections.
- [x] Added demolition notes and in-place restructuring plans that preserve the lot while adding a safe floor to an eligible building.
- [x] Added parseable Council intents `BUILD_TRANSIT`, `ACQUIRE_LAND`, and `RESTRUCTURE_BUILDING`, with replay codes and feasibility explanations.
- [x] Added real bus-agent spawning from registry slots; transit buses now use a dedicated route role and are counted in the public fleet instead of becoming unbound parked assets.
- [x] Added a focused society/transport/perimeter regression probe and documented these APIs in SRS.

### Follow-up checks

- [ ] Add a player-facing transit-stop placement tool so bus routes can be authored as well as discovered from road markings.
- [ ] Expand justice into staffed court throughput and neighbourhood-specific service budgets once the base ledger has enough observations.
- [ ] Compare multiple Council providers on approval, fiscal runway, crime resolution, and land-use efficiency over the same seeded horizon.

## Current sprint (2026-10-02, progression and social readout)

- [x] Cleaned the repository after the frontier merge: resolved embedded conflict markers, removed generated renders/logs and the redundant alternate Git metadata directory, and deleted superseded one-off diagnostics while retaining package-integrated regression probes.

- [x] Added facility-specific civic vertical caps. Recycling, bus depots, transit, fire, daycare, and similar service yards remain low-rise; colleges, universities, hospitals, and government buildings have higher authored caps. Overload growth now prefers a same-parcel wing or a new facility once the cap is reached.
- [x] Removed civic buildings from generic population height progression and bounded the restructure path with the same cap, preventing a recycling centre from receiving arbitrary seven-floor upgrades.
- [x] Added a Societal summary panel to the right of Council evidence. It reports approval, aggregate mood, neighbourhood count, open crimes/court backlog, active laws, and the current mayor/election.
- [x] Added explicit social evidence to the Council report: approval, citizen mood, needs/safety/services/economy/belonging/transport dimensions, neighbourhood count, crime backlog, laws, and mayor. Schemes and landmark candidates can now be weighed against the same public state without turning mood into a hidden hard gate.
- [x] Extended the UI regression probe to require the societal panel and its live summary rows.
- [x] Kept the founding core within a compact 22–24 × 19–21 cell frame (below the 30×30 ceiling). The perimeter ledger now acquires the complete non-water founding envelope, producing a tight seed-42 roughly 30×30 envelope with about 893 acquired town tiles and frontier land only outside it.
- [x] Added a severe-congestion priority band (65%+) so a legal EXTEND_STREET or ROADUP plan outranks lower-band infill in the rules fallback and is labelled emergency in the Council report.
- [x] Added recycling-cap regression coverage to `npm run test:society`.
- [x] Reworked the founding street layout into a two-street cross with explicit frontage zoning and compact resource siting. Seed-42 starts with the same 15-building/30-resident contract and a fully acquired non-water founding envelope; later branches are earned through legal `EXTEND_STREET` and outward land acquisition.
- [x] Visually checked the initial seed-1337 overview after regeneration: the compact town envelope is acquired as one legal town parcel, the resource belt remains separated from homes, and later land requests select only the outer frontier ring.
- [x] Gated automatic and explicit `ACQUIRE_LAND` on complete exhaustion of acquired serviced plots. The complete non-water tight founding envelope is already acquired, so a full-bed town uses its existing frontage first; frontier selection only buys cells outside the current envelope, prefers road-fronted cells, and includes a contiguous progression patch when needed without implicit building-triggered streets.
- [x] Added `npm run test:land-gate`: the forced request probe verifies one exhausted-ledger acquisition and rejects the next request until the newly acquired plots are used.
- [x] Verified explicit outward acquisition on seed 42: after the complete tight founding envelope is used, the ledger expands beyond its initial bounds through charged `ACQUIRE_LAND` decisions, while acquired frontage becomes usable before the next build order.

### Follow-up checks

- [ ] Run a normal-council 800-day matrix with congestion snapshots and compare EXTEND_STREET/ROADUP response latency after the emergency priority band.
- [x] Made the light playable ground follow the acquired perimeter envelope. The outer skirt remains future land, and a successful land acquisition expands the light plane so the boundary is visible during growth.

