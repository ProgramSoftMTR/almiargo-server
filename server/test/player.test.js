import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerState, createCharacterState } from '../src/game/player.js';

function newPlayer(name = 'Hero', id = 'char_1') {
  return new PlayerState(createCharacterState(name, id));
}

test('el personaje nuevo empieza como caballero con espada y equipo básico', () => {
  const player = newPlayer();
  assert.equal(player.classId, 'knight');
  assert.equal(player.level, 1);
  assert.equal(player.gold, 100);
  assert.equal(player.equipment.weapon.itemId, 'sword_wood');
  assert.ok(player.countItem('bow_wood') >= 1);
  assert.ok(player.countItem('staff_wood') >= 1);
  assert.ok(player.countItem('potion_hp') >= 1);
  assert.equal(player.inventory.length, 30);
});

test('cambiar de clase equipa el mejor arma y respeta el cooldown de 1s', () => {
  const player = newPlayer();
  const now = Date.now();

  const archer = player.switchClass('archer', now);
  assert.equal(archer.ok, true);
  assert.equal(player.classId, 'archer');
  assert.equal(player.equipment.weapon.itemId, 'bow_wood');

  const blocked = player.switchClass('mage', now + 500);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Espera/);

  const mage = player.switchClass('mage', now + 1100);
  assert.equal(mage.ok, true);
  assert.equal(player.classId, 'mage');
  assert.equal(player.equipment.weapon.itemId, 'staff_wood');
  assert.ok(player.countItem('bow_wood') >= 1, 'el arco anterior vuelve a la mochila');
});

test('no se puede cambiar a una clase sin arma', () => {
  const player = newPlayer();
  player.removeItemId('bow_wood', 1);
  const result = player.switchClass('archer', Date.now() + 5000);
  assert.equal(result.ok, false);
  assert.match(result.error, /No tienes armas/);
});

test('equipar y desequipar actualiza stats e inventario', () => {
  const player = newPlayer();
  const helmet = player.inventory.find((s) => s?.itemId === 'helmet_leather');
  assert.ok(helmet);

  const equip = player.equipUid(helmet.uid, Date.now() + 5000);
  assert.equal(equip.ok, true);
  assert.equal(player.equipment.helmet.itemId, 'helmet_leather');
  assert.equal(player.inventory.some((s) => s?.uid === helmet.uid), false);

  const unequip = player.unequipSlot('helmet', Date.now() + 5000);
  assert.equal(unequip.ok, true);
  assert.equal(player.equipment.helmet, null);
  assert.equal(player.countItem('helmet_leather'), 1);
});

test('las pociones curan, descuentan y tienen cooldown', () => {
  const player = newPlayer();
  const potion = player.inventory.find((s) => s?.itemId === 'potion_hp');
  const qty = potion.qty;
  player.hp = 10;

  const now = Date.now();
  const used = player.useConsumable(potion.uid, now);
  assert.equal(used.ok, true);
  assert.equal(used.healed, 40);
  assert.equal(player.hp, 50);
  assert.equal(player.countItem('potion_hp'), qty - 1);

  player.hp = 10;
  const second = player.inventory.find((s) => s?.itemId === 'potion_hp');
  const blocked = player.useConsumable(second.uid, now + 100);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /enfriamiento/);
});

test('no se pueden usar pociones estando muerto', () => {
  const player = newPlayer('Muerto', 'dead_1');
  const potion = player.inventory.find((s) => s?.itemId === 'potion_hp');
  const now = Date.now();
  player.hp = 0;
  player.deadUntil = now + 5000;

  const used = player.useConsumable(potion.uid, now);

  assert.equal(used.ok, false);
  assert.match(used.error, /muerto/);
  assert.equal(player.hp, 0, 'no revive con poción');
  assert.equal(player.countItem('potion_hp'), 5, 'no consume la poción');
});

test('el perfil serializado incluye skills, equipo y tienda', () => {
  const player = newPlayer();
  const profile = player.toProfile();
  assert.equal(profile.classId, 'knight');
  assert.equal(profile.inStall, false);
  assert.equal(profile.stall, null);
  assert.equal(profile.skills.melee.level, 1);
  assert.equal(profile.equipment.weapon.itemId, 'sword_wood');
  assert.equal(profile.inventory.length, 30);
});
