import {
  CLASSES,
  EQUIP_SLOTS,
  ITEMS,
  MOVE,
  SKILLS,
  moveDelayMs,
  skillXpToNext,
  xpToNextLevel,
} from './config.js';

/**
 * Fórmulas puras de combate y progresión.
 * No conocen el servidor ni el cliente: son fáciles de testear y balancear.
 */

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function randInt(min, max, rng = Math.random) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pickWeighted(entries, rng = Math.random) {
  const total = entries.reduce((acc, e) => acc + e.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

/** XP total acumulada necesaria para alcanzar `level` desde nivel 1. */
export function totalXpForLevel(level) {
  let total = 0;
  for (let l = 1; l < level; l += 1) total += xpToNextLevel(l);
  return total;
}

/**
 * Estadísticas derivadas. Se recalculan SIEMPRE en el servidor.
 * El cliente sólo recibe el resultado (nunca confía en sus propios números).
 */
export function computeStats({ level, skills, equipmentDefs = [] }) {
  const s = {
    melee: skills?.melee?.level ?? 1,
    distance: skills?.distance?.level ?? 1,
    magic: skills?.magic?.level ?? 1,
    defense: skills?.defense?.level ?? 1,
  };

  let maxHp = 45 + level * 18;
  let maxMp = 25 + level * 9;
  let defense = level * 0.5 + s.defense * 2.2;
  let bonusAtk = 0;
  let speedBonus = 0;
  let critChance = 0.04;

  for (const item of equipmentDefs) {
    if (!item?.stats) continue;
    maxHp += item.stats.maxHp ?? 0;
    maxMp += item.stats.maxMp ?? 0;
    defense += item.stats.defense ?? 0;
    // El arma ya aporta su daño base en rollAttack; aquí sólo cuentan anillos/amuletos.
    if (item.slot !== 'weapon') {
      bonusAtk += (item.stats.atkMin ?? 0) * 0.5 + (item.stats.atkMax ?? 0) * 0.5;
    }
    speedBonus += item.stats.speed ?? 0;
    critChance += item.stats.crit ?? 0;
  }

  const moveMs = Math.max(MOVE.MIN_TILE_MS - 20, moveDelayMs(level) - speedBonus);

  return {
    maxHp: Math.round(maxHp),
    maxMp: Math.round(maxMp),
    defense: Math.round(defense * 10) / 10,
    bonusAtk: Math.round(bonusAtk * 10) / 10,
    critChance: clamp(critChance, 0, 0.5),
    moveMs,
    skills: s,
  };
}

export function classForWeapon(itemId) {
  return ITEMS[itemId]?.weaponClass ?? null;
}

export function skillForClass(classId) {
  return CLASSES[classId]?.skill ?? 'melee';
}

/**
 * Daño bruto de un ataque. `rng` inyectable para tests.
 * Devuelve { raw, crit } antes de la reducción por defensa.
 */
export function rollAttack({
  weapon,
  skillLevel,
  level,
  bonusAtk = 0,
  critChance = 0.04,
  rng = Math.random,
}) {
  const atkMin = weapon?.stats?.atkMin ?? 1;
  const atkMax = weapon?.stats?.atkMax ?? 2;
  const base = randInt(atkMin, atkMax, rng);
  const skillScale = 1 + (skillLevel - 1) * 0.055;
  const levelScale = 1 + (level - 1) * 0.015;
  const crit = rng() < critChance;
  const critMult = crit ? 1.65 : 1;
  const raw = (base + bonusAtk) * skillScale * levelScale * critMult;
  return { raw: Math.max(1, raw), crit };
}

/** Reducción por defensa con rendimientos decrecientes. */
export function mitigate(raw, defense) {
  const reduction = 100 / (100 + Math.max(0, defense) * 2.2);
  return Math.max(1, Math.round(raw * reduction));
}

export function resolveHit(params) {
  const { raw, crit } = rollAttack(params);
  const amount = mitigate(raw, params.targetDefense ?? 0);
  return { amount, crit };
}

/** XP de monstruo ajustada por diferencia de nivel (evita farmear bichos triviales). */
export function monsterXp(def, playerLevel) {
  const diff = def.level - playerLevel;
  const scale = clamp(1.15 + diff * 0.05, 0.25, 1.5);
  return Math.max(1, Math.round(def.xp * scale));
}

/** XP de habilidad ganada por golpe. */
export function skillXpForHit(damage, isSpecial = false) {
  return Math.max(1, Math.round(damage * 0.35 + (isSpecial ? 3 : 1)));
}

export function defenseXpForHit(damage) {
  return Math.max(1, Math.round(damage * 0.25 + 0.5));
}

/**
 * Suma XP de habilidad y devuelve cuántos niveles se ganaron.
 * Muta el objeto de skill (el server es dueño del estado).
 */
export function grantSkillXp(skill, amount) {
  skill.xp += amount;
  let levels = 0;
  let guard = 0;
  while (skill.xp >= skillXpToNext(skill.level) && skill.level < 200 && guard < 100) {
    skill.xp -= skillXpToNext(skill.level);
    skill.level += 1;
    levels += 1;
    guard += 1;
  }
  return levels;
}

/** Suma XP de personaje. Devuelve niveles ganados y estadísticas nuevas. */
export function grantCharacterXp(character, amount) {
  character.xp += amount;
  let levels = 0;
  let guard = 0;
  while (character.xp >= xpToNextLevel(character.level) && character.level < 200 && guard < 100) {
    character.xp -= xpToNextLevel(character.level);
    character.level += 1;
    levels += 1;
    guard += 1;
  }
  return levels;
}

export function skullForPvpAction(killed) {
  return killed ? 'red' : 'yellow';
}

/** Probabilidad/estructura de drop. El dueño lo decide el servidor. */
export function rollLootTable(lootTable = [], rng = Math.random) {
  const drops = [];
  for (const entry of lootTable) {
    if (rng() < entry.chance) {
      drops.push({
        itemId: entry.itemId,
        qty: randInt(entry.min ?? 1, entry.max ?? 1, rng),
      });
    }
  }
  return drops;
}

export function manaCostForAttack(weapon) {
  return weapon?.manaCost ?? 0;
}

export function ammoForAttack(weapon) {
  return weapon?.ammo ?? null;
}

export function classLabel(classId) {
  return CLASSES[classId]?.name ?? 'Aventurero';
}

export function skillLabel(skillId) {
  return SKILLS[skillId]?.name ?? skillId;
}

export function equipmentDefsFrom(equipment) {
  const defs = [];
  for (const slot of EQUIP_SLOTS) {
    const inst = equipment?.[slot];
    if (inst && ITEMS[inst.itemId]) defs.push(ITEMS[inst.itemId]);
  }
  return defs;
}
