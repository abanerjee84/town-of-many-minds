import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessIndustrialDemand } from '../src/simulation/industryDemand.js';

const data = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url)));
const catalog = data('industryCatalog'), rules = data('industryDemand');
const products = catalog.factoryTypes.map((row) => row.product);
const context = (product = 'medicine', quantity = 100) => ({
  orders: quantity ? [{ product, quantity, impact: 1, source: 'services' }] : [],
  supply: Object.fromEntries(products.map((key) => [key, { stock: key === product ? 0 : 1e6, rated: 0, effective: 0, pending: 0 }])),
  leadDays: Object.fromEntries(products.map((key) => [key, 2])), ageDays: {}
});
const assess = (ctx, kit = catalog) => assessIndustrialDemand(ctx, kit, rules);
const reversed = { ...catalog, factoryTypes: [...catalog.factoryTypes].reverse() };
for (const product of products) {
  const ctx = context(product);
  assert.equal(assess(ctx)[0].product, product, `${product} must win its own unmet customer demand`);
  assert.deepEqual(assess(ctx), assess(ctx, reversed), 'catalogue order must not change priority');
}
assert.equal(assess(context('goods', 0)).filter((row) => row.actionable).length, 0);
const unused = context('goods', 0);
for (const row of Object.values(unused.supply)) row.stock = 0;
assert.equal(assess(unused).filter((row) => row.actionable).length, 0, 'empty stock without customers is not a build signal');

const idle = context();
Object.assign(idle.supply.medicine, { rated: 200, effective: 0, constraints: ['staff/training'] });
assert.equal(assess(idle)[0].remedy, 'restore_output');
const expand = context();
Object.assign(expand.supply.medicine, { rated: 10, effective: 10 });
assert.equal(assess(expand)[0].remedy, 'expand_capacity');
const pending = context();
Object.assign(pending.supply.medicine, { pending: 200, pendingLeadDays: 2 });
assert.equal(assess(pending)[0].remedy, 'bridge_imports');
assert.equal(assess(pending)[0].capacityGap, 0);
pending.supply.medicine.stock = 250;
assert.equal(assess(pending).find((row) => row.product === 'medicine').remedy, 'await_capacity');
const imports = context();
imports.supply.medicine.imports = 100;
assert.equal(assess(imports).find((row) => row.product === 'medicine').actionable, false);

const chain = context('medicine', 10);
for (const row of Object.values(chain.supply)) row.stock = 0;
const board = assess(chain);
const demand = (key) => board.find((row) => row.product === key).demand;
assert.equal(demand('chemicals'), 2.4);
assert.equal(demand('glass'), 0.8);
assert.equal(demand('software'), 0.6);
assert.equal(demand('refined_fuel'), 0.48);
assert.equal(demand('aggregate'), 0.416);
assert.ok(!board.some((row) => row.product === 'crude_oil'));
assert.ok(board.find((row) => row.product === 'refined_fuel').prerequisites.some((row) => row.product === 'crude_oil' && !row.local));
const cyclic = structuredClone(catalog);
cyclic.inputs.lumber = { cement: 1 };
assert.throws(() => assess(chain, cyclic), /recipe cycle/);
const aged = context();
aged.ageDays.medicine = rules.persistenceDays;
assert.ok(assess(aged)[0].priority > assess(context())[0].priority);
const scale = context();
scale.orders[0].quantity *= 100;
scale.supply.medicine.stock *= 100;
assert.equal(assess(scale)[0].priority, assess(context())[0].priority, 'units must not bias scores');
assert.deepEqual(assess(context(), { ...catalog, capacity: Object.fromEntries(products.map((key) => [key, 1])) }), assess(context()), 'warehouse size is not demand');

// Fast controlled horizon: one genuine demand spike rotates across every product.
// No rendering, traffic, provider calls or automatic public decisions are involved.
const winners = new Set();
for (let day = 1; day <= 800; day++) {
  const product = products[(day - 1) % products.length];
  const ctx = context(product, 10 + day % 90);
  ctx.ageDays[product] = day % rules.persistenceDays;
  const snapshot = assess(ctx);
  assert.equal(snapshot[0].product, product);
  assert.ok(snapshot.every((row) => Number.isFinite(row.priority) && row.priority >= 0 && row.priority <= 1));
  winners.add(snapshot[0].product);
}
assert.equal(winners.size, products.length);
console.log(JSON.stringify({ ok: true, products: products.length, controlledDays: 800, winners: [...winners] }));
