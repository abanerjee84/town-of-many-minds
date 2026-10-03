import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'BuildContracts', 'hardcode-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
assert.equal(catalog.version, 1, 'hardcode catalog version is missing');
assert(catalog.sources.length >= 10, 'hardcode catalog is too small to be useful');

for (const row of catalog.sources) {
  const firstPath = row.path.split(' and ')[0].split(',')[0].trim();
  assert(fs.existsSync(path.join(root, firstPath)), `${row.id} points at a missing source: ${firstPath}`);
  if (row.target) {
    const target = row.target.split(' and ')[0].split(',')[0].trim();
    assert(target.endsWith('.json'), `${row.id} target is not a JSON module: ${target}`);
  }
}

const weather = JSON.parse(fs.readFileSync(path.join(root, 'src/data/weather.json'), 'utf8'));
assert.equal(weather.version, 1, 'weather chart version is missing');
assert.equal(weather.seasons.length, 4, 'weather chart must define four seasons');
assert(Object.keys(weather.states).length >= 6, 'weather chart lost a state');
for (const season of weather.seasons) {
  assert(season.id && season.weather.length, `weather season ${season.id} has no selection weights`);
  for (const id of season.weather) assert(weather.states[id], `${season.id} references missing weather state ${id}`);
}

console.log(`HARDCODE AUDIT OK: ${catalog.sources.length} tracked source groups; weather chart schema valid`);
