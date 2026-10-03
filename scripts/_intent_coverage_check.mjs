import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACTION_REGISTRY, INTENTS, actionFor } from '../src/simulation/actionRegistry.js';
import { parseIntent } from '../src/simulation/governance.js';
import { constructionBlock, constructionBlockDemand } from '../src/kits/constructionBlocks.js';

assert(INTENTS.length > 0, 'the council vocabulary is empty');
assert.equal(new Set(INTENTS).size, INTENTS.length, 'the council vocabulary contains duplicates');

for (const intent of INTENTS) {
  const action = actionFor(intent);
  assert(action, `${intent} has no action descriptor`);
  assert.equal(ACTION_REGISTRY[intent], action, `${intent} registry lookup drifted`);
  const parsed = parseIntent(`INTENT: ${intent}`);
  assert.equal(parsed.intent, intent, `${intent} cannot be parsed from its canonical spelling`);
  if (action.kind === 'project') assert(action.planType, `${intent} has no project plan type`);
}

const source = fs.readFileSync(new URL('../src/simulation/governance.js', import.meta.url), 'utf8');
assert(source.includes('INTENTS.join'), 'the system prompt no longer exposes the shared intent vocabulary');
assert(source.includes('actionFor(parsed.intent)'), 'governance no longer validates parsed intents through the registry');
assert(source.includes('conditionalIntents'), 'the report no longer describes intents that are not currently feasible');

for (const id of ['road.transit', 'road.arterial', 'road.roundabout']) {
  const block = constructionBlock(id);
  assert(block, `${id} is missing from the road construction kit`);
  assert(block.modules?.length >= 3, `${id} has no useful road modules`);
  assert.equal(typeof constructionBlockDemand(id, null), 'boolean', `${id} has no demand gate`);
}

console.log(`INTENT COVERAGE OK: ${INTENTS.length} canonical actions, parser, registry, report, prompt, and road modules verified`);
