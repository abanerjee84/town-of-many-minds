# Kit system and extensions

## What a kit supplies

The shared built-in `KitRegistry` exposes ownership, catalogue rows, intent-to-plan routes, capabilities and hooks. Built-in adapters cover construction, homes/commerce, industry, civic facilities, resources, utilities, roads, public spaces/props, vehicles, transport, land/planning, governance, society, forest and citizens.

Runtime metadata is shared; invocation hooks receive the current town so mutable run state stays with that town. `actionRegistry.js` derives the canonical vocabulary and project routes from registered built-in manifests. Existing renderers and specialist simulation APIs remain behind adapters where a complete rewrite was unnecessary.

| Contract/module | Purpose |
| --- | --- |
| `kitRegistry.js` | Registration/validation, ownership, dependency order, capabilities, hooks and compatibility/serialization |
| `kitContext.js` | Frozen read snapshots and scoped services for RNG, IDs, events, treasury transfers and transactions |
| `kitContracts.js` | Serializable catalogue, building, project, demand, flow, stats and renderer payloads |
| `kitTransaction.js` | Guarded mutation/commit/rollback boundary |
| `builtinManifests.js` | Current kit ownership/routes and adapters |
| `constructionBlocks.js` | Shared construction catalogue, bills, demand and quote interface |

## Manifest requirements

A manifest needs a stable lowercase ID, version string and supported `apiVersion` (currently 1). It can declare domains, dependencies, routes, plan types, zones/facilities/resources, catalogue schema/version, capabilities, operations and hooks.

Catalogue IDs must be stable and valid. Footprints are two positive integer dimensions. A kit with catalogue rows must declare builder, quote and placement capabilities and at least one plan type. Duplicate ownership/routes and unsupported versions are registration errors rather than accidental last-write wins.

Supported operations are `quote`, `demand`, `place`, `build`, `upgrade`, `inspect`. Hooks include `create`, `reset`, `generate`, `updateHour`, `updateDay`, `stats`, `serialize`, `restore`, `render`, `renderScene`, `dispose`. Declaring a capability does not automatically implement its operation.

## Small extension example

This diagnostic-only example registers a stats kit without introducing a new Council action:

```js
town.kits.register({
  id: 'observations.example',
  version: '1.0.0',
  apiVersion: 1,
  domains: ['diagnostics'],
  routes: {},
  planTypes: [],
  hooks: {
    stats: ({ context }) => ({ population: context.read.population() })
  }
});

town.kits.kitStats(town);
```

Browser registration changes the shared registry for that session. For a durable extension, add the manifest through the built-in registration path and cover its lifecycle/disposal. The action vocabulary is derived at module initialization; late registry mutation is not a general dynamic action hot-loader.

## Add a construction variant

If the existing renderer/planner supports the family, add a stable row to `constructionCatalog.json` with kit, family, footprint and supported modules. Provide relevant prices/materials/labour, capacity/staffing and an existing build-time key. Housing block IDs appear in both ordinary housing and eligible archetype design.

A new factory also needs the industry type/product, shared commodity stock/capacity/rate/label, recipe, price row, renderer silhouette, demand selection and trading/accounting links. A new civic facility needs catalogue capacity kind, floor cap, load/staffing, footprint and spacing rules. Refer to the generated [catalogue tables](reference/catalogues.md) rather than guessing naming conventions.

## Add new behaviour or an intent

1. Define the subsystem effect, units, owner and economic counterparty.
2. Declare the manifest route/plan ownership and extend the planner/executor or direct action handler.
3. Extend parsing and required parameters, report feasibility and prompt evidence.
4. Add appropriate Cabinet ownership; registration alone does not give a minister remit.
5. Implement render/inspection state where the effect needs visible feedback.
6. Preserve acquired footprints, financing, capacity, serialization/compatibility and rollback rules.
7. Test a successful case and a real rejected/blocked case, then regenerate references and update SRS/TODO.

Use `test:kit-registry`, `test:kits`, `test:provider-matrix` and the relevant subsystem checks. The registry supports modular contracts, but extensions still share the application process and legacy `town` adapters; untrusted plugin code is not isolated.
