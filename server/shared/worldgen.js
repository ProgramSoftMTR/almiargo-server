import {
  MAP_HEIGHT,
  MAP_WIDTH,
  NPCS,
  SPAWN_POINT,
  SPAWN_ZONES,
  WORLD_SEED,
  ZONES,
} from './config.js';

/**
 * Generación determinista del mapa (misma semilla en server y cliente).
 * El terreno nunca viaja por la red: sólo se envía la semilla al autenticar.
 *
 * Capas (tile ids):
 *  0 grass | 1 dirt | 2 stone | 3 water | 4 tree | 5 wall | 6 sand | 7 flowers
 */

export const TILE = Object.freeze({
  GRASS: 0,
  DIRT: 1,
  STONE: 2,
  WATER: 3,
  TREE: 4,
  WALL: 5,
  SAND: 6,
  FLOWERS: 7,
});

export const TILE_COLORS = Object.freeze({
  0: [0x3d6b3a, 0x356236, 0x447540],
  1: [0x6a5438, 0x5f4c33, 0x755d3d],
  2: [0x6b6862, 0x625f5a, 0x74716a],
  3: [0x2b5680, 0x2f5d8a, 0x274c73],
  4: [0x1e4427, 0x24502c, 0x193a21],
  5: [0x4b4540, 0x554e48, 0x403b37],
  6: [0x9b8657, 0x8f7b4f, 0xa6905f],
  7: [0x3d6b3a, 0x447540, 0x3a6537],
});

export function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return TILE.WALL;
  return world.tiles[y * world.width + x];
}

export function isWalkableTile(tile) {
  return tile !== TILE.WATER && tile !== TILE.TREE && tile !== TILE.WALL;
}

export function isWalkable(world, x, y) {
  return isWalkableTile(tileAt(world, x, y));
}

export function isSafeZone(x, y) {
  return x >= ZONES.safe.x1 && x <= ZONES.safe.x2 && y >= ZONES.safe.y1 && y <= ZONES.safe.y2;
}

export function isPvPZone(x, y) {
  return x >= ZONES.pvp.x1 && x <= ZONES.pvp.x2 && y >= ZONES.pvp.y1 && y <= ZONES.pvp.y2;
}

// PRNG rápido y determinista (mulberry32).
function mulberry32(a) {
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateWorld(seed = WORLD_SEED) {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  const tiles = new Uint8Array(width * height).fill(TILE.GRASS);
  const rng = mulberry32(seed);

  const idx = (x, y) => y * width + x;
  const set = (x, y, tile) => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[idx(x, y)] = tile;
  };
  const get = (x, y) => tileAt({ width, height, tiles }, x, y);

  // Manchas de tierra / flores para romper la monotonía.
  for (let i = 0; i < 220; i += 1) {
    const cx = Math.floor(rng() * width);
    const cy = Math.floor(rng() * height);
    const r = 1 + Math.floor(rng() * 3);
    for (let y = cy - r; y <= cy + r; y += 1) {
      for (let x = cx - r; x <= cx + r; x += 1) {
        if (rng() < 0.55) set(x, y, rng() < 0.25 ? TILE.DIRT : TILE.FLOWERS);
      }
    }
  }

  // Lago al este.
  const lake = { x: 68, y: 20, rx: 6, ry: 4 };
  for (let y = lake.y - lake.ry - 2; y <= lake.y + lake.ry + 2; y += 1) {
    for (let x = lake.x - lake.rx - 2; x <= lake.x + lake.rx + 2; x += 1) {
      const d = ((x - lake.x) ** 2) / lake.rx ** 2 + ((y - lake.y) ** 2) / lake.ry ** 2;
      if (d <= 1) set(x, y, TILE.WATER);
      else if (d <= 1.5) set(x, y, TILE.SAND);
    }
  }

  // Arena PvP (noroeste) y ciudad (centro).
  for (let y = ZONES.pvp.y1; y <= ZONES.pvp.y2; y += 1) {
    for (let x = ZONES.pvp.x1; x <= ZONES.pvp.x2; x += 1) {
      const border = x === ZONES.pvp.x1 || x === ZONES.pvp.x2 || y === ZONES.pvp.y1 || y === ZONES.pvp.y2;
      set(x, y, border ? TILE.DIRT : TILE.SAND);
    }
  }

  for (let y = ZONES.safe.y1; y <= ZONES.safe.y2; y += 1) {
    for (let x = ZONES.safe.x1; x <= ZONES.safe.x2; x += 1) set(x, y, TILE.STONE);
  }

  // Árboles (clusters) fuera de ciudad y arena.
  for (let i = 0; i < 420; i += 1) {
    const cx = 1 + Math.floor(rng() * (width - 2));
    const cy = 1 + Math.floor(rng() * (height - 2));
    if (isSafeZone(cx, cy) || isPvPZone(cx, cy)) continue;
    const cluster = 1 + Math.floor(rng() * 3);
    for (let j = 0; j < cluster; j += 1) {
      const x = cx + Math.floor(rng() * 3) - 1;
      const y = cy + Math.floor(rng() * 3) - 1;
      if (isSafeZone(x, y) || isPvPZone(x, y)) continue;
      if (get(x, y) === TILE.GRASS || get(x, y) === TILE.DIRT || get(x, y) === TILE.FLOWERS) {
        if (rng() < 0.62) set(x, y, TILE.TREE);
      }
    }
  }

  // Caminos: conectan ciudad, zonas de farmeo y arena.
  const carve = (x1, y1, x2, y2, widthRoad = 1) => {
    let x = x1;
    let y = y1;
    const clear = (px, py) => {
      for (let oy = -Math.floor(widthRoad / 2); oy <= Math.floor(widthRoad / 2); oy += 1) {
        for (let ox = -Math.floor(widthRoad / 2); ox <= Math.floor(widthRoad / 2); ox += 1) {
          const t = get(px + ox, py + oy);
          if (t === TILE.TREE || t === TILE.WATER || t === TILE.WALL) set(px + ox, py + oy, TILE.DIRT);
        }
      }
    };
    while (x !== x2 || y !== y2) {
      clear(x, y);
      if (x !== x2 && (y === y2 || rng() < 0.55)) x += Math.sign(x2 - x);
      else if (y !== y2) y += Math.sign(y2 - y);
    }
    clear(x2, y2);
  };

  carve(40, 50, 40, 26, 3);       // eje norte-sur dentro de la ciudad
  carve(30, 40, 50, 40, 3);       // eje este-oeste
  carve(40, 50, 44, 57, 2);       // salida sur -> slimes
  carve(44, 57, 61, 61, 2);       // slimes -> golem
  carve(40, 30, 29, 23, 2);       // salida norte -> ratas
  carve(29, 23, 55, 24, 2);
  carve(50, 40, 62, 40, 2);       // salida este -> orcos
  carve(30, 40, 18, 34, 2);       // salida oeste -> arena
  carve(18, 34, 18, 15, 2);

  // Muros de la ciudad con 4 puertas.
  for (let x = ZONES.safe.x1; x <= ZONES.safe.x2; x += 1) {
    set(x, ZONES.safe.y1, TILE.WALL);
    set(x, ZONES.safe.y2, TILE.WALL);
  }
  for (let y = ZONES.safe.y1; y <= ZONES.safe.y2; y += 1) {
    set(ZONES.safe.x1, y, TILE.WALL);
    set(ZONES.safe.x2, y, TILE.WALL);
  }
  for (let x = 39; x <= 41; x += 1) {
    set(x, ZONES.safe.y1, TILE.STONE);
    set(x, ZONES.safe.y2, TILE.STONE);
  }
  for (let y = 39; y <= 41; y += 1) {
    set(ZONES.safe.x1, y, TILE.STONE);
    set(ZONES.safe.x2, y, TILE.STONE);
  }

  // Fuente central y pequeños edificios decorativos (bloqueados).
  for (let y = 35; y <= 36; y += 1) {
    for (let x = 39; x <= 41; x += 1) set(x, y, TILE.WATER);
  }
  for (let y = 33; y <= 34; y += 1) {
    for (let x = 32; x <= 34; x += 1) set(x, y, TILE.WALL);
    for (let x = 46; x <= 48; x += 1) set(x, y, TILE.WALL);
  }
  set(33, 35, TILE.STONE);
  set(47, 35, TILE.STONE);

  // Limpiar puntos críticos (spawn, NPCs, centros de spawn de monstruos).
  const clearArea = (cx, cy, r) => {
    for (let y = cy - r; y <= cy + r; y += 1) {
      for (let x = cx - r; x <= cx + r; x += 1) {
        const t = get(x, y);
        if (t === TILE.TREE || t === TILE.WATER || t === TILE.WALL) set(x, y, isSafeZone(x, y) ? TILE.STONE : TILE.DIRT);
      }
    }
  };
  clearArea(SPAWN_POINT.x, SPAWN_POINT.y, 2);
  for (const npc of NPCS) clearArea(npc.x, npc.y, 1);
  for (const zone of SPAWN_ZONES) clearArea(zone.x, zone.y, 2);

  // Borde del mundo intransitable.
  for (let x = 0; x < width; x += 1) {
    set(x, 0, TILE.TREE);
    set(x, height - 1, TILE.TREE);
  }
  for (let y = 0; y < height; y += 1) {
    set(0, y, TILE.TREE);
    set(width - 1, y, TILE.TREE);
  }

  // Reabrir caminos por si algún árbol cayó sobre ellos.
  carve(40, 50, 40, 26, 3);
  carve(30, 40, 50, 40, 3);
  carve(40, 50, 44, 57, 2);
  carve(44, 57, 61, 61, 2);
  carve(40, 30, 29, 23, 2);
  carve(30, 40, 18, 34, 2);
  carve(18, 34, 18, 15, 2);

  return { width, height, seed, tiles };
}

/** Elige una celda transitable cercana al centro de spawn. */
export function findSpawnTile(world, cx, cy, radius, rng = Math.random) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = cx + Math.floor(rng() * (radius * 2 + 1)) - radius;
    const y = cy + Math.floor(rng() * (radius * 2 + 1)) - radius;
    if (isWalkable(world, x, y)) return { x, y };
  }
  return { x: cx, y: cy };
}

/** Color base para pintar un tile en el cliente (variación determinista). */
export function tileRenderColor(tile, x, y) {
  const palette = TILE_COLORS[tile] ?? TILE_COLORS[0];
  const hash = Math.abs((x * 73856093) ^ (y * 19349663)) % palette.length;
  return palette[hash];
}
