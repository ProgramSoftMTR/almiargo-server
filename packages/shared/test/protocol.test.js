import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeEntity, decodeSelf, encodeSelf } from '../src/protocol.js';

test('encodeSelf/decodeSelf conservan el estado del jugador', () => {
  const player = {
    x: 40.123,
    y: 42.987,
    dir: 'left',
    hp: 81,
    mp: 33,
    maxHp: 81,
    maxMp: 33,
    level: 7,
    xp: 123,
    gold: 456,
    classId: 'archer',
    skull: 'red',
    skullActive: true,
    skullUntil: 9999,
    deadUntil: 0,
    targetId: 'm_1',
    stall: { items: [] },
    nextAttackAt: 111,
    nextSpecialAt: 222,
    nextSwitchAt: 333,
    moveMs: 230,
  };

  const wire = encodeSelf(player);
  assert.equal(wire.length, 21);
  assert.ok(Array.isArray(wire));
  const decoded = decodeSelf(wire);
  assert.equal(decoded.x, 40.12);
  assert.equal(decoded.y, 42.99);
  assert.equal(decoded.hp, 81);
  assert.equal(decoded.maxHp, 81);
  assert.equal(decoded.classId, 'archer');
  assert.equal(decoded.skull, 'red');
  assert.equal(decoded.targetId, 'm_1');
  assert.equal(decoded.inStall, true);
  assert.equal(decoded.moveMs, 230);
});

test('decodeSelf tolera el formato objeto anterior', () => {
  const legacy = { x: 1, y: 2, hp: 3 };
  assert.equal(decodeSelf(legacy), legacy);
});

test('decodeEntity conserva el color de nombre opcional', () => {
  const admin = decodeEntity([
    'p1', 0, 10, 20, 'down', 80, 'ChiwiADMIN', 'none', 'knight', 5, '#800080',
  ]);
  assert.equal(admin.name, 'ChiwiADMIN');
  assert.equal(admin.nameColor, '#800080');

  // Servidores antiguos no envían el campo: el cliente lo trata como nulo.
  const normal = decodeEntity(['p2', 0, 10, 20, 'down', 80, 'Normal', 'none', 'knight', 2]);
  assert.equal(normal.nameColor, null);
});
