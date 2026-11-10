import {
  CLASSES,
  CONSTANTS,
  MONSTERS,
  SKILLS,
  defenseXpForHit,
  grantCharacterXp,
  isPvPZone,
  mitigate,
  monsterXp,
  randInt,
  resolveHit,
  rollAttack,
  rollLootTable,
  skillXpForHit,
  xpToNextLevel,
} from '../../shared/index.js';

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const inRange = (a, b, range) => dist2(a, b) <= (range + 0.35) ** 2;
const eventRadius = (game) => game.config?.aoiRadius ?? 20;

/** Valida un ataque básico. El cliente nunca calcula daño ni alcance. */
export function validateAttack(game, player, target, now) {
  if (!player || player.isDead) return { ok: false, error: 'Estás muerto' };
  if (player.stall) return { ok: false, error: 'Cierra tu tienda primero' };
  if (now < player.nextAttackAt) return { ok: false, error: 'Enfriamiento', silent: true };
  if (!target) return { ok: false, error: 'Objetivo inválido' };

  const weapon = player.weapon;
  const cls = CLASSES[player.classId] ?? CLASSES.adventurer;
  if (!inRange(player, target, cls.range)) return { ok: false, error: 'Fuera de alcance' };

  if (target.kind === 0) {
    if (target.isDead) return { ok: false, error: 'Objetivo muerto' };
    if (!isPvPZone(Math.round(target.x), Math.round(target.y))) {
      return { ok: false, error: 'PvP deshabilitado en esta zona' };
    }
  } else if (target.kind === 1) {
    if (target.isDead) return { ok: false, error: 'Objetivo muerto' };
  } else {
    return { ok: false, error: 'Objetivo inválido' };
  }

  if (weapon.ammo && player.countItem(weapon.ammo) < 1) {
    return { ok: false, error: 'No tienes flechas' };
  }
  if (weapon.manaCost && player.mp < weapon.manaCost) {
    return { ok: false, error: 'Maná insuficiente' };
  }
  return { ok: true };
}

/**
 * Ataque básico autoritativo. Consume recursos, calcula daño, otorga XP de
 * habilidad y aplica karma PvP. Devuelve {ok, amount, crit, error}.
 */
export function performPlayerAttack(game, player, target, now = Date.now()) {
  const check = validateAttack(game, player, target, now);
  if (!check.ok) return check;

  const weapon = player.weapon;
  const cls = CLASSES[player.classId];

  // Recursos consumidos: el cliente necesita el perfil para actualizar
  // munición/maná sin esperar al siguiente sondeo del servidor.
  let resourcesSpent = false;
  if (weapon.ammo) {
    const removed = player.removeItemId(weapon.ammo, 1);
    if (removed.removed < 1) return { ok: false, error: 'No tienes flechas' };
    resourcesSpent = true;
  }
  if (weapon.manaCost) {
    if (player.mp < weapon.manaCost) return { ok: false, error: 'Maná insuficiente' };
    player.mp -= weapon.manaCost;
    resourcesSpent = true;
  }

  const targetDefense = target.kind === 1 ? target.def.defense : target.stats.defense;
  const { amount, crit } = resolveHit({
    weapon,
    skillLevel: player.attackSkillLevel,
    level: player.level,
    bonusAtk: player.stats.bonusAtk,
    critChance: player.stats.critChance,
    targetDefense,
  });

  player.nextAttackAt = now + (weapon?.cooldownMs ?? 900);
  player.inCombatUntil = now + 5000;
  player.dirty = true;

  const xp = skillXpForHit(amount);
  const levels = player.gainSkillXp(player.skillId, xp);
  game.sendEvent(player, 'skill_xp', { skill: player.skillId, amount: xp });
  if (levels > 0) {
    player.recalc();
    game.sendEvent(player, 'skill_up', { skill: player.skillId, level: player.skills[player.skillId].level });
    game.sendProfile(player);
  }

  applyDamage(game, player, target, amount, now, { crit, element: cls.id });
  if (resourcesSpent) game.sendProfile(player);
  game.markDirty(player);
  return { ok: true, amount, crit };
}

/**
 * Habilidad especial según el arma equipada.
 *  - Caballero: golpe giratorio AOE alrededor del jugador.
 *  - Arquero: disparo triple a los 3 enemigos más cercanos.
 *  - Mago: explosión arcana en área.
 */
export function performSpecial(game, player, now = Date.now()) {
  if (!player || player.isDead) return { ok: false, error: 'Estás muerto' };
  if (player.stall) return { ok: false, error: 'Cierra tu tienda primero' };
  if (now < player.nextSpecialAt) return { ok: false, error: 'Habilidad en enfriamiento' };
  if (player.mp < CONSTANTS.SPECIAL_MANA_COST) return { ok: false, error: 'Maná insuficiente' };

  const cls = player.classId;
  const weapon = player.weapon;
  if (!weapon) return { ok: false, error: 'No tienes arma' };

  let targets = [];
  let multiplier = 1;
  let radius = 2;

  if (cls === 'knight') {
    radius = 1.9;
    targets = [
      ...game.world.monstersNear(player.x, player.y, radius),
      ...game.world.playersNear(player.x, player.y, radius, player.id).filter((p) => isPvPZone(Math.round(p.x), Math.round(p.y))),
    ];
    multiplier = 1.45;
  } else if (cls === 'archer') {
    if (player.countItem('arrow') < 3) return { ok: false, error: 'Necesitas 3 flechas' };
    const all = [
      ...game.world.monstersNear(player.x, player.y, 8),
      ...game.world.playersNear(player.x, player.y, 8, player.id).filter((p) => isPvPZone(Math.round(p.x), Math.round(p.y))),
    ];
    targets = all.sort((a, b) => dist2(player, a) - dist2(player, b)).slice(0, 3);
    player.removeItemId('arrow', 3);
    multiplier = 0.78;
  } else {
    const primary = player.targetId ? game.world.getEntity(player.targetId) : null;
    const center = primary && dist2(player, primary) <= 8 ** 2 ? primary : player;
    radius = 2.4;
    targets = [
      ...game.world.monstersNear(center.x, center.y, radius),
      ...game.world.playersNear(center.x, center.y, radius, player.id).filter((p) => isPvPZone(Math.round(p.x), Math.round(p.y))),
    ];
    multiplier = 1.2;
  }

  player.mp -= CONSTANTS.SPECIAL_MANA_COST;
  player.nextSpecialAt = now + CONSTANTS.SPECIAL_COOLDOWN_MS;
  player.nextAttackAt = Math.max(player.nextAttackAt, now + 350);
  player.dirty = true;

  const hits = [];
  for (const target of targets) {
    if (target.isDead) continue;
    const targetDefense = target.kind === 1 ? target.def.defense : target.stats.defense;
    const { amount, crit } = resolveHit({
      weapon,
      skillLevel: player.attackSkillLevel,
      level: player.level,
      bonusAtk: player.stats.bonusAtk,
      critChance: player.stats.critChance,
      targetDefense,
    });
    const finalAmount = Math.max(1, Math.round(amount * multiplier));
    const xp = skillXpForHit(finalAmount, true);
    const levels = player.gainSkillXp(player.skillId, xp);
    if (levels > 0) {
      player.recalc();
      game.sendEvent(player, 'skill_up', { skill: player.skillId, level: player.skills[player.skillId].level });
    }
    game.sendEvent(player, 'skill_xp', { skill: player.skillId, amount: xp });
    applyDamage(game, player, target, finalAmount, now, { crit, element: cls });
    hits.push({ id: target.id, amount: finalAmount, crit, x: target.x, y: target.y });
  }

  game.broadcastNear(player.x, player.y, eventRadius(game), {
    type: 'special',
    classId: cls,
    x: player.x,
    y: player.y,
    radius,
    hits,
  });
  game.sendProfile(player);
  game.markDirty(player);
  return { ok: true, hits };
}

/** Aplica daño a monstruos o jugadores y resuelve muertes. */
export function applyDamage(game, source, target, amount, now, meta = {}) {
  const rounded = Math.max(1, Math.round(amount));
  if (target.kind === 1) {
    target.hp = Math.max(0, target.hp - rounded);
    target.recordDamage(source.id, rounded);
    target.lastAttackerId = source.id;
    target.targetId = source.id;
    game.broadcastNear(target.x, target.y, eventRadius(game), {
      type: 'damage', sid: source.id, tid: target.id, amount: rounded,
      crit: !!meta.crit, element: meta.element ?? 'melee', x: target.x, y: target.y,
    });
    if (target.hp <= 0) killMonster(game, target, source, now);
    return { amount: rounded, killed: target.isDead };
  }

  if (target.kind === 0) {
    if (target.isDead) return { amount: 0, killed: false };
    target.hp = Math.max(0, target.hp - rounded);
    target.inCombatUntil = now + 5000;
    target.lastAttackerId = source.id;
    target.lastAttackerKind = source.kind;
    game.broadcastNear(target.x, target.y, eventRadius(game), {
      type: 'damage', sid: source.id, tid: target.id, amount: rounded,
      crit: !!meta.crit, element: meta.element ?? 'melee', x: target.x, y: target.y,
    });

    // Cada golpe recibido entrena Defensa.
    const dxp = defenseXpForHit(rounded);
    const levels = target.gainSkillXp('defense', dxp);
    game.sendEvent(target, 'skill_xp', { skill: 'defense', amount: dxp });
    if (levels > 0) {
      target.recalc();
      game.sendEvent(target, 'skill_up', { skill: 'defense', level: target.skills.defense.level });
    }
    game.sendProfile(target);

    if (source.kind === 0 && target.kind === 0) {
      // Karma: atacar a un pacífico otorga calavera amarilla.
      if (!target.skullActive && source.skull !== 'red') {
        source.skull = 'yellow';
        source.skullUntil = now + CONSTANTS.YELLOW_SKULL_MS;
        game.broadcastNear(source.x, source.y, eventRadius(game), {
          type: 'pvp', action: 'attack', attackerId: source.id, targetId: target.id, skull: 'yellow',
        });
        game.sendProfile(source);
      }
    }

    if (target.hp <= 0) {
      killPlayer(game, target, source, now);
      return { amount: rounded, killed: true };
    }
    game.markDirty(target);
    return { amount: rounded, killed: false };
  }
  return { amount: 0, killed: false };
}

/** Daño de monstruo a jugador, con XP de Defensa y muerte. */
export function monsterAttack(game, monster, player, now = Date.now()) {
  if (!monster.alive || !player || player.isDead) return;
  if (dist2(monster, player) > 1.65 ** 2) return;
  if (now < monster.nextAttackAt) return;

  const crit = Math.random() < 0.04;
  const raw = randInt(monster.def.atkMin, monster.def.atkMax) * (crit ? 1.5 : 1);
  const amount = mitigate(raw, player.stats.defense);
  monster.nextAttackAt = now + monster.def.attackMs;
  monster.dir = dirTo(monster, player);
  applyDamage(game, monster, player, amount, now, { crit, element: 'melee' });
}

export function killMonster(game, monster, source, now) {
  if (!monster.alive) return;
  monster.alive = false;
  monster.hp = 0;
  monster.deathAt = now;
  monster.respawnAt = now + 7000 + randInt(0, 6000);
  const topId = monster.topDamager() ?? (source?.kind === 0 ? source.id : null);

  // XP proporcional al daño infligido, con bonus para el que dio el golpe final.
  const totalDamage = [...monster.damageBy.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [playerId, dmg] of monster.damageBy) {
    const p = game.world.getPlayer(playerId);
    if (!p) continue;
    const share = dmg / totalDamage;
    const bonus = playerId === topId ? 1.2 : 1;
    const xp = Math.max(1, Math.round(monsterXp(monster.def, p.level) * share * bonus));
    awardXp(game, p, xp);
  }

  // Loot: siempre pertenece al que hizo más daño durante 45 s.
  const drops = rollLootTable(monster.def.loot);
  const gold = randInt(monster.def.gold[0], monster.def.gold[1]);
  if (gold > 0 || drops.length > 0) {
    const now = Date.now();
    const bag = game.world.createBag({
      x: monster.x,
      y: monster.y,
      ownerId: topId,
      items: drops,
      gold,
      freeAt: now + CONSTANTS.BAG_FREE_AFTER_MS,
      expiresAt: now + CONSTANTS.BAG_EXPIRE_MS,
    });
    // Establecer tiempo de desaparición automática de 60 segundos si no es recogido
    bag.despawnAt = now + 60000;
    // Iniciar temporizador de auto-destrucción
    bag.despawnTimeout = setTimeout(() => {
      game.world.removeBag(bag.id);
      game.broadcastNear(monster.x, monster.y, eventRadius(game), {
        type: 'drop_despawn', bagId: bag.id,
      });
    }, 60000);
    game.broadcastNear(monster.x, monster.y, eventRadius(game), {
      type: 'loot', bagId: bag.id, x: bag.x, y: bag.y, ownerId: topId,
    });
  }

  // Limpia objetivos que apuntaban al monstruo.
  for (const p of game.world.players.values()) {
    if (p.targetId === monster.id) {
      p.targetId = null;
      game.sendEvent(p, 'target_clear', {});
    }
  }

  game.broadcastNear(monster.x, monster.y, eventRadius(game), {
    type: 'death', id: monster.id, kind: 'monster', x: monster.x, y: monster.y,
    by: source?.id ?? null, respawnAt: monster.respawnAt,
  });
}

export function killPlayer(game, target, source, now) {
  // No usar isDead como guarda: applyDamage ya deja hp=0 (o lo clampea a 0)
  // antes de llamar aquí. Si saliéramos por isDead, deadUntil nunca se
  // programaría y el jugador quedaría atrapado con HP 0 para siempre.
  if (target.deadUntil > now) return;
  target.hp = 0;
  target.deadUntil = now + CONSTANTS.PLAYER_RESPAWN_MS;
  target.targetId = null;
  target.nextMoveAt = now + CONSTANTS.PLAYER_RESPAWN_MS;
  target.nextAttackAt = now + CONSTANTS.PLAYER_RESPAWN_MS;

  const wasRed = target.skullActive && target.skull === 'red';
  const wasInnocent = !target.skullActive;
  const xpLossPct = wasRed ? 0.2 : 0.08;
  const goldLossPct = wasRed ? 0.3 : 0.1;
  const xpLoss = Math.floor(target.xp * xpLossPct);
  const goldLoss = Math.floor(target.gold * goldLossPct);

  target.xp = Math.max(0, target.xp - xpLoss);
  target.gold = Math.max(0, target.gold - goldLoss);

  const droppedItems = [];
  if (wasRed) {
    const equipped = Object.entries(target.equipment).filter(([, inst]) => inst);
    if (equipped.length > 0) {
      const [slot, inst] = equipped[randInt(0, equipped.length - 1)];
      target.equipment[slot] = null;
      droppedItems.push({ uid: inst.uid, itemId: inst.itemId, qty: inst.qty });
    }
  }

  target.skull = 'none';
  target.skullUntil = 0;
  target.recalc();

  if (goldLoss > 0 || droppedItems.length > 0) {
    game.world.createBag({
      x: target.x,
      y: target.y,
      ownerId: source?.kind === 0 ? source.id : null,
      items: droppedItems,
      gold: goldLoss,
      freeAt: now + CONSTANTS.BAG_FREE_AFTER_MS,
      expiresAt: now + CONSTANTS.BAG_EXPIRE_MS,
    });
  }

  if (source?.kind === 0) {
    // El killer de un pacífico se convierte en PK (calavera roja).
    if (wasInnocent && source.skull !== 'red') {
      source.skull = 'red';
      source.skullUntil = now + CONSTANTS.RED_SKULL_MS;
      game.sendProfile(source);
    }
    game.sendEvent(source, 'pvp', {
      action: 'kill', targetId: target.id, skull: source.skull,
    });
    game.broadcastNear(target.x, target.y, eventRadius(game), {
      type: 'pvp', action: 'kill', attackerId: source.id, targetId: target.id, skull: 'red',
    });
  }

  game.broadcastNear(target.x, target.y, eventRadius(game), {
    type: 'death', id: target.id, kind: 'player', x: target.x, y: target.y,
    by: source?.id ?? null, respawnAt: target.deadUntil,
  }, target.id);
  game.sendEvent(target, 'death', {
    id: target.id, kind: 'player', x: target.x, y: target.y, by: source?.id ?? null,
    respawnAt: target.deadUntil, xpLoss, goldLoss, dropped: droppedItems.length > 0,
  });
  game.sendProfile(target);
  game.markDirty(target);
  game.savePlayer?.(target);
}

export function respawnPlayer(game, player, now) {
  const spawn = game.world.spawnPoint;
  const spot = game.world.canWalk(spawn.x, spawn.y)
    ? spawn
    : game.world.findFreeAdjacent(spawn.x, spawn.y);

  // Respawn limpio: posicion segura de la ciudad, HP/MP al maximo y todos los
  // bloqueos de muerte/movimiento a cero. El cliente recibe el paquete
  // inmediatamente para teletransportar personaje y camara.
  if (typeof game.world.moveEntity === 'function') {
    game.world.moveEntity(player, spot.x, spot.y);
  } else {
    player.x = spot.x;
    player.y = spot.y;
    game.world.refreshEntity?.(player);
  }
  player.hp = Math.max(1, player.maxHp);
  player.mp = Math.max(0, player.maxMp);
  player.deadUntil = 0;
  player.nextMoveAt = 0;
  player.nextAttackAt = 0;
  player.nextSpecialAt = 0;
  player.nextRegenAt = now + 1000;
  player.inCombatUntil = 0;
  player.lastAttackerId = null;
  player.lastAttackerKind = null;
  player.targetId = null;
  player.skull = 'none';
  player.skullUntil = 0;
  player.dirty = true;

  // Evento inmediato con el estado completo + snapshot forzado para que la
  // camara, el sprite y el HUD se reposicionen sin esperar al siguiente tick.
  game.sendEvent(player, 'respawn', {
    id: player.id,
    x: player.x,
    y: player.y,
    hp: player.hp,
    mp: player.mp,
    maxHp: player.maxHp,
    maxMp: player.maxMp,
    deadUntil: 0,
  });
  game.forceSnapshot?.(player, now);
  game.sendProfile(player);
  game.broadcastNear(player.x, player.y, eventRadius(game), {
    type: 'respawn', id: player.id, x: player.x, y: player.y, name: player.name,
  });
  game.markDirty(player);
}

function awardXp(game, player, amount) {
  const levels = grantCharacterXp(player, amount);
  game.sendEvent(player, 'xp', { amount, level: player.level, xp: player.xp, xpNext: xpToNextLevel(player.level) });
  if (levels > 0) {
    player.recalc();
    player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.4 * levels));
    player.mp = Math.min(player.maxMp, player.mp + Math.round(player.maxMp * 0.4 * levels));
    game.sendEvent(player, 'level_up', {
      level: player.level, maxHp: player.maxHp, maxMp: player.maxMp,
      skills: player.toProfile().skills,
    });
    game.sendProfile(player);
    game.broadcastNear(player.x, player.y, 16, {
      type: 'notice', text: `${player.name} alcanzó el nivel ${player.level}`, x: player.x, y: player.y,
    });
  }
  player.dirty = true;
}

export function dirTo(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Intent de ataque (targeting). El servidor fija el objetivo y ataca ya. */
export function handleAttackIntent(game, player, targetId) {
  const target = game.world.getEntity(targetId);
  if (!target || target.kind === 2) return { ok: false, error: 'Objetivo inválido' };
  if (target.kind === 0 && target.id === player.id) return { ok: false, error: 'No puedes atacarte' };
  player.targetId = target.id;
  const now = Date.now();
  const result = performPlayerAttack(game, player, target, now);
  if (!result.ok && !result.silent) game.sendEvent(player, 'error', { message: result.error });
  return result;
}
