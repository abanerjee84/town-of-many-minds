import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5193', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.growth && !!window.town?.governance);
  const result = await page.evaluate(async () => {
    const t = window.town;
    t.generate('archetype-flow');
    t.governance.auto = false;
    const opportunity = t.growth.archetypeOpportunity();
    const ranked = t.growth.ranked().filter((row) => row.type === 'archetype');

    const originalEmergency = t.growth.resourceEmergency.bind(t.growth);
    const originalWanted = t.growth.wanted.bind(t.growth);
    t.growth.resourceEmergency = () => ({ resource: 'energy', kind: 'upgrade', intent: 'UPGRADE_RESOURCE' });
    t.growth.wanted = (type) => type === 'resource' || originalWanted(type);
    let calls = 0;
    t.governance.setProvider({
      id: 'correction-provider',
      complete: async () => {
        calls++;
        return {
          model: 'correction-provider',
          text: calls === 1 ? 'INTENT: BUILD_FACTORY type=sawmill' : 'INTENT: UPGRADE_RESOURCE resource=energy'
        };
      }
    });
    const decision = await t.governance.ask();
    t.growth.resourceEmergency = originalEmergency;
    t.growth.wanted = originalWanted;
    return {
      opportunity: opportunity && {
        reason: opportunity.reason,
        amenity: opportunity.amenity,
        blockId: opportunity.opts?.blockId || null
      },
      rankedArchetypes: ranked.length,
      providerCalls: calls,
      decision: {
        intent: decision?.intent || null,
        status: decision?.status || null,
        requiredAction: decision?.requiredAction || null
      },
      stats: {
        llmCalls: t.governance.stats().llmCalls,
        requiredAction: t.governance.stats().requiredAction,
        blockedRemedyAttempts: t.governance.stats().blockedRemedyAttempts
      }
    };
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(result.opportunity, JSON.stringify(result));
  assert.ok(result.rankedArchetypes >= 1, JSON.stringify(result));
  assert.equal(result.providerCalls, 2, JSON.stringify(result));
  assert.equal(result.decision.intent, 'UPGRADE_RESOURCE', JSON.stringify(result));
  assert.notEqual(result.decision.requiredAction, 'INTENT: UPGRADE_RESOURCE resource=energy', JSON.stringify(result));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
