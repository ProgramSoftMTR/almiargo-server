/**
 * Constantes globales compartidas por servidor y cliente.
 * Todo valor de balance vive aquí: una sola fuente de verdad.
 */

export const TICK_RATE = 20;                 // ticks/s del servidor autoritativo
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 10;             // snapshots/s enviados al cliente
export const SNAPSHOT_EVERY_TICKS = TICK_RATE / SNAPSHOT_RATE;
export const INTERPOLATION_MS = 120;         // retardo de render (anti-jitter)

export const TILE_SIZE = 32;
export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 80;
export const WORLD_SEED = 1337;

export const AOI_RADIUS = 20;                // radio de interés en tiles
export const MAX_VISIBLE_ENTITIES = 180;

// ── Clases fluidas ─────────────────────────────────────────────
// El jugador no tiene clase fija: la clase se deriva del arma equipada.
export const CLASSES = Object.freeze({
  knight: {
    id: 'knight',
    name: 'Caballero',
    weaponSlot: 'weapon',
    skill: 'melee',
    range: 1.35,
    color: 0xd95d5d,
    description: 'Espadas. Cuerpo a cuerpo. Sube Melee y Defensa.',
  },
  archer: {
    id: 'archer',
    name: 'Arquero',
    weaponSlot: 'weapon',
    skill: 'distance',
    range: 7.5,
    color: 0x5dd98a,
    description: 'Arcos. A distancia. Consume flechas.',
  },
  mage: {
    id: 'mage',
    name: 'Mago',
    weaponSlot: 'weapon',
    skill: 'magic',
    range: 7,
    color: 0x6f8ce8,
    description: 'Báculos. Daño mágico a distancia. Consume maná.',
  },
  adventurer: {
    id: 'adventurer',
    name: 'Aventurero',
    weaponSlot: 'weapon',
    skill: 'melee',
    range: 1.35,
    color: 0x9aa7ba,
    description: 'Sin arma. Ataque básico desarmado.',
  },
});

export const SKILLS = Object.freeze({
  melee: { id: 'melee', name: 'Melee' },
  distance: { id: 'distance', name: 'Distance' },
  magic: { id: 'magic', name: 'Magic' },
  defense: { id: 'defense', name: 'Defense' },
});

export const SKULLS = Object.freeze({
  none: { id: 'none', color: 0x000000 },
  yellow: { id: 'yellow', color: 0xf2c94c }, // atacó a un jugador pacífico
  red: { id: 'red', color: 0xe04a4a },       // asesinó a un jugador pacífico (PK)
});

export const EQUIP_SLOTS = Object.freeze([
  'helmet', 'armor', 'legs', 'boots', 'weapon', 'shield', 'ring', 'amulet',
]);

export const INVENTORY_SLOTS = 30;

// ── Tiempos y límites ──────────────────────────────────────────
export const CONSTANTS = Object.freeze({
  CLASS_SWITCH_COOLDOWN_MS: 1000,
  POTION_COOLDOWN_MS: 900,
  SPECIAL_COOLDOWN_MS: 5000,
  SPECIAL_MANA_COST: 30,
  PLAYER_RESPAWN_MS: 4500,
  MONSTER_CORPSE_MS: 400,
  BAG_FREE_AFTER_MS: 45000,
  BAG_EXPIRE_MS: 180000,
  YELLOW_SKULL_MS: 60000,
  RED_SKULL_MS: 300000,
  SAFE_REGEN_INTERVAL_MS: 2500,
  WILD_REGEN_INTERVAL_MS: 5000,
  MAX_CHAT_LENGTH: 140,
  MAX_MESSAGE_BYTES: 4096,
  MAX_PATH_STEPS: 60,
  MAX_GOLD: 2_000_000_000,
  SAVE_INTERVAL_MS: 15000,
  // Tala de árboles (recolección de madera)
  CHOP_RANGE: 1.75,
  CHOP_COOLDOWN_MS: 900,
  WOOD_PER_CHOP: 2,
  TREE_RESPAWN_MIN_MS: 120000,
  TREE_RESPAWN_MAX_MS: 180000,
});

export const MOVE = Object.freeze({
  BASE_TILE_MS: 260,
  MIN_TILE_MS: 140,
  PER_LEVEL_MS: 1.3,
});

// ── Curvas de experiencia ──────────────────────────────────────
export function xpToNextLevel(level) {
  return Math.floor(80 * Math.pow(level, 1.65) + 40 * level);
}

export function skillXpToNext(level) {
  return Math.floor(30 * Math.pow(level, 1.55) + 20 * level);
}

export function moveDelayMs(level) {
  return Math.max(MOVE.MIN_TILE_MS, Math.round(MOVE.BASE_TILE_MS - (level - 1) * MOVE.PER_LEVEL_MS));
}

// ── Catálogo de ítems ──────────────────────────────────────────
export const ITEMS = Object.freeze({
  // Consumibles
  potion_hp: {
    id: 'potion_hp', name: 'Poción de Vida', slot: 'consumable', stackable: true,
    price: 12, sell: 4, icon: { shape: 'potion', color: 0xe04a4a },
    use: { healHp: 40 }, description: 'Restaura 40 HP.',
  },
  potion_mp: {
    id: 'potion_mp', name: 'Poción de Maná', slot: 'consumable', stackable: true,
    price: 15, sell: 5, icon: { shape: 'potion', color: 0x4a7ce0 },
    use: { healMp: 30 }, description: 'Restaura 30 MP.',
  },
  arrow: {
    id: 'arrow', name: 'Flecha', slot: 'ammo', stackable: true,
    price: 2, sell: 1, icon: { shape: 'arrow', color: 0xc8a165 },
    description: 'Munición para arcos.',
  },

  // Herramientas y recursos (tala)
  axe: {
    id: 'axe', name: 'Hacha', slot: 'weapon', weaponClass: 'adventurer', stackable: false,
    price: 45, sell: 15, tier: 1, levelReq: 1,
    stats: { atkMin: 2, atkMax: 4, defense: 0 }, cooldownMs: 900,
    icon: { shape: 'axe', color: 0xb8874e },
    description: 'Permite talar arboles para obtener madera.',
  },
  pickaxe: {
    id: 'pickaxe', name: 'Pico', slot: 'weapon', weaponClass: 'adventurer', stackable: false,
    price: 50, sell: 18, tier: 1, levelReq: 1,
    stats: { atkMin: 3, atkMax: 5, defense: 0 }, cooldownMs: 900,
    icon: { shape: 'pickaxe', color: 0x9aa0a6 },
    description: 'Permite picar rocas para obtener piedra.',
  },
  wood: {
    id: 'wood', name: 'Madera', slot: 'resource', stackable: true,
    price: 0, sell: 3, icon: { shape: 'wood', color: 0x8a6034 },
    description: 'Recurso obtenido al talar arboles.',
  },

  // Armas — Caballero
  sword_wood: {
    id: 'sword_wood', name: 'Espada de Madera', slot: 'weapon', weaponClass: 'knight',
    stackable: false, price: 30, sell: 10, tier: 1, levelReq: 1,
    stats: { atkMin: 4, atkMax: 8, defense: 1 }, cooldownMs: 900,
    icon: { shape: 'sword', color: 0xc8a165 }, description: 'Un arma humilde pero letal.',
  },
  sword_iron: {
    id: 'sword_iron', name: 'Espada de Hierro', slot: 'weapon', weaponClass: 'knight',
    stackable: false, price: 180, sell: 60, tier: 2, levelReq: 4,
    stats: { atkMin: 9, atkMax: 16, defense: 2 }, cooldownMs: 850,
    icon: { shape: 'sword', color: 0xd8dde6 }, description: 'Forjada para la guerra.',
  },
  sword_flame: {
    id: 'sword_flame', name: 'Espada Flamígera', slot: 'weapon', weaponClass: 'knight',
    stackable: false, price: 950, sell: 320, tier: 3, levelReq: 10,
    stats: { atkMin: 18, atkMax: 28, defense: 3 }, cooldownMs: 800,
    icon: { shape: 'sword', color: 0xff8a3d }, description: 'Arde con furia eterna.',
  },

  // Armas — Arquero
  bow_wood: {
    id: 'bow_wood', name: 'Arco de Madera', slot: 'weapon', weaponClass: 'archer',
    stackable: false, price: 30, sell: 10, tier: 1, levelReq: 1,
    stats: { atkMin: 3, atkMax: 7, defense: 0 }, cooldownMs: 720, ammo: 'arrow',
    icon: { shape: 'bow', color: 0xc8a165 }, description: 'Ligero y preciso.',
  },
  bow_oak: {
    id: 'bow_oak', name: 'Arco de Roble', slot: 'weapon', weaponClass: 'archer',
    stackable: false, price: 170, sell: 55, tier: 2, levelReq: 4,
    stats: { atkMin: 8, atkMax: 15, defense: 0 }, cooldownMs: 680, ammo: 'arrow',
    icon: { shape: 'bow', color: 0x9b6b3f }, description: 'Equilibrio perfecto.',
  },
  bow_storm: {
    id: 'bow_storm', name: 'Arco Tormenta', slot: 'weapon', weaponClass: 'archer',
    stackable: false, price: 900, sell: 300, tier: 3, levelReq: 10,
    stats: { atkMin: 16, atkMax: 26, defense: 0 }, cooldownMs: 620, ammo: 'arrow',
    icon: { shape: 'bow', color: 0x5dd98a }, description: 'Cada flecha es un relámpago.',
  },

  // Armas — Mago
  staff_wood: {
    id: 'staff_wood', name: 'Báculo de Madera', slot: 'weapon', weaponClass: 'mage',
    stackable: false, price: 30, sell: 10, tier: 1, levelReq: 1,
    stats: { atkMin: 4, atkMax: 9, defense: 0 }, cooldownMs: 1000, manaCost: 4,
    icon: { shape: 'staff', color: 0x6f8ce8 }, description: 'Canaliza energía arcana.',
  },
  staff_emerald: {
    id: 'staff_emerald', name: 'Báculo Esmeralda', slot: 'weapon', weaponClass: 'mage',
    stackable: false, price: 190, sell: 62, tier: 2, levelReq: 4,
    stats: { atkMin: 9, atkMax: 17, defense: 0 }, cooldownMs: 950, manaCost: 6,
    icon: { shape: 'staff', color: 0x38d996 }, description: 'Poder contenido en jade.',
  },
  staff_void: {
    id: 'staff_void', name: 'Báculo del Vacío', slot: 'weapon', weaponClass: 'mage',
    stackable: false, price: 980, sell: 330, tier: 3, levelReq: 10,
    stats: { atkMin: 18, atkMax: 30, defense: 0 }, cooldownMs: 900, manaCost: 8,
    icon: { shape: 'staff', color: 0xb06fe8 }, description: 'El vacío susurra tu nombre.',
  },

  // Armas de administrador (no se venden ni se dropean; sólo las otorga el panel admin).
  sword_admin: {
    id: 'sword_admin', name: 'Espada del Administrador', slot: 'weapon', weaponClass: 'knight',
    stackable: false, price: 0, sell: 0, tier: 99, levelReq: 1, adminOnly: true,
    stats: { atkMin: 90, atkMax: 140, defense: 40 }, cooldownMs: 450,
    icon: { shape: 'sword', color: 0xffd479 }, description: 'Sólo el administrador puede empuñarla.',
  },
  bow_admin: {
    id: 'bow_admin', name: 'Arco del Administrador', slot: 'weapon', weaponClass: 'archer',
    stackable: false, price: 0, sell: 0, tier: 99, levelReq: 1, adminOnly: true,
    stats: { atkMin: 80, atkMax: 130, defense: 0 }, cooldownMs: 380, ammo: 'arrow',
    icon: { shape: 'bow', color: 0xffd479 }, description: 'Sólo el administrador puede tensarlo.',
  },
  staff_admin: {
    id: 'staff_admin', name: 'Báculo del Administrador', slot: 'weapon', weaponClass: 'mage',
    stackable: false, price: 0, sell: 0, tier: 99, levelReq: 1, adminOnly: true,
    stats: { atkMin: 90, atkMax: 150, defense: 0 }, cooldownMs: 450, manaCost: 0,
    icon: { shape: 'staff', color: 0xffd479 }, description: 'Sólo el administrador puede canalizarlo.',
  },

  // Armaduras
  helmet_leather: {
    id: 'helmet_leather', name: 'Casco de Cuero', slot: 'helmet', stackable: false,
    price: 45, sell: 15, levelReq: 1, stats: { defense: 1, maxHp: 5 },
    icon: { shape: 'armor', color: 0x9b6b3f },
  },
  armor_leather: {
    id: 'armor_leather', name: 'Armadura de Cuero', slot: 'armor', stackable: false,
    price: 70, sell: 23, levelReq: 1, stats: { defense: 2, maxHp: 10 },
    icon: { shape: 'armor', color: 0x9b6b3f },
  },
  legs_leather: {
    id: 'legs_leather', name: 'Pantalones de Cuero', slot: 'legs', stackable: false,
    price: 55, sell: 18, levelReq: 1, stats: { defense: 1, maxHp: 6 },
    icon: { shape: 'armor', color: 0x8a5a33 },
  },
  boots_leather: {
    id: 'boots_leather', name: 'Botas de Cuero', slot: 'boots', stackable: false,
    price: 40, sell: 13, levelReq: 1, stats: { defense: 1, speed: 4 },
    icon: { shape: 'armor', color: 0x7a4f2c },
  },
  shield_wood: {
    id: 'shield_wood', name: 'Escudo de Madera', slot: 'shield', stackable: false,
    price: 60, sell: 20, levelReq: 1, stats: { defense: 3 },
    icon: { shape: 'shield', color: 0xc8a165 },
  },
  armor_iron: {
    id: 'armor_iron', name: 'Armadura de Hierro', slot: 'armor', stackable: false,
    price: 420, sell: 140, levelReq: 6, stats: { defense: 5, maxHp: 25 },
    icon: { shape: 'armor', color: 0xb9c2cf },
  },
  helmet_iron: {
    id: 'helmet_iron', name: 'Casco de Hierro', slot: 'helmet', stackable: false,
    price: 260, sell: 86, levelReq: 6, stats: { defense: 3, maxHp: 12 },
    icon: { shape: 'armor', color: 0xb9c2cf },
  },
  ring_str: {
    id: 'ring_str', name: 'Anillo de Fuerza', slot: 'ring', stackable: false,
    price: 300, sell: 100, levelReq: 3, stats: { atkMin: 1, atkMax: 3 },
    icon: { shape: 'ring', color: 0xf2c94c },
  },
  amulet_mana: {
    id: 'amulet_mana', name: 'Amuleto de Maná', slot: 'amulet', stackable: false,
    price: 280, sell: 93, levelReq: 3, stats: { maxMp: 25 },
    icon: { shape: 'ring', color: 0x6f8ce8 },
  },
});

// Armas iniciales que todo personaje recibe (permite probar las 3 clases al instante).
export const STARTER_ITEMS = Object.freeze([
  { itemId: 'sword_wood', qty: 1 },
  { itemId: 'bow_wood', qty: 1 },
  { itemId: 'staff_wood', qty: 1 },
  { itemId: 'arrow', qty: 50 },
  { itemId: 'potion_hp', qty: 5 },
  { itemId: 'potion_mp', qty: 5 },
  { itemId: 'helmet_leather', qty: 1 },
  { itemId: 'armor_leather', qty: 1 },
]);

// ── Monstruos ──────────────────────────────────────────────────
export const MONSTERS = Object.freeze({
  slime: {
    id: 'slime', name: 'Slime', level: 1, maxHp: 28, atkMin: 2, atkMax: 4, defense: 0,
    xp: 18, gold: [1, 5], aggro: 4, moveMs: 650, attackMs: 1400, color: 0x58c98c, size: 0.8,
    loot: [{ itemId: 'potion_hp', chance: 0.18, min: 1, max: 1 }],
  },
  rat: {
    id: 'rat', name: 'Rata Gigante', level: 2, maxHp: 40, atkMin: 3, atkMax: 6, defense: 1,
    xp: 30, gold: [2, 8], aggro: 5, moveMs: 520, attackMs: 1250, color: 0x9b8a72, size: 0.85,
    loot: [{ itemId: 'arrow', chance: 0.25, min: 3, max: 8 }],
  },
  orc: {
    id: 'orc', name: 'Orco', level: 5, maxHp: 110, atkMin: 7, atkMax: 13, defense: 4,
    xp: 90, gold: [8, 22], aggro: 6, moveMs: 480, attackMs: 1150, color: 0x7fae5a, size: 1.05,
    loot: [
      { itemId: 'potion_hp', chance: 0.25, min: 1, max: 2 },
      { itemId: 'helmet_iron', chance: 0.035, min: 1, max: 1 },
    ],
  },
  skeleton: {
    id: 'skeleton', name: 'Esqueleto', level: 8, maxHp: 190, atkMin: 11, atkMax: 19, defense: 7,
    xp: 170, gold: [15, 38], aggro: 6, moveMs: 450, attackMs: 1050, color: 0xd8dde6, size: 1,
    loot: [
      { itemId: 'arrow', chance: 0.3, min: 5, max: 14 },
      { itemId: 'armor_iron', chance: 0.04, min: 1, max: 1 },
      { itemId: 'ring_str', chance: 0.02, min: 1, max: 1 },
    ],
  },
  golem: {
    id: 'golem', name: 'Gólem de Obsidiana', level: 14, maxHp: 520, atkMin: 20, atkMax: 34, defense: 14,
    xp: 650, gold: [60, 130], aggro: 7, moveMs: 600, attackMs: 1500, color: 0x6a5e78, size: 1.35,
    loot: [
      { itemId: 'sword_flame', chance: 0.03, min: 1, max: 1 },
      { itemId: 'staff_void', chance: 0.03, min: 1, max: 1 },
      { itemId: 'bow_storm', chance: 0.03, min: 1, max: 1 },
      { itemId: 'amulet_mana', chance: 0.07, min: 1, max: 1 },
    ],
  },
});

/** Puntos de spawn: centro + radio + cantidad. */
export const SPAWN_ZONES = Object.freeze([
  { monsterId: 'slime', x: 44, y: 57, radius: 5, count: 8 },
  { monsterId: 'rat', x: 29, y: 23, radius: 4, count: 6 },
  { monsterId: 'rat', x: 55, y: 24, radius: 3, count: 4 },
  { monsterId: 'orc', x: 62, y: 39, radius: 5, count: 7 },
  { monsterId: 'skeleton', x: 18, y: 15, radius: 4, count: 5 },
  { monsterId: 'golem', x: 61, y: 61, radius: 3, count: 2 },
]);

export const NPCS = Object.freeze([
  {
    id: 'npc_general', name: 'Mercader Baltazar', x: 36, y: 36, kind: 'shop',
    shop: ['potion_hp', 'potion_mp', 'arrow', 'axe', 'pickaxe', 'sword_wood', 'bow_wood', 'staff_wood', 'armor_leather', 'helmet_leather'],
  },
  {
    id: 'npc_weapons', name: 'Herrera Kaia', x: 44, y: 36, kind: 'shop',
    shop: ['sword_iron', 'bow_oak', 'staff_emerald', 'armor_iron', 'helmet_iron', 'shield_wood', 'ring_str', 'amulet_mana'],
  },
]);

export const SPAWN_POINT = Object.freeze({ x: 40, y: 42 });

export const ZONES = Object.freeze({
  safe: { x1: 30, y1: 30, x2: 50, y2: 50 },
  pvp: { x1: 6, y1: 6, x2: 24, y2: 24 },
});

export function isInZone(zone, x, y) {
  return x >= zone.x1 && x <= zone.x2 && y >= zone.y1 && y <= zone.y2;
}

// ── Chat ───────────────────────────────────────────────────────
export const CHAT_CHANNELS = Object.freeze(['global', 'local', 'clan', 'private']);
export const CHAT_COLORS = Object.freeze({
  global: '#ffd479',
  local: '#d7e3ff',
  clan: '#8ff0b5',
  private: '#ef9bff',
  system: '#aab2c0',
});
