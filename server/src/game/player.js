import {
  CLASSES,
  CONSTANTS,
  EQUIP_SLOTS,
  INVENTORY_SLOTS,
  ITEMS,
  SKILLS,
  addItem,
  clamp,
  computeStats,
  createStarterInventory,
  emptyInventory,
  equipmentDefsFrom,
  getItemDef,
  normalizeInventory,
  removeItemById,
  removeItemByUid,
  serializeSkill,
  skillXpToNext,
  skillXpForHit,
  xpToNextLevel,
} from '../../shared/index.js';
import { ENTITY_KIND } from '../../shared/index.js';

const DEFAULT_OUTFIT = {
  color1: '#c84b4b',
  color2: '#2a2f3a',
  color3: '#4a3520',
  color4: '#d8a37b',
  color5: '#FFDAB9',
};

/** Crea el estado inicial de un personaje nuevo. */
export function createCharacterState(name, id) {
  const skills = {
    melee: { level: 1, xp: 0 },
    distance: { level: 1, xp: 0 },
    magic: { level: 1, xp: 0 },
    defense: { level: 1, xp: 0 },
  };
  const inventory = emptyInventory();
  for (const item of createStarterInventory()) {
    addItem(inventory, item.itemId, item.qty, item.uid);
  }
  // La espada inicial se equipa automáticamente.
  const swordIdx = inventory.findIndex((i) => i?.itemId === 'sword_wood');
  const sword = swordIdx >= 0 ? inventory[swordIdx] : null;
  if (swordIdx >= 0) inventory[swordIdx] = null;
  const equipment = Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, null]));
  equipment.mano = sword;

  const player = new PlayerState({
    id,
    name,
    level: 1,
    xp: 0,
    gold: 100,
    hp: 100,
    mp: 50,
    x: 40,
    y: 42,
    dir: 'down',
    skull: 'none',
    skullUntil: 0,
    skills,
    inventory,
    equipment,
    clan: null,
    stall: null,
    outfit: { ...DEFAULT_OUTFIT },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  player.recalc();
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  return player.toState();
}

/**
 * Estructura viva del jugador. Los campos de red (sessionId, timers) no se
 * persisten: `toState()` devuelve sólo lo que va a base de datos.
 */
export class PlayerState {
  constructor(state) {
    const base = {
      level: 1,
      xp: 0,
      gold: 0,
      hp: 50,
      mp: 20,
      x: 40,
      y: 42,
      dir: 'down',
      skull: 'none',
      skullUntil: 0,
      clan: null,
      stall: null,
      isAdmin: false,
      nameColor: null,
      invisible: false,
      godMode: false,
      ...state,
    };
    Object.assign(this, base);
    this.id = base.id;
    this.name = base.name;
    this.kind = ENTITY_KIND.PLAYER;

    this.skills = {
      melee: { level: 1, xp: 0, ...(base.skills?.melee ?? {}) },
      distance: { level: 1, xp: 0, ...(base.skills?.distance ?? {}) },
      magic: { level: 1, xp: 0, ...(base.skills?.magic ?? {}) },
      defense: { level: 1, xp: 0, ...(base.skills?.defense ?? {}) },
    };
    this.inventory = normalizeInventory(base.inventory);
    this.equipment = Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, base.equipment?.[slot] ?? null]));
    this.gold = Math.max(0, Math.min(CONSTANTS.MAX_GOLD, Math.floor(Number(this.gold) || 0)));
    this.xp = Math.max(0, Math.floor(Number(this.xp) || 0));
    this.level = clamp(Math.floor(Number(this.level) || 1), 1, 200);
    this.hp = Math.max(0, Math.floor(Number(this.hp) || 0));
    this.mp = Math.max(0, Math.floor(Number(this.mp) || 0));
    this.x = Number(this.x);
    this.y = Number(this.y);
    this.clan = typeof this.clan === 'string' ? this.clan.slice(0, 16) : null;
    // Privilegios del personaje: sólo el servidor los asigna (ver admin.js).
    this.isAdmin = base.isAdmin === true;
    this.nameColor = typeof base.nameColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(base.nameColor)
      ? base.nameColor
      : null;
    const baseOutfit = base.outfit && typeof base.outfit === 'object' ? base.outfit : null;
    const normalizedOutfit = baseOutfit ? { ...baseOutfit } : null;
    if (normalizedOutfit) {
      for (const key of ['color1','color2','color3','color4','color5']) {
        if (String(normalizedOutfit[key] ?? '').toUpperCase() === '#000000') normalizedOutfit[key] = '#010101';
      }
    }
    this.outfit = normalizedOutfit
      ? { ...DEFAULT_OUTFIT, ...normalizedOutfit }
      : { ...DEFAULT_OUTFIT };
    // Estado de "modo creativo" (sólo en memoria: no se persiste).
    this.invisible = base.invisible === true;
    this.godMode = base.godMode === true;
    this.adminSummonSeq = 0;

    // Runtime (no persistente)
    this.sessionId = null;
    this.targetId = null;
    this.nextMoveAt = 0;
    this.nextAttackAt = 0;
    this.nextSpecialAt = 0;
    this.nextPotionAt = 0;
    this.nextSwitchAt = 0;
    this.nextRegenAt = 0;
    this.deadUntil = 0;
    this.inCombatUntil = 0;
    this.dirty = false;
    this.lastChatAt = 0;

    this.stats = { maxHp: 100, maxMp: 50, defense: 0, bonusAtk: 0, critChance: 0.04, moveMs: 260, skills: {} };
    this.recalc();
    if (this.hp <= 0) this.hp = this.maxHp;
    this.hp = Math.min(this.hp, this.maxHp);
    this.mp = Math.min(this.mp, this.maxMp);
  }

  get hasAxe() {
    return this.equipment?.mano?.itemId === 'axe';
  }

  get classId() {
    const weapon = getItemDef(this.equipment?.mano?.itemId);
    if (!weapon) return 'adventurer';
    return weapon.weaponClass ?? 'knight';
  }

  get weapon() {
    return getItemDef(this.equipment?.mano?.itemId);
  }

  get weaponDef() {
    return this.weapon;
  }

  get skillId() {
    return CLASSES[this.classId]?.skill ?? 'melee';
  }

  get attackSkillLevel() {
    return this.skills[this.skillId]?.level ?? 1;
  }

  get isDead() {
    return this.hp <= 0;
  }

  get moveMs() {
    return this.stats.moveMs;
  }

  get skullActive() {
    return this.skull !== 'none' && this.skullUntil > Date.now();
  }

  recalc() {
    const defs = equipmentDefsFrom(this.equipment);
    const oldMaxHp = this.maxHp ?? 0;
    const oldMaxMp = this.maxMp ?? 0;
    this.stats = computeStats({ level: this.level, skills: this.skills, equipmentDefs: defs });
    this.maxHp = this.stats.maxHp;
    this.maxMp = this.stats.maxMp;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.mp > this.maxMp) this.mp = this.maxMp;
    if (this.hp <= 0 && oldMaxHp > 0) this.hp = 0;
    if (this.mp < 0) this.mp = 0;
    return { oldMaxHp, oldMaxMp, maxHp: this.maxHp, maxMp: this.maxMp };
  }

  addItem(itemId, qty = 1, uid) {
    return addItem(this.inventory, itemId, qty, uid);
  }

  countItem(itemId) {
    return this.inventory.reduce((acc, s) => acc + (s?.itemId === itemId ? s.qty : 0), 0);
  }

  findInventoryUid(uid) {
    return this.inventory.find((s) => s?.uid === uid) ?? null;
  }

  removeItemUid(uid, qty = 1) {
    return removeItemByUid(this.inventory, uid, qty);
  }

  removeItemId(itemId, qty = 1) {
    return removeItemById(this.inventory, itemId, qty);
  }

  /** Equipa desde inventario. Devuelve {ok, error}. */
  equipUid(uid, now = Date.now()) {
    const idx = this.inventory.findIndex((s) => s?.uid === uid);
    if (idx < 0) return { ok: false, error: 'Ítem no encontrado' };
    const inst = this.inventory[idx];
    const def = getItemDef(inst.itemId);
    if (!def) return { ok: false, error: 'Ítem inválido' };
    if (!EQUIP_SLOTS.includes(def.slot)) return { ok: false, error: 'Este ítem no se puede equipar' };
    if (this.level < (def.levelReq ?? 1)) return { ok: false, error: `Requiere nivel ${def.levelReq}` };

    if (def.slot === 'mano' && now < this.nextSwitchAt) {
      return { ok: false, error: 'Cambio de arma en enfriamiento' };
    }

    const previous = this.equipment[def.slot];
    this.inventory[idx] = null;
    if (previous) this.inventory[idx] = previous;
    this.equipment[def.slot] = inst;
    if (def.slot === 'mano') this.nextSwitchAt = now + CONSTANTS.CLASS_SWITCH_COOLDOWN_MS;
    this.recalc();
    this.dirty = true;
    return { ok: true, slot: def.slot };
  }

  unequipSlot(slot, now = Date.now()) {
    if (!EQUIP_SLOTS.includes(slot)) return { ok: false, error: 'Slot inválido' };
    const inst = this.equipment[slot];
    if (!inst) return { ok: false, error: 'Slot vacío' };
    if (slot === 'mano' && now < this.nextSwitchAt) {
      return { ok: false, error: 'Cambio de arma en enfriamiento' };
    }
    const free = this.inventory.findIndex((s) => s === null);
    if (free < 0) return { ok: false, error: 'Inventario lleno' };
    this.inventory[free] = inst;
    this.equipment[slot] = null;
    if (slot === 'mano') this.nextSwitchAt = now + CONSTANTS.CLASS_SWITCH_COOLDOWN_MS;
    this.recalc();
    this.dirty = true;
    return { ok: true };
  }

  /**
   * Cambio de clase fluido: busca la mejor arma de esa clase poseída
   * (inventario o equipada) y la equipa. 1s de cooldown.
   */
  switchClass(classId, now = Date.now()) {
    if (!CLASSES[classId]) return { ok: false, error: 'Clase inválida' };
    if (now < this.nextSwitchAt) {
      const left = Math.ceil((this.nextSwitchAt - now) / 100) / 10;
      return { ok: false, error: `Espera ${left}s para cambiar de arma` };
    }
    if (this.classId === classId) return { ok: false, error: 'Ya usas esa clase' };

    let best = null;
    let bestTier = -1;
    for (const inst of this.inventory) {
      if (!inst) continue;
      const def = getItemDef(inst.itemId);
      if (def?.slot !== 'weapon' || def.weaponClass !== classId) continue;
      if (this.level < (def.levelReq ?? 1)) continue;
      if ((def.tier ?? 0) > bestTier) { best = inst; bestTier = def.tier ?? 0; }
    }
    if (!best) return { ok: false, error: `No tienes armas de ${CLASSES[classId].name}` };
    const result = this.equipUid(best.uid, now);
    if (result.ok) this.nextSwitchAt = now + CONSTANTS.CLASS_SWITCH_COOLDOWN_MS;
    return result;
  }

  useConsumable(uid, now = Date.now()) {
    if (this.isDead || now < this.deadUntil) return { ok: false, error: 'Estás muerto' };
    if (now < this.nextPotionAt) return { ok: false, error: 'Poción en enfriamiento' };
    const inst = this.findInventoryUid(uid);
    if (!inst) return { ok: false, error: 'Ítem no encontrado' };
    const def = getItemDef(inst.itemId);
    if (!def?.use) return { ok: false, error: 'Este ítem no es consumible' };
    let healed = 0;
    let healedMp = 0;
    if (def.use.healHp) {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + def.use.healHp);
      healed = this.hp - before;
    }
    if (def.use.healMp) {
      const before = this.mp;
      this.mp = Math.min(this.maxMp, this.mp + def.use.healMp);
      healedMp = this.mp - before;
    }
    if (healed === 0 && healedMp === 0) return { ok: false, error: 'Ya estás al máximo' };
    this.removeItemUid(uid, 1);
    this.nextPotionAt = now + CONSTANTS.POTION_COOLDOWN_MS;
    this.dirty = true;
    return { ok: true, healed, healedMp, itemId: inst.itemId };
  }

  /**
   * Otorga XP de habilidad. Devuelve niveles subidos (0 si no).
   * El llamador debe hacer recalc() y notificar al cliente.
   */
  gainSkillXp(skillId, amount) {
    const skill = this.skills[skillId];
    if (!skill) return 0;
    return grantSkillXpOnSkill(skill, amount);
  }

  toState() {
    const {
      sessionId, targetId, nextMoveAt, nextAttackAt, nextSpecialAt, nextPotionAt,
      nextSwitchAt, nextRegenAt, deadUntil, inCombatUntil, dirty, stats, kind,
      lastChatAt, maxHp, maxMp, lastAttackerId, lastAttackerKind,
      invisible, godMode, adminSummonSeq, ...persisted
    } = this;
    return structuredClone(persisted);
  }

  toProfile() {
    return {
      id: this.id,
      name: this.name,
      level: this.level,
      xp: this.xp,
      xpNext: xpToNextLevel(this.level),
      gold: this.gold,
      hp: Math.round(this.hp),
      mp: Math.round(this.mp),
      maxHp: this.maxHp,
      maxMp: this.maxMp,
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      dir: this.dir,
      classId: this.classId,
      skull: this.skullActive ? this.skull : 'none',
      skullUntil: this.skullUntil,
      skills: {
        melee: serializeSkill(this.skills.melee),
        distance: serializeSkill(this.skills.distance),
        magic: serializeSkill(this.skills.magic),
        defense: serializeSkill(this.skills.defense),
      },
      stats: {
        defense: Math.round(this.stats.defense),
        bonusAtk: Math.round(this.stats.bonusAtk * 10) / 10,
        moveMs: this.stats.moveMs,
        critChance: Math.round(this.stats.critChance * 1000) / 1000,
      },
      equipment: this.equipment,
      inventory: this.inventory,
      clan: this.clan,
      isAdmin: this.isAdmin === true,
      nameColor: this.nameColor ?? null,
      outfit: this.outfit ?? { ...DEFAULT_OUTFIT },
      weaponTexture: this.classId ? `weapon_${this.classId}` : null,
      hasAxe: this.hasAxe === true,
      invisible: this.invisible === true,
      godMode: this.godMode === true,
      inStall: !!this.stall,
      stall: this.stall ? { items: this.stall.items, createdAt: this.stall.createdAt } : null,
      nextAttackAt: this.nextAttackAt,
      nextSpecialAt: this.nextSpecialAt,
      nextSwitchAt: this.nextSwitchAt,
    };
  }
}

function grantSkillXpOnSkill(skill, amount) {
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

/** Serialización compacta usada en snapshots. */
export function playerWire(player) {
  return [
    player.id,
    ENTITY_KIND.PLAYER,
    Math.round(player.x * 100) / 100,
    Math.round(player.y * 100) / 100,
    player.dir,
    Math.max(0, Math.round((player.hp / player.maxHp) * 100)),
    player.name,
    player.skullActive ? player.skull : 'none',
    player.classId,
    player.level,
    player.nameColor ?? null,
  ];
}

export function hydratePlayerState(raw) {
  return new PlayerState(raw);
}
