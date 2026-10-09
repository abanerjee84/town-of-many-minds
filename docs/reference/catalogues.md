# Catalogue reference

## Construction blocks

81 rows from [constructionCatalog.json](../../src/data/constructionCatalog.json). Footprints are catalogue dimensions in cells, before any legal variant/plan adjustment; modules require their renderer/consumer.

| Block ID | Label | Kit | Family | Footprint | Modules |
| --- | --- | --- | --- | --- | --- |
| `house.core` | Family house | houses | housing | 1 × 1 | entrance, unit, roof |
| `house.townhouse` | Townhouse | houses | housing | 1 × 1 | entrance, corridor, unit, roof |
| `house.balcony` | Balcony house | houses | housing | 1 × 1 | entrance, balcony, unit, roof |
| `house.accessible` | Accessible home | houses | housing | 1 × 1 | entrance, ramp, unit, roof |
| `house.solar` | Solar home | houses | housing | 1 × 1 | entrance, unit, solar-roof |
| `house.gated.community` | Gated residential community | houses | housing | 3 × 2 | gate, courtyard, parking, entrance, corridor, balcony, unit, green-roof |
| `mixed.use` | Mixed-use block | houses | commerce | 2 × 1 | storefront, lobby, unit, roof |
| `office.lobby` | Office block | houses | commerce | 1 × 1 | lobby, fin, roofplant |
| `commerce.hotel` | Hotel | houses | commerce | 3 × 3 | lobby, canopy, room-balconies, roof |
| `commerce.resort` | Destination resort | houses | commerce | 5 × 4 | lobby, pool, terrace, service-wing |
| `civic.townhall` | Town hall | civic | civic | 1 × 1 | entrance, lobby, unit, roof |
| `civic.library` | Library | civic | civic | 2 × 1 | entrance, porch, unit, roof |
| `civic.school` | School | civic | civic | 2 × 2 | entrance, unit, porch, playground, roof |
| `civic.college` | College | civic | civic | 3 × 2 | entrance, ramp, lecture-hall, lab, courtyard, solar-roof |
| `civic.university` | University | civic | civic | 4 × 2 | entrance, ramp, lecture-hall, library, lab, courtyard, green-roof |
| `civic.clinic` | Clinic | civic | civic | 1 × 1 | entrance, ramp, storefront, roof |
| `civic.hospital` | Hospital | civic | civic | 3 × 2 | entrance, ramp, lobby, ward, roof |
| `civic.police` | Police station | civic | civic | 1 × 1 | entrance, garage, unit, roof |
| `civic.fire` | Fire station | civic | civic | 1 × 1 | entrance, garage, loading-bay, roof |
| `civic.government` | Government office | civic | civic | 2 × 1 | entrance, lobby, unit, roof |
| `civic.community` | Community centre | civic | civic | 2 × 1 | entrance, porch, unit, roof |
| `civic.postoffice` | Post office | civic | civic | 1 × 1 | entrance, storefront, unit, roof |
| `civic.daycare` | Daycare centre | civic | civic | 2 × 1 | entrance, porch, unit, playground, roof |
| `civic.museum` | Museum | civic | civic | 2 × 1 | entrance, lobby, unit, gallery, roof |
| `civic.conservatory` | Conservatory | civic | civic | 2 × 2 | entrance, storefront, unit, greenhouse, roof |
| `civic.busdepot` | Bus depot | civic | mobility | 2 × 1 | entrance, garage, loading-bay, roof |
| `civic.courthouse` | Courthouse | civic | civic | 2 × 1 | entrance, ramp, lobby, courtroom, roof |
| `civic.shelter` | Emergency shelter | civic | civic | 1 × 1 | entrance, ramp, unit, green-roof |
| `civic.transit` | Transit hub | civic | mobility | 2 × 1 | entrance, ramp, lobby, solar-roof |
| `civic.recycling` | Recycling centre | civic | utility | 2 × 1 | entrance, ramp, loading-bay, sorting-line, solar-roof |
| `industry.factory` | Factory shell | industry | industry | 3 × 3 | loading-bay, service-yard, roof |
| `industry.sawmill` | Sawmill | industry | industry | 3 × 3 | timber-yard, sawtooth-roof, dust-collector |
| `industry.steelworks` | Steelworks | industry | industry | 4 × 4 | cooling-tower, blast-furnace, ore-yard, stack |
| `industry.cement` | Cement works | industry | industry | 4 × 3 | kiln-tower, silo-bank, conveyor, stack |
| `industry.goods` | Goods plant | industry | industry | 3 × 3 | assembly-hall, loading-dock, office-block |
| `industry.textile` | Textile mill | industry | industry | 4 × 3 | sawtooth-roof, dye-tanks, delivery-bay |
| `industry.software` | Software house | industry | industry | 3 × 3 | office-tower, data-hall, cooling-units |
| `industry.furniture` | Furniture workshop | industry | industry | 3 × 3 | showroom, timber-yard, loading-dock |
| `industry.quarry` | Aggregate quarry | industry | industry | 4 × 4 | crusher, aggregate-piles, conveyor, service-yard |
| `industry.food-processing` | Food processor | industry | industry | 4 × 3 | processing-hall, cold-store, silo-bank, loading-dock |
| `industry.glassworks` | Glassworks | industry | industry | 4 × 4 | furnace, annealing-hall, glass-tanks, stack |
| `industry.chemicals` | Chemical plant | industry | industry | 4 × 4 | reactor-tanks, pipe-rack, storage-tanks, flare-stack |
| `industry.paper` | Paper mill | industry | industry | 4 × 3 | pulp-tanks, paper-machine, roll-store, loading-dock |
| `industry.electronics` | Electronics plant | industry | industry | 4 × 4 | clean-room, fab-hall, cooling-units, loading-dock |
| `industry.machinery` | Machinery works | industry | industry | 5 × 4 | machine-hall, gantry-crane, parts-yard, loading-dock |
| `industry.refinery` | Fuel refinery | industry | industry | 5 × 4 | distillation-tower, storage-tanks, pipe-rack, flare-stack |
| `industry.polymers` | Polymer plant | industry | industry | 4 × 4 | reactor-tanks, pellet-silos, pipe-rack, flare-stack |
| `industry.pharma` | Pharmaceutical plant | industry | industry | 4 × 4 | clean-room, sterile-tower, batch-tanks, loading-dock |
| `industry.batteries` | Battery plant | industry | industry | 4 × 4 | cell-hall, electrolyte-tanks, battery-racks, loading-dock |
| `industry.estate` | Industrial estate | industry | industry | 2 × 2 | loading-bay, service-yard |
| `resource.lake` | Lake catchment | resources | resource | 2 × 2 | water, shoreline, pump-house |
| `resource.farm` | Farm yard | resources | resource | 7 × 4 | barn, field, service-yard |
| `resource.greenhouse` | Greenhouse extension | resources | resource | 1 × 1 | glasshouse, irrigation, battery |
| `resource.livestock` | Livestock yard | resources | resource | 7 × 4 | barn, paddock, silo |
| `resource.poultry` | Poultry yard | resources | resource | 7 × 4 | coop, feed-store, silo |
| `resource.solar` | Solar field | resources | resource | 2 × 2 | panel-array, inverter, battery |
| `resource.wind` | Wind farm | resources | resource | 2 × 2 | turbine, service-yard |
| `resource.silo` | Grain silo | resources | resource | 2 × 2 | silo, loading-bay |
| `resource.reservoir` | Reservoir | resources | resource | 2 × 1 | basin, pump-house |
| `resource.gas` | Fuel station | resources | resource | 2 × 2 | pump, canopy, tank |
| `utility.substation` | Power substation | utilities | utility | 1 × 1 | transformer, switchgear, battery |
| `utility.water` | Water tower | utilities | utility | 1 × 1 | tank, pump-house |
| `utility.sewage` | Sewage plant | utilities | utility | 1 × 1 | clarifier, digestor, pump-house |
| `utility.battery` | Battery storage | utilities | utility | 1 × 1 | battery, inverter |
| `road.complete` | Complete street | roads | mobility | 1 × 1 | sidewalk, lane, drainage, street-light |
| `road.cycle` | Cycle corridor | roads | mobility | 1 × 1 | cycle-lane, crosswalk, parking-lane |
| `road.transit` | Transit stop | roads | mobility | 1 × 1 | bus-stop, shelter, crosswalk |
| `road.bridge` | Bridge crossing | roads | mobility | 1 × 1 | bridge, ramp, drainage |
| `road.arterial` | Four-lane arterial | roads | mobility | 1 × 1 | four-lane, median, turn-pocket, drainage, street-light |
| `road.roundabout` | Roundabout junction | roads | mobility | 3 × 3 | central-island, yield-marking, approach, street-light |
| `public.path` | Pedestrian path | publicspace | public | 1 × 1 | path, lamp, bench |
| `public.sports` | Sports pitch | publicspace | public | 2 × 2 | pitch, goal, lamp |
| `public.garden` | Community garden | publicspace | public | 2 × 2 | planter, bench, tree |
| `public.playground` | Playground | publicspace | public | 2 × 2 | play-structure, swing, soft-ground |
| `public.plaza` | Civic plaza | publicspace | public | 2 × 2 | fountain, bench, lamp |
| `prop.tree` | Street tree | props | public | 1 × 1 | tree |
| `prop.foliage` | Foliage cluster | props | public | 1 × 1 | tree, pine, shrub, understory |
| `prop.lamp` | Lamp post | props | mobility | 1 × 1 | lamp, glow |
| `prop.bench` | Bench | props | public | 1 × 1 | bench |
| `prop.fountain` | Fountain | props | public | 1 × 1 | fountain, water |
| `prop.mobility` | Bike and charging bay | props | mobility | 1 × 1 | bike-rack, ev-charger, planter |

## Factories and input recipes

18 types from [industryCatalog.json](../../src/data/industryCatalog.json). Floors are declared type defaults, not guarantees of a newly selected plan. Recipes are input units per output unit. A dash/none means no declared commodity input in this recipe, not zero operating cost.

| Factory ID | Label | Output | Floors | Inputs per output unit | Visual modules |
| --- | --- | --- | --- | --- | --- |
| `sawmill` | Sawmill | `lumber` | 2 | none | timber-yard, sawtooth-roof, dust-collector |
| `steelworks` | Steelworks | `steel` | 4 | none | cooling-tower, blast-furnace, ore-yard, stack |
| `cement` | Cement works | `cement` | 3 | lumber: 0.03 | kiln-tower, silo-bank, conveyor, stack |
| `goods` | Goods plant | `goods` | 3 | steel: 0.05, lumber: 0.08 | assembly-hall, loading-dock, office-block |
| `textile` | Textile mill | `cloth` | 3 | none | sawtooth-roof, dye-tanks, delivery-bay |
| `software` | Software house | `software` | 5 | none | office-tower, data-hall, cooling-units |
| `furniture` | Furniture workshop | `furniture` | 2 | lumber: 0.25 | showroom, timber-yard, loading-dock |
| `quarry` | Aggregate quarry | `aggregate` | 2 | none | crusher, aggregate-piles, conveyor, service-yard |
| `food-processing` | Food processor | `packaged_food` | 2 | food: 0.72 | processing-hall, cold-store, silo-bank, loading-dock |
| `glassworks` | Glassworks | `glass` | 3 | aggregate: 0.28, steel: 0.04 | furnace, annealing-hall, glass-tanks, stack |
| `chemicals` | Chemical plant | `chemicals` | 4 | refined_fuel: 0.2, aggregate: 0.08 | reactor-tanks, pipe-rack, storage-tanks, flare-stack |
| `paper` | Paper mill | `paper` | 3 | lumber: 0.34 | pulp-tanks, paper-machine, roll-store, loading-dock |
| `electronics` | Electronics plant | `electronics` | 4 | glass: 0.16, steel: 0.08, software: 0.1 | clean-room, fab-hall, cooling-units, loading-dock |
| `machinery` | Machinery works | `machinery` | 4 | steel: 0.3, electronics: 0.12 | machine-hall, gantry-crane, parts-yard, loading-dock |
| `refinery` | Fuel refinery | `refined_fuel` | 5 | crude_oil: 0.48 | distillation-tower, storage-tanks, pipe-rack, flare-stack |
| `polymers` | Polymer plant | `polymers` | 4 | refined_fuel: 0.28, chemicals: 0.2 | reactor-tanks, pellet-silos, pipe-rack, flare-stack |
| `pharma` | Pharmaceutical plant | `medicine` | 5 | chemicals: 0.24, glass: 0.08, software: 0.06 | clean-room, sterile-tower, batch-tanks, loading-dock |
| `batteries` | Battery plant | `batteries` | 4 | steel: 0.16, chemicals: 0.24, electronics: 0.12 | cell-hall, electrolyte-tanks, battery-racks, loading-dock |

## Storehouse commodities

Base daily rate is scaled by factory capacity/utilization. Crude oil has no local production rate. Prices are obtained through the separate dynamic price chart.

| Commodity | Label | Capacity | Initial total | Base rate |
| --- | --- | --- | --- | --- |
| `lumber` | Lumber | 900 | 500 | 45 |
| `steel` | Steel | 850 | 400 | 35 |
| `cement` | Cement | 850 | 450 | 40 |
| `goods` | Goods | 900 | 400 | 30 |
| `cloth` | Cloth | 800 | 300 | 32 |
| `software` | Software | 600 | 250 | 20 |
| `furniture` | Furniture | 800 | 300 | 28 |
| `aggregate` | Aggregate | 1000 | 500 | 58 |
| `packaged_food` | Packaged food | 850 | 300 | 38 |
| `glass` | Glass | 750 | 250 | 28 |
| `chemicals` | Chemicals | 700 | 220 | 26 |
| `paper` | Paper | 800 | 300 | 34 |
| `electronics` | Electronics | 600 | 180 | 18 |
| `machinery` | Machinery | 500 | 150 | 16 |
| `refined_fuel` | Refined fuel | 850 | 300 | 45 |
| `polymers` | Polymers | 700 | 220 | 27 |
| `medicine` | Medicine | 450 | 120 | 13 |
| `batteries` | Batteries | 500 | 150 | 15 |
| `crude_oil` | Crude oil | 1000 | 420 | import-only |

## Civic facilities

From [civicCatalog.json](../../src/data/civicCatalog.json) and [civicRules.json](../../src/data/civicRules.json). Declared capacity is a base catalogue value; built area, floors, staffing and system rules determine actual service.

| Facility | Label | Base capacity | Capacity kind | Floor cap | Upgrade path |
| --- | --- | --- | --- | --- | --- |
| `townhall` | Town Hall | 90 | visitors | 4 | - |
| `library` | Public Library | 70 | visitors | 4 | museum at population 160 |
| `school` | School | 240 | students | 5 | - |
| `clinic` | Clinic | 45 | patients/day | 3 | - |
| `hospital` | Hospital | 160 | beds | 8 | - |
| `police` | Police Station | 40 | officers | 3 | - |
| `fire` | Fire Station | 24 | firefighters | 2 | - |
| `government` | Government Office | 120 | staff | 6 | - |
| `community` | Community Centre | 110 | visitors | 3 | library at population 60 |
| `postoffice` | Post Office | 60 | mail | 3 | - |
| `daycare` | Daycare Centre | 30 | children | 2 | - |
| `museum` | Museum | 90 | visitors | 4 | - |
| `conservatory` | Conservatory | 50 | pupils | 4 | - |
| `busdepot` | Bus Depot | 40 | riders | 2 | transit at population 180 |
| `courthouse` | Courthouse | 70 | staff | 4 | - |
| `shelter` | Emergency Shelter | 80 | beds | 3 | - |
| `transit` | Transit Hub | 90 | riders | 2 | - |
| `recycling` | Recycling Centre | 55 | waste | 2 | - |
| `college` | College | 180 | tertiary | 6 | - |
| `university` | University | 320 | tertiary | 8 | - |

## Landmarks

These `BUILD_LANDMARK type=` IDs come from [growth.js](../../src/simulation/growth.js). Their feasibility, footprint, population and reserve gates are implemented by that table/planner, not inferred from the label.

| Landmark type |
| --- |
| `mall` |
| `multiplex` |
| `market` |
| `stadium` |
| `hospital` |
| `campus` |
| `estate` |
| `tower` |
| `hotel` |
| `resort` |
| `station` |
| `zoo` |
| `amphitheatre` |

## Schemes and laws

Schemes from [council_schemes.json](../../src/data/council_schemes.json). Values are configured base amounts; check affordability and prerequisites at enactment.

| Scheme ID | Label | Upfront | Per day | Days | Needs | Effects |
| --- | --- | --- | --- | --- | --- | --- |
| `clean_streets` | Clean streets | 9000 | 700 | 20 | none | moodDrift: 0.004, patienceDrift: 0.01 |
| `street_party` | Street festival | 6000 | 500 | 7 | spareBeds: 1 | moodDrift: 0.02, moodTarget: 0.05 |
| `small_business_grant` | Small business grant | 14000 | 900 | 25 | none | businessRevenue: 0.12, staffPay: 0.05 |
| `winter_relief` | Winter relief fund | 8000 | 1100 | 18 | strained: true | resourceBuffer: 0.35, moodDrift: 0.008 |
| `settler_campaign` | Settler recruitment drive | 16000 | 1200 | 22 | spareBeds: 6 | immigrationPull: 0.22, moodDrift: 0.004 |
| `night_shift` | Night shift | 12000 | 1000 | 15 | unemployment: 0.08 | emigrationPull: -0.5, moodTarget: -0.02, staffingFloor: 0.25 |
| `workforce_training` | Workforce training | 12000 | 900 | 35 | unemployment: 0.08 | trainingCapacity: 2 |
| `housing_push` | Housing push | 22000 | 1400 | 30 | spareBeds: 0 | buildCost: -0.12, buildHours: -0.15 |
| `research_grant` | Research grant | 20000 | 1600 | 40 | none | researchRate: 0.5 |
| `low_spending` | Economy drive | 4000 | 250 | 14 | treasury: 0 | spendingScale: -0.15, taxScale: 0.1 |

Law IDs from [policy.js](../../src/simulation/policy.js); laws use the declared policy effect path.

| Law ID | Label |
| --- | --- |
| `right_to_roofs` | Right to roofs |
| `living_wage` | Living wage |
| `green_belt` | Green belt |
| `market_levy` | Market levy |
| `open_borders` | Open borders |
| `charter` | Research charter |

## Vehicle types

From [vehicleCatalog.json](../../src/data/vehicleCatalog.json). Dimensions below are unscaled catalogue values. Global render/body scale is 0.68; some types also declare their own scale. Availability/procurement is separate from weighted vehicle appearance.

| Type | Role | Unit | Length | Width | Height | Speed factor |
| --- | --- | --- | --- | --- | --- | --- |
| `sedan` | civilian | - | 3.3 | 1.6 | 1.35 | 1 |
| `hatchback` | civilian | - | 2.9 | 1.5 | 1.3 | 0.96 |
| `taxi` | civilian | - | 3.3 | 1.6 | 1.35 | 1.05 |
| `van` | civilian | - | 3.6 | 1.75 | 1.95 | 0.9 |
| `pickup` | civilian | - | 3.6 | 1.72 | 1.6 | 0.94 |
| `sport` | civilian | - | 3.4 | 1.62 | 1.15 | 1.35 |
| `truck` | civilian | - | 4.4 | 1.85 | 2.3 | 0.78 |
| `bus` | transit | Bus | 5.4 | 1.95 | 2.5 | 0.72 |
| `police` | emergency | Police | 3.5 | 1.7 | 1.4 | 1.18 |
| `ambulance` | emergency | Ambulance | 4.3 | 1.9 | 2.05 | 1.1 |
| `fire` | emergency | Fire | 4.9 | 2 | 2.3 | 1.02 |
| `utility` | service | Utility | 3.7 | 1.8 | 1.95 | 0.92 |
| `refuse` | service | Refuse | 4.6 | 1.9 | 2.3 | 0.8 |

---

Generated by `npm run docs:generate`. Edit the source/configuration or generator, then regenerate; `npm run docs:check` detects stale tables.
