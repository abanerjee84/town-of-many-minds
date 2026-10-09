# npm script reference

Run from the repository root. Browser checks generally need Vite running and `APP_URL` pointing at it; script defaults vary. See [testing](../testing.md) for selection and horizon costs.

| Command | Executable |
| --- | --- |
| `npm run dev` | `vite` |
| `npm run build` | `vite build` |
| `npm run preview` | `vite preview` |
| `npm run test:ui` | `node scripts/_ui_check.mjs` |
| `npm run test:economy` | `node scripts/_banking_check.mjs` |
| `npm run test:governor` | `node scripts/_governor_regression.mjs` |
| `npm run test:soak` | `node scripts/_simulation_soak_check.mjs` |
| `npm run test:glow` | `node scripts/_glow_regression.mjs` |
| `npm run test:resources` | `node scripts/_resource_feedback_check.mjs` |
| `npm run test:resource-land` | `node scripts/_resource_land_regression.mjs` |
| `npm run test:council-authority` | `node scripts/_council_authority_check.mjs` |
| `npm run test:council-flow` | `node scripts/_council_flow_check.mjs` |
| `npm run test:footway` | `node scripts/_footway_check.mjs` |
| `npm run test:council` | `node scripts/_council_provider_check.mjs` |
| `npm run test:council-cadence` | `node scripts/_council_cadence_check.mjs` |
| `npm run test:prompt` | `node scripts/_council_prompt_check.mjs` |
| `npm run test:kits` | `node scripts/_construction_kits_check.mjs` |
| `npm run test:metropolis` | `node scripts/_metropolis_horizon_check.mjs` |
| `npm run test:metropolis-fast` | `node scripts/_metropolis_horizon_check.mjs --fast` |
| `npm run test:road-horizon` | `node scripts/_road_horizon_check.mjs` |
| `npm run test:road-horizon-fast` | `node scripts/_road_horizon_check.mjs --fast` |
| `npm run test:road` | `node scripts/_road_extension_check.mjs` |
| `npm run test:vehicle-parking` | `node scripts/_vehicle_parking_check.mjs` |
| `npm run test:factory-site` | `node scripts/_factory_site_regression.mjs` |
| `npm run test:factory-production` | `node scripts/_factory_production_check.mjs` |
| `npm run test:industry-planning` | `node scripts/_industry_planning_check.mjs` |
| `npm run test:industry-demand` | `node scripts/_industry_demand_check.mjs && node scripts/_industry_demand_integration_check.mjs` |
| `npm run test:staffing` | `node scripts/_staffing_regression.mjs` |
| `npm run test:industry-expansion` | `node scripts/_industry_expansion_check.mjs` |
| `npm run test:society` | `node scripts/_society_transport_check.mjs` |
| `npm run test:agriculture` | `node scripts/_agricultural_setback_check.mjs` |
| `npm run test:resource-neighbour` | `node scripts/_resource_neighbour_check.mjs` |
| `npm run test:housing-growth` | `node scripts/_housing_growth_check.mjs` |
| `npm run test:perimeter` | `node scripts/_perimeter_tight_check.mjs` |
| `npm run test:land-gate` | `node scripts/_land_gate_check.mjs` |
| `npm run test:forest` | `node scripts/_forest_check.mjs` |
| `npm run test:vegetation-clear` | `node scripts/_vegetation_clear_check.mjs` |
| `npm run test:weather` | `node scripts/_weather_check.mjs` |
| `npm run test:campus` | `node scripts/_campus_spacing_check.mjs` |
| `npm run test:tourism` | `node scripts/_tourism_check.mjs` |
| `npm run test:lake` | `node scripts/_lake_check.mjs` |
| `npm run test:market-chart` | `node scripts/_market_chart_check.mjs` |
| `npm run test:intents` | `node scripts/_intent_coverage_check.mjs` |
| `npm run test:state-service` | `node scripts/_state_service_audit.mjs` |
| `npm run test:hardcode-audit` | `node scripts/_hardcode_audit_check.mjs` |
| `npm run test:kit-registry` | `node scripts/_kit_registry_check.mjs` |
| `npm run test:provider-matrix` | `node scripts/_provider_matrix_check.mjs` |
| `npm run test:transit-stop` | `node scripts/_transit_stop_check.mjs` |
| `npm run test:speed` | `node scripts/_speed_check.mjs` |
| `npm run test:bus-stuck` | `node scripts/_bus_stuck_check.mjs` |
| `npm run test:cabinet` | `node scripts/_cabinet_check.mjs` |
| `npm run test:cabinet-remedy` | `node scripts/_cabinet_remedy_check.mjs` |
| `npm run test:developer-independence` | `node scripts/_developer_independence_check.mjs` |
| `npm run test:performance` | `node scripts/_performance_check.mjs` |
| `npm run test:performance-stress` | `node scripts/_performance_stress_check.mjs` |
| `npm run test:performance-grown` | `node scripts/_grown_performance_check.mjs` |
| `npm run test:kpi` | `node scripts/_kpi_check.mjs` |
| `npm run test:citizen-render` | `node scripts/_citizen_render_check.mjs` |
| `npm run test:vehicle-render` | `node scripts/_vehicle_render_check.mjs` |
| `npm run test:fdi` | `node scripts/_fdi_check.mjs` |
| `npm run test:treasury-start` | `node scripts/_treasury_start_check.mjs` |
| `npm run test:land-funding-loop` | `node scripts/_land_funding_loop_check.mjs` |
| `npm run test:municipal-revenue` | `node scripts/_municipal_revenue_check.mjs` |
| `npm run test:fiscal-funding` | `node scripts/_fiscal_funding_check.mjs` |
| `npm run test:agency-boundary` | `node scripts/_agency_boundary_check.mjs` |
| `npm run test:service-sector` | `node scripts/_service_sector_check.mjs` |
| `npm run test:unemployment-horizon` | `node scripts/_unemployment_horizon_check.mjs` |
| `npm run test:employment-mobility` | `node scripts/_employment_mobility_check.mjs` |
| `npm run test:workforce-training` | `node scripts/_workforce_training_check.mjs` |
| `npm run test:unemployment-priority` | `node scripts/_unemployment_priority_check.mjs` |
| `npm run test:private-queue` | `node scripts/_private_queue_check.mjs` |
| `npm run test:housing-street-expansion` | `node scripts/_housing_street_expansion_check.mjs` |
| `npm run mapnow:capture` | `node scripts/_mapnow_capture.mjs` |
| `npm run test:spatial-index` | `node scripts/_spatial_index_check.mjs` |
| `npm run test:spatial-traffic` | `node scripts/_spatial_traffic_check.mjs` |
| `npm run test:performance-meter` | `node scripts/_performance_meter_check.mjs` |
| `npm run test:private-route-retry` | `node scripts/_private_route_retry_check.mjs` |
| `npm run docs:generate` | `node scripts/docs.mjs` |
| `npm run docs:check` | `node scripts/docs.mjs --check` |
| `npm run docs:preview` | `node scripts/docs-preview.mjs` |

---

Generated by `npm run docs:generate`. Edit the source/configuration or generator, then regenerate; `npm run docs:check` detects stale tables.
