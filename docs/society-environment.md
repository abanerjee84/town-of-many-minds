# Society, resources and environment

## Residents and civic life

Citizens have identity, household, life-stage, education, personality, needs and daily schedule state. Walking, home/work/study destinations and social interactions are simulation behaviours; the default rendered figure is a simple head and body for distant views.

Mood is built from needs, safety, services, employment/economic conditions, belonging, transport and optimism. Approval is reported separately and combines societal observations. Both appear in Council evidence so civic builds, schemes, landmarks and employment policies can respond to measured conditions.

Neighbourhoods have names and local summaries. Crime risk responds to configured economic/mood/safety terms; police, law and justice records track cases and responses. Elections run on a configured 30-day cadence with candidate and outcome history. Court throughput and neighbourhood-specific service budgeting remain extension work rather than a full legal-process simulation.

## Schools, health and public programmes

The civic catalogue covers town administration, libraries, schools, college/university, clinics/hospitals, police/fire, community/culture, post, daycare, courts, shelter, transit and recycling. Facilities have distinct capacity kinds and staffing. Education progression depends on available capacity; a college building is not merely another generic visitor hall.

Campus spacing and horizontal footprints affect placement. Service load motivates capacity growth or a new facility; type-specific floor caps prevent unlimited tower growth for small-use buildings. [Catalogue reference](reference/catalogues.md) lists every facility and cap.

Schemes define an upfront cost, daily cost, duration, preconditions and effect keys in `council_schemes.json`. Laws use the policy system's declared effect/validation path. `ENACT_SCHEME`, `END_SCHEME`, `PASS_LAW` and `REPEAL_LAW` start or stop those effects. Workforce training links the programme to employability, not just a decorative mood increase.

Research has academia, company and exploration buckets. Completed programmes affect configured resource yield, works output, staff efficiency, civic service capacity or survey rate. `FUND_INNOVATION` is a financing choice; research outcomes do not bypass the action vocabulary or physical placement.

## Primary resources and utility networks

Primary stores are water, energy, food and fuel. Resource gauges separate fill from production/demand. A near-full store can coexist with a daily deficit; a depleted store requires a supply/capacity response, not more beds by itself.

Producing sites include lake/water supply, wind and solar energy, agricultural producers and fuel works. Reservoirs, silos and batteries contribute storage; storage-only capacity does not produce daily output. Fuel dispensing and vehicle use draw real stock. Food processors also consume food through their industry recipe.

Resource crews and levels affect production. Agricultural tiers grow the yard horizontally. Site caps and active reservations constrain upgrades; new sites need a complete acquired footprint and access. `UPGRADE_RESOURCE resource=food` is not the same as an arbitrary `UPGRADE_BUILDING` floor.

Water, power and sewage distribution have network capacity and demand. `EXPAND_SEWAGE` expands the sewage utility network through its utility plan; it does not create a new factory or magically refill food. Waste/recycling uses its service capacity and flow accounting. Resource/utility construction changes have visible site/network feedback.

## Seasons and visible weather

Each season lasts 30 game days by default. Spring, summer, autumn and winter select from clear, cloudy, rain, storm, heatwave and snow states using the weather configuration. Temperature/precipitation feed the UI and rendering.

Weather modifies food yield, energy/water demand, traffic and mood through explicit coefficients. The scene has day/night lighting, sky and distance fog plus precipitation effects; these are visual and model-state effects rather than meteorological simulation. Shadows are off by default and can be enabled in Settings.

## Woodland and lumber

The plate contains sparse interior/decorative foliage and a denser irregular woodland belt near the initial town edge. Tree and forest records support natural fall, clearing/deforestation and planting. Roads, construction and clearing use those records to remove obstructing foliage and account for lumber effects.

`PLANT_TREES` and manual trees are deliberate interventions; new woodland does not imply land acquisition. A visually forested frontier can still be unavailable to construction until the Council acquires it. The foliage kit supplies reusable tree/pine/bush geometry and rendering budgets.

Sources: [society](../src/simulation/society.js), [lifecycle](../src/simulation/lifecycle.js), [policy](../src/simulation/policy.js), [weather](../src/simulation/weather.js), [forest](../src/simulation/forest.js), [resource kit](../src/kits/resources/resourceKit.js), [utility kit](../src/kits/utilities/utilityKit.js).
