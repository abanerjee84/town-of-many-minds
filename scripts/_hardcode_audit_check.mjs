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

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const industry = readJson('src/data/industryCatalog.json');
assert(industry.version === 1 && industry.factoryTypes && industry.commodities, 'industry catalogue schema is incomplete');
const construction = readJson('src/data/constructionCatalog.json');
assert(construction.version === 1 && Array.isArray(construction.blocks) && construction.blocks.length >= 70, 'construction catalogue schema is incomplete');
const blockIds = construction.blocks.map((row) => row.id);
assert.equal(new Set(blockIds).size, blockIds.length, 'construction catalogue contains duplicate block IDs');
assert(construction.familyBills && construction.modulePremium, 'construction bills are not externalized');
const civic = readJson('src/data/civicCatalog.json');
assert(civic.version === 1 && civic.catalogue?.college && civic.catalogue?.university, 'civic catalogue is missing tertiary facilities');
const resources = readJson('src/data/resourceRules.json');
assert(resources.version === 1 && resources.agricultureTiers?.farm && resources.planning?.maxGrowthSites, 'resource rules schema is incomplete');
const transport = readJson('src/data/transportRules.json');
assert(transport.version === 1 && transport.vehicleFinance && transport.publicTransport && transport.serviceCoverage?.length, 'transport rules schema is incomplete');

console.log(`HARDCODE AUDIT OK: ${catalog.sources.length} tracked source groups; extracted catalogue schemas valid`);
