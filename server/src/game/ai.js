import { isSafeZone, findPath } from '../../shared/index.js';
import { monsterAttack, monsterRangedAttack } from './combat.js';

/**
 * IA simple y barata: patrulla -> aggro -> persecucion -> ataque -> leashing.
 * Se ejecuta dentro del tick autoritativo (20 Hz), pero las decisiones de IA
 * (buscar objetivos, verificar leashing, cambiar estados) se throttle a
 * AI_TICK_MS para aliviar CPU.
 */
const reservedTiles = new Set();
const tileKeyLocal = (x, y) => `${Math.round(x)},${Math.round(y)}`;

const CARDINALS = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
];

export const AI_TICK_MS = 100;          // decisiones de IA cada 100ms
export const MAX_LEASH_DISTANCE = 15;
export const AGGRO_RADIUS = 5;
export const SLEEP_RADIUS = 18;         // hibernacion: sin jugadores en 18 tiles

const MAX_LEASH_DISTANCE_SQ = MAX_LEASH_DISTANCE * MAX_LEASH_DISTANCE;
const SLEEP_RADIUS_SQ = SLEEP_RADIUS * SLEEP_RADIUS;

export function updateMonsters(game, now) {
  if (!game || !game.world) return;
  if (!Number.isFinite(game.lastAiTickAt)) game.lastAiTickAt = -Infinity;
  const runAI = (now - game.lastAiTickAt) >= AI_TICK_MS;
  if (runAI) game.lastAiTickAt = now;

  reservedTiles.clear();
  let monsterIndex = 0;
  for (const monster of game.world.monsters.values()) {
    const mi = monsterIndex++;
    if (!monster.alive) {
      if (monster.spawnerId) continue;
      if (now >= monster.respawnAt) {
        monster.reset(now, monster.spawn, game.world);
        game.world.refreshEntity?.(monster);
        monster.dir = 'down';
        monster.slot = null;
        monster.state = 'idle';
        monster.sleeping = false;
        game.broadcastNear(monster.x, monster.y, game.config?.aoiRadius ?? 20, {
          type: 'respawn', id: monster.id, kind: 'monster', x: monster.x, y: monster.y,
        });
      }
      continue;
    }

    if (!monster.state) monster.state = 'idle';
    if (monster.sleeping == null) monster.sleeping = false;

    // ── SLEEP MODE: culling espacial para mobs lejanos ───────────────
    if (monster.state === 'sleep' || monster.sleeping) {
      monster.state = 'sleep';
      monster.sleeping = true;
      // Despertar instantaneo cuando un jugador entra en el sector.
      const nearby = game.world.playersNear
        ? game.world.playersNear(monster.x, monster.y, SLEEP_RADIUS)
        : [];
      if (nearby && nearby.length > 0) {
        monster.sleeping = false;
        monster.state = 'idle';
        monster.nextPatrolAt = now + 500;
        monster.nextMoveAt = now;
      } else {
        // Dormido: sin movimiento, pathfinding ni IA de busqueda.
        continue;
      }
    }

    // Round-robin / time-slicing: solo 25% de los mobs activos por tick.
    if (mi % 4 !== ((game.tickCount ?? 0) % 4)) continue;

    const def = monster.def;

    const hx = monster.homeX ?? monster.spawnX ?? monster.x;
    const hy = monster.homeY ?? monster.spawnY ?? monster.y;

    // Estado RETURNING: ignora jugadores y vuelve al spawn.
    if (monster.state === 'returning') {
      const dxh = monster.x - hx;
      const dyh = monster.y - hy;
      const distHomeSq = dxh * dxh + dyh * dyh;
      if (distHomeSq < 1) {
        monster.state = 'idle';
        monster.targetId = null;
        monster.slot = null;
        monster.hp = monster.maxHp;
        monster.sleeping = false;
        continue;
      }
      if (now >= monster.nextMoveAt) {
        const sx = Math.sign(hx - monster.x);
        const sy = Math.sign(hy - monster.y);
        moveMonster(game.world, monster, sx, sy, now);
      }
      continue;
    }

    // Estado CHASING: persigue al target; verifica leash.
    if (monster.state === 'chasing') {
      const dxh = monster.x - hx;
      const dyh = monster.y - hy;
      const leashDistSq = dxh * dxh + dyh * dyh;
      if (leashDistSq > MAX_LEASH_DISTANCE_SQ) {
        monster.state = 'returning';
        monster.targetId = null;
        monster.slot = null;
        monster.hp = monster.maxHp;
        continue;
      }

      let target = monster.targetId ? game.world.getPlayer(monster.targetId) : null;
      if (target && (target.isDead || isSafeZone(Math.round(target.x), Math.round(target.y)))) target = null;
      if (target && (target.x - hx) ** 2 + (target.y - hy) ** 2 > 22 ** 2) target = null;

      if (!target) {
        monster.state = 'idle';
        monster.targetId = null;
        monster.slot = null;
        continue;
      }

      const dx = target.x - monster.x;
      const dy = target.y - monster.y;
      const distSq = dx * dx + dy * dy;

      const isRanged = Boolean(def?.isRanged);
      const attackRange = Number(def?.attackRange ?? (isRanged ? 4 : 1.65));
      const attackRangeSq = attackRange * attackRange;

      if (isRanged && distSq <= attackRangeSq) {
        // A distancia: detenerse y disparar.
        monster.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        monsterRangedAttack(game, monster, target, now);
      } else if (distSq <= 1.65 ** 2 && !isRanged) {
        monster.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (now >= monster.nextAttackAt) monsterAttack(game, monster, target, now);
      } else if (now >= monster.nextMoveAt) {
        // Movimiento directo con deslizamiento simple (sin A*/BFS).
        const sx = Math.sign(target.x - monster.x);
        const sy = Math.sign(target.y - monster.y);
        moveMonster(game.world, monster, sx, sy, now);
      }
      continue;
    }

    // Estado IDLE: patrulla y detecta jugadores en aggro radius.
    monster.targetId = null;
    monster.slot = null;

    // Sleep transition: si no hay jugadores en radio amplio, dormir.
    const nearPlayers = game.world.playersNear
      ? game.world.playersNear(monster.x, monster.y, SLEEP_RADIUS)
      : [];
    if (!nearPlayers || nearPlayers.length === 0) {
      monster.state = 'sleep';
      monster.sleeping = true;
      continue;
    }

    // Busqueda de objetivos solo en ticks de IA.
    if (runAI) {
      const aggroRadius = def?.isRanged ? Number(def.aggroRange ?? 9) : AGGRO_RADIUS;
      const found = game.world.nearestPlayer(monster.x, monster.y, aggroRadius);
      if (found && !isSafeZone(Math.round(found.x), Math.round(found.y))) {
        monster.targetId = found.id;
        monster.state = 'chasing';
        continue;
      }
    }

    if (now >= monster.nextPatrolAt) {
      monster.nextPatrolAt = now + 1800 + Math.random() * 2800;
      if (Math.random() < 0.75) {
        const dx = Math.floor(Math.random() * 3) - 1;
        const dy = Math.floor(Math.random() * 3) - 1;
        if (now >= monster.nextMoveAt && (dx !== 0 || dy !== 0)) {
          moveMonster(game.world, monster, dx, dy, now);
        }
      }
    }
  }
}

function buildNav(world, selfId) {
  const tiles = Uint8Array.from(world.map.tiles);
  const nav = { width: world.width, height: world.height, tiles };
  const block = (x, y) => {
    if (x >= 0 && y >= 0 && x < nav.width && y < nav.height) tiles[y * nav.width + x] = 4;
  };
  for (const k of world.blocked) {
    const [x, y] = k.split(',').map((v) => Number.parseInt(v, 10));
    block(x, y);
  }
  for (const [id, player] of world.players) {
    if (player.isDead) continue;
    block(Math.round(player.x), Math.round(player.y));
  }
  for (const [id, monster] of world.monsters) {
    if (id === selfId || !monster.alive) continue;
    block(Math.round(monster.x), Math.round(monster.y));
  }
  return nav;
}

function isSlotOccupied(world, slot, selfId) {
  for (const [id, monster] of world.monsters) {
    if (id === selfId || !monster.alive) continue;
    if (Math.round(monster.x) === slot.x && Math.round(monster.y) === slot.y) return true;
  }
  for (const [id, player] of world.players) {
    if (player.isDead) continue;
    if (Math.round(player.x) === slot.x && Math.round(player.y) === slot.y) return true;
  }
  if (reservedTiles.has(tileKeyLocal(slot.x, slot.y))) return true;
  return false;
}

function moveMonster(world, monster, dx, dy, now) {
  const options = [[dx, dy], [dx, 0], [0, dy]];
  for (const [ox, oy] of options) {
    if (ox === 0 && oy === 0) continue;
    const nx = monster.x + ox;
    const ny = monster.y + oy;
    if (!world.canWalk(nx, ny)) continue;
    if (world.isTileOccupied(nx, ny, monster.id)) continue;
    if (reservedTiles.has(tileKeyLocal(nx, ny))) continue;
    world.moveEntity(monster, nx, ny);
    reservedTiles.add(tileKeyLocal(nx, ny));
    monster.dir = Math.abs(ox) > Math.abs(oy) ? (ox > 0 ? 'right' : 'left') : (oy > 0 ? 'down' : 'up');
    const diagonal = ox !== 0 && oy !== 0;
    monster.nextMoveAt = now + monster.def.moveMs * (diagonal ? 1.25 : 1);
    return;
  }
  monster.nextMoveAt = now + 700;
}