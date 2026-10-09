# Controls and panels

## View the town

Use mouse orbit and scroll-wheel zoom. Right-drag pans the camera target. The vertical camera toolbar provides orbit and tilt increments, zoom, a one-shot fit, stored home values, and ISO, TOP, N and E presets.

The centered readout above the ribbon shows yaw, tilt, camera distance, and target X/Z. Tilt is the polar angle from overhead: 0° is top-down. Zoom is camera-to-target distance in scene metres, not a browser zoom percentage.

**Fit Town** is a persistent toggle, enabled by default. It frames the acquired-cell bounds on land changes and every three game hours. Rectangular framing can include unacquired gaps between irregular acquired edges; it does not frame the entire 100 × 100 plate. Switch it off to retain a manual composition. The home button restores the camera values in Settings.

The performance readout shows measured foreground FPS, achieved calendar speed and agent-time lag. Lag reports the bounded traffic/agent budget; it is separate from road congestion.

## Bottom ribbon

| Tool | Effect |
| --- | --- |
| Inspect | Select a citizen, vehicle, building, resource, road or plot |
| Road | Paint road cells and rebuild connections and sidewalks |
| Footway | Request a walking connection toward a street |
| Bulldoze | Remove the selected building, road, public cell or prop |
| House | Build housing on an eligible road-accessible site |
| Factory | Commission an industrial footprint through placement checks |
| Park | Convert a cell to parkland |
| Tree / Lamp | Place foliage or night-lighting props |
| Stop | Place or remove a bus stop on a road |
| + Car / + Citizen | Add a vehicle/driver or admit a resident when the relevant limits permit |

Manual tools are experiment interventions, not Cabinet proposals. Their placement and economic effects should be recorded when comparing model runs.

Pause and speed buttons control the calendar. Default reset speed is 100×. Regeneration uses the seed input; Reset restores the run using its reset path and defaults. Neither is a save-game loader. The Settings cog opens a searchable, vertically scrollable modal with Simulation, Council, Visuals and Camera sections.

## Read the panels

The **left panel** contains population, households, buildings, vehicles, roads, mood, treasury, taxation, unemployment, beds, debt and congestion. Primary-resource gauges show store fill; the lines below show production and usage. The separate scrollable storehouse lists commodities, prices, trends and manual import/export buttons. Town chatter describes agent events.

The **clock panel** shows day, time, season and weather. Hover weather for temperature and precipitation evidence.

The **Decisions panel** shows source, canonical intent and status. The smaller department label appears below its description. `started` means a construction project began; `done` means a direct action or completed work; `blocked`, `rejected` and `mayor_deferred` explain why nothing started. Private developer responses are recorded separately.

**Council Evidence** shows current thought and bounded before/after learning evidence. **Societal Summary** shows mood, approval, crime/justice information and elections. These observations do not prove a causal effect by themselves.

The **right inspector** exposes object-specific facts and the Decisions, Trade, Palette and KPIs modals. Palette groups the shared construction catalogue with current demand/quote information. KPIs can be searched and exported as JSON.

## Settings and persistence

Defaults and ranges are listed in [settings reference](reference/settings.md). Settings persist in browser `localStorage` under `tomm.settings`. A different browser/profile/origin has a different settings store.

Population-cap reductions stop further admission; they do not delete existing residents. Housing density applies to new construction and growth rather than recreating every existing home. Camera defaults are overridden by auto-fit when Fit Town is enabled. Simulation progress and provider console configuration are not automatically persisted by this settings store.
