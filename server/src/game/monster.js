import { ENTITY_KIND, MONSTERS, randInt } from '../../shared/index.js';

let monsterSeq = 0;

/** Monstruo autoritativo. Mantiene estado de IA, respawn y contribución de daño. */
export class Monster {
  constructor({ id, defId, spawn }) {
    const def = MONSTERS[defId];
    if (!def) throw new Error(`Monstruo desconocido: ${defId}`);
    this.id = id ?? `m_${(monsterSeq += 1)}`;
    this.kind = ENTITY_KIND.MONSTER;
    this.defId = defId;
    this.def = def;
    this.name = def.name;
    this.level = def.level;
    this.x = spawn.x;
    this.y = spawn.y;
    this.homeX = spawn.x;
    this.homeY = spawn.y;
    this.spawn = spawn;
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.dir = 'down';
    this.alive = true;
    this.respawnAt = 0;
    this.targetId = null;
    this.nextMoveAt = 0;
    this.nextAttackAt = 0;
    this.nextPatrolAt = 0;
    this.patrolTarget = null;
    this.damageBy = new Map();
    this.deathAt = 0;
    this.lastAttackerId = null;
  }

  get isDead() {
    return !this.alive || this.hp <= 0;
  }

  reset(now, spawn = this.spawn, world = null) {
    this.hp = this.maxHp;
    let sx = spawn?.x ?? this.x;
    let sy = spawn?.y ?? this.y;
    if (world) {
      const free = world.findFreeTile(sx, sy, this.id);
      sx = free.x;
      sy = free.y;
    }
    this.x = sx;
    this.y = sy;
    this.homeX = sx;
    this.homeY = sy;
    this.spawn = { x: sx, y: sy };
    this.alive = true;
    this.targetId = null;
    this.patrolTarget = null;
    this.damageBy.clear();
    this.deathAt = 0;
    this.nextMoveAt = now + randInt(200, 1200);
    this.nextAttackAt = 0;
    this.nextPatrolAt = now + randInt(1000, 4000);
    this.lastAttackerId = null;
  }

  recordDamage(playerId, amount) {
    const current = this.damageBy.get(playerId) ?? 0;
    this.damageBy.set(playerId, current + amount);
  }

  topDamager() {
    let bestId = null;
    let best = -1;
    for (const [id, dmg] of this.damageBy) {
      if (dmg > best) { best = dmg; bestId = id; }
    }
    return bestId;
  }

  toWire() {
    return [
      this.id,
      ENTITY_KIND.MONSTER,
      Math.round(this.x * 100) / 100,
      Math.round(this.y * 100) / 100,
      this.dir,
      Math.max(0, Math.round((this.hp / this.maxHp) * 100)),
      this.name,
      'none',
      this.defId,
      this.level,
    ];
  }
}

export function createMonsters(now) {
  return [];
}
