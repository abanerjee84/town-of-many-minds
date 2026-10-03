/**
 * Small synchronous transaction boundary for kit mutations.
 *
 * Existing growth code has richer project savepoints; this adapter provides a
 * common contract that new kits can use without depending on GrowthSystem.
 * Snapshots are supplied by the owning kit or shared mutation service, so the
 * transaction never guesses which state is durable.
 */
export class KitTransaction {
  constructor({ name = 'kit-mutation', snapshot, restore } = {}) {
    if (typeof snapshot !== 'function' || typeof restore !== 'function') {
      throw new Error('KitTransaction requires snapshot and restore functions');
    }
    this.name = name;
    this.snapshot = snapshot;
    this.restore = restore;
    this.state = 'ready';
    this.before = null;
  }

  run(mutate) {
    if (this.state !== 'ready') throw new Error(`${this.name} is already ${this.state}`);
    if (typeof mutate !== 'function') throw new Error(`${this.name} requires a mutation function`);
    this.before = this.snapshot();
    this.state = 'running';
    try {
      const value = mutate();
      if (value && value.ok === false) {
        this.restore(this.before);
        this.state = 'rolled-back';
        return { ok: false, reason: value.reason || 'mutation-rejected', value };
      }
      this.state = 'committed';
      return { ok: true, value };
    } catch (error) {
      this.restore(this.before);
      this.state = 'rolled-back';
      return { ok: false, reason: error?.message || String(error), error };
    }
  }
}

export function runKitTransaction(options, mutate) {
  return new KitTransaction(options).run(mutate);
}
