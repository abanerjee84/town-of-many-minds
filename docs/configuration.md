# Configuration and rule ownership

There are two configuration layers: browser settings for a player/run, and JSON rule files bundled with the application. Editing a rule file is a source change; it is not a server-side database update or a universal live-reload contract for existing entities.

## Browser settings

`src/core/settings.js` validates input, supplies defaults and persists the result under `tomm.settings`. Settings drive housing density, population cap, start/reset speed, Council temperature/cadence/approval cap, congestion gate, automatic Council, shadows, glow, Fit Town and camera defaults.

The [generated settings table](reference/settings.md) lists every stored key and range. Unknown keys are not a plugin mechanism. The Settings UI applies supported changes to the runtime; default reset and camera rules remain separately triggered actions.

## JSON modules

| Topic | Files |
| --- | --- |
| World and construction | `worldRules.json`, `growthRules.json`, `constructionCatalog.json`, `buildtime.json` |
| Money and industry | `economyRules.json`, `priceChart.json`, `industryCatalog.json`, `foreignInvestment.json` |
| Citizens and society | `citizenContent.json`, `lifecycleRules.json`, `societyRules.json`, `council_schemes.json`, `researchRules.json` |
| Civic/resource capacity | `civicCatalog.json`, `civicRules.json`, `resourceRules.json`, `utilityRules.json` |
| Governance and measurement | `cabinet.json`, `kpiRules.json` |
| Vehicles, operations, atmosphere | `vehicleCatalog.json`, `transportRules.json`, `incidentRules.json`, `weather.json`, `performance.json` |

The [data-file reference](reference/data-files.md) links every current JSON file and lists top-level sections and base build-hour entries. Definitions require existing consumers: adding a name to a JSON file does not implement a new production algorithm, effect key, executor or model role.

## Dynamic prices

`priceChart.js` computes a bounded multiplier around a base row. Commodity terms use stock scarcity; eligible non-commodity terms use housing pressure, congestion and fiscal pressure. The configured general factor bounds are 0.72–1.85. Import/export sides add their implemented multipliers. Quote price is distinct from a building's historical paid cost.

`priceChart.json` is the lookup for construction, land, utility expansion, primary upgrades/imports, modules, vehicles, commodities, commerce and landmarks. Some fallback values still exist in consumers; [hardcode audit](../BuildContracts/HARDCODE_AUDIT.md) records candidates rather than claiming every literal has been removed.

## Build times

`buildtime.json` stores base game-hour durations and area/floor response. The current formula is:

```text
hours = base
      × (1 + areaCoefficient × (area - 1))
      × (1 + floorCoefficient × (floors - 1))
      × clamp(1 + pressureTerm + congestionTerm + fiscalTerm,
              minFactor, maxFactor)
```

The result rounds to a tenth of a game hour. A base duration of zero remains immediate. Family/module labour estimates and final action schedules are related metadata, not interchangeable units.

## Make a rule change

1. Find the file's consumer and unit conventions before changing a coefficient.
2. Check associated catalogue IDs, upstream inputs, capacity kinds, prices, ownership and build-time keys.
3. Regenerate references with `npm run docs:generate` and validate with `npm run docs:check`.
4. Regenerate the town for a founding-rule change; do not judge it against entities already created under an old rule.
5. Run the relevant subsystem regression and record measured results in the SRS/TODO.

Independent knobs can interact: a larger population cap does not create housing, food or payroll; a lower congestion gate does not create a legal bypass; higher temperature does not waive parser or budget rules.
