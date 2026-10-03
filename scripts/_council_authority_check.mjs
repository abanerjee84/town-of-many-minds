import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.governance?.stats && !!window.town?.resources?.sites);

const result = await page.evaluate(() => {
  const t = window.town;
  t.generate(1337);
  t.governance.auto = false;
  const g = t.governance;
  const resources = t.resources;
  const initialSites = resources.sites.length;
  resources.demandNow = () => ({ water: 42, energy: 180, food: 500, fuel: 70 });
  for (const site of resources.sites) if (site.kind === 'farm') site.level = 3;
  resources._prodSig = null;
  resources.levels.food = 0;
  // The day-boundary resource pass may report this shortage, but it must not
  // place a producer without a Council order.
  resources.lastDay = 0;
  resources.update({ day: 1, speed: 1 }, 0.1);
  const blocked = g.enact('INTENT: DEVELOP_HOUSING', 'llm');
  return {
    councilOnly: g.stats().councilOnly,
    rulesReplan: g.replan(),
    privateDeveloperEnabled: t.growth.developer,
    autoResourceSites: resources.sites.length - initialSites,
    blocked: blocked && {
      intent: blocked.intent,
      status: blocked.status,
      substituted: blocked.substituted || null
    }
  };
});

console.log(JSON.stringify({ result, pageErrors }));
const ok = !pageErrors.length &&
  result.councilOnly === true &&
  result.rulesReplan === null &&
  result.privateDeveloperEnabled === true &&
  result.autoResourceSites === 0 &&
  result.blocked?.intent === 'DEVELOP_HOUSING' &&
  result.blocked?.status === 'blocked' &&
  result.blocked?.substituted === null;
if (!ok) process.exit(1);
await browser.close();
