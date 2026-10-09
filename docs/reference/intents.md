# Intent reference

61 canonical intents are declared by [built-in kit routes](../../src/kits/builtinManifests.js) and consumed through [actionRegistry.js](../../src/simulation/actionRegistry.js). The Cabinet column comes from [cabinet.json](../../src/data/cabinet.json). A dash means no explicit default Cabinet ownership; the legacy parser/diagnostic route remains declared. Shared ownership is shown explicitly.

These are descriptions and syntax, not availability guarantees. Current report evidence, ownership, financing, placement and parameter validation still apply. See [Council flow](../council.md).

| Intent | Plan route | Default Cabinet | Function / parameters |
| --- | --- | --- | --- |
| `ACQUIRE_LAND` | `land` | land | Acquire an eligible contiguous frontier parcel; preserve serviced-plot discipline |
| `ADD_PARKING` | `parking` | infrastructure | Add eligible kerbside parking |
| `ANNEX_EDGE` | `annex` | land | Apply eligible edge land-use planning; zone=&lt;zone id&gt; |
| `APPROVE_CONCESSION` | direct | treasury | Approve an eligible foreign offer; optional offerId=&lt;offer id&gt; |
| `ATTRACT_SETTLERS` | direct | - | Promote settlement within housing/resource/admission constraints |
| `BOND_ISSUE` | direct | treasury | Raise eligible public finance with debt obligations |
| `BUILD_BRIDGE` | `bridge` | infrastructure | Connect a legal water gap |
| `BUILD_CIVIC` | `civic` | services, society | Build a public facility; facility=&lt;civic id&gt; when named in evidence |
| `BUILD_DISTRICT` | `district` | land | Plan the existing measured district growth chain |
| `BUILD_FACTORY` | `factory` | treasury | Build a named works; type=&lt;factory id&gt; |
| `BUILD_LANDMARK` | `landmark` | services, society | Commission a milestone structure; type=&lt;landmark id&gt; |
| `BUILD_OFFICE` | `office` | treasury | Refer office/service capacity; optional name and floors |
| `BUILD_TRANSIT` | `civic` | infrastructure | Commission transit/depot civic capacity; facility=transit\|busdepot |
| `CLEAR_LOT` | `clear` | land | Demolish/clear an eligible site with account and occupancy checks |
| `CUT_TAX` | direct | treasury | Reduce the tax policy multiplier |
| `DECLARE_EMERGENCY` | direct | services | Set emergency policy/response state |
| `DEVELOP_HOUSING` | `house` | land | Refer housing demand to developers; optional block=&lt;housing id&gt;, program=social_housing for public housing |
| `DISPATCH_UNITS` | direct | services | Respond to current incidents with available units |
| `ENACT_SCHEME` | direct | society | Start a timed scheme; scheme=&lt;scheme id&gt; |
| `END_SCHEME` | direct | society | End an active scheme; scheme=&lt;scheme id&gt; |
| `EXPAND_CLINIC` | `civic` | - | Legacy civic-capacity expansion route |
| `EXPAND_LANDMARK` | `wing` | - | Annex an existing landmark; type=&lt;landmark id&gt; |
| `EXPAND_POWER` | `power` | services | Expand power network capacity |
| `EXPAND_SEWAGE` | `sewage` | services | Expand sewage network capacity |
| `EXPAND_WATER` | `water` | services | Expand water network capacity |
| `EXTEND_FOOTWAY` | `footway` | infrastructure | Add a legal walking access link |
| `EXTEND_STREET` | `road` | infrastructure | Evaluate and add a useful legal road run |
| `FUND_INNOVATION` | direct | treasury | Fund the measured research programme |
| `HIRE_WORKERS` | direct | treasury | Recruit for measured fundable staff vacancies, not generic unemployment |
| `HOST_EVENT` | direct | society | Commission a supported civic event |
| `IMAGINE_ARCHETYPE` | `archetype` | society | Compose a supported catalogue design; block=&lt;id&gt; or facility=&lt;id&gt; required |
| `INSTALL_LAMP` | `prop-lamp` | society | Add a lighting prop |
| `KEEP_TAX` | direct | - | Retain current tax policy |
| `NO_ACTION` | direct | society | Explicitly take no public action |
| `OPEN_SHOP` | `shop` | treasury | Refer viable retail demand; optional tier=&lt;commerce rung&gt; |
| `PARK_LAND` | `park` | society | Create parkland |
| `PASS_LAW` | direct | society | Enact a supported statute; law=&lt;law id&gt; |
| `PAVE_PLAZA` | `plaza` | society | Create a civic square |
| `PLANT_TREES` | `prop-tree` | society | Plant eligible foliage |
| `RAISE_TAX` | direct | treasury | Raise the configured tax policy multiplier |
| `RENOVATE` | `renovate` | society | Improve quality; optional budget=1..3 |
| `REPEAL_LAW` | direct | society | Remove a supported active statute; law=&lt;law id&gt; |
| `RESTRUCTURE_BUILDING` | `restructure` | land | Reconfigure eligible occupied built capacity |
| `REZONE` | `rezone` | land | Change eligible land use; zone=residential\|commercial\|industrial\|civic\|park |
| `SET_ASIDE_RESERVE` | direct | treasury | Allocate fiscal reserve under existing guards |
| `SLASH_SPENDING` | direct | treasury | Reduce eligible spending scale |
| `SOLICIT_FDI` | direct | treasury | Solicit eligible foreign-investment offers |
| `STUDY_DEMOGRAPHICS` | direct | land | Inspect population/housing evidence |
| `STUDY_ECONOMY` | direct | treasury | Inspect fiscal/market evidence |
| `STUDY_INCIDENTS` | direct | services | Inspect current incident evidence |
| `STUDY_ROAD` | direct | infrastructure | Inspect road evidence without a construction commitment |
| `STUDY_TRAFFIC` | direct | infrastructure | Inspect congestion/mobility evidence |
| `SUBSIDY` | direct | treasury | Apply the existing business-support spending path |
| `TIERUP` | `tierup` | society | Advance a commercial rung; optional tier |
| `TRADE_BUY` | direct | treasury | Import a commodity; commodity=&lt;commodity id&gt;, qty=1..200 |
| `TRADE_SELL` | direct | treasury | Export a commodity; commodity=&lt;commodity id&gt;, qty=1..200 |
| `UPGRADE_BUILDING` | `upgrade` | land | Add an eligible floor within owner/type/zoning constraints |
| `UPGRADE_RESOURCE` | `resource` | services | Upgrade/add resource capacity; resource=water\|energy\|food\|fuel, optional eligible kind |
| `UPGRADE_ROAD` | `roadup` | infrastructure | Upgrade eligible corridor class; optional class=&lt;road class&gt; |
| `UPZONE` | `upzone` | land | Raise permitted density |
| `WING` | `wing` | land | Add a legal adjoining horizontal footprint |

---

Generated by `npm run docs:generate`. Edit the source/configuration or generator, then regenerate; `npm run docs:check` detects stale tables.
