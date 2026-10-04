import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5176';
const SEED = Number(process.env.UNEMPLOYMENT_SEED || 1337);
const DAYS = Number(process.env.UNEMPLOYMENT_DAYS || 800);
const REQUEST_EVERY = Math.max(1, Number(process.env.UNEMPLOYMENT_REQUEST_EVERY || 8));
const SNAPSHOT_EVERY = Math.max(1, Number(process.env.UNEMPLOYMENT_SNAPSHOT_EVERY || 100));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.growth && !!window.planCode);

const result = await page.evaluate(({ seed, days, requestEvery, snapshotEvery }) => {
  const t = window.town;
  t.generate(seed);
  const c = window.clock;
  c.speed = 50;
  t.governance.auto = false;
  t.growth.auto = false;
  const raw = 24 * 60 * 0.9 / c.speed;
  const dt = 1296;
  const snapshots = [];
  const shopDecisions = [];
  const decisionCounts = {};
  const unemploymentSeries = [];
  const recordSnapshot = (day) => {
    const eco = t.economy.stats();
    const roster = t.economy.employed?.() || {};
    const row = {
      day,
      population: t.pedestrians.citizens.length,
      unemployment: Number(eco.unemployment) || 0,
      labourForce: roster.adults?.length || 0,
      unemployed: roster.jobless?.length || 0,
      openPosts: eco.openPosts || 0,
      businesses: eco.businesses || 0,
      offices: t.buildings.filter((b) => b.kind === 'office').length,
      civicVacancies: t.lifecycle?.civicStaffing?.()?.open || 0,
      employmentChannels: eco.employmentChannels || {},
      privateOpportunities: t.growth.privateOpportunities.length,
      activeProjects: t.growth.projects.length,
      developerBlock: t.growth.developerLastBlock || '',
      ranked: t.growth.ranked().slice(0, 6).map((entry) => entry.type)
    };
    snapshots.push(row);
    unemploymentSeries.push(row.unemployment);
  };

  for (let day = 0; day < days; day++) {
    c.update(raw);
    t.advance(dt, c);
    t.lifecycle.update(dt, c);
    t.economy.update(dt, c);
    t.industry.update(dt, c);
    t.growth.update(dt);
    t.utilities.update(c);
    t.resources.update(c, raw);

    if (day % requestEvery === 0 && t.growth.activePublicProjects() === 0) {
      const plan = t.growth.evaluate({ amenities: false });
      const code = window.planCode(plan);
      if (code && code !== 'NO_ACTION') {
        const beforeUnemployment = Number(t.economy.stats().unemployment) || 0;
        const decision = t.governance.enact(`INTENT: ${code}`, 'rules');
        if (decision) {
          decisionCounts[`${decision.intent || code}:${decision.status}`] = (decisionCounts[`${decision.intent || code}:${decision.status}`] || 0) + 1;
          if (decision.intent === 'OPEN_SHOP') {
            shopDecisions.push({
              day,
              unemployment: beforeUnemployment,
              status: decision.status,
              developerDecision: decision.developerDecision || null,
              detail: decision.detail,
              developerBlock: t.growth.developerLastBlock || '',
              opportunityCount: t.growth.privateOpportunities.length,
              projectCount: t.growth.projects.length
            });
          }
        }
      }
    }
    if (day % snapshotEvery === 0 || day === days - 1) recordSnapshot(day);
  }

  const maxUnemployment = Math.max(0, ...unemploymentSeries);
  const averageUnemployment = unemploymentSeries.length
    ? unemploymentSeries.reduce((sum, value) => sum + value, 0) / unemploymentSeries.length
    : 0;
  return {
    seed,
    days,
    maxUnemployment: Number(maxUnemployment.toFixed(2)),
    averageUnemployment: Number(averageUnemployment.toFixed(2)),
    final: snapshots.at(-1),
    snapshots,
    openShop: {
      total: shopDecisions.length,
      rejected: shopDecisions.filter((row) => row.status === 'rejected' || row.developerDecision === 'rejected').length,
      started: shopDecisions.filter((row) => row.status === 'started').length,
      accepted: shopDecisions.filter((row) => row.developerDecision === 'accepted').length,
      samples: shopDecisions.slice(0, 12)
    },
    decisionCounts,
    audit: t.economy.audit()
  };
}, { seed: SEED, days: DAYS, requestEvery: REQUEST_EVERY, snapshotEvery: SNAPSHOT_EVERY });

await browser.close();
console.log(JSON.stringify({ ...result, pageErrors }));
if (pageErrors.length || !result.audit.ok || result.openShop.rejected > 0) process.exit(1);
