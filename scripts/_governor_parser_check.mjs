import { parseIntent } from '../src/simulation/governance.js';

const cases = [
  ['INTENT: BUILD_LANDMARK type=stadium', 'BUILD_LANDMARK', 'stadium'],
  ['INTENT: SET_ASIDE_RESERVE', 'SET_ASIDE_RESERVE'],
  ['PARKING', 'ADD_PARKING'],
  ['STUDY ROAD TRAFFIC', 'STUDY_ROAD'],
  ['INTENT: EXPAND THE ROAD', 'EXTEND_STREET'],
  ['EXPAND STREET', 'EXTEND_STREET'],
  ['INTENT: UPDATE_RESOURCE resource=food', 'UPGRADE_RESOURCE', 'food'],
  ['REZONE zone=industrial', 'REZONE', 'industrial'],
  ['REZONE zone=banana', 'REZONE', 'issue'],
  ['INTENT: BUILD_FACTORY type=bogus', 'BUILD_FACTORY', 'issue'],
  ['INTENT: IMAGINE_ARCHETYPE', 'IMAGINE_ARCHETYPE', 'issue'],
  ['INTENT: NO_ACTION', 'NO_ACTION']
];

let failed = 0;
for (const [text, intent, detail] of cases) {
  const parsed = parseIntent(text);
  const ok = parsed.intent === intent && (
    detail === undefined ||
    parsed.params?.landmark === detail ||
    parsed.params?.zone === detail ||
    parsed.params?.resource === detail ||
    (detail === 'issue' && parsed.params?.issues?.length)
  );
  console.log(`${ok ? 'PASS' : 'FAIL'} ${text} -> ${parsed.intent || 'null'}`);
  if (!ok) failed++;
}

if (failed) process.exit(1);
