import { isSafeZone } from '../../shared/index.js';
import { monsterAttack } from './combat.js';

/**
 * IA simple y barata: patrulla -> aggro -> persecución -> ataque.
 * Se ejecuta dentro del tick autoritativo (20 Hz).
 */
export function updateMonsters(game, now) {
  for (const monster of game.world.monsters.values()) {
    if (!monster.alive) {
      if (now >= monster.respawnAt) {
        monster.reset(now);
        game.world.refreshEntity?.(monster);
        monster.dir = 'down';
        game.broadcastNear(monster.x, monster.y, game.config?.aoiRadius ?? 20, {
          type: 'respawn', id: monster.id, kind: 'monster', x: monster.x, y: monster.y,
        });
      }
      continue;
    }

    const def = monster.def;
    let target = monster.targetId ? game.world.getPlayer(monster.targetId) : null;
    if (target && (target.isDead || isSafeZone(Math.round(target.x), Math.round(target.y)))) target = null;
    if (target && (target.x - monster.homeX) ** 2 + (target.y - monster.homeY) ** 2 > 22 ** 2) target = null;

    if (!target) {
      target = game.world.nearestPlayer(monster.x, monster.y, def.aggro);
      if (target && isSafeZone(Math.round(target.x), Math.round(target.y))) target = null;
      monster.targetId = target?.id ?? null;
    }

    if (!target) {
      monster.targetId = null;
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
      continue;
    }

    const dx = target.x - monster.x;
    const dy = target.y - monster.y;
    const distSq = dx * dx + dy * dy;

    if (distSq <= 1.65 ** 2) {
      monster.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (now >= monster.nextAttackAt) monsterAttack(game, monster, target, now);
    } else if (now >= monster.nextMoveAt) {
      const sx = Math.sign(dx);
      const sy = Math.sign(dy);
      moveMonster(game.world, monster, sx, sy, now);
    }
  }
}

function moveMonster(world, monster, dx, dy, now) {
  const options = [[dx, dy], [dx, 0], [0, dy]];
  for (const [ox, oy] of options) {
    if (ox === 0 && oy === 0) continue;
    const nx = monster.x + ox;
    const ny = monster.y + oy;
    if (!world.canWalk(nx, ny)) continue;
    world.moveEntity(monster, nx, ny);
    monster.dir = Math.abs(ox) > Math.abs(oy) ? (ox > 0 ? 'right' : 'left') : (oy > 0 ? 'down' : 'up');
    const diagonal = ox !== 0 && oy !== 0;
    monster.nextMoveAt = now + monster.def.moveMs * (diagonal ? 1.25 : 1);
    return;
  }
  monster.nextMoveAt = now + 700;
}
