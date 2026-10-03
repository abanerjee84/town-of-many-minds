import { chromium } from 'playwright';
import { Clock } from '../src/core/clock.js';

const URL = process.env.APP_URL || 'http://localhost:5174';
const SPEEDS = [0, 1, 2, 4, 10, 20, 50, 100];

// Keep the deterministic clock contract separate from RAF timing. This catches
// a speed value that changes the label but does not scale game time.
const clock = new Clock(6);
const clockDeltas = {};
for (const speed of [0, 1, 10, 100]) {
  clock.speed = speed;
  const before = clock.hour;
  clock.update(0.25);
  clockDeltas[speed] = clock.hour - before;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.clock && !!window.hud, null, { timeout: 60000 });

  // Pause immediately so the assertions are not racing long-running world
  // systems while each control is checked.
  await page.evaluate(() => document.getElementById('speed-0').click());
  const buttons = {};
  for (const speed of SPEEDS) {
    const state = await page.evaluate((value) => {
      document.getElementById(`speed-${value}`).click();
      const active = [...document.querySelectorAll('[id^="speed-"]')]
        .filter((button) => button.classList.contains('active'))
        .map((button) => Number(button.dataset.speed));
      const result = { runtime: window.clock.speed, active };
      document.getElementById('speed-0').click();
      return result;
    }, speed);
    buttons[speed] = state;
  }

  await page.evaluate(() => document.getElementById('settings-toggle').click());
  await page.waitForFunction(() => !document.getElementById('insp-modal')?.classList.contains('hidden'));
  await page.selectOption('#setting-speed', '20');
  const settings = await page.evaluate(() => ({
    runtime: window.clock.speed,
    selected: document.getElementById('setting-speed').value,
    stored: JSON.parse(localStorage.getItem('tomm.settings') || '{}').defaultSpeed
  }));

  const failures = [];
  if (clockDeltas[0] !== 0) failures.push('clock pause did not stop game time');
  if (!(clockDeltas[1] > 0 && clockDeltas[10] > clockDeltas[1] && clockDeltas[100] > clockDeltas[10])) {
    failures.push('clock speed did not scale game time monotonically');
  }
  if (Math.abs(clockDeltas[10] / clockDeltas[1] - 10) > 1e-9) failures.push('10x clock rate is not exactly 10x');
  if (Math.abs(clockDeltas[100] / clockDeltas[1] - 100) > 1e-9) failures.push('100x clock rate is not exactly 100x');
  for (const speed of SPEEDS) {
    const state = buttons[speed];
    if (state.runtime !== speed || state.active.length !== 1 || state.active[0] !== speed) {
      failures.push(`speed-${speed} did not update runtime and active state together`);
    }
  }
  if (settings.runtime !== 20 || settings.selected !== '20' || settings.stored !== 20) {
    failures.push('settings speed did not update runtime and persisted default');
  }
  failures.push(...pageErrors.map((message) => `page error: ${message}`));

  console.log(JSON.stringify({
    ok: failures.length === 0,
    clockDeltas,
    buttons,
    settings,
    pageErrors,
    failures
  }, null, 2));
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser.close();
}
