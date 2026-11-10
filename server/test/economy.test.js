import assert from 'node:assert/strict';
import test from 'node:test';
import { ITEMS } from '@almiargo/shared';
import { MemoryStore } from '../src/db/memory.js';
import { PlayerState, createCharacterState } from '../src/game/player.js';
import {
  buyStallListing,
  closeStall,
  npcBuy,
  npcSell,
  openStall,
  shopPayload,
} from '../src/game/economy.js';

function newPlayer(name, id) {
  return new PlayerState(createCharacterState(name, id));
}

function fakeGame(store) {
  const events = [];
  const profiles = [];
  const transactions = [];
  const game = {
    store,
    events,
    profiles,
    transactions,
    world: {
      stalls: new Map(),
      npcs: new Map([
        ['npc_general', {
          id: 'npc_general', name: 'Mercader', x: 36, y: 36,
          shop: ['potion_hp', 'potion_mp', 'arrow', 'sword_wood'],
        }],
      ]),
      getPlayer: () => null,
      addStall(stall) {
        this.stalls.set(stall.id, stall);
        return stall;
      },
      removeStall(id) {
        this.stalls.delete(id);
      },
    },
    sendEvent(player, event, data = {}) {
      events.push({ playerId: player?.id, event, ...data });
    },
    sendProfile(player) {
      profiles.push(player.id);
    },
    broadcastNear() {},
    markDirty() {},
    logTransaction(entry) {
      transactions.push(entry);
    },
    async savePlayer(player) {
      await store.saveCharacter(player.toState());
    },
  };
  return game;
}

async function makeStore() {
  const store = new MemoryStore();
  await store.init();
  return store;
}

test('npcBuy cobra oro y entrega el ítem', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const player = newPlayer('Comprador', 'c1');
  player.x = 36;
  player.y = 36;
  const before = player.countItem('potion_hp');

  const result = npcBuy(game, player, 'npc_general', 'potion_hp', 3);

  assert.equal(result.ok, true);
  assert.equal(result.cost, ITEMS.potion_hp.price * 3);
  assert.equal(player.gold, 100 - result.cost);
  assert.equal(player.countItem('potion_hp'), before + 3);
  assert.ok(game.transactions.some((t) => t.kind === 'npc_buy'));
});

test('npcBuy rechaza ítems fuera del catálogo del NPC', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const player = newPlayer('Comprador', 'c2');
  player.x = 36;
  player.y = 36;
  const result = npcBuy(game, player, 'npc_general', 'sword_iron', 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /no vende/);
});

test('npcSell exige estar cerca de un mercader', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const player = newPlayer('Vendedor', 'c3');
  const potion = player.inventory.find((slot) => slot?.itemId === 'potion_hp');
  assert.ok(potion);

  player.x = 10;
  player.y = 10;
  const far = npcSell(game, player, potion.uid, 1);
  assert.equal(far.ok, false);
  assert.match(far.error, /mercader/);
  assert.equal(player.countItem('potion_hp'), 5, 'no se pierde el ítem al fallar');

  player.x = 36;
  player.y = 36;
  const near = npcSell(game, player, potion.uid, 1);
  assert.equal(near.ok, true);
  assert.equal(player.countItem('potion_hp'), 4);
});

test('shopPayload expone sólo el stock del NPC', () => {
  const npc = { id: 'n', name: 'Test', shop: ['potion_hp', 'no_existe'] };
  const payload = shopPayload(npc);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 'potion_hp');
});

test('openStall exige estar en la ciudad y abre con ítems de la mochila', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const seller = newPlayer('Vendedor', 's1');
  const bow = seller.inventory.find((s) => s?.itemId === 'bow_wood');
  assert.ok(bow);

  seller.x = 10;
  seller.y = 10;
  const outside = await openStall(game, seller, [{ uid: bow.uid, price: 100 }]);
  assert.equal(outside.ok, false);
  assert.match(outside.error, /ciudad/);

  seller.x = 40;
  seller.y = 42;
  const opened = await openStall(game, seller, [{ uid: bow.uid, price: 100 }]);
  assert.equal(opened.ok, true);
  assert.equal(seller.stall.items.length, 1);
  assert.equal(seller.countItem('bow_wood'), 0, 'el ítem sale de la mochila');
  assert.ok(game.world.stalls.has(`stall_${seller.id}`));
  const stored = await store.loadCharacter(seller.id);
  assert.equal(stored.stall.items[0].price, 100);
});

test('openStall valida precios y listados vacíos', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const seller = newPlayer('Vendedor', 's2');
  const bow = seller.inventory.find((s) => s?.itemId === 'bow_wood');

  assert.equal((await openStall(game, seller, [])).ok, false);
  assert.equal((await openStall(game, seller, [{ uid: bow.uid, price: 0 }])).ok, false);
  assert.equal(seller.stall, null);
});

test('comprar un listado acredita al vendedor offline y entrega el ítem', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const seller = newPlayer('Vendedor', 's3');
  const buyer = newPlayer('Comprador', 'b3');
  const bow = seller.inventory.find((s) => s?.itemId === 'bow_wood');

  seller.x = 40;
  seller.y = 42;
  const opened = await openStall(game, seller, [{ uid: bow.uid, price: 100 }]);
  assert.equal(opened.ok, true);

  buyer.gold = 500;
  buyer.x = 40;
  buyer.y = 42;
  const beforeBow = buyer.countItem('bow_wood');
  const bought = await buyStallListing(game, buyer, opened.stall.id, bow.uid);

  assert.equal(bought.ok, true);
  assert.equal(bought.price, 100);
  assert.equal(buyer.gold, 400);
  assert.equal(buyer.countItem('bow_wood'), beforeBow + 1);
  assert.equal(buyer.inventory.find((s) => s?.uid === bow.uid).itemId, 'bow_wood');
  assert.equal(game.world.stalls.size, 0, 'la tienda vacía desaparece');

  const stored = await store.loadCharacter(seller.id);
  assert.equal(stored.gold, 200, 'el oro se acredita aunque el vendedor esté offline');
  assert.equal(stored.stall, null);
});

test('no se puede comprar en la propia tienda ni sin oro', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const seller = newPlayer('Vendedor', 's4');
  const buyer = newPlayer('Comprador', 'b4');
  const bow = seller.inventory.find((s) => s?.itemId === 'bow_wood');

  seller.x = 40;
  seller.y = 42;
  const opened = await openStall(game, seller, [{ uid: bow.uid, price: 100 }]);

  const own = await buyStallListing(game, seller, opened.stall.id, bow.uid);
  assert.equal(own.ok, false);
  assert.match(own.error, /propia/);

  buyer.gold = 10;
  buyer.x = 40;
  buyer.y = 42;
  const poor = await buyStallListing(game, buyer, opened.stall.id, bow.uid);
  assert.equal(poor.ok, false);
  assert.match(poor.error, /insuficiente/);
});

test('closeStall devuelve todos los ítems a la mochila', async () => {
  const store = await makeStore();
  const game = fakeGame(store);
  const seller = newPlayer('Vendedor', 's5');
  const staff = seller.inventory.find((s) => s?.itemId === 'staff_wood');
  const helmet = seller.inventory.find((s) => s?.itemId === 'helmet_leather');

  seller.x = 40;
  seller.y = 42;
  const opened = await openStall(game, seller, [
    { uid: staff.uid, price: 50 },
    { uid: helmet.uid, price: 80 },
  ]);
  assert.equal(opened.ok, true);
  assert.equal(seller.countItem('staff_wood'), 0);

  const closed = await closeStall(game, seller);
  assert.equal(closed.ok, true);
  assert.equal(seller.stall, null);
  assert.equal(seller.countItem('staff_wood'), 1);
  assert.equal(seller.countItem('helmet_leather'), 1);
  assert.equal(game.world.stalls.size, 0);

  const stored = await store.loadCharacter(seller.id);
  assert.equal(stored.stall, null);
});
