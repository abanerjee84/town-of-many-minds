/** Pure demand assessment. No planning, account mutation, or catalogue-order preference. */
const nonnegative = (value) => Math.max(0, Number(value) || 0);
const unit = (value) => Math.min(1, nonnegative(value));
const round = (value) => Math.round(value * 1000) / 1000;

export function assessIndustrialDemand(context, catalogue, rules) {
  const products = [...new Set(catalogue.factoryTypes.map((factory) => factory.product))].sort();
  const productSet = new Set(products);
  const direct = Object.fromEntries(products.map((key) => [key, 0]));
  const impacts = { ...direct }, unfunded = { ...direct }, sources = Object.fromEntries(products.map((key) => [key, {}]));
  for (const order of context.orders || []) {
    if (!productSet.has(order.product)) continue;
    const quantity = nonnegative(order.quantity);
    direct[order.product] += quantity;
    if (order.buyer?.sector === 'government') unfunded[order.product] += Math.max(0, quantity - nonnegative(order.affordableQuantity));
    impacts[order.product] = Math.max(impacts[order.product], quantity > 0 ? unit(order.impact) : 0);
    const source = order.source || 'business';
    sources[order.product][source] = (sources[order.product][source] || 0) + quantity;
  }
  // Visit consumers before suppliers. Reject cycles instead of amplifying a recipe forever.
  const visited = new Set(), visiting = new Set(), order = [];
  const visit = (key) => {
    if (visiting.has(key)) throw new Error(`industrial recipe cycle at ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const input of Object.keys(catalogue.inputs[key] || {}).sort()) if (productSet.has(input)) visit(input);
    visiting.delete(key); visited.add(key); order.push(key);
  };
  for (const key of products) visit(key);
  const demand = { ...direct }, downstream = Object.fromEntries(products.map((key) => [key, 0])), prerequisites = {};
  for (const key of order.reverse()) {
    const supply = context.supply[key] || {};
    const horizon = Math.max(1, nonnegative(context.leadDays?.[key]) + rules.bufferDays);
    // Existing stock and confirmed deliveries can satisfy final orders without local manufacture.
    const replacement = Math.max(0, demand[key] - nonnegative(supply.stock) / horizon - nonnegative(supply.imports));
    prerequisites[key] = [];
    for (const [input, perUnit] of Object.entries(catalogue.inputs[key] || {}).sort(([a], [b]) => a.localeCompare(b))) {
      const quantity = replacement * nonnegative(perUnit);
      if (quantity <= 0) continue;
      prerequisites[key].push({ product: input, demand: round(quantity), local: productSet.has(input) });
      if (!productSet.has(input)) continue;
      demand[input] += quantity;
      downstream[input] += quantity;
      impacts[input] = Math.max(impacts[input], impacts[key]);
      sources[input][`input:${key}`] = (sources[input][`input:${key}`] || 0) + quantity;
    }
  }
  return products.map((key) => {
    const supply = context.supply[key] || {};
    const daily = demand[key], stock = nonnegative(supply.stock);
    const rated = nonnegative(supply.rated), effective = nonnegative(supply.effective);
    const pending = nonnegative(supply.pending), imports = nonnegative(supply.imports);
    const horizon = Math.max(1, nonnegative(context.leadDays?.[key]) + rules.bufferDays);
    const pendingDays = Math.max(0, horizon - nonnegative(supply.pendingLeadDays));
    const available = stock + (effective + imports) * horizon + pending * pendingDays;
    const need = daily * horizon;
    const bridgeDays = Math.min(horizon, nonnegative(supply.pendingLeadDays));
    const bridgeNeed = daily * bridgeDays;
    const bridgeShortage = bridgeNeed > 0 ? unit((bridgeNeed - stock - (effective + imports) * bridgeDays) / bridgeNeed) : 0;
    const shortage = need > 0 ? Math.max(unit((need - available) / need), bridgeShortage) : 0;
    const gap = Math.max(0, daily - effective - pending - imports);
    const actionable = daily > 0 && shortage > 0;
    const age = actionable ? nonnegative(context.ageDays?.[key]) : 0;
    const dependency = daily > 0 ? unit(downstream[key] / daily) : 0;
    const benefit = unit(supply.importBenefit);
    const terms = { shortage, impact: impacts[key], dependency, importBenefit: benefit, persistence: unit(age / rules.persistenceDays) };
    const priority = actionable ? Object.entries(rules.weights).reduce((sum, [term, weight]) => sum + terms[term] * weight, 0) : 0;
    const constraints = [...(supply.constraints || [])];
    // A shortage fully explained by recoverable installed capacity does not justify a duplicate plant.
    const recoverable = rated > 0 && effective < rated * rules.recoveryCoverage && constraints.length > 0;
    const remedy = !actionable ? (pending > 0 ? 'await_capacity' : 'covered')
      : recoverable ? 'restore_output'
      : pending > 0 && gap <= 0 ? 'bridge_imports'
      : rated > 0 ? 'expand_capacity' : 'build_factory';
    return {
      product: key, stock: round(stock), demand: round(daily), directDemand: round(direct[key]),
      unfundedPublicDemand: round(unfunded[key]),
      producerCapacity: round(rated), effectiveCapacity: round(effective), pendingCapacity: round(pending),
      capacityGap: round(gap), coverDays: daily > 0 ? round(stock / daily) : null,
      horizonDays: round(horizon), stockStress: round(shortage), demandGap: daily > 0 ? round(unit(gap / daily)) : 0,
      missingProducer: rated <= 0, priority: round(priority), actionable, remedy, ageDays: age,
      sources: Object.fromEntries(Object.entries(sources[key]).map(([source, quantity]) => [source, round(quantity)])),
      prerequisites: prerequisites[key], constraints,
      reason: !actionable ? (daily > 0 ? 'forecast demand covered' : 'no measured customers')
        : remedy === 'restore_output' ? `restore installed output: ${constraints.join(', ')}`
        : remedy === 'bridge_imports' ? 'bridge shortage while funded capacity completes'
        : `${key}: ${round(stock / Math.max(daily, 1e-9))} days stock; ${round(gap)}/day capacity gap`
    };
  }).sort((a, b) => b.priority - a.priority || (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity) || a.product.localeCompare(b.product));
}
