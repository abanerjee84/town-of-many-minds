# Construction and metropolis roadmap

Updated 2026-10-03 after the dynamic-market and build-duration audit.

## Completed in this pass

- [x] Added `src/data/priceChart.json` and one resolver module. Construction families, land, vehicles, commodities, and commerce rungs now have inspectable base values and bounded live factors instead of scattered fixed quotes.
- [x] Linked price responses to measured scarcity, housing/industrial pressure, congestion, treasury runway, and fiscal stress. The Council report exposes price-chart version and current construction, land, and commodity indices.
- [x] Added `src/data/buildtime.json` and `buildHoursFor()`. Project duration now derives from external base hours plus footprint, floors, pressure, congestion, and fiscal capacity; active projects retain their quoted duration.
- [x] Added civic same-parcel progression for community centre → library → museum and bus depot → transit hub, while larger school/college/university/hospital campuses remain explicit land-aware builds or wings.
- [x] State service audit at 800 simulated days (seed 1337) now reaches transit readiness, keeps police/fire/ambulance station coverage valid, scales buses with population, and completes with no page errors.
- [x] Council report now lists all intents as priority/feasible/blocked/conditional and includes building, land, resource-site, service-fleet, transit, price, and build-time evidence.
- [x] Checklist closure: public transport now resolves its fleet station to the actual bus depot/transit hub parcel, records station coordinates, binds every bus to a live route, and exposes `operationalFleet`; the 800-day service audit fails if any bus is unstationed or route-less.
- [x] Checklist closure: civic service demand covers emergency station shortfalls, transit, waste, clinics, schools, colleges, universities, and recycling; authored vertical caps and same-parcel civic evolution are exercised by the seeded horizon audit.
- [x] Checklist closure: the road kit exposes complete streets, cycle corridors, transit stops, four-lane arterials, bridges, and 3×3 roundabouts with catalogue modules and measured demand gates.
- [x] Checklist closure: bounded loans, debt ceiling, protected reserve, repayment runway, dynamic price chart, and dynamic build-time chart are wired through one quote path and included in the Council evidence report.
- [x] Checklist closure: `npm run test:intents` verifies all 59 canonical Council intents parse through the shared registry and remain represented in the prompt/report contract; it also checks the arterial and roundabout kit rows.
- [x] Checklist closure: `npm run test:state-service` runs the seeded 800-day public-service horizon with no page errors, no uncovered emergency shortfall, a ready transit network, and station-bound operational buses.
- [x] Added `BuildContracts/hardcode-catalog.json` and `BuildContracts/HARDCODE_AUDIT.md`, covering runtime tuning constants by priority, target JSON module, rationale, and extraction order.
- [x] Extracted seasons and weather modifiers from `src/simulation/weather.js` into versioned `src/data/weather.json` while preserving deterministic seeded behavior.
- [x] Added `npm run test:speed` to exercise every ribbon speed button, active-state synchronisation, pause, exact Clock scaling through 100×, Settings persistence, and page-error safety.
- [x] Fixed the recurring bus deadlock at station approaches: transit stops now avoid junctions and one-cell station-bay clearances, stale routes are invalidated after rebuilds, and stationary blockers yield to a held bus. Added `npm run test:bus-stuck` for the seeded 180-day transit regression.
- [x] Added the modular five-department Cabinet and Mayor approval gate. Cabinet motions are configured in `src/data/cabinet.json`, validated by department remit, capped at five per sitting, executed sequentially through the existing Council boundary, and covered by `npm run test:cabinet`.
- [x] Split Cabinet deliberation into one provider call per department. Each minister now receives its own configured system prompt, remit, owned-intent list, learning context, and full town report; replies are gathered before one Mayor review and same-sitting execution. `npm run test:cabinet` verifies five independent prompts/calls.
- [x] Added a strict Cabinet remit guard: out-of-department intents are quarantined before Mayor review, retained in `lastBoundaryViolations`, and surfaced as one audit log event instead of appearing as public Mayor decisions.

## Hardcode extraction queue

- [x] P0: extract industry catalog, growth gates, economy rules, lifecycle rules, construction blocks, and resource placement rules into versioned JSON adapters while preserving the public APIs.
- [x] P0: civic facility catalogue, construction family bills, and module premiums now load from versioned JSON adapters; public APIs remain unchanged.
- [x] P1 partial: resource placement, vehicle catalogue, fleet finance/service ratios, and public-transport growth thresholds now load from versioned JSON adapters.
- [x] P1: utility coefficients, society/mood/election tuning, and incident timing/response windows now load from versioned `src/data/utilityRules.json`, `src/data/societyRules.json`, and `src/data/incidentRules.json` adapters.
- [x] P1 architecture phase 1: introduced a versioned `KitRegistry` and manifest contract, registered 17 built-in domains, and preserved seeded behavior through adapters.
- [x] P1 architecture phase 1: added narrow `KitContext`, immutable `BuildingContract`/`ProjectContract`/`DemandSignal`/`ResourceFlow`/`ServiceCoverage`/`VehicleAssignment`/`KitStats` schemas, and a transaction boundary.
- [x] P1 architecture phase 1: derived all 59 Council intent routes from manifest ownership, exposed owner and plan-type compatibility metadata, and migrated transport/society/forest update hooks.
- [x] P1 architecture phase 1: integrity exports now carry kit compatibility signatures and reject mismatched kit sets before applying a save overlay.
- [x] P1 architecture phase 1: added a fixture-kit registry regression covering registration, dependency cycles, read-only snapshots, hook dispatch, and rollback.
- [x] P1 architecture phase 2: construction palette entries are sourced from the registry catalogue with legacy fallback, including facility filters and explicit unavailable quote capability reasons.
- [x] P1 architecture phase 2: kit serialization/restore hooks run in dependency order, carry API/context compatibility, and are included in integrity save overlays with a named restore failure.
- [x] P1 architecture phase 2: Town create/reset/generate/hour/day lifecycle calls are dispatched through registered hooks, and `Town.stats()` exposes contract-shaped `KitStats` rows.
- [x] P1 architecture phase 2: added a registry renderer boundary and disposable `RendererContract`; fixture kits can replace their renderer while preserving capacity, staffing, production, and inspection metadata.
- [x] P1 architecture phase 2: catalogue registration now requires declared builder, quote, placement, and plan-type capabilities; invalid registrations are retained in the compatibility report with actionable reasons.
- [x] P1 architecture phase 2: housing, industry, and civic building creation now requests geometry through registered renderer hooks and falls back to the legacy builder for custom Town instances; capacity and accounting remain record-owned.
- [x] P1 architecture phase 2: registry-owned catalogue quote, demand, and inspection operations now back the construction palette and growth planner, with compatibility fallbacks for older Town instances.
- [x] P1 architecture phase 2: kit serialization sanitizes typed arrays, bigint values, functions, dates, and circular references before integrity snapshots are frozen.
- [x] P1 architecture phase 2: footprint surveys restore the growth RNG after scoring, so a read-only land or site probe cannot change the next transit, civic, or factory placement.
- [x] P1 architecture remaining: road, resource, utility, public-space, prop, and vehicle scene builders now have registered `renderScene` hooks. Town static rebuilds and the founding pipeline use the registry boundary, while the specialist builders remain the deterministic geometry source of truth.
- [x] P2 extraction pass: world extent/founding limits, citizen content, and research bucket/lever metadata now load from versioned JSON adapters after replay fixtures were in place.

## Next measurable work

- [x] Add a player-facing transit-stop placement tool and persist stop edits through save/restore. `npm run test:transit-stop` verifies road marking, manual-stop state, and integrity restore.
- [x] Add a small price-history sparkline to the Trade/Storehouse UI using the chart resolver, with no new simulation authority. Day-level observations are bounded to 72 samples and exposed in `Town.stats().priceHistory`.
- [x] Run a normal-provider 1,200-day matrix comparing price samples, treasury runway, resident outcomes, and provider execution through `npm run test:provider-matrix`.
- [x] Reviewed commodity capacities and chart elasticities against the recorded 1,200-day matrix; no balance change was warranted, so the versioned JSON and replay fixtures remain unchanged.

## Completed

- [x] Hardened the primary-resource emergency boundary. When an LLM request is blocked because food, energy, or fuel capacity is short, the live Council-only path records the measured emergency and waits for the Council to choose `UPGRADE_RESOURCE` or `ACQUIRE_LAND`; it cannot fall through to an unrelated `UPGRADE_BUILDING`. New producer yards use that same Council order after land is acquired, and the resource-land regression covers upgrade, land, and site branches.

- [x] Made the Council the sole public decision maker. Rules fallback is disabled for public work and provider failure pauses autonomous Council construction instead of silently building through a deterministic actor. The private developer pass remains independent, using its own capital and demand signal for private commerce.

- [x] Added `npm run test:council-authority` to verify the public Council boundary, report-only resource day pass, blocked LLM motion, and independent private-developer switch.

- [x] Reworked `IMAGINE_ARCHETYPE` into a measured design-opportunity channel. Civic overload and low approval can promote a compatible catalogue archetype into Priority; comfortable-town experiments remain bounded amenity work, and the report explains the design gap.

- [x] Added a one-turn Council correction loop for hard primary-resource sequencing. A blocked LLM motion now records a mandatory remedy in the next report and receives one immediate corrective provider response, avoiding repeated BUILD_FACTORY/TIERUP blocks across several sittings without reintroducing rules fallback.

- [x] Added `npm run test:council-flow` for evidence-backed archetype visibility and same-sitting resource-remedy correction.

- [x] Extended delayed Council learning evidence with approval, accessibility coverage, and completed archetype counts so creative designs are compared by outcomes rather than names or prose.

- [x] Uncoupled `ACQUIRE_LAND` from the construction crew cap. Land purchases remain gated by exhausted acquired serviced plots, frontier availability, target footprint/access survey, treasury reserve, and charged ledger accounting, but they can now run while two unrelated buildings are under construction; the land-gate regression covers this occupied-crew case.

- [x] Resource growth now treats a dry primary-resource store as a capacity emergency. It distinguishes capacity shortfalls from understaffing, surveys the exact acquired-land producer footprint and access spur, and ranks frontier acquisition before housing or cosmetic progression when a 7×4 food yard no longer fits. Food growth caps now leave headroom for a 1,000-resident town. The governance boundary blocks an LLM housing/progression request during that emergency and waits for the Council's `UPGRADE_RESOURCE` or `ACQUIRE_LAND` choice; a resource upgrade with no eligible site becomes the land prerequisite. `npm run test:resource-land` covers the dry-food → frontier acquisition → new-farm path on seed 1337.

- [x] Shared immutable catalogue covers 78 blocks across housing, commerce, civic, industry, resources, utilities, roads, public space, and props.
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
- [x] Closed the public-industry staffing gap. Government-owned factories preserve their state operator through economy registration, recruit unemployed residents or credentialed newcomers without moving workers out of private firms, and pay those workers through the government payroll path. Added `npm run test:staffing` for ownership, non-zero headcount, industry-job, and treasury-preservation checks.
- [x] Commerce tier-ups preserve horizontal area and all existing floors. New rung capacity is normalized to the selected lot, vertical expansion multiplies only once, and wings scale legacy and `capacityPerFloor` records without double-counting.
- [x] `EXPAND_STREET` aliases (`EXPAND STREET`, `EXPAND THE ROAD`, and related phrasing) resolve to `EXTEND_STREET`; declared aliases are checked before loose intent matching.
- [x] `EXTEND_STREET` is gated at the configurable average congestion threshold (default 0.50; persisted Settings slider 0.10–0.90 in 0.05 steps) and a legal 3–4-cell planner run. Runs are straight road-end continuations or opposing-end gap closures; junction-side branches, middle side-touching, and parallel one-cell corridors are rejected. All cells must be acquired. The planner uses connected components and weighted shortest paths over measured OD trips, with deterministic frontage/continuation foresight (`1.5·frontage + 0.75·continuation − 2·newJunctions`) as a secondary tie-break; with fewer than four trip observations it may join disconnected components or touch a measured hotspot, and it never paves from empty geometry alone.
- [x] Housing progression has a two-bed rounding cushion around the proportional spare-bed gate, preventing a town from parking just below the college/university milestone with no home ranked.
- [x] Civic load routing is facility-specific: `patients/day` expands clinics, `beds` expands hospitals, `visitors` expands libraries, and `waste` expands recycling. This prevents repeated builds that increase the wrong service kind.
- [x] Progression audit covers tier-ups, vertical upgrades, civic-first wings, housing bootstrap pressure, college/university gates, recycling, resource/utility gates, and 2,200-day vertical-metropolis growth.
- [x] Added a persisted Settings cog to the bottom ribbon. The modal exposes residents per tiled residential floor (default 3), night-glow intensity (default 1.0×), council creativity/temperature (default 0.15), average congestion gate for road planning (default 50%, adjustable 10–90%), automatic council control (default on), and the speed restored by Reset (default 100×).
- [x] Extended the Council temperature setting and runtime clamp to 0–1.0; the Settings slider now reaches 1.0 and the UI regression verifies persistence and live wiring.
- [x] Settings are validated at the simulation boundary: residential density affects new homes and vertical growth, glow and council controls apply live, and Reset/re-generation reapply the chosen council and speed settings without corrupting the founding five-bed contract.
- [x] Added a procedural day/dusk/night skybox with sun glow and night stars, plus tightened color-matched horizon fog (120–460 m) that fades the plate's diagonal corners while keeping the acquired town readable.
- [x] Added centered camera readouts immediately above the bottom ribbon for live orbit yaw/tilt, zoom distance, and right-drag pan target X/Z. Camera defaults are persisted alongside the other settings (34.5° yaw, 64° tilt, 228 m distance, target -20/-40) and are restored on load and Reset; tilt now permits a true 0° top-down audit while retaining the requested yaw in the readout.
- [x] Replaced Town Centre with a persisted Fit Town toggle, enabled by default. It frames the actual acquired-cell bounds after load, Reset, land acquisition, and growth while preserving the current orbit orientation; the camera rail also exposes a one-shot fit action.
- [x] Settings is now a vertically scrollable, searchable modal with Simulation, Council, Visuals, and Camera sections; search hides unrelated sections without losing the live controls.
- [x] Added a compact Blender-style vertical camera rail beside the left HUD with orbit, tilt, zoom, home, whole-town fit, and ISO/TOP/N/E presets; Playwright verifies the rail geometry and that every pose updates the readout without NaN values.
- [x] Road demand keeps a bounded completed-trip history, samples live vehicle pressure, and memoizes planner input only while its measured state is unchanged. Hotspot fallback now prevents persistent congestion from starving `EXTEND_STREET` when OD trips are sparse.
- [x] Added 100× simulation speed to the ribbon, Clock, and validated Settings default; Reset and reload now restore 100×.
- [x] Added a persisted Council cadence setting (default two sittings per game day, configurable from 1–12) and moved the live scheduler from a fixed six-hour slot to that setting.
- [x] Council congestion evidence is now time-weighted between sittings. The next report presents average, closing instantaneous value, range, duration, and sample count; road gates and `EXTEND_STREET` ranking consume the closed interval average instead of a single frame.
- [x] Congestion priority now gives an eligible `EXTEND_STREET` a dedicated high score above other demand gates. Planner legality, graph benefit, acquired land, finance, and materials remain mandatory.
- [x] Audited road geometry: same-component U-gap closures are now identified as loops and rejected by hotspot/topology fallback; only positive measured OD relief can authorize a shortcut, while normal runs remain anchored to degree-one street ends.
- [x] Fit Town now reframes automatically at three-game-hour boundaries while enabled, while retaining immediate framing on load, Reset, and perimeter growth.
- [x] Agriculture yards now start as exact 7×4 rectangles (28 tiles) and expand to 8×5 and 9×6 tiers for farms, livestock, and poultry, with matching catalogue footprints.
- [x] `UPDATE_RESOURCE` now emits an auditable event, a transient world-space pulse at the upgraded yard, and a visible HUD notice that reports the site, level change, and yard area.
- [x] Added the `UPDATE_RESOURCE` parser spelling as a canonical alias for `UPGRADE_RESOURCE`, so provider wording and the visible feedback use the same resource-upgrade path.
- [x] Resource upgrade refusals now explain the actual gate (missing producer, level-3 cap, or an upgrade already in progress) instead of reporting the misleading `no procedure for that action`; the resource feedback regression covers the alias and repeated-request path.
- [x] The Storehouse rows now have an independent bounded scrollbar, leaving the upper TOMM Simulator statistics area on the panel's full flexible extent; the UI regression verifies all 19 commodity rows and the scroll region.
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
- [x] Factory progression now checks the complete acquired campus footprint before offering `BUILD_FACTORY`. A partial vacant frontage no longer suppresses `ACQUIRE_LAND`; the land order surveys and buys a contiguous frontier patch first, and blocked factory requests report `ACQUIRE_LAND first`. The factory-site regression covers this ordering.
- [x] Factory completion now carries the exact reserved campus cells from the frontage-anchored survey through the executor. A multi-cell works no longer shifts its footprint at the end of construction and rolls back; the factory-site regression advances a real project to completion and checks for `FAILED_ROLLED_BACK`.
- [x] Factory production now uses a capacity-normalized rate. Footprint × floors scale rated output, input draw, capital requirements, full-capacity revenue, and the Works inspector; staffing, utilities, payroll, and input stock remain utilization gates. A staffed works has a bounded 25% minimum operating level while it fills vacancies, while an empty or payroll-arrears works remains stopped. Added `npm run test:factory-production` for capacity ratios, output-bonus, and labour-floor coverage.
- [x] Expanded the industrial ring with aggregate quarry, food processor, glassworks, chemical plant, paper mill, electronics plant, machinery works, fuel refinery, polymer plant, pharmaceutical plant, and battery plant. Added aggregate, packaged food, glass, chemicals, paper, electronics, machinery, refined fuel, polymers, medicine, batteries, and crude-oil inventory rows with prices, capacities, imports/exports, explicit input recipes, and capacity-scaled output. Food processors draw the ResourceSystem food reserve; refineries use priced crude imports. Added unique HouseKit silhouettes, catalogue blocks, and `npm run test:industry-expansion` for geometry, catalogue, stats, and production-flow coverage.
- [x] Fuel stations remain resource-system pump/tank sites for production accounting but are explicitly tagged `planningClass=civic`, `publicFacing`, and `facility=fuel-station`; they are sited in a shallow civic belt around the measured town core, with short access spurs and government ownership, instead of being treated as remote factories.
- [x] Resource siting now protects a shared two-tile facility buffer: reservoirs, silos, wind, solar, farms, husbandry, poultry, and battery yards are kept away from residential, commercial, and civic buildings in both founding/later resource placement and Council/final building placement. Industrial supplier adjacency remains legal, while fuel stations and lakes retain their public-facing/amenity exceptions.
- [x] Education campus siting now uses a shared three-tile Chebyshev catchment buffer for schools, colleges, universities, conservatories, and the university landmark campus. Council footprint surveys and the final `Town.placeBuilding` boundary both reject a campus directly opposite or too close to an existing campus, while ordinary civic buildings remain unaffected.
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
- [x] Added a typed hospitality kit: hotels and resorts are distinct commercial building kinds with dedicated lobby/canopy, room-balcony, pool, terrace, and service-wing modules; their footprints and floors are larger than ordinary shops and are retained in inspection metadata.
- [x] Added hotel and resort catalogue blocks with stable IDs, horizontal footprints, modular bills, and landmark plans. `BUILD HOTEL` and `BUILD RESORT` now reach the same placement path as other catalogue landmarks instead of becoming generic shops.
- [x] Added tourism accounting: rooms are separate from resident beds, lodging businesses receive floor-area staffing, visitor nights settle as external export revenue, and room capacity, occupancy, demand, appeal, weather, and nightly revenue are exposed in economy stats.
- [x] Added tourism growth gates: hotels require population and positive measured demand; resorts require an existing hotel, stronger demand, and high hotel occupancy. This prevents destination capacity from arriving before the town has a functioning visitor economy.
- [x] Added Council tourism evidence with visitors, occupied/free rooms, demand, appeal, occupancy, and nightly revenue. The Council can now compare hospitality investment with weather, mood, approval, and existing attractions.

## Current sprint (2026-10-03, industrial-chain expansion and congestion-directed street planning)

- [x] Audited the complete `EXTEND_STREET` path from traffic demand sampling through GrowthSystem candidate generation, graph scoring, finance, stale-selection validation, and asphalt commit.
- [x] Made measured road-cell delay the location signal. High visits with zero delay no longer qualify as a hotspot, and sparse OD history now selects a delayed corridor before a generic component join.
- [x] Added a strict demand-qualified bypass for a delayed straight corridor: it can connect a middle road cell to a nearby street within the four-tile order, records its two deliberate junctions, and remains unavailable without current measured pressure.
- [x] Kept same-component loop closures behind positive measured OD relief; topology and hotspot evidence alone cannot create a loop. Ordinary extensions remain aligned to degree-one road ends and opposing road gaps.
- [x] Fixed a four-tile connector edge case where the planner stopped before inspecting the road immediately beyond the maximum run, silently rejecting a valid full-length reconnection.
- [x] Blocked unmeasured ninety-degree turns from newly created road ends. Endpoint spurs now preserve their existing axis, while a turn is admitted only as a reconnecting, measured network connector; this prevents repeated orders from assembling empty U-shaped loops and hairpins.
- [x] Added a high-pressure corridor outlet for the no-nearby-road case. It lays one full four-tile straight spur from the measured queue into acquired frontage, skips nearby junctions, and leaves a continuation endpoint so congestion no longer suppresses every `EXTEND_STREET` response while preserving network discipline.
- [x] Added regression coverage for flowing-but-undelayed traffic, sparse-history hotspot priority, live bypass generation/selection, the no-demand middle-branch guard, and the unmeasured road-end turn guard in `scripts/_road_extension_check.mjs`.
- [x] Re-ran a 100-day forced seed-42 horizon after the turn/outlet guards: two valid `EXTEND_STREET` decisions added eight tiles, the network remained one connected component with zero unmarked off-road vehicles, zero unacquired roads, and a clean accounting audit.
- [x] Ran a bounded 200-day forced road horizon for seeds 42 and 1337: both stayed at one connected component with zero unacquired roads, zero off-road/unmarked vehicles, clean accounting audits, and no arbitrary `EXTEND_STREET` order while completed-trip evidence remained empty.
- [x] Re-ran the 800-day fast road horizon on seed 42 after the scene/registry migration: roads 70→78, two legal four-tile extensions, one connected component, zero unacquired roads, zero off-road/unmarked vehicles, final congestion 0.50, and a clean audit.

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
- [x] UI probe verifies camera readouts, pan-target wiring, camera defaults, searchable settings, Council cadence wiring, Fit Town persistence/acquired-land framing, and ribbon containment at 1024px.
- [x] Added `scripts/_council_prompt_check.mjs` / `npm run test:prompt`; it checks the emergent-traits wording, dynamic learning context, catalogue exposure, lesson creation, and the 4,000-token approximation cap.
- [x] Added `scripts/_resource_feedback_check.mjs` / `npm run test:resources`; it upgrades a real founding farm, checks the 40-cell tier-2 yard, verifies the world pulse, and verifies the HUD `UPDATE_RESOURCE` notice and Council evidence panel.
- [x] Added `scripts/_resource_neighbour_check.mjs` / `npm run test:resource-neighbour`; it checks the two-tile rule in both directions, the industrial exception, clean seed-1337 founding placement, and Council survey rejection.
- [x] Added `scripts/_housing_growth_check.mjs` / `npm run test:housing-growth`; it checks full-bed founding housing, acquired-frontage ranking, the explicit `DEVELOP_HOUSING` start, and the frontier-only land gate.
- [x] Added `scripts/_footway_check.mjs` / `npm run test:footway`; it verifies that footways stay out of automatic growth, explicit links can still be laid, the Road tool converts one to asphalt, and a forced request makes no provider call.
- [x] Added `scripts/_road_extension_check.mjs` / `npm run test:road`; it checks bounded trip retention, live queue sampling, graph/OD and hotspot selection, acquired-land gating, legal endpoint geometry, aliases, and cache invalidation.
- [x] Junction-adjacent curve markings no longer overlap the junction zebra pass, removing the stray diagonal white bars visible beside tight intersections while retaining markings on standalone bends.
- [x] All automatic access spurs, resource spurs, footways, and player road-tool paving now require acquired cells; building quotes include fresh spur land and reserve it before asphalt is laid, so frontier growth cannot bypass `ACQUIRE_LAND`.
- [x] Tightened asphalt placement after visual audit: only aligned road-end continuations and opposing-end gap closures can be selected, preventing repeated hotspot decisions from forming artificial checkerboard intersections.
- [x] Vehicle routes now validate their first access segment, reject illegal backing, and re-anchor any active trip that drifts into an unmarked cell; the horizon probe records `maxOffRoadUnmarked` for this invariant.
- [x] Ran the final 800-day seed-42 road horizon: asphalt roads increased 120→402 (+282), 20 aligned `EXTEND_STREET` decisions completed, the final network stayed at one connected component with zero off-network buildings and zero unmarked active vehicle cells, and final congestion was 0.43 (peak 0.85).
- [x] Ran the final seed-42 road horizon in normal and `--fast` modes: normal reached 378 road tiles, one connected component, zero off-network/unmarked vehicles, clean audit; fast completed the same 800-day request smoke in ~30 seconds with 100 forced requests, one connected component, zero off-network/unmarked vehicles, and a clean audit.
- [x] Ran a 2,200-day fast growth smoke for seed 42: 275 forced requests, university day 930, metropolis day 1,823, first skyscraper day 2,153, one type-specific 3×3+ factory, 217 completed floor upgrades, positive $250,036 minimum treasury, and clean audit.
- [x] Re-ran the 800-day fast road horizon after the wider founding frame and fuel/campus changes: seed 42 added 252 asphalt tiles, completed five legal street extensions, stayed at one connected component with zero off-road or unmarked vehicle cells, and kept a positive $250,048 treasury.
- [x] Final focused regression pass: UI/settings, construction kits (all three seeds), resources, roads, glow, prompt, footways, banking, governor, council providers, soak, and direct Vite build all pass; the kits probe now disables its provider boundary so endpoint 400s cannot contaminate a geometry-only test.
- [x] Re-ran the UI and construction-kit probes after the 64-row catalogue and population setting; settings default to 1,000 and the three deterministic kit seeds pass.
- [x] Added `scripts/_vehicle_parking_check.mjs` / `npm run test:vehicle-parking`; an 80-day seed-42 run verifies no claimed/docking vehicle backs, no parked vehicle moves during its dwell, idle station holds do not release without a routed call, and no vehicle exceeds the lane-width envelope. The focused probe and the 800-day fast road horizon pass after the resize.
- [x] Added `scripts/_tourism_check.mjs` / `npm run test:tourism`; the browser probe places a legal hotel, verifies room metadata and lodging classification, checks floor-area staffing, settles visitor nights and export revenue, checks Council tourism evidence, and verifies resort modules and catalogue quotes.
- [x] Added `scripts/_factory_site_regression.mjs` / `npm run test:factory-site`; seed 1337 now commissions a 3×3+ factory campus without an unnecessary street carve, and the projected expansion path is site-aware for later blocked campuses.
- [x] Added `scripts/_factory_production_check.mjs` / `npm run test:factory-production`; synthetic 400→800 capacity works produce 1×→2× rated output, taller capacity follows the same ratio, and the innovation output bonus scales the rated rate.
- [x] Re-ran the 800-day fast road horizon after graph/perimeter hardening on seed 42: 75→77 road tiles, one connected component, zero unacquired road cells, zero off-road/unmarked active vehicles, and a clean accounting audit.
- [x] Fit Town now frames `PerimeterSystem.acquiredBounds()` from the actual acquired-cell ledger, instead of relying on the broader serviced perimeter envelope; UI/perimeter checks cover initial, reset, and post-acquisition framing.
- [x] Tightened the Fit Town diagonal scale from 1.35 to 0.75 after visual verification so the acquired footprint fills the viewport and frontier land no longer dominates the automatic overview.
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
- [x] Added camera-local visible precipitation: rain is rendered as animated streaks and snow as animated flakes around the current town view. The renderer reuses the deterministic weather state, overcast lighting, and fog, and the weather regression now verifies both visible layers.
- [x] Enlarged the founding lake to a 24–64-cell compact connected body with an eight-cell reach cap. The water grid remains authoritative, while RoadKit now groups connected water cells and renders a rounded dark shoreline plus inset, deterministic organic Three.js surface. Added `npm run test:lake` for seed-1337 footprint, mesh, validation, and page-error coverage.

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

- [x] Add a player-facing transit-stop placement tool so bus routes can be authored as well as discovered from road markings. The Stop tool persists manual marks through integrity save/restore.
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
- [x] Added a severe-congestion priority band (65%+) so a legal EXTEND_STREET or ROADUP plan outranks lower-band infill in Council feasibility ordering and is labelled emergency in the Council report.
- [x] Added recycling-cap regression coverage to `npm run test:society`.
- [x] Added `npm run test:campus` for the near-campus, across-road, far-campus, and ordinary-civic placement cases.
- [x] Reworked the founding street layout into a two-street cross with explicit frontage zoning and compact resource siting. Seed-42 starts with the same 15-building/30-resident contract and a fully acquired non-water founding envelope; later branches are earned through legal `EXTEND_STREET` and outward land acquisition.
- [x] Visually checked the initial seed-1337 overview after regeneration: the compact town envelope is acquired as one legal town parcel, the resource belt remains separated from homes, and later land requests select only the outer frontier ring.
- [x] Gated automatic and explicit `ACQUIRE_LAND` on complete exhaustion of acquired serviced plots. The complete non-water tight founding envelope is already acquired, so a full-bed town uses its existing frontage first; frontier selection only buys cells outside the current envelope, prefers road-fronted cells, and includes a contiguous progression patch when needed without implicit building-triggered streets.
- [x] Added `npm run test:land-gate`: the forced request probe verifies one exhausted-ledger acquisition and rejects the next request until the newly acquired plots are used.
- [x] Verified explicit outward acquisition on seed 42: after the complete tight founding envelope is used, the ledger expands beyond its initial bounds through charged `ACQUIRE_LAND` decisions, while acquired frontage becomes usable before the next build order.

### Follow-up checks

- [ ] Run a normal-council 800-day matrix with congestion snapshots and compare EXTEND_STREET/ROADUP response latency after the emergency priority band.
- [x] Made the light playable ground follow the acquired perimeter envelope. The outer skirt remains future land, and a successful land acquisition expands the light plane so the boundary is visible during growth.

