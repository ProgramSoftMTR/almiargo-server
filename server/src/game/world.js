import {
  ENTITY_KIND,
  MONSTERS,
  NPCS,
  SPAWN_ZONES,
  SPAWN_POINT,
  WORLD_SEED,
  findSpawnTile,
  generateWorld,
  isWalkable,
} from '../../shared/index.js';
import { Monster } from './monster.js';
import { SpatialHash } from './spatialHash.js';

const tileKey = (x, y) => `${Math.round(x)},${Math.round(y)}`;
const DEFAULT_VIEW_HALF_W = 18;
const DEFAULT_VIEW_HALF_H = 11;

/**
 * Mundo autoritativo. Contiene el terreno, entidades, bolsas de loot y tiendas.
 * Las colisiones son estáticas (terreno + NPCs + puestos) para mantener el tick barato.
 */
export class World {
  constructor({ seed = WORLD_SEED } = {}) {
    this.seed = seed;
    this.map = generateWorld(seed);
    this.width = this.map.width;
    this.height = this.map.height;
    this.entities = new Map();   // jugadores + monstruos + npcs
    this.players = new Map();    // subset de jugadores
    this.monsters = new Map();
    this.npcs = new Map();
    this.bags = new Map();
    this.stalls = new Map();
    this.blocked = new Set();    // NPCs y tiendas bloquean su tile
    this.monsterCounter = 0;
    this.bagCounter = 0;
    this.spawnPoint = { ...SPAWN_POINT };
    // Índices espaciales: interés de snapshots y consultas de IA/comercio.
    this.entityIndex = new SpatialHash(8);
    this.bagIndex = new SpatialHash(8);
    this.stallIndex = new SpatialHash(8);
    this.setupNpcs();
  }

  setupNpcs() {
    for (const def of NPCS) {
      const npc = {
        id: def.id,
        kind: ENTITY_KIND.NPC,
        name: def.name,
        x: def.x,
        y: def.y,
        dir: 'down',
        shop: def.shop,
        def,
      };
      this.npcs.set(npc.id, npc);
      this.entities.set(npc.id, npc);
      this.entityIndex.insert(npc);
      this.blocked.add(tileKey(npc.x, npc.y));
    }
  }

  isInside(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Movimiento válido: dentro del mapa, tile transitable y sin NPC/puesto. */
  canWalk(x, y) {
    const tx = Math.round(x);
    const ty = Math.round(y);
    if (!this.isInside(tx, ty)) return false;
    if (this.blocked.has(tileKey(tx, ty))) return false;
    return isWalkable(this.map, tx, ty);
  }

  addPlayer(player) {
    this.players.set(player.id, player);
    this.entities.set(player.id, player);
    this.entityIndex.insert(player);
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) this.entityIndex.remove(player);
    this.players.delete(playerId);
    this.entities.delete(playerId);
  }

  addMonster(monster) {
    this.monsters.set(monster.id, monster);
    this.entities.set(monster.id, monster);
    this.entityIndex.insert(monster);
  }

  removeMonster(monsterId) {
    const monster = this.monsters.get(monsterId);
    if (monster) this.entityIndex.remove(monster);
    this.monsters.delete(monsterId);
    this.entities.delete(monsterId);
  }

  /**
   * Único punto de escritura de posición para entidades indexadas. Mantiene el
   * spatial hash sincronizado sin recorrer el mapa en cada snapshot.
   */
  moveEntity(entity, x, y) {
    entity.x = x;
    entity.y = y;
    this.entityIndex.update(entity);
    return entity;
  }

  /** Reindexa una entidad que cambió de posición fuera de moveEntity. */
  refreshEntity(entity) {
    this.entityIndex.update(entity);
    return entity;
  }

  /** Reconstrucción completa (carga/teleport masivo); no se usa por tick. */
  rebuildSpatialIndexes() {
    this.entityIndex.rebuild(this.entities.values());
    this.bagIndex.rebuild(this.bags.values());
    this.stallIndex.rebuild(this.stalls.values());
  }

  spawnInitialMonsters(now) {
    for (const zone of SPAWN_ZONES) {
      const def = MONSTERS[zone.monsterId];
      if (!def) continue;
      const used = new Set();
      for (let i = 0; i < zone.count; i += 1) {
        let tile = findSpawnTile(this.map, zone.x, zone.y, zone.radius);
        let guard = 0;
        while ((used.has(tileKey(tile.x, tile.y)) || this.blocked.has(tileKey(tile.x, tile.y))) && guard < 50) {
          tile = findSpawnTile(this.map, zone.x, zone.y, zone.radius);
          guard += 1;
        }
        used.add(tileKey(tile.x, tile.y));
        const monster = new Monster({
          id: `m_${++this.monsterCounter}`,
          defId: zone.monsterId,
          spawn: tile,
        });
        monster.nextMoveAt = now + Math.random() * 1000;
        this.addMonster(monster);
      }
    }
    return this.monsters.size;
  }

  addBag(bag) {
    this.bags.set(bag.id, bag);
    this.bagIndex.insert(bag);
    return bag;
  }

  createBag({ x, y, ownerId = null, items = [], gold = 0, freeAt = 0, expiresAt = 0 }) {
    const bag = {
      id: `b_${++this.bagCounter}`,
      x: Math.round(x),
      y: Math.round(y),
      ownerId,
      items,
      gold,
      freeAt,
      expiresAt,
      createdAt: Date.now(),
      despawnTimeout: null,
    };
    return this.addBag(bag);
  }

  removeBag(bagId) {
    const bag = this.bags.get(bagId);
    if (bag) this.bagIndex.remove(bag);
    this.bags.delete(bagId);
  }

  addStall(stall) {
    this.stalls.set(stall.id, stall);
    this.stallIndex.insert(stall);
    this.blocked.add(tileKey(stall.x, stall.y));
    return stall;
  }

  removeStall(stallId) {
    const stall = this.stalls.get(stallId);
    if (stall) {
      this.stallIndex.remove(stall);
      this.blocked.delete(tileKey(stall.x, stall.y));
      this.stalls.delete(stallId);
    }
  }

  nearestPlayer(x, y, radius, excludeId = null, filter = null) {
    return this.entityIndex.nearest(x, y, radius, (entity) => (
      entity.kind === ENTITY_KIND.PLAYER
      && entity.id !== excludeId
      && !entity.isDead
      && (!filter || filter(entity))
    ));
  }

  playersNear(x, y, radius, excludeId = null) {
    return this.entityIndex.queryCircle(x, y, radius, (entity) => (
      entity.kind === ENTITY_KIND.PLAYER
      && entity.id !== excludeId
      && !entity.isDead
    ));
  }

  monstersNear(x, y, radius) {
    return this.entityIndex.queryCircle(x, y, radius, (entity) => (
      entity.kind === ENTITY_KIND.MONSTER && !entity.isDead
    ));
  }

  bagsNear(x, y, radius) {
    return this.bagIndex.queryCircle(x, y, radius);
  }

  stallsNear(x, y, radius) {
    return this.stallIndex.queryCircle(x, y, radius);
  }

  getEntity(id) {
    return this.entities.get(id) ?? null;
  }

  getPlayer(id) {
    return this.players.get(id) ?? null;
  }

  getMonster(id) {
    return this.monsters.get(id) ?? null;
  }

  /**
   * Snapshot geográfico para un jugador. Usa un rectángulo de interés
   * (viewport landscape + margen de interpolación), no el mapa completo.
   * El spatial hash hace que el coste dependa de las celdas visibles.
   */
  snapshotFor(
    player,
    halfW = DEFAULT_VIEW_HALF_W,
    halfH = DEFAULT_VIEW_HALF_H,
  ) {
    const viewW = Number.isFinite(halfW) ? Math.max(4, halfW) : DEFAULT_VIEW_HALF_W;
    const viewH = Number.isFinite(halfH) ? Math.max(4, halfH) : DEFAULT_VIEW_HALF_H;
    const minX = player.x - viewW;
    const maxX = player.x + viewW;
    const minY = player.y - viewH;
    const maxY = player.y + viewH;

    const entities = [];
    const nearby = this.entityIndex.queryRect(minX, minY, maxX, maxY, (entity) => (
      entity.id !== player.id
      && !(entity.kind === ENTITY_KIND.MONSTER && entity.isDead)
      && !(entity.kind === ENTITY_KIND.PLAYER && (entity.isDead || entity.invisible))
    ));
    for (const entity of nearby) {
      if (entity.kind === ENTITY_KIND.MONSTER) {
        entities.push(entity.toWire());
      } else if (entity.kind === ENTITY_KIND.PLAYER) {
        entities.push([
          entity.id, ENTITY_KIND.PLAYER,
          Math.round(entity.x * 100) / 100, Math.round(entity.y * 100) / 100,
          entity.dir, Math.max(0, Math.round((entity.hp / entity.maxHp) * 100)),
          entity.name, entity.skullActive ? entity.skull : 'none',
          entity.classId, entity.level, entity.nameColor ?? null, entity.outfit ?? null, entity.hasAxe ? 1 : 0,
          entity.equipment?.mano?.itemId ?? null,
        ]);
      } else {
        entities.push([
          entity.id, ENTITY_KIND.NPC, entity.x, entity.y, 'down', 100,
          entity.name, 'none', '', 0,
        ]);
      }
    }

    const bags = [];
    for (const bag of this.bagIndex.queryRect(minX, minY, maxX, maxY)) {
      bags.push({
        i: bag.id,
        x: bag.x,
        y: bag.y,
        o: bag.ownerId,
        g: bag.gold,
        n: bag.items.length,
        f: bag.freeAt,
        t: bag.expiresAt,
      });
    }

    const stalls = [];
    for (const stall of this.stallIndex.queryRect(minX, minY, maxX, maxY)) {
      stalls.push({
        i: stall.id,
        x: stall.x,
        y: stall.y,
        n: stall.ownerName,
        c: stall.items.length,
        on: !!stall.online,
      });
    }

    return { entities, bags, stalls };
  }

  findFreeAdjacent(x, y) {
    const dirs = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [dx, dy] of dirs) {
      if (this.canWalk(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return { ...this.spawnPoint };
  }
}
