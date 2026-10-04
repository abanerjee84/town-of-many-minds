import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(`${URL}/?seed=1337`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.town?.industry, null, { timeout: 60000 });

const result = await page.evaluate(async () => {
  const { FACTORY_TYPES, COMMODITIES } = await import('/src/simulation/industry.js');
  const town = window.town;
  town.generate(1337);
  const industry = town.industry;
  const capacities = Object.fromEntries(
    Object.entries(industry.stats().commodities).map(([key, row]) => [key, row.capacity])
  );
  const fullStocks = () => Object.fromEntries(COMMODITIES.map((key) => [key, capacities[key]]));
  const factory = (type, capacity = 400, floors = 3) => ({
    purpose: 'industrial',
    capacity,
    floors,
    house: { spec: { factoryType: type, capacity, floors } }
  });
  const setScenario = (stocks, factories, goodsDemand = 0) => {
    industry.stocks = { ...stocks };
    industry.factories = () => factories;
    industry.totalStock = (key) => Number(industry.stocks[key] || 0);
    industry.goodsDemand = () => goodsDemand;
  };

  const constructionStocks = fullStocks();
  constructionStocks.lumber = 194;
  constructionStocks.steel = 44;
  constructionStocks.cement = 0;
  setScenario(constructionStocks, []);
  const cement = {
    missing: industry.missingConstructionProduct(),
    selected: industry.mostUrgentProducer(),
    commissioned: industry.commissionProduct(),
    barePlan: window.planFor(town, 'factory', {})?.factory || null,
    pressure: industry.producerPressure('cement')
  };

  const glassStocks = fullStocks();
  glassStocks.glass = 0;
  setScenario(glassStocks, [factory('electronics', 400, 4)]);
  const glass = {
    selected: industry.mostUrgentProducer(),
    pressure: industry.producerPressure('glass'),
    top: industry.producerPressureSnapshot(3)
  };

  const goodsStocks = fullStocks();
  goodsStocks.goods = 0;
  setScenario(goodsStocks, [], 100);
  const goods = {
    selected: industry.mostUrgentProducer(),
    pressure: industry.producerPressure('goods')
  };

  const rawStocks = fullStocks();
  rawStocks.crude_oil = 0;
  setScenario(rawStocks, [factory('refinery', 400, 5)]);
  const rawInput = {
    selected: industry.mostUrgentProducer(),
    crudePressure: industry.producerPressure('crude_oil'),
    crudeListed: industry.producerPressureSnapshot(20).some((row) => row.product === 'crude_oil')
  };

  return { factoryTypes: FACTORY_TYPES.length, cement, glass, goods, rawInput };
});

const failures = [
  ...(result.factoryTypes < 18 ? ['expanded factory catalogue is incomplete'] : []),
  ...(result.cement.missing !== 'cement' ? [`zero-cement missing-producer choice was ${result.cement.missing}`] : []),
  ...(result.cement.selected !== 'cement' ? [`zero-cement pressure choice was ${result.cement.selected}`] : []),
  ...(result.cement.commissioned !== 'cement' ? [`bare commission selected ${result.cement.commissioned}`] : []),
  ...(result.cement.barePlan !== 'cement' ? [`bare BUILD_FACTORY plan selected ${result.cement.barePlan}`] : []),
  ...(result.glass.selected !== 'glass' ? [`downstream electronics input selected ${result.glass.selected}, expected glass`] : []),
  ...(result.glass.pressure?.demand <= 0 ? ['glass dependency demand was not measured'] : []),
  ...(result.goods.selected !== 'goods' ? [`direct goods demand selected ${result.goods.selected}`] : []),
  ...(result.rawInput.crudePressure !== null ? ['crude oil became a local factory candidate'] : []),
  ...(result.rawInput.crudeListed ? ['crude oil appeared in the producer pressure board'] : []),
  ...errors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, result, errors, failures }, null, 2));
await browser.close();
process.exit(failures.length ? 1 : 0);
