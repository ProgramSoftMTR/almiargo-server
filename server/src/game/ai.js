import { isSafeZone, findPath } from '../../shared/index.js';
import { monsterAttack } from './combat.js';

/**
 * IA simple y barata: patrulla -> aggro -> persecucion -> ataque -> leashing.
 * Se ejecuta dentro del tick autoritativo (20 Hz).
 */
const reservedTiles = new Set();
const tileKeyLocal = (x, y) => `${Math.round(x)},${Math.round(y)}`;

const CARDINALS = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
];

const MAX_LEASH_DISTANCE = 15;
const AGGRO_RADIUS = 5;

export function updateMonsters(game, now) {
  reservedTiles.clear();
  for (const monster of game.world.monsters.values()) {
    if (!monster.alive) {
      if (monster.spawnerId) continue;
      if (now >= monster.respawnAt) {
        monster.reset(now, monster.spawn, game.world);
        game.world.refreshEntity?.(monster);
        monster.dir = 'down';
        monster.slot = null;
        monster.state = 'idle';
        game.broadcastNear(monster.x, monster.y, game.config?.aoiRadius ?? 20, {
          type: 'respawn', id: monster.id, kind: 'monster', x: monster.x, y: monster.y,
        });
      }
      continue;
    }

    if (!monster.state) monster.state = 'idle';
    const def = monster.def;
    const hx = monster.homeX ?? monster.spawnX ?? monster.x;
    const hy = monster.homeY ?? monster.spawnY ?? monster.y;

    // Estado RETURNING: ignora jugadores y vuelve al spawn.
    if (monster.state === 'returning') {
      const distHome = Math.hypot(monster.x - hx, monster.y - hy);
      if (distHome < 1) {
        monster.state = 'idle';
        monster.targetId = null;
        monster.slot = null;
        monster.hp = monster.maxHp;
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
      const leashDist = Math.hypot(monster.x - hx, monster.y - hy);
      if (leashDist > MAX_LEASH_DISTANCE) {
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

      if (distSq <= 1.65 ** 2) {
        monster.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (now >= monster.nextAttackAt) monsterAttack(game, monster, target, now);
      } else if (now >= monster.nextMoveAt) {
        const tx = Math.round(target.x);
        const ty = Math.round(target.y);
        const slots = CARDINALS
          .map(([ox, oy]) => ({ x: tx + ox, y: ty + oy }))
          .filter((s) => game.world.canWalk(s.x, s.y));

        if (monster.slot && !slots.some((s) => s.x === monster.slot.x && s.y === monster.slot.y)) {
          monster.slot = null;
        }
        if (monster.slot && isSlotOccupied(game.world, monster.slot, monster.id)) {
          monster.slot = null;
        }

        if (!monster.slot) {
          const free = slots
            .filter((s) => !isSlotOccupied(game.world, s, monster.id) && !reservedTiles.has(tileKeyLocal(s.x, s.y)))
            .sort((a, b) => (a.x - monster.x) ** 2 + (a.y - monster.y) ** 2 - ((b.x - monster.x) ** 2 + (b.y - monster.y) ** 2));
          if (free.length > 0) monster.slot = free[0];
        }

        if (monster.slot) {
          const nav = buildNav(game.world, monster.id);
          const path = findPath(nav, Math.round(monster.x), Math.round(monster.y), monster.slot.x, monster.slot.y, 2000);
          let sx = 0;
          let sy = 0;
          if (path.length > 0) {
            const next = path[0];
            sx = Math.sign(next.x - Math.round(monster.x));
            sy = Math.sign(next.y - Math.round(monster.y));
          } else {
            sx = Math.sign(monster.slot.x - monster.x);
            sy = Math.sign(monster.slot.y - monster.y);
          }
          moveMonster(game.world, monster, sx, sy, now);
        } else {
          monster.nextMoveAt = now + 700;
        }
      }
      continue;
    }

    // Estado IDLE: patrulla y detecta jugadores en aggro radius.
    monster.targetId = null;
    monster.slot = null;
    const found = game.world.nearestPlayer(monster.x, monster.y, AGGRO_RADIUS);
    if (found && !isSafeZone(Math.round(found.x), Math.round(found.y))) {
      monster.targetId = found.id;
      monster.state = 'chasing';
      continue;
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