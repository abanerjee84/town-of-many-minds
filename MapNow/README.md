# MapNow diagnostic exports

`latest.map.txt` is generated immediately before each Council sitting by the
local Vite server. It is an inspection artifact only and is deliberately not
included in Council or Cabinet provider prompts.

The map uses the `TOMM-MAP/1` format:

- a coarse acquired-town matrix;
- a legend for land use, roads, resources, and pressure;
- resource, road-graph, pressure-cell, and frontier summaries;
- high-resolution windows around measured hotspots and frontier candidates.

Run `npm run mapnow:capture` to create a snapshot manually. The generated
history under `MapNow/history/` is bounded to the most recent 48 turns.
