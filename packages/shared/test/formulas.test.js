import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ITEMS,
  computeStats,
  grantCharacterXp,
  grantSkillXp,
  mitigate,
  monsterXp,
  resolveHit,
  rollAttack,
  skillXpForHit,
  skullForPvpAction,
  totalXpForLevel,
  xpToNextLevel,
} from '../src/index.js';

const baseSkills = () => ({
  melee: { level: 1, xp: 0 },
  distance: { level: 1, xp: 0 },
  magic: { level: 1, xp: 0 },
  defense: { level: 1, xp: 0 },
});

test('la curva de nivel es positiva y creciente', () => {
  assert.equal(xpToNextLevel(1), 120);
  for (let level = 1; level < 100; level += 1) {
    assert.ok(xpToNextLevel(level) > 0);
    assert.ok(xpToNextLevel(level + 1) > xpToNextLevel(level));
  }
  assert.equal(totalXpForLevel(3), xpToNextLevel(1) + xpToNextLevel(2));
});

test('computeStats deriva HP, maná, defensa y velocidad', () => {
  const stats = computeStats({ level: 1, skills: baseSkills(), equipmentDefs: [] });
  assert.equal(stats.maxHp, 63);
  assert.equal(stats.maxMp, 34);
  assert.equal(stats.defense, 2.7);
  assert.equal(stats.moveMs, 260);
  assert.equal(stats.bonusAtk, 0);
});

test('el arma no duplica su ataque en bonusAtk, los anillos sí', () => {
  const stats = computeStats({
    level: 1,
    skills: baseSkills(),
    equipmentDefs: [ITEMS.sword_wood, ITEMS.ring_str],
  });
  assert.equal(stats.bonusAtk, 2);
  assert.equal(stats.defense, 3.7);
});

test('la defensa reduce el daño con rendimientos decrecientes', () => {
  assert.equal(mitigate(100, 0), 100);
  assert.equal(mitigate(100, 50), 48);
  assert.ok(mitigate(100, 200) < mitigate(100, 50));
  assert.equal(mitigate(1, 999), 1, 'el daño mínimo siempre es 1');
});

test('rollAttack es determinista con un RNG inyectado', () => {
  const values = [0, 0.5];
  const rng = () => values.shift() ?? 0.5;
  const hit = rollAttack({
    weapon: ITEMS.sword_wood,
    skillLevel: 1,
    level: 1,
    bonusAtk: 0,
    critChance: 0.04,
    rng,
  });
  assert.equal(hit.crit, false);
  assert.equal(hit.raw, 4);
  const resolved = resolveHit({
    weapon: ITEMS.sword_wood,
    skillLevel: 1,
    level: 1,
    targetDefense: 0,
    critChance: 0,
    rng: () => 0,
  });
  assert.equal(resolved.amount, 4);
});

test('el crítico multiplica el daño bruto', () => {
  const normal = rollAttack({
    weapon: ITEMS.sword_wood,
    skillLevel: 1,
    level: 1,
    critChance: 0,
    rng: () => 0,
  });
  const critical = rollAttack({
    weapon: ITEMS.sword_wood,
    skillLevel: 1,
    level: 1,
    critChance: 1,
    rng: () => 0,
  });
  assert.equal(critical.crit, true);
  assert.ok(critical.raw > normal.raw);
});

test('la XP de monstruo escala pero nunca llega a cero', () => {
  const def = { level: 1, xp: 18 };
  const low = monsterXp(def, 1);
  const high = monsterXp(def, 80);
  assert.ok(low > high);
  assert.ok(high >= 1);
});

test('la XP de habilidad crece con el daño y las especiales', () => {
  assert.ok(skillXpForHit(10, true) > skillXpForHit(10, false));
  assert.ok(skillXpForHit(10) >= 1);
});

test('subir de nivel consume la XP y respeta el tope', () => {
  const character = { level: 1, xp: xpToNextLevel(1) };
  const levels = grantCharacterXp(character, 0);
  assert.equal(levels, 1);
  assert.equal(character.level, 2);
  assert.equal(character.xp, 0);

  const capped = { level: 200, xp: 0 };
  assert.equal(grantCharacterXp(capped, 10_000_000), 0);
  assert.equal(capped.level, 200);
});

test('subir habilidad acumula niveles y conserva el excedente', () => {
  const skill = { level: 1, xp: 0 };
  const next = 30 * Math.pow(1, 1.55) + 20;
  const levels = grantSkillXp(skill, next + 5);
  assert.equal(levels, 1);
  assert.equal(skill.level, 2);
  assert.equal(skill.xp, 5);
});

test('las calaveras PvP se asignan por acción', () => {
  assert.equal(skullForPvpAction(false), 'yellow');
  assert.equal(skullForPvpAction(true), 'red');
});
