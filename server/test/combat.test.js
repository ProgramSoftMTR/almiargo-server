import assert from 'node:assert/strict';
import test from 'node:test';
import { CONSTANTS, SPAWN_POINT } from '@almiargo/shared';
import { PlayerState, createCharacterState } from '../src/game/player.js';
import { Monster } from '../src/game/monster.js';
import {
  applyDamage,
  killPlayer,
  performPlayerAttack,
  respawnPlayer,
  validateAttack,
} from '../src/game/combat.js';

function newPlayer(name, id) {
  return new PlayerState(createCharacterState(name, id));
}

function fakeGame() {
  const events = [];
  const profiles = [];
  const broadcasts = [];
  const bags = [];
  return {
    events,
    profiles,
    broadcasts,
    bags,
    world: {
      spawnPoint: SPAWN_POINT,
      players: new Map(),
      canWalk: () => true,
      findFreeAdjacent: (x, y) => ({ x, y }),
      createBag(data) {
        const bag = { id: `bag_${bags.length + 1}`, ...data };
        bags.push(bag);
        return bag;
      },
      getPlayer: () => null,
    },
    sendEvent(player, event, data = {}) {
      events.push({ playerId: player?.id, event, ...data });
    },
    sendProfile(player) {
      profiles.push(player.id);
    },
    broadcastNear(x, y, radius, payload, exceptId = null) {
      broadcasts.push({ x, y, radius, payload, exceptId });
    },
    markDirty() {},
    savePlayer() {},
  };
}

test('validateAttack rechaza PvP en zona segura y acepta en zona PvP', () => {
  const game = fakeGame();
  const attacker = newPlayer('Atacante', 'a1');
  const target = newPlayer('Objetivo', 't1');
  const now = Date.now();

  attacker.x = 40; attacker.y = 42;
  target.x = 41; target.y = 42;
  const safe = validateAttack(game, attacker, target, now);
  assert.equal(safe.ok, false);
  assert.match(safe.error, /PvP deshabilitado/);

  attacker.x = 10; attacker.y = 10;
  target.x = 11; target.y = 10;
  const pvp = validateAttack(game, attacker, target, now);
  assert.equal(pvp.ok, true);
});

test('validateAttack comprueba alcance y enfriamiento', () => {
  const game = fakeGame();
  const attacker = newPlayer('Atacante', 'a2');
  const target = newPlayer('Objetivo', 't2');
  const now = Date.now();
  attacker.x = 10; attacker.y = 10;
  target.x = 20; target.y = 20;
  const far = validateAttack(game, attacker, target, now);
  assert.equal(far.ok, false);
  assert.match(far.error, /alcance/);

  target.x = 11; target.y = 10;
  attacker.nextAttackAt = now + 500;
  const cooling = validateAttack(game, attacker, target, now);
  assert.equal(cooling.ok, false);
  assert.equal(cooling.silent, true);
});

test('atacar a un jugador pacífico otorga calavera amarilla', () => {
  const game = fakeGame();
  const attacker = newPlayer('Atacante', 'a3');
  const target = newPlayer('Objetivo', 't3');
  const now = Date.now();
  attacker.skull = 'none';
  attacker.skullUntil = 0;
  target.skull = 'none';
  target.skullUntil = 0;
  const hpBefore = target.hp;

  applyDamage(game, attacker, target, 10, now, { crit: false });

  assert.equal(target.hp, hpBefore - 10);
  assert.equal(attacker.skull, 'yellow');
  assert.ok(attacker.skullUntil > now);
  assert.ok(game.events.some((e) => e.event === 'skill_xp' && e.skill === 'defense'));
  assert.ok(game.broadcasts.some((b) => b.payload.type === 'damage'));
});

test('no se mancha de amarillo al atacar a un PK con calavera roja', () => {
  const game = fakeGame();
  const attacker = newPlayer('Atacante', 'a4');
  const target = newPlayer('PK', 't4');
  const now = Date.now();
  attacker.skull = 'none';
  attacker.skullUntil = 0;
  target.skull = 'red';
  target.skullUntil = now + 20_000;

  applyDamage(game, attacker, target, 5, now);
  assert.equal(attacker.skull, 'none');
});

test('matar a un inocente da calavera roja y pérdidas moderadas', () => {
  const game = fakeGame();
  const killer = newPlayer('Killer', 'k1');
  const victim = newPlayer('Victima', 'v1');
  const now = Date.now();
  killer.skull = 'none';
  killer.skullUntil = 0;
  victim.skull = 'none';
  victim.skullUntil = 0;
  victim.hp = 1;
  victim.xp = 1000;
  victim.gold = 1000;

  killPlayer(game, victim, killer, now);

  assert.equal(victim.isDead, true);
  assert.equal(victim.xp, 920);
  assert.equal(victim.gold, 900);
  assert.equal(killer.skull, 'red');
  assert.equal(game.bags.length, 1);
  assert.equal(game.bags[0].gold, 100);
  assert.ok(game.events.some((e) => e.event === 'death' && e.xpLoss === 80 && e.goldLoss === 100));
  assert.ok(game.events.some((e) => e.event === 'pvp' && e.action === 'kill'));
  assert.ok(game.broadcasts.some((b) => b.payload.type === 'death' && b.exceptId === victim.id));
});

test('matar a un PK con calavera roja pierde equipo y más XP/oro', () => {
  const game = fakeGame();
  const killer = newPlayer('Killer', 'k2');
  const pk = newPlayer('PK', 'v2');
  const now = Date.now();
  killer.skull = 'none';
  killer.skullUntil = 0;
  pk.skull = 'red';
  pk.skullUntil = now + 20_000;
  pk.hp = 1;
  pk.xp = 1000;
  pk.gold = 1000;
  assert.ok(pk.equipment.mano);

  killPlayer(game, pk, killer, now);

  assert.equal(pk.xp, 800);
  assert.equal(pk.gold, 700);
  assert.equal(pk.equipment.mano, null);
  assert.equal(game.bags.length, 1);
  assert.equal(game.bags[0].items.length, 1);
  assert.equal(killer.skull, 'none', 'matar a un PK no da calavera roja');
});

test('el ataque con arco consume flechas y sincroniza el perfil', () => {
  const game = fakeGame();
  const archer = newPlayer('Arquero', 'ar1');
  const bow = archer.inventory.find((slot) => slot?.itemId === 'bow_wood');
  assert.ok(bow, 'el personaje inicial tiene arco');
  assert.equal(archer.equipUid(bow.uid).ok, true);
  archer.nextSwitchAt = 0;
  archer.x = 10;
  archer.y = 10;

  const monster = new Monster({ id: 'm_archer', defId: 'slime', spawn: { x: 11, y: 10 } });
  monster.x = 11;
  monster.y = 10;
  monster.hp = 500;
  const arrowsBefore = archer.countItem('arrow');

  const result = performPlayerAttack(game, archer, monster, Date.now());

  assert.equal(result.ok, true);
  assert.equal(archer.countItem('arrow'), arrowsBefore - 1, 'consume una flecha');
  assert.ok(game.profiles.includes(archer.id), 'envía profile para actualizar la munición del cliente');
});

test('respawn devuelve al jugador al spawn con vida y maná', () => {
  const game = fakeGame();
  const player = newPlayer('Respawn', 'r1');
  const now = Date.now();
  player.x = 10;
  player.y = 10;
  player.hp = 0;
  player.deadUntil = now + CONSTANTS.PLAYER_RESPAWN_MS;

  respawnPlayer(game, player, now);

  assert.deepEqual({ x: player.x, y: player.y }, { x: SPAWN_POINT.x, y: SPAWN_POINT.y });
  assert.equal(player.deadUntil, 0);
  assert.equal(player.hp, player.maxHp);
  assert.equal(player.mp, player.maxMp);
  assert.equal(player.nextMoveAt, 0);
  assert.ok(game.events.some((e) => e.event === 'respawn'));
});

test('el daño letal clampea el HP a 0 y programa el respawn', () => {
  const game = fakeGame();
  const killer = newPlayer('Killer', 'k3');
  const victim = newPlayer('Victima', 'v3');
  const now = Date.now();
  victim.hp = 5;
  victim.x = 12;
  victim.y = 12;

  applyDamage(game, killer, victim, 50, now);

  assert.equal(victim.hp, 0, 'nunca debe quedar HP negativo');
  assert.equal(victim.isDead, true);
  assert.ok(victim.deadUntil > now, 'el respawn debe quedar programado');

  respawnPlayer(game, victim, victim.deadUntil);

  assert.equal(victim.hp, victim.maxHp);
  assert.equal(victim.mp, victim.maxMp);
  assert.equal(victim.deadUntil, 0);
  assert.deepEqual({ x: victim.x, y: victim.y }, { x: SPAWN_POINT.x, y: SPAWN_POINT.y });
});
