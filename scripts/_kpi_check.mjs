import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.town?.kpi && !!window.interaction, null, { timeout: 60000 });
  const result = await page.evaluate(() => {
    const town = window.town;
    town.generate(1337);
    town.governance.record({ intent: 'BUILD_FACTORY', status: 'blocked', source: 'test', detail: 'test blocked motion' });
    town.governance.record({ intent: 'ACQUIRE_LAND', status: 'done', source: 'test', priority: 0.9, detail: 'test completed motion' });
    town.kpi.updateDay({ day: 1, hour: 0 });
    town.kpi.updateDay({ day: 2, hour: 0 });
    const before = town.kpi.stats();
    const saved = town.exportIntegrityState();
    const savedKpi = saved.kpi;
    const imported = town.importIntegrityState(saved);
    const after = town.kpi.stats();
    window.interaction.openHistory('kpi');
    return {
      before,
      after,
      save: { ok: saved.ok, hasKpi: !!savedKpi, decisions: savedKpi?.decisions?.length || 0 },
      imported: { ok: imported.ok, reason: imported.reason || null },
      modal: {
        title: document.getElementById('modal-title')?.textContent,
        hasCompliance: document.getElementById('modal-body')?.textContent.includes('Constraint compliance'),
        hasExport: !!document.getElementById('kpi-export'),
        searchable: !!document.getElementById('kpi-search'),
        buttonCount: document.querySelectorAll('[data-modal="kpi"]').length
      }
    };
  });
  const failures = [];
  if (result.before.counters.attempted < 2) failures.push('decision records were not captured');
  if (result.before.counters.blocked !== 1) failures.push('blocked decision KPI count is wrong');
  if (result.before.counters.completed !== 1) failures.push('completed decision KPI count is wrong');
  if (!result.save.ok || !result.save.hasKpi) failures.push('KPI ledger was not included in integrity save');
  if (!result.imported.ok || result.after.counters.attempted !== result.before.counters.attempted) failures.push('KPI ledger did not survive integrity restore');
  if (result.modal.title !== 'Council & town KPIs' || !result.modal.hasCompliance || !result.modal.hasExport || !result.modal.searchable || result.modal.buttonCount < 1) failures.push('KPI modal is incomplete');
  failures.push(...pageErrors.map((message) => `page error: ${message}`));
  console.log(JSON.stringify({ ok: failures.length === 0, ...result, pageErrors, failures }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
