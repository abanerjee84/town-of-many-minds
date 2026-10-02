/**
 * Single declared Council vocabulary. The parser, the prompt and the planner
 * bridge all read `INTENTS` and `PLAN_TYPE` from here.
 *
 * `executor` and `validator` were declared as strings naming methods
 * (`growth.apply`, `growth.quote`, `governance.enact`) and were read NOWHERE —
 * a repo-wide grep for `.executor`/`.validator` returns nothing. The header
 * claimed "the parser, prompt, planner bridge and executor all read these
 * descriptors", which was false, and it matters: it made the registry read as
 * though adding an intent were a data edit. It is not — `enact()` is a hand-rolled
 * sixty-branch chain, and `FAMILIES` in persona.js is a second hand-maintained
 * table that had already drifted (it was missing `BUILD_OFFICE`, so an office
 * commission was bucketed `other` and the derived council voice described it
 * wrongly).
 *
 * So the strings are gone and the claim is gone with them. What remains is what
 * the registry genuinely owns: which intents exist, and which plan type each
 * one means. `INTENTS_SUBSET_FAMILIES` below is derived from `INTENTS` so that
 * table cannot drift again.
 */
const project = {
  DEVELOP_HOUSING: 'house', OPEN_SHOP: 'shop', BUILD_OFFICE: 'office', TIERUP: 'tierup',
  BUILD_LANDMARK: 'landmark', EXPAND_LANDMARK: 'wing', BUILD_FACTORY: 'factory',
  BUILD_CIVIC: 'civic', EXPAND_CLINIC: 'civic', EXTEND_STREET: 'road',
  EXTEND_FOOTWAY: 'footway', UPGRADE_ROAD: 'roadup', BUILD_BRIDGE: 'bridge',
  PARK_LAND: 'park', PAVE_PLAZA: 'plaza', ADD_PARKING: 'parking',
  EXPAND_POWER: 'power', EXPAND_WATER: 'water', EXPAND_SEWAGE: 'sewage',
  UPGRADE_RESOURCE: 'resource', PLANT_TREES: 'prop-tree', INSTALL_LAMP: 'prop-lamp',
  UPGRADE_BUILDING: 'upgrade', RENOVATE: 'renovate', WING: 'wing',
  IMAGINE_ARCHETYPE: 'archetype', BUILD_DISTRICT: 'district',
  REZONE: 'rezone', UPZONE: 'upzone', CLEAR_LOT: 'clear', ANNEX_EDGE: 'annex',
  ACQUIRE_LAND: 'land', BUILD_TRANSIT: 'civic', RESTRUCTURE_BUILDING: 'restructure'
};
const direct = [
  'RAISE_TAX', 'CUT_TAX', 'KEEP_TAX', 'HIRE_WORKERS', 'ATTRACT_SETTLERS',
  'FUND_INNOVATION', 'TRADE_BUY', 'TRADE_SELL', 'SET_ASIDE_RESERVE',
  'BOND_ISSUE', 'SUBSIDY', 'SLASH_SPENDING', 'HOST_EVENT',
  'DECLARE_EMERGENCY', 'DISPATCH_UNITS', 'STUDY_ROAD', 'STUDY_ECONOMY',
  'STUDY_DEMOGRAPHICS', 'STUDY_TRAFFIC', 'STUDY_INCIDENTS',
  'ENACT_SCHEME', 'END_SCHEME', 'PASS_LAW', 'REPEAL_LAW', 'NO_ACTION'
];

export const ACTION_REGISTRY = Object.freeze({
  ...Object.fromEntries(Object.entries(project).map(([intent, planType]) =>
    [intent, Object.freeze({ intent, kind: 'project', planType })])),
  ...Object.fromEntries(direct.map((intent) =>
    [intent, Object.freeze({ intent, kind: 'direct' })]))
});
export const INTENTS = Object.freeze(Object.keys(ACTION_REGISTRY));
export const PLAN_TYPE = Object.freeze(Object.fromEntries(
  Object.values(ACTION_REGISTRY).filter((action) => action.kind === 'project').map((action) => [action.intent, action.planType])
));
export const POLICY_INTENTS = Object.freeze(['ENACT_SCHEME', 'END_SCHEME', 'PASS_LAW', 'REPEAL_LAW']);

/**
 * Every intent, grouped by which subsystem answers it. Derived from `INTENTS`,
 * so a new intent cannot be added without also being placed — which is the
 * failure `FAMILIES` had (it was a separate hand-maintained table that drifted).
 * The council's own voice reads these buckets, so an intent landing in `other`
 * is visible in what the model is told about itself.
 */
export const INTENT_FAMILY = Object.freeze(
  Object.fromEntries(INTENTS.map((intent) => [intent, familyOf(intent)]))
);

function familyOf(intent) {
  if (intent === 'NO_ACTION') return 'hold';
  if (intent.startsWith('STUDY_')) return 'study';
  if (intent.startsWith('PASS_LAW') || intent.startsWith('REPEAL_LAW')
    || intent.startsWith('ENACT_SCHEME') || intent.startsWith('END_SCHEME')) return 'people';
  if (intent === 'DECLARE_EMERGENCY' || intent === 'DISPATCH_UNITS') return 'emergency';
  if (intent.startsWith('BUILD_') || intent === 'DEVELOP_HOUSING' || intent === 'OPEN_SHOP'
    || intent === 'TIERUP' || intent === 'EXPAND_LANDMARK' || intent === 'EXPAND_CLINIC'
    || intent === 'UPGRADE_BUILDING' || intent === 'RENOVATE' || intent === 'WING'
    || intent === 'RESTRUCTURE_BUILDING') return 'build';
  if (intent.startsWith('EXTEND_') || intent.startsWith('EXPAND_') || intent === 'UPGRADE_ROAD'
    || intent === 'UPGRADE_RESOURCE' || intent === 'ADD_PARKING' || intent === 'BUILD_BRIDGE') return 'infrastructure';
  if (intent.startsWith('REZONE') || intent.startsWith('UPZONE') || intent.startsWith('CLEAR_')
    || intent.startsWith('ANNEX_') || intent === 'PARK_LAND' || intent === 'PAVE_PLAZA'
    || intent === 'PLANT_TREES' || intent === 'INSTALL_LAMP') return 'place';
  if (intent === 'ACQUIRE_LAND') return 'infrastructure';
  if (intent.startsWith('RAISE_') || intent.startsWith('CUT_') || intent === 'KEEP_TAX'
    || intent === 'SET_ASIDE_RESERVE' || intent === 'BOND_ISSUE' || intent === 'SUBSIDY'
    || intent === 'SLASH_SPENDING' || intent.startsWith('TRADE_') || intent === 'FUND_INNOVATION') return 'money';
  return 'people';
}

export function actionFor(intent) { return ACTION_REGISTRY[intent] || null; }
