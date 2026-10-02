import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:5174';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.town?.weather && !!window.town?.governance, null, { timeout: 60000 });

const result = await page.evaluate(() => {
  const t = window.town;
  const collect = () => {
    t.weather.reset(1337);
    const out = [];
    for (let day = 1; day <= 120; day++) {
      t.weather.update({ day });
      if ([1, 30, 31, 60, 61, 90, 91, 120].includes(day)) {
        const s = t.weather.stats();
        out.push({ day, season: s.season, weather: s.weather, temperature: s.temperature, foodYield: s.modifiers.foodYield });
      }
    }
    return out;
  };
  const first = collect();
  const second = collect();
  const report = t.governance.report();
  const final = t.weather.stats();
  return { first, second, final, reportHasWeather: report.includes('Weather:') };
});

const failures = [
  ...(JSON.stringify(result.first) !== JSON.stringify(result.second) ? ['weather cycle is not deterministic for the same seed'] : []),
  ...(result.first.map((x) => x.season).join(',') !== 'spring,spring,summer,summer,autumn,autumn,winter,winter' ? ['season boundaries are incorrect'] : []),
  ...(!result.first.some((x) => x.foodYield < 1) ? ['weather never changes food production modifiers'] : []),
  ...(!result.reportHasWeather ? ['council report does not include weather evidence'] : []),
  ...pageErrors.map((message) => `page error: ${message}`)
];

console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }));
await browser.close();
process.exit(failures.length ? 1 : 0);
