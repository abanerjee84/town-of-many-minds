# Runtime hardcode audit

Updated 2026-10-03 after the dynamic price/build-time pass.

This inventory tracks values that change balance, progression, simulation cadence, service coverage, or content. It does not ask to move every number out of JavaScript: enum IDs, parser vocabulary, algorithmic invariants, test fixtures, and the dimensions of one authored mesh are clearer in code. The machine-readable source is [hardcode-catalog.json](C:/Users/abhi/Downloads/TOWN3/BuildContracts/hardcode-catalog.json).

Already externalized:

- `src/data/priceChart.json`: construction, land, vehicles, commodities, commerce, utility, module, and landmark pricing.
- `src/data/buildtime.json`: project base hours and bounded timing factors.
- `src/data/council_schemes.json`: Council schemes and policy effects.
- `src/data/weather.json`: seasons, weather selection weights, temperatures, and simulation modifiers. This extraction is included in the current pass.
- `src/data/industryCatalog.json`: factory sizes, recipes, production rates, capacities, initial stock, and trade multipliers.
- `src/data/economyRules.json`: tax, wages, credit, reserve, developer funding, and fiscal runway rules.
- `src/data/lifecycleRules.json`: age bands, housing fill, migration pulls, arrival limits, and campaign parameters.
- `src/data/growthRules.json`: land, road, housing, civic, office, congestion, and skyline gates.
- `src/data/resourceRules.json`: resource footprints, agriculture tiers, storage, spacing, site caps, and import limits.
- `src/data/constructionCatalog.json`: shared block IDs, footprints, modules, and placement roles.
- `src/data/civicRules.json`: civic capacity kinds, vertical caps, and same-parcel upgrade paths.
- `src/data/civicCatalog.json`: authored civic massing, finish, capacity, and facility presentation data.
- `src/data/vehicleCatalog.json` and `src/data/transportRules.json`: vehicle dimensions, public-transport thresholds, fleet roster, finance, and emergency coverage ratios.

The highest-value remaining candidates are:

| Priority | Current source | Hardcoded groups | Candidate data module | Why it should move |
| --- | --- | --- | --- | --- |
| P0 | `src/kits/constructionBlocks.js` | Family bills, module premiums | `constructionCatalog.json` | The block catalogue is externalized; bills remain the last construction balance table to move. |
| P0 | `src/kits/civic/civicKit.js` | Facility capacity/footprint catalogue | `civicRules.json` | Capacity maps and progression are externalized; the large authored facility table remains. |
| P1 | `src/kits/resources/resourceKit.js`, `src/kits/utilities/utilityKit.js` | Resource ratings, site levels, expansion costs, production and demand coefficients | `resourceRules.json`, `utilityRules.json` | Resource scarcity and utility reliability currently require source edits to rebalance. |
| P1 | `src/simulation/economy.js` | Retail tiers, property assessment, staffing units, service-ticket value, factory job coefficients | `commerceRules.json` | Commerce progression and labour demand are balance content. |
| P1 | `src/kits/vehicles/fleetKit.js` | Remaining fleet presentation rules | `transportRules.json` | The fleet roster and cap are externalized; geometry remains kit-owned. |
| P1 | `society.js`, `incidents.js` | Neighbourhood names, mood weights, crime risk, election cadence, incident timeouts | `societyRules.json`, `incidentRules.json` | Social policy and emergency response are user-visible simulation rules. |
| P1 | `roadExtensionPlanner.js`, `placementController.js` | Trip sample thresholds, hotspot pressure, block dimensions, industrial edge, link limits | `roadRules.json` | These thresholds decide whether a street is evidence-backed and where it may connect. |
| P1 | `traffic.js`, `core/signals.js` | Collision margins, congestion sampling, fuel patience, parking waits, signal phases | `trafficRules.json` | These values alter driving stability, jams, stranded vehicles, and junction behavior. |
| P1 | `governance.js` | Council cadence, provider timeout/failure limits, temperature, prompt budget | `councilRules.json` | Provider experiments and Council scheduling need a versioned runtime contract. |
| P2 | `core/config.js`, road cross-sections | World extent, founding envelope, speed options, palette, road widths and offsets | `worldRules.json`, `theme.json` | Useful for scenario packs and visual themes, but more compatibility-sensitive. |
| P2 | citizen kits | Jobs, wages, skills, education labels, names, traits, hobbies, transport preferences | `citizenCatalog.json` | Enables culture and labour-market scenarios without changing lifecycle code. |
| P2 | `innovation.js`, `councilLearning.js` | Research buckets/levers, bottleneck weights, learning limits and aging | `researchRules.json` | Provider-comparison experiments need reproducible research settings. |
| P2 | `forest.js`, `streetGlow.js`, foliage kit | Timber yield, glow duration/intensity, pulse values, foliage variants | `vegetationRules.json`, `visualEffects.json` | Visual and ecological tuning should be editable without changing the renderer. |

Recommended extraction order:

1. Move the P0 catalogues into JSON with schema validation and preserve the existing exported APIs as read-only adapters.
2. Add chart versions to the Council evidence report and replay snapshots, as already done for price and build time.
3. Add one audit per catalogue that checks IDs, references, numeric bounds, and deterministic fallback behavior.
4. Move P1 service and social rules, then P2 world/theme/content packs after replay fixtures exist.

The weather extraction establishes the intended pattern: JSON owns data, the simulation module owns validation and behavior, and consumers keep importing the same named API. This avoids a broad rewrite while making balance changes inspectable and provider-comparison runs reproducible.
