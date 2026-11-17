import { MONSTERS, isWalkable } from '../../shared/index.js';
import { Monster } from './monster.js';

const tileKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;

/**
 * Spawner autoritativo por zona.
 * Configuración:
 *  - zoneRect: { startX, startY, width, height }
 *  - mobType: id del monstruo (MONSTERS)
 *  - maxMobs: límite simultáneo en el área
 *  - respawnTime: tiempo en ms para reaparecer un mob
 */
export class Spawner {
  constructor({ id, zoneRect, mobType, maxMobs, respawnTime = 8000, world = null } = {}) {
    this.id = id ?? `spawner_${mobType}_${Math.random().toString(36).slice(2, 8)}`;
    this.zoneRect = {
      startX: Number(zoneRect?.startX ?? 0),
      startY: Number(zoneRect?.startY ?? 0),
      width: Number(zoneRect?.width ?? 1),
      height: Number(zoneRect?.height ?? 1),
    };
    this.mobType = mobType;
    this.maxMobs = Math.max(1, Number(maxMobs ?? 1));
    this.respawnTime = Math.max(250, Number(respawnTime ?? 8000));
    this.world = world;
    this.nextSpawnAt = 0;
    this.spawnedIds = new Set();
  }

  bounds() {
    const { startX, startY, width, height } = this.zoneRect;
    return {
      x1: startX,
      y1: startY,
      x2: startX + Math.max(1, width) - 1,
      y2: startY + Math.max(1, height) - 1,
    };
  }

  contains(x, y) {
    const { x1, y1, x2, y2 } = this.bounds();
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  }

  /** Cuenta mobs vivos de este spawner dentro de la zona. */
  countAlive(world) {
    let count = 0;
    for (const monster of world.monsters.values()) {
      if (!monster || !monster.alive) continue;
      if (monster.defId !== this.mobType) continue;
      if (monster.spawnerId !== this.id) continue;
      const tx = Math.round(monster.x);
      const ty = Math.round(monster.y);
      if (this.contains(tx, ty)) count += 1;
    }
    return count;
  }

  /** Encuentra una baldosa transitable y libre dentro de la zona. */
  findSpawnTile(world) {
    const { x1, y1, x2, y2 } = this.bounds();
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const x = x1 + Math.floor(Math.random() * (x2 - x1 + 1));
      const y = y1 + Math.floor(Math.random() * (y2 - y1 + 1));
      if (!world.isInside(x, y)) continue;
      if (!world.canWalk(x, y)) continue;
      if (world.blocked.has(tileKey(x, y))) continue;
      if (world.isTileOccupied(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  /** Intenta generar un mob si hay hueco y ha pasado el tiempo de respawn. */
  update(world, now) {
    const w = world ?? this.world;
    if (!w) return 0;
    const def = MONSTERS[this.mobType];
    if (!def) return 0;

    // Limpieza de mobs muertos gestionados por este spawner.
    for (const [id, monster] of [...w.monsters.entries()]) {
      if (!monster || monster.spawnerId !== this.id) continue;
      if (monster.alive) continue;
      if (now - (monster.deathAt ?? 0) >= (MONSTERS[monster.defId]?.corpseMs ?? 400)) {
        w.removeMonster(id);
        this.spawnedIds.delete(id);
      }
    }

    let spawned = 0;
    let alive = this.countAlive(w);
    while (alive < this.maxMobs && now >= this.nextSpawnAt) {
      const tile = this.findSpawnTile(w);
      if (!tile) break;
      const monster = new Monster({
        id: `m_${++w.monsterCounter}`,
        defId: this.mobType,
        spawn: tile,
        spawnerId: this.id,
      });
      monster.nextMoveAt = now + Math.random() * 1000;
      w.addMonster(monster);
      this.spawnedIds.add(monster.id);
      alive += 1;
      spawned += 1;
      this.nextSpawnAt = now + this.respawnTime;
    }
    // Si ya está al máximo, programar siguiente intento tras respawnTime.
    if (alive >= this.maxMobs && this.nextSpawnAt === 0) {
      this.nextSpawnAt = now + this.respawnTime;
    }
    return spawned;
  }
}

export function createSpawnersFromZones(zones, world = null) {
  const list = [];
  for (const zone of zones ?? []) {
    const rect = zone.zoneRect ?? {
      startX: zone.startX,
      startY: zone.startY,
      width: zone.width,
      height: zone.height,
    };
    const mobType = zone.mobType ?? zone.monsterId;
    if (!mobType) continue;
    list.push(new Spawner({
      id: zone.id ?? zone.name ?? `${mobType}_spawner`,
      zoneRect: rect,
      mobType,
      maxMobs: zone.maxMobs ?? zone.count ?? 5,
      respawnTime: zone.respawnTime ?? 8000,
      world,
    }));
  }
  return list;
}