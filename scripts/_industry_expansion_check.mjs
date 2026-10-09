import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || 'http://localhost:5173/?seed=1337', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.industry && !!window.listConstructionBlocks, null, { timeout: 60000 });

const result = await page.evaluate(async () => {
  const [{ FACTORY_TYPES, COMMODITIES, FACTORY_INPUTS }, houseKit] = await Promise.all([
    import('/src/simulation/industry.js'),
    import('/src/kits/houses/houseKit.js')
  ]);
  const town = window.town;
  const blocks = window.listConstructionBlocks({ family: 'industry' });
  const rows = FACTORY_TYPES.map((factory) => {
    const house = houseKit.buildHouse({
      style: 'factory', w: 14, d: 12, floors: factory.floors,
      roofType: 'flat', wall: 0x8c949b, trim: 0x5f6870,
      roofColor: 0x3e474e, doorColor: 0x2d3338,
      factoryType: factory.id, factoryModules: factory.modules
    });
    const modules = new Set(house.modules.map((module) => module.kind));
    const expected = factory.modules.filter((module) => !modules.has(module));
    return {
      id: factory.id,
      product: factory.product,
      inputs: FACTORY_INPUTS[factory.product] || {},
      block: blocks.find((block) => block.id === `industry.${factory.id}`)?.id || null,
      floors: house.floors,
      missingModules: expected
    };
  });
  // Exercise the real IndustrySystem stock-flow path with one synthetic works
  // per new type. Firms receive enough capital and labour for this probe only;
  // every input still passes through the same inventory and recordProduction
  // methods used by the simulation.
  const synthetic = FACTORY_TYPES.map((factory, index) => ({
    id: `probe-factory-${index}`,
    kind: 'factory', purpose: 'industrial', zone: 4,
    floors: factory.floors, capacity: 400, size: { w: 12, d: 10 },
    house: { spec: { factoryType: factory.id, floors: factory.floors, capacity: 400, w: 12, d: 10 } }
  }));
  town.buildings.push(...synthetic);
  town.economy.syncEntities();
  const firms = synthetic.map((building) => town.economy.businessesById.get(building.businessId));
  for (let index = 0; index < firms.length; index++) {
    const factory = FACTORY_TYPES[index];
    const firm = firms[index];
    firm.jobsRequired = 1;
    firm.employees = 1;
    firm.fixedCapital = 1e9;
    firm.status = 'active';
    town.economy.transfer({ from: 'developer', to: { sector: 'business', id: firm.id }, amount: 10000, category: 'private_investment' });
    for (const input of Object.keys(FACTORY_INPUTS[factory.product] || {})) {
      if (input === 'food') continue;
      firm.inventory[input] = 10000;
    }
  }
  const originalAssign = town.economy.assignEmployees;
  town.economy.assignEmployees = () => 0;
  town.resources.levels.food = 1000;
  town.industry.runStockFlowDay();
  town.economy.assignEmployees = originalAssign;
  const production = synthetic.map((building, index) => ({
    id: FACTORY_TYPES[index].id,
    product: FACTORY_TYPES[index].product,
    output: Math.round(firms[index].inventory[FACTORY_TYPES[index].product] || 0)
  }));
  return {
    factoryCount: FACTORY_TYPES.length,
    commodityCount: COMMODITIES.length,
    rows,
    statsKeys: Object.keys(window.town.industry.stats().commodities),
    production
  };
});

const failures = [
  ...(result.factoryCount < 18 ? ['factory catalogue did not include the expanded industrial ring'] : []),
  ...(result.rows.filter((row) => !row.block).map((row) => `${row.id} has no construction block`)),
  ...(result.rows.filter((row) => row.missingModules.length).map((row) => `${row.id} is missing modules ${row.missingModules.join(', ')}`)),
  ...(result.rows.filter((row) => !result.statsKeys.includes(row.product)).map((row) => `${row.product} is missing from industry stats`)),
  ...(result.production.filter((row) => row.output <= 0).map((row) => `${row.id} produced no ${row.product}`)),
  ...errors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, result, errors, failures }, null, 2));
await browser.close();
process.exit(failures.length ? 1 : 0);
