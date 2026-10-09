import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/?seed=1337`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.town?.industry);
  const result = await page.evaluate(async () => {
    window.clock.speed = 0;
    const town = window.town;
    town.generate(1337);
    window.clock.speed = 0;
    const industry = town.industry, economy = town.economy;
    const before = economy.audit();
    const orders = industry.consumptionOrders();
    const stocks = { ...industry.stocks };
    const ledgerStart = economy.ledger.length;
    const consumption = industry.settleConsumption();
    const trades = economy.ledger.slice(ledgerStart).filter((row) => row.category === 'purchase');
    const after = economy.audit();
    const beforeHistory = JSON.stringify(industry.serialize());
    const board = industry.demandBoard();
    const report = town.governance.report();
    const readonly = beforeHistory === JSON.stringify(industry.serialize());
    industry.recordDemandFlow('construction', { cement: 150 });
    const saved = town.kits.serialize(town);
    industry.demandHistory = [];
    const restore = town.kits.restore(town, saved);
    const restored = industry.demandHistory.some((row) => row.quantities.cement === 150);
    const { snapshotProjectWorld, restoreProjectWorld } = await import('/src/simulation/projectSnapshot.js');
    const snapshot = snapshotProjectWorld(town);
    industry.recordDemandFlow('construction', { cement: 20 });
    restoreProjectWorld(town, snapshot);
    const rolledBack = industry.demandHistory.some((row) => row.quantities.cement === 150);
    // Read-only evidence must not manufacture shortage persistence by repeated queries.
    industry.day = 30;
    industry.stocks.medicine = 0;
    industry.updateDemandPersistence();
    const age = industry.producerPressure('medicine')?.ageDays;
    industry.day = 32;
    const later = industry.producerPressure('medicine')?.ageDays;
    const defaultPlan = window.planFor(town, 'factory');
    const originalOrders = industry.consumptionOrders, originalGoods = industry.goodsDemand;
    const history = industry.demandHistory;
    industry.consumptionOrders = () => [];
    industry.goodsDemand = () => 0;
    industry.demandHistory = [];
    const noDemandPlan = window.planFor(town, 'factory');
    const noDemandInvestorFactory = town.foreignInvestment._factoryId();
    const noDemandInvestorPressure = town.foreignInvestment._state().industryPressure;
    const explicitPlan = window.planFor(town, 'factory', { factory: 'textile' });
    industry.consumptionOrders = originalOrders;
    industry.goodsDemand = originalGoods;
    industry.demandHistory = history;
    const reserve = economy.requiredPublicReserve(0);
    const current = economy.treasury;
    economy.transfer({ from: 'government', to: 'contractor', amount: Math.max(0, current - reserve), category: 'transfer' });
    const reserveOrders = industry.consumptionOrders().filter((row) => row.buyer.sector === 'government');
    const unfundedPublic = industry.demandBoard().reduce((sum, row) => sum + row.unfundedPublicDemand, 0);
    return { before, after, orderSources: [...new Set(orders.map((row) => row.source))], products: [...new Set(orders.map((row) => row.product))],
      consumption, paidTrades: trades.length, stockConsumed: Object.keys(stocks).filter((key) => industry.stocks[key] < stocks[key]),
      boardCount: board.length, readonly, report: report.includes('demand priorities'),
      restore, restored, rolledBack, age, later, defaultPlan: defaultPlan?.factory, noDemandPlan, noDemandInvestorFactory, noDemandInvestorPressure, explicitPlan: explicitPlan?.factory,
      unfundedPublic, reserveOrders: reserveOrders.reduce((sum, row) => sum + row.quantity, 0) };
  });
  assert.equal(result.before.ok, true, JSON.stringify(result.before));
  assert.equal(result.after.ok, true, JSON.stringify(result.after));
  assert.ok(result.consumption.fulfilled > 0 && result.consumption.spent > 0);
  assert.ok(result.paidTrades > 0 && result.stockConsumed.length > 0);
  assert.equal(result.boardCount, 18);
  assert.ok(result.readonly && result.report && result.restored && result.rolledBack);
  assert.equal(result.restore.ok, true);
  assert.equal(result.age, 0);
  assert.equal(result.later, 2);
  assert.equal(result.noDemandPlan, null);
  assert.equal(result.noDemandInvestorFactory, null);
  assert.equal(result.noDemandInvestorPressure, 0);
  assert.equal(result.explicitPlan, 'textile');
  assert.equal(result.reserveOrders, 0, 'public supply requests must protect the operating reserve');
  assert.ok(result.unfundedPublic > 0, 'essential public demand must remain visible when funding is unavailable');
  await page.evaluate(async () => {
    window.interaction.openHistory('trade');
  });
  await page.locator('.industry-board table').waitFor();
  assert.equal(await page.locator('.industry-board tbody tr').count(), 18);
  await page.screenshot({ path: 'test-output/industry-demand.png' });
  const production = await page.evaluate(async () => {
    const t = window.town, i = t.industry, e = t.economy;
    t.generate(1337); window.clock.speed = 0;
    const makeFactory = (id, type) => ({ id, kind: 'factory', purpose: 'industrial', capacity: 400, floors: 3,
      footprint: [[40, 40]], size: { w: 8, d: 8 }, house: { spec: { factoryType: type, capacity: 400, floors: 3 } } });
    const goods = makeFactory('demand-goods-probe', 'goods');
    const food = makeFactory('demand-food-probe', 'food-processing');
    t.buildings.push(goods, food); e.syncEntities();
    const goodsFirm = e.businessesById.get(goods.businessId), foodFirm = e.businessesById.get(food.businessId);
    for (const firm of [goodsFirm, foodFirm]) e.transfer({ from: 'developer', to: { sector: 'business', id: firm.id }, amount: 10000, category: 'private_investment' });
    goodsFirm.employees = 0;
    i.goodsDemand = () => 100;
    i.take({ goods: i.totalStock('goods') });
    i.demandHistory = []; // Isolate recurring customer demand from this deliberate stock-drain fixture.
    const idle = i.producerPressure('goods');
    const rejectedDuplicate = t.growth.privateOpportunityViability(window.planFor(t, 'factory', { factory: 'goods' }));
    goodsFirm.employees = goodsFirm.jobsRequired = 1;
    foodFirm.employees = foodFirm.jobsRequired = 1;
    t.utilities.electricityState = () => ({ serviceFactor: 1 });
    const active = i.producerPressure('goods');
    const upgrade = t.growth.factoryUpgradeTarget('goods')?.id;
    const plannedUpgrade = window.planFor(t, 'upgrade')?.target?.id;
    const { SIM } = await import('/src/core/config.js');
    t.growth.projects.push({ plan: { type: 'factory', factory: 'goods', footprint: { cols: 3, rows: 3 } }, remaining: 24 * 60 * SIM.secondsPerGameMinute });
    i.goodsDemand = () => 50;
    const pending = i.producerPressure('goods');
    t.growth.projects.length = 0;
    e.assignEmployees = () => 0;
    const foodReserve = t.resources.demandNow(t).food;
    t.resources.levels.food = foodReserve + 1;
    const firstLedger = e.ledger.length;
    const steelBefore = i.totalStock('steel');
    i.runStockFlowDay();
    const inputTrades = e.ledger.slice(firstLedger).filter((tx) => tx.category === 'purchase' && tx.metadata?.intermediate);
    return { idle: idle?.remedy, rejectedDuplicate, active: active?.remedy, upgrade, plannedUpgrade,
      pending: pending?.remedy, pendingCapacity: pending?.pendingCapacity, pendingGap: pending?.capacityGap,
      inputTrades: inputTrades.length, steelDraw: steelBefore - i.totalStock('steel'),
      foodProtected: t.resources.levels.food >= foodReserve - 1e-6, actualGoods: goodsFirm.production, audit: e.audit() };
  });
  assert.equal(production.idle, 'restore_output');
  assert.equal(production.rejectedDuplicate.ok, false);
  assert.equal(production.active, 'expand_capacity');
  assert.equal(production.upgrade, 'demand-goods-probe');
  assert.equal(production.plannedUpgrade, 'demand-goods-probe');
  assert.equal(production.pending, 'bridge_imports');
  assert.equal(production.pendingGap, 0);
  assert.ok(production.pendingCapacity > 0 && production.inputTrades > 0 && production.steelDraw > 0);
  assert.ok(production.foodProtected && production.actualGoods > 0);
  assert.equal(production.audit.ok, true, JSON.stringify(production.audit));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, result, production, errors }, null, 2));
} finally { await browser.close(); }
