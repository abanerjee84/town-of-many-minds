const listeners = new Map();

export const events = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  },
  emit(type, payload) {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  },
  clear(type) {
    if (type) listeners.delete(type);
    else listeners.clear();
  }
};
