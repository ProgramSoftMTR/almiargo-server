/**
 * Spatial hash para gestión de interés y consultas locales.
 *
 * El mundo es pequeño hoy, pero este índice evita que cada snapshot recorra
 * todas las entidades del mapa por cada jugador. Las entidades se indexan por
 * celdas de `cellSize` tiles y se actualizan de forma incremental al moverse.
 */
export class SpatialHash {
  constructor(cellSize = 8) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.entityCells = new WeakMap();
    this.count = 0;
  }

  clear() {
    this.cells.clear();
    this.entityCells = new WeakMap();
    this.count = 0;
  }

  key(cx, cy) {
    return `${cx},${cy}`;
  }

  cellFor(x, y) {
    return [
      Math.floor(x / this.cellSize),
      Math.floor(y / this.cellSize),
    ];
  }

  insert(entity) {
    if (!entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return;
    const [cx, cy] = this.cellFor(entity.x, entity.y);
    const key = this.key(cx, cy);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = new Set();
      this.cells.set(key, bucket);
    }
    if (!bucket.has(entity)) {
      bucket.add(entity);
      this.count += 1;
    }
    this.entityCells.set(entity, key);
  }

  remove(entity) {
    if (!entity) return;
    const key = this.entityCells.get(entity);
    if (!key) return;
    const bucket = this.cells.get(key);
    if (bucket && bucket.delete(entity)) this.count -= 1;
    if (bucket && bucket.size === 0) this.cells.delete(key);
    this.entityCells.delete(entity);
  }

  /** Reindexa una entidad tras un cambio de posición. */
  update(entity) {
    if (!entity) return;
    const [cx, cy] = this.cellFor(entity.x, entity.y);
    const key = this.key(cx, cy);
    const current = this.entityCells.get(entity);
    if (current === key) return;
    if (current) this.remove(entity);
    this.insert(entity);
  }

  rebuild(items = []) {
    this.clear();
    for (const entity of items) this.insert(entity);
  }

  /** Entidades dentro de un círculo (distancia euclidiana). */
  queryCircle(x, y, radius, filter = null) {
    const out = [];
    const r2 = radius * radius;
    const [minCx, minCy] = this.cellFor(x - radius, y - radius);
    const [maxCx, maxCy] = this.cellFor(x + radius, y + radius);
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const entity of bucket) {
          const dx = entity.x - x;
          const dy = entity.y - y;
          if (dx * dx + dy * dy > r2) continue;
          if (filter && !filter(entity)) continue;
          out.push(entity);
        }
      }
    }
    return out;
  }

  /**
   * Entidades dentro de un rectángulo inclusivo. Es la consulta usada para el
   * viewport de los snapshots (el cliente renderiza en landscape).
   */
  queryRect(minX, minY, maxX, maxY, filter = null) {
    const out = [];
    const [minCx, minCy] = this.cellFor(minX, minY);
    const [maxCx, maxCy] = this.cellFor(maxX, maxY);
    for (let cy = minCy; cy <= maxCy; cy += 1) {
      for (let cx = minCx; cx <= maxCx; cx += 1) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const entity of bucket) {
          if (entity.x < minX || entity.x > maxX) continue;
          if (entity.y < minY || entity.y > maxY) continue;
          if (filter && !filter(entity)) continue;
          out.push(entity);
        }
      }
    }
    return out;
  }

  nearest(x, y, radius, filter = null) {
    let best = null;
    let bestD2 = radius * radius;
    for (const entity of this.queryCircle(x, y, radius, filter)) {
      const d2 = (entity.x - x) ** 2 + (entity.y - y) ** 2;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = entity;
      }
    }
    return best;
  }
}
