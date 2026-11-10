import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWorld, tileAt, TILE } from '../shared/index.js';
import { ResourceManager } from '../src/game/resourceManager.js';

test('ResourceManager tala un arbol y lo marca como stump', () => {
  const world = generateWorld(1337);
  let tx = -1, ty = -1;
  outer: for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (tileAt(world, x, y) === TILE.TREE) { tx = x; ty = y; break outer; }
    }
  }
  assert.ok(tx >= 0, 'debe existir al menos un arbol en el mapa');

  const rm = new ResourceManager({ world, minMs: 50, maxMs: 50 });
  assert.equal(rm.isAlive(tx, ty), true);
  const result = rm.chop(tx, ty);
  assert.ok(result, 'chop debe devolver un resultado');
  assert.equal(rm.isAlive(tx, ty), false, 'tras talar el arbol queda como stump');

  // Un segundo chop no debe hacer nada.
  const second = rm.chop(tx, ty);
  assert.equal(second, null, 'no se puede talar un arbol ya talado');
});

test('ResourceManager hace reaparecer el arbol tras el temporizador', async () => {
  const world = generateWorld(1337);
  let tx = -1, ty = -1;
  outer: for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (tileAt(world, x, y) === TILE.TREE) { tx = x; ty = y; break outer; }
    }
  }
  const rm = new ResourceManager({ world, minMs: 30, maxMs: 30 });
  let regrown = false;
  rm.onRegrow = (x, y) => { if (x === tx && y === ty) regrown = true; };
  rm.chop(tx, ty);
  assert.equal(rm.isAlive(tx, ty), false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(rm.isAlive(tx, ty), true, 'el arbol debe reaparecer tras el timer');
  assert.equal(regrown, true, 'onRegrow debe dispararse');
  rm.clear();
});

test('ResourceManager.clear limpia temporizadores', () => {
  const world = generateWorld(1337);
  let tx = -1, ty = -1;
  outer: for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      if (tileAt(world, x, y) === TILE.TREE) { tx = x; ty = y; break outer; }
    }
  }
  const rm = new ResourceManager({ world, minMs: 10000, maxMs: 10000 });
  rm.chop(tx, ty);
  rm.clear();
  assert.equal(rm.trees.size, 0);
});
