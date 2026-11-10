import assert from 'node:assert/strict';
import test from 'node:test';
import { findPath, generateWorld, isWalkable, pathToDirections } from '../src/index.js';

const world = generateWorld(1337);

test('A* encuentra un camino entre dos puntos transitables', () => {
  const path = findPath(world, 40, 42, 44, 42, 5000);
  assert.ok(path.length > 0);
  assert.deepEqual(path.at(-1), { x: 44, y: 42 });
  assert.deepEqual(path[0], { x: 41, y: 42 });
});

test('cada paso del camino es adyacente y transitable', () => {
  const path = findPath(world, 40, 42, 40, 40, 5000);
  let prev = { x: 40, y: 42 };
  for (const step of path) {
    assert.ok(isWalkable(world, step.x, step.y));
    assert.ok(Math.abs(step.x - prev.x) <= 1);
    assert.ok(Math.abs(step.y - prev.y) <= 1);
    assert.ok(step.x !== prev.x || step.y !== prev.y);
    prev = step;
  }
  assert.deepEqual(prev, { x: 40, y: 40 });
});

test('no devuelve camino hacia un obstáculo', () => {
  assert.deepEqual(findPath(world, 40, 42, -1, -1, 5000), []);
});

test('no devuelve camino si inicio y destino coinciden', () => {
  assert.deepEqual(findPath(world, 40, 42, 40, 42, 5000), []);
});

test('pathToDirections convierte el camino en direcciones', () => {
  const dirs = pathToDirections([
    { x: 40, y: 42 },
    { x: 41, y: 42 },
    { x: 41, y: 43 },
  ]);
  assert.deepEqual(dirs, [[1, 0], [0, 1]]);
});
