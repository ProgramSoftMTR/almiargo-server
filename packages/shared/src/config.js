/**
 * Constantes globales compartidas por servidor y cliente.
 * Todo valor de balance vive aquí: una sola fuente de verdad.
 */

export const TICK_RATE = 10;                 // ticks/s del servidor autoritativo (100ms)
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 10;             // snapshots/s enviados al cliente
export const SNAPSHOT_EVERY_TICKS = TICK_RATE / SNAPSHOT_RATE;
export const INTERPOLATION_MS = 120;         // retardo de render (anti-jitter)

export const TILE_SIZE = 32;
export const MAP_WIDTH = 280;
export const MAP_HEIGHT = 280;
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
  'mano', 'helmet', 'armor', 'legs', 'boots', 'weapon', 'shield', 'ring', 'amulet', 'tool', 'backpack',
]);

export const INVENTORY_SLOTS = 40;

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
    id: 'axe', name: 'Hacha', slot: 'mano', weaponClass: 'adventurer', stackable: false,
    price: 45, sell: 15, tier: 1, levelReq: 1,
    stats: { atkMin: 2, atkMax: 4, defense: 0 }, cooldownMs: 900,
    icon: { shape: 'axe', color: 0xb8874e },
    description: 'Permite talar arboles para obtener madera.',
  },
  pickaxe: {
    id: 'pickaxe', name: 'Pico', slot: 'mano', weaponClass: 'adventurer', stackable: false,
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
  palm_wood: {
    id: 'palm_wood', name: 'Madera de Palmera', slot: 'resource', stackable: true,
    price: 0, sell: 4, icon: { shape: 'palm_wood', color: 0xb8874e },
    description: 'Tronco fibroso y ligero obtenido de las palmeras de la costa.',
  },
  coconut: {
    id: 'coconut', name: 'Coco', slot: 'consumable', stackable: true, consumable: true,
    price: 0, sell: 2, icon: { shape: 'coconut', color: 0x3a2410 },
    use: { healHp: 30 }, cooldownMs: 5000,
    description: 'Coco fresco de la playa. Restaura un poco de salud al consumirlo.',
  },
  mangrove_wood: {
    id: 'mangrove_wood', name: 'Madera de Manglar', slot: 'resource', stackable: true,
    price: 0, sell: 4, icon: { shape: 'mangrove_wood', color: 0x3a3228 },
    description: 'Madera densa y resistente a la humedad extraída de los manglares del pantano.',
  },
  branches: {
    id: 'branches', name: 'Ramas', slot: 'resource', stackable: true,
    price: 0, sell: 2, icon: { shape: 'branches', color: 0x6a4a2a },
    description: 'Ramas secas y retorcidas recolectadas de árboles del pantano. Útiles para fabricar herramientas o encender fuego.',
  },
  vines: {
    id: 'vines', name: 'Lianas', slot: 'resource', stackable: true,
    price: 0, sell: 2, icon: { shape: 'vines', color: 0x4a5a30 },
    description: 'Enredaderas flexibles y resistentes que cuelgan de los manglares.',
  },
  slime_ball: {
    id: 'slime_ball', name: 'Bola de Slime', slot: 'resource', stackable: true,
    price: 0, sell: 3, icon: { shape: 'slime_ball', color: 0x3a8a4a },
    description: 'Sustancia viscosa y elástica encontrada entre las raíces húmedas del pantano.',
  },
  crafting_table: {
    id: 'crafting_table', name: 'Mesa de Trabajo', slot: 'tool', stackable: false,
    price: 350, sell: 100, icon: { shape: 'crafting_table', color: 0x8a6034 },
    description: 'Mesa de trabajo para craftear objetos en cuadrícula 3x3.',
  },
  braided_rope: {
    id: 'braided_rope', name: 'Cuerda Trenzada', slot: 'resource', stackable: true,
    price: 0, sell: 5, icon: { shape: 'rope', color: 0x8a6034 },
    description: 'Cuerda trenzada de lianas y ramas.',
  },
  slime_heal_potion: {
    id: 'slime_heal_potion', name: 'Poción Viscosa de Curación', slot: 'consumable', stackable: true, consumable: true,
    price: 0, sell: 10, icon: { shape: 'potion', color: 0x3a8a4a },
    use: { healHp: 120 }, description: 'Restaura 120 HP.',
  },
  swamp_agility_elixir: {
    id: 'swamp_agility_elixir', name: 'Elixir de Agilidad del Pantano', slot: 'consumable', stackable: true, consumable: true,
    price: 0, sell: 12, icon: { shape: 'potion', color: 0x4a5a30 },
    use: { speedBoost: 0.18, durationMs: 30000 }, description: 'Aumenta la velocidad un 18% por 30s.',
  },
  mangrove_longbow: {
    id: 'mangrove_longbow', name: 'Arco Largo de Manglar', slot: 'mano', weaponClass: 'archer', stackable: false,
    price: 0, sell: 50, tier: 2, levelReq: 1, icon: { shape: 'bow', color: 0x8a6034 },
    description: 'Arco a distancia de madera de manglar.',
  },
  swamp_staff: {
    id: 'swamp_staff', name: 'Báculo del Pantano', slot: 'mano', weaponClass: 'mage', stackable: false,
    price: 0, sell: 50, tier: 2, levelReq: 1, icon: { shape: 'staff', color: 0x3a8a4a },
    description: 'Báculo mágico del pantano.',
  },
  mangrove_shield: {
    id: 'mangrove_shield', name: 'Escudo Reforzado de Manglar', slot: 'shield', stackable: false,
    price: 0, sell: 40, icon: { shape: 'shield', color: 0x3a3228 },
    description: 'Escudo que otorga +40 HP.',
  },

  // Mochilas equipables
  starter_pouch: {
    id: 'starter_pouch', name: 'Bolsita de Principiante', slot: 'backpack', type: 'backpack', stackable: false,
    price: 0, sell: 0, slots: 12,
    icon: { shape: 'backpack', color: 0x8a6034 },
    description: 'Bolsita pequeña para principiantes. 12 espacios.',
  },
  leather_backpack: {
    id: 'leather_backpack', name: 'Mochila de Cuero', slot: 'backpack', type: 'backpack', stackable: false,
    price: 450, sell: 150, slots: 20,
    icon: { shape: 'backpack', color: 0x6b4a2a },
    description: 'Mochila de cuero. 20 espacios.',
  },
  mangrove_backpack: {
    id: 'mangrove_backpack', name: 'Mochila Tejida de Manglar', slot: 'backpack', type: 'backpack', stackable: false,
    price: 0, sell: 120, slots: 26,
    icon: { shape: 'backpack', color: 0x3a5a30 },
    description: 'Mochila tejida de manglar. 26 espacios.',
  },
  explorer_backpack: {
    id: 'explorer_backpack', name: 'Mochila de Explorador', slot: 'backpack', type: 'backpack', stackable: false,
    price: 2500, sell: 800, slots: 32,
    icon: { shape: 'backpack', color: 0x3a6ea8 },
    description: 'Mochila de explorador. 32 espacios.',
  },
  adventurer_backpack: {
    id: 'adventurer_backpack', name: 'Mochila Real de Aventurero', slot: 'backpack', type: 'backpack', stackable: false,
    price: 8000, sell: 2500, slots: 40,
    icon: { shape: 'backpack', color: 0xc9a227 },
    description: 'Mochila real de aventurero. 40 espacios.',
  },

  // Armas — Caballero
  sword_wood: {
    id: 'sword_wood', name: 'Espada de Madera', slot: 'mano', weaponClass: 'knight',
    stackable: false, price: 30, sell: 10, tier: 1, levelReq: 1,
    stats: { atkMin: 4, atkMax: 8, defense: 1 }, cooldownMs: 900,
    icon: { shape: 'sword', color: 0xc8a165 }, description: 'Un arma humilde pero letal.',
  },
  sword_iron: {
    id: 'sword_iron', name: 'Espada de Hierro', slot: 'mano', weaponClass: 'knight',
    stackable: false, price: 180, sell: 60, tier: 2, levelReq: 4,
    stats: { atkMin: 9, atkMax: 16, defense: 2 }, cooldownMs: 850,
    icon: { shape: 'sword', color: 0xd8dde6 }, description: 'Forjada para la guerra.',
  },
  sword_flame: {
    id: 'sword_flame', name: 'Espada Flamígera', slot: 'mano', weaponClass: 'knight',
    stackable: false, price: 950, sell: 320, tier: 3, levelReq: 10,
    stats: { atkMin: 18, atkMax: 28, defense: 3 }, cooldownMs: 800,
    icon: { shape: 'sword', color: 0xff8a3d }, description: 'Arde con furia eterna.',
  },

  // Armas — Arquero
  bow_wood: {
    id: 'bow_wood', name: 'Arco de Madera', slot: 'mano', weaponClass: 'archer',
    stackable: false, price: 30, sell: 10, tier: 1, levelReq: 1,
    stats: { atkMin: 3, atkMax: 7, defense: 0 }, cooldownMs: 720, ammo: 'arrow',
    icon: { shape: 'bow', color: 0xc8a165 }, description: 'Ligero y preciso.',
  },
  bow_oak: {
    id: 'bow_oak', name: 'Arco de Roble', slot: 'mano', weaponClass: 'archer',
    stackable: false, price: 170, sell: 55, tier: 2, levelReq: 4,
    stats: { atkMin: 8, atkMax: 15, defense: 0 }, cooldownMs: 680, ammo: 'arrow',
    icon: { shape: 'bow', color: 0x9b6b3f }, description: 'Equilibrio perfecto.',
  },
  bow_storm: {
    id: 'bow_storm', name: 'Arco Tormenta', slot: 'mano', weaponClass: 'archer',
    stackable: false, price: 900, sell: 300, tier: 3, levelReq: 10,
    stats: { atkMin: 16, atkMax: 26, defense: 0 }, cooldownMs: 620, ammo: 'arrow',
    icon: { shape: 'bow', color: 0x5dd98a }, description: 'Cada flecha es un relámpago.',
  },

  // Armas — Mago
  staff_wood: {
    id: 'staff_wood', name: 'Báculo de Madera', slot: 'mano', weaponClass: 'mage',
    stackable: false, price: 30, sell: 10, tier: 1, levelReq: 1,
    stats: { atkMin: 4, atkMax: 9, defense: 0 }, cooldownMs: 1000, manaCost: 4,
    icon: { shape: 'staff', color: 0x6f8ce8 }, description: 'Canaliza energía arcana.',
  },
  staff_emerald: {
    id: 'staff_emerald', name: 'Báculo Esmeralda', slot: 'mano', weaponClass: 'mage',
    stackable: false, price: 190, sell: 62, tier: 2, levelReq: 4,
    stats: { atkMin: 9, atkMax: 17, defense: 0 }, cooldownMs: 950, manaCost: 6,
    icon: { shape: 'staff', color: 0x38d996 }, description: 'Poder contenido en jade.',
  },
  staff_void: {
    id: 'staff_void', name: 'Báculo del Vacío', slot: 'mano', weaponClass: 'mage',
    stackable: false, price: 980, sell: 330, tier: 3, levelReq: 10,
    stats: { atkMin: 18, atkMax: 30, defense: 0 }, cooldownMs: 900, manaCost: 8,
    icon: { shape: 'staff', color: 0xb06fe8 }, description: 'El vacío susurra tu nombre.',
  },

  // Armas de administrador (no se venden ni se dropean; sólo las otorga el panel admin).
  sword_admin: {
    id: 'sword_admin', name: 'Espada del Administrador', slot: 'mano', weaponClass: 'knight',
    stackable: false, price: 0, sell: 0, tier: 99, levelReq: 1, adminOnly: true,
    stats: { atkMin: 90, atkMax: 140, defense: 40 }, cooldownMs: 450,
    icon: { shape: 'sword', color: 0xffd479 }, description: 'Sólo el administrador puede empuñarla.',
  },
  bow_admin: {
    id: 'bow_admin', name: 'Arco del Administrador', slot: 'mano', weaponClass: 'archer',
    stackable: false, price: 0, sell: 0, tier: 99, levelReq: 1, adminOnly: true,
    stats: { atkMin: 80, atkMax: 130, defense: 0 }, cooldownMs: 380, ammo: 'arrow',
    icon: { shape: 'bow', color: 0xffd479 }, description: 'Sólo el administrador puede tensarlo.',
  },
  staff_admin: {
    id: 'staff_admin', name: 'Báculo del Administrador', slot: 'mano', weaponClass: 'mage',
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
  goblin: {
    id: 'goblin', name: 'Goblin', level: 5, maxHp: 95, atkMin: 6, atkMax: 11, defense: 3,
    xp: 60, gold: [5, 15], aggro: 5, moveMs: 500, attackMs: 1200, color: 0x7fae5a, size: 1.0,
    loot: [
      { itemId: 'potion_hp', chance: 0.22, min: 1, max: 2 },
      { itemId: 'arrow', chance: 0.2, min: 3, max: 8 },
    ],
  },
  crab: {
    id: 'crab', name: 'Cangrejo', level: 2, maxHp: 45, atkMin: 4, atkMax: 7, defense: 2,
    xp: 35, gold: [3, 9], aggro: 4, moveMs: 420, attackMs: 1100, color: 0xe07a5a, size: 0.9,
    loot: [{ itemId: 'arrow', chance: 0.2, min: 2, max: 6 }],
  },
  starfish: {
    id: 'starfish', name: 'Estrella de Mar', level: 3, maxHp: 55, atkMin: 5, atkMax: 8, defense: 1,
    xp: 45, gold: [4, 10], aggro: 4, moveMs: 500, attackMs: 1200, color: 0xf2c94c, size: 0.95,
    loot: [{ itemId: 'potion_hp', chance: 0.2, min: 1, max: 1 }],
  },
  sandcastle: {
    id: 'sandcastle', name: 'Castillo de Arena Viviente', level: 4, maxHp: 85, atkMin: 7, atkMax: 12, defense: 4,
    xp: 70, gold: [6, 16], aggro: 5, moveMs: 600, attackMs: 1300, color: 0xc9b27a, size: 1.1,
    loot: [
      { itemId: 'potion_hp', chance: 0.25, min: 1, max: 2 },
      { itemId: 'arrow', chance: 0.25, min: 3, max: 10 },
    ],
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
  { monsterId: 'slime', x: 75, y: 75, radius: 8, count: 16 },
  { monsterId: 'goblin', x: 160, y: 160, radius: 8, count: 12 },
  { monsterId: 'rat', x: 125, y: 75, radius: 6, count: 8 },
  { monsterId: 'orc', x: 140, y: 100, radius: 6, count: 8 },
  { monsterId: 'skeleton', x: 40, y: 160, radius: 6, count: 6 },
  { monsterId: 'golem', x: 180, y: 180, radius: 4, count: 3 },
]);

export const NPCS = Object.freeze([
  {
    id: 'npc_general', name: 'Mercader Baltazar', x: 96, y: 96, kind: 'shop',
    shop: ['potion_hp', 'potion_mp', 'arrow', 'axe', 'pickaxe', 'sword_wood', 'bow_wood', 'staff_wood', 'armor_leather', 'helmet_leather', 'crafting_table', 'leather_backpack', 'explorer_backpack', 'adventurer_backpack'],
  },
  {
    id: 'npc_weapons', name: 'Herrera Kaia', x: 104, y: 96, kind: 'shop',
    shop: ['sword_iron', 'bow_oak', 'staff_emerald', 'armor_iron', 'helmet_iron', 'shield_wood', 'ring_str', 'amulet_mana'],
  },
]);

export const SPAWN_POINT = Object.freeze({ x: 100, y: 100 });

export const ZONES = Object.freeze({
  safe: { x1: 90, y1: 90, x2: 110, y2: 110 },
  pvp: { x1: 20, y1: 20, x2: 40, y2: 40 },
  forest: { x1: 60, y1: 60, x2: 90, y2: 90 },
  goblin: { x1: 140, y1: 140, x2: 170, y2: 170 },
});

// Zonas expresadas como rectángulos (startX, startY, width, height) para spawners/biomas.
export const MAP_ZONES = Object.freeze([
  { id: 'city', name: 'Ciudad Segura', startX: 90, startY: 90, width: 21, height: 21, safe: true, level: 0 },
  { id: 'forest', name: 'Bosque de Slimes', startX: 60, startY: 60, width: 31, height: 31, mobType: 'slime', minLevel: 1 },
  { id: 'goblin', name: 'Campamento Goblin', startX: 140, startY: 140, width: 31, height: 31, mobType: 'goblin', minLevel: 5 },
]);

export const SPAWNER_ZONES = Object.freeze([
  { id: 'slime_forest', name: 'Bosque de Slimes', startX: 60, startY: 60, width: 31, height: 31, mobType: 'slime', maxMobs: 16, respawnTime: 6000 },
  { id: 'goblin_camp', name: 'Campamento Goblin', startX: 140, startY: 140, width: 31, height: 31, mobType: 'goblin', maxMobs: 12, respawnTime: 8000 },
  { id: 'beach_crab', name: 'Playa Cangrejos', startX: 0, startY: 0, width: MAP_WIDTH, height: MAP_HEIGHT, mobType: 'crab', maxMobs: 14, respawnTime: 7000, beachOnly: true },
  { id: 'beach_starfish', name: 'Playa Estrellas', startX: 0, startY: 0, width: MAP_WIDTH, height: MAP_HEIGHT, mobType: 'starfish', maxMobs: 12, respawnTime: 7000, beachOnly: true },
  { id: 'beach_sandcastle', name: 'Playa Castillos', startX: 0, startY: 0, width: MAP_WIDTH, height: MAP_HEIGHT, mobType: 'sandcastle', maxMobs: 10, respawnTime: 8000, beachOnly: true },
]);

export const BIOMES = MAP_ZONES;

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
