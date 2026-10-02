/** In-memory savepoint for a single project executor. Rendering is derived from
 * this state; Three.js geometry is intentionally never copied. */
// `kindCounts` is the O(1) tally `Grid` keeps of how many cells carry each
// kind, maintained ONLY by `setKind`. This restore writes `kind` straight through
// `TypedArray.set` / `Array.splice`, bypassing the tally — so it has to be
// snapshotted and restored too, or the tally survives a rollback describing a
// grid that no longer exists. Measured: after a project rolled back, `roadCount`
// said 130 while the grid said 129, and the HUD's road figure stayed wrong for
// the rest of the session. `kindCounts` is an ArrayBuffer view, so the generic
// branch below already handles it.
const gridFields = ['kind', 'kindCounts', 'roadMask', 'roadFeature', 'roadClass', 'density', 'zone', 'owner', 'tint'];
const copyMap = (value) => value ? new Map(value) : null;
const copySet = (value) => value ? new Set(value) : null;
const copyPeriod = (value) => value ? { ...value, categories: { ...value.categories } } : null;
const own = (value) => ({ ...value });

export function snapshotProjectWorld(town) {
  const economy = town.economy;
  const resources = town.resources;
  const citizens = town.pedestrians?.citizens || [];
  const rngs = Object.fromEntries(['rng', 'growth', 'economy', 'pedestrians', 'industry', 'traffic', 'lifecycle']
    .map((key) => [key, (key === 'rng' ? town.rng : town[key]?.rng)?.getState?.()]));
  return {
    grid: Object.fromEntries(gridFields.map((key) => [key, town.grid[key].slice()])),
    buildings: town.buildings.slice(),
    buildingStates: new Map(town.buildings.map((building) => [building, own(building)])),
    citizens: citizens.slice(),
    citizenStates: new Map(citizens.map((citizen) => [citizen, own(citizen)])),
    profileStates: new Map(citizens.map((citizen) => [citizen.p, own(citizen.p)]).filter(([profile]) => profile)),
    households: town.pedestrians?.households?.slice() || [],
    householdStates: new Map((town.pedestrians?.households || []).map((household) => [household, own(household)])),
    customProps: new Map([...town.customProps].map(([key, props]) => [key, props.slice()])),
    forest: town.forest?.snapshot?.() || null,
    parkingPlanned: copySet(town.parkingPlanned),
    civicIndex: copyMap(town.civicIndex), civicNames: copyMap(town.civicNames),
    parkFeature: town.parkFeature, playCount: town.playCount,
    entityIds: { ...town.entityIds }, rngs,
    resource: resources ? {
      sites: resources.sites.slice(), states: new Map(resources.sites.map((site) => [site, own(site)])),
      owned: copySet(resources.owned), levels: { ...resources.levels },
      capacity: { ...resources.capacity }, production: { ...resources.production },
      shortage: { ...resources.shortage }, siteLevel: { ...resources.siteLevel }
    } : null,
    utilityLevels: { ...town.utilities?.expansionLevels },
    industry: town.industry ? { stocks: { ...town.industry.stocks }, imported: town.industry.imported,
      exported: town.industry.exported, historyLength: town.industry.history.length } : null,
    economy: economy ? {
      ids: { ...economy.ids }, accounts: Object.fromEntries(Object.entries(economy.accounts).map(([key, account]) => [key, own(account)])),
      capital: { ...economy.capital }, period: copyPeriod(economy.period),
      reserve: economy.reserve, expectedMoney: economy.expectedMoney, ledgerLength: economy.ledger.length,
      businesses: economy.businesses.slice(), closedBusinesses: economy.closedBusinesses.slice(),
      businessesById: copyMap(economy.businessesById), ownersById: copyMap(economy.ownersById),
      businessStates: new Map([...economy.businessesById.values()].map((business) => [business,
        { ...business, inventory: { ...business.inventory } }])),
      registeredCitizens: copySet(economy.registeredCitizens),
      inventoryExpected: copyMap(economy.inventoryExpected), bizCount: economy.bizCount
    } : null
  };
}

export function restoreProjectWorld(town, state) {
  for (const [building, fields] of state.buildingStates) Object.assign(building, fields);
  town.buildings.splice(0, town.buildings.length, ...state.buildings);
  for (const [citizen, fields] of state.citizenStates) Object.assign(citizen, fields);
  for (const [profile, fields] of state.profileStates) Object.assign(profile, fields);
  for (const [household, fields] of state.householdStates) Object.assign(household, fields);
  if (town.pedestrians) {
    town.pedestrians.citizens.splice(0, town.pedestrians.citizens.length, ...state.citizens);
    town.pedestrians.households = state.households.slice();
  }
  for (const [key, value] of Object.entries(state.grid)) {
    if (ArrayBuffer.isView(town.grid[key])) town.grid[key].set(value);
    else town.grid[key].splice(0, town.grid[key].length, ...value);
  }
  town.customProps = new Map([...state.customProps].map(([key, props]) => [key, props.slice()]));
  town.forest?.restore?.(state.forest);
  town.parkingPlanned = copySet(state.parkingPlanned);
  town.civicIndex = copyMap(state.civicIndex);
  town.civicNames = copyMap(state.civicNames);
  town.parkFeature = state.parkFeature;
  town.playCount = state.playCount;
  town.entityIds = { ...state.entityIds };
  if (state.resource) {
    const resource = town.resources;
    for (const [site, fields] of state.resource.states) Object.assign(site, fields);
    resource.sites = state.resource.sites.slice();
    resource.owned = copySet(state.resource.owned);
    for (const key of ['levels', 'capacity', 'production', 'shortage', 'siteLevel']) resource[key] = { ...state.resource[key] };
  }
  if (town.utilities) town.utilities.expansionLevels = { ...state.utilityLevels };
  if (state.industry) {
    Object.assign(town.industry.stocks, state.industry.stocks);
    town.industry.imported = state.industry.imported;
    town.industry.exported = state.industry.exported;
    town.industry.history.length = state.industry.historyLength;
  }
  if (state.economy) {
    const economy = town.economy;
    for (const [business, fields] of state.economy.businessStates) {
      Object.assign(business, fields);
      business.inventory = { ...fields.inventory };
    }
    for (const [key, fields] of Object.entries(state.economy.accounts)) Object.assign(economy.accounts[key], fields);
    economy.ids = { ...state.economy.ids };
    economy.capital = { ...state.economy.capital };
    economy.reserve = state.economy.reserve;
    economy.period = copyPeriod(state.economy.period);
    economy.acc = economy.period;
    economy.expectedMoney = state.economy.expectedMoney;
    economy.ledger.length = state.economy.ledgerLength;
    economy.businesses = state.economy.businesses.slice();
    economy.closedBusinesses = state.economy.closedBusinesses.slice();
    economy.businessesById = copyMap(state.economy.businessesById);
    economy.ownersById = copyMap(state.economy.ownersById);
    economy.registeredCitizens = copySet(state.economy.registeredCitizens);
    economy.inventoryExpected = copyMap(state.economy.inventoryExpected);
    economy.bizCount = state.economy.bizCount;
  }
  // Derived meshes, parcels, network topology and inspectors are recreated.
  town.rebuildAll?.();
  for (const [key, value] of Object.entries(state.grid)) {
    if (ArrayBuffer.isView(town.grid[key])) town.grid[key].set(value);
    else town.grid[key].splice(0, town.grid[key].length, ...value);
  }
  // The write above bypasses `setKind`, so the O(1) kind tally — which feeds the
  // HUD road figure, the validator and growth's park gates — is recounted from
  // the array rather than trusted. One linear pass, on a rare path, and it makes
  // the invariant structural instead of dependent on restore ordering.
  town.grid.recountKinds?.();
  town.parkFeature = state.parkFeature;
  town.playCount = state.playCount;
  for (const [key, value] of Object.entries(state.rngs)) {
    if (value !== undefined) (key === 'rng' ? town.rng : town[key]?.rng)?.setState?.(value);
  }
}

/** Pure, intentionally narrow state fingerprint for failed-project tests. */
export function projectStateSnapshot(town) {
  return JSON.stringify({
    grid: gridFields.filter((key) => key !== 'owner').map((key) => [...town.grid[key]]),
    owners: town.grid.owner.map((owner) => owner?.id || null),
    buildings: town.buildings.map((b) => [b.id, b.kind, b.floors, b.capacity, b.ownerType]),
    claims: [...(town.growth?.claims || [])].sort(),
    pending: [...(town.growth?.pendingTargets || [])].map((b) => b.id).sort(),
    materials: town.industry ? { ...town.industry.stocks } : null,
    accounts: town.economy ? Object.fromEntries(Object.entries(town.economy.accounts).map(([key, account]) => [key, account.cash])) : null,
    capital: town.economy ? { ...town.economy.capital } : null,
    utilities: town.utilities ? { ...town.utilities.expansionLevels } : null,
    resources: town.resources?.sites?.map((site) => [site.id, site.kind, site.level || 1]) || []
  });
}
