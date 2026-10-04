import { events } from '../core/events.js';
import { INTENTS, POLICY_INTENTS, actionFor } from './actionRegistry.js';
import { MAX_FLOORS, CELL_KIND } from '../core/config.js';
import { planFor, LANDMARKS, UTILITY_RESERVE, MAX_ACTIVE, BUILD_FLOOR, BUILD_HOURS,
  MAX_BRIDGE_GAP,
  civicLoads, civicExpansionNeed, HOUSE_PRESSURE_GATE, HOUSE_SPARE_BEDS, housingNeedsBuild, FILLER_PRESSURE_GATE,
  UNEMPLOYMENT_GATE, UNEMPLOYMENT_PCT, UNEMPLOYMENT_PRIORITY_GATE, unemploymentRate, CIVIC_PER_POP, PARKS_PER_POP, roadCongestionGate, ROAD_EMERGENCY_GATE, CIVIC_LOAD_GATE, activePublicProjects } from './growth.js';
import { FACTORY_TYPES, COMMODITIES, MATERIAL_KEYS } from './industry.js';
import { SHOP_TIERS } from './economy.js';
import { CIVIC_CATALOGUE } from '../kits/civic/civicKit.js';
import { SITE_CREW, CREW_ROLES, ORDER } from '../kits/resources/resourceKit.js';
import { SCHEMES, SCHEME_IDS, LAWS, LAW_IDS, MODIFIERS, EFFECT_KEYS } from './policy.js';
import { CAMPAIGN } from './lifecycle.js';
import { BUCKETS, BUCKET_IDS, LEVERS, LEVER_IDS, POINTS_PER_RUNG } from './innovation.js';
import { DecisionLedger, persona } from './persona.js';
import { HOUSE_STYLES } from '../kits/houses/houseKit.js';
import { jobById } from '../kits/citizens/personality.js';
import { XS_CLASS_ORDER, XS_CLASS_LABEL } from '../kits/roads/crossSection.js';
import { resolveLLMProvider, registerLLMProvider, listLLMProviders } from './llmProviders.js';
import { constructionBlockStats, constructionBlock, listConstructionBlocks } from '../kits/constructionBlocks.js';
import { CouncilLearning, measureCouncilState } from './councilLearning.js';
import { priceIndex } from './priceChart.js';
import { BUILD_TIME_CHART } from './buildTime.js';
import { CabinetSystem } from './cabinet.js';
import { renderMapNow } from './mapNow.js';

export { resolveLLMProvider, registerLLMProvider, listLLMProviders } from './llmProviders.js';

export const DEFAULT_ENDPOINT = '/lm/v1';
export const DIRECT_ENDPOINT = 'http://localhost:1234/v1';
// A small amount of sampling helps the council explore distinct valid
// archetypes. It is deliberately bounded and can be set to 0 for replay or
// provider-comparison runs that require deterministic completions.
export const DEFAULT_COUNCIL_TEMPERATURE = 0.15;
// The system contract is deliberately bounded so provider comparisons are
// about decisions and outcomes, not who accepts a longer hidden prompt.
export const COUNCIL_PROMPT_TOKEN_BUDGET = 4000;

function councilTemperature(value, fallback = DEFAULT_COUNCIL_TEMPERATURE) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function emptyCongestionWindow(clock = null) {
  return {
    weighted: 0,
    seconds: 0,
    sum: 0,
    samples: 0,
    min: Infinity,
    max: -Infinity,
    from: clock ? { day: Number(clock.day) || 0, hour: Number(clock.hour) || 0 } : null
  };
}

/**
 * The town the free `parseIntent` reads policy state from. The council is a
 * singleton per town in practice, and the probes parse against a live one, so
 * a module-level handle is the honest shape here — `this` is not in scope.
 */
let currentTown = null;

export { ACTION_REGISTRY, INTENTS, PLAN_TYPE, POLICY_INTENTS } from './actionRegistry.js';


/* ------------------------------------------------------------------ Phase 8
 * The land-use family shares one spec: zone=<grid zone id>. The archetype
 * spelling (zone=house|shop|civic) is an alias table rather than a second
 * vocabulary, so a council reply that says house/shop gets the grid zone it
 * meant instead of being refused. Declared here — before PROMPT_BODY —
 * because the prompt quotes the list verbatim.
 */
const LAND_ZONE_IDS = ['residential', 'commercial', 'industrial', 'civic', 'park'];

const LAND_ZONE_ALIASES = {
  residential: 'residential', house: 'residential', homes: 'residential', housing: 'residential',
  commercial: 'commercial', shop: 'commercial', shops: 'commercial', business: 'commercial', retail: 'commercial',
  industrial: 'industrial', industry: 'industrial', factory: 'industrial',
  civic: 'civic',
  park: 'park', green: 'park'
};

/** Map a growth plan to the council intent that would order it (replayable via text). */
/** Why an intent came back with no plan at all — one line per buildable
 *  intent, so enact() answers with the same wording the planner's check()
 *  would give (Phase 8 moved this out of the nested ternary to keep it
 *  readable as the land-use family grew). */
const NULL_PLAN_DETAIL = {
  UPGRADE_BUILDING: 'every building is already at full height',
  RENOVATE: 'every building is already at the top budget tier',
  TIERUP: 'every shop is already at the top rung',
  WING: 'no building has room for a wing',
  EXPAND_LANDMARK: 'that landmark is not built, or it has no room to annex',
  // Phase 8.
  PAVE_PLAZA: 'no free cell left to pave a civic square',
  ADD_PARKING: 'no kerbside cell left to mark for parking',
  CLEAR_LOT: 'no building is left to clear',
  REZONE: 'no land is left to rezone',
  UPZONE: 'every cell is already upzoned',
  ANNEX_EDGE: 'the edge is already annexed',
  // Phase 9.
  BUILD_BRIDGE: 'no river gap is left to span',
  ACQUIRE_LAND: 'acquired serviced land is not exhausted, or no unacquired frontier tiles remain, or the reserve is too low',
  RESTRUCTURE_BUILDING: 'no occupied building has a safe higher floor to add'
};

/** Explain a resource upgrade that cannot produce a plan. The old generic
 * "no procedure" text was misleading: the procedure exists, but the chosen
 * resource may have no producing site left below the level cap, or its only
 * eligible site may already be reserved by an active project. */
function resourcePlanFailure(town, params = {}) {
  const resources = town?.resources;
  if (!resources) return 'resource system is unavailable';
  const snapshot = resources.stats?.();
  const resource = ORDER.includes(params.resource)
    ? params.resource
    : snapshot?.strained?.[0] || ORDER[0];
  const label = resource.charAt(0).toUpperCase() + resource.slice(1);
  const kind = params.kind && resources.kindOfResource?.(params.kind) === resource
    ? params.kind
    : null;
  if (params.kind && !kind) return `${params.kind} is not a ${label.toLowerCase()} site`;
  const sites = (resources.sites || []).filter((site) => resources.kindOfResource?.(site.kind) === resource);
  if (!sites.length) return `no ${label.toLowerCase()} production site exists to upgrade`;
  const target = resources.upgradeTarget?.(resource, kind);
  if (target) return `the ${label.toLowerCase()} upgrade is currently unavailable for this project`;
  const pending = sites.find((site) => town.growth?.pendingTargets?.has?.(site));
  if (pending) return `${label} upgrade is already in progress at ${pending.kind}`;
  const storageOnly = new Set(['reservoir', 'silo', 'battery']);
  const producers = sites.filter((site) => !storageOnly.has(site.kind));
  if (!producers.length) return `${label} has storage but no upgradeable production site`;
  if (producers.every((site) => (site.level || 1) >= 3)) return `all ${label.toLowerCase()} production sites are at the level 3 cap`;
  if (resources.producerCapacityShortfall?.(resource)) {
    if (town.growth?.resourceLandNeed?.() === resource) return `${label} capacity is short and no acquired producer footprint fits — ACQUIRE_LAND first`;
    if (resources.producerSiteRoom?.(resource)) return `${label} capacity is short — a new producer can be sited on acquired land`;
  }
  return `no ${label.toLowerCase()} production site is currently upgradeable`;
}

/** The replay code a plan round-trips through the phrase table. */
export function planCode(plan) {
  if (!plan) return 'NO_ACTION';
  if (plan.type === 'resource') {
    const base = `UPGRADE_RESOURCE resource=${plan.resource || ORDER[0]}`;
    return plan.kind ? `${base} kind=${plan.kind}` : base;
  }
  if (plan.type === 'utility') return `EXPAND_${String(plan.kind || 'water').toUpperCase()}`;
  if (plan.type === 'archetype') {
    return `IMAGINE_ARCHETYPE zone=${plan.zone || 'house'}${plan.blockId ? ` block=${plan.blockId}` : ''}`;
  }
  if (plan.type === 'house' && plan.blockId) {
    return `DEVELOP_HOUSING block=${plan.blockId}`;
  }
  // Phase 20 — an office replays with its name when the council pinned one, so
  // a replayed order builds the same tenant rather than a different one.
  if (plan.type === 'office') return plan.name ? `BUILD_OFFICE name=${plan.name}` : 'BUILD_OFFICE';
  // Phase 18 — a district has no spec to carry: the queue is re-derived from
  // the town's own gaps at replay time, which is the whole point of deriving it.
  if (plan.type === 'district') return 'BUILD_DISTRICT';
  // A wing replays as WING; the landmark-expansion flavour replays with the
  // landmark it is annexing (Phase 6) — checked first, because it is also a
  // 'wing' plan and must never fall into the BUILD_LANDMARK branch below.
  if (plan.type === 'wing') return plan.expand ? `EXPAND_LANDMARK type=${plan.expand}` : 'WING';
  // Every LANDMARKS plan (mall, stadium, hospital, …) replays as one code.
  if (plan.landmark) return `BUILD_LANDMARK type=${plan.landmark}`;
  // A commerce rung chosen with the lot replays its spec; a bare shop (or a
  // plan that never picked one) replays as the plain intent.
  if (plan.type === 'shop') return plan.tier ? `OPEN_SHOP tier=${plan.tier}` : 'OPEN_SHOP';
  // Phase 12 (C2) — a works replays with the factory it was commissioned as;
  // without this the bare BUILD_FACTORY replayed as FACTORY_TYPES[0] (sawmill)
  // every time, silently changing what the council ordered.
  if (plan.type === 'factory')
    return plan.factory ? `BUILD_FACTORY type=${plan.factory}` : 'BUILD_FACTORY';
  // A civic build replays as BUILD_CIVIC, carrying the facility when one was
  // ordered (planner-chosen builds carry none and let the model pick).
  if (plan.type === 'civic') return ['transit', 'busdepot'].includes(plan.facility)
    ? `BUILD_TRANSIT facility=${plan.facility}`
    : plan.facility ? `BUILD_CIVIC facility=${plan.facility}` : 'BUILD_CIVIC';
  if (plan.type === 'bond') return 'BOND_ISSUE';
  if (plan.type === 'land') return 'ACQUIRE_LAND';
  if (plan.type === 'restructure') return 'RESTRUCTURE_BUILDING';
  // In-place work replays with the rung it was climbing to (Phase 5).
  if (plan.type === 'renovate') return plan.budget ? `RENOVATE budget=${plan.budget}` : 'RENOVATE';
  if (plan.type === 'tierup') return plan.tier ? `TIERUP tier=${plan.tier}` : 'TIERUP';
  // A corridor widened with an explicit target replays that rung (Phase 7);
  // a plain order (no class=) replays bare and climbs one rung on its own.
  if (plan.type === 'roadup') return plan.pinned && plan.to ? `UPGRADE_ROAD class=${plan.to}` : 'UPGRADE_ROAD';
  // Phase 9 — a bridge replays bare: its gap is re-chosen at plan time, so a
  // replay never pins cells that may already be decked over.
  if (plan.type === 'bridge') return 'BUILD_BRIDGE';
  // Phase 8 — surface works replay bare; the land-use family replays with the
  // zone it painted (REZONE/ANNEX_EDGE take zone=, so a replay repaints the
  // same district instead of the default one).
  if (plan.type === 'plaza') return 'PAVE_PLAZA';
  if (plan.type === 'parking') return 'ADD_PARKING';
  if (plan.type === 'clear') return 'CLEAR_LOT';
  if (plan.type === 'upzone') return 'UPZONE';
  if (plan.type === 'rezone') return `REZONE zone=${plan.zone || 'residential'}`;
  if (plan.type === 'annex') return `ANNEX_EDGE zone=${plan.zone || 'residential'}`;
  const code = {
    house: 'DEVELOP_HOUSING',
    park: 'PARK_LAND',
    road: 'EXTEND_STREET',
    footway: 'EXTEND_FOOTWAY',
    factory: 'BUILD_FACTORY',
    upgrade: 'UPGRADE_BUILDING',
    renovate: 'RENOVATE',
    tierup: 'TIERUP',
    'prop-tree': 'PLANT_TREES',
    'prop-lamp': 'INSTALL_LAMP'
  }[plan.type];
  return code || 'NO_ACTION';
}

/** Default council cadence. The persisted setting may make this 1–12 sittings/day. */
const DEFAULT_SITTINGS_PER_DAY = 2;
const clampSittingsPerDay = (value) => Math.max(1, Math.min(12, Math.round(Number(value) || DEFAULT_SITTINGS_PER_DAY)));

/**
 * Phase 30 (S19b) — how long one sitting may take before it is abandoned.
 *
 * `ask()` had no abort at all, so a hung upstream pinned `pending` for ever:
 * every later sitting returned `{status:'busy'}` and the HUD sat on "thinking…"
 * with no way back. The council is a *scheduled* body of a simulation — a
 * sitting that cannot answer must not be able to silence the next one.
 *
 * Two tiers, because "the model is slow" and "the model is gone" are different
 * failures: a sitting that runs long is aborted and retried on the next slot,
 * while `ASK_FAIL_LIMIT` consecutive failures hand the town to the rules
 * fallback until a call succeeds again.
 */
export const ASK_TIMEOUT_MS = 20000;
export const ASK_FAIL_LIMIT = 3;

const PHRASES = [
  ['STUDY_ROAD', ['STUDY ROAD', 'STUDY ROADS', 'ROAD STUDY', 'TRAFFIC STUDY', 'SURVEY ROAD', 'ANALYZE ROAD', 'SURVEY THE ROADS']],
  // The other studies keep clear of STUDY_* + ROAD/TRAFFIC wording, which the
  // road-study regex above claims before phrases are ever consulted.
  ['STUDY_ECONOMY', ['STUDY THE ECONOMY', 'STUDY ECONOMY', 'ECONOMIC REPORT', 'ECONOMY REPORT', 'SURVEY THE ECONOMY', 'HOW IS THE ECONOMY']],
  ['STUDY_DEMOGRAPHICS', ['STUDY DEMOGRAPHICS', 'DEMOGRAPHIC REPORT', 'POPULATION REPORT', 'WHO LIVES HERE', 'CENSUS']],
  ['STUDY_TRAFFIC', ['TRAFFIC REPORT', 'TRAFFIC COUNTS', 'TRAFFIC ANALYSIS', 'HOW BAD IS THE TRAFFIC']],
  ['STUDY_INCIDENTS', ['STUDY INCIDENTS', 'INCIDENT REPORT', 'EMERGENCY REPORT', 'WHAT CALLS ARE OPEN', 'OPEN CALLS']],
  // Phase 15 — policy. REPEAL/END before ENACT/PASS: a council saying "end the
  // green belt law" should repeal, not enact a scheme called "law".
  ['REPEAL_LAW', ['REPEAL THE LAW', 'REPEAL LAW', 'REPEAL THE STATUTE', 'REPEAL IT', 'REVERSE THE LAW', 'SCRAP THE LAW']],
  ['END_SCHEME', ['END SCHEME', 'END THE SCHEME', 'END PROGRAMME', 'END PROGRAM', 'END THE PROGRAMME', 'STOP THE SCHEME', 'CANCEL THE SCHEME', 'WIND UP SCHEMES', 'END ALL SCHEMES']],
  ['PASS_LAW', ['PASS A LAW', 'PASS LAW', 'PASS THE LAW', 'ENACT A LAW', 'MAKE IT LAW', 'PASS A STATUTE', 'LEGISLATE']],
  ['ENACT_SCHEME', ['ENACT SCHEME', 'START A SCHEME', 'LAUNCH A SCHEME', 'RUN A SCHEME', 'BEGIN THE SCHEME', 'ENACT A PROGRAMME', 'START A PROGRAMME', 'SCHEME']],
  ['KEEP_TAX', ['KEEP TAX', 'KEEP TAXES', 'HOLD TAX', 'NO TAX CHANGE', 'LEAVE TAX']],
  ['CUT_TAX', ['CUT TAX', 'LOWER TAX', 'REDUCE TAX', 'TAX DOWN', 'TAXES DOWN', 'CUT THE TAX']],
  ['RAISE_TAX', ['RAISE TAX', 'RAISE TAXES', 'HIGHER TAX', 'INCREASE TAX', 'TAX UP', 'TAXES UP']],
  ['HIRE_WORKERS', ['HIRE WORKERS', 'HIRE STAFF', 'HIRE LABOUR', 'HIRE LABOR', 'RECRUIT WORKERS', 'RECRUIT STAFF', 'STAFF GAP', 'FILL STAFF', 'BRING IN WORKERS', 'STAFF THE SITES']],
  ['ATTRACT_SETTLERS', ['ATTRACT SETTLERS', 'ATTRACT NEWCOMERS', 'ATTRACT FAMILIES', 'ADVERTISE THE TOWN', 'CAMPAIGN FOR SETTLERS', 'SETTLER CAMPAIGN', 'BRING IN NEWCOMERS', 'ATTRACT MIGRANTS', 'PROMOTE THE TOWN']],
  ['FUND_INNOVATION', ['FUND INNOVATION', 'FUND RESEARCH', 'FUND THE RESEARCH', 'RESEARCH BUDGET', 'SPEND ON RESEARCH', 'INVEST IN RESEARCH', 'BACK RESEARCH', 'FUND SCIENCE']],
  ['BUILD_DISTRICT', ['BUILD A DISTRICT', 'BUILD DISTRICT', 'LAY OUT A DISTRICT', 'NEW DISTRICT', 'DEVELOP A DISTRICT', 'FOUND A DISTRICT', 'DISTRICT', 'GROW A DISTRICT', 'NEW HOUSING DISTRICT']],
  ['TRADE_BUY', ['TRADE BUY', 'BUY GOODS', 'BUY MATERIALS', 'IMPORT GOODS', 'BUY LUMBER', 'BUY STEEL', 'BUY CEMENT', 'BUY STOCK', 'RESTOCK', 'IMPORT']],
  ['TRADE_SELL', ['TRADE SELL', 'SELL GOODS', 'SELL MATERIALS', 'EXPORT GOODS', 'EXPORT SURPLUS', 'SELL SURPLUS', 'SELL STOCK', 'EXPORT']],
  // Finance: reserve/bond/subsidy/spending — all non-build actions, so they
  // are always available exactly like tax and trade.
  ['SET_ASIDE_RESERVE', ['SET ASIDE RESERVE', 'SET ASIDE A RESERVE', 'SET ASIDE SOME MONEY', 'RAINY DAY FUND', 'RESERVE FUND', 'BANK A RESERVE', 'SAVE A RESERVE']],
  ['BOND_ISSUE', ['ISSUE A BOND', 'ISSUE BONDS', 'BOND ISSUE', 'RAISE A BOND', 'TAKE OUT A LOAN', 'BORROW MONEY', 'BORROW']],
  ['SUBSIDY', ['PAY A SUBSIDY', 'GIVE A SUBSIDY', 'SUBSIDY', 'SUBSIDISE', 'SUBSIDIZE', 'GRANT TO THE SHOPS', 'BAILOUT', 'HELP THE STRUGGLING SHOPS']],
  ['SLASH_SPENDING', ['SLASH SPENDING', 'CUT SPENDING', 'TRIM SPENDING', 'CUT COSTS', 'SPEND LESS', 'AUSTERITY']],
  // Civic life: a festival, a declaration, a dispatch.
  ['HOST_EVENT', ['HOST AN EVENT', 'HOST A FESTIVAL', 'PUT ON A FESTIVAL', 'ORGANISE A FESTIVAL', 'ORGANIZE A FESTIVAL', 'FESTIVAL', 'CARNIVAL', 'HOST A MARKET DAY']],
  ['DECLARE_EMERGENCY', ['DECLARE AN EMERGENCY', 'DECLARE EMERGENCY', 'EMERGENCY DECLARATION', 'CALL AN EMERGENCY', 'DECLARE A STATE OF EMERGENCY']],
  ['DISPATCH_UNITS', ['DISPATCH THE UNITS', 'DISPATCH UNITS', 'SEND OUT THE UNITS', 'SEND OUT UNITS', 'DEPLOY THE UNITS', 'SCRAMBLE THE UNITS', 'DISPATCH']],
  ['NO_ACTION', ['NO ACTION', 'DO NOTHING', 'NOTHING', 'NO CHANGE', 'STAND PAT', 'LEAVE IT', 'LEAVE AS IS', 'LEAVE THINGS', 'AS THEY ARE', 'SEEMS FINE', 'ALL GOOD']],
  // Landmark rows BEFORE DEVELOP_HOUSING/EXPAND_CLINIC/OPEN_SHOP/BUILD_FACTORY:
  // on equal match position the earlier row wins, so these must own their
  // phrases — "shopping mall" ⊃ "shop", "industrial park" ⊃ "industrial",
  // and even-position ties like "hospital". Generated from growth's
  // LANDMARKS catalogue: a new table row is a new keyword intent automatically.
  ...Object.values(LANDMARKS).map((lm) => ['BUILD_LANDMARK', lm.phrases]),
  ['DEVELOP_HOUSING', ['DEVELOP HOUSING', 'DEVELOP HOUSES', 'BUILD HOUSING', 'BUILD HOUSE', 'BUILD HOMES', 'MORE HOUSING', 'NEW HOUSING', 'HOUSING', 'HOMES']],
  // The legacy spelling owns only its own two phrases (an old council reply
  // replayed verbatim still routes here); every other civic wording belongs
  // to BUILD_CIVIC and keeps the row position it always had.
  ['EXPAND_CLINIC', ['EXPAND CLINIC', 'EXPAND THE CLINIC']],
  // Phase 8 — surface works. Two tie-breaks decide their position. They sit
  // BEFORE BUILD_CIVIC because its bare 'CIVIC' matches "civic square" at the
  // same index as the square's own phrase — the square must win that one.
  // They also sit BEFORE PARK_LAND: a bay or a square is street work whose
  // phrases all contain PARK/PLAZA, so on an equal match position the earlier
  // row keeps them ("parking" must not settle into PARK_LAND). Neither row
  // steals the plain words: "civic" still reaches BUILD_CIVIC and "park"
  // still reaches PARK_LAND, because those inputs carry no square/bay phrase.
  ['PAVE_PLAZA', [
    'PAVE A PLAZA', 'PAVE THE PLAZA', 'BUILD A PLAZA', 'MAKE A PLAZA',
    'CIVIC SQUARE', 'TOWN SQUARE', 'PUBLIC SQUARE', 'MARKET SQUARE',
    'BUILD A SQUARE', 'PAVE THE SQUARE', 'PLAZA', 'SQUARE'
  ]],
  ['ADD_PARKING', [
    'ADD PARKING', 'MORE PARKING', 'PARKING LOT', 'CAR PARK', 'KERBSIDE PARKING',
    'PAVING FOR PARKING', 'PARK THE CARS', 'RESERVE PARKING BAYS',
    'PARKING BAYS', 'PARKING', 'BAYS'
  ]],
  ['BUILD_TRANSIT', ['BUILD TRANSIT', 'BUILD A BUS DEPOT', 'BUILD BUS DEPOT', 'OPEN BUS SERVICE', 'TRANSIT HUB', 'BUILD A TRANSIT HUB', 'PUBLIC TRANSPORT']],
  ['ACQUIRE_LAND', ['ACQUIRE NEW LAND', 'ACQUIRE FRONTIER LAND', 'BUY FRONTIER LAND', 'EXTEND THE PERIMETER', 'GROW THE PERIMETER', 'ACQUIRE THE FRONTIER']],
  ['RESTRUCTURE_BUILDING', ['RESTRUCTURE THE BUILDING', 'RESTRUCTURE BUILDINGS', 'REBUILD THE BUILDING', 'REDEVELOP THE BUILDING', 'REBUILD THIS SITE']],
  ['BUILD_CIVIC', ['BUILD CLINIC', 'NEW CLINIC', 'CLINIC', 'CIVIC', 'SCHOOL', 'LIBRARY', 'POLICE', 'FIRE STATION', 'BUILD A SCHOOL', 'NEW SCHOOL', 'BUILD A LIBRARY', 'NEW LIBRARY', 'TOWN HALL', 'CIVIC BUILDING']],
  ['OPEN_SHOP', ['OPEN SHOP', 'NEW SHOP', 'BUILD SHOP', 'SHOPS', 'SHOP', 'BUSINESS', 'STORE', 'RETAIL']],
  ['BUILD_OFFICE', ['BUILD OFFICE', 'BUILD AN OFFICE', 'NEW OFFICE', 'OFFICE BLOCK', 'OFFICE', 'COMMERCIAL OFFICES', 'BUSINESS CENTRE', 'BUSINESS CENTER', 'LET OFFICES', 'OPEN AN OFFICE', 'OFFICES']],
  ['BUILD_FACTORY', ['BUILD FACTORY', 'FACTORY', 'FACTORIES', 'SAWMILL', 'STEELWORKS', 'CEMENT WORKS', 'GOODS PLANT', 'INDUSTRY', 'INDUSTRIAL', 'MANUFACTURING', 'TEXTILE MILL', 'SOFTWARE HOUSE', 'FURNITURE WORKSHOP']],
  ['PARK_LAND', ['PARK LAND', 'NEW PARK', 'BUILD PARK', 'GREEN SPACE', 'PLAYGROUND', 'PARK']],
  // New rows sit before EXTEND_STREET so "street lamp" wins the tie over
  // "street" (equal match position — first row listed keeps it).
  ['PLANT_TREES', ['PLANT TREES', 'PLANT TREE', 'PLANT MORE TREES', 'TREE PLANTING', 'MORE TREES', 'GREEN THE STREETS', 'TREES']],
  ['INSTALL_LAMP', ['INSTALL LAMP', 'STREET LAMP', 'STREET LIGHTS', 'ADD LIGHTING', 'MORE LIGHTING', 'LAMP', 'LAMPS']],
  // Before UPGRADE_BUILDING: its bare 'UPGRADE' would win the equal-position
  // tie for phrases that start the same way. These never start with a bare
  // 'UPGRADE <building>' — resource output is raised, pipes are EXPAND_*.
  ['UPGRADE_RESOURCE', [
    'UPGRADE RESOURCE', 'UPDATE RESOURCE', 'UPDATE THE RESOURCE', 'UPDATE RESOURCE OUTPUT',
    'UPGRADE THE RESERVES', 'UPGRADE WATER SUPPLY',
    'UPGRADE THE WATER WORKS', 'BOOST WATER', 'BOOST POWER', 'BOOST FOOD',
    'BOOST THE WATER', 'BOOST THE POWER', 'BOOST THE FOOD', 'BOOST RESERVES',
    'RAISE WATER OUTPUT', 'RAISE POWER OUTPUT', 'RAISE FOOD OUTPUT', 'RAISE OUTPUT',
    'RAISE THE WATER OUTPUT', 'RAISE THE POWER OUTPUT', 'RAISE THE FOOD OUTPUT',
    'RAISE THE OUTPUT', 'MORE RESERVES', 'MORE WATER RESERVES', 'MORE POWER RESERVES',
    'BIGGER PUMPS', 'STRONGER PUMPS', 'WATER WORKS', 'WATER TREATMENT',
    'RAISE PRODUCTION', 'UPGRADE THE PUMPS',
    // Phase 14 — fuel is the fourth primary resource and reads as pumps and
    // tanks, not as "reserves".
    'BOOST FUEL', 'BOOST THE FUEL', 'RAISE FUEL OUTPUT', 'RAISE THE FUEL OUTPUT',
    'RAISE FUEL SUPPLY', 'RAISE THE FUEL SUPPLY', 'MORE FUEL', 'MORE GAS STATIONS',
    'FUEL SUPPLY', 'GAS STATION', 'GAS STATIONS', 'OPEN A GAS STATION',
    // Farm & husbandry tiers — free text names the yard ("upgrade the ranch",
    // "raise poultry output"), not the resource. Verb-led so a bare mention
    // ("the ranch is fine") never routes here; KIND_WORDS pins the yard once
    // the intent lands. Covers every KIND_WORDS key + tier labels.
    'UPGRADE THE FARM', 'UPGRADE FARM', 'BIGGER FARM', 'EXPAND THE FARM',
    'EXPAND FARM', 'GROW THE FARM', 'GROW FARM', 'BOOST THE FARM',
    'RAISE FARM OUTPUT', 'RAISE THE FARM OUTPUT',
    'UPGRADE THE SMALLHOLDING', 'BIGGER SMALLHOLDING', 'EXPAND THE SMALLHOLDING',
    'UPGRADE THE RANCH', 'UPGRADE RANCH', 'BIGGER RANCH', 'EXPAND THE RANCH',
    'EXPAND RANCH', 'GROW THE RANCH', 'GROW RANCH', 'BOOST THE RANCH',
    'BOOST RANCH', 'RAISE RANCH OUTPUT', 'RAISE THE RANCH OUTPUT',
    'UPGRADE HUSBANDRY', 'BIGGER HUSBANDRY', 'EXPAND HUSBANDRY',
    'GROW HUSBANDRY', 'RAISE HUSBANDRY OUTPUT', 'BOOST HUSBANDRY',
    'UPGRADE THE PADDOCK', 'BIGGER PADDOCK', 'EXPAND THE PADDOCK',
    'GROW THE PADDOCK', 'UPGRADE THE STOCKYARD', 'BIGGER STOCKYARD',
    'EXPAND THE STOCKYARD', 'MORE LIVESTOCK', 'MORE CATTLE',
    'UPGRADE THE LIVESTOCK', 'EXPAND THE LIVESTOCK',
    'RAISE POULTRY OUTPUT', 'RAISE THE POULTRY OUTPUT', 'BOOST POULTRY',
    'BOOST THE POULTRY', 'UPGRADE POULTRY', 'BIGGER POULTRY',
    'EXPAND POULTRY', 'GROW POULTRY', 'MORE POULTRY',
    'UPGRADE THE COOP', 'UPGRADE COOP', 'BIGGER COOP', 'EXPAND THE COOP',
    'EXPAND COOP', 'GROW THE COOP', 'UPGRADE THE HATCHERY',
    'BIGGER HATCHERY', 'EXPAND THE HATCHERY', 'MORE CHICKENS', 'MORE HENS'
  ]],
  // In-place work (Phase 5) BEFORE UPGRADE_BUILDING for the same tie reason:
  // "renovate"/"renovate the building" are now the budget ladder, "add a
  // floor" stays the vertical one. Each row keeps its own wording — a tierup
  // never says bare UPGRADE, so the older row still owns that phrase.
  ['TIERUP', ['TIER UP', 'TIER UP THE SHOP', 'MOVE UP A RUNG', 'MOVE UP A TIER', 'A BIGGER SHOP', 'BIGGER SHOP', 'GROW THE SHOP', 'GROW THE STORE', 'SHOP RUNG', 'TURN THE STALL INTO A SHOP', 'UPGRADE THE SHOP']],
  ['RENOVATE', ['RENOVATE THE BUILDING', 'RENOVATE A HOUSE', 'RENOVATE THE HOUSE', 'RENOVATE THE SHOP', 'RENOVATE', 'REMODEL', 'REMODEL THE HOUSE', 'REFURBISH', 'FIX UP THE HOUSE', 'SPRUCE UP', 'IMPROVE THE HOUSE']],
  // Phase 6 footprint work. Placed with the in-place family (before
  // UPGRADE_BUILDING and the EXTEND_* rows) — a wing never lays a new lot,
  // and 'EXTEND THE BUILDING' must not fall through to EXTEND_STREET.
  ['WING', ['ADD A WING', 'BUILD A WING', 'ADD AN ANNEX', 'AN ANNEX', 'WING', 'EXTEND THE BUILDING', 'ENLARGE THE BUILDING', 'WIDEN THE BUILDING', 'GROW THE BUILDING']],
  ['EXPAND_LANDMARK', ['EXPAND THE LANDMARK', 'EXPAND LANDMARK', 'ENLARGE THE LANDMARK', 'EXTEND THE LANDMARK', 'ANNEX THE LANDMARK', 'BIGGER LANDMARK']],
  // Phase 8 — the land-use family. Here after EXPAND_LANDMARK (so "ANNEX THE
  // LANDMARK" still routes to the landmark) and before the generic UPGRADE_*
  // rows, because none of these starts with a bare UPGRADE. REZONE owns the
  // zoning wording, UPZONE the density wording, CLEAR_LOT the demolition
  // wording, ANNEX_EDGE the edge/boundary wording — each keeps clear of the
  // others' phrases, so an exact match never depends on row order.
  ['REZONE', [
    'REZONE THE LAND', 'REZONE THE LOT', 'REZONE THIS LAND',
    'CHANGE THE ZONING', 'CHANGE ZONING', 'SWAP THE ZONING',
    'RE ZONE', 'REZONE LAND', 'REZONE'
  ]],
  ['UPZONE', [
    'ALLOW TALLER BUILDINGS', 'ALLOW TALLER', 'RAISE DENSITY', 'MORE DENSITY',
    'GREATER DENSITY', 'UP ZONE', 'UPZONE', 'DENSITY'
  ]],
  ['CLEAR_LOT', [
    'CLEAR THE LOT', 'CLEAR THE LAND', 'CLEAR LOT', 'CLEAR THIS LOT',
    'DEMOLISH THE LOT', 'BULLDOZE THE LOT', 'TEAR DOWN THE BUILDING',
    'REDEVELOP THE LOT'
  ]],
  ['ANNEX_EDGE', [
    'ANNEX THE EDGE', 'ANNEX EDGE', 'BRING IN THE EDGE', 'CLAIM THE EDGE',
    'EXPAND THE BOUNDARY', 'EXTEND THE BOUNDARY', 'EXPAND THE TOWN LIMITS',
    'ANNEX LAND', 'ANNEX'
  ]],
  // Phase 7 corridor widening — BEFORE UPGRADE_BUILDING because "UPGRADE ROAD"
  // and its bare "UPGRADE" both match at position 0, and the first row listed
  // keeps the tie. Never a bare UPGRADE on its own: the ladder row always
  // names the road, so the older row still owns "upgrade the building".
  ['UPGRADE_ROAD', [
    'UPGRADE ROAD', 'UPGRADE THE ROAD', 'UPGRADE STREETS', 'UPGRADE THE STREETS',
    'UPGRADE STREET', 'UPGRADE THE STREET', 'WIDEN THE ROAD', 'WIDEN THE STREETS',
    'WIDEN THE STREET', 'WIDEN ROAD', 'WIDEN STREET', 'WIDER ROAD', 'WIDER STREET',
    'IMPROVE THE ROAD', 'IMPROVE THE STREET', 'IMPROVE THE STREETS',
    'ADD A LANE', 'MORE LANES', 'WIDEN THE CORRIDOR'
  ]],
  ['UPGRADE_BUILDING', ['UPGRADE BUILDING', 'UPGRADE THE BUILDING', 'IMPROVE THE BUILDING', 'ADD A FLOOR', 'MORE FLOORS', 'VERTICAL ADDITION', 'UPGRADE']],
  ['IMAGINE_ARCHETYPE', ['IMAGINE ARCHETYPE', 'NEW ARCHETYPE', 'DESIGN A BUILDING', 'CUSTOM BUILDING', 'INVENT A BUILDING', 'ARCHETYPE', 'IMAGINE']],
  // Footway phrases before EXTEND_STREET: no overlap today, but a path is
  // never a street — keep the rows in that order if phrases ever collide.
  ['EXTEND_FOOTWAY', ['LAY FOOTWAY', 'LAY A FOOTWAY', 'BUILD FOOTWAY', 'BUILD A FOOTWAY', 'EXTEND FOOTWAY', 'FOOTWAY', 'FOOTPATH', 'SIDEWALK', 'LAY A PATH', 'BUILD A PATH', 'PATH TO THE BACK LOTS', 'PATH']],
  // Phase 9 — the bridge is infrastructure like the street it lands on, so
  // its row sits before EXTEND_STREET: a "BRIDGE" phrasing can never fall
  // through to the road ladder, and the ladder's own phrases contain no
  // BRIDGE wording to tie with.
  ['BUILD_BRIDGE', ['BUILD A BRIDGE', 'BRIDGE THE RIVER', 'BRIDGE THE GAP', 'SPAN THE RIVER', 'CROSS THE RIVER', 'BRIDGE']],
  ['EXTEND_STREET', [
    'EXTEND STREET', 'EXTEND THE STREET', 'EXPAND STREET', 'EXPAND THE STREET',
    'EXTEND ROAD', 'EXTEND THE ROAD', 'EXPAND ROAD', 'EXPAND THE ROAD',
    'BUILD ROAD', 'NEW ROAD', 'MORE ROAD', 'STREET', 'ROAD'
  ]],
  ['EXPAND_POWER', ['EXPAND POWER', 'MORE POWER', 'POWER GRID', 'ELECTRIC', 'POWER']],
  ['EXPAND_WATER', ['EXPAND WATER', 'MORE WATER', 'WATER MAIN', 'WATER']],
  ['EXPAND_SEWAGE', ['EXPAND SEWAGE', 'SEWER', 'SEWAGE']]
];

/* --------------------------------------------------- settlement scale ladder
 * Phase 4 C1: the council was always told it ran "a small simulated town",
 * whatever the town became. These are the four rungs the prompt and the
 * report header both read from — population drives the ladder, building
 * stock gates it (a lone tower block is not a city).
 */
export const SETTLEMENT_STAGES = [
  {
    id: 'hamlet', label: 'hamlet', pop: 0, buildings: 0,
    opening: 'You are the council of a small simulated hamlet.',
    focus:
      'Survival first: water, food and power in store, beds for every household, and staff at the farms and works.'
  },
  {
    id: 'town', label: 'town', pop: 60, buildings: 12,
    opening: 'You are the council of a simulated town.',
    focus:
      'Settle the basics: housing pressure, work for everyone, and the civic services a growing town expects.'
  },
  {
    id: 'city', label: 'city', pop: 160, buildings: 35,
    opening: 'You are the council of a simulated city.',
    focus:
      'Manage scale: congestion and parking, utility capacity ceilings, civic load per facility, and land value.'
  },
  {
    id: 'metropolis', label: 'metropolis', pop: 320, buildings: 70,
    opening: 'You are the council of a simulated metropolis.',
    focus:
      'Run a region: district-wide land value, fleet readiness and open incidents, capacity ceilings, and the treasury that funds all of it.'
  }
];

/** The settlement a town currently is (last rung whose gates are both met). */
export function settlementStage(town) {
  const pop = (town && town.pedestrians && town.pedestrians.citizens.length) || 0;
  const built = (town && town.buildings && town.buildings.length) || 0;
  let stage = SETTLEMENT_STAGES[0];
  for (const s of SETTLEMENT_STAGES) if (pop >= s.pop && built >= s.buildings) stage = s;
  return stage;
}

/** Friendly labels for the build-time table the prompt and report quote. */
const HOUR_LABELS = {
  house: 'house', shop: 'shop', civic: 'civic', park: 'park', factory: 'factory',
  upgrade: 'upgrade', archetype: 'design', 'prop-tree': 'trees', 'prop-lamp': 'lamp',
  renovate: 'renovate', tierup: 'tierup', wing: 'wing',
  // Phase 20 — the office block's 26h shows in the build-times line like every
  // other crew work.
  office: 'office',
  // The four land-use orders are instant (BUILD_HOURS 0), so they are left
  // out of this table on purpose — they never take hours to show up.
  plaza: 'plaza', parking: 'parking',
  // Phase 9 — the deck takes crews 12h, so it shows up in the line.
  bridge: 'bridge'
};

/** One build-time sentence generated from BUILD_HOURS + LANDMARKS — never
 *  hand-typed, so the prompt cannot disagree with the planner (Phase 4 C2). */
function buildTimesLine() {
  const parts = Object.entries(HOUR_LABELS)
    .map(([k, label]) => `${label} ${BUILD_HOURS[k]}h`)
    .join(' · ');
  const hours = Object.values(LANDMARKS).map((l) => l.hours).filter((n) => n > 0);
  const span = hours.length ? ` · landmarks ${Math.min(...hours)}–${Math.max(...hours)}h` : '';
  return `${parts}${span} · roads/utilities instant`;
}

// Keep the creative surface concrete. The model may invent a name and a
// combination of safe flags, but it must choose a block ID and footprint that
// the live catalogue can actually build. Listing the dimensions here also
// makes the horizontal-vs-vertical trade-off visible to every provider.
const CREATIVE_ARCHETYPE_CATALOGUE = listConstructionBlocks()
  .filter((block) => ['housing', 'commerce', 'civic'].includes(block.family))
  .map((block) => `${block.id}[${block.footprint[0]}x${block.footprint[1]}]`)
  .join(', ');

const CREATIVE_ARCHETYPE_GUIDANCE = [
  'IMAGINE_ARCHETYPE is the council\'s bounded creative-build channel: choose one valid block=<id> from the catalogue, give it a useful name=, and combine only safe flags (accessible=true, solar=true, greenRoof=true, balcony=true, porch=true, garage=true, chimney=true).',
  'Prefer horizontal footprints for campus-like facilities: schools, colleges, universities, hospitals, libraries, museums, and community buildings already have larger minimum lots; use WING when an existing facility has a free same-parcel strip, and use UPGRADE_BUILDING only when another floor is the better capacity answer.',
  'A creative design must still be feasible, connected, affordable, zoned, and supported by the report. Never invent a block ID, coordinates, a facility, or a size outside the report and parser limits; if the design is not feasible, choose a listed feasible action instead.',
  `Catalogue footprints (cells): ${CREATIVE_ARCHETYPE_CATALOGUE}.`
].join(' ');

/**
 * The experiment's ethos is an epistemic contract, not a trait checklist.
 * The council is not told to be empathetic, clever, conservative, or bold;
 * those qualities should be visible only in the evidence of its choices.
 */
const COUNCIL_ETHOS = [
  'This is a controlled town-building experiment for comparing interchangeable LLM providers on the same evidence and action vocabulary.',
  'You are an accountable decision-maker, not a narrator, role-player, or code generator. Outcomes in the simulation matter more than eloquence.',
  'No personality trait is preassigned. Any quality observers later infer must emerge from reading measurements, noticing trade-offs, and learning from what actually happened.',
  'Treat the report as evidence: identify the binding constraint, distinguish a symptom from a cause, consider second-order effects, and choose one feasible action. State affected residents or places only when the report supports that inference.',
  'The Learning record is fallible empirical memory from prior enacted choices. Use repeated before/after results as clues, do not confuse correlation with causation, and do not let one surprising result override the current report.',
  'The action registry, catalogue, placement, progression, accounting, and reserve rules are fixed interfaces. Select among them; never invent an action, coordinate, budget, or rule.',
  'Provider comparisons share the report, constraints, learning record, and output contract; do not optimize for prose.',
  'A good decision is a short causal bet: name the measured constraint, choose the legal action that changes it, and leave a falsifiable trace for the next sitting.'
].join(' ');

/** The stage-free half of the prompt: everything after the identity line. */
const PROMPT_BODY = [
  'Valid actions: ' + INTENTS.join(', '),
  'Reply on the first line as: INTENT: <ACTION>, then at most one short sentence of reasoning.',
  'Protocol: resolve measured emergencies/dependencies first (food, water, power, sewage, staffing, runway), then average congestion, housing, civic/transport capacity, jobs, progression, and optional work. Preserve solvency.',
  'Cabinet allocation: keep roughly 70% of selected work on the report\'s immediate Priority or mandatory remedies and reserve roughly 30% for longer-term vision. A long-term idea never displaces a feasible measured emergency.',
  'Choose one Priority/Feasible action. If it is Blocked, choose its named prerequisite or NO_ACTION; do not repeat it until evidence changes. Compare the strongest feasible alternative and state the number and horizon it should change.',
  'If the report contains MANDATORY COUNCIL REMEDY, that is a sequencing directive from the measured emergency: choose that exact remedy in this sitting unless TRADE_BUY or HIRE_WORKERS is the evidence-backed direct fix.',
  'Prefer DEVELOP_HOUSING when homes are scarce, EXPAND_* when a utility is over capacity,',
  'UPGRADE_BUILDING to raise an existing building a floor (especially one whose Load shows over capacity), IMAGINE_ARCHETYPE to commission a new design.',
  CREATIVE_ARCHETYPE_GUIDANCE,
  'RENOVATE lifts a building up the budget ladder (optional spec: budget=1..3), TIERUP moves a shop up a commerce rung (optional spec: tier=' +
    Object.keys(SHOP_TIERS).join('|') +
    '),',
  'WING grows a building into a free strip of its OWN parcel (no new lot), and EXPAND_LANDMARK type=' +
    Object.keys(LANDMARKS).join('|') +
    ' annexes a strip beside a landmark already built — it may buy out the neighbour, so it costs more,',
  '(optional spec after the intent: block=<catalogue id> zone=house|shop|civic style=suburban|cottage|townhouse floors=1..' + MAX_FLOORS + ' roof=gable|hip|flat budget=1..3 size=WxH porch garage chimney accessible solar greenRoof name=Some Name' +
    ' — zone=civic adds facility=' +
    Object.keys(CIVIC_CATALOGUE).join('|') +
    '),',
  'BUILD_FACTORY to commission a works when building materials run short',
  '(optional spec: type=' + FACTORY_TYPES.map((f) => f.id).join('|') + '),',
  'OPEN_SHOP when work is scarce (optional spec: tier=stall|kiosk|shop|store — the planner picks the lot size either way),',
  // Phase 20 — the office block, which is NOT a shop: it earns from the desks
  // it fills, so its revenue is capacity × staffed and it takes no share of the
  // day's footfall.
  'BUILD_OFFICE when work is scarce and the town has no office block (optional spec: name=Some Name, floors=2..' + MAX_FLOORS + ') — an office earns from its desks, not from passing trade,',
  'UPGRADE_RESOURCE when the report shows a primary resource DRY or in DEFICIT — raises that resource\u2019s site output (optional spec: resource=' + ORDER.join('|') + '; pin the yard with kind=farm|husbandry|poultry, e.g. UPGRADE_RESOURCE resource=food kind=husbandry to grow the ranch rather than the first food site),' ,
  'PLANT_TREES/INSTALL_LAMP for street improvements, EXTEND_FOOTWAY to lay a footpath that unlocks an inland lot, HIRE_WORKERS only when Staff shows a fundable vacancy at farms, power works, businesses, or civic buildings and the town has spare beds; HIRE_WORKERS imports staff and is not an unemployment remedy for residents already in town,',
  // Phase 16 — arrivals are a function of a derived band, so the lever is the
  // pull, not a number. The Settlers line is the whole story.
    'ATTRACT_SETTLERS spends $' + CAMPAIGN.cost + ' to advertise the town for ' + CAMPAIGN.days +
    ' days, multiplying the Settlers pull by ' + CAMPAIGN.multiplier + ' — useless with no spare beds or no open posts, so read the Settlers line first,',
  // Phase 17 — research. The buckets and their ceilings are quoted from the
  // system, and the levers from its registry, so the model is told exactly what
  // a programme buys.
  'FUND_INNOVATION puts a daily budget into one research bucket (optional spec: bucket=' + BUCKET_IDS.join('|') +
    ' — bare takes the one with the most headroom, and the order spends the whole ceiling):',
  'each bucket is limited by its own basis — ' + BUCKET_IDS.map((id) => `${BUCKETS[id].label} needs ${BUCKETS[id].hint}`).join(' · ') + ',',
  'and a finished programme applies one of these gains: ' + LEVER_IDS.map((k) => `${k} (${LEVERS[k].hint})`).join(' · ') +
    '. The next programme is always the town\u2019s own weakest number, printed on the Research line,',
  'EXTEND_STREET (also EXPAND_STREET) chooses a legal run only when the congestion average since the previous sitting is above the road gate and observed trips or a disconnected component justify it; the report also shows the instantaneous value, range, duration, and sample count for context; graph planning uses connected components, weighted shortest paths, measured OD relief, and a deterministic frontage/continuation foresight tie-break; the council chooses whether to order it, not its coordinates,',
  'ACQUIRE_LAND buys surveyed frontier tiles only after the current acquired land has no usable serviced plot left; it is priced per fresh tile and must leave the public reserve intact,',
  'BUILD_TRANSIT (optional spec: facility=busdepot|transit) commissions a bus depot or transit hub; the network then selects separated road stops, registers buses in proportion to population, and reports coverage and ridership,',
  'BUILD_CIVIC facility=police|fire|clinic|hospital adds response stations as population grows; state vehicles require a real station and are procured only when coverage or open calls justify them,',
  'RESTRUCTURE_BUILDING clears and rebuilds one eligible occupied lot with a safe additional floor; it preserves the footprint and facility and records the demolition,',
  'UPGRADE_ROAD widens the longest eligible straight corridor one rung up the ladder ' +
    XS_CLASS_ORDER.join('>') +
    ' (optional spec: class=' +
    XS_CLASS_ORDER.join('|') +
    ') — priced per cell to climb, and it never touches a junction, bridge or ramp,',
  // Phase 9 — the crossing that is NOT on the ladder: roads stop at the
  // water, only this order builds over it (and only the short gaps).
  'BUILD_BRIDGE throws a deck across a river gap of up to ' + MAX_BRIDGE_GAP +
    ' cells where roads already end on both banks — priced per cell in cash and in steel from the storehouse,',
  // Phase 8 — surface works and the land-use family, spelled out where the
  // other build verbs are spelled out. plaza/parking take crew hours like a
  // park; the four land-use orders are instant (absent from HOUR_LABELS).
  'PAVE_PLAZA paves a street-fronting civic square and ADD_PARKING reserves a kerbside parking bay (both priced like a park, no materials),',
  'REZONE zone=' +
    LAND_ZONE_IDS.join('|') +
    ' repaints a district, UPZONE raises density so houses build taller, CLEAR_LOT tears one building down, and ANNEX_EDGE zones the outer ring' +
    ' (zone= optional there — defaults to the town\u2019s own dominant zone) — all four land-use orders are instant,',
  'BUILD_LANDMARK type=' +
    Object.keys(LANDMARKS).join('|') +
    ' only when Feasible now lists it — each acquires a whole block sized by the planner,',
  'TRADE_BUY to restock the storehouse and TRADE_SELL to clear a surplus (optional spec: commodity=' +
    COMMODITIES.join('|') +
    ' qty=1..200 — a bare order takes the default buy/sell printed on the report\u2019s Stocks line),',
  'RAISE_TAX/CUT_TAX only when the treasury is clearly unhealthy,',
  'SET_ASIDE_RESERVE banks a quarter of the treasury, SLASH_SPENDING trims outgoings, and BOND_ISSUE borrows 10% of GDP at 5% a year only when the report shows a short operating runway and debt headroom,',
  'SUBSIDY grants cash to the weakest shop for 20 days,',
  'HOST_EVENT runs a festival at a venue (once a week), DECLARE_EMERGENCY holds open calls, DISPATCH_UNITS sends the fleet out now,',
  'and STUDY_ROAD/STUDY_ECONOMY/STUDY_DEMOGRAPHICS/STUDY_TRAFFIC/STUDY_INCIDENTS are read-outs of one subsystem — advisory, never a build.',
  // Phase 15 — policy. The scheme and statute tables are quoted from the data,
  // and the effect vocabulary is quoted from the interpreter's registry, so the
  // prompt can never drift from what the systems actually do.
  'ENACT_SCHEME starts a timed programme and END_SCHEME winds one up early (optional spec: scheme=' + SCHEME_IDS.join('|') + ' — bare takes the first affordable one):',
  'PASS_LAW puts a statute in force and REPEAL_LAW takes it out again (optional spec: law=' + LAW_IDS.join('|') + ' — bare takes the first one not yet law).',
  'Programmes and statutes use only these effects: ' +
    EFFECT_KEYS.map((k) => `${k} (${MODIFIERS[k].hint})`).join(' · ') +
    '. A scheme costs its entry fee then a daily amount for its run; a law costs once and holds until repealed.',
  'and NO_ACTION when the town is fine — when the report says "Priority: none outstanding", reply NO_ACTION.',
  'House building needs Population pressure above ' + HOUSE_PRESSURE_GATE + ' with the proportional spare-bed buffer (at least ' + HOUSE_SPARE_BEDS + ' beds, 12% of population, plus a two-bed rounding cushion);',
  'UPGRADE_BUILDING also fires when a facility is over ' + CIVIC_LOAD_GATE + ' load; IMAGINE_ARCHETYPE only above ' +
    FILLER_PRESSURE_GATE + ' pressure — and crews hold at ' + MAX_ACTIVE + ' open sites.',
  // Phase 18 — the district is that idea scaled: ONE order becomes an ordered
  // queue the crews walk across cycles, sized from the town's own gaps rather
  // than from an authored layout.
  'BUILD_DISTRICT commissions a whole district as one order — the crews then work through a queue of roads, homes, shops, civic buildings and works, sized from the town\u2019s own housing pressure, strained resources and worst-loaded facility,',
  'and every build that lands off the network lays its own access road and pays for it, so nothing is ever stranded — read the Connectivity line for how many components the town has,',
  '"Feasible now (builds)", "Blocked" and "Priority" are ground truth: build only from Feasible now —',
  'a Blocked public pick cannot start; the Council must choose a later remedy from the next report. Private developers remain independent and may commission private commerce from their own accounts, but they do not substitute the Council\'s blocked public motion. Non-build actions (tax, trade, hire, finance, festival, emergency, study, ATTRACT_SETTLERS, FUND_INNOVATION, ENACT_SCHEME, END_SCHEME, PASS_LAW, REPEAL_LAW, EXTEND_FOOTWAY, NO_ACTION) are always available,',
  // The land-use family is never ranked (see ranked()), so — like EXTEND_
  // FOOTWAY — it must be declared always available or the "build only from
  // Feasible now" rule would make it unorderable. plaza/parking are ranked
  // when the town needs them, and orderable anyway when it does not;
  // BUILD_BRIDGE is ranked only for a gap that would reconnect the road
  // ends, so a plain (redundant) crossing also needs the declaration.
  'PAVE_PLAZA, ADD_PARKING, REZONE, UPZONE, CLEAR_LOT, ANNEX_EDGE and BUILD_BRIDGE are also always available —' +
    ' the planner only lists PAVE_PLAZA/ADD_PARKING when a square or a bay is wanted and BUILD_BRIDGE when a gap would reconnect two road ends,',
  'ACQUIRE_LAND and RESTRUCTURE_BUILDING are discretionary Feasible-now rows only when the frontier is needed (all acquired serviced land is exhausted) or renewal candidates exist; they stay out of the demand fallback,',
  'PARK_LAND, PAVE_PLAZA, IMAGINE_ARCHETYPE, a filler floor, a comfortable-town RENOVATE and a WING are amenity work: they show up in Feasible now but never in Priority —',
  'TIERUP only reaches Priority while unemployment is above ' + UNEMPLOYMENT_PCT + '%, since it grows shop capacity without a new lot,',
  'when Priority reads "none outstanding", reply NO_ACTION rather than inventing work.',
  'Construction takes hours (' + buildTimesLine() + ').'
].join(' ');

/** Default prompt for a town with no stage context (tests, HUD previews). */
export const SYSTEM_PROMPT = [
  COUNCIL_ETHOS,
  PROMPT_BODY
].join(' ');

/** Stage-shaped system prompt: identity line, stage focus, shared body. */
export function systemPrompt(town, options = {}) {
  const st = settlementStage(town);
  // Phase 19 — the council is told who it has been, and that sentence is
  // computed from its own decision ledger, not written. A town with no
  // decisions gets the neutral line and nothing else.
  const p = town && town.governance ? persona(town.governance.ledger) : null;
  const voice = p && !p.empty
    ? ` Your own record: ${p.lines.join('; ')}. Be consistent with that — it is what you have already been.`
    : '';
  const learning = town?.governance?.learning?.promptLine?.()
    || 'Learning record: no measured outcomes yet; treat every action as an experiment and establish a baseline.';
  const mode = options.cabinet ?
    ' Read the town report and prepare one evidence-backed motion for each Cabinet department; return the Cabinet JSON contract that follows.' :
    ' Read the town report and choose exactly one action.';
  if (options.cabinetCouncil) {
    return [
      'You are the final Town Council synthesis chamber. Five independent ministers have reported; your job is to compare their evidence-backed candidate motions and set the town\'s priorities for this sitting.',
      st.opening,
      st.focus,
      'Use the town report as ground truth. Resolve any mandatory remedy first. Prefer a measured Priority build, utility, housing, supply, staffing, employment, or mobility action over optional policy when the report shows one. Select only candidate motion IDs supplied in the user message; never invent an intent, department, coordinate, budget, catalogue id, or action.',
      'Return exactly one JSON object: {"selected":[{"id":"motion-1","priority":0.0,"reason":"short evidence-backed reason"}]}. Select at most five unique candidates, normally one per department. Aim for roughly 70% immediate Priority/mandatory candidates and 30% longer-term candidates when both exist. Select at least one candidate when any admitted candidate is feasible; return {"selected":[]} only when every candidate is infeasible or the report gives no defensible action.',
      'The selected candidates are recommendations for the existing Mayor/planner validation boundary. Do not claim execution. Traits are emergent from evidence and outcomes; do not optimize for a prescribed personality.',
      voice,
      learning
    ].filter(Boolean).join(' ');
  }
  // Each Cabinet minister receives its own provider call. The department
  // branch is intentionally compact enough that this minister can retain a
  // full report and its own role/remit inside the 4K prompt budget instead of
  // sharing one crowded multi-department instruction.
  if (options.cabinetDepartment) {
    const department = options.cabinetDepartment;
    const focus = department.systemPrompt || department.remit || 'Use the report evidence for this department.';
    return [
      COUNCIL_ETHOS,
      st.opening,
      st.focus,
      `You are the ${department.label} Cabinet minister. ${focus}`,
      `Your owned canonical intents are: ${department.intents.join(', ')}.`,
      'Read the town report as evidence. Resolve a mandatory remedy first; choose only a legal action supported by Feasible now, Priority, or an explicit always-available rule. If this department owns a Priority remedy, submit it before a long-term study, scheme, design, or vision action. If Priority contains a build or service remedy outside this department, return NO_ACTION. Do not use ENACT_SCHEME, PASS_LAW, or HOST_EVENT while any measured Priority remains. Do not invent coordinates, budgets, IDs, or actions.',
      'Return exactly one JSON object: {"motions":[{"department":"' + department.id + '","intent":"CANONICAL_INTENT","reason":"short measured reason","priority":0.0,"params":{}}]}. Use priority 0..1. Typed builds require their exact Feasible-now parameter: BUILD_LANDMARK params.type=<landmark id>, BUILD_FACTORY params.type=<factory id>, BUILD_CIVIC/BUILD_TRANSIT params.facility when applicable, and IMAGINE_ARCHETYPE params.block=<catalogue id>. Never emit a bare typed-build intent; use NO_ACTION if no legal catalogue row is named.',
      voice,
      learning
    ].filter(Boolean).join(' ');
  }
  return COUNCIL_ETHOS + ' ' + st.opening + ' ' + st.focus + mode + voice + ' ' + learning + ' ' + PROMPT_BODY;
}

// The full HUD report is intentionally rich, but small local models often
// expose a 2K context window even when the UI allows a 4K Council budget. A
// minister needs the measured rows relevant to its remit, not every catalogue
// line, so keep the report evidence dense enough to fit prompt plus output.
const CABINET_REPORT_PREFIXES = Object.freeze({
  common: [
    'TOWN REPORT', 'Construction kits:', 'Population ', 'Buildings:', 'Land:',
    'Treasury ', 'Budget:', 'Employment:', 'Feasible now', 'Blocked:', 'Priority:',
    'Intent map:', 'Construction:', 'Warnings:', 'Last decision:'
  ],
  treasury: ['Economy:', 'Employment:', 'Industry:', 'Staff:', 'Primary resources:', 'Stocks:', 'Trade:', 'HIRE_WORKERS', 'TRADE_BUY', 'TRADE_SELL', 'BOND_ISSUE', 'FUND_INNOVATION'],
  land: ['Society:', 'Settlers:', 'Civic load:', 'Design opportunity:', 'Connectivity:'],
  infrastructure: ['Congestion average', 'Road planning:', 'Services:', 'Connectivity:'],
  services: ['Society:', 'Weather:', 'Emergency:', 'Services:', 'Industry:', 'Staff:', 'Utilities:', 'Electricity:', 'Primary resources:', 'Waste flow:'],
  society: ['Society:', 'Weather:', 'Settlers:', 'Civic load:', 'Tourism:', 'Design opportunity:', 'Research:', 'Schemes:', 'Laws:', 'Policy effects:'],
  council: [
    'Society:', 'Weather:', 'Settlers:', 'Economy:', 'Employment:', 'Industry:', 'Staff:',
    'Primary resources:', 'Stocks:', 'Trade:', 'Congestion average', 'Road planning:',
    'Emergency:', 'Services:', 'Utilities:', 'Electricity:', 'Waste flow:',
    'District:', 'Connectivity:', 'Research:', 'Schemes:', 'Laws:', 'Policy effects:',
    'Civic load:', 'Design opportunity:'
  ]
});

function cabinetReportFor(report, departmentId = 'council') {
  const rows = String(report || '').split(/\r?\n/).filter(Boolean);
  const prefixes = new Set([
    ...CABINET_REPORT_PREFIXES.common,
    ...(CABINET_REPORT_PREFIXES[departmentId] || CABINET_REPORT_PREFIXES.council)
  ]);
  const selected = rows.filter((row) => [...prefixes].some((prefix) => row.startsWith(prefix)));
  const limit = departmentId === 'council' ? 4000 : 3600;
  const compact = selected.join('\n');
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}\n[report truncated to fit this provider context]`;
}

function normalize(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return prev[n];
}

const ARCHETYPE_ZONES = ['house', 'shop', 'civic'];

/**
 * Phase 29 (S19a) — the `name=` spec, cleaned at the PARSER.
 *
 * `name=` is the one spec slot that carries model-authored free text into the
 * sim: it becomes `b.name` (`startPlacement.js`), a business name, a 3D street
 * sign, and — via `plan.label` — the council's own log line. Escaping at the
 * sink (the other half of this fix) stops it executing, but nothing stopped a
 * 4KB string, a newline or a control character from reaching the DOM and the
 * sign texture. So the value is normalised here, once, for all four parsers:
 * control characters out, whitespace collapsed, hard length cap.
 */
export const NAME_MAX = 30;
export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/**
 * The `name=` capture, shared by every parser that accepts one. Deliberately
 * greedy-but-bounded: it stops at the next `spec=`-shaped token, a newline, a
 * pipe or sentence punctuation, so "name=The Anchor budget=2" yields "The
 * Anchor" rather than swallowing the next slot.
 */
const NAME_RE = /\bname\s*[=:]\s*([^\n|]{1,40}?)(?=\s+[a-z_]+\s*[=:]|\s*$|[.,;])/i;
/** The terse form, for a bare single-token shop name. */
const NAME_WORD_RE = /\bname\s*[=:]\s*([^\s,;]{1,40})/i;

/** Pull a `name=` out of a spec line, capped and cleaned. Returns null if absent. */
function nameFrom(s, re) {
  const nm = s.match(re);
  if (!nm || !nm[1].trim()) return null;
  return cleanName(nm[1]);
}

/** Pull an IMAGINE_ARCHETYPE kit spec (zone/style/floors/…) from raw text —
 *  normalize() strips '=', so this must run before it.
 *
 *  Strict by design: every value that is PRESENT is validated. An invalid
 *  zone/style/floors lands in `spec.issues`, and `enact` rejects the whole
 *  decision with that detail instead of silently randomising. A creative
 *  request must name a catalogue block or a facility (which infers its civic
 *  block); a completely bare IMAGINE_ARCHETYPE is not an executable design. */
function parseArchetypeSpec(raw) {
  const s = String(raw || '');
  const spec = {};
  const issues = [];

  const blockM = s.match(/\b(?:block|kit)\s*[=:]\s*([a-z0-9_.-]+)/i);
  if (blockM) {
    const block = constructionBlock(blockM[1]);
    if (block) spec.blockId = block.id;
    else issues.push(`unknown construction block "${blockM[1]}"`);
  }

  const zoneM = s.match(/\bzone\s*[=:]\s*([a-z0-9_-]+)/i);
  if (zoneM) {
    const v = zoneM[1].toLowerCase();
    if (ARCHETYPE_ZONES.includes(v)) spec.zone = v;
    else issues.push(`unknown zone "${zoneM[1]}" — use ${ARCHETYPE_ZONES.join(', ')}`);
  }
  if (!spec.zone && spec.blockId) {
    if (spec.blockId.startsWith('civic.')) spec.zone = 'civic';
    else if (spec.blockId === 'mixed.use' || spec.blockId === 'office.lobby') spec.zone = 'shop';
    else if (spec.blockId.startsWith('house.')) spec.zone = 'house';
  }
  if (!spec.zone) spec.zone = 'house';

  const floorsM = s.match(/\bfloors?\s*[=:]\s*(\S+)/i) || s.match(/\b(\d{1,2})\s*[- ]?floors?\b/i);
  if (floorsM) {
    const n = parseInt(floorsM[1], 10);
    if (Number.isFinite(n)) spec.floors = Math.max(1, Math.min(MAX_FLOORS, n));
    else issues.push(`floors "${floorsM[1]}" is not a number — use 1 to ${MAX_FLOORS}`);
  }

  const styleM = s.match(/\bstyle\s*[=:]\s*([a-z0-9_-]+)/i);
  if (styleM) {
    const v = styleM[1].toLowerCase();
    if (HOUSE_STYLES.includes(v)) spec.style = v;
    else {
      // One typo away from a real style? Correct it; anything else is rejected.
      const near = HOUSE_STYLES.filter((w) => lev(v, w) <= 1);
      if (near.length === 1) spec.style = near[0];
      else issues.push(`unknown style "${styleM[1]}" — use ${HOUSE_STYLES.join(', ')}`);
    }
  } else {
    const bare = s.match(/\b(suburban|cottage|townhouse)\b/i);
    if (bare) spec.style = bare[1].toLowerCase();
  }

  if (/\bgarage\b/i.test(s)) spec.garage = true;
  const porch = s.match(/\bporch\s*[=:]\s*(true|false)\b/i);
  if (porch) spec.porch = porch[1].toLowerCase() === 'true';
  else if (/\bporch\b/i.test(s)) spec.porch = true;
  const chimney = s.match(/\bchimney\s*[=:]\s*(true|false)\b/i);
  if (chimney) spec.chimney = chimney[1].toLowerCase() === 'true';
  else if (/\bchimney\b/i.test(s)) spec.chimney = true;

  // Shared Building Kit blocks. Each flag is optional, but an explicit value
  // is strict so the council cannot silently get a different frontage.
  for (const key of ['accessible', 'balcony', 'solar', 'greenRoof']) {
    const explicit = s.match(new RegExp(`\\b${key}\\s*[=:]\\s*(true|false)\\b`, 'i'));
    if (explicit) spec[key] = explicit[1].toLowerCase() === 'true';
    else {
      const phrase = key.replace(/[A-Z]/g, (c) => `\\s*-?\\s*${c.toLowerCase()}`);
      if (new RegExp(`\\b${phrase}\\b`, 'i').test(s)) spec[key] = true;
    }
  }

  // KIT DEPTH — the rest of the kit surface, same strict contract: values
  // that are PRESENT are validated (bad → issues), values never mentioned
  // fall back to planFor's defaults.
  const roofM = s.match(/\broof\s*[=:]\s*([a-z]+)/i);
  if (roofM) {
    const v = roofM[1].toLowerCase();
    if (['gable', 'hip', 'flat'].includes(v)) spec.roofType = v;
    else issues.push(`unknown roof "${roofM[1]}" — use gable, hip, flat`);
  }
  const budM = s.match(/\bbudget\s*[=:]\s*(\d+)/i);
  if (budM) {
    const n = parseInt(budM[1], 10);
    if (n >= 1 && n <= 3) spec.budget = n;
    else issues.push(`budget "${budM[1]}" — use 1 (rudimentary) to 3 (advanced)`);
  }
  const sizeM = s.match(/\bsize\s*[=:]\s*(\d{1,2})\s*[x×]\s*(\d{1,2})/i);
  if (sizeM) {
    const cols = parseInt(sizeM[1], 10);
    const rows = parseInt(sizeM[2], 10);
    if (cols >= 1 && rows >= 1 && cols <= 4 && rows <= 4 && cols * rows <= 8) {
      spec.size = { cols, rows };
    } else {
      issues.push(`size "${sizeM[1]}x${sizeM[2]}" — use up to 4x4 and at most 8 cells`);
    }
  }
  const facM = s.match(/\bfacility\s*[=:]\s*([a-z0-9_-]+)/i);
  if (facM) {
    const v = facM[1].toLowerCase();
    if (CIVIC_CATALOGUE[v]) spec.facility = v;
    else issues.push(`unknown facility "${facM[1]}" — use ${Object.keys(CIVIC_CATALOGUE).join(', ')}`);
    // Facility is an unambiguous civic signal. Older prompt wording required
    // the model to repeat zone=civic, which made otherwise valid creative
    // designs fail at the parser boundary. Infer the zone when omitted, but
    // still reject an explicit conflicting zone.
    if (spec.facility && !zoneM) spec.zone = 'civic';
    if (spec.facility && spec.zone !== 'civic') issues.push('facility= requires zone=civic');
    if (spec.facility && !spec.blockId) {
      const civicBlock = constructionBlock(`civic.${spec.facility}`);
      if (civicBlock) spec.blockId = civicBlock.id;
    }
  }
  if (spec.blockId?.startsWith('civic.') && !spec.facility) {
    const facility = spec.blockId.slice('civic.'.length);
    if (CIVIC_CATALOGUE[facility]) spec.facility = facility;
  }
  if (spec.blockId && !spec.blockId.startsWith('house.') && !spec.blockId.startsWith('civic.') && !['mixed.use', 'office.lobby'].includes(spec.blockId)) {
    issues.push(`construction block ${spec.blockId} belongs to another build intent`);
  }

  // A bare creative intent used to fall through to a generic one-storey
  // house, so a Cabinet minister could submit a design without naming the
  // kit being commissioned. Facility-only requests remain valid because the
  // parser has already inferred civic.<facility> above.
  if (!blockM && !facM) {
    issues.push('spec needs block=<catalogue id> or facility=<civic id>');
  }

  const name = nameFrom(s, NAME_RE);
  if (name) spec.name = name;
  if (issues.length) spec.issues = issues;
  return spec;
}

/** Parse the optional catalogue variant on ordinary DEVELOP_HOUSING. */
function parseHousingSpec(raw) {
  const s = String(raw || '');
  const spec = {};
  const issues = [];
  const blockM = s.match(/\b(?:block|kit)\s*[=:]\s*([a-z0-9_.-]+)/i);
  if (blockM) {
    const block = constructionBlock(blockM[1]);
    if (!block) issues.push(`unknown housing block "${blockM[1]}"`);
    else if (block.family !== 'housing') issues.push(`block ${block.id} is not a housing block`);
    else spec.blockId = block.id;
  }
  if (issues.length) spec.issues = issues;
  return spec;
}

/** Pull a BUILD_FACTORY spec (type/name) from raw text — same strict rules
 *  as the archetype spec: a bad value rejects the decision outright. */
function parseFactorySpec(raw) {
  const s = String(raw || '');
  const spec = {};
  const issues = [];

  const typeM = s.match(/\btype\s*[=:]\s*([a-z0-9_-]+)/i);
  if (typeM) {
    const v = typeM[1].toLowerCase();
    let def = FACTORY_TYPES.find((f) => f.id === v);
    if (!def && v.length >= 3) {
      const near = FACTORY_TYPES.filter((f) => f.id.startsWith(v));
      if (near.length === 1) def = near[0];
    }
    if (def) spec.factory = def.id;
    else issues.push(`unknown factory "${typeM[1]}" — use ${FACTORY_TYPES.map((f) => f.id).join(', ')}`);
  }

  const name = nameFrom(s, NAME_RE);
  if (name) spec.name = name;
  if (issues.length) spec.issues = issues;
  return spec;
}

/** Pull a BUILD_LANDMARK spec (type/name) from raw text — same strict rules
 *  as the factory spec: an unknown value rejects the decision outright.
 *  With no type= the catalogue's own phrases decide (the keyword route:
 *  "build a stadium" → type=stadium); no match is an issue, never a guess. */
function parseLandmarkSpec(raw) {
  const s = String(raw || '');
  const spec = {};
  const issues = [];
  const ids = Object.keys(LANDMARKS);

  const typeM = s.match(/\btype\s*[=:]\s*([a-z0-9_-]+)/i);
  if (typeM) {
    const v = typeM[1].toLowerCase();
    let def = LANDMARKS[v];
    if (!def && v.length >= 3) {
      const near = ids.filter((id) => id.startsWith(v));
      if (near.length === 1) def = LANDMARKS[near[0]];
    }
    if (def) spec.landmark = def.id;
    else issues.push(`unknown landmark "${typeM[1]}" — use ${ids.join(', ')}`);
  } else {
    const up = s.toUpperCase();
    const hit = ids.map((id) => LANDMARKS[id]).find((lm) => lm.phrases.some((p) => up.includes(p)));
    if (hit) spec.landmark = hit.id;
    else issues.push(`spec needs type=${ids.join('|')}`);
  }

  const name = nameFrom(s, NAME_RE);
  if (name) spec.name = name;
  if (issues.length) spec.issues = issues;
  return spec;
}

const TRADE_ALIASES = { wood: 'lumber', planks: 'lumber', iron: 'steel', concrete: 'cement', product: 'goods', merchandise: 'goods', textiles: 'cloth', app: 'software', apps: 'software', seat: 'furniture', chair: 'furniture' };
// Phase 12 — the trade keys ARE the commodity table: a new works row is a
// new tradable item with no grammar change.
const TRADE_KEYS = COMMODITIES;

/** Pull a TRADE_BUY/TRADE_SELL spec (commodity/qty) from raw text. */
function parseTradeSpec(raw) {
  const s = String(raw || '');
  const spec = {};
  const issues = [];

  const cm = s.match(/\b(?:commodity|item|material|stock)\s*[=:]\s*([a-z0-9_-]+)/i);
  let key = cm ? cm[1].toLowerCase() : null;
  if (!key) {
    for (const k of TRADE_KEYS) {
      if (new RegExp(`\\b${k}\\b`, 'i').test(s)) {
        key = k;
        break;
      }
    }
  }
  if (key) {
    const final = TRADE_ALIASES[key] || key;
    if (TRADE_KEYS.includes(final)) spec.commodity = final;
    else issues.push(`unknown commodity "${key}" — use ${TRADE_KEYS.join(', ')}`);
  }

  const qm =
    s.match(/\b(?:qty|quantity|units?|lots?)\s*[=:]\s*(\d{1,4})/i) ||
    s.match(/\b(\d{1,4})\s*(?:units?|tons?|lots?)\b/i);
  if (qm) spec.qty = Math.max(1, Math.min(200, parseInt(qm[1], 10)));

  if (issues.length) spec.issues = issues;
  return spec;
}

/** Pull an OPEN_SHOP spec from raw text. tier is optional — a bare OPEN_SHOP
 *  stays valid and lets the chooser pick the rung; when PRESENT it must name
 *  a SHOP_TIERS rung (bad value → issues, rejects the whole decision), the
 *  same strict-by-design contract as the archetype/factory/landmark specs.
 *  name= names the shop; both flow through planFor's opts. */
function parseShopSpec(raw) {
  const s = String(raw || '');
  const spec = {};
  const issues = [];

  const tm = s.match(/\btier\s*[=:]\s*([a-z0-9_-]+)/i);
  if (tm) {
    const v = tm[1].toLowerCase();
    const ids = Object.keys(SHOP_TIERS);
    let id = SHOP_TIERS[v] ? v : null;
    if (!id && v.length >= 3) {
      const near = ids.filter((k) => k.startsWith(v));
      if (near.length === 1) id = near[0];
    }
    if (id) spec.tier = id;
    else issues.push(`unknown tier "${tm[1]}" — use ${ids.join(', ')}`);
  }

  const name = nameFrom(s, NAME_WORD_RE);
  if (name) spec.name = name;

  if (issues.length) spec.issues = issues;
  return spec;
}

export function parseIntent(text) {
  const r = parseIntentCore(text);
  if (r.intent === 'IMAGINE_ARCHETYPE') r.params = parseArchetypeSpec(text);
  else if (r.intent === 'DEVELOP_HOUSING') r.params = parseHousingSpec(text);
  else if (r.intent === 'BUILD_FACTORY') r.params = parseFactorySpec(text);
  else if (r.intent === 'BUILD_LANDMARK' || r.intent === 'EXPAND_LANDMARK') r.params = parseLandmarkSpec(text);
  else if (r.intent === 'OPEN_SHOP') r.params = parseShopSpec(text);
  else if (r.intent === 'TRADE_BUY' || r.intent === 'TRADE_SELL') r.params = parseTradeSpec(text);
  else if (r.intent === 'UPGRADE_RESOURCE') r.params = parseResourceSpec(text);
  else if (r.intent === 'BUILD_CIVIC' || r.intent === 'EXPAND_CLINIC') r.params = parseCivicSpec(text);
  else if (r.intent === 'BUILD_TRANSIT') {
    const norm = normalize(text);
    const pinned = norm.match(/\bFACILITY\s*=\s*(BUSDEPOT|TRANSIT)\b/);
    r.params = { facility: pinned ? pinned[1].toLowerCase() : norm.includes('BUS DEPOT') ? 'busdepot' : 'transit' };
  }
  else if (r.intent === 'RENOVATE') r.params = parseRenovateSpec(text);
  else if (r.intent === 'TIERUP') r.params = parseTierupSpec(text);
  else if (r.intent === 'UPGRADE_ROAD') r.params = parseRoadClassSpec(text);
  // Phase 8 — land use. REZONE always needs zone= (there is nothing sensible
  // to repaint without one); ANNEX_EDGE takes it optionally and falls back to
  // the town's own dominant zone in the planner.
  else if (r.intent === 'REZONE') r.params = parseLandZoneSpec(text, { required: true });
  else if (r.intent === 'ANNEX_EDGE') r.params = parseLandZoneSpec(text);
  // Phase 15 — policy. A bare ENACT_SCHEME/END_SCHEME/REPEAL_LAW is legal (the
  // planner resolves the id), so only a PRESENT-but-unknown id is a refusal.
  // `currentTown` is module state because parseIntent is a free function, not a
  // method — the probes call it directly, so it cannot close over `this`.
  else if (r.intent === 'ENACT_SCHEME') r.params = parseSchemeSpec(text, { list: [...SCHEME_IDS, ...LAW_IDS] });
  else if (r.intent === 'END_SCHEME') {
    r.params = parseSchemeSpec(text, { list: currentTown?.policy?.active.map((s) => s.id) });
  }   else if (r.intent === 'PASS_LAW') r.params = parseSchemeSpec(text, { list: LAW_IDS, what: 'law' });
  else if (r.intent === 'REPEAL_LAW') {
    r.params = parseSchemeSpec(text, { list: currentTown?.policy?.laws.map((l) => l.id), what: 'law' });
  }
  // Phase 17 — bucket=<id>. A bare FUND_INNOVATION is legal (the handler takes
  // the bucket with the most headroom), so only a PRESENT-but-unknown bucket
  // is a refusal.
  else if (r.intent === 'FUND_INNOVATION') r.params = parseBucketSpec(text);
  return r;
}

/**
 * Phase 17 — `bucket=<id>`, with the everyday synonyms a model reaches for
 * (SCHOOLS for academia, WORKS/FIRMS for companies, SURVEY for exploration).
 */
export function parseBucketSpec(text) {
  const m = String(text || '').match(/\bbucket\s*[=:]\s*["']?([a-z0-9_-]+)/i);
  if (!m) return {};
  const raw = m[1].toLowerCase();
  const hit = BUCKET_IDS.find((id) => id === raw) || BUCKET_ALIASES[raw];
  if (hit) return { bucket: hit };
  return { issues: [`unknown research bucket "${m[1]}" — use ${BUCKET_IDS.join('|')}`] };
}

/** Everyday names for the three research buckets, in the reply vocabulary. */
const BUCKET_ALIASES = {
  school: 'academia',
  schools: 'academia',
  university: 'academia',
  science: 'academia',
  firms: 'companies',
  works: 'companies',
  industry: 'companies',
  business: 'companies',
  survey: 'exploration',
  surveys: 'exploration',
  surveyors: 'exploration',
  frontier: 'exploration',
  map: 'exploration'
};

/**
 * Phase 15 — `scheme=<id>` / `law=<id>`. Accepts either spelling for either
 * intent (a model says "ENACT_SCHEME law=green_belt" as readily as
 * "PASS_LAW law=green_belt"). Ids are matched separator-insensitively, so
 * `green-belt`, `green_belt` and `GreenBelt` all find the same row. Returns
 * `issues` when the id is present but unknown, so the council is told the real
 * list rather than silently getting the wrong programme.
 */
export function parseSchemeSpec(text, { list, what = 'scheme' } = {}) {
  const m = String(text || '').match(/\b(?:scheme|programme|program|law|statute|bill)\s*[=:]\s*["']?([a-z0-9_-]+)/i);
  if (!m) return {};
  const raw = m[1].toLowerCase();
  const norm = (v) => String(v).replace(/[-_\s]/g, '');
  const pool = list && list.length ? list : what === 'law' ? LAW_IDS : SCHEME_IDS;
  const hit = pool.find((id) => norm(id) === norm(raw));
  if (hit) return { id: hit };
  return {
    issues: [
      `unknown ${what} "${m[1]}" — use ${pool.join('|')}${what === 'law' ? '' : ' (END_SCHEME takes one that is already running)'}`
    ]
  };
}

/** REZONE/ANNEX_EDGE spec: zone=<grid zone>. `required` makes a missing
 *  zone= a spec issue (REZONE); optional (ANNEX_EDGE) just returns {}.
 *  The vocabulary itself lives with the other intent tables above — the
 *  prompt quotes it, so it has to be declared before PROMPT_BODY is built. */
export function parseLandZoneSpec(text, { required = false } = {}) {
  const m = String(text || '').match(/\bzone\s*[=:]\s*([a-z0-9_-]+)/i);
  if (!m) {
    return required ? { issues: [`REZONE needs zone=${LAND_ZONE_IDS.join('|')}`] } : {};
  }
  const z = LAND_ZONE_ALIASES[m[1].toLowerCase()];
  if (z) return { zone: z };
  return { issues: [`unknown zone "${m[1]}" — use ${LAND_ZONE_IDS.join(', ')}`] };
}

/** UPGRADE_ROAD spec: class=<alley|local|street|avenue|boulevard> — the rung
 *  to reach. Absent → the planner climbs exactly one rung from wherever the
 *  corridor stands. Unknown rungs are a spec issue, so they are refused
 *  outright rather than silently climbing one. */
export function parseRoadClassSpec(text) {
  const m = String(text || '').match(/\bclass\s*[=:]\s*([a-z0-9_-]+)/i);
  if (!m) return {};
  const v = m[1].toLowerCase();
  if (XS_CLASS_ORDER.includes(v)) return { to: v };
  return { issues: [`unknown class "${m[1]}" — use ${XS_CLASS_ORDER.join(', ')}`] };
}

/** RENOVATE spec: budget=1..3 (how far up the budget ladder to climb). */
function parseRenovateSpec(text) {
  const m = String(text || '').match(/\bbudget\s*[=:]\s*(\d{1,2})/i);
  if (!m) return {};
  const v = parseInt(m[1], 10);
  if (v >= 1 && v <= 3) return { budget: v };
  return { issues: [`budget must be 1..3 (got ${m[1]})`] };
}

/** TIERUP spec: tier=<SHOP_TIERS id> — which rung to climb to. */
function parseTierupSpec(text) {
  const m = String(text || '').match(/\btier\s*[=:]\s*([a-z0-9_-]+)/i);
  if (!m) return {};
  const v = m[1].toLowerCase();
  if (SHOP_TIERS[v]) return { tier: v };
  return { issues: [`unknown tier "${m[1]}" — use ${Object.keys(SHOP_TIERS).join(', ')}`] };
}

/** BUILD_CIVIC spec: facility=<catalogue id>. Absent → the planner picks one. */
function parseCivicSpec(text) {
  const m = String(text || '').match(/\bfacility\s*[=:]\s*([a-z0-9_-]+)/i);
  if (!m) return {};
  const v = m[1].toLowerCase();
  if (CIVIC_CATALOGUE[v]) return { facility: v };
  return { issues: [`unknown facility "${m[1]}" — use ${Object.keys(CIVIC_CATALOGUE).join('|')}`] };
}

/**
 * UPGRADE_RESOURCE spec: the first resource word in the line. POWER = energy,
 * PETROL/GAS/DIESEL = fuel — the everyday synonyms a model reaches for.
 * A kind word pins the yard (FARM/HUSBANDRY/RANCH/POULTRY…): `kind=husbandry`
 * raises the ranch rather than whichever food site the rotation lists first.
 */
const RESOURCE_WORDS = {
  WATER: 'water',
  ENERGY: 'energy',
  POWER: 'energy',
  ELECTRICITY: 'energy',
  FOOD: 'food',
  FUEL: 'fuel',
  GAS: 'fuel',
  PETROL: 'fuel',
  DIESEL: 'fuel'
};
const KIND_WORDS = {
  FARM: 'farm',
  SMALLHOLDING: 'farm',
  HUSBANDRY: 'husbandry',
  RANCH: 'husbandry',
  LIVESTOCK: 'husbandry',
  CATTLE: 'husbandry',
  STOCKYARD: 'husbandry',
  PADDOCK: 'husbandry',
  POULTRY: 'poultry',
  CHICKEN: 'poultry',
  CHICKENS: 'poultry',
  HEN: 'poultry',
  HENS: 'poultry',
  COOP: 'poultry',
  HATCHERY: 'poultry'
};
const RESOURCE_WORD_RE = new RegExp(`\\b(${Object.keys(RESOURCE_WORDS).join('|')})\\b`, 'i');
const KIND_WORD_RE = new RegExp(`\\b(${Object.keys(KIND_WORDS).join('|')})\\b`, 'i');
function parseResourceSpec(text) {
  const out = {};
  const m = String(text || '').match(RESOURCE_WORD_RE);
  if (m) out.resource = RESOURCE_WORDS[m[1].toUpperCase()];
  // An explicit kind= pin wins over a bare word; a bare kind word implies its
  // resource when no resource word was given.
  const pinned = String(text || '').match(/kind\s*=\s*([a-z_]+)/i);
  const word = String(text || '').match(KIND_WORD_RE);
  const kind = pinned ? pinned[1].toLowerCase() : word ? KIND_WORDS[word[1].toUpperCase()] : null;
  if (kind) {
    out.kind = kind;
    if (!out.resource) {
      const implied = { farm: 'food', husbandry: 'food', poultry: 'food' }[kind];
      if (implied) out.resource = implied;
    }
  }
  return out;
}

function parseIntentCore(text) {
  const norm = normalize(text);
  if (!norm) return { intent: null, confidence: 0, how: 'empty' };

  const declared = norm.match(/\b(?:INTENT|DECISION|ACTION|CHOOSE)\s*(?:IS\s*)?([A-Z][A-Z0-9 ]{2,})/);
  if (declared) {
    const words = declared[1].trim().split(' ');
    const cand = words.join('_');
    // Longest EXACT prefix first: a spec suffix ("BUILD_LANDMARK type=stadium"
    // normalizes to "BUILD LANDMARK TYPE STADIUM") must not steal the intent
    // from a shorter BUILD_* sibling via the fuzzy paths below.
    for (let n = words.length; n >= 1; n--) {
      const prefix = words.slice(0, n).join('_');
      if (INTENTS.includes(prefix)) return { intent: prefix, confidence: 1, how: 'declared' };
    }
    // Declared replies may use the same natural-language aliases as the
    // phrase table. Resolve an exact alias before the loose first-word route;
    // otherwise "INTENT: EXPAND THE ROAD" is mistaken for EXPAND_LANDMARK
    // simply because both intents begin with EXPAND.
    const declaredPhrase = words.join(' ');
    for (const [intent, list] of PHRASES) {
      if (list.includes(declaredPhrase)) return { intent, confidence: 1, how: 'declared-alias' };
    }
    for (const key of INTENTS) {
      if (lev(cand, key) <= 2) return { intent: key, confidence: 0.8, how: 'declared-fuzzy' };
    }
    const firstWord = words[0];
    for (const key of INTENTS) {
      if (key.includes(firstWord) && firstWord.length >= 5) {
        return { intent: key, confidence: 0.7, how: 'declared-partial' };
      }
    }
  }

  if (
    /\b(STUDY|SURVEY|ANALYSE|ANALYZE|REVIEW|INSPECT)\b/.test(norm) &&
    /\b(ROAD|ROADS|STREET|STREETS|TRAFFIC|NETWORK)\b/.test(norm)
  ) {
    return { intent: 'STUDY_ROAD', confidence: 0.9, how: 'study-phrase' };
  }

  let best = null;
  for (const [intent, list] of PHRASES) {
    for (const phrase of list) {
      const at = norm.indexOf(phrase);
      if (at === -1) continue;
      if (!best || at < best.at) best = { intent, at, confidence: 0.9, how: 'phrase' };
      else if (at === best.at && best.confidence < 0.9) best = { intent, at, confidence: 0.9, how: 'phrase' };
    }
  }
  if (best) return { intent: best.intent, confidence: best.confidence, how: best.how };

  const words = norm.split(' ').filter((w) => w.length >= 5);
  for (const word of words) {
    for (const key of INTENTS) {
      for (const part of key.split('_')) {
        if (part.length >= 5 && lev(word, part) <= (part.length >= 8 ? 2 : 1)) {
          return { intent: key, confidence: 0.6, how: 'fuzzy' };
        }
      }
    }
  }

  return { intent: null, confidence: 0, how: 'none' };
}

export class GovernanceSystem {
  constructor(town, opts = {}) {
    this.town = town;
    currentTown = town;
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    this.model = opts.model || '';
    this.temperature = councilTemperature(
      opts.temperature ?? (opts.creativity === 'creative' ? 0.3 : undefined)
    );
    this.sittingsPerDay = clampSittingsPerDay(opts.sittingsPerDay);
    this.provider = resolveLLMProvider(opts.provider || opts.providerId, {
      endpoint: this.endpoint,
      model: this.model
    });
    this.parseIntent = parseIntent;
    this.cabinet = new CabinetSystem(this, opts.cabinet || {});
    // Public simulation decisions belong to the LLM Council. The private
    // developer is deliberately outside this boundary and keeps its own
    // independent commissioning pass; rules fallback is disabled so a
    // deterministic public actor cannot silently author Council work.
    this.councilOnly = opts.councilOnly !== false;
    this.rng = town.rng.fork(6006);
    this.reset();
  }

  /** Swap the model adapter without changing the town, parser, or scoring. */
  setProvider(provider, options = {}) {
    this.provider = resolveLLMProvider(provider, {
      endpoint: options.endpoint || this.endpoint,
      model: options.model || this.model
    });
    if (options.endpoint) this.endpoint = options.endpoint;
    if (options.model != null) this.model = options.model;
    if (options.temperature != null || options.creativity != null) {
      this.temperature = councilTemperature(
        options.temperature ?? (options.creativity === 'creative' ? 0.3 : DEFAULT_COUNCIL_TEMPERATURE)
      );
    }
    // A response from the previous adapter belongs to the old sitting. Make
    // it stale before the replacement is allowed to answer.
    this.requestSeq = (this.requestSeq || 0) + 1;
    this.activeRequestId = null;
    this.pending = false;
    this.cache = new Map();
    this.cacheKey = null;
    this.available = null;
    this.lastError = null;
    this.proxied = false;
    this.modelUsed = '';
    this.rulesOnly = false;
    this.consecutiveFailures = 0;
    return this.provider;
  }

  reset() {
    this.enabled = true;
    this.auto = true;
    this.fallback = false;
    this.pending = false;
    this.proxied = false;
    this.available = null;
    this.lastError = null;
    this.lastDay = -1;
    this.lastSlot = -1;
    this.lastConveneDay = -1;
    this.lastSitKey = null;
    this.lastClock = null;
    this.cycles = 0;
    this.lastReply = '';
    this.modelUsed = '';
    this.decisions = [];
    // Unbounded index of decisions that carry a project id, so a rollback can
    // always find what it needs to un-spend. `decisions` is a 30-deep display
    // window and must stay one.
    this.spentByProject = new Map();
    this.lastDecision = null;
    // A blocked public motion creates a short-lived sequencing directive. It
    // is evidence for the next Council sitting, never an automatic decision.
    this.requiredAction = null;
    this.blockedRemedyAttempts = 0;
    this.spent = 0;
    this.parseFailures = 0;
    this.llmCalls = 0;
    this.cabinetCalls = 0;
    this.councilCalls = 0;
    // Deterministic, synchronous request counter used by horizon probes. Test
    // requests go through the same parser, planner, finance checks, and
    // outcome ledger as a model reply, but never open a network connection or
    // wait for an emergent cadence slot.
    this.forcedRequests = 0;
    // Phase 30 (S19b) — the call boundary's own state.
    // `epoch` is bumped here so a reply already in flight can tell it belongs to
    // a town that no longer exists. `town.generate()` reuses this object and
    // calls reset(), so without it a reply reasoned from the PREVIOUS town is
    // enacted against the new one.
    this.epoch = (this.epoch || 0) + 1;
    this.consecutiveFailures = 0;
    this.lastAborted = false;
    this.rulesOnly = false;
    this.cache = new Map();
    this.cacheKey = null;
    this.sittingSeq = 0;
    this.decisionSeq = 0;
    this.responseSeq = 0;
    this.staleReplies = 0;
    this.cacheHits = 0;
    this.activeSittingId = null;
    this.lastCompletedSittingId = null;
    this.activeResponseId = null;
    // A request identity complements the town epoch. It prevents an older
    // promise from clearing state after a replacement request starts.
    this.requestSeq = this.requestSeq || 0;
    this.activeRequestId = null;
    // -999 lets the first festival happen on day one; later ones are weekly.
    this.lastEventDay = -999;
    // Phase 19 — the rolling decision ledger the persona is derived from. It
    // is the ONLY input; nothing about the council's character is authored.
    this.ledger = new DecisionLedger();
    // Outcome memory is separate from the persona ledger. It learns only from
    // measured before/after state and is fed back as evidence, never as a new
    // rule or a hidden reward signal.
    this.learning = new CouncilLearning();
    this.cabinet?.reset();
    // Congestion is accumulated continuously between sittings. A Council
    // should see the traffic it experienced over the whole interval, not only
    // the frame on which its meeting happened.
    this.congestionWindow = emptyCongestionWindow();
    this.lastCongestionInterval = null;
    // null clears the HUD council card along with the decision history.
    events.emit('council', null);
  }

  /**
   * Sample live traffic for the current inter-sitting window. `dt` is game
   * seconds, so the average is time-weighted and does not depend on render
   * frame frequency or simulation speed.
   */
  sampleCongestion(dt, clock) {
    const traffic = this.town.traffic;
    if (!traffic) return;
    const current = Number(traffic.congestion);
    if (!Number.isFinite(current)) return;
    const w = this.congestionWindow || (this.congestionWindow = emptyCongestionWindow(clock));
    if (!w.from && clock) w.from = { day: Number(clock.day) || 0, hour: Number(clock.hour) || 0 };
    const seconds = Math.max(0, Number(dt) || 0);
    w.sum += current;
    w.samples += 1;
    w.min = Math.min(w.min, current);
    w.max = Math.max(w.max, current);
    if (seconds > 0) {
      w.weighted += current * seconds;
      w.seconds += seconds;
    }
  }

  /** Close the interval that ended at a Council sitting. */
  closeCongestionWindow(clock) {
    const w = this.congestionWindow || emptyCongestionWindow(clock);
    const current = Number(this.town.traffic?.congestion);
    const average = w.seconds > 0
      ? w.weighted / w.seconds
      : w.samples > 0
        ? w.sum / w.samples
        : (Number.isFinite(current) ? current : 0);
    this.lastCongestionInterval = {
      average: Math.round(average * 1000) / 1000,
      instantaneous: Number.isFinite(current) ? Math.round(current * 1000) / 1000 : 0,
      min: w.samples ? Math.round(w.min * 1000) / 1000 : Math.round(average * 1000) / 1000,
      max: w.samples ? Math.round(w.max * 1000) / 1000 : Math.round(average * 1000) / 1000,
      samples: w.samples,
      intervalHours: Math.round((w.seconds / 3600) * 100) / 100,
      from: w.from,
      to: clock ? { day: Number(clock.day) || 0, hour: Number(clock.hour) || 0 } : null
    };
    this.congestionWindow = emptyCongestionWindow(clock);
    return this.lastCongestionInterval;
  }

  /** Evidence used by the report and growth gates at the next sitting. */
  congestionEvidence() {
    const current = Number(this.town.traffic?.congestion);
    const instantaneous = Number.isFinite(current) ? current : 0;
    const interval = this.lastCongestionInterval;
    return {
      average: interval ? interval.average : instantaneous,
      instantaneous: interval ? interval.instantaneous : Math.round(instantaneous * 1000) / 1000,
      min: interval?.min ?? Math.round(instantaneous * 1000) / 1000,
      max: interval?.max ?? Math.round(instantaneous * 1000) / 1000,
      samples: interval?.samples || 0,
      intervalHours: interval?.intervalHours || 0,
      hasInterval: !!interval,
      from: interval?.from || null,
      to: interval?.to || null
    };
  }

  report() {
    const t = this.town;
    const eco = t.economy ? t.economy.stats() : null;
    const lc = t.lifecycle ? t.lifecycle.stats() : null;
    const mb = t.traffic ? t.traffic.mobilityStats() : null;
    const congestion = this.congestionEvidence();
    // Growth and road planning consume the same closed interval average that
    // is printed below. The live traffic object remains available as the
    // instantaneous context value.
    const councilMobility = mb ? { ...mb, congestion: congestion.average } : mb;
    const roadDemand = t.traffic?.roadDemandSnapshot?.() || null;
    const roadPlan = councilMobility && councilMobility.congestion > roadCongestionGate() ? t.growth?.selectRoadExtension?.() : null;
    const gr = t.growth ? t.growth.stats() : null;
    const ut = t.utilities ? t.utilities.stats() : null;
    const ind = t.industry ? t.industry.stats() : null;
    const inc = t.incidents && t.incidents.stats ? t.incidents.stats() : null;
    const fleet = t.traffic && t.traffic.fleetStats ? t.traffic.fleetStats() : null;
    const prices = priceIndex(t);
    const homes = t.buildings.filter((b) => b.kind === 'house');
    const capacity = homes.reduce((s, b) => s + (b.capacity || 2), 0);
    const utilLine = ut
      ? ut.types
          ? Object.entries(ut.types)
              .map(([k, v]) => `${k} ${Math.round((v.demand / Math.max(1, v.capacity)) * 100)}%${v.saturated ? ' OVER' : ''}`)
              .join(', ')
          : 'unknown'
      : 'unknown';
    const last = this.lastDecision;
    const staff = this.staffNeed();
    const board = this.planBoard();
    // Primary resources (water/energy/food stores and site output) — the
    // Day-81 report had the pipe network only, so the council never saw the
    // water store sitting at 0% and answered NO_ACTION.
    const rs = t.resources && t.resources.stats ? t.resources.stats() : null;
    const emergency = t.growth?.resourceEmergency?.() || null;
    const required = this.requiredAction && emergency &&
      this.requiredAction.resource === emergency.resource
      ? this.requiredAction
      : emergency;
    // Phase 15 — the policy read-out. `stats()` is cheap (the jurisdiction
    // figure is cached against a signature), so the report and the council see
    // the same object.
    const pol = t.policy ? t.policy.stats() : null;
    const resLine = rs
      ? Object.entries(rs.types)
          .map(
            ([k, v]) =>
              `${k} ${v.percent}%${v.shortage ? ' DRY' : ''} ${v.production}/${v.demand}${
                v.production < v.demand ? ' DEFICIT' : ''
              }`
          )
          .join(' · ')
      : '';
    const stage = settlementStage(t);
    // Civic load: the prompt tells the model to raise a floor on a facility
    // "whose Load shows over capacity" — so the Load has to be on the report.
    const loads = civicLoads(t);
    const loadLine = loads.length
      ? `Civic load: ${loads
          .map((l) => `${l.kind} ${l.demand}/${l.capacity}${l.load > 1 ? ' OVER' : ''}`)
          .join(' · ')}`
      : '';
    const pop = lc ? lc.population : t.pedestrians.citizens.length;
    const mood = t.pedestrians.averageMood ? t.pedestrians.averageMood() : 0;
    // Social legitimacy is decision evidence, not a hidden landmark gate. The
    // Council needs both the town-wide approval signal and the citizen mood
    // dimensions that explain it before it weighs a scheme or landmark.
    const society = t.society?.stats?.() || null;
    const weather = t.weather?.stats?.() || null;
    const citizens = t.pedestrians?.citizens || [];
    const moodDimensions = ['needs', 'safety', 'services', 'economy', 'belonging', 'transport']
      .map((key) => {
        const rows = citizens.map((c) => Number(c.p?.mood?.[key])).filter(Number.isFinite);
        return rows.length ? `${key} ${Math.round((rows.reduce((a, b) => a + b, 0) / rows.length) * 100)}%` : null;
      })
      .filter(Boolean)
      .join(' · ');
    const societyLine = society
      ? `Society: approval ${Math.round(society.approvalRate * 100)}% · citizen mood ${Math.round(society.mood * 100)}%` +
        (moodDimensions ? ` · dimensions ${moodDimensions}` : '') +
        ` · neighbourhoods ${society.neighbourhoods.length} · open crimes ${society.crimes.open} · court backlog ${society.crimes.backlog}` +
        ` · active laws ${society.laws.length}${society.mayor ? ` · mayor ${society.mayor}` : ''}`
      : '';
    // Phase 16 — the derived band and the pull, read once and used by both the
    // Population and the Settlers lines. `lcs` is the system (it owns the
    // campaign calendar); `lc` above is its stats().
    const lcs = t.lifecycle;
    const st = lcs ? lcs.stability() : null;
    // Phase 17 — one stats() read; `POINTS_PER_RUNG` is the module's own rung
    // cost, so the report cannot disagree with the ladder.
    const rsh = t.research ? t.research.stats() : null;
    const rs2 = rsh
      ? {
          ...rsh,
          next: rsh.next || { label: 'nothing to research yet', points: POINTS_PER_RUNG }
        }
      : null;
    const per = this.persona();
    // Phase 10 — the whole town, not a subset: who lives here (flows and age
    // mix the HUD already shows), how the day's money moves (settled daily —
    // see economy.daily()), and the storehouse in numbers, including the exact
    // defaults a bare TRADE_BUY / TRADE_SELL would take.
    const demogLine = lc
      ? `Demographics: median age ${lc.medianAge}` +
        (lc.stages && Object.keys(lc.stages).length
          ? ` · ${Object.entries(lc.stages).map(([k, v]) => `${v} ${k}`).join(' · ')}`
          : '') +
        ` · +${lc.born} born · ${lc.died} died · +${lc.movedIn} in · ${lc.movedOut} out` +
        (lc.recent && lc.recent.length ? ` · Recent: ${lc.recent.slice(-2).join('; ')}` : '')
      : '';
    const economyLine = eco
      ? `Economy: tax $${eco.taxRevenue.toLocaleString('en-US')} so far today · wages $${eco.wages.toLocaleString('en-US')}` +
        ` · spending $${eco.spending.toLocaleString('en-US')} · businesses ${eco.businesses}` +
        ` · revenue $${eco.revenue.toLocaleString('en-US')}/day · land value ${eco.landValue}` +
        ` · avg income $${eco.avgIncome.toLocaleString('en-US')}` +
        // Phase 21 — an unemployment rate alone does not say WHY. The council
        // needs the two numbers that explain it: posts no owner has filled, and
        // the townsfolk in their own account.
        ` · open posts ${eco.openPosts} · self-employed ${eco.selfEmployed} · owners ${eco.owners}`
      : '';
    const employmentLine = (() => {
      const roster = typeof t.economy?.employed === 'function' ? t.economy.employed() : null;
      if (!eco || !roster) return '';
      const labourForce = roster.adults?.length || 0;
      const unemployed = roster.jobless?.length || 0;
      const employed = Math.max(0, labourForce - unemployed);
      const siteGap = staff
        ? CREW_ROLES.reduce((sum, role) => sum + Math.max(0, (staff.want?.[role] || 0) - (staff.staff?.[role] || 0)), 0)
        : 0;
      const civicGap = staff?.civic?.open || 0;
      const critical = eco.unemployment >= Math.round(UNEMPLOYMENT_PRIORITY_GATE * 100) ? ' · JOBS PRIORITY' : '';
      return `Employment: ${unemployed}/${labourForce} jobless (${eco.unemployment}%) · employed ${employed} · self-employed ${eco.selfEmployed} · private vacancies ${eco.openPosts} · site gaps ${siteGap} · civic gaps ${civicGap}${critical} · remedies OPEN_SHOP/BUILD_OFFICE/BUILD_FACTORY/TIERUP/SUBSIDY`;
    })();
    const tourism = eco?.tourism || t.economy?.tourismStats?.() || null;
    const tourismLine = tourism && (tourism.roomCapacity || tourism.demand)
      ? `Tourism: ${tourism.visitors} visitors · rooms ${tourism.occupiedRooms}/${tourism.roomCapacity} occupied (${Math.round(tourism.occupancy * 100)}%)` +
        ` · demand ${Math.round(tourism.demand * 100)}% · appeal ${Math.round(tourism.appeal * 100)}%` +
        ` · nightly revenue $${Math.round(tourism.revenueToday || 0)}`
      : '';
    const stockLine = ind
      ? (() => {
          const rows = Object.entries(ind.commodities);
          const fullest = rows.slice().sort((a, b) => b[1].percent - a[1].percent)[0];
          const factoryNeed = t.industry.producerPressureSnapshot?.(3)?.[0] || null;
          const defBuy = (t.industry.strainedProduct && t.industry.strainedProduct()) || 'goods';
          return `Stocks: ${rows
            .map(([k, c]) => `${k} ${c.stock}/${c.capacity} (${c.percent}%) buy $${c.buy} sell $${c.sell}`)
            .join(' · ')} · default buy ${defBuy} · default sell ${fullest ? fullest[0] : 'goods'}` +
            (factoryNeed ? ` · factory priority ${factoryNeed.product} (${factoryNeed.reason})` : ' · factory priorities balanced');
        })()
      : '';
    // The short HUD summary is not enough for an LLM to plan a town. These
    // compact inventories expose the spatial, capacity, service, and fiscal
    // state that otherwise remained implicit in Feasible/Blocked.
    const buildingLine = (() => {
      const rows = new Map();
      for (const b of t.buildings || []) {
        const key = b.facility || b.kind || 'building';
        const row = rows.get(key) || { count: 0, floors: 0, capacity: 0, area: 0 };
        row.count++;
        row.floors = Math.max(row.floors, Number(b.floors || b.house?.spec?.floors || 1));
        row.capacity += Number(b.capacity || 0);
        row.area += Array.isArray(b.footprintCells) ? b.footprintCells.length : 1;
        rows.set(key, row);
      }
      return `Buildings: ${[...rows.entries()].map(([key, row]) => `${key} ${row.count}×${row.floors}f/${row.area}t${row.capacity ? ` cap${Math.round(row.capacity)}` : ''}`).join(' · ')}`;
    })();
    const landStats = t.perimeter?.stats?.() || null;
    const landLine = landStats
      ? `Land: acquired ${landStats.acquired} tiles · frontier ${t.perimeter?.frontierCells?.(1)?.length || 0} adjacent · vacant serviced ${t.growth?.vacantAcquiredPlots?.(1) ?? '?'} · expansions ${landStats.expansions} · next tile $${Math.round(landStats.nextTileCost || 0)}${t.growth?.landNeeded?.() ? ' · ACQUIRE_LAND is needed' : ''}`
      : '';
    const resourceSites = t.resources?.sites || [];
    const siteLine = resourceSites.length
      ? `Resource sites: ${resourceSites.map((site) => `${site.kind} L${site.level || 1}${site.work ? ` ${site.work}` : ''}`).join(' · ')}`
      : '';
    const vehicleStats = t.vehicles?.stats?.() || null;
    const stationNeeds = t.vehicles?.stationShortfall?.() || [];
    const stateUnits = t.vehicles?.slots
      ? Object.entries(t.vehicles.slots.filter((slot) => !slot.scrapped && slot.owner?.sector === 'government').reduce((out, slot) => {
          const key = slot.unit || slot.type;
          out[key] = (out[key] || 0) + 1;
          return out;
        }, {})).map(([key, value]) => `${key} ${value}`).join(', ')
      : '';
    const stationLine = vehicleStats
      ? (() => {
          const transit = t.transport?.stats?.();
          return `Services: state vehicles ${vehicleStats.stateStock} (${stateUnits || 'registered'}) · stations ${stationNeeds.length ? stationNeeds.map((n) => `${n.facility} ${n.count}/${n.required}`).join(', ') : 'covered'}${transit ? ` · transit stops ${transit.stops}, route ${transit.routeTiles}t, buses ${transit.fleet}, coverage ${Math.round(transit.coverage * 100)}%, rides/day ${transit.dailyRides}, ${transit.ready ? 'ready' : 'not ready'}` : ''}`;
        })()
      : '';
    const head = (value) => String(value || '').trim().split(/\s+/)[0];
    const feasibleHeads = new Set((board?.feasible || []).map(head));
    const priorityHeads = new Set((board?.priority || []).map(head));
    const blockedHeads = new Set((board?.blocked || []).map((value) => head(value)));
    const conditionalIntents = INTENTS.filter((intent) => !feasibleHeads.has(intent) && !priorityHeads.has(intent) && !blockedHeads.has(intent));
    const intentMapLine = board
      ? `Intent map: priority [${[...priorityHeads].join(', ') || 'none'}] · feasible [${[...feasibleHeads].join(', ') || 'none'}] · blocked [${[...blockedHeads].join(', ') || 'none'}] · conditional/manual [${conditionalIntents.join(', ')}]`
      : `Intent map: ${INTENTS.join(', ')}`;
    const directLine = [
      `HIRE_WORKERS ${staff?.gap ? `needed ${staff.gap}` : 'no measured gap'}`,
      `ATTRACT_SETTLERS ${st?.spareBeds > 0 && st?.openings > 0 ? 'available' : 'wait for beds/posts'}`,
      `TRADE_BUY ${rs?.strained?.length ? `consider ${rs.strained.join('/')}` : 'no primary deficit'}`,
      `TRADE_SELL ${ind?.commodities ? 'surplus shown in Stocks' : 'unavailable'}`,
      `BOND_ISSUE ${t.growth?.loanNeed?.() ? 'runway short' : 'runway/debt gate not met'}`,
      `DISPATCH_UNITS ${inc?.open ? `${inc.open} open calls` : 'no open calls'}`,
      `DECLARE_EMERGENCY ${inc?.open ? 'available for open calls' : 'no open calls'}`,
      `FUND_INNOVATION ${rsh ? `next ${rs2?.next?.label || 'bucket'}` : 'unavailable'}`,
      `POLICY schemes ${SCHEME_IDS.join('|')} · laws ${LAW_IDS.join('|')}`
    ].join(' · ');
    return [
      `TOWN REPORT day ${t.clockDay || 0} · ${stage.label}`,
      (() => { const blocks = constructionBlockStats(); return `Construction kits: ${blocks.total} blocks · ${Object.entries(blocks.kits).map(([k, n]) => `${k} ${n}`).join(' · ')}`; })(),
      `Population ${pop} · target ${lc ? lc.target : '?'} · homes ${homes.length} · capacity ${Math.round(capacity)} · spare beds ${Math.max(0, Math.round(capacity) - pop)} · mood ${Math.round(mood * 100)}%${gr ? ` · pressure ${gr.pressure}` : ''}`,
      buildingLine,
      landLine,
      societyLine,
      weather
        ? `Weather: year ${weather.year}, day ${weather.dayOfYear} · ${weather.seasonLabel} · ${weather.weatherLabel} · ${weather.temperature}°C · precipitation ${Math.round(weather.precipitation * 100)}% · food ×${weather.modifiers.foodYield.toFixed(2)} · traffic ×${weather.modifiers.trafficFactor.toFixed(2)}`
        : '',
      demogLine,
      // Phase 16 — A3/A7. The pull is a number the council can act on, and the
      // campaign is the only thing that moves it, so both belong on the report.
      lcs
        ? `Settlers: pull ×${st.campaign} = ${st.pull}` +
          ` · spare beds ${st.spareBeds} · open posts ${st.openings} of ${st.posts}` +
          (st.civicCeiling !== null ? ` · civic ceiling ${st.civicCeiling}` : '') +
          (lc.campaign ? ` · campaign ${lc.campaign.daysLeft}d left` : '')
        : '',
      eco
        ? `Treasury ${Math.round(eco.treasury)} · reserve ${Math.round(eco.reserve)} · debt ${Math.round(eco.debt)} · GDP ${Math.round(eco.gdp)} · unemployment ${eco.unemployment}% · tax ${eco.taxRate}%${eco.taxRate !== eco.effectiveTaxRate ? ` (${eco.effectiveTaxRate}% with law)` : ''}${eco.spendingScale !== 1 ? ` · spending ×${eco.spendingScale}` : ''}${eco.spendingScale !== eco.effectiveSpending ? ` (×${eco.effectiveSpending} with law)` : ''} · jurisdiction ${Math.round(eco.jurisdiction * 100)}%`
        : 'Treasury unknown',
      economyLine,
      employmentLine,
      tourismLine,
      t.economy?.treasuryFlow ? (() => { const f = t.economy.treasuryFlow();
        return `Treasury ${eco?.fiscalBand || 'healthy'}: opening $${Math.round(f.opening)}, inflows $${Math.round(f.inflows)}, outflows $${Math.round(f.outflows)}, closing $${Math.round(f.closing)}`; })() : '',
      eco?.budget
        ? `Budget: reserve $${Math.round(eco.budget.reserveTransfers)} · construction $${Math.round(eco.budget.construction)} · operations $${Math.round(eco.budget.operations)} · policy $${Math.round(eco.budget.policyPrograms)} · debt $${Math.round(eco.budget.debtService)} · burn $${Math.round(eco.projectedDailyBurn)}/day`
        : '',
      mb
        ? `Congestion average ${Math.round(congestion.average * 100)}% over ${congestion.intervalHours}h (${congestion.samples} samples) · current ${Math.round(congestion.instantaneous * 100)}% · range ${Math.round(congestion.min * 100)}–${Math.round(congestion.max * 100)}% · parking demand ${mb.parkingDemand}/${mb.parkingSupply} (forecast) · ${mb.parkingTaken} taken · trips ${mb.trips}`
        : '',
      councilMobility && councilMobility.congestion > roadCongestionGate()
        ? `Road planning: ${roadPlan ? `${roadPlan.cells.length} tiles, ${roadPlan.reason}${roadPlan.benefit != null ? `, benefit ${Math.round(roadPlan.benefit)}` : ''}` : 'no legal measured extension'}${councilMobility.congestion >= ROAD_EMERGENCY_GATE ? ' · EMERGENCY priority' : ' · congestion priority'} · completed observations ${roadDemand?.trips?.length || 0}`
        : '',
      inc
        ? `Emergency: ${inc.open} open${Object.keys(inc.byKind).length ? ` (${Object.entries(inc.byKind).map(([k, n]) => `${n} ${k}`).join(' · ')})` : ''} · ${inc.taken} claimed${Object.keys(inc.byState || {}).length ? ` [${Object.entries(inc.byState).map(([k, n]) => `${n} ${k}`).join(' · ')}]` : ''} · fleet ${fleet.emergency} emergency · ${fleet.service} service · ${fleet.civilian} civilian${inc.emergency ? ' · DECLARED' : ''}`
        : '',
      stationLine,
      ind
        ? `Industry: ${ind.factories} works · materials ${MATERIAL_KEYS.map((k) => `${k} ${ind.commodities[k].stock}`).join(', ')} · goods ${ind.goods.stock} (factor ×${ind.goods.factor})`
        : '',
      staff
        ? `Staff: ${CREW_ROLES.map((r) => `${SITE_CREW[r].label} ${staff.staff[r] || 0}/${staff.want[r] || 0}`).join(' · ')} · businesses ${staff.biz?.have ?? 0}/${staff.biz?.need ?? 0} · civic ${staff.civic?.filled ?? 0}/${staff.civic?.need ?? 0}${staff.gap ? ` · gap ${staff.gap}` : ''}`
        : '',
      ind
        ? `Trade: exports $${ind.exported.toLocaleString('en-US')} · imports $${ind.imported.toLocaleString('en-US')} · net ${ind.net >= 0 ? '+' : '−'}$${Math.abs(ind.net).toLocaleString('en-US')}`
        : '',
      stockLine,
      `Price chart v${prices.version}: construction ×${prices.construction.toFixed(2)} · land ×${prices.land.toFixed(2)} · commodities ×${prices.commodities.toFixed(2)} (scarcity/demand/fiscal pressure)`,
      `Build-time chart v${BUILD_TIME_CHART.version}: live hours include footprint, floors, pressure, congestion, and fiscal capacity`,
      siteLine,
      `Utilities: ${utilLine}`,
      t.utilities?.electricityState ? `Electricity: generation / distribution / coverage service ${Math.round(t.utilities.electricityState().serviceFactor * 100)}%, limited by ${t.utilities.electricityState().limiting}` : '',
      rs ? `Primary resources: ${resLine}` : '',
      required
        ? `MANDATORY COUNCIL REMEDY: choose INTENT: ${required.intent}${required.resource ? ` resource=${required.resource}` : ''} now — ${required.detail || `${required.resource} capacity emergency`}; do not spend this sitting on another construction action`
        : '',
      gr?.designOpportunity
        ? `Design opportunity: ${gr.designOpportunity.reason} · suggested ${planCode(planFor(t, 'archetype', gr.designOpportunity.opts) || { type: 'archetype', zone: gr.designOpportunity.opts?.zone })}`
        : '',
      rs?.waste
        ? `Waste flow: ${rs.waste.generated} generated/day · ${rs.waste.processed}/${rs.waste.processingCapacity} processed · ${rs.waste.compost} compost · ${rs.waste.landfill} landfill (${rs.waste.diversion}% diverted)`
        : '',
      rs?.types?.water?.deficit ? `Water remedy: ${rs.types.water.remedy}` : '',
      // Phase 18 — the district in progress, and the town's connectivity. Both
      // are the council's only view of work that is queued rather than started.
      gr && gr.district
        ? `District: ${gr.district.built} step(s) done, ${gr.district.stepsLeft} queued${gr.district.next ? ` — next ${gr.district.next}` : ''}${gr.district.dropped ? ` · ${gr.district.dropped} dropped` : ''}`
        : '',
      gr && gr.connectivity
        ? `Connectivity: ${gr.connectivity.components} network component${gr.connectivity.components === 1 ? '' : 's'} · ${gr.connectivity.roads} road tiles · ${gr.connectivity.offNetwork} building(s) off-network · linked ${Math.round(gr.connectivity.linked * 100)}%`
        : '',
      // Phase 15 — what is running, what is law, and what those are worth to
      // the town. The live modifier row is the same object the consumers read,
      // so the model is never told a number the systems are not using.
      pol
        ? `Schemes: ${pol.schemes.length ? pol.schemes.map((s) => `${s.label} ${s.daysLeft}d @${
            s.per
          }/day`).join(' · ') : 'none running'}`
        : '',
      pol && pol.laws.length ? `Laws: ${pol.laws.map((l) => l.label).join(' · ')}` : '',
      pol
        ? `Policy effects: ${EFFECT_KEYS.filter((k) => pol.modifiers[k]).map((k) => `${k} ${pol.modifiers[k] > 0 ? '+' : ''}${pol.modifiers[k]}`).join(' · ') || 'none in force'}`
        : '',
      // Phase 17 — the ladder's own line: how far to the next rung, which rung
      // the town has earned next, and what the buckets are costing a day.
      rs2
        ? `Research: ${rs2.points}/${POINTS_PER_RUNG} points · next ${rs2.next.label}` +
          ` · funding $${rs2.funding}/day (${rs2.perDay.join(', ')})` +
          (rs2.completed ? ` · ${rs2.completed} delivered` : '')
        : '',
      // Phase 19 — the council's own record, so the town can see the same
      // sentences the prompt tells it about itself with.
      per ? `Council manner: ${per.lines.join('; ')}` : '',
      this.learning ? `Council learning: ${this.learning.promptLine()}` : '',
      loadLine,
      gr?.developerMarket
        ? `Private market: ${gr.developerMarket.activeProjects}/${gr.developerMarket.maxActive} active · cash $${gr.developerMarket.cash.toLocaleString('en-US')} · review in ${gr.developerMarket.nextReviewHours}h${gr.developerMarket.blocked ? ` · blocked ${gr.developerMarket.blocked}` : ''}`
        : '',
      gr ? `Construction: ${gr.publicActive ?? gr.active} public active${gr.next ? `, next finishes ~${gr.next}h` : ''} · ${gr.total} built${(gr.publicActive ?? gr.active) >= MAX_ACTIVE ? ' · public crews busy — new work paused' : ''}` : '',
      board ? `Feasible now (builds): ${board.feasible.length ? board.feasible.join(', ') : 'none'}` : '',
      board && board.blocked.length ? `Blocked: ${board.blocked.join(' · ')}` : '',
      board ? `Priority: ${board.priority.length ? board.priority.join(' → ') : 'none outstanding'}` : '',
      intentMapLine,
      directLine,
      `Build times: ${buildTimesLine()}`,
      `Warnings: ${eco && eco.warnings.length ? eco.warnings.join(', ') : 'none'}`,
      this.cabinet?.enabled
        ? `Cabinet: ${this.cabinet.departments.map((department) => department.id).join(', ')} · ${this.cabinet.departments.length} minister calls + 1 Council synthesis · up to ${this.cabinet.motionsPerSitting} motions · Mayor validation${this.cabinet.lastReview ? ` · last approved ${this.cabinet.lastReview.approved.length}, rejected ${this.cabinet.lastReview.rejected.length}, deferred ${this.cabinet.lastReview.deferred.length}` : ''}`
        : '',
      last ? `Last decision: ${last.intent} (${last.status}) ${last.detail || ''}` : 'Last decision: none yet',
      `Reply with one line: INTENT: <ACTION>`
    ]
      .filter(Boolean)
      .join('\n');
  }

  enact(text, source = 'llm') {
    const t = this.town;
    const parsed = parseIntent(text);
    const learningBefore = measureCouncilState(t);
    const motion = this.activeMotion;
    const decision = {
      day: t.clockDay || 0,
      source,
      intent: parsed.intent,
      confidence: parsed.confidence,
      how: parsed.how,
      status: 'rejected',
      detail: '',
      cost: 0,
      _ledgerStart: t.economy?.ledger?.length || 0,
      _learningBefore: learningBefore,
      raw: String(text || '').slice(0, 240),
      ...(motion ? {
        motionId: motion.id,
        department: motion.department,
        departmentLabel: motion.departmentLabel,
        mayor: 'approved'
      } : {})
    };

    if (!parsed.intent || !actionFor(parsed.intent)) {
      this.parseFailures++;
      decision.status = 'unparsed';
      decision.detail = 'no recognizable action in the reply';
      this.record(decision);
      return decision;
    }

    if (parsed.intent === 'NO_ACTION') {
      decision.status = 'noop';
      decision.detail = 'council chose to hold';
      this.record(decision);
      return decision;
    }

    if (parsed.intent && parsed.intent.startsWith('STUDY_')) {
      decision.status = 'advisory';
      decision.detail = this.study(parsed.intent);
      this.record(decision);
      return decision;
    }

    if (parsed.intent === 'KEEP_TAX') {
      decision.status = 'done';
      decision.detail = `tax held at ${Math.round(t.economy.taxScale * 100)}%`;
      this.record(decision);
      return decision;
    }

    if (parsed.intent === 'RAISE_TAX' || parsed.intent === 'CUT_TAX') {
      const next = t.economy.setTax(t.economy.taxScale + (parsed.intent === 'RAISE_TAX' ? 0.1 : -0.1));
      decision.status = 'done';
      decision.detail = `tax set to ${Math.round(next * 100)}%`;
      this.record(decision);
      return decision;
    }

    if (parsed.intent === 'HIRE_WORKERS') return this.hire(decision);

    if (parsed.intent === 'ATTRACT_SETTLERS') return this.attractSettlers(decision);

    // A bad trade spec is refused outright — same rule as the factory spec.
    if (
      (parsed.intent === 'IMAGINE_ARCHETYPE' ||
        parsed.intent === 'DEVELOP_HOUSING' ||
        parsed.intent === 'BUILD_FACTORY' ||
        parsed.intent === 'BUILD_LANDMARK' ||
        parsed.intent === 'OPEN_SHOP' ||
        parsed.intent === 'TRADE_BUY' ||
        parsed.intent === 'TRADE_SELL' ||
        parsed.intent === 'BUILD_CIVIC' ||
        parsed.intent === 'EXPAND_CLINIC' ||
        parsed.intent === 'BUILD_TRANSIT' ||
        parsed.intent === 'UPGRADE_ROAD' ||
        parsed.intent === 'REZONE' ||
        parsed.intent === 'ANNEX_EDGE' ||
        parsed.intent === 'FUND_INNOVATION' ||
        POLICY_INTENTS.includes(parsed.intent)) &&
      parsed.params?.issues?.length
    ) {
      decision.status = 'rejected';
      decision.detail = `spec rejected — ${parsed.params.issues.join('; ')}`;
      this.record(decision);
      return decision;
    }

    // Phase 15 — the policy family resolves against PolicySystem and never
    // touches the growth planner: there is no site, no crew and no build time.
    // It runs AFTER the spec check above so a bad id is a refusal, not a
    // silently substituted programme.
    if (POLICY_INTENTS.includes(parsed.intent)) {
      return this.policy(parsed.intent, parsed.params, decision);
    }
    // Phase 17 — same rule: after the spec check, so an unknown bucket is a
    // refusal rather than a silently substituted programme.
    if (parsed.intent === 'FUND_INNOVATION') {
      return this.fundInnovation(parsed.params, decision);
    }

    if (parsed.intent === 'TRADE_BUY' || parsed.intent === 'TRADE_SELL') {
      const ind = t.industry;
      if (!ind) {
        decision.status = 'rejected';
        decision.detail = 'no storehouse to trade against';
        this.record(decision);
        return decision;
      }
      const buying = parsed.intent === 'TRADE_BUY';
      const stats = ind.stats();
      let key = parsed.params?.commodity;
      if (!key) {
        if (buying) {
          key = (ind.strainedProduct && ind.strainedProduct()) || 'goods';
        } else {
          // Default sale: whatever sits fullest in the storehouse.
          key = Object.entries(stats.commodities).sort((a, b) => b[1].percent - a[1].percent)[0][0];
        }
      }
      const qty = parsed.params?.qty || 50;
      const r = buying ? ind.manualBuy(key, qty) : ind.manualSell(key, qty);
      decision.status = r.ok ? 'done' : 'rejected';
      decision.detail = r.ok
        ? `${buying ? 'Bought' : 'Sold'} ${r.qty} ${key} for $${Math.round(r.cost).toLocaleString('en-US')} — storehouse ${Math.round(ind.stats().commodities[key].stock)}`
        : `trade refused — ${r.reason}`;
      this.record(decision);
      return decision;
    }

    // ---- finance levers (Phase 4 C4): four moves the treasury understands.
    if (
      parsed.intent === 'SET_ASIDE_RESERVE' ||
      parsed.intent === 'BOND_ISSUE' ||
      parsed.intent === 'SUBSIDY' ||
      parsed.intent === 'SLASH_SPENDING'
    ) {
      const eco = t.economy;
      const r =
        parsed.intent === 'SET_ASIDE_RESERVE'
          ? eco.setAside(0.25)
          : parsed.intent === 'BOND_ISSUE'
            ? eco.issueBond(0.1)
            : parsed.intent === 'SUBSIDY'
              ? eco.grantSubsidy()
              : eco.slashSpending();
      decision.status = r.ok ? 'done' : 'rejected';
      // Phase 30 (S19b) — none of these four ever set `decision.cost`, so the
      // ledger's `spent` and the persona's "appetite" line silently omitted
      // every finance motion. Only a subsidy is money leaving the town: a bond
      // brings cash IN against debt, a set-aside moves it to the reserve, and a
      // spending cut moves nothing — all three are recorded as 0 on purpose
      // rather than left undefined.
      if (r.ok) decision.cost = parsed.intent === 'SUBSIDY' ? r.amount : 0;
      decision.detail = r.ok
        ? parsed.intent === 'SET_ASIDE_RESERVE'
          ? `set aside $${r.amount.toLocaleString('en-US')} — reserve $${r.reserve.toLocaleString('en-US')}`
          : parsed.intent === 'BOND_ISSUE'
            ? `bond of $${r.amount.toLocaleString('en-US')} issued — debt $${r.debt.toLocaleString('en-US')}`
            : parsed.intent === 'SUBSIDY'
              ? `grant of $${r.amount.toLocaleString('en-US')} to ${r.target} — ${r.days} days of support`
              : `spending cut to ${Math.round(r.scale * 100)}%`
        : r.reason;
      this.record(decision);
      return decision;
    }

    // ---- civic life: a festival lifts mood; an emergency holds open calls.
    if (parsed.intent === 'HOST_EVENT') return this.hostEvent(decision);
    if (parsed.intent === 'DECLARE_EMERGENCY') {
      const inc = t.incidents.stats();
      if (!inc.open) {
        decision.status = 'noop';
        decision.detail = 'nothing to declare — no open calls';
      } else if (t.incidents.emergency) {
        decision.status = 'noop';
        decision.detail = `already declared — ${inc.open} open calls`;
      } else {
        t.incidents.emergency = true;
        decision.status = 'done';
        decision.detail = `emergency declared — ${inc.open} open calls held until cleared`;
      }
      this.record(decision);
      return decision;
    }
    if (parsed.intent === 'DISPATCH_UNITS') {
      const inc = t.incidents.stats();
      const units = (t.traffic.vehicles || []).filter((v) => v.role === 'emergency');
      if (!inc.open) {
        decision.status = 'noop';
        decision.detail = 'no open calls — units hold at station';
      } else if (!units.length) {
        decision.status = 'rejected';
        decision.detail = 'no emergency units in the fleet';
      } else {
        for (const v of units) {
          v.cooldown = 0;
          v.sirens = true;
        }
        decision.status = 'done';
        decision.detail = `${units.length} units dispatched — ${inc.open} open (${Object.entries(inc.byKind)
          .map(([k, n]) => `${n} ${k}`)
          .join(' · ')})`;
      }
      this.record(decision);
      return decision;
    }

    const type = actionFor(parsed.intent)?.planType;
    // A dry primary resource is a safety-critical capacity signal. An LLM can
    // still be creative about the remedy, but it cannot spend the sitting on
    // a housing floor, shop polish or a landmark while the next producer has
    // no legal footprint. The next sitting must choose the measured
    // UPGRADE_RESOURCE or ACQUIRE_LAND plan; no public rules actor may spend
    // the sitting behind the model's back.
    const resourceEmergency = source === 'llm'
      ? t.growth?.resourceEmergency?.()
      : null;
    if (resourceEmergency) {
      const sameResource = !parsed.params?.resource || parsed.params.resource === resourceEmergency.resource;
      const allowed = parsed.intent === 'TRADE_BUY' || parsed.intent === 'HIRE_WORKERS' ||
        (resourceEmergency.kind === 'land' && parsed.intent === 'ACQUIRE_LAND') ||
        ((resourceEmergency.kind === 'upgrade' || resourceEmergency.kind === 'site') && parsed.intent === 'UPGRADE_RESOURCE' && sameResource);
      if (!allowed) {
        decision.status = 'blocked';
        decision.detail = `${resourceEmergency.resource} capacity emergency — ${resourceEmergency.intent} takes priority over ${parsed.intent}`;
        this.requiredAction = {
          intent: resourceEmergency.intent,
          resource: resourceEmergency.resource,
          kind: resourceEmergency.kind,
          detail: decision.detail,
          day: t.clockDay || 0,
          attempts: (this.requiredAction?.resource === resourceEmergency.resource
            ? this.requiredAction.attempts || 0
            : 0) + 1
        };
        decision.requiredAction = `INTENT: ${resourceEmergency.intent} resource=${resourceEmergency.resource}`;
        this.blockedRemedyAttempts = this.requiredAction.attempts;
        this.record(decision);
        return this.fallback ? this.substitute(decision) : decision;
      }
    }
    const plan = type ? planFor(t, type, parsed.params) : null;
    if (!plan) {
      decision.detail =
        parsed.intent === 'UPGRADE_ROAD'
          ? parsed.params?.to
            ? `no corridor can be raised to ${XS_CLASS_LABEL[parsed.params.to] || parsed.params.to}`
            : 'every corridor is already a boulevard'
          : parsed.intent === 'ACQUIRE_LAND'
            ? t.growth?.unwantedWhy?.('land') || NULL_PLAN_DETAIL[parsed.intent]
          : parsed.intent === 'UPGRADE_RESOURCE'
            ? resourcePlanFailure(t, parsed.params)
          : NULL_PLAN_DETAIL[parsed.intent] || 'no procedure for that action';
      this.record(decision);
      // A dry resource without an upgradeable site is a land prerequisite, not
      // a dead-end UPGRADE_RESOURCE loop. This mirrors the factory
      // prerequisite substitution below and lets the next sitting acquire a
      // complete producer footprint plus access spur.
      if ((source === 'test' || (!this.councilOnly && this.fallback)) && parsed.intent === 'UPGRADE_RESOURCE' && t.growth.resourceLandNeed?.(parsed.params?.resource || null)) {
        const acquisition = this.enact('INTENT: ACQUIRE_LAND', source === 'test' ? 'test' : 'rules');
        acquisition.substituted = {
          intent: decision.intent,
          status: decision.status,
          detail: decision.detail,
          confidence: decision.confidence,
          how: decision.how
        };
        return acquisition;
      }
      return decision;
    }
    plan.origin = source === 'llm' ? 'LLM' : source === 'test' ? 'TEST' : 'RULE';

    const unneeded = source === 'llm' && !plan.forceNeed && !t.growth.wanted(plan.type === 'utility' ? plan.kind : plan.type);
    const quoted = t.growth.quote(plan);
    if (!quoted.ok) {
      decision.status = 'blocked';
      decision.detail = quoted.reason;
      this.record(decision);
      // A model may still repeat BUILD_FACTORY after seeing a frontier
      // works need. When the complete campus is not on acquired serviced land,
      // make the prerequisite explicit instead of falling back to an unrelated
      // build and leaving the factory demand stranded.
      if ((source === 'test' || (!this.councilOnly && this.fallback)) && parsed.intent === 'BUILD_FACTORY' && t.growth.factoryLandNeeded?.(parsed.params || {})) {
        const acquisition = this.enact('INTENT: ACQUIRE_LAND', source === 'test' ? 'test' : 'rules');
        acquisition.substituted = {
          intent: decision.intent,
          status: decision.status,
          detail: decision.detail,
          confidence: decision.confidence,
          how: decision.how
        };
        return acquisition;
      }
      return source === 'llm' && this.fallback ? this.substitute(decision) : decision;
    }
    decision.quotedCost = quoted.quote.finalCost;
    if (plan.blockId) {
      decision.blockId = plan.blockId;
      decision.modules = [...(plan.modules || [])];
      decision.materials = { ...(plan.materials || {}) };
      decision.labourHours = plan.labourHours || null;
    }
    // A road quote chose exact cells. Apply that draft so its paid order
    // cannot silently choose a different run.
    const committedPlan = plan.type === 'road' ? quoted.plan : plan;

    // Two open sites is enough: council-ordered work waits its turn (probe
    // sources drive scripted scenarios and bypass this).
    if (
      (source === 'llm' || source === 'rules' || source === 'test') &&
      activePublicProjects(t.growth) >= MAX_ACTIVE &&
      plan.type !== 'land'
    ) {
      decision.status = 'noop';
      decision.detail = `public building paused — ${activePublicProjects(t.growth)} public projects already underway`;
      this.record(decision);
      return decision;
    }

    // The model may only order what the town actually needs; a stale pick is
    // feedback, not a dead end (the rules source comes from ranked() already).
    const res = unneeded ? null : t.growth.apply(committedPlan);
    const started = !!res && res.status === 'started';
    // Phase 18 — a district is COMMISSIONED now and built later, so its own
    // status is 'queued' rather than 'done': the work is not finished, and the
    // council card should not imply it is.
    const queued = !!res && res.status === 'queued';
    decision.status = !res ? 'blocked' : started ? 'started' : queued ? 'queued' : 'done';
    decision.quotedCost = quoted.quote.finalCost;
    decision.committedCost = res && !queued ? committedPlan.cost || 0 : 0;
    decision.actualSpend = res && !queued ? committedPlan.cost || 0 : 0;
    decision.projectId = res && !queued ? committedPlan.projectId || null : null;
    decision.cost = decision.actualSpend;
    decision.detail = res
      ? plan.label + (started ? ` — ${res.hours}h build` : queued ? ` — ${res.steps} more to queue` : '')
      : unneeded
        ? (t.growth.unwantedWhy
            ? t.growth.unwantedWhy(plan.type === 'utility' ? plan.kind : plan.type) || 'the town does not need this right now'
            : 'the town does not need this right now')
        : t.growth.lastBlock || 'no free plot and no room to expand';
    if (res && (parsed.intent === 'UPGRADE_RESOURCE' || parsed.intent === 'ACQUIRE_LAND' || parsed.intent === 'TRADE_BUY' || parsed.intent === 'HIRE_WORKERS')) {
      const current = t.growth.resourceEmergency?.();
      if (!current || current.resource === this.requiredAction?.resource) {
        this.requiredAction = null;
        this.blockedRemedyAttempts = 0;
      }
    }
    if (res && plan.blockId) {
      decision.detail += ` · ${plan.blockId} (${(plan.modules || []).join(', ')})`;
    }
    if (res && plan.designGap) {
      decision.detail += ` · design gap: ${plan.designReason || plan.designGap}`;
    }
    if (res && committedPlan.type === 'road') {
      decision.detail += ` at ${committedPlan.cells[0].join(', ')} (${committedPlan.roadTiles} tiles; ${committedPlan.roadReason})`;
    }
    // Phase 30 (S19b) — `spent` is now accumulated in `record()`, not here.
    // Only this one branch ever added to it, so tax, bonds, subsidies, schemes,
    // campaigns, trade and festivals set `decision.cost` and never reached
    // `stats().spent`; the counter and the ledger disagreed by construction.
    this.record(decision);
    // An infeasible pick from the model is feedback, not a dead end: the
    // planner re-decides from ranked feasibility (rules source never recurses).
    if (!res && source === 'llm' && this.fallback) return this.substitute(decision);
    return decision;
  }

  /**
   * Build feasibility board for the report: which intents can start now,
   * which cannot and why, plus the planner's current top priorities.
   */
  planBoard() {
    const t = this.town;
    const g = t.growth;
    if (!g || !g.ranked) return null;
    const rngState = g.rng?.getState?.();
    try {
    const feasible = [];
    const blocked = [];
    const priority = [];
    // The board mirrors ranked(): what the town wants, then whether it can
    // start — so a settled town reports "none outstanding" instead of a
    // menu of comfortable-town filler. Full codes (zone=…) reach the model.
    for (const c of g.ranked()) {
      const plan = planFor(t, c.type, c.opts);
      if (!plan) continue;
      const quotation = g.quote(plan);
      const why = quotation.ok ? '' : quotation.reason;
      const code = planCode(plan);
      if (why) {
        if (blocked.length < 4) blocked.push(`${code} (${why})`);
      } else {
        // Feasible now lists EVERYTHING the town could build (the model may
        // still deliberately choose a park); Priority lists only demand work,
        // so a settled town reads "none outstanding" → NO_ACTION.
        if (feasible.length < 6) feasible.push(code);
        if (!c.amenity && priority.length < 3) priority.push(code);
      }
    }
    return { feasible, blocked, priority };
    } finally {
      if (rngState !== undefined) g.rng.setState(rngState);
    }
  }

  /** Planner fallback: enact the top feasible DEMAND plan under the rules
   *  source. Amenity work (park/archetype/filler floor) never fills this slot —
   *  with nothing to demand outstanding the fallback is NO_ACTION (Phase 4 C3). */
  replan() {
    if (this.councilOnly) return null;
    let plan = this.town.growth.evaluate({ amenities: false });
    let code = planCode(plan);
    // With nothing to build, staff gaps still give the council work.
    if (code === 'NO_ACTION') {
      const need = this.staffNeed();
      if (need && need.gap) code = 'HIRE_WORKERS';
    }
    return this.enact(`INTENT: ${code}`, 'rules');
  }

  /**
   * Synchronous test-only request boundary. A horizon probe can inject a
   * deterministic council motion without waiting for the six-hour scheduler
   * or a provider timeout. It still uses enact(), so parsing, affordability,
   * construction, ledger entries, and learning remain under test.
   */
  forceRequest(text) {
    const raw = String(text || '').trim();
    const reply = /^\s*(?:INTENT|ACTION|DECISION)\s*:/i.test(raw) ? raw : `INTENT: ${raw}`;
    // Keep the normal crew and affordability gates. The test hook forces the
    // request to be considered immediately; it must not create a second
    // construction lane that production council traffic could not create.
    const decision = this.enact(reply, 'test');
    this.forcedRequests = (this.forcedRequests || 0) + 1;
    if (decision) decision.forced = true;
    return decision;
  }

  recordMayorMotion(motion, status, detail) {
    const parsed = motion?.intent
      ? { intent: motion.intent, confidence: 1, how: 'cabinet' }
      : parseIntent(motion?.raw || '');
    const decision = {
      day: this.town.clockDay || 0,
      source: 'llm',
      actor: 'Mayor',
      intent: parsed.intent,
      confidence: parsed.confidence,
      how: parsed.how,
      status,
      detail: `Mayor ${status === 'mayor_deferred' ? 'deferred' : 'rejected'} — ${detail || 'motion did not pass the approval gate'}`,
      cost: 0,
      motionId: motion?.id || null,
      department: motion?.department || null,
      departmentLabel: motion?.departmentLabel || null,
      mayor: status === 'mayor_deferred' ? 'deferred' : 'rejected',
      raw: String(motion?.raw || '').slice(0, 240),
      _ledgerStart: this.town.economy?.ledger?.length || 0,
      _learningBefore: measureCouncilState(this.town)
    };
    this.record(decision);
    return decision;
  }

  /**
   * Phase 30 (S19b) — the planner's answer to a motion that could not start.
   *
   * `enact` used to `return this.replan()` here, which lost the model's actual
   * motion: it returned the substitute, so the council card showed only the
   * rules decision, the model's motion existed nowhere the town could see it
   * (it had been recorded, so it held a ledger slot and a share of the persona),
   * and `ask()` then stamped its measured latency on the *substitute*.
   *
   * So both are now returned, and the substitute is marked as one. The chosen
   * decision is what the town acts on and what the card shows; the substituted
   * motion rides along on it and in `stats()`.
   */
  substitute(modelDecision) {
    if (this.councilOnly) return modelDecision;
    // A generic replan is normally useful, but it is unsafe during a primary
    // resource capacity emergency: if the emergency row is temporarily
    // blocked by a quote detail, ranked() can fall through to a housing/floor
    // upgrade and repeat the exact starvation shown in the Council card. Drive
    // the measured remedy directly, and leave the failure visible if that
    // remedy itself cannot start.
    const emergency = this.town.growth?.resourceEmergency?.();
    let chosen = null;
    if (emergency?.kind === 'upgrade') {
      chosen = this.enact(`INTENT: UPGRADE_RESOURCE resource=${emergency.resource}`, 'rules');
    } else if (emergency?.kind === 'land') {
      chosen = this.enact('INTENT: ACQUIRE_LAND', 'rules');
    } else {
      chosen = this.replan();
    }
    if (chosen) {
      chosen.substituted = {
        intent: modelDecision.intent,
        status: modelDecision.status,
        detail: modelDecision.detail,
        confidence: modelDecision.confidence,
        how: modelDecision.how
      };
    }
    return chosen;
  }

  /** Crew each workforce should hold: farms two a site, power one — plus the
   *  businesses' own shortfalls, so one gap figure drives HIRE_WORKERS for
   *  sites and shops alike (C1). */
  staffNeed() {
    const res = this.town.resources;
    const eco = this.town.economy;
    if ((!res || !res.staffCounts) && !eco) return null;
    const want = Object.fromEntries(CREW_ROLES.map((r) => [r, 0]));
    for (const s of res?.sites || []) {
      // Tier-aware like the staffing pass: ask the site what it needs.
      // Workless sites (lake, storehouses) need no hands and add no key.
      if (!s.work || !(s.work in want)) continue;
      want[s.work] += res.siteCrew ? res.siteCrew(s) : (SITE_CREW[s.work]?.crew || 0);
    }
    const staff = res?.staffCounts ? res.staffCounts() : Object.fromEntries(CREW_ROLES.map((r) => [r, 0]));
    let gap = CREW_ROLES.reduce((n, r) => n + Math.max(0, want[r] - (staff[r] || 0)), 0);
    const biz = { have: 0, need: 0 };
    if (eco && eco.businesses) {
      for (const z of eco.businesses) {
        const n = z.staffNeed ?? eco.staffNeeded(z.building);
        biz.have += z.employees;
        biz.need += n;
        // A post the OWNER cannot fund is not a gap the council should close by
        // importing a stranger — it is the owner's problem, and counting it
        // here is what let HIRE_WORKERS conjure private staff by fiat.
        const short = Math.max(0, n - z.employees);
        gap += eco.ownerCanPay ? (eco.ownerCanPay(z) ? short : 0) : short;
      }
    }
    const civic = this.town.lifecycle?.civicStaffing
      ? this.town.lifecycle.civicStaffing()
      : { rows: [], have: 0, need: 0, filled: 0, open: 0 };
    gap += civic.open;
    return { want, staff, biz, civic, gap };
  }

  /**
   * Phase 16 — ATTRACT_SETTLERS. The campaign multiplies a pull the town
   * already has, so spending on it while there are no spare beds and no open
   * posts buys nothing at all. The council is told exactly that, because
   * refusing outright would hide the reason the pull is low.
   */
  attractSettlers(decision) {
    const lc = this.town.lifecycle;
    const st = lc ? lc.stability() : null;
    if (!st) {
      decision.status = 'rejected';
      decision.detail = 'the town has no population record to attract anyone to';
      this.record(decision);
      return decision;
    }
    // Already-running first: it is the truest answer, and the checks below
    // would otherwise answer for a town the campaign is already addressing.
    if (lc.campaign > 1) {
      decision.status = 'noop';
      decision.detail = `a campaign is already running — pull ×${lc.campaign} for ${Math.max(0, lc.campaignDays - (lc.campaignDay - lc.campaignFrom))} more days`;
      this.record(decision);
      return decision;
    }
    if (st.spareBeds <= 0) {
      decision.status = 'rejected';
      decision.detail = `no spare beds (${st.beds} for ${st.population}) — there is nowhere for newcomers to live`;
      this.record(decision);
      return decision;
    }
    // Posts on offer, not vacancies: a fully-employed town is a working town
    // (and `pull()` scores it that way). What kills a campaign is a town with
    // no work at all, or one already at its band.
    if (st.posts <= 0) {
      decision.status = 'rejected';
      decision.detail = 'the town offers no work at all — newcomers would have nothing to do';
      this.record(decision);
      return decision;
    }
    if (st.population >= st.target) {
      decision.status = 'rejected';
      decision.detail = `the town is already at its band (${st.population}/${st.target})`;
      this.record(decision);
      return decision;
    }
    if (this.town.economy.treasury < CAMPAIGN.cost) {
      decision.status = 'rejected';
      decision.detail = `treasury ${Math.round(this.town.economy.treasury)} below ${CAMPAIGN.cost} — a campaign costs ${CAMPAIGN.cost}`;
      this.record(decision);
      return decision;
    }
    const r = lc.startCampaign(CAMPAIGN);
    decision.status = 'done';
    decision.cost = r.cost;
    decision.detail = `campaign opens for ${r.days} days — pull ×${r.multiplier} on ${st.spareBeds} spare beds and ${st.posts} posts`;
    this.record(decision);
    return decision;
  }

  /**
   * Phase 17 — FUND_INNOVATION. A bucket's ceiling is DERIVED from the
   * subsystem behind it (pupil places, works, unmapped edge cells), so the
   * council is told what would have to exist before the town can spend on that
   * line of research — which is the diagnosis, not a refusal for its own sake.
   */
  fundInnovation(params, decision) {
    const res = this.town.research;
    if (!res) {
      decision.status = 'rejected';
      decision.detail = 'the town has no research programme';
      this.record(decision);
      return decision;
    }
    const head = res.headroom();
    // Bare order: the bucket with the most unfunded capacity.
    const id = params && params.bucket ? params.bucket : this.widestResearchBucket(head);
    if (!id) {
      decision.status = 'noop';
      const bases = BUCKET_IDS.map((b) => `${BUCKETS[b].label} ${head[b].ceiling}`).join(' · ');
      decision.detail = `no research bucket has capacity — ${bases}`;
      this.record(decision);
      return decision;
    }
    const ceiling = head[id].ceiling;
    if (ceiling <= 0) {
      decision.status = 'rejected';
      decision.detail = `${BUCKETS[id].label} has no capacity to fund — it needs ${BUCKETS[id].hint} (${head[id].basis})`;
      this.record(decision);
      return decision;
    }
    const r = res.fund(id, ceiling);
    decision.status = 'done';
    decision.detail = `${BUCKETS[id].label} funded at $${r.amount}/day — the ceiling for ${head[id].basis}`;
    this.record(decision);
    return decision;
  }

  /** The bucket with the most unfunded capacity — the bare FUND_INNOVATION. */
  widestResearchBucket(head) {
    let best = null;
    let bestRoom = 0;
    for (const id of BUCKET_IDS) {
      const room = (head[id].ceiling || 0) - (head[id].funding || 0);
      if (room > bestRoom) {
        bestRoom = room;
        best = id;
      }
    }
    return best;
  }

  /**
   * Phase 15 — ENACT_SCHEME / END_SCHEME / PASS_LAW / REPEAL_LAW. A bare order
   * (no id in the reply) picks the first catalogue row the town can actually
   * afford, so the intent is never a dead end; the spec is a pin, not a
   * requirement. The council always learns which row it got and what it cost.
   */
  policy(intent, params, decision) {
    const t = this.town;
    const pol = t.policy;
    if (!pol) {
      decision.status = 'rejected';
      decision.detail = 'the council has no policy machinery';
      this.record(decision);
      return decision;
    }
    const id = params && params.id ? params.id : null;
    let r;
    if (intent === 'ENACT_SCHEME') {
      r = pol.enactScheme(id || this.firstAffordable('scheme'), t.clockDay || 0);
    } else if (intent === 'END_SCHEME') {
      r = pol.endScheme(id || (pol.active[0] && pol.active[0].id));
    } else if (intent === 'PASS_LAW') {
      r = pol.passLaw(id || this.firstAffordable('law'));
    } else {
      r = pol.repealLaw(id || (pol.laws[0] && pol.laws[0].id));
    }

    if (!r.ok) {
      decision.status = r.reason && /already/.test(r.reason) ? 'noop' : 'rejected';
      decision.detail = r.reason || 'the order could not be carried out';
      this.record(decision);
      return decision;
    }
    decision.cost = r.cost || 0;
    if (intent === 'ENACT_SCHEME') {
      decision.status = 'done';
      // `ENACT_SCHEME` is deliberately routed to a statute when the id names
      // one (policy.js's cross-family routing), and a LAW row has no `days` or
      // `per` — so the scheme-shaped sentence printed "undefined days at
      // $undefined/day" for what was in fact a law being passed. Verified twice:
      // the effect was applied correctly (`policy.laws` gained the statute, the
      // modifier took effect), and only the council's own account of it was
      // wrong. Select the sentence from the row's actual shape.
      const isLaw = r.isLaw || r.row.days == null;
      decision.detail = isLaw
        ? `${r.row.label} is law — $${r.cost}`
        : `${r.row.label} runs ${r.row.days} days at $${r.row.per}/day — $${r.cost} to start`;
    } else if (intent === 'PASS_LAW') {
      decision.status = 'done';
      decision.detail = `${r.row.label} is law — $${r.cost}`;
    } else if (intent === 'END_SCHEME') {
      // `r.count` is only set by the "end them all" branch; ending one specific
      // programme is still real work, so key off the row that was removed.
      decision.status = r.ok ? 'done' : 'noop';
      decision.detail = r.count
        ? `all ${r.count} running programmes wound up`
        : `${r.row.label} wound up`;
    } else {
      decision.status = 'done';
      decision.detail = `${r.row.label} repealed`;
    }
    this.record(decision);
    return decision;
  }

  /** The first catalogue row the treasury can pay for, skipping live ones. */
  firstAffordable(what) {
    const t = this.town;
    const pool = what === 'law' ? LAWS : SCHEMES;
    const taken = what === 'law' ? t.policy.laws.map((l) => l.id) : t.policy.active.map((s) => s.id);
    for (const row of pool) {
      if (taken.includes(row.id)) continue;
      if (t.economy.treasury < row.cost) continue;
      return row.id;
    }
    return null;
  }

  /** HIRE_WORKERS — newcomers in for the staff gaps at the sites and in the
   *  businesses. Never a shuffle of existing townsfolk (the user rule): every
   *  recruit is an arrival, credentialed for the role via credentialFloor. */
  hire(decision) {
    const t = this.town;
    // Owners hire their own staff from the town's residents (EconomySystem
    // `hireResidents`, run on every `assignEmployees`). By the time the council
    // is asked, those posts are already filled or unfunded, so this is a
    // BACKSTOP: it only reaches for an immigrant when the private sector could
    // not fill the gap itself, and it says so.
    const need = this.staffNeed();
    if (!need) {
      decision.status = 'rejected';
      decision.detail = 'no resource sites to staff';
      this.record(decision);
      return decision;
    }
    const crewLine = (n) =>
      CREW_ROLES.map((r) => `${SITE_CREW[r].label} ${n.staff[r] || 0}/${n.want[r] || 0}`).join(' · ');
    if (!need.gap) {
      decision.status = 'noop';
      decision.detail = `every post is filled — ${crewLine(need)}, businesses ${need.biz?.have ?? 0}/${need.biz?.need ?? 0}, civic ${need.civic?.filled ?? 0}/${need.civic?.need ?? 0}`;
      this.record(decision);
      return decision;
    }

    const eco = t.economy;
    let hired = 0;
    while (hired < 3) {
      const liveCivic = t.lifecycle?.civicStaffing ? t.lifecycle.civicStaffing() : { rows: [], open: 0 };
      // Worst site shortfall, biggest first; the businesses are the fallback.
      const gaps = CREW_ROLES.map((r) => [r, Math.max(0, need.want[r] - (need.staff[r] || 0))]);
      gaps.sort((a, b) => b[1] - a[1]);
      const [topRole, gapSite] = gaps[0] || [];
      // Worst business shortfall the OWNER could fund — the council only
      // backstops a post that private capital is willing to carry.
      let gapBiz = 0;
      let bizJob = null;
      if (eco && eco.businesses) {
        eco.assignEmployees();
        for (const z of eco.businesses) {
          const n = z.staffNeed ?? eco.staffNeeded(z.building);
          const g = eco.ownerCanPay && !eco.ownerCanPay(z) ? 0 : Math.max(0, n - z.employees);
          if (g > gapBiz) {
            gapBiz = g;
            bizJob =
              z.type === 'industry'
                ? { sawmill: 'millworker', steelworks: 'metallurgist', cement: 'cementworker' }[
                    t.industry?.typeOf(z.building)?.id
                  ] || 'assembler'
                : ['baker', 'barista', 'shopkeeper', 'chef'][this.rng.int(0, 3)];
          }
        }
      }
      const civicRow = liveCivic.rows
        .filter((row) => row.open > 0)
        .sort((a, b) => b.open - a.open)[0];
      const gapCivic = civicRow?.open || 0;
      const civicJob = civicRow
        ? (['school', 'college', 'university', 'conservatory', 'daycare'].includes(civicRow.facility)
            ? 'teacher'
            : ['clinic', 'hospital'].includes(civicRow.facility)
              ? 'nurse'
              : civicRow.facility === 'library' || civicRow.facility === 'museum'
                ? 'librarian'
                : 'clerk')
        : null;
      let job = null;
      if (gapSite > 0 && gapSite >= gapBiz && gapSite >= gapCivic) job = jobById(SITE_CREW[topRole].job);
      else if (gapBiz > 0 && gapBiz >= gapCivic) job = jobById(bizJob);
      else if (gapCivic > 0) job = jobById(civicJob);
      if (!job || !t.lifecycle.immigrate({ job })) break;
      if (CREW_ROLES.includes(job.work)) need.staff[job.work] = (need.staff[job.work] || 0) + 1;
      hired++;
    }

    decision.status = hired ? 'done' : 'rejected';
    if (hired) {
      const fresh = this.staffNeed();
      if (fresh) {
        need.staff = fresh.staff;
        need.biz = fresh.biz;
        need.civic = fresh.civic;
        need.gap = fresh.gap;
      }
    }
    decision.detail = hired
      ? `hired ${hired} newcomer${hired === 1 ? '' : 's'} from neighbouring towns — ${crewLine(need)}, businesses ${need.biz?.have ?? 0}/${need.biz?.need ?? 0}, civic ${need.civic?.filled ?? 0}/${need.civic?.need ?? 0} staffed`
      : 'no vacant homes for newcomers';
    this.record(decision);
    return decision;
  }

  /** Advisory intents: a read-out of one subsystem — never a build. */
  study(intent) {
    const t = this.town;
    const f = (v) => Math.round(v || 0).toLocaleString('en-US');
    if (intent === 'STUDY_ROAD') {
      const mb = t.traffic.mobilityStats();
      return `roads ${t.grid.roadCells().length} tiles · congestion ${Math.round(mb.congestion * 100)}% · parking demand ${mb.parkingDemand}/${mb.parkingSupply} (forecast) · ${mb.parkingTaken} taken · avg speed ${Math.round(mb.avgSpeed)}`;
    }
    if (intent === 'STUDY_ECONOMY') {
      const e = t.economy.stats();
      return (
        `GDP $${f(e.gdp)} · treasury $${f(e.treasury)} · reserve $${f(e.reserve)} · debt $${f(e.debt)} · ` +
        `tax $${f(e.taxRevenue)} and spending $${f(e.spending)} to date (spending ×${e.spendingScale}) · ` +
        `${e.businesses} businesses · avg income $${f(e.avgIncome)}`
      );
    }
    if (intent === 'STUDY_DEMOGRAPHICS') {
      const l = t.lifecycle.stats();
      const stages = Object.entries(l.stages)
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ');
      return (
        `population ${l.population} (target ${l.target}) · median age ${l.medianAge} · ${stages} · ` +
        `+${l.born} born · −${l.died} died · +${l.movedIn} in · −${l.movedOut} out`
      );
    }
    if (intent === 'STUDY_TRAFFIC') {
      const mb = t.traffic.mobilityStats();
      return (
        `${mb.vehicles} vehicles · ${mb.moving} moving · ${mb.parked} parked · congestion ${Math.round(mb.congestion * 100)}% · ` +
        `parking demand ${mb.parkingDemand}/${mb.parkingSupply} (forecast) · ${mb.parkingTaken} taken · ${mb.parkingDenied} turned away · ${mb.trips} trips · avg ${Math.round(mb.avgTripMin)} min`
      );
    }
    if (intent === 'STUDY_INCIDENTS') {
      const i = t.incidents.stats();
      const fl = t.traffic.fleetStats();
      const kinds = Object.entries(i.byKind)
        .map(([k, n]) => `${n} ${k}`)
        .join(' · ');
      const states = Object.entries(i.byState || {})
        .map(([k, n]) => `${n} ${k}`)
        .join(' · ');
      return (
        `${i.open} open (${kinds || 'none'}) · ${i.taken} claimed${states ? ` [${states}]` : ''} · fleet ${fl.emergency} emergency · ` +
        `${fl.service} service · ${fl.civilian} civilian${i.emergency ? ' · EMERGENCY DECLARED' : ''}`
      );
    }
    return 'no study for that subject';
  }

  /**
   * HOST_EVENT — the town gathers at a venue and comes away in better spirits.
   * mood is DERIVED from optimism every frame, so a one-frame mood spike would
   * be cosmetic; the event raises optimism instead, which is a lasting lift.
   * One festival a week.
   */
  hostEvent(decision) {
    const t = this.town;
    const day = t.clockDay || 0;
    if (this.lastEventDay > -999 && day - this.lastEventDay < 7) {
      decision.status = 'noop';
      decision.detail = `next festival not due for ${7 - (day - this.lastEventDay)} days`;
      this.record(decision);
      return decision;
    }
    const VENUES = ['amphitheatre', 'market', 'stadium', 'multiplex', 'zoo', 'mall'];
    const landmarkVenue = t.buildings.find((b) => VENUES.includes(b.subtype));
    let parkCells = 0;
    if (!landmarkVenue) {
      t.grid.forEach((x, y, g) => {
        if (g.kindAt(x, y) === CELL_KIND.PARK) parkCells++;
      });
    }
    const venue = landmarkVenue || (parkCells > 0 ? { name: `the green (${parkCells} cells)` } : null);
    if (!venue) {
      decision.status = 'rejected';
      decision.detail = 'no venue — build an amphitheatre, market or park first';
      this.record(decision);
      return decision;
    }
    let lifted = 0;
    for (const c of t.pedestrians.citizens) {
      const before = c.p.optimism;
      c.p.optimism = Math.min(1, before + 0.04);
      if (c.p.optimism > before) lifted++;
    }
    this.lastEventDay = day;
    decision.status = 'done';
    decision.detail = `festival at ${venue.name || venue.subtype} — ${lifted} residents gained a lasting lift`;
    this.record(decision);
    return decision;
  }

  record(decision) {
    decision.decisionId ||= `decision-${++this.decisionSeq}`;
    decision.sittingId ||= this.activeSittingId || `manual-${this.decisionSeq}`;
    decision.origin ||= ({ llm: 'LLM', rules: 'RULE', test: 'TEST', developer: 'DEVELOPER', system: 'SYSTEM' }[decision.source] || 'SYSTEM');
    decision.responseId ||= decision.origin === 'LLM' ? this.activeResponseId : null;
    decision.quotedCost ??= Number(decision.cost) || 0;
    const rows = this.town.economy?.ledger?.slice(decision._ledgerStart ?? this.town.economy.ledger.length) || [];
    const expense = (sector) => {
      const outgoing = rows.filter((tx) => tx.from?.sector === sector && !['project_reversal', 'reserve_allocation'].includes(tx.category))
        .reduce((n, tx) => n + tx.amount, 0);
      const refunds = rows.filter((tx) => tx.to?.sector === sector && tx.category === 'project_reversal')
        .reduce((n, tx) => n + tx.amount, 0);
      return Math.max(0, outgoing - refunds);
    };
    decision.actualPublicSpend = expense('government');
    decision.actualPrivateSpend = expense('developer') + expense('business') + expense('household');
    decision.actualSpend = decision.actualPublicSpend + decision.actualPrivateSpend;
    decision.committedCost ??= decision.actualSpend;
    decision.cost = decision.actualSpend;
    decision.transactions = rows.map((tx) => tx.id);
    const learningBefore = decision._learningBefore;
    const learningAfter = measureCouncilState(this.town);
    this.town.kpi?.recordDecision?.(decision, learningBefore, learningAfter);
    delete decision._learningBefore;
    delete decision._ledgerStart;
    this.lastDecision = decision;
    this.decisions.push(decision);
    if (this.decisions.length > 30) this.decisions.shift();
    // A project that is later rolled back must still be FINDABLE. `decisions` is
    // a 30-deep display window and the persona ledger is 40 deep, so a project
    // that failed hours of game time later — after 30 more council decisions —
    // fell out of both. `projectRolledBack` then found nothing, returned
    // silently, and `this.spent` kept the money for ever: measured $45,400
    // against a persona budget of $0.
    //
    // An unbounded map keyed by project id is the fix. It is one small entry per
    // live project and a rollback is the only lookup, so nothing reads it on the
    // frame path.
    if (decision.projectId) this.spentByProject.set(decision.projectId, decision);
    // Phase 30 (S19b) — the one place spend is accumulated. It used to be added
    // on the growth branch of `enact` alone, so every other intent that spends
    // (tax, bond, subsidy, scheme, law, campaign, trade) set `decision.cost`
    // and never reached this counter. `stats().spent` and the ledger's `spent`
    // are now the same number by construction rather than by coincidence.
    this.spent += Number(decision.cost) || 0;
    this.ledger.record(decision);
    this.learning.track(decision, learningBefore, learningAfter);
    events.emit('log', {
      kind: 'council',
      text: `Council [${decision.source}] ${decision.intent}: ${decision.status} — ${decision.detail}`
    });
    events.emit('council', decision);
  }

  projectRolledBack(projectId, reason = 'construction_failed') {
    // Resolved from the unbounded map, not from the 30-deep display window, so a
    // late rollback still returns the money instead of leaking it silently.
    const decision = this.spentByProject.get(projectId)
      || this.decisions.findLast((d) => d.projectId === projectId);
    if (!decision) return;
    this.spent -= decision.actualSpend || 0;
    this.ledger.reviseProject(projectId, 'failed_rolled_back', 0);
    decision.actualSpend = 0;
    decision.actualPublicSpend = 0;
    decision.actualPrivateSpend = 0;
    decision.cost = 0;
    decision.status = 'failed_rolled_back';
    decision.reason = reason;
    decision.reversals = this.town.economy?.projectTransactions(projectId).filter((tx) => tx.category === 'project_reversal').map((tx) => tx.id) || [];
    const lesson = this.learning?.pending?.find((item) => item.decisionId === decision.decisionId);
    if (lesson) lesson.status = decision.status;
  }

  /**
   * Phase 19 (A0) — the council's voice, derived from what it has actually done.
   * Delegates to `persona(this.ledger)`, which reads ONLY the rolling decision
   * ledger. There are no trait adjectives and no hardcoded archetypes in here:
   * the same history always produces the same sentences, and a different
   * history produces different ones because the numbers differ.
   */
  persona() {
    return persona(this.ledger);
  }

  /**
   * One sitting. Ask the model, then enact whatever it said.
   *
   * Phase 30 (S19b) — the boundary this method *is*:
   *
   *   • a **timeout** (`ASK_TIMEOUT_MS`) with a real `AbortSignal`, so a hung
   *     upstream cannot pin `pending` and silence every later sitting;
   *   • an **epoch guard**, so a reply that arrives after `reset()` — after the
   *     town was regenerated underneath it — is discarded instead of enacted
   *     against a town its reasoning never saw;
   *   • a **failure counter** with `ASK_FAIL_LIMIT`, pausing public autonomous
   *     construction rather than retrying a dead endpoint every slot;
   *   • a bounded temperature plus a one-entry `(situationKey → decision)` cache,
   *     with a one-entry situation cache so stable situations do not churn.
   *     The default 0.15 adds small construction variation; set temperature=0
   *     for exact provider replay in audits.
   *   • the **substitution** is returned alongside the choice, so the model's
   *     own motion is never silently replaced (see `substitute()`).
   */
  async ask() {
    if (this.cabinet?.enabled) return this.askCabinet();
    if (this.pending) return { status: 'busy' };
    if (!this.enabled) return { status: 'disabled' };
    this.captureMapNow();
    this.activeResponseId = null;
    const started = Date.now();
    const epoch = this.epoch;
    const requestId = ++this.requestSeq;
    this.activeRequestId = requestId;
    const isCurrent = () => this.epoch === epoch && this.activeRequestId === requestId;
    try {
      // `pending` is set INSIDE the guard, immediately before the first await,
      // and `situationKey()` — the one call that walks every subsystem and is
      // therefore the one that can throw — is inside it too. It used to sit
      // outside: a fault in `situationKey` left `pending` true, every later ask
      // returned 'busy', and since `main.js` holds `clock.speed = 0` for as long
      // as `pending` is set, the entire simulation froze for good with the HUD
      // reading "thinking". That is precisely what ASK_TIMEOUT_MS exists to
      // prevent, and a throw beat it.
      this.pending = true;
      // A sitting the model has already answered. Keyed on the situation, so it
      // is only ever hit when nothing has changed since the last call.
      const key = this.situationKey();
      // A previous model reply is an audit artifact, never a fresh mandate.
      // The provider is the only network boundary. Every model adapter gets
      // the same messages, timeout, temperature, and token budget.
      // A provider can misunderstand a hard sequencing constraint even when
      // the report states it. Give it one immediate, explicit correction in
      // the same sitting so one bad construction choice does not consume the
      // next three scheduled sittings. This remains a Council decision: the
      // second response is still parsed, checked, financed, and recorded by
      // the normal boundary; there is no deterministic public fallback.
      let correction = '';
      let decision = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const reply = await this.provider.complete({
          endpoint: this.endpoint,
          model: this.model,
          temperature: this.temperature,
          maxTokens: 160,
          signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
          messages: [
            { role: 'system', content: systemPrompt(this.town) },
            {
              role: 'user',
              content: `${this.report()}${correction ? `\n\n${correction}` : ''}`
            }
          ],
          town: this.town,
          sittingId: this.activeSittingId
        });
        const data = reply?.raw || {};
        const text = reply?.text || '';
        // The town may have been regenerated while the model was thinking. Its
        // answer describes a town that no longer exists; enacting it would spend
        // the new town's money on the old town's reasoning.
        if (!isCurrent()) {
          this.staleReplies = (this.staleReplies || 0) + 1;
          return { status: 'stale', intent: null, detail: 'the town was regenerated before the reply arrived' };
        }
        this.available = true;
        this.lastError = null;
        this.lastReply = text;
        this.modelUsed = reply?.model || data.model || this.model || this.provider?.id || 'unknown';
        this.activeResponseId = `response-${++this.responseSeq}`;
        this.consecutiveFailures = 0;
        this.rulesOnly = false;
        this.llmCalls++;
        if (key) {
          this.cache = new Map([[key, text]]);
          this.cacheKey = key;
        }
        decision = this.enact(text, 'llm');
        if (!(attempt === 0 && decision?.status === 'blocked' && decision.requiredAction)) break;
        correction = `CORRECTION: your previous action was blocked. Choose exactly ${decision.requiredAction} now because the primary-resource emergency is a hard sequencing constraint. Do not repeat ${decision.intent || 'the blocked action'}; reply with one INTENT line.`;
      }
      // On the model's OWN record: a substitution returns the planner's
      // decision, and that one never spent the model's time.
      decision ||= { status: 'error', intent: null, detail: 'Council returned no decision' };
      decision.ms = Date.now() - started;
      this.activeResponseId = null;
      this.pending = false;
      return decision;
    } catch (err) {
      if (!isCurrent()) {
        this.staleReplies = (this.staleReplies || 0) + 1;
        return { status: 'stale', intent: null, detail: 'the sitting was superseded before it completed' };
      }
      const aborted =
        (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
        /timed out|abort/i.test(String((err && err.message) || err));
      this.available = false;
      this.lastAborted = !!aborted;
      this.lastError = aborted
        ? `no reply within ${ASK_TIMEOUT_MS}ms`
        : String((err && err.message) || err);
      this.consecutiveFailures++;
      // The direct-endpoint fallback runs ONCE per epoch, not once ever: a town
      // regenerated after a proxy failure would otherwise keep the dead URL.
      if (!aborted && this.provider?.kind === 'openai-compatible' && this.endpoint.startsWith('http') && !this.proxied) {
        this.proxied = true;
        this.endpoint = DEFAULT_ENDPOINT;
        this.pending = false;
        this.activeRequestId = null;
        return this.ask();
      }
      if (this.fallback) {
        const rules = this.replan();
        if (rules) {
          rules.substituted = {
            intent: null,
            status: 'error',
            detail: this.lastError,
            confidence: 0,
            how: 'fallback'
          };
        }
        return rules || { status: 'error', intent: null, detail: this.lastError };
      }
      return { status: 'error', intent: null, detail: `${this.lastError} — Council-only mode took no automatic action` };
    } finally {
      // Belt and braces. The catch above already clears `pending` on every path
      // it handles, but it can itself throw while building a fallback sitting,
      // and a `finally` is the only thing that makes "pending is always
      // released" structural rather than a property of every early return.
      if (isCurrent()) {
        this.pending = false;
        this.activeRequestId = null;
      }
    }
  }

  /**
  * Cabinet sitting: each department is a separate provider call with its own
   * system prompt and full context budget. Replies are gathered first, then a
   * sixth Council synthesis call selects the priority candidates; the Mayor
   * validates that selected batch and approved motions enter enact() in the
   * same sitting. A blocked primary-resource motion gets one same-sitting
   * correction call for that minister only.
   */
  async askCabinet() {
    if (this.pending) return { status: 'busy' };
    if (!this.enabled) return { status: 'disabled' };
    this.captureMapNow();
    this.activeResponseId = null;
    const started = Date.now();
    const epoch = this.epoch;
    const requestId = ++this.requestSeq;
    this.activeRequestId = requestId;
    const isCurrent = () => this.epoch === epoch && this.activeRequestId === requestId;
    let finalDecision = null;
    try {
      this.pending = true;
      const sittingId = this.activeSittingId && this.activeSittingId !== this.lastCompletedSittingId
        ? this.activeSittingId
        : `cabinet-${++this.sittingSeq}`;
      this.activeSittingId = sittingId;
      // Every configured minister gets a call every sitting. The setting is
      // the Mayor's approval cap, not a silent filter that could prevent the
      // services minister from reporting a water or emergency shortfall.
      const departments = this.cabinet.departments;
      const report = this.report();
      const callMinister = async (department, correction = '') => {
        try {
          const ministerReport = cabinetReportFor(report, department.id);
          const reply = await this.provider.complete({
            endpoint: this.endpoint,
            model: this.model,
            temperature: this.temperature,
            maxTokens: 320,
            signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
            messages: [
              { role: 'system', content: systemPrompt(this.town, { cabinetDepartment: department }) },
              { role: 'user', content: `${ministerReport}${correction ? `\n\n${correction}` : ''}` }
            ],
            town: this.town,
            sittingId,
            department: department.id
          });
          return { department, reply };
        } catch (error) {
          return { department, error };
        }
      };

      const responses = await Promise.all(departments.map((department) => callMinister(department)));
      if (!isCurrent()) {
        this.staleReplies = (this.staleReplies || 0) + 1;
        return { status: 'stale', intent: null, detail: 'the town was regenerated before the Cabinet replies arrived' };
      }
      const successful = responses.filter((result) => result.reply);
      const failed = responses.filter((result) => result.error);
      if (!successful.length) throw failed[0]?.error || new Error('no Cabinet minister replied');

      this.available = true;
      this.lastAborted = false;
      this.lastError = failed.length ? `${failed.length} Cabinet minister(s) did not reply` : null;
      this.consecutiveFailures = 0;
      this.rulesOnly = false;
      this.llmCalls += successful.length;
      this.cabinetCalls += successful.length;
      this.activeResponseId = `response-${++this.responseSeq}`;
      this.modelUsed = successful[0].reply?.model || successful[0].reply?.raw?.model || this.model || this.provider?.id || 'unknown';
      const replies = successful.map(({ department, reply }) => `${department.id}: ${reply?.text || ''}`.trim());
      this.lastReply = replies.join(' · ');
      this.cabinet.lastReply = this.lastReply;
      this.cabinet.lastSittingId = sittingId;

      const motions = [];
      successful.forEach(({ department, reply }, responseIndex) => {
        const parsed = this.cabinet.parse(reply?.text || '', {
          departmentId: department.id,
          maxMotions: 1
        });
        parsed.forEach((motion) => {
          motion.index = responseIndex;
          motion.id = `motion-${motions.length + 1}`;
          motions.push(motion);
        });
      });
      this.cabinet.lastMotions = motions;
      const boundaryViolations = motions.filter((motion) => motion.ownershipValid === false);
      this.cabinet.lastBoundaryViolations = boundaryViolations;
      const specViolations = motions.filter((motion) => motion.specValid === false);
      this.cabinet.lastSpecViolations = specViolations;
      if (boundaryViolations.length) {
        const labels = [...new Set(boundaryViolations.map((motion) => motion.departmentLabel))].join(', ');
        events.emit('log', {
          kind: 'event',
          text: `Cabinet remit guard quarantined ${boundaryViolations.length} out-of-remit motion${boundaryViolations.length === 1 ? '' : 's'} from ${labels}.`
        });
      }
      if (specViolations.length) {
        const labels = [...new Set(specViolations.map((motion) => motion.departmentLabel))].join(', ');
        events.emit('log', {
          kind: 'event',
          text: `Cabinet spec guard quarantined ${specViolations.length} malformed typed-build motion${specViolations.length === 1 ? '' : 's'} from ${labels}; the motion did not reach Council synthesis.`
        });
      }
      // An individual minister cannot put another department's intent before
      // the final Council chamber. Keep the invalid reply in the Cabinet audit
      // stats, but only admit motions owned by the calling department.
      const admittedMotions = motions.filter((motion) => motion.ownershipValid !== false && motion.specValid !== false);
      const priorityIntents = this.planBoard()?.priority || [];
      const candidateDigest = admittedMotions.map((motion) => ({
        id: motion.id,
        department: motion.department,
        intent: motion.intent,
        priority: motion.priority,
        emergency: !!motion.emergency,
        phase: this.cabinet.isImmediate(motion, priorityIntents) ? 'immediate' : 'long-term',
        reason: motion.reason,
        params: motion.params
      }));
      let councilResult = { status: 'failed', valid: false, selected: [], invalid: [], raw: '', fallback: true };
      try {
        const councilReply = await this.provider.complete({
          endpoint: this.endpoint,
          model: this.model,
          temperature: this.temperature,
          maxTokens: 500,
          signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
          messages: [
            { role: 'system', content: systemPrompt(this.town, { cabinetCouncil: true }) },
            {
              role: 'user',
              content: `${cabinetReportFor(report, 'council')}\n\nCABINET MIX TARGET: ${Math.round(this.cabinet.priorityMix.immediateShare * 100)}% immediate Priority/mandatory work · ${Math.round(this.cabinet.priorityMix.longTermShare * 100)}% long-term vision.\nMINISTER CANDIDATES (select by id only):\n${JSON.stringify(candidateDigest)}`
            }
          ],
          town: this.town,
          sittingId,
          department: 'council',
          stage: 'cabinet-synthesis'
        });
        if (!isCurrent()) {
          this.staleReplies = (this.staleReplies || 0) + 1;
          return { status: 'stale', intent: null, detail: 'the town was regenerated before the Council synthesis arrived' };
        }
        this.llmCalls++;
        this.cabinetCalls++;
        this.councilCalls++;
        this.modelUsed = councilReply?.model || councilReply?.raw?.model || this.modelUsed;
        const parsedCouncil = this.cabinet.parseCouncil(councilReply?.text || '', admittedMotions);
        const mixed = parsedCouncil.valid
          ? this.cabinet.enforcePriorityMix(parsedCouncil.selected, admittedMotions, priorityIntents)
          : { selected: [], changes: [] };
        councilResult = {
          status: parsedCouncil.valid ? 'ok' : 'invalid',
          valid: parsedCouncil.valid,
          selected: mixed.selected,
          mixChanges: mixed.changes,
          invalid: parsedCouncil.invalid,
          raw: parsedCouncil.raw,
          fallback: !parsedCouncil.valid
        };
        this.lastReply = `${this.lastReply} · council: ${councilReply?.text || ''}`.trim();
        this.cabinet.lastReply = this.lastReply;
      } catch (error) {
        councilResult = {
          status: 'failed',
          valid: false,
          selected: [],
          invalid: [String(error?.message || error)],
          raw: '',
          fallback: true
        };
      }
      this.cabinet.lastCouncil = councilResult;
      if (!councilResult.valid) {
        events.emit('log', {
          kind: 'event',
          text: `Council synthesis ${councilResult.status}; using the recorded priority fallback for this sitting.`
        });
      }
      const fallbackBatch = this.cabinet.enforcePriorityMix(admittedMotions, admittedMotions, priorityIntents).selected;
      const selectedMotions = councilResult.valid ? councilResult.selected : fallbackBatch;
      let review = this.cabinet.mayor.review(selectedMotions, {
        requiredAction: this.requiredAction,
        priorityIntents,
        councilSelected: councilResult.valid
      });
      this.cabinet.lastReview = review;
      for (const motion of [...review.rejected, ...review.deferred]) {
        this.recordMayorMotion(motion, motion.status, motion.mayorReason);
      }

      const execution = [];
      let blocked = null;
      const execute = (motion) => {
        this.activeMotion = motion;
        let decision;
        try {
          decision = this.enact(motion.raw, 'llm');
        } finally {
          this.activeMotion = null;
        }
        decision.motionId = motion.id;
        decision.department = motion.department;
        decision.departmentLabel = motion.departmentLabel;
        decision.mayor = 'approved';
        execution.push(decision);
        if (decision.status === 'blocked' && decision.requiredAction) blocked = decision;
      };
      for (const motion of review.approved) {
        execute(motion);
        if (blocked) break;
      }

      if (blocked) {
        const requiredIntent = String(blocked.requiredAction || '').match(/INTENT:\s*([A-Z0-9_]+)/)?.[1] || '';
        const correctionDepartment = this.cabinet.departmentForIntent(requiredIntent)
          || departments.find((department) => department.id === blocked.department)
          || departments[0];
        const correction = `CORRECTION: this sitting's approved ${blocked.intent} was blocked by a hard sequencing constraint. Choose exactly ${blocked.requiredAction} now; return one JSON motion for your department and do not repeat ${blocked.intent}.`;
        const correctedReply = await callMinister(correctionDepartment, correction);
        if (correctedReply.reply && isCurrent()) {
          this.llmCalls++;
          this.cabinetCalls++;
          const corrected = this.cabinet.parse(correctedReply.reply.text || '', {
            departmentId: correctionDepartment.id,
            maxMotions: 1
          });
          if (corrected[0]) {
            corrected[0].index = motions.length;
            corrected[0].id = `motion-${motions.length + 1}`;
            motions.push(corrected[0]);
            if (corrected[0].ownershipValid === false) {
              this.cabinet.lastBoundaryViolations.push(corrected[0]);
              events.emit('log', {
                kind: 'event',
                text: `Cabinet remit guard quarantined the correction from ${corrected[0].departmentLabel}.`
              });
            }
            if (corrected[0].specValid === false) {
              this.cabinet.lastSpecViolations.push(corrected[0]);
              events.emit('log', {
                kind: 'event',
                text: `Cabinet spec guard quarantined the malformed correction from ${corrected[0].departmentLabel}.`
              });
            }
            const correctionReview = this.cabinet.mayor.review(
              corrected.filter((motion) => motion.ownershipValid !== false && motion.specValid !== false),
              { requiredAction: this.requiredAction, priorityIntents }
            );
            review = {
              approved: [...review.approved, ...correctionReview.approved],
              rejected: [...review.rejected, ...correctionReview.rejected],
              deferred: [...review.deferred, ...correctionReview.deferred],
              label: correctionReview.label
            };
            this.cabinet.lastReview = review;
            for (const motion of [...correctionReview.rejected, ...correctionReview.deferred]) {
              this.recordMayorMotion(motion, motion.status, motion.mayorReason);
            }
            for (const motion of correctionReview.approved) execute(motion);
          }
        }
      }

      this.cabinet.lastMotions = motions;
      this.cabinet.lastExecution = execution;
      finalDecision = execution[execution.length - 1]
        || ((review.rejected.length || review.deferred.length) ? this.lastDecision : null);
      finalDecision ||= {
        day: this.town.clockDay || 0,
        source: 'llm',
        intent: 'NO_ACTION',
        status: 'noop',
        detail: 'Mayor approved no executable Cabinet motion',
        cost: 0,
        raw: ''
      };
      finalDecision.ms = Date.now() - started;
      return finalDecision;
    } catch (err) {
      if (!isCurrent()) {
        this.staleReplies = (this.staleReplies || 0) + 1;
        return { status: 'stale', intent: null, detail: 'the Cabinet sitting was superseded before it completed' };
      }
      const aborted =
        (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
        /timed out|abort/i.test(String((err && err.message) || err));
      this.available = false;
      this.lastAborted = !!aborted;
      this.lastError = aborted ? `no reply within ${ASK_TIMEOUT_MS}ms` : String((err && err.message) || err);
      this.consecutiveFailures++;
      if (!aborted && this.provider?.kind === 'openai-compatible' && this.endpoint.startsWith('http') && !this.proxied) {
        this.proxied = true;
        this.endpoint = DEFAULT_ENDPOINT;
        this.pending = false;
        this.activeRequestId = null;
        return this.askCabinet();
      }
      return { status: 'error', intent: null, detail: `${this.lastError} — Cabinet-only mode took no automatic action` };
    } finally {
      if (isCurrent()) {
        this.pending = false;
        this.activeRequestId = null;
        this.activeMotion = null;
        this.lastCompletedSittingId = this.activeSittingId;
      }
    }
  }

  /** Stable signature of what would change a sitting's options (no rng). */
  situationKey() {
    const t = this.town;
    const g = t.growth;
    if (!g || !g.inputs) return '';
    const s = g.inputs();
    const ut = s.utilities;
    const staff = this.staffNeed();
    const roadDemand = t.traffic?.roadDemandSnapshot?.();
    return [
      g.projects.length,
      ut && ut.strained ? ut.strained.join(',') : '',
      staff ? staff.gap : 0,
      housingNeedsBuild(s.pop, s.capacity, s.pressure) ? 'h' : '',
      unemploymentRate(t) > UNEMPLOYMENT_GATE ? 'j' : '',
      (s.pop > s.civicCount * CIVIC_PER_POP || civicExpansionNeed(t) ? 'c' : ''),
      s.parks < s.pop * PARKS_PER_POP ? 'p' : '',
      s.mobility && s.mobility.congestion > roadCongestionGate() ? 'r' : '',
      Math.min(8, roadDemand?.trips?.length || 0),
      (t.industry && t.industry.deficitProduct()) || '',
      t.resources?.stats?.().strained?.join(',') || '',
      t.vehicles?.stationShortfall?.().map((row) => `${row.facility}:${row.required - row.count}`).join(',') || '',
      t.transport?.stats?.().ready ? 'transit-ready' : (s.pop >= 60 ? 'transit-needed' : ''),
      g.loanNeed?.() ? 'loan-needed' : '',
      Math.floor((t.economy?.treasury || 0) / 50000),
      t.policy?.laws?.length || 0,
      t.research?.level || 0,
      g.built ? Object.values(g.built).reduce((n, v) => n + v, 0) : 0,
      s.economy && s.pressure > FILLER_PRESSURE_GATE && s.economy.treasury >= BUILD_FLOOR ? 'f' : ''
    ].join('|');
  }

  update(dt, clock) {
    if (!this.enabled || !clock) return;
    this.lastClock = clock;
    this.sampleCongestion(dt, clock);
    // Convene whenever the configured daily slot turns over. Day rollover is a
    // slot boundary too, so a 2/day setting means roughly 00:00 and 12:00.
    const sittingsPerDay = clampSittingsPerDay(this.sittingsPerDay);
    const cadenceHours = 24 / sittingsPerDay;
    const slot = Math.floor(clock.hour / cadenceHours);
    if (clock.day === this.lastDay && slot === this.lastSlot) return;
    const first = this.lastDay === -1;
    this.lastDay = clock.day;
    this.lastSlot = slot;
    this.town.clockDay = clock.day;
    if (!first) this.closeCongestionWindow(clock);
    // Let choices age into observations before the next sitting. The memory
    // is bounded and deterministic, so a long run cannot grow without limit.
    this.learning.observe(this.town, clock.day);
    if (first) return;
    this.cycles++;
    if (!this.auto) return;
    this.activeSittingId = `sitting-${++this.sittingSeq}`;
    // Every configured slot is a real sitting. An unchanged report is still
    // shown to the provider so the Council can revisit priorities twice a day
    // (or at the user-selected cadence) instead of silently standing down.
    const key = this.situationKey();
    this.lastConveneDay = clock.day;
    this.lastSitKey = key;
    // Phase 30 (S19b) — after ASK_FAIL_LIMIT consecutive failures the endpoint
    // is treated as gone for this epoch: the council keeps sitting on the
    // schedule and the rules answer, instead of the model being asked again
    // every six hours and timing out again every six hours.
    if (this.consecutiveFailures >= ASK_FAIL_LIMIT) {
      this.rulesOnly = true;
      if (this.cycles % 4 === 0) { this.askQuietly(); return; }
      if (this.councilOnly) return;
      const rules = this.replan();
      if (rules) {
        rules.substituted = {
          intent: null,
          status: 'error',
          detail: `model unreachable (${this.consecutiveFailures} failures) — the rules answer in its place`,
          confidence: 0,
          how: 'fallback'
        };
      }
      return;
    }
    this.askQuietly();
  }

  /**
   * Start a sitting and report its rejection.
   *
   * `ask()` has a complete internal handler — it records `lastError`, counts the
   * failure, records the provider error and clears `pending` — so the empty
   * catch was never hiding a stuck flag. What it hid is the rejection itself,
   * from anything watching: a sweep for empty catch blocks misses it entirely,
   * because a swallowed promise is not a catch block. One line makes it visible
   * without duplicating the handling.
   */
  askQuietly() {
    this.ask().catch((error) => {
      console.warn('[tomm] council sitting rejected:', error?.message || error);
    });
  }

  /**
   * Emit the human-readable map snapshot immediately before a sitting. The
   * event is handled by the local UI/dev-server writer only; this text is
   * deliberately not passed to report(), a Cabinet prompt, or any provider.
   */
  captureMapNow() {
    try {
      events.emit('map-now', {
        text: renderMapNow(this.town, { clock: this.lastClock || null }),
        day: this.lastClock?.day ?? this.town.clockDay ?? null,
        sitting: this.activeSittingId || null
      });
    } catch (error) {
      events.emit('log', { kind: 'event', text: `MapNow export skipped: ${error?.message || error}` });
    }
  }

  stats() {
    return {
      enabled: this.enabled,
      auto: this.auto,
      councilOnly: this.councilOnly,
      endpoint: this.endpoint,
      providerId: this.provider?.id || 'unknown',
      providerLabel: this.provider?.label || this.provider?.id || 'unknown',
      temperature: this.temperature,
      sittingsPerDay: clampSittingsPerDay(this.sittingsPerDay),
      cadenceHours: 24 / clampSittingsPerDay(this.sittingsPerDay),
      congestion: this.congestionEvidence(),
      available: this.available,
      pending: this.pending,
      requiredAction: this.requiredAction,
      blockedRemedyAttempts: this.blockedRemedyAttempts || 0,
      cabinet: this.cabinet?.stats() || null,
      lastError: this.lastError,
      cycles: this.cycles,
      llmCalls: this.llmCalls,
      cabinetCalls: this.cabinetCalls,
      councilCalls: this.councilCalls,
      parseFailures: this.parseFailures,
      forcedRequests: this.forcedRequests || 0,
      modelUsed: this.modelUsed,
      spent: Math.round(this.spent),
      lastReply: this.lastReply.slice(0, 160),
      staff: this.staffNeed(),
      // Phase 30 (S19b) — the call boundary, made visible. `rulesOnly` is the
      // one the town operator needs: it says the model is not being asked any
      // more, and why, rather than leaving the HUD to imply it is thinking.
      rulesOnly: !!this.rulesOnly,
      consecutiveFailures: this.consecutiveFailures || 0,
      staleReplies: this.staleReplies || 0,
      cacheHits: this.cacheHits || 0,
      askTimeoutMs: ASK_TIMEOUT_MS,
      last: this.lastDecision
        ? {
            intent: this.lastDecision.intent,
            status: this.lastDecision.status,
            source: this.lastDecision.source,
            detail: this.lastDecision.detail,
            cost: this.lastDecision.cost,
            ms: this.lastDecision.ms,
            cached: !!this.lastDecision.cached,
            // Phase 30 (S19b) — the motion the planner answered in place of
            // this one, when there was one.
            substituted: this.lastDecision.substituted || null
          }
        : null,
      recent: this.decisions.slice(-3).map((d) => `${d.intent} · ${d.status}`),
      // Phase 19 — the ledger-derived voice, the SAME object the prompt uses.
      manner: this.persona(),
      // Phase 31 — measured before/after action memory used by the next prompt.
      learning: this.learning.snapshot()
    };
  }
}
