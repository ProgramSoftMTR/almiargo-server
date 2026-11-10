/** Emisor de eventos minimalista (sin dependencias). */
export class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) {
      try { fn(payload); } catch (err) { console.error(`[event:${event}]`, err); }
    }
  }
}
