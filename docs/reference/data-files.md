# Data-file reference

See [configuration](../configuration.md) for ownership, units and safe changes. All JSON is bundled with the client; new keys need existing consumers or implementation.

| File | Purpose | Top-level sections |
| --- | --- | --- |
| [buildtime.json](../../src/data/buildtime.json) | Base game-hour schedules and bounded pressure/area/floor terms | version, defaults, types |
| [cabinet.json](../../src/data/cabinet.json) | Department remits, prompt focus, intents, priority mix and Mayor caps | version, motionsPerSitting, priorityMix, mayor, departments |
| [citizenContent.json](../../src/data/citizenContent.json) | Names, hobbies, traits, occupations and job requirements | version, firstNames, lastNames, hobbies, catchphrases, quirks, traits, jobs, jobRequirements |
| [civicCatalog.json](../../src/data/civicCatalog.json) | Facility visual and base capacity specifications | version, catalogue |
| [civicRules.json](../../src/data/civicRules.json) | Capacity kinds, vertical caps and civic transitions | version, capacityKind, verticalCaps, upgradePaths |
| [constructionCatalog.json](../../src/data/constructionCatalog.json) | Block catalogue, family bills and module premiums | version, familyBills, modulePremium, blocks |
| [council_schemes.json](../../src/data/council_schemes.json) | Timed schemes, costs, needs and generic effect keys | schemes |
| [economyRules.json](../../src/data/economyRules.json) | Tax, pay, spending, finance/agency, municipal fees and credit rules | version, tax, wages, consumption, business, construction, projectFinance, property, municipalRevenue, credit, banking, government |
| [foreignInvestment.json](../../src/data/foreignInvestment.json) | Investors, offer gates and external project declarations | version, triggers, investors, projects |
| [growthRules.json](../../src/data/growthRules.json) | Progression/priority gates, density and planning limits | version, districtStepPatienceSeconds, maxBridgeGap, roadUpgradeRung, extendStreetTiles, utilityReserve, maxActiveProjects, edgeRing, annexSurveyDiscount, civicDemand, buildFloor, housePressureGate, houseSpareBeds, fillerPressureGate, skyscraperFloors, floorLadder, unemploymentGate, unemploymentPercent, unemploymentPriorityGate, unemploymentRemedyGate, officePerPopulation, officeMinPopulation, districtFloor, civicPerPopulation, parksPerPopulation, congestionGate, roadEmergencyGate, civicLoadGate, housingBootstrapPressure, priorityBands |
| [incidentRules.json](../../src/data/incidentRules.json) | Incident spawn/response and scene time windows | version, timeouts, spawnWindows, respawnWindows, sceneWindows, clearChance |
| [industryCatalog.json](../../src/data/industryCatalog.json) | Factory types, commodity inventories, recipes and production rates | version, materials, factorySizes, factoryTypes, commodities, importMultiplier, exportMultiplier, capacity, initial, rate, referenceCapacity, minStaffedUtilization, inputs, labels, strainGate |
| [kpiRules.json](../../src/data/kpiRules.json) | Retained observations and UI scoring targets | version, retention, targets |
| [lifecycleRules.json](../../src/data/lifecycleRules.json) | Ages, education/housing admission, arrivals and campaigns | version, age, housing, maxArrivals, yearsPerDay, campaign |
| [performance.json](../../src/data/performance.json) | Render/agent/UI budgets, geometry, caches and retries | version, ui, render, agents |
| [priceChart.json](../../src/data/priceChart.json) | Base money prices and bounded market response coefficients | version, description, defaults, construction, land, utility, resourceUpgrade, resourceImport, module, vehicle, commodity, commerce, landmark |
| [researchRules.json](../../src/data/researchRules.json) | Research buckets and applied improvement levers | version, buckets, levers |
| [resourceRules.json](../../src/data/resourceRules.json) | Primary site footprints, levels, output, storage and planning | version, siteFootprints, output, agricultureTiers, tierRectangles, storage, storehouse, baseStorage, planning, vehicleFuelPerDay, imports |
| [societyRules.json](../../src/data/societyRules.json) | Neighbourhoods, mood, crime, elections and retention | version, neighbourhoodNames, defaults, law, mood, crime, election, retention |
| [transportRules.json](../../src/data/transportRules.json) | Vehicle economics, transit demand, service coverage and fleet caps | version, vehicleFinance, publicTransport, serviceCoverage, fleet |
| [utilityRules.json](../../src/data/utilityRules.json) | Distribution-network cost, capacity, demand and placement patterns | version, expansionCost, ratings, edgePatterns, capacity, demand |
| [vehicleCatalog.json](../../src/data/vehicleCatalog.json) | Body dimensions, role/type declarations, speed and spawn weights | version, scale, types |
| [weather.json](../../src/data/weather.json) | Season lengths, state pools and demand/yield/traffic/mood modifiers | version, daysPerSeason, seasons, states |
| [worldRules.json](../../src/data/worldRules.json) | Plate extent, founding layout range and floor ceilings | version, extent, foundingCore, foundingMaxFloors, maxFloors |

## Base build hours

These are base game hours, not final durations. Area, height, pressure, congestion, fiscal terms and applicable policy can change eligible quotes.

| Plan/type | Base hours | Area coefficient | Floor coefficient |
| --- | --- | --- | --- |
| `house` | 16 | 0.12 | 0.22 |
| `shop` | 20 | 0.1 | 0.18 |
| `civic` | 32 | 0.1 | 0.16 |
| `clinic` | 28 | 0.09 | 0.14 |
| `school` | 48 | 0.1 | 0.14 |
| `college` | 72 | 0.09 | 0.14 |
| `university` | 96 | 0.08 | 0.12 |
| `library` | 28 | 0.08 | 0.12 |
| `museum` | 40 | 0.08 | 0.12 |
| `community` | 24 | 0.08 | 0.12 |
| `busdepot` | 30 | 0.1 | 0.1 |
| `transit` | 42 | 0.1 | 0.12 |
| `recycling` | 36 | 0.1 | 0.1 |
| `factory` | 18 | 0.14 | 0.2 |
| `office` | 26 | 0.1 | 0.18 |
| `park` | 8 | 0.05 | 0 |
| `road` | 0 | 0 | 0 |
| `roadup` | 0 | 0 | 0 |
| `utility` | 12 | 0.08 | 0 |
| `footway` | 0 | 0 | 0 |
| `prop-tree` | 3 | 0 | 0 |
| `prop-lamp` | 4 | 0 | 0 |
| `upgrade` | 12 | 0 | 0.24 |
| `archetype` | 24 | 0.12 | 0.2 |
| `renovate` | 6 | 0 | 0.12 |
| `tierup` | 10 | 0 | 0.1 |
| `wing` | 14 | 0.12 | 0 |
| `resource` | 12 | 0.08 | 0 |
| `plaza` | 6 | 0.06 | 0 |
| `parking` | 2 | 0.04 | 0 |
| `rezone` | 0 | 0 | 0 |
| `upzone` | 0 | 0 | 0 |
| `clear` | 0 | 0 | 0 |
| `annex` | 0 | 0 | 0 |
| `bridge` | 12 | 0.1 | 0 |
| `district` | 0 | 0 | 0 |
| `mall` | 60 | 0.08 | 0.12 |
| `multiplex` | 44 | 0.08 | 0.12 |
| `market` | 36 | 0.08 | 0.12 |
| `stadium` | 80 | 0.06 | 0.1 |
| `hospital` | 72 | 0.1 | 0.15 |
| `campus` | 90 | 0.08 | 0.12 |
| `estate` | 54 | 0.1 | 0.12 |
| `tower` | 96 | 0.1 | 0.16 |
| `hotel` | 56 | 0.09 | 0.14 |
| `resort` | 84 | 0.08 | 0.12 |
| `station` | 70 | 0.1 | 0.12 |
| `zoo` | 64 | 0.06 | 0 |
| `amphitheatre` | 50 | 0.06 | 0 |

## Base price lookup

These are dollar-denominated base rows, not final invoices, daily spending or current market quotes. Extra row fields are listed exactly as configured.

| Price key | Base | Other row fields |
| --- | --- | --- |
| `construction.house` | 9000 | elasticity: 0.18, pressure: 0.18 |
| `construction.shop` | 11000 | elasticity: 0.22, pressure: 0.16 |
| `construction.civic` | 30000 | elasticity: 0.16, pressure: 0.1 |
| `construction.factory` | 26000 | elasticity: 0.28, pressure: 0.12 |
| `construction.prop-tree` | 100 | elasticity: 0.08 |
| `construction.prop-lamp` | 350 | elasticity: 0.1 |
| `construction.road` | 2000 | elasticity: 0.2, congestion: 0.32 |
| `construction.footway` | 600 | elasticity: 0.1 |
| `construction.upgrade` | 6000 | elasticity: 0.18, pressure: 0.12 |
| `construction.archetype` | 12000 | elasticity: 0.22, pressure: 0.12 |
| `construction.renovate` | 4500 | elasticity: 0.16 |
| `construction.tierup` | 9000 | elasticity: 0.2, pressure: 0.12 |
| `construction.wing` | 7000 | elasticity: 0.18, pressure: 0.1 |
| `construction.park` | 3000 | elasticity: 0.12 |
| `construction.plaza` | 4000 | elasticity: 0.14 |
| `construction.parking` | 1200 | elasticity: 0.12 |
| `construction.bridge` | 3500 | elasticity: 0.2, congestion: 0.16 |
| `construction.office` | 2400 | elasticity: 0.22, pressure: 0.12 |
| `construction.annex` | 400 | elasticity: 0.08 |
| `construction.rezone` | 250 | elasticity: 0.08 |
| `construction.upzone` | 900 | elasticity: 0.12 |
| `construction.clear` | 1500 | elasticity: 0.1 |
| `construction.utility` | 18000 | elasticity: 0.18 |
| `land` | 650 | elasticity: 0.3, frontier: 0.18 |
| `utility.power` | 42000 | elasticity: 0.18 |
| `utility.water` | 26000 | elasticity: 0.18 |
| `utility.sewage` | 31000 | elasticity: 0.2 |
| `resourceUpgrade.water` | 90000 | elasticity: 0.22 |
| `resourceUpgrade.energy` | 70000 | elasticity: 0.22 |
| `resourceUpgrade.food` | 60000 | elasticity: 0.24 |
| `resourceUpgrade.fuel` | 50000 | elasticity: 0.24 |
| `resourceImport.water` | 10 | elasticity: 0.34 |
| `resourceImport.fuel` | 12 | elasticity: 0.38 |
| `module.ramp` | 450 | elasticity: 0.1 |
| `module.balcony` | 650 | elasticity: 0.12 |
| `module.solar-roof` | 1800 | elasticity: 0.14 |
| `module.green-roof` | 1100 | elasticity: 0.12 |
| `module.battery` | 2200 | elasticity: 0.16 |
| `module.ev-charger` | 900 | elasticity: 0.14 |
| `module.play-structure` | 700 | elasticity: 0.1 |
| `vehicle.sedan` | 18000 | elasticity: 0.18 |
| `vehicle.hatchback` | 15500 | elasticity: 0.18 |
| `vehicle.taxi` | 22000 | elasticity: 0.18 |
| `vehicle.car` | 18000 | elasticity: 0.18 |
| `vehicle.van` | 26000 | elasticity: 0.18 |
| `vehicle.pickup` | 28000 | elasticity: 0.18 |
| `vehicle.sport` | 36000 | elasticity: 0.2 |
| `vehicle.truck` | 42000 | elasticity: 0.2 |
| `vehicle.bus` | 72000 | elasticity: 0.22 |
| `vehicle.police` | 38000 | elasticity: 0.18 |
| `vehicle.fire` | 52000 | elasticity: 0.18 |
| `vehicle.ambulance` | 46000 | elasticity: 0.18 |
| `vehicle.utility` | 40000 | elasticity: 0.18 |
| `vehicle.refuse` | 44000 | elasticity: 0.18 |
| `commodity.lumber` | 48 | capacity: 900, elasticity: 0.58 |
| `commodity.steel` | 64 | capacity: 850, elasticity: 0.62 |
| `commodity.cement` | 40 | capacity: 850, elasticity: 0.55 |
| `commodity.goods` | 36 | capacity: 900, elasticity: 0.42 |
| `commodity.cloth` | 44 | capacity: 800, elasticity: 0.4 |
| `commodity.software` | 78 | capacity: 600, elasticity: 0.34 |
| `commodity.furniture` | 52 | capacity: 800, elasticity: 0.42 |
| `commodity.aggregate` | 22 | capacity: 1000, elasticity: 0.5 |
| `commodity.packaged_food` | 58 | capacity: 850, elasticity: 0.48 |
| `commodity.glass` | 72 | capacity: 750, elasticity: 0.5 |
| `commodity.chemicals` | 84 | capacity: 700, elasticity: 0.46 |
| `commodity.paper` | 46 | capacity: 800, elasticity: 0.4 |
| `commodity.electronics` | 128 | capacity: 600, elasticity: 0.44 |
| `commodity.machinery` | 150 | capacity: 500, elasticity: 0.42 |
| `commodity.refined_fuel` | 92 | capacity: 850, elasticity: 0.52 |
| `commodity.polymers` | 96 | capacity: 700, elasticity: 0.46 |
| `commodity.medicine` | 210 | capacity: 450, elasticity: 0.36 |
| `commodity.batteries` | 180 | capacity: 500, elasticity: 0.4 |
| `commodity.crude_oil` | 68 | capacity: 1000, elasticity: 0.5 |
| `commerce.stall` | 4500 | elasticity: 0.16 |
| `commerce.kiosk` | 6500 | elasticity: 0.18 |
| `commerce.shop` | 8500 | elasticity: 0.2 |
| `commerce.store` | 11000 | elasticity: 0.22 |
| `landmark.mall` | 25000 | elasticity: 0.22 |
| `landmark.multiplex` | 26000 | elasticity: 0.22 |
| `landmark.market` | 18000 | elasticity: 0.18 |
| `landmark.stadium` | 28000 | elasticity: 0.16 |
| `landmark.hospital` | 32000 | elasticity: 0.18 |
| `landmark.campus` | 30000 | elasticity: 0.16 |
| `landmark.estate` | 22000 | elasticity: 0.2 |
| `landmark.tower` | 34000 | elasticity: 0.24 |
| `landmark.hotel` | 26000 | elasticity: 0.22 |
| `landmark.resort` | 30000 | elasticity: 0.2 |
| `landmark.station` | 30000 | elasticity: 0.18 |
| `landmark.zoo` | 24000 | elasticity: 0.16 |
| `landmark.amphitheatre` | 22000 | elasticity: 0.16 |

---

Generated by `npm run docs:generate`. Edit the source/configuration or generator, then regenerate; `npm run docs:check` detects stale tables.
