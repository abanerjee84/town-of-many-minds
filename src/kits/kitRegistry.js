import { createKitContext, KIT_CONTEXT_API_VERSION } from './kitContext.js';
import { buildingContract, catalogueContract, kitStats, rendererContract } from './kitContracts.js';

export const KIT_API_VERSION = 1;
const HOOK_NAMES = Object.freeze(['create', 'reset', 'generate', 'updateHour', 'updateDay', 'stats', 'serialize', 'restore', 'render', 'dispose']);
const ID_RE = /^[a-z][a-z0-9._-]*$/;
const INTENT_RE = /^[A-Z][A-Z0-9_]*$/;
const SCHEMA_RE = /^[0-9]+(?:\.[0-9]+){0,2}$/;

function freezeData(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeData(child);
  return Object.freeze(value);
}

function catalogueRows(manifest) {
  return (manifest.catalogue || []).map((row) => {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !ID_RE.test(row.id)) {
      throw new Error(`kit ${manifest.id} has an invalid catalogue row ID`);
    }
    const normalized = catalogueContract({
      ...row,
      kit: row.kit || manifest.id,
      schemaVersion: row.schemaVersion || manifest.catalogueSchemaVersion,
      planType: row.planType || manifest.planTypes?.[0] || null
    }, manifest.id);
    if (normalized.kit !== manifest.id) {
      throw new Error(`kit ${manifest.id} catalogue row ${normalized.id} is owned by ${normalized.kit}`);
    }
    return normalized;
  });
}

function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('kit manifest must be an object');
  const id = String(raw.id || '');
  if (!ID_RE.test(id)) throw new Error(`invalid kit ID: ${id || '<empty>'}`);
  if (!raw.version || typeof raw.version !== 'string') throw new Error(`kit ${id} needs a semantic version`);
  if (!SCHEMA_RE.test(String(raw.version))) throw new Error(`kit ${id} has an invalid semantic version ${raw.version}`);
  if (raw.apiVersion !== KIT_API_VERSION) throw new Error(`kit ${id} requires unsupported API version ${raw.apiVersion}`);
  const contextApiVersion = raw.contextApiVersion ?? KIT_CONTEXT_API_VERSION;
  if (contextApiVersion !== KIT_CONTEXT_API_VERSION) throw new Error(`kit ${id} requires unsupported context API version ${contextApiVersion}`);
  const catalogueSchemaVersion = String(raw.catalogueSchemaVersion ?? raw.schemaVersion ?? '1');
  if (!SCHEMA_RE.test(catalogueSchemaVersion)) throw new Error(`kit ${id} has an invalid catalogue schema version ${catalogueSchemaVersion}`);
  const declaredRoutes = raw.routes || Object.fromEntries((raw.intents || []).map((intent) => [intent, raw.planTypes?.[0] || null]));
  const intents = [...new Set([...Object.keys(declaredRoutes), ...(raw.intents || [])])];
  for (const intent of intents) if (typeof intent !== 'string' || !INTENT_RE.test(intent)) throw new Error(`kit ${id} has invalid intent ${intent}`);
  const routes = {};
  for (const [intent, planType] of Object.entries(declaredRoutes)) {
    if (!INTENT_RE.test(intent) || (planType !== null && typeof planType !== 'string')) {
      throw new Error(`kit ${id} has invalid route ${intent}`);
    }
    routes[intent] = planType;
  }
  const dependencies = [...new Set(raw.dependencies || [])];
  for (const dependency of dependencies) if (typeof dependency !== 'string' || !ID_RE.test(dependency)) throw new Error(`kit ${id} has invalid dependency ${dependency}`);
  const hooks = {};
  for (const hook of HOOK_NAMES) {
    if (raw.hooks?.[hook] !== undefined && typeof raw.hooks[hook] !== 'function') {
      throw new Error(`kit ${id} hook ${hook} must be a function`);
    }
    if (raw.hooks?.[hook]) hooks[hook] = raw.hooks[hook];
  }
  for (const hook of raw.requiredHooks || []) {
    if (!HOOK_NAMES.includes(hook) || !hooks[hook]) throw new Error(`kit ${id} requires missing hook ${hook}`);
  }
  const capabilities = { ...(raw.capabilities || {}) };
  if (raw.catalogue?.length) {
    const required = ['builder', 'quote', 'placement'];
    const missing = required.filter((capability) => !capabilities[capability]);
    if (missing.length) throw new Error(`kit ${id} catalogue requires capabilities: ${missing.join(', ')}`);
    if (!raw.planTypes?.length) throw new Error(`kit ${id} catalogue requires at least one plan type`);
  }
  return Object.freeze({
    id,
    version: raw.version,
    apiVersion: KIT_API_VERSION,
    contextApiVersion,
    catalogueSchemaVersion,
    dependencies: Object.freeze(dependencies),
    domains: Object.freeze([...(raw.domains || [])]),
    zones: Object.freeze([...(raw.zones || [])]),
    facilities: Object.freeze([...(raw.facilities || [])]),
    resources: Object.freeze([...(raw.resources || [])]),
    vehicleRoles: Object.freeze([...(raw.vehicleRoles || [])]),
    intents: Object.freeze(intents),
    planTypes: Object.freeze([...(raw.planTypes || [])]),
    routes: freezeData(routes),
    capabilities: freezeData(capabilities),
    catalogue: Object.freeze(catalogueRows({ ...raw, id })),
    hooks: Object.freeze(hooks)
  });
}

export class KitRegistry {
  constructor({ apiVersion = KIT_API_VERSION } = {}) {
    this.apiVersion = apiVersion;
    this._kits = new Map();
    this._intentOwners = new Map();
    this._catalogueOwners = new Map();
    this._compatibility = null;
    this._contexts = new WeakMap();
    this._failedRegistrations = [];
  }

  register(rawManifest) {
    let manifest = null;
    try {
      manifest = normalizeManifest(rawManifest);
      if (manifest.apiVersion !== this.apiVersion) throw new Error(`kit ${manifest.id} API version mismatch`);
      if (this._kits.has(manifest.id)) throw new Error(`kit ${manifest.id} is already registered`);
      for (const intent of manifest.intents) {
        const owner = this._intentOwners.get(intent);
        if (owner) throw new Error(`intent ${intent} is claimed by both ${owner} and ${manifest.id}`);
      }
      for (const row of manifest.catalogue) {
        const owner = this._catalogueOwners.get(row.id);
        if (owner) throw new Error(`catalogue ID ${row.id} is claimed by both ${owner} and ${manifest.id}`);
      }
      this._kits.set(manifest.id, manifest);
      for (const intent of manifest.intents) this._intentOwners.set(intent, manifest.id);
      for (const row of manifest.catalogue) this._catalogueOwners.set(row.id, manifest.id);
      this._compatibility = null;
      return manifest;
    } catch (error) {
      this._compatibility = null;
      this._failedRegistrations.push(Object.freeze({
        id: rawManifest?.id ? String(rawManifest.id) : null,
        reason: error?.message || String(error)
      }));
      throw error;
    }
  }

  unregister(id) {
    const manifest = this.get(id);
    if (!manifest) return false;
    const dependent = [...this._kits.values()].find((kit) => kit.dependencies.includes(manifest.id));
    if (dependent) throw new Error(`cannot remove ${manifest.id}; ${dependent.id} depends on it`);
    this._kits.delete(manifest.id);
    for (const intent of manifest.intents) this._intentOwners.delete(intent);
    for (const row of manifest.catalogue) this._catalogueOwners.delete(row.id);
    this._compatibility = null;
    return true;
  }

  get(id) { return this._kits.get(String(id)) || null; }
  has(id) { return this._kits.has(String(id)); }
  list() { return [...this._kits.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  catalogue(filter = {}) {
    return this.list().flatMap((kit) => kit.catalogue)
      .filter((row) => (!filter.kit || row.kit === filter.kit)
        && (!filter.family || row.family === filter.family)
        && (!filter.facility || row.facility === filter.facility)
        && (!filter.id || row.id === filter.id));
  }

  resolveIntent(intent) {
    const kitId = this._intentOwners.get(String(intent));
    if (!kitId) return null;
    const manifest = this.get(kitId);
    return Object.freeze({ intent: String(intent), kitId, planType: manifest.routes[String(intent)] ?? null });
  }

  ownerOfCatalogue(id) { return this._catalogueOwners.get(String(id)) || null; }

  order() {
    const ordered = [];
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`kit dependency cycle includes ${id}`);
      const kit = this.get(id);
      if (!kit) throw new Error(`kit dependency ${id} is not registered`);
      visiting.add(id);
      for (const dependency of kit.dependencies) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      ordered.push(kit);
    };
    for (const kit of this._kits.values()) visit(kit.id);
    return ordered;
  }

  validate() {
    const order = this.order();
    return Object.freeze({ valid: true, order: Object.freeze(order.map((kit) => kit.id)) });
  }

  compatibilityReport() {
    if (this._compatibility) return this._compatibility;
    const validation = this.validate();
    this._compatibility = Object.freeze({
      apiVersion: this.apiVersion,
      contextApiVersion: KIT_CONTEXT_API_VERSION,
      valid: validation.valid,
      order: validation.order,
      kits: Object.freeze(this.list().map((kit) => Object.freeze({
        id: kit.id,
        version: kit.version,
        apiVersion: kit.apiVersion,
        contextApiVersion: kit.contextApiVersion,
        catalogueSchemaVersion: kit.catalogueSchemaVersion,
        dependencies: kit.dependencies,
        domains: kit.domains,
        zones: kit.zones,
        facilities: kit.facilities,
        resources: kit.resources,
        vehicleRoles: kit.vehicleRoles,
        intents: kit.intents,
        planTypes: kit.planTypes,
        routes: kit.routes,
        catalogueIds: Object.freeze(kit.catalogue.map((row) => row.id)),
        capabilities: Object.freeze(Object.keys(kit.capabilities).sort()),
        hooks: Object.freeze(Object.keys(kit.hooks).sort())
      }))),
      intentRoutes: Object.freeze(Object.fromEntries([...this._intentOwners.entries()].sort((a, b) => a[0].localeCompare(b[0])))),
      intentPlanTypes: Object.freeze(Object.fromEntries(this.list()
        .flatMap((kit) => kit.intents.map((intent) => [intent, kit.routes[intent] ?? null]))
        .sort((a, b) => a[0].localeCompare(b[0])))),
      catalogueRoutes: Object.freeze(Object.fromEntries([...this._catalogueOwners.entries()].sort((a, b) => a[0].localeCompare(b[0])))),
      failedRegistrations: Object.freeze(this._failedRegistrations.slice())
    });
    return this._compatibility;
  }

  contextFor(town, kitId, options = {}) {
    if (!this.has(kitId)) throw new Error(`cannot create context for unknown kit ${kitId}`);
    if (!options.rng && town && typeof town === 'object') {
      let contexts = this._contexts.get(town);
      if (!contexts) {
        contexts = new Map();
        this._contexts.set(town, contexts);
      }
      if (contexts.has(kitId)) return contexts.get(kitId);
      const context = createKitContext(town, { ...options, kitId });
      contexts.set(kitId, context);
      return context;
    }
    return createKitContext(town, { ...options, kitId });
  }

  invalidateContext(town) {
    if (town && typeof town === 'object') this._contexts.delete(town);
  }

  invoke(hook, town, payload = {}) {
    if (!HOOK_NAMES.includes(hook)) throw new Error(`unknown kit hook ${hook}`);
    const results = [];
    for (const manifest of this.order()) {
      const fn = manifest.hooks[hook];
      if (!fn) continue;
      const context = this.contextFor(town, manifest.id, { rng: payload.rng });
      results.push({ kitId: manifest.id, result: fn({ context, town, ...payload }) });
    }
    return results;
  }

  stats(town) {
    return Object.freeze(Object.fromEntries(this.order().map((manifest) => {
      const fn = manifest.hooks.stats;
      if (!fn) return [manifest.id, null];
      const context = this.contextFor(town, manifest.id);
      return [manifest.id, fn({ context, town })];
    })));
  }

  kitStats(town) {
    return Object.freeze(Object.fromEntries(this.order().map((manifest) => {
      const fn = manifest.hooks.stats;
      const context = fn ? this.contextFor(town, manifest.id) : null;
      const values = fn ? fn({ context, town }) : null;
      return [manifest.id, kitStats({ kitId: manifest.id, values })];
    })));
  }

  /** Invoke a kit-local renderer using a stable building contract. Three.js
   * objects may be returned in `scene`; serializable inspection metadata is
   * kept separate and an explicit disposer is carried with the result. */
  render(town, kitId, building, options = {}) {
    const manifest = this.get(kitId);
    if (!manifest) return { ok: false, reason: 'unknown_kit', kitId };
    const fn = manifest.hooks.render;
    if (!fn) return { ok: false, reason: 'renderer_unavailable', kitId };
    if (!building?.id) return { ok: false, reason: 'building_contract_required', kitId };
    try {
      const context = this.contextFor(town, manifest.id);
      const result = fn({
        context,
        town,
        building: buildingContract({ ...building, kitId: manifest.id }),
        options
      });
      return { ok: true, kitId, result: rendererContract({
        kitId: manifest.id,
        buildingId: building.id,
        ...(result || {})
      }) };
    } catch (error) {
      return { ok: false, reason: error?.message || String(error), kitId };
    }
  }

  dispose(town) { return this.invoke('dispose', town); }

  /** Serializable lifecycle state owned by registered kits. Hooks are optional;
   * an absent hook is represented explicitly so optional kits remain observable. */
  serialize(town) {
    const kits = {};
    for (const manifest of this.order()) {
      const fn = manifest.hooks.serialize;
      const context = fn ? this.contextFor(town, manifest.id) : null;
      kits[manifest.id] = fn ? fn({ context, town }) : null;
    }
    return Object.freeze({
      apiVersion: this.apiVersion,
      contextApiVersion: KIT_CONTEXT_API_VERSION,
      compatibility: this.compatibilityReport(),
      kits: freezeData(kits)
    });
  }

  /** Restore kit-owned state only after the saved registry signature matches. */
  restore(town, saved = {}) {
    if (!saved || saved.apiVersion !== this.apiVersion || saved.contextApiVersion !== KIT_CONTEXT_API_VERSION) {
      return { ok: false, reason: 'kit_api_mismatch' };
    }
    const savedSignature = (saved.compatibility?.kits || [])
      .map((kit) => `${kit.id}@${kit.version}:api${kit.apiVersion}:ctx${kit.contextApiVersion}`)
      .sort();
    const currentSignature = this.compatibilityReport().kits
      .map((kit) => `${kit.id}@${kit.version}:api${kit.apiVersion}:ctx${kit.contextApiVersion}`)
      .sort();
    if (JSON.stringify(savedSignature) !== JSON.stringify(currentSignature)) {
      return { ok: false, reason: 'kit_compatibility_mismatch', saved: savedSignature, current: currentSignature };
    }
    const results = [];
    try {
      for (const manifest of this.order()) {
        const fn = manifest.hooks.restore;
        if (!fn) {
          results.push({ kitId: manifest.id, available: false });
          continue;
        }
        const context = this.contextFor(town, manifest.id);
        results.push({ kitId: manifest.id, available: true, result: fn({ context, town, state: saved.kits?.[manifest.id] ?? null }) });
      }
      return { ok: true, results };
    } catch (error) {
      return { ok: false, reason: error?.message || String(error), results };
    }
  }
}
