import { TILE, tileAt } from '../../shared/index.js';

/**
 * Estado en memoria de los recursos recolectables (árboles).
 *
 * - NO se persiste en Firestore ni en disco: si el servidor se reinicia,
 *   todos los árboles vuelven a estar en estado 'alive'.
 * - Cada árbol talado se marca como 'stump' y programa un temporizador
 *   aleatorio de reaparición (120–180 s).
 */
const MIN_MS = 120000;
const MAX_MS = 180000;

export class ResourceManager {
  constructor({ world, map = null, minMs = MIN_MS, maxMs = MAX_MS, onRegrow = null } = {}) {
    this.map = map ?? world?.map ?? world ?? null;
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.onRegrow = onRegrow;
    /** Map "x,y" -> { x, y, alive, respawnAt, timer } */
    this.trees = new Map();
  }

  static key(x, y) {
    return `${Math.round(x)},${Math.round(y)}`;
  }

  isTree(x, y) {
    if (!this.map || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
    try {
      return tileAt(this.map, x, y) === TILE.TREE;
    } catch {
      return false;
    }
  }

  stumps() {
    const out = [];
    for (const node of this.trees.values()) {
      if (node.alive === false) out.push({ x: node.x, y: node.y, state: 'stump' });
    }
    return out;
  }

  isAlive(x, y) {
    const node = this.trees.get(ResourceManager.key(x, y));
    return !node || node.alive === true;
  }

  /**
   * Intenta talar. Devuelve { delay } si se taló, o null si no era posible
   * (ya talado o no es árbol). El llamador debe validar distancia/hacha/etc.
   */
  chop(x, y) {
    if (!this.isTree(x, y)) return null;
    const key = ResourceManager.key(x, y);
    const node = this.trees.get(key) ?? { x, y, alive: true, respawnAt: 0, timer: null };
    if (!node.alive) return null;

    node.alive = false;
    const delay = Math.floor(Math.random() * (this.maxMs - this.minMs + 1)) + this.minMs;
    node.respawnAt = Date.now() + delay;
    node.timer = setTimeout(() => {
      node.alive = true;
      node.respawnAt = 0;
      node.timer = null;
      // Estado por defecto = alive: limpiamos la entrada para no acumular memoria.
      this.trees.delete(key);
      if (typeof this.onRegrow === 'function') this.onRegrow(x, y);
    }, delay);
    node.timer.unref?.();
    this.trees.set(key, node);
    return { delay };
  }

  /** Limpia temporizadores (usar en stop()). */
  clear() {
    for (const node of this.trees.values()) {
      if (node.timer) clearTimeout(node.timer);
    }
    this.trees.clear();
  }
}