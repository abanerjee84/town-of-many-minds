# Town 3 construction and progression specification

Updated 2026-10-02 after the population-cap, factory-archetype, fuel-siting, founding-frame, and progression audit.

## Scope

This specification defines the shared construction vocabulary and the progression contracts for housing, commerce, civic buildings, higher education, industry, resources, utilities, roads, public spaces, props, the council, and provider benchmarking.

## Design principles

1. A construction block is a named, inspectable module or facility. It does not bypass placement, finance, zoning, road access, materials, reserve, or validation.
2. Specialist kits own geometry and simulation rules. The shared catalogue owns stable IDs, families, footprints, module roles, bills, and measured demand gates.
3. Seeded builds are deterministic. Optional blocks are recorded in the building spec so rebuild, renovation, and floor expansion preserve them.
4. Footprints are reserved before geometry is emitted. A failed build restores the grid, buildings, accounts, inventory, claims, and project ledger.
5. Growth must be earned by housing, services, work, education, resource capacity, transport, and fiscal runway. A road extension may only be selected from measured network benefit or connectivity evidence.
6. Council qualities are observations, not instructions. The experiment supplies evidence, interfaces, and consequences; intelligence, restraint, creativity, and concern for residents must emerge from provider decisions and measured outcomes.

## Functional requirements

### Shared catalogue and bills

1. CONSTRUCTION_BLOCKS shall contain unique IDs across every kit. Every row has kit, family, label, footprint, and at least one module.
2. constructionBlock(id), listConstructionBlocks(filter), constructionBlockStats(), and auditConstructionBlocks() shall be immutable/read-only catalogue operations.
3. constructionBlockQuote(id, { area }) shall return a frozen bill with cost, materials, labour hours, and modules. An explicit block quote remains stable through site selection and project start.
4. constructionBlockDemand(id, town) shall expose measured gates for complete streets, cycle corridors, transit stops, and mobility/charging bays.
5. The browser shall expose catalogue, quote/audit helpers, demand gates, and constructionPalette() on window.

### Housing, commerce, and mixed use

6. HouseKit shall support accessible entrances, balconies, solar roofs, and planted roofs with role-tagged geometry and module records.
7. IMAGINE_ARCHETYPE block=<id> shall validate the block, infer a compatible zone/facility, merge module flags with explicit flags, and reject unrelated kit families.
8. Project and decision records shall retain blockId, modules, materials, and labourHours. Buildings shall retain blockId and climate/access flags.
9. Residential occupancy shall be three residents per tiled footprint per floor, except for the founding contract's explicit five-bed homes. A three-storey one-tile home therefore holds nine residents; multi-cell homes multiply by their tile count. Commerce and factory occupancy shall be monotone in footprint area and floors; office desks shall follow the same floor-area rule.
10. A building's staffing requirement shall be derived from floor area × floors at the shared `AREA_PER_STAFF` rate. Public civic buildings shall contribute posts to Lifecycle, Governance, settler pull, and hiring; civic hires shall be placed at civic buildings only.
11. Commerce rung capacity shall be normalized to the selected lot area. TIERUP, vertical expansion, and WING shall preserve the existing footprint/floor multiplier and shall never apply a floor multiplier twice.
11a. The bottom ribbon shall expose a Settings cog that opens a modal. Settings shall persist in browser storage, validate their ranges, and show these defaults: three residents per tiled residential floor, maximum population 1,000, 1.0× night glow, council temperature 0.15 with a user range of 0–1.0, automatic council enabled, Reset speed 100×, camera yaw 34.5°, tilt 64°, zoom 228 m, and pan target (-20, -40). Camera tilt shall allow 0° for a true top-down audit; at the pole the readout shall preserve the requested yaw because OrbitControls has no defined azimuth there. Residential density applies to homes built after the change and later vertical growth; the founding five-bed starter contract remains explicit. The maximum population setting shall clamp to 30–1,000 and update lifecycle admission without deleting existing residents.

11b. Industry catalogue rows shall declare a minimum 3×3 factory campus and larger candidate lots up to 5×4. Each factory type shall carry a deterministic floor count and module list. The HouseKit factory branch shall emit type-specific geometry and preserve `factoryType`/`factoryModules` through rebuild, floor expansion, and inspection. A factory plan shall never fall back to a 1×1 shell when its campus search fails. Multi-cell surveys shall validate the requested footprint cells individually, permit a free cell beside an occupied cell in the same subdivided parcel, exclude protected park/public cells, and project any road expansion before paving it; a failed survey shall not leave a speculative street behind.

### Civic progression

12. Every civic facility shall be present in CIVIC_CATALOGUE and CIVIC_ORDER, use the shared Building Kit shell, and declare a measured capacity kind.
13. The catalogue shall include courthouse, emergency shelter, transit hub, recycling centre, college, and university.
14. College and university facilities consume the tertiary civic-load kind. The landmark university campus also carries tertiary capacity and is gated by population and public treasury.
15. Lifecycle graduation from secondary to tertiary education requires available tertiary capacity. The council ranks a college once the town reaches a cohort-sized population; the campus remains a later metropolis milestone.
16. Recycling facilities consume the waste civic-load kind and feed the auditable waste flow.
16a. Named civic facilities shall honour their shared catalogue footprint minimums. Campus-like facilities (school, hospital, college, university, library, museum, conservatory, community, and courthouse) shall consume horizontal cells as well as floors; capacity and construction bills shall scale with the chosen area. A same-parcel WING shall increase usable capacity when land remains.

16b. Fuel stations shall remain pump/tank resource sites for fuel accounting, but shall be classified as public-facing civic infrastructure for siting: their yard shall be selected within a shallow (three-cell) belt around the measured road core, retain government ownership, and use a short connected access spur. They shall not be selected as remote industrial works.

### Public realm, utilities, and resources

17. PublicSpaceKit shall plan paths, sports pitches, gardens, and playgrounds from reserved park cells without overlap.
18. PropKit shall supply planters, picnic tables, bike racks, play structures, swings, benches, lamps, bins, fountains, and mobility/charging furniture.
19. Utility, solar, and farm upgrades shall add visible cabinets, treatment blocks, battery banks, and greenhouse extensions without changing their network/production invariants.
20. Battery storage shall be a first-class energy site with a storage-only capacity contribution, visible cabinets, and an automatic site gate that fires only when energy storage is below the measured daily buffer.
21. Resource stats shall include auditable waste generated, processing capacity, processed, recycled, composted, landfill, and diversion values. Agriculture sites shall use exact horizontal yards of 7×4 tiles at tier 1, 8×5 at tier 2, and 9×6 at tier 3. An enacted `UPDATE_RESOURCE` (canonical `UPGRADE_RESOURCE`) shall emit a structured event and show a short-lived world and HUD feedback marker.
21a. Farm, husbandry, and poultry resource yards shall reserve a two-tile Chebyshev setback around their full cell footprint. Residential, commercial, civic, and industrial building placement shall reject candidate cells/footprints inside that buffer in both the Council survey and the final placement boundary. An explicit scenario override may co-locate a specialist facility; ordinary roads, resource-site siting, and non-building props are unaffected.
21b. Production and storage resource sites (reservoir, silo, wind, solar, farm, husbandry, poultry, and battery) shall reserve a two-tile Chebyshev setback from residential, commercial, and civic buildings around the full site/building footprints. The inverse check shall also run when a resource is planned after founding buildings or during later capacity growth, preventing a facility from being dropped beside an occupied public lot. Industrial buildings may share a supplier corridor; public-facing fuel stations and natural lakes remain exempt from this facility buffer. Council surveys and the final placement boundary shall use the same shared rule, with an explicit scenario override available for specialist tests.

21c. The ForestSystem shall treat the whole finite build plate as wooded terrain. Initial seeding shall use deterministic, seed-stable density on eligible cells and shall include a dense, non-rectangular polygonal woodland stand outside the founding perimeter. Roads, footways, water, resource yards, and building footprints are excluded from planting. Tree props may be cleared by roads, construction, parks, or bulldozing and each cleared tree shall return four lumber units to the town storehouse through the industry ledger. Player and Council tree orders shall increment plantation accounting; natural falls shall be deterministic, bounded by a low per-tree day hazard, recover timber, and rebuild decoration once per batch. `Town.stats().forest` shall expose live tree count, plate coverage, seeded/planted/felled/natural-fall counts, and recovered lumber. Forest counters and RNG state shall participate in project savepoint rollback.

21b. Footways shall be pedestrian-only links. Automatic growth shall not commission a footway as filler; an explicit `EXTEND_FOOTWAY`/player order may lay a shortest useful link only to a private or civic inland parcel, excluding park/public reservations. A footway may be converted to asphalt through the Road tool when vehicle access is required.

21b. Vehicle parking and lane occupancy shall be mutually consistent. A vehicle with an active parking claim or a `docking` final-leg route shall not be selected as a wait-for cycle yielder and shall never be commanded to reverse through its claimed bay. If a stale same-tick reverse command reaches a claimed/docking vehicle, the claim shall be released and the vehicle shall retry from a legal road approach. A vehicle with `parkTimer > 0` shall keep its world pose fixed for the dwell. Idle emergency/service bays shall be held until a matching call or a successfully routed work stop exists; an unreachable request shall be retried from the held bay without a release/re-claim loop. Rendered vehicle meshes and their collision/parking footprints shall use one shared scale; with 1.6 m opposing lane-centre spacing, the largest body shall retain a small lateral buffer.

### Metropolis growth and fiscal safety

22. The founding 30-person contract shall not be treated as overcrowded by the later 90% occupancy band. Subsequent population targets shall be derived from beds, civic capacity, and SIM.maxCitizens. Housing need shall include a two-bed integer-rounding cushion so a town cannot stall immediately below an education milestone.
23. The first local lumber, steel, and cement works shall be bootstrappable with a bounded construction-material import; once a local producer exists, industry shall consume contractor and peer-factory stock before importing.
24. Essential water, resource upgrades, utility expansions, public civic-capacity floors, and explicitly selected private-capacity progression (floors, wings, and commerce tier-ups) may use a bounded developer PPP pool. An explicit financing leg shall override the target owner's empty business/household wallet. Government operating reserve and ledger floors remain enforced for every transfer.
25. Utility coverage shall be measured from the connected expanded network. Water imports may cover a bounded source shortfall, must be priced and recorded, and shall never create unbounded free production.
26. The council and its rules fallback shall be able to sequence housing, roads, services, work, education, resource capacity, and landmarks while retaining reserve/runway checks and rollback. A civic load above 85% shall rank an upgrade before population pull is allowed to stall at zero. Capacity-kind routing shall select a facility that actually satisfies the overloaded contract: `patients/day`→clinic, `beds`→hospital, `visitors`→library, and `waste`→recycling.
27. EXTEND_STREET (also parsed from `EXPAND_STREET` and `EXPAND ROAD` aliases) shall be offered only when congestion is above the 0.34 gate and the measured road planner finds a legal run. A legal run is a straight continuation from a single road end or a straight closure of a gap between opposing road ends; it may not start beside a junction, touch a side road through its middle, or run parallel one cell from an existing corridor. With four or more completed origin/destination observations, the planner prefers a run that shortens those observed trips; if no candidate shortens them, a legal run touching a measured live hotspot may be selected. With fewer than four observations, only a disconnected-component join or a measured-hotspot run is eligible. Completed trips remain in a bounded 128-record history while short-lived cell delay buckets expire quickly; live vehicle pressure is sampled into the demand snapshot so a slow council cadence cannot hide a queue. The council chooses the order; the planner owns coordinates and rejects arbitrary paving.
28. Long-run checks shall watch treasury runway, operating reserve, developer capital, population target, project/crew caps, road connectivity, resource strain, waste diversion, tertiary capacity, factory campuses, education progression, and landmark progression. Horizon reports shall use lifetime progression counters rather than the short HUD history tail.

28a. Building progression shall be population-earned: desired height is 2 floors below 60 residents, 4 at 60, 6 at 120, 9 at 200, 12 at 320, 16 at 600, and 20 at 800 (bounded by `MAX_FLOORS`). Once population reaches 60, vertical upgrades compete as core growth; once it reaches 90, a legal same-parcel wing competes as horizontal capacity. Ten floors is the skyscraper milestone. The town shall record and display the first day a building reaches it.

28b. The founding road frame shall use a 22–24 by 19–21 cell envelope with sparse occupancy and open land around it for future expansion. Junction marking passes shall not paint a second full zebra set into a neighbouring junction approach.

### Progression matrix

| System | Measured trigger | Council response |
| --- | --- | --- |
| Housing | target population is above available beds and the proportional spare-bed buffer is missing | build homes or a housing archetype |
| Commerce and offices | unemployment or customer capacity crosses its gate | add a shop, tier up an existing shop, then add offices after the population floor; tier-ups retain footprint and floors |
| Civic services | any facility load exceeds 85% | add a same-parcel wing first when a strip is free, otherwise raise that facility a floor; the public outcome may use PPP when the reserve is protected |
| Higher education | population reaches 45 for a college, then 150 for a university | add tertiary seats with a campus-sized footprint and bounded missing-input import; graduation is capacity-gated |
| Waste | landfill exceeds the measured diversion gate | build recycling capacity, then expand it when waste load rises |
| Resources | production, storage, or imports cannot cover demand | upgrade the strained site, add a site, or use the bounded import fallback |
| Utilities and battery | generation, storage, distribution, or network coverage is the binding constraint | expand the named network or add battery storage only when storage is the limiting term |
| Industry | construction or consumer material stock is short, or the town reaches 80 residents with no works campus | bootstrap the missing local producer, then consume peer inventory and export only surplus; each works uses a strict 3×3+ campus and a type-specific design |
| Roads and mobility | measured congestion, trip benefit, disconnected components, parking pressure, or transit demand | extend/widen the measured corridor, bridge a reconnecting gap, or add demand-gated furniture |

### Inspection and provider comparison

29. The palette UI shall group blocks by family and show connected-footprint, zone, demand-gate, runway, material, labour, and module information.
30. Building inspection shall show construction block ID, module roles, accessibility, solar, planted-roof, and balcony flags.
31. Council snapshots and benchmark scores shall include block count, accessible-building coverage, tertiary capacity, waste diversion, and a construction outcome score alongside the existing intelligence, resident-impact, safety, progress, execution, and fiscal diagnostics. These are measured after a run; they are not traits prescribed to the model.
32. Initial load and Reset shall restore a wide elevated camera overview that keeps the playable road network and town centre readable in the viewport.
33. Settings changes shall apply safely at runtime: glow and council controls take effect immediately, speed updates the active clock and Reset default, and malformed persisted values fall back to documented defaults without blocking town generation.
34. A centered camera readout shall sit immediately above the bottom ribbon and display live orbit yaw/tilt, zoom distance, and right-drag pan target X/Z. Camera defaults shall be user-controllable and persisted with defaults of 34.5° yaw, 64° tilt, 228 m distance, and target (-20, -40); load and Reset shall apply those values to the wide overview.
34a. A compact vertical camera toolbar shall sit in the gutter immediately to the right of the left HUD. It shall provide bounded orbit, tilt, and zoom nudges, town-centre focus, camera-home, and ready-made ISO, TOP, north-facing, and east-facing poses. Each control shall expose an accessible label and update the live camera readout without rewriting saved Settings defaults.
35. The Settings modal shall be vertically scrollable, keep its search field usable while scrolling, and group controls into searchable Simulation, Council, Visuals, and Camera sections. Filtering shall hide nonmatching rows and empty sections while preserving each control's current value.
36. Town Centre shall focus the nearest road junction while preserving the configured camera yaw, tilt, and zoom values; it may change the temporary focus target but shall not rewrite the saved default pan target.
37. Each enacted council decision shall receive a bounded before/after outcome observation. The observation shall update empirical action estimates and recent lessons without changing the parser, action registry, construction gates, placement planner, catalogue, or accounting rules. Observations shall age for at least one simulation day, retain the last 24 lessons, and be exposed to the next sitting as descriptive evidence with an explicit single-result uncertainty warning.
37a. The top strip shall show a compact Council evidence panel beside Decisions. It shall display the latest provider reply as a thought trace and the bounded learning record (lessons, pending observations, and latest measured outcome) as descriptive state only; it shall not assign or instruct a personality trait.
38. Road planning shall memoize a demand snapshot only for the current measured state, invalidate it when roads, buildings, projects, or pressure change, and never authorize a run from geometry alone. A deterministic 800-day seed run shall retain one connected road network, create asphalt extensions when congestion persists, and finish without off-network buildings or unmarked active vehicle cells.
38a. `EXTEND_STREET` shall reject a candidate that touches an existing junction of degree three or higher at either endpoint, or that creates more than one new junction. Side-touching runs, parallel one-cell corridors, and compact checkerboard closures shall remain ineligible; open-end straight continuations may proceed when measured demand authorizes them.
39. Test harnesses shall expose a synchronous forced-request boundary that routes a supplied intent through the same parser, planner, affordability, construction, decision ledger, and learning code as a council request without contacting an LLM provider. Metropolis and road horizons shall offer a fast mode that invokes this boundary at a configurable interval instead of evaluating the full planner every simulated day.

## Public API

constructionBlock, constructionBlockQuote, constructionBlockDemand, listConstructionBlocks, constructionBlockStats, and auditConstructionBlocks are exported from src/kits/constructionBlocks.js.

The browser exposes the same operations plus window.constructionPalette(). Geometry kits remain the source of truth for meshes; catalogue rows remain the source of truth for block identity and inspection.

The council integration exposes `registerLLMProvider`, `listLLMProviders`, `runCouncilBenchmark`, `councilSnapshot`, and `scoreCouncilRun`. A provider adapter returns a normalized council completion; the benchmark scores the same seeded scenarios for intelligence, resident-impact, safety, progress, execution, construction outcome, and fiscal behavior. The historical `empathy` score field remains a compatibility label for the resident-impact diagnostic and is never inserted as a prompt objective.

The council system prompt is an epistemic contract for provider comparison: it describes the town-building experiment, says that no personality trait is preassigned, treats the report and measured learning record as evidence, requires one feasible parseable action, and forbids invented IDs, coordinates, budgets, or rules. Its static form is capped at 4,000 approximate tokens; the dynamic stage/persona/learning additions remain within that cap in regression coverage. Learning is a bounded before/after memory (24 lessons, 16 pending observations, a one-simulation-day minimum ageing delay) and is descriptive rather than a reward instruction. Council temperature is bounded to 0–1 (default 0.15, configurable to 0 for replay); creative archetype replies may choose a valid block, name, footprint, and safe accessibility/climate modules without inventing IDs or coordinates.

## Social systems and outward growth

40. The perimeter system shall maintain an acquired-cell ledger separate from zoning and road occupancy. The founding town shall acquire every non-water cell inside its tight asset envelope; only cells outside that envelope are frontier. A frontier survey shall return only in-bounds, non-water cells adjacent to acquired land and outside the current envelope. Acquisition shall be quoted per tile, charged through the government account, and logged before growth paves a street or places a building. Failed acquisition shall not silently authorize construction outside the perimeter.
41. Public transport shall discover marked bus stops on the road network, build a connected cyclic route when at least two stops exist, and require a `busdepot` or `transit` civic facility before procurement. Government buses shall be registered assets, spawned through TrafficSystem, use a dedicated transit route role, and expose stops, route length, fleet, rides, coverage, and readiness in `Town.stats()` and the overview.
42. Society shall maintain coarse neighbourhoods from the town grid, granular resident mood dimensions (needs, safety, services, economy, belonging, and transport), reported crimes, justice cases, active-law effects, approval, election results, and demolition records. Crime risk and case resolution shall remain deterministic from seeded state and available police/courthouse capacity; the system shall observe policy laws rather than maintain a divergent statute book.
43. `BUILD_TRANSIT`, `ACQUIRE_LAND`, and `RESTRUCTURE_BUILDING` shall be valid Council intents. They shall round-trip through parseIntent/planCode, use the same affordability and project ledger as existing actions, and report a concrete null-plan reason when no stop network, frontier, or eligible building exists. Transit is an explicitly requested public service and may bypass the generic civic-demand gate while still respecting finance, materials, footprint, and road access.
44. Demolition and restructuring shall preserve rollback guarantees. Demolition records occupant relocation and clears the original footprint; restructuring may add one bounded floor to an eligible non-town-hall building in place, preserving its kind/facility and rebuilding the same footprint. Neither path may leave a stale claim, duplicate building, or uncharged treasury mutation.

45. Civic vertical growth shall be facility-specific. `CIVIC_VERTICAL_CAPS` shall bound each catalogue facility (low-rise service yards such as recycling, fire, daycare, bus depot, and transit remain low-rise; colleges, universities, hospitals, and government facilities may rise higher). `UPGRADE` and `RESTRUCTURE_BUILDING` shall respect the cap. Generic population height progression shall target private residential/commercial buildings only. When an overloaded civic facility reaches its cap, the planner shall prefer a same-parcel wing or a new facility of the matching capacity kind.

46. The founding core shall remain compact: its generated street/building frame shall be no larger than 30×30 cells and shall default to a 22–24 × 19–21 envelope. The perimeter ledger shall acquire the complete non-water tight envelope around founding buildings, resource sites, public-space cells, and their existing roads, so empty cells inside the initial town are legal build land. A frontier tile outside that envelope must be acquired and charged before a growth road or building uses it.

46a. The founding street network shall be a sparse two-street cross with explicit frontage zoning, not a recursively subdivided finished grid. Resource sites may receive only compact access spurs; additional parallel streets and branches shall be earned through legal `EXTEND_STREET` growth. The seed-42 acceptance baseline is the 15-building/30-resident compact town with its complete non-water founding envelope acquired and all frontier land outside that envelope.
46b. Automatic or explicit `ACQUIRE_LAND` shall be offered only when the acquired ledger has no usable serviced plot left and a measured housing, material, civic, or progression need remains. A campus or works footprint that does not fit while any acquired serviced plot remains shall wait for that land to be used. Each shortage purchase shall prefer road-fronted buildable cells, include a contiguous progression patch when one is required, and include a frontier tile beyond the current envelope so the bounds can grow outward. The land order shall remain a charged, auditable project; building requests may not pave an implicit street or use unacquired cells.
46c. The founding perimeter bounds shall follow the tight bounding rectangle of the actual founding roads, buildings, public cells, resource yards, and their access spurs. All non-water cells inside that envelope are acquired; no empty perimeter apron outside it is acquired. Frontier surveys and land acquisition shall begin outside that asset envelope and expand it when the Council buys new land.
46g. When housing pressure is at the full-bed gate, the planner shall use an acquired serviced residential plot inside the founding envelope before requesting land. `ACQUIRE_LAND` shall be valid only after those serviced plots are exhausted and shall target cells outside the current envelope. If an explicit `DEVELOP_HOUSING` arrives before an acquired serviced residential plot exists, the decision shall report `ACQUIRE_LAND first` rather than silently paving a street or emitting a generic no-plot result.

46d. The rendered light ground plane shall follow the acquired perimeter bounds. Unacquired cells remain on a darker finite world skirt and become part of the light playable plane only after a successful, charged land acquisition; the ground must expand when the perimeter ledger expands.

46e. The finite build plate shall be 100×100 cells (10,000 tiles, 400×400 metres at the four-metre cell scale). The founding town remains a compact acquired envelope inside that plate. Seeded foliage shall be sparse inside the visible town, dense in an irregular polygonal woodland band at the founding edge, and light but continuous across the remaining frontier so the plate never reads as an empty green void.

46f. The foliage kit shall expose tree, pine, and low-shrub variants through one renderer vocabulary and the `prop.foliage` construction block. The founding envelope shall receive approximately 50 deliberate canopy specimens plus a small decorative understory layer; this landscaping is separate from natural frontier seeding and remains removable without timber credit for shrubs.

47. The top strip shall show a Societal summary panel immediately to the right of Council evidence. It shall update from `Town.stats().society` and display approval, aggregate mood, neighbourhood count, open crimes, court backlog, active-law count, and the current mayor/election. The panel is descriptive telemetry and shall not prescribe Council traits or hide the detailed society inspector.

47a. Every Council report shall include the same social evidence used by the Societal panel: approval, citizen mood, available mood dimensions, neighbourhood count, open crimes, court backlog, active laws, and mayor. Schemes and landmark choices may respond to this evidence, but the report shall not convert it into an undisclosed automatic landmark gate.

48. When measured congestion reaches 65%, a legal `EXTEND_STREET` or `ROADUP` candidate shall receive an emergency priority score above lower-band infill in the rules fallback and Council feasibility ordering. The candidate must still pass the road planner's measured-demand, connected-component, legal-run, finance, and material checks; severe congestion never authorizes arbitrary paving.

The next social-system acceptance pass shall add a player-facing stop-placement tool, staffed court throughput, neighbourhood-specific budgets, and seeded provider comparisons for approval, fiscal runway, crime resolution, and land-use efficiency. These are follow-up experiments rather than hidden Council objectives.

## Acceptance tests

- npm run build, npm run test:ui, npm run test:kits, npm run test:economy, npm run test:governor, npm run test:glow, npm run test:resources, npm run test:council, npm run test:soak, and npm run test:metropolis pass with no page errors.
- A two-floor house built with all four flags contains balcony, ramp, solar, and green-roof roles and modules.
- Every civic order row has a catalogue entry and a declared capacity kind, including college, university, and recycling.
- A college/university build contributes tertiary capacity; secondary residents do not graduate while the tertiary load has no headroom.
- Facility plans for school, hospital, college, and university use multi-cell horizontal footprints; explicit undersized specs are clamped to the catalogue minimum, and a same-parcel wing increases capacity.
- An overloaded civic capacity kind expands the matching facility family (`patients/day` clinic, `beds` hospital, `visitors` library, `waste` recycling) rather than silently adding a different service.
- Battery storage appears only when energy storage is below the measured buffer and contributes to energy capacity without fake generation.
- Waste stats reconcile generated = processed + landfill and processed = recycled + compost.
- A block quote survives site selection and is visible in the decision record and building inspector.
- Public-space plans never overlap reserved cells; demand-gated road furniture explains unmet gates.
- The founding population remains stable at 30 until earned capacity changes the target; long probes must report the actual stage and progression milestones rather than treating a raw building count as a metropolis guarantee. A vertical/campus metropolis is recognized from population plus occupied `footprint × floors` area. The current seed-42 forced 2,200-day run reaches metropolis on day 1,823 and the first ten-storey building on day 2,153 with positive treasury and clean audits; the normal-council matrix remains the provider-comparison acceptance gate.
- A browser probe shall verify the 1,000 population default and live Settings cap, and a factory probe shall verify 3×3+ footprints, type-specific modules, multi-storey floors, and strict no-1×1 fallback.
- The factory-site regression shall verify a seed with abundant open land commissions a 3×3+ campus without reporting “no free plot and no room to expand,” and that a later expansion candidate is accepted only when its projected street unlocks the requested footprint.
- A progression horizon shall report tier-ups, wings, maximum floors/footprint, and first skyscraper day; the skyscraper event shall be visible in the town log when a building crosses ten floors.
- The UI probe shall verify that both initial load and Reset restore the wide overview camera pivot.
- The UI probe shall open the Settings modal and verify the default density, 1,000 population cap, glow, council, speed, and automation controls.
- The resource feedback probe shall upgrade a founding farm through the real kit path, verify its exact tier-2 area, observe a world pulse, and observe the HUD `UPDATE_RESOURCE` message and Council evidence panel.
- The agricultural setback probe shall verify the protected boundary, a legal next tile, a clean seed-1337 founding layout, and that Council footprint surveys do not return a site inside a farm/paddock buffer.
- The resource-neighbour probe shall verify the shared two-tile production/storage buffer in both directions, permit industrial supplier adjacency, and show seed 1337 has no ordinary building beside a protected resource site after founding placement or Council survey.
- The footway probe shall verify no automatic footway ranking, successful explicit pedestrian-link placement, Road-tool conversion to asphalt, and a forced request with zero provider calls.
- The UI probe shall verify the centered camera readout, pan-target setting wiring, camera defaults, searchable section filtering, Town Centre-compatible camera state, and that the ribbon remains contained at 1024px.
- The construction-kit probe shall verify horizontal civic footprints, facility-only archetype inference, and valid catalogue block IDs.
- The council prompt probe shall verify the emergent-traits contract, the 4,000-token approximation cap, the shared catalogue/action vocabulary, and a measured before/after learning lesson after a real enacted decision.
- The road planner probe shall verify trip-history retention, live pressure sampling, hotspot fallback, cache invalidation, legal-run filtering, and the `EXTEND_STREET` alias path.
- The vehicle parking probe shall run a seeded horizon and verify that claimed/docking vehicles never back, active parking poses do not move during dwell, and every vehicle footprint remains within the lane-width envelope; the road horizon shall retain zero unmarked active vehicle cells after the resize.
- `ROAD_HORIZON_DAYS=800 ROAD_HORIZON_SEEDS=42 npm run test:road-horizon` shall show completed road decisions, increased asphalt-road count, one connected component, no off-network buildings, no unmarked active vehicle cells, and a finite final congestion value.
- `npm run test:metropolis-fast` and `npm run test:road-horizon-fast` shall exercise forced requests with no provider/network dependency; their output shall report the number of injected requests and preserve ledger/economy audit validity.
- Junction-adjacent curve cells shall not emit a second diagonal lane-marking pass over the junction zebra markings.
- The road-extension regression shall reject a four-tile closure between two busy junctions while retaining a measured straight continuation and a measured network join.
- The perimeter regression shall verify seed 1337’s tight 33×27 asset envelope, retain ownership of every non-water founding asset, return frontier candidates adjacent to that envelope, and verify that the rendered playable plane expands after acquisition.
- The land-gate regression shall verify that the first exhausted-ledger acquisition can proceed, then a second `ACQUIRE_LAND` is rejected while acquired serviced plots remain.
- The housing-growth regression shall verify a full-bed seed ranks `DEVELOP_HOUSING` on acquired land, starts the explicit order, and never requests frontier acquisition while a serviced founding plot remains.
- The forest regression shall verify seed-1337 full-plate tree coverage with an irregular edge stand, four-lumber deforestation credit, plantation accounting, bounded natural fall, and clean rendering with no page errors.

