import {
  CONSTANTS,
  ITEMS,
  addItem,
  getItemDef,
  hasSpaceFor,
  isSafeZone,
} from '../../shared/index.js';

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const MERCHANT_RANGE = 3.5;

/** ¿Hay algún mercader con stock lo bastante cerca para comerciar? */
function isNearMerchant(game, player) {
  for (const npc of game.world.npcs.values()) {
    if (!Array.isArray(npc.shop) || npc.shop.length === 0) continue;
    if (dist2(player, npc) <= MERCHANT_RANGE ** 2) return true;
  }
  return false;
}

/** Compra en tienda NPC. Precio y stock viven en el servidor. */
export function npcBuy(game, player, npcId, itemId, qty = 1) {
  const npc = game.world.npcs.get(npcId);
  if (!npc) return { ok: false, error: 'NPC no encontrado' };
  if (dist2(player, npc) > 3.5 ** 2) return { ok: false, error: 'Acércate al mercader' };
  const def = getItemDef(itemId);
  if (!def || !npc.shop.includes(itemId)) return { ok: false, error: 'Este NPC no vende ese ítem' };
  if (player.level < (def.levelReq ?? 1)) return { ok: false, error: `Requiere nivel ${def.levelReq}` };

  const count = Math.floor(Number(qty) || 1);
  if (count < 1 || count > 999) return { ok: false, error: 'Cantidad inválida' };
  if (!def.stackable && count > 1) return { ok: false, error: 'Sólo puedes comprar 1' };
  if (!hasSpaceFor(player.inventory, itemId, count)) return { ok: false, error: 'Inventario lleno' };

  const cost = def.price * count;
  if (player.gold < cost) return { ok: false, error: 'Oro insuficiente' };

  const added = addItem(player.inventory, itemId, count);
  if (added.left > 0) return { ok: false, error: 'Inventario lleno' };
  player.gold -= cost;
  player.dirty = true;
  game.logTransaction({ kind: 'npc_buy', buyerId: player.id, itemId, qty: count, gold: cost });
  game.sendProfile(player);
  game.sendEvent(player, 'notice', { text: `Compraste ${count}x ${def.name} por ${cost} oro` });
  return { ok: true, cost };
}

export function npcSell(game, player, uid, qty = 1) {
  if (!isNearMerchant(game, player)) return { ok: false, error: 'Acércate a un mercader para vender' };
  const inst = player.findInventoryUid(uid);
  if (!inst) return { ok: false, error: 'Ítem no encontrado' };
  const def = getItemDef(inst.itemId);
  if (!def) return { ok: false, error: 'Ítem inválido' };
  const count = Math.max(1, Math.min(inst.qty, Math.floor(Number(qty) || 1)));
  const total = (def.sell ?? 0) * count;
  if (total <= 0) return { ok: false, error: 'Este ítem no se puede vender' };
  const removed = player.removeItemUid(uid, count);
  if (removed.removed <= 0) return { ok: false, error: 'No se pudo vender' };
  player.gold = Math.min(CONSTANTS.MAX_GOLD, player.gold + total);
  player.dirty = true;
  game.logTransaction({ kind: 'npc_sell', sellerId: player.id, itemId: def.id, qty: count, gold: total });
  game.sendProfile(player);
  game.sendEvent(player, 'notice', { text: `Vendiste ${count}x ${def.name} por ${total} oro` });
  return { ok: true, total };
}

/**
 * Abre una tienda estática (AFK/offline). Los ítems salen del inventario
 * y quedan persistidos hasta que se vendan o el jugador cierre la tienda.
 */
export async function openStall(game, player, listings) {
  if (player.stall) return { ok: false, error: 'Ya tienes una tienda abierta' };
  if (!isSafeZone(Math.round(player.x), Math.round(player.y))) {
    return { ok: false, error: 'Sólo puedes abrir tienda en la ciudad' };
  }
  if (!Array.isArray(listings) || listings.length === 0) return { ok: false, error: 'Añade ítems a tu tienda' };
  if (listings.length > 30) return { ok: false, error: 'Demasiados listados' };

  const seen = new Set();
  const stallItems = [];
  for (const entry of listings) {
    const uid = String(entry?.uid ?? '');
    if (!uid || seen.has(uid)) return { ok: false, error: 'Listado duplicado' };
    seen.add(uid);
    const inst = player.findInventoryUid(uid);
    if (!inst) return { ok: false, error: 'Ítem del listado no encontrado' };
    const price = Math.floor(Number(entry.price));
    if (!Number.isFinite(price) || price < 1 || price > 100_000_000) {
      return { ok: false, error: 'Precio inválido (1 - 100M)' };
    }
    stallItems.push({ uid: inst.uid, itemId: inst.itemId, qty: inst.qty, price });
  }

  // Todos los slots quedan libres al moverlos a la tienda.
  for (const entry of stallItems) player.removeItemUid(entry.uid, entry.qty);

  const stall = game.world.addStall({
    id: `stall_${player.id}`,
    characterId: player.id,
    ownerName: player.name,
    x: Math.round(player.x),
    y: Math.round(player.y),
    items: stallItems,
    online: true,
    createdAt: new Date().toISOString(),
  });
  player.stall = { items: stallItems, createdAt: new Date().toISOString() };
  player.dirty = true;
  game.sendProfile(player);
  await game.savePlayer(player);
  game.broadcastNear(player.x, player.y, 24, {
    type: 'notice', text: `${player.name} abrió una tienda`, x: player.x, y: player.y,
  });
  return { ok: true, stall };
}

export async function closeStall(game, player) {
  if (!player.stall) return { ok: false, error: 'No tienes tienda abierta' };
  // Comprueba que quepan todos los ítems antes de mutar nada.
  const temp = structuredClone(player.inventory);
  for (const item of player.stall.items) {
    const res = addItem(temp, item.itemId, item.qty, item.uid);
    if (res.left > 0) return { ok: false, error: 'Inventario lleno; haz espacio primero' };
  }
  player.inventory = temp;
  player.stall = null;
  game.world.removeStall(`stall_${player.id}`);
  await game.store.deleteStall(player.id);
  player.dirty = true;
  game.sendProfile(player);
  game.sendEvent(player, 'notice', { text: 'Cerraste tu tienda y recuperaste los ítems' });
  await game.savePlayer(player);
  return { ok: true };
}

/**
 * Compra de un listado. El descuento del comprador y la entrega se hacen aquí;
 * el crédito al vendedor y la baja del listado se hacen atómicamente en el store
 * (funciona también si el vendedor está offline).
 */
export async function buyStallListing(game, buyer, stallId, itemUid) {
  const stall = game.world.stalls.get(stallId);
  if (!stall) return { ok: false, error: 'Tienda no encontrada' };
  if (stall.characterId === buyer.id) return { ok: false, error: 'No puedes comprar en tu propia tienda' };
  if (dist2(buyer, stall) > 2.6 ** 2) return { ok: false, error: 'Acércate a la tienda' };
  const listing = stall.items.find((it) => it.uid === itemUid);
  if (!listing) return { ok: false, error: 'Listado ya vendido' };
  if (buyer.gold < listing.price) return { ok: false, error: 'Oro insuficiente' };
  if (!hasSpaceFor(buyer.inventory, listing.itemId, listing.qty)) {
    return { ok: false, error: 'Inventario lleno' };
  }

  // Reserva el oro antes de la transacción: si dos compras del mismo
  // comprador se solapan, la segunda no puede dejar el saldo en negativo.
  buyer.gold -= listing.price;
  buyer.dirty = true;

  let result;
  try {
    result = await game.store.buyStallItem({
      sellerId: stall.characterId,
      itemUid,
      buyerId: buyer.id,
    });
  } catch (err) {
    buyer.gold += listing.price;
    throw err;
  }
  if (!result.ok) {
    buyer.gold += listing.price;
    return { ok: false, error: 'La tienda cambió, intenta de nuevo' };
  }
  // El precio del store es la fuente de verdad por si cambió el listado.
  const charged = Math.max(0, Number(result.price) || 0);
  if (charged !== listing.price) buyer.gold += listing.price - charged;
  buyer.gold = Math.max(0, buyer.gold);

  addItem(buyer.inventory, result.item.itemId, result.item.qty, result.item.uid);
  game.sendProfile(buyer);
  game.sendEvent(buyer, 'notice', {
    text: `Compraste ${result.item.qty}x ${ITEMS[result.item.itemId]?.name ?? result.item.itemId} por ${charged} oro`,
  });

  stall.items = result.remainingItems;
  if (result.stallClosed) {
    game.world.removeStall(stall.id);
    game.broadcastNear(stall.x, stall.y, 24, {
      type: 'notice', text: `La tienda de ${stall.ownerName} se quedó vacía`,
    });
  }

  // Si el vendedor está online, sincroniza su estado vivo. Se suma al saldo
  // en memoria (no se sobrescribe) para no perder oro ganado sin guardar.
  const seller = game.world.getPlayer(stall.characterId);
  if (seller) {
    seller.gold = Math.min(CONSTANTS.MAX_GOLD, seller.gold + charged);
    if (result.stallClosed) seller.stall = null;
    else if (seller.stall) seller.stall.items = result.remainingItems;
    seller.dirty = true;
    game.sendEvent(seller, 'notice', {
      text: `Vendiste ${result.item.qty}x ${ITEMS[result.item.itemId]?.name ?? result.item.itemId} por ${result.price} oro`,
    });
    game.sendProfile(seller);
    await game.savePlayer(seller);
  }
  return { ok: true, ...result };
}

export function shopPayload(npc) {
  return {
    npcId: npc.id,
    name: npc.name,
    items: npc.shop
      .map((id) => ITEMS[id])
      .filter(Boolean)
      .map((def) => ({
        id: def.id, name: def.name, price: def.price, sell: def.sell,
        slot: def.slot, stackable: !!def.stackable, levelReq: def.levelReq ?? 1,
        stats: def.stats ?? {}, description: def.description ?? '', icon: def.icon,
      })),
  };
}
