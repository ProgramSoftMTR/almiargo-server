import {
  MAP_HEIGHT,
  MAP_WIDTH,
  NPCS,
  SPAWN_POINT,
  SPAWN_ZONES,
  WORLD_SEED,
  ZONES,
  CITIES,
} from './config.js';

/**
 * Generación determinista del mapa (misma semilla en server y cliente).
 * El terreno nunca viaja por la red: sólo se envía la semilla al autenticar.
 *
 * Capas (tile ids):
 *  0 grass | 1 dirt | 2 stone | 3 water | 4 tree | 5 wall | 6 sand | 7 flowers
 */

export const TILE = Object.freeze({
  GRASS: 0,        // Pradera (Grassland)
  DIRT: 1,
  STONE: 2,
  ROCK: 17,        // Roca en pradera (base de pradera)
  WATER: 3,
  TREE: 4,         // Árbol normal
  WALL: 5,
  SAND: 6,         // Playa/Arena
  FLOWERS: 7,
  SWAMP: 8,        // Pantano
  MOUNTAIN: 9,     // Montaña rocosa
  SNOW: 10,        // Nevado
  FOREST: 11,      // Bosque (suelo)
  TREE_PALM: 12,   // Palmera
  TREE_PINE: 13,   // Pino nevado
  TREE_ACACIA: 14, // Acacia
  TREE_DEAD: 15,    // Árbol muerto/manglar
  SAVANNA: 16,     // Sabana
  CITY: 18,        // Suelo transitable de ciudad
  PATH: 19,        // Camino principal
  PLAZA: 20,       // Plaza transitable
  STUMP: 21,       // Tocón de árbol talado
});

export const TILE_COLORS = Object.freeze({
  0: [0x3d6b3a, 0x356236, 0x447540],   // grassland
  1: [0x6a5438, 0x5f4c33, 0x755d3d],
  2: [0x6b6862, 0x625f5a, 0x74716a],
  3: [0x2b5680, 0x2f5d8a, 0x274c73],
  4: [0x1e4427, 0x24502c, 0x193a21],
  5: [0x4b4540, 0x554e48, 0x403b37],
  6: [0xc9b27a, 0xbea46c, 0xd4be86],   // beach
  7: [0x3d6b3a, 0x447540, 0x3a6537],
  8: [0x2f4a3a, 0x2a4234, 0x35523f],   // swamp
  9: [0x5a5a5a, 0x505050, 0x646464],   // mountain
  10: [0xdfe7f0, 0xd2dbe6, 0xe8eef5],  // snow
  11: [0x2a4a2a, 0x254325, 0x305530],  // forest floor
  12: [0x1e4427, 0x24502c, 0x193a21],  // palm
  13: [0x1a3a24, 0x20442b, 0x163320],  // pine
  14: [0x3a5a2a, 0x335224, 0x426330],  // acacia
  15: [0x3a322a, 0x332c25, 0x42382f],  // dead tree
  16: [0xb9a05a, 0xaf9450, 0xc4aa64],  // savanna
  17: [0x3d6b3a, 0x356236, 0x447540],  // rock prairie
  18: [0x3d6b3a, 0x356236, 0x447540],  // city transitable
  19: [0x3d6b3a, 0x356236, 0x447540],  // path
  20: [0x3d6b3a, 0x356236, 0x447540],  // plaza
  21: [0x3d6b3a, 0x356236, 0x447540],  // stump
});

export function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return TILE.WALL;
  return world.tiles[y * world.width + x];
}

export function isWalkableTile(tile) {
  return tile !== TILE.WATER && tile !== TILE.TREE && tile !== TILE.TREE_PALM
    && tile !== TILE.TREE_PINE && tile !== TILE.TREE_ACACIA && tile !== TILE.TREE_DEAD
    && tile !== TILE.WALL;
}

export function isWalkable(world, x, y) {
  return isWalkableTile(tileAt(world, x, y));
}

export function isCityAt(x, y) {
  return (CITIES || []).find((c) => {
    const r = c.radius ?? 10;
    return x >= c.x - r && x <= c.x + r && y >= c.y - r && y <= c.y + r;
  }) || null;
}
export function isSafeZone(x, y) {
  const city = isCityAt(x, y);
  if (city) return !!city.safeZone;
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

function makePerlin(seed) {
  const perm = new Uint8Array(256);
  const rng = mulberry32(seed);
  for (let i = 0; i < 256; i += 1) perm[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i += 1) p[i] = perm[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  const grad = (hash, x, y) => {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };
  return function perlin(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

function fbm(perlin, x, y, octaves, persistence, scale) {
  let total = 0;
  let amp = 1;
  let freq = scale;
  let max = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += perlin(x * freq, y * freq) * amp;
    max += amp;
    amp *= persistence;
    freq *= 2;
  }
  return (total / max + 1) / 2; // 0..1
}

function biomeTile(pe, pm, pt, x, y) {
  const e = fbm(pe, x, y, 6, 0.5, 0.006);
  const m = fbm(pm, x, y, 4, 0.5, 0.01);
  const t = fbm(pt, x, y, 4, 0.5, 0.008);
  if (e < 0.30) return TILE.WATER;
  if (e < 0.34) return TILE.SAND;      // playa
  if (e > 0.78) return t < 0.45 ? TILE.SNOW : TILE.MOUNTAIN;
  if (m > 0.62) return (t < 0.45) ? TILE.SWAMP : TILE.FOREST;
  if (m < 0.32 && t > 0.55) return TILE.SAVANNA;
  return TILE.GRASS;
}

export function generateWorld(seed = WORLD_SEED) {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  const tiles = new Uint8Array(width * height).fill(TILE.GRASS);

  // Biomas organicos (Perlin multi-octava) para un mapa masivo variado.
  const perlinElev = makePerlin(seed);
  const perlinMoist = makePerlin(seed + 101);
  const perlinTemp = makePerlin(seed + 202);
  const perlinDensity = makePerlin(seed + 303);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tiles[y * width + x] = biomeTile(perlinElev, perlinMoist, perlinTemp, x, y);
    }
  }

  // Segunda capa: follaje/árboles en clusters por bioma.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const tile = tiles[y * width + x];
      if (tile === TILE.WATER || tile === TILE.SAND || tile === TILE.MOUNTAIN || tile === TILE.WALL) continue;
      const d = (perlinDensity(x * 0.05, y * 0.05) + 1) / 2;
      let treeTile = null;
      if (tile === TILE.FOREST && d > 0.42) treeTile = TILE.TREE;
      else if (tile === TILE.SNOW && d > 0.55) treeTile = TILE.TREE_PINE;
      else if (tile === TILE.SAND && d > 0.78) {
        let nearWater = false;
        for (let oy = -2; oy <= 2 && !nearWater; oy += 1) {
          for (let ox = -2; ox <= 2; ox += 1) {
            if (tileAt({ width, height, tiles }, x + ox, y + oy) === TILE.WATER) { nearWater = true; break; }
          }
        }
        if (!nearWater && !isSafeZone(x, y) && !isPvPZone(x, y)) treeTile = TILE.TREE_PALM;
      }
      else if (tile === TILE.SAVANNA && d > 0.62) treeTile = TILE.TREE_ACACIA;
      else if (tile === TILE.SWAMP && d > 0.5) treeTile = TILE.TREE_DEAD;
      else if (tile === TILE.GRASS && d > 0.72) treeTile = TILE.TREE;
      if (treeTile) tiles[y * width + x] = treeTile;
    }
  }
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

  // Sin lagos cerrados: el agua solo aparece como océano en los bordes.

  // Arena PvP (noroeste) y ciudad (centro).
  for (let y = ZONES.pvp.y1; y <= ZONES.pvp.y2; y += 1) {
    for (let x = ZONES.pvp.x1; x <= ZONES.pvp.x2; x += 1) {
      const border = x === ZONES.pvp.x1 || x === ZONES.pvp.x2 || y === ZONES.pvp.y1 || y === ZONES.pvp.y2;
      set(x, y, border ? TILE.DIRT : TILE.SAND);
    }
  }

  // Ciudades modulares: relleno de piedra para cada ciudad segura.
  for (const city of (CITIES || [])) {
    const r = city.radius ?? 10;
    for (let y = city.y - r; y <= city.y + r; y += 1) {
      for (let x = city.x - r; x <= city.x + r; x += 1) set(x, y, TILE.STONE);
    }
  }

  // Árboles (clusters) fuera de ciudad y arena, con espaciado para evitar bloques pegados.
  for (let i = 0; i < 420; i += 1) {
    const cx = 1 + Math.floor(rng() * (width - 2));
    const cy = 1 + Math.floor(rng() * (height - 2));
    if (isSafeZone(cx, cy) || isPvPZone(cx, cy)) continue;
    // Evita muros cerrados de arboles pegados al perimetro urbano.
    let nearCity = false;
    for (const city of (CITIES || [])) {
      const r = (city.radius ?? 10) + 2;
      if (Math.max(Math.abs(cx - city.x), Math.abs(cy - city.y)) <= r) { nearCity = true; break; }
    }
    if (nearCity) continue;
    const cluster = 1 + Math.floor(rng() * 2);
    for (let j = 0; j < cluster; j += 1) {
      const x = cx + Math.floor(rng() * 3) - 1;
      const y = cy + Math.floor(rng() * 3) - 1;
      if (isSafeZone(x, y) || isPvPZone(x, y)) continue;
      let nearCityTile = false;
      for (const city of (CITIES || [])) {
        const r = (city.radius ?? 10) + 2;
        if (Math.max(Math.abs(x - city.x), Math.abs(y - city.y)) <= r) { nearCityTile = true; break; }
      }
      if (nearCityTile) continue;
      // Evitar árboles adyacentes (sin espacio).
      let adjacentTree = false;
      for (let oy = -1; oy <= 1 && !adjacentTree; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          if (get(x + ox, y + oy) === TILE.TREE || get(x + ox, y + oy) === TILE.TREE_PALM ||
              get(x + ox, y + oy) === TILE.TREE_PINE || get(x + ox, y + oy) === TILE.TREE_ACACIA ||
              get(x + ox, y + oy) === TILE.TREE_DEAD) { adjacentTree = true; break; }
        }
      }
      if (adjacentTree) continue;
      if (get(x, y) === TILE.GRASS || get(x, y) === TILE.DIRT || get(x, y) === TILE.FLOWERS) {
        if (rng() < 0.62) set(x, y, TILE.TREE);
      }
    }
  }

  // Rocas en pradera (densidad muy baja y separadas).
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const t = get(x, y);
      if (t !== TILE.GRASS && t !== TILE.DIRT && t !== TILE.FLOWERS) continue;
      if (isSafeZone(x, y) || isPvPZone(x, y)) continue;
      // Separacion minima de 4 tiles entre rocas.
      let tooClose = false;
      for (let oy = -3; oy <= 3 && !tooClose; oy += 1) {
        for (let ox = -3; ox <= 3; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          if (get(x + ox, y + oy) === TILE.ROCK) { tooClose = true; break; }
        }
      }
      if (tooClose) continue;
      if (rng() < 0.008) set(x, y, TILE.ROCK);
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

  carve(100, 110, 100, 90, 3);    // eje norte-sur dentro de la ciudad
  carve(90, 100, 110, 100, 3);    // eje este-oeste
  carve(100, 110, 75, 75, 2);     // salida suroeste -> slimes
  carve(75, 75, 160, 160, 2);     // slimes -> goblins
  carve(100, 90, 125, 75, 2);     // salida noreste -> ratas
  carve(125, 75, 140, 100, 2);
  carve(110, 100, 140, 100, 2);   // salida este -> orcos
  carve(90, 100, 40, 40, 2);      // salida oeste -> arena
  carve(40, 40, 40, 20, 2);

  // Muros de cada ciudad con 4 puertas.
  for (const city of (CITIES || [])) {
    const r = city.radius ?? 10;
    const x1 = city.x - r, x2 = city.x + r, y1 = city.y - r, y2 = city.y + r;
    for (let x = x1; x <= x2; x += 1) {
      set(x, y1, TILE.WALL);
      set(x, y2, TILE.WALL);
    }
    for (let y = y1; y <= y2; y += 1) {
      set(x1, y, TILE.WALL);
      set(x2, y, TILE.WALL);
    }
    // puertas (3 tiles) en los 4 lados
    for (let d = -1; d <= 1; d += 1) {
      set(city.x + d, y1, TILE.STONE);
      set(city.x + d, y2, TILE.STONE);
      set(x1, city.y + d, TILE.STONE);
      set(x2, city.y + d, TILE.STONE);
    }
  }

  // Fuente central y pequeños edificios decorativos (bloqueados).
  for (let y = 95; y <= 96; y += 1) {
    for (let x = 99; x <= 101; x += 1) set(x, y, TILE.WATER);
  }
  for (let y = 93; y <= 94; y += 1) {
    for (let x = 92; x <= 94; x += 1) set(x, y, TILE.WALL);
    for (let x = 106; x <= 108; x += 1) set(x, y, TILE.WALL);
  }
  set(93, 95, TILE.STONE);
  set(107, 95, TILE.STONE);

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

  // Océano y playa en los bordes del mapa (intransitable el agua profunda).
  const oceanW = 8;
  const beachW = 12;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (d < oceanW) set(x, y, TILE.WATER);
      else if (d < oceanW + beachW) set(x, y, TILE.SAND);
    }
  }

  // Palmeras en la playa (borde exterior): pass determinista sobre arena,
  // respetando distancia a agua/tierra/caminos y espaciado mínimo.
  const palmHash = (px, py) => {
    const n = Math.sin(px * 127.1 + py * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (get(x, y) !== TILE.SAND) continue;
      // Al menos 1 tile de distancia al agua y a tierra/caminos.
      let edge = false;
      for (let oy = -1; oy <= 1 && !edge; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          const t = get(x + ox, y + oy);
          if (t === TILE.WATER || t === TILE.DIRT || t === TILE.STONE || t === TILE.WALL || t === TILE.GRASS) {
            edge = true; break;
          }
        }
      }
      if (edge) continue;
      if (isSafeZone(x, y) || isPvPZone(x, y)) continue;
      // Espaciado mínimo 2-3 tiles entre palmeras.
      let tooClose = false;
      for (let oy = -4; oy <= 4 && !tooClose; oy += 1) {
        for (let ox = -4; ox <= 4; ox += 1) {
          if (ox === 0 && oy === 0) continue;
          if (get(x + ox, y + oy) === TILE.TREE_PALM) { tooClose = true; break; }
        }
      }
      if (tooClose) continue;
      if (palmHash(x, y) > 0.81) set(x, y, TILE.TREE_PALM);
    }
  }

  // Reabrir caminos por si algún árbol cayó sobre ellos.
  carve(100, 110, 100, 90, 3);
  carve(90, 100, 110, 100, 3);
  carve(100, 110, 75, 75, 2);
  carve(75, 75, 160, 160, 2);
  carve(100, 90, 125, 75, 2);
  carve(90, 100, 40, 40, 2);
  carve(40, 40, 40, 20, 2);

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
