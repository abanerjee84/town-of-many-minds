# Land, placement and construction

## The founding town and frontier

The build plate is 100 × 100 cells. A cell spans four scene metres, so the plate spans 400 × 400 metres. `worldRules.json` defines the extent and a compact founding layout range of 22–24 by 19–21 cells. The acquired founding envelope is measured from the generated buildings, resources, public cells and roads; it is not the whole plate or a fixed 30 × 30 square.

Every eligible non-water cell inside that tight envelope is initially acquired. Empty interior land is already town land. The woodland beyond it is frontier. The acquisition ledger, rendered bounds, and camera framing have distinct purposes; [Fit Town](user-guide.md#view-the-town) reads acquired-cell bounds.

`ACQUIRE_LAND` buys fresh frontier cells through a contiguous survey and price quote. Small-site scarcity should first examine existing acquired plots and useful frontage. A large factory or producer can need acquisition because no contiguous legal footprint fits even when isolated empty cells remain. Financing, reserve protection, access and exact footprint checks still apply.

`ANNEX_EDGE` is a land-use/edge planning action, not a synonym for silently acquiring arbitrary interior cells. Visible grass does not establish that a cell is acquired, legally buildable, serviced or compatible with the requested use.

## Site eligibility

Construction uses a survey/plan/quote/start/apply path. It reserves the complete footprint and preserves the road-facing anchor through completion. Building and road mutations clear trees in their occupied cells; forest records and lumber accounting handle the clearing outcome.

Placement checks cover bounds, cell kinds, overlapping reservations, acquired ownership, network access, intended zone and special siting rules. Resource yards and agricultural plots have buffers for incompatible residential/business/civic placement. Schools, colleges and university campuses reserve catchment spacing; placing a second campus directly across the road is not treated as a free unrelated lot. Factory campuses use industrial siting and complete multi-cell footprints. Fuel pumps remain resource-accounted civic-facing sites near the town's serviced core.

Some specialist regression fixtures override siting constraints to isolate another system. They do not define normal Council eligibility.

## Capacity and growth

Residential beds scale with **footprint cells × floors × residents per tile per floor**. At the default density, a one-cell three-floor home holds nine residents. A gated residential community is also available as a larger catalogue block, through ordinary housing or `IMAGINE_ARCHETYPE`.

Commercial, civic and industrial capacity and staffing scale with their building definitions, horizontal area and height. A wing adds occupied cells and usable capacity; a vertical upgrade adds a floor subject to type limits and zoning. A capacity number is not actual occupancy or actual staff: admission, hiring, education, payroll and service operation remain separate constraints.

The shared global floor ceiling is 20. Founding buildings are capped at two floors. Civic facilities have lower type-specific ceilings: for example, recycling and bus depots are capped at two, clinics at three and hospitals at eight. `civicRules.json` also defines facility transitions such as community → library, library → museum and bus depot → transit hub at population milestones.

| Action | What changes |
| --- | --- |
| `UPGRADE_BUILDING` | Adds a legal floor to a selected eligible building |
| `WING` | Extends an eligible building horizontally on an available adjoining footprint |
| `RENOVATE` | Improves the budget/quality tier |
| `TIERUP` | Advances a commercial tier while preserving its building site |
| `UPZONE` | Raises the permitted density of selected land |
| `RESTRUCTURE_BUILDING` | Performs a validated occupied-building reconfiguration |
| `CLEAR_LOT` | Clears a selected site through the demolition/accounting path |

Progression is measured and constrained, not a guarantee that a particular day produces a skyscraper. Congestion, finance, resources, labour and available land can delay it.

## Catalogue and archetypes

The construction palette reads `constructionCatalog.json`: stable block IDs, kit ownership, footprints and named modules. Families supply bills and labour requirements; accessible ramps, balconies, solar roofs, green roofs and other modules add their configured premiums.

`IMAGINE_ARCHETYPE` composes supported blocks and style parameters. It requires a `block` or valid civic `facility` and honours the same acquired land, placement, finance and capacity rules. It does not execute generated JavaScript or accept arbitrary 3D geometry from an LLM.

Examples of parser inputs:

```text
INTENT: DEVELOP_HOUSING block=house.gated.community
INTENT: DEVELOP_HOUSING program=social_housing
INTENT: IMAGINE_ARCHETYPE block=house.gated.community floors=3 accessible=true
INTENT: BUILD_CIVIC facility=college
INTENT: BUILD_FACTORY type=cement
```

The current report must still name a feasible site/design. An example demonstrates syntax, not automatic availability at the founding population. Consult [catalogue reference](reference/catalogues.md) for exact IDs.

## Prices, schedules and completion

`priceChart.json` supplies base prices and bounded market responses. `buildtime.json` supplies base game-hour durations and area/floor factors. Current housing pressure, congestion and fiscal pressure modify eligible quotes. Materials, labour and module bills are included through their existing consumers; a base value alone is not the final project bill.

Starting a project reserves its site/target and schedules its completion. Work already in progress suppresses duplicate upgrades. Failure at a real mutation rolls back through the project/kit transaction path; the decision ledger distinguishes started, done, blocked and rolled-back outcomes.

Primary resource sites have levels and footprint growth rather than unlimited building floors. Food producers begin at 7 × 4 cells and can grow to 8 × 5 and 9 × 6 tiers. At a capped or occupied site, further capacity needs a new legal producer rather than another nonexistent vertical upgrade.

Sources: [growth](../src/simulation/growth.js), [placement pipeline](../src/placement/pipeline.js), [site rules](../src/placement/siteRules.js), [perimeter ledger](../src/simulation/perimeter.js), and [data reference](reference/data-files.md).
