/**
 * Protocolo cliente <-> servidor (JSON).
 *
 * C→S: auth, move, target, attack, stop, switch_class, special, use_item, equip,
 *      unequip, drop, pickup, chat, shop_open, shop_buy, shop_sell,
 *      stall_open, stall_close, stall_buy, ping.
 * S→C: auth_ok, auth_error, snapshot, event, chat, pong.
 *
 * Los snapshots usan arrays compactos para ahorrar ancho de banda móvil:
 *   entidad = [id, kind(0=player,1=monster,2=npc), x, y, dir, hpPct, name,
 *              skull, classId, level, nameColor?]
 *   bolsa   = { i, x, y, o (ownerId|null), g (oro), n (nº items), t (expira) }
 *
 * nameColor es opcional (sólo jugadores con color propio, p. ej. el admin) y
 * el cliente lo ignora si falta para mantener compatibilidad con servidores
 * antiguos.
 */

import { xpToNextLevel } from './config.js';

export const MSG = Object.freeze({
  AUTH: 'auth',
  AUTH_OK: 'auth_ok',
  AUTH_ERROR: 'auth_error',
  MOVE: 'move',
  TARGET: 'target',
  ATTACK: 'attack',
  STOP: 'stop',
  SWITCH_CLASS: 'switch_class',
  SPECIAL: 'special',
  USE_ITEM: 'use_item',
  EQUIP: 'equip',
  UNEQUIP: 'unequip',
  DROP: 'drop',
  PICKUP: 'pickup',
  CHAT: 'chat',
  SHOP_OPEN: 'shop_open',
  SHOP_BUY: 'shop_buy',
  SHOP_SELL: 'shop_sell',
  STALL_OPEN: 'stall_open',
  STALL_CLOSE: 'stall_close',
  STALL_VIEW: 'stall_view',
  STALL_BUY: 'stall_buy',
  PING: 'ping',
  PONG: 'pong',
  SNAPSHOT: 'snapshot',
  EVENT: 'event',
});

export const ENTITY_KIND = Object.freeze({
  PLAYER: 0,
  MONSTER: 1,
  NPC: 2,
});

export const EVENT = Object.freeze({
  DAMAGE: 'damage',
  HEAL: 'heal',
  XP: 'xp',
  SKILL_XP: 'skill_xp',
  LEVEL_UP: 'level_up',
  SKILL_UP: 'skill_up',
  DEATH: 'death',
  RESPAWN: 'respawn',
  PROFILE: 'profile',
  INVENTORY: 'inventory',
  LOOT: 'loot',
  ERROR: 'error',
  NOTICE: 'notice',
  SHOP: 'shop',
  STALL: 'stall',
  TARGET_CLEAR: 'target_clear',
  SPECIAL: 'special',
  PVP: 'pvp',
});

export const MAX_MESSAGES_PER_SECOND = 40;
export const MAX_CHAT_PER_10S = 6;

export function entityWire({
  id, kind, x, y, dir = 'down', hp, maxHp, name, skull = 'none', classId = null, level = 1,
  nameColor = null, outfit = null, hasAxe = false,
}) {
  return [
    id,
    kind,
    Math.round(x * 100) / 100,
    Math.round(y * 100) / 100,
    dir,
    maxHp > 0 ? Math.max(0, Math.round((hp / maxHp) * 100)) : 0,
    name ?? '',
    skull,
    classId ?? '',
    level,
    nameColor ?? null,
    outfit ?? null,
    hasAxe ? 1 : 0,
  ];
}

export function decodeEntity(arr) {
  return {
    id: arr[0], kind: arr[1], x: arr[2], y: arr[3], dir: arr[4],
    hpPct: arr[5], name: arr[6], skull: arr[7], classId: arr[8], level: arr[9],
    nameColor: arr[10] ?? null, outfit: arr[11] ?? null, hasAxe: !!arr[12],
    equipment: arr[13] ? { mano: { itemId: arr[13] } } : null,
  };
}

/**
 * Estado propio compacto del snapshot. El orden es estable y compartido por
 * servidor y cliente; evita repetir 21 claves JSON en cada paquete (10 Hz).
 */
export function encodeSelf(player) {
  return [
    Math.round(player.x * 100) / 100,
    Math.round(player.y * 100) / 100,
    player.dir,
    Math.round(player.hp),
    Math.round(player.mp),
    player.maxHp,
    player.maxMp,
    player.level,
    player.xp,
    xpToNextLevel(player.level),
    player.gold,
    player.classId,
    player.skullActive ? player.skull : 'none',
    player.skullUntil,
    player.deadUntil,
    player.targetId,
    !!player.stall,
    player.nextAttackAt,
    player.nextSpecialAt,
    player.nextSwitchAt,
    player.moveMs,
  ];
}

export function decodeSelf(arr) {
  if (!Array.isArray(arr)) return arr;
  return {
    x: arr[0],
    y: arr[1],
    dir: arr[2],
    hp: arr[3],
    mp: arr[4],
    maxHp: arr[5],
    maxMp: arr[6],
    level: arr[7],
    xp: arr[8],
    xpNext: arr[9],
    gold: arr[10],
    classId: arr[11],
    skull: arr[12],
    skullUntil: arr[13],
    deadUntil: arr[14],
    targetId: arr[15],
    inStall: !!arr[16],
    nextAttackAt: arr[17],
    nextSpecialAt: arr[18],
    nextSwitchAt: arr[19],
    moveMs: arr[20],
  };
}
