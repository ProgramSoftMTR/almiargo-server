import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  SPAWN_POINT,
  TILE,
  generateWorld,
  isPvPZone,
  isSafeZone,
  isWalkable,
  tileAt,
  tileRenderColor,
} from '../src/index.js';

test('el mundo es determinista para la misma semilla', () => {
  const a = generateWorld(1337);
  const b = generateWorld(1337);
  assert.equal(a.width, MAP_WIDTH);
  assert.equal(a.height, MAP_HEIGHT);
  assert.equal(a.tiles.length, MAP_WIDTH * MAP_HEIGHT);
  assert.deepEqual([...a.tiles], [...b.tiles]);
});

test('semillas distintas producen mapas distintos', () => {
  const a = generateWorld(1);
  const b = generateWorld(2);
  assert.notDeepEqual([...a.tiles], [...b.tiles]);
});

test('todas las celdas usan ids de tile válidos y tienen color', () => {
  const world = generateWorld(1337);
  const valid = new Set(Object.values(TILE));
  for (const tile of world.tiles) assert.ok(valid.has(tile));
  assert.match(String(tileRenderColor(TILE.GRASS, 0, 0)), /^\d+$/);
});

test('el spawn y sus alrededores son transitables', () => {
  const world = generateWorld(1337);
  assert.equal(isWalkable(world, SPAWN_POINT.x, SPAWN_POINT.y), true);
  assert.equal(isWalkable(world, -1, -1), false);
  assert.equal(tileAt(world, -1, -1), TILE.WALL);
});

test('las zonas segura y PvP se detectan por coordenadas', () => {
  assert.equal(isSafeZone(40, 42), true);
  assert.equal(isSafeZone(5, 5), false);
  assert.equal(isPvPZone(10, 10), true);
  assert.equal(isPvPZone(40, 42), false);
});
