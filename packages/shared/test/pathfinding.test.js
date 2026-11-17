import assert from 'node:assert/strict';
import test from 'node:test';
import { SPAWN_POINT, findPath, generateWorld, isWalkable, pathToDirections } from '../src/index.js';

const world = generateWorld(1337);

test('A* encuentra un camino entre dos puntos transitables', () => {
  const path = findPath(world, SPAWN_POINT.x, SPAWN_POINT.y, SPAWN_POINT.x + 4, SPAWN_POINT.y, 5000);
  assert.ok(path.length > 0);
  assert.deepEqual(path.at(-1), { x: SPAWN_POINT.x + 4, y: SPAWN_POINT.y });
  assert.deepEqual(path[0], { x: SPAWN_POINT.x + 1, y: SPAWN_POINT.y });
});

test('cada paso del camino es adyacente y transitable', () => {
  const path = findPath(world, SPAWN_POINT.x, SPAWN_POINT.y, SPAWN_POINT.x, SPAWN_POINT.y - 2, 5000);
  let prev = { x: SPAWN_POINT.x, y: SPAWN_POINT.y };
  for (const step of path) {
    assert.ok(isWalkable(world, step.x, step.y));
    assert.ok(Math.abs(step.x - prev.x) <= 1);
    assert.ok(Math.abs(step.y - prev.y) <= 1);
    assert.ok(step.x !== prev.x || step.y !== prev.y);
    prev = step;
  }
  assert.deepEqual(prev, { x: SPAWN_POINT.x, y: SPAWN_POINT.y - 2 });
});

test('no devuelve camino hacia un obstáculo', () => {
  assert.deepEqual(findPath(world, SPAWN_POINT.x, SPAWN_POINT.y, -1, -1, 5000), []);
});

test('no devuelve camino si inicio y destino coinciden', () => {
  assert.deepEqual(findPath(world, SPAWN_POINT.x, SPAWN_POINT.y, SPAWN_POINT.x, SPAWN_POINT.y, 5000), []);
});

test('pathToDirections convierte el camino en direcciones', () => {
  const dirs = pathToDirections([
    { x: 40, y: 42 },
    { x: 41, y: 42 },
    { x: 41, y: 43 },
  ]);
  assert.deepEqual(dirs, [[1, 0], [0, 1]]);
});