import {
  CLASSES,
  EQUIP_SLOTS,
  INVENTORY_SLOTS,
  ITEMS,
  STARTER_ITEMS,
  skillXpToNext,
  xpToNextLevel,
} from './config.js';

/** Utilidades de ítems e inventario, puras y compartidas. */

let uidCounter = 0;
export function makeUid(prefix = 'i') {
  uidCounter = (uidCounter + 1) % 0xffffff;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getItemDef(itemId) {
  return ITEMS[itemId] ?? null;
}

export function createItem(itemId, qty = 1, uid = makeUid()) {
  return { uid, itemId, qty };
}

export function createStarterInventory() {
  return STARTER_ITEMS.map((s) => createItem(s.itemId, s.qty));
}

export function emptyInventory() {
  return new Array(INVENTORY_SLOTS).fill(null);
}

export function normalizeInventory(inventory) {
  const out = Array.isArray(inventory) ? inventory.slice(0, INVENTORY_SLOTS) : [];
  while (out.length < INVENTORY_SLOTS) out.push(null);
  return out;
}

export function countItem(inventory, itemId) {
  return inventory.reduce((acc, slot) => {
    if (slot?.itemId === itemId) return acc + slot.qty;
    return acc;
  }, 0);
}

/**
 * Añade un ítem al inventario (stackeando si procede).
 * Devuelve `{added, left}`; no destruye el ítem si no hay espacio.
 */
export function addItem(inventory, itemId, qty = 1, uid = makeUid()) {
  const def = ITEMS[itemId];
  if (!def) return { added: 0, left: qty };
  let left = qty;
  const inv = normalizeInventory(inventory);

  if (def.stackable) {
    for (const slot of inv) {
      if (!slot || slot.itemId !== itemId) continue;
      if (slot.qty >= 9999) continue;
      const space = 9999 - slot.qty;
      const moved = Math.min(space, left);
      slot.qty += moved;
      left -= moved;
      if (left <= 0) break;
    }
  }

  while (left > 0) {
    const free = inv.findIndex((s) => s === null);
    if (free < 0) break;
    const moved = def.stackable ? Math.min(left, 9999) : 1;
    inv[free] = { uid: left === qty ? uid : makeUid(), itemId, qty: moved };
    left -= moved;
    if (!def.stackable && left > 0) {
      // Un ítem no apilable ocupa un slot por unidad; continuar hasta llenar.
      continue;
    }
  }

  // Copia los slots al array original para conservar la referencia.
  for (let i = 0; i < INVENTORY_SLOTS; i += 1) inventory[i] = inv[i];
  return { added: qty - left, left };
}

export function removeItemByUid(inventory, uid, qty = 1) {
  const idx = inventory.findIndex((s) => s?.uid === uid);
  if (idx < 0) return { removed: 0, item: null };
  const slot = inventory[idx];
  const removed = Math.min(qty, slot.qty);
  slot.qty -= removed;
  const item = { ...slot, qty: removed };
  if (slot.qty <= 0) inventory[idx] = null;
  return { removed, item };
}

export function removeItemById(inventory, itemId, qty = 1) {
  let left = qty;
  const removed = [];
  for (let i = 0; i < inventory.length && left > 0; i += 1) {
    const slot = inventory[i];
    if (slot?.itemId !== itemId) continue;
    const take = Math.min(slot.qty, left);
    removed.push({ ...slot, qty: take });
    slot.qty -= take;
    left -= take;
    if (slot.qty <= 0) inventory[i] = null;
  }
  return { removed: qty - left, items: removed };
}

export function findFreeSlots(inventory) {
  return inventory.filter((s) => s === null).length;
}

export function hasSpaceFor(inventory, itemId, qty = 1) {
  const def = ITEMS[itemId];
  if (!def) return false;
  if (def.stackable) {
    const free = findFreeSlots(inventory);
    let stackSpace = 0;
    for (const slot of inventory) {
      if (slot?.itemId === itemId) stackSpace += 9999 - slot.qty;
    }
    return free > 0 || stackSpace >= qty;
  }
  return findFreeSlots(inventory) >= qty;
}

export function totalSellValue(inventory) {
  return inventory.reduce((acc, slot) => {
    if (!slot) return acc;
    const def = ITEMS[slot.itemId];
    return acc + (def?.sell ?? 0) * slot.qty;
  }, 0);
}

/** Mejor arma poseída de una clase, priorizando la equipada. */
export function bestWeaponForClass(character, classId) {
  const equipped = character.equipment?.weapon;
  if (equipped && ITEMS[equipped.itemId]?.weaponClass === classId) return equipped;
  let best = null;
  let bestTier = -1;
  for (const slot of character.inventory ?? []) {
    if (!slot) continue;
    const def = ITEMS[slot.itemId];
    if (def?.slot !== 'weapon' || def.weaponClass !== classId) continue;
    if ((def.tier ?? 0) > bestTier && character.level >= (def.levelReq ?? 1)) {
      best = slot;
      bestTier = def.tier ?? 0;
    }
  }
  return best;
}

export function validEquipmentSlot(slot) {
  return EQUIP_SLOTS.includes(slot);
}

export function classOfCharacter(character) {
  const weaponId = character.equipment?.weapon?.itemId;
  return ITEMS[weaponId]?.weaponClass ?? 'knight';
}

export function weaponRange(classId) {
  return CLASSES[classId]?.range ?? 1.35;
}

export function serializeSkill(skill) {
  return { level: skill.level, xp: skill.xp, xpNext: skillXpToNext(skill.level) };
}

export function serializeProgress(character) {
  return {
    level: character.level,
    xp: character.xp,
    xpNext: xpToNextLevel(character.level),
  };
}
