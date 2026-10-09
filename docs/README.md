# TOMM documentation

These guides describe the checked-in implementation. Numeric reference tables come from source files and can be regenerated with `npm run docs:generate`.

## Using the simulator

| Guide | Contents |
| --- | --- |
| [Getting started](getting-started.md) | Installation, local model server, first run, verification |
| [User guide](user-guide.md) | Camera, ribbon tools, inspectors, resource/storehouse panels, settings |
| [Council](council.md) | Minister remits, synthesis, Mayor review, provider adapter, correction and learning |
| [World and construction](world-construction.md) | Acquired land, placement, footprints, housing, civic progression, archetypes |
| [Economy and employment](economy-employment.md) | Money flows, public/private agency, jobs, training, production, FDI |
| [Industry demand](industry-demand.md) | Commodity customers, supply chains, shared ranking, restoration and factory expansion |
| [Mobility](mobility.md) | Congestion windows, network planning, roads, parking, buses and response fleets |
| [Society and environment](society-environment.md) | Mood, approval, elections, crime, policies, resources, weather, forests |
| [Evaluation and exports](evaluation.md) | KPI formulas and caveats, benchmarks, MapNow legend and saves |

## Changing or hosting it

- [Architecture and runtime](architecture.md)
- [Configuration and rule ownership](configuration.md)
- [Kit contracts and extension paths](kits.md)
- [Testing and regression selection](testing.md)
- [Deployment](deployment.md)
- [Troubleshooting and known limitations](troubleshooting.md)
- [Contributing](../CONTRIBUTING.md)

## Reference

- [Every setting and its default](reference/settings.md)
- [Canonical intents, plan routes and Cabinet ownership](reference/intents.md)
- [Construction blocks, factories, civic facilities and schemes](reference/catalogues.md)
- [JSON rule files and base build times](reference/data-files.md)
- [Every npm script](reference/scripts.md)

The [SRS](../BuildContracts/SRS.md) remains the requirement record. The [TODO](../BuildContracts/TODO.md) retains earlier investigations and open work; this folder is the usage and implementation guide.
