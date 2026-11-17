import { TILE, tileAt } from '../../shared/index.js';

/**
 * Estado en memoria de los recursos recolectables (árboles).
 */
const MIN_MS = 120000;
const MAX_MS = 180000;
const TREE_TILES = new Set([
  TILE.TREE, TILE.TREE_PALM, TILE.TREE_PINE, TILE.TREE_ACACIA, TILE.TREE_DEAD,
]);

export class ResourceManager {
  constructor({ world, map = null, minMs = MIN_MS, maxMs = MAX_MS, onRegrow = null } = {}) {
    this.map = map ?? world?.map ?? world ?? null;
    this.world = world ?? null;
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.onRegrow = onRegrow;
    /** Map "x,y" -> { x, y, alive, respawnAt, timer } */
    this.trees = new Map();
  }

  static key(x, y) {
    return `${Math.round(x)},${Math.round(y)}`;
  }

  isTreeTile(tile) {
    return TREE_TILES.has(tile);
  }

  isTree(x, y) {
    if (!this.map || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return false;
    try {
      return this.isTreeTile(tileAt(this.map, x, y));
    } catch {
      return false;
    }
  }

  isStump(x, y) {
    const node = this.trees.get(ResourceManager.key(x, y));
    return !!node && node.alive === false;
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

  chop(x, y) {
    if (!this.isTree(x, y)) return null;
    const key = ResourceManager.key(x, y);
    const node = this.trees.get(key) ?? { x, y, alive: true, respawnAt: 0, timer: null };
    if (!node.alive) return null;

    node.alive = false;
    const delay = Math.floor(Math.random() * (this.maxMs - this.minMs + 1)) + this.minMs;
    node.respawnAt = Date.now() + delay;

    const tryRegrow = () => {
      // Pausa/reinicia si hay un jugador parado sobre el tocón.
      const occupied = this.world?.players
        ? [...this.world.players.values()].some((p) => !p.isDead && Math.round(p.x) === x && Math.round(p.y) === y)
        : false;
      if (occupied) {
        node.timer = setTimeout(tryRegrow, 5000);
        node.timer.unref?.();
        return;
      }
      node.alive = true;
      node.respawnAt = 0;
      node.timer = null;
      this.trees.delete(key);
      if (typeof this.onRegrow === 'function') this.onRegrow(x, y);
    };

    node.timer = setTimeout(tryRegrow, delay);
    node.timer.unref?.();
    this.trees.set(key, node);
    return { delay };
  }

  clear() {
    for (const node of this.trees.values()) {
      if (node.timer) clearTimeout(node.timer);
    }
    this.trees.clear();
  }
}