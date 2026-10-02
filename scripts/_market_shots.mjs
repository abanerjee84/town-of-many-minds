import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SEED = process.env.SEED || '1337';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.grid?.kind, null, { timeout: 60000 });
await page.waitForTimeout(900);
await page.fill('#seed-input', SEED);
await page.click('#regen');
await page.waitForTimeout(1200);

// Run a few days so there is some market history, then let some cars out.
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.town.economy.daily(); });
await page.waitForTimeout(500);
await page.screenshot({ path: `shots/market-${SEED}-overview.png` });

// Click a vehicle so the inspector shows owner / used by / value.
const picked = await page.evaluate(() => {
  const   t = window.town;
  const v = t.traffic.vehicles.find((a) => a.slot);
  if (!v) return null;
  window.interaction.select({ kind: 'agent', pick: { type: 'vehicle', agent: v } });
  return { type: v.type, owner: v.slot?.owner?.sector, leased: !!v.slot?.leasedTo };
});
await page.waitForTimeout(600);
await page.screenshot({ path: `shots/market-${SEED}-vehicle.png` });

// A citizen, to show the savings split.
await page.evaluate(() => {
  const t = window.town;
  const c = t.pedestrians.citizens.find((x) => x.p.deposits > 0);
  if (c) window.interaction.select({ kind: 'agent', pick: { type: 'citizen', agent: c } });
});
await page.waitForTimeout(600);
await page.screenshot({ path: `shots/market-${SEED}-citizen.png` });

const summary = await page.evaluate(() => {
  const s = window.town.stats();
  return { stock: s.vehicleStock, treasury: Math.round(s.economy.treasury), hh: { cash: s.economy.householdCash, dep: s.economy.householdDeposits } };
});
console.log('picked:', JSON.stringify(picked));
console.log('stock:', JSON.stringify(summary.stock));
console.log('treasury:', summary.treasury, 'household cash/deposits:', summary.hh.cash, '/', summary.hh.dep);
console.log('ERRORS:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();
