import { isWalkable } from './worldgen.js';

/**
 * A* en grid 80x80 para tap-to-move del cliente.
 * No se usa en el servidor (allí cada paso se valida individualmente).
 */

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

function heuristic(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  return dx + dy + (1.4142 - 2) * Math.min(dx, dy);
}

export function findPath(world, sx, sy, tx, ty, maxNodes = 6000) {
  sx = Math.round(sx); sy = Math.round(sy);
  tx = Math.round(tx); ty = Math.round(ty);
  if (!isWalkable(world, tx, ty)) return [];
  if (sx === tx && sy === ty) return [];

  const w = world.width;
  const h = world.height;
  const size = w * h;
  const gScore = new Float32Array(size).fill(Infinity);
  const fScore = new Float32Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = [];

  const start = sy * w + sx;
  const goal = ty * w + tx;
  gScore[start] = 0;
  fScore[start] = heuristic(sx, sy, tx, ty);
  open.push(start);

  let expanded = 0;
  while (open.length && expanded < maxNodes) {
    // Búsqueda lineal suficiente para mapas pequeños; se puede cambiar a heap.
    let bestIndex = 0;
    let bestF = Infinity;
    for (let i = 0; i < open.length; i += 1) {
      const f = fScore[open[i]];
      if (f < bestF) { bestF = f; bestIndex = i; }
    }
    const current = open.splice(bestIndex, 1)[0];
    if (current === goal) {
      const path = [];
      let node = current;
      while (node !== start && node !== -1) {
        path.push({ x: node % w, y: Math.floor(node / w) });
        node = cameFrom[node];
      }
      return path.reverse();
    }
    closed[current] = 1;
    expanded += 1;
    const cx = current % w;
    const cy = Math.floor(current / w);

    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIndex = ny * w + nx;
      if (closed[nIndex] || !isWalkable(world, nx, ny)) continue;
      // Evita cortar esquinas en diagonales.
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(world, cx + dx, cy) || !isWalkable(world, cx, cy + dy)) continue;
      }
      const tentative = gScore[current] + cost;
      if (tentative < gScore[nIndex]) {
        cameFrom[nIndex] = current;
        gScore[nIndex] = tentative;
        fScore[nIndex] = tentative + heuristic(nx, ny, tx, ty);
        if (!open.includes(nIndex)) open.push(nIndex);
      }
    }
  }
  return [];
}

export function pathToDirections(path) {
  const dirs = [];
  let px = path.length ? path[0].x : 0;
  let py = path.length ? path[0].y : 0;
  // El primer paso es relativo al jugador; el llamador rellena su posición real.
  for (let i = 1; i < path.length; i += 1) {
    dirs.push([Math.sign(path[i].x - path[i - 1].x), Math.sign(path[i].y - path[i - 1].y)]);
  }
  return dirs;
}
