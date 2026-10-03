# Runtime hardcode audit

Updated 2026-10-03 after the dynamic price/build-time pass.

This inventory tracks values that change balance, progression, simulation cadence, service coverage, or content. It does not ask to move every number out of JavaScript: enum IDs, parser vocabulary, algorithmic invariants, test fixtures, and the dimensions of one authored mesh are clearer in code. The machine-readable source is [hardcode-catalog.json](C:/Users/abhi/Downloads/TOWN3/BuildContracts/hardcode-catalog.json).

Already externalized:

- `src/data/priceChart.json`: construction, land, vehicles, commodities, commerce, utility, module, and landmark pricing.
- `src/data/buildtime.json`: project base hours and bounded timing factors.
- `src/data/council_schemes.json`: Council schemes and policy effects.
- `src/data/weather.json`: seasons, weather selection weights, temperatures, and simulation modifiers. This extraction is included in the current pass.

The highest-value remaining candidates are:

| Priority | Current source | Hardcoded groups | Candidate data module | Why it should move |
| --- | --- | --- | --- | --- |
| P0 | `src/simulation/industry.js` | Factory types, sizes, recipes, inputs, rates, capacities, initial stock, import/export multipliers, strain gate | `industryCatalog.json` | Factory balance and commodity progression can change without editing production algorithms. |
| P0 | `src/kits/constructionBlocks.js` | Block definitions, footprints, modules, family bills, module premiums | `constructionCatalog.json` | The palette and Council already consume this as a shared catalogue; the remaining bills should become data too. |
| P0 | `src/simulation/growth.js` | Road lengths, land reserve, active-project cap, housing/service/traffic gates, civic ratios, office and skyline thresholds | `growthRules.json` | These values decide when the Council builds, acquires land, extends roads, adds services, and reaches a metropolis. |
| P0 | `src/simulation/economicConfig.js` | Tax, wages, developer capital, credit, reserve, runway, construction shares | `economyRules.json` | Fiscal scenarios and difficulty need one versioned balance contract. |
| P0 | `src/kits/civic/civicKit.js` | Facility capacities, footprints, vertical caps, and same-parcel upgrade paths | `civicCatalog.json` | Civic progression is content data and should be extensible without changing the renderer. |
| P0 | `src/simulation/lifecycle.js` | Age bands, housing fill, migration pulls, arrival cap, campaign cost/duration/multiplier | `lifecycleRules.json` | Demographic growth and settlement scenarios are tunable rules. |
| P0 | `src/kits/resources/resourceKit.js` | Farm sizes, production, storage, site spacing, import limits, and upgrade ceilings | `resourceRules.json` | Resource scarcity and land pressure are currently controlled by a large embedded table. |
| P1 | `src/kits/resources/resourceKit.js`, `src/kits/utilities/utilityKit.js` | Resource ratings, site levels, expansion costs, production and demand coefficients | `resourceRules.json`, `utilityRules.json` | Resource scarcity and utility reliability currently require source edits to rebalance. |
| P1 | `src/simulation/economy.js` | Retail tiers, property assessment, staffing units, service-ticket value, factory job coefficients | `commerceRules.json` | Commerce progression and labour demand are balance content. |
| P1 | vehicle kits and `publicTransport.js` | Vehicle dimensions/speeds, state fleet roster, bus ratio, coverage multiplier | `vehicleCatalog.json`, `transportRules.json` | Vehicle physics and public-service coverage should share one contract. |
| P1 | `src/simulation/vehicleRegistry.js` | Vehicle entitlement, value bounds, depreciation, upkeep, rent, emergency coverage ratios | `transportRules.json` | Fleet finance and service coverage should not be tuned in a separate table from vehicle content. |
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
