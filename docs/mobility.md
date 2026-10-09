# Roads, traffic and public transport

## Congestion evidence

Council decisions use a time-weighted congestion window accumulated between sittings rather than only the value at the moment a request begins. Reports expose that window along with mobility observations. The Settings slider defaults to an average-congestion gate of 0.5 (50%). It is a planning trigger, not a commanded congestion target.

Traffic tracks completed origin/destination samples and per-cell visits/delay. Visits alone indicate throughput; a hotspot needs observed delay. Unconnected trips, parked vehicles and blocked routes have distinct meanings. The foreground traffic-lag meter measures unprocessed agent time, not road congestion.

## Street extension planning

Existing road cells form a graph. Candidate runs must connect legally to existing topology, avoid occupied/water/unacquired cells under the action's eligibility rules, and pass local shape/junction checks. The evaluator models small additions without editing the live grid.

`roadExtensionPlanner.js` uses weighted shortest paths to compare trip costs before and after a candidate. Demand-weighted origin/destination relief and component joins dominate; future legal frontage/continuation provide a secondary score, while junctions impose a penalty. A distant empty loop is not useful just because paving it is cheap.

The evaluator uses up to 32 trip observations. Four completed trips are its measured detour threshold; below that, a topology join or directly observed delayed hotspot can still supply evidence. Local pressure depends on delay and delayed share, not just traffic count. These are bounded planning heuristics, not a global optimal-city solver or a guarantee of zero jams.

An extension can be rejected at high average congestion if no legal useful candidate fits the acquired land, current reservations or financing. An upgrade or land/access prerequisite can be the appropriate next action. Congestion priority does not bypass fundamental resource or budget safety checks.

## Road kit

The network renderer builds asphalt, lane markings, pavements, crossings, kerbs, signals, parking bays, cycle/median features and junction furniture from grid metadata. The palette includes multi-lane street and roundabout blocks. `UPGRADE_ROAD` changes a corridor's road class; `BUILD_BRIDGE` plans a legal water gap. A catalogue module being present does not mean that every possible geometry is automatically selected by the Council.

Footways are walking links. They can improve access to an inland parcel, but they are not drivable asphalt and do not automatically become a vehicle street on a timer. Vehicle routes use the road graph. Tree clearing must track new road cells as well as building footprints.

## Vehicles and parking

Private ownership/entitlement, money, registration and driver occupancy determine vehicle admission. Delivery/service/emergency/transit vehicles have their own roles. Bodies are scaled to the lane layout; the default simple wheel and citizen modes reduce rendering work.

Parking retains a reservation while a private trip has no valid route. Boarding and releasing the bay happen only after a route succeeds. Failed trip planning retries at a configurable cadence and invalidates on network, purpose or day changes. Vehicles, pedestrians, signals and incidents share the bounded fixed-step agent advancement path.

Traffic still uses collision, right-of-way and crossing guards. Budgeting, caching and lower-detail rendering do not authorize vehicles to drive across arbitrary free plots.

## Buses and emergency services

Transit has a civic/depot growth chain, road stops, routes and population-linked fleet demand. The public-transport defaults target one bus per 120 residents, with a maximum of eight in its planning rules. Other fleet/procurement caps and available facilities can bind first. Fare collection enters the economy ledger.

Police, ambulance and fire coverage use their population ratios and eligible station types. Facilities, staff, government finance and procurement conditions constrain additional vehicles. These operational limits are separate from a higher-level fleet demand target.

Bus stops can also be manually placed on road cells. Refuelling is a real vehicle trip/service state rather than an instant fuel refill at every stop. The strict long-run bus/refuelling fixture still reports unresolved holds/completion failure; see [known limitations](troubleshooting.md#known-limitations).

Sources: [road evaluator](../src/simulation/roadExtensionPlanner.js), [road graph](../src/core/roadGraph.js), [traffic](../src/simulation/traffic.js), [public transport](../src/simulation/publicTransport.js), [transport rules](../src/data/transportRules.json).
