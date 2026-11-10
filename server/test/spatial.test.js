import assert from 'node:assert/strict';
import test from 'node:test';
import { SPAWN_POINT } from '@almiargo/shared';
import { World } from '../src/game/world.js';
import { PlayerState, createCharacterState } from '../src/game/player.js';

function playerAt(id, x, y) {
  const player = new PlayerState(createCharacterState(id, id));
  player.x = x;
  player.y = y;
  return player;
}

test('el snapshot usa el viewport y excluye entidades lejanas', () => {
  const world = new World();
  const self = playerAt('self', SPAWN_POINT.x, SPAWN_POINT.y);
  const near = playerAt('near', SPAWN_POINT.x + 5, SPAWN_POINT.y);
  const far = playerAt('far', SPAWN_POINT.x + 60, SPAWN_POINT.y);
  world.addPlayer(self);
  world.addPlayer(near);
  world.addPlayer(far);

  let snap = world.snapshotFor(self, 18, 11);
  const ids = snap.entities.map((e) => e[0]);
  assert.ok(ids.includes('near'), 'incluye jugador dentro del viewport');
  assert.ok(!ids.includes('far'), 'excluye jugador fuera del viewport');
  assert.ok(!ids.includes('self'), 'no se envía a sí mismo');

  world.moveEntity(near, SPAWN_POINT.x + 60, SPAWN_POINT.y + 40);
  snap = world.snapshotFor(self, 18, 11);
  assert.ok(!snap.entities.some((e) => e[0] === 'near'), 'moveEntity actualiza el índice');
});

test('nearestPlayer usa el índice espacial y descarta muertos', () => {
  const world = new World();
  const nearDead = playerAt('dead', 10, 10);
  nearDead.hp = 0;
  const farAlive = playerAt('alive', 12, 10);
  world.addPlayer(nearDead);
  world.addPlayer(farAlive);

  const found = world.nearestPlayer(10, 10, 8);
  assert.equal(found?.id, 'alive');
});

test('bolsas y tiendas también se filtran por interés', () => {
  const world = new World();
  const self = playerAt('self2', SPAWN_POINT.x, SPAWN_POINT.y);
  world.addPlayer(self);
  world.createBag({
    x: SPAWN_POINT.x + 2,
    y: SPAWN_POINT.y,
    ownerId: self.id,
    items: [],
    gold: 10,
  });
  world.createBag({
    x: SPAWN_POINT.x + 50,
    y: SPAWN_POINT.y,
    ownerId: null,
    items: [],
    gold: 50,
  });
  world.addStall({
    id: 'stall_near',
    x: SPAWN_POINT.x + 3,
    y: SPAWN_POINT.y,
    ownerName: 'Vendedor',
    items: [{ itemId: 'sword_wood', qty: 1 }],
    online: true,
  });

  const snap = world.snapshotFor(self, 18, 11);
  assert.equal(snap.bags.length, 1);
  assert.equal(snap.bags[0].g, 10);
  assert.equal(snap.stalls.length, 1);
  assert.equal(snap.stalls[0].i, 'stall_near');

  world.removeBag(snap.bags[0].i);
  world.removeStall('stall_near');
  const empty = world.snapshotFor(self, 18, 11);
  assert.equal(empty.bags.length, 0);
  assert.equal(empty.stalls.length, 0);
});
