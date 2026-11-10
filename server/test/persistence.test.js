import assert from 'node:assert/strict';
import test from 'node:test';
import { FirestoreStore } from '../src/db/firestore.js';
import { MemoryStore } from '../src/db/memory.js';
import { GameServer } from '../src/net/gameServer.js';
import { config as baseConfig } from '../src/config.js';
import { PlayerState, createCharacterState } from '../src/game/player.js';

/**
 * Fake mínimo de Firestore (colección única con doc/get/set/where/limit).
 * Permite probar la persistencia del FirestoreStore sin emulador ni red.
 */
function createFakeFirestore() {
  const docs = new Map(); // "col/id" -> data
  const clone = (v) => (v == null ? v : structuredClone(v));
  const field = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

  const makeRef = (col, id) => ({
    id,
    async get() {
      const data = docs.get(`${col}/${id}`);
      return { exists: !!data, id, data: () => clone(data), ref: makeRef(col, id) };
    },
    async set(data, opts = {}) {
      const key = `${col}/${id}`;
      const prev = opts.merge ? docs.get(key) ?? {} : {};
      docs.set(key, clone({ ...prev, ...data }));
    },
  });

  const makeQuery = (col, filters, limitN = Infinity) => ({
    where(f, op, v) { return makeQuery(col, [...filters, { f, op, v }], limitN); },
    limit(n) { return makeQuery(col, filters, n); },
    async get() {
      const out = [];
      for (const [key, data] of docs) {
        if (!key.startsWith(`${col}/`)) continue;
        let ok = true;
        for (const { f, op, v } of filters) {
          const val = field(data, f);
          if (op === '==' && val !== v) ok = false;
          if (op === '!=' && val === v) ok = false;
        }
        if (!ok) continue;
        const id = key.slice(col.length + 1);
        out.push({ id, data: () => clone(data), ref: makeRef(col, id) });
        if (out.length >= limitN) break;
      }
      return { empty: out.length === 0, size: out.length, docs: out, forEach: (cb) => out.forEach(cb) };
    },
  });

  return {
    collection: (name) => ({
      doc: (id) => makeRef(name, id),
      where: (f, op, v) => makeQuery(name, [{ f, op, v }]),
      limit: (n) => makeQuery(name, [], n),
      get: () => makeQuery(name, []).get(),
    }),
    _docs: docs,
  };
}

test('FirestoreStore conserva personajes, oro y tiendas tras reiniciar', async () => {
  const db = createFakeFirestore();

  const first = new FirestoreStore({ db });
  await first.init();
  const account = await first.createAccount({ username: 'JsonHero', passwordHash: 'hash' });
  const character = await first.createCharacter(account.id, createCharacterState('JsonHero', 'json-hero'));
  character.gold = 777;
  character.stall = {
    items: [{ uid: 'listing_1', itemId: 'bow_wood', qty: 1, price: 250 }],
    createdAt: new Date().toISOString(),
  };
  await first.saveCharacter(character);
  await first.close(); // vuelca la memoria a Firestore (como en SIGTERM)

  const second = new FirestoreStore({ db });
  await second.init();
  const loaded = await second.loadCharacter('json-hero');
  assert.equal(loaded.name, 'JsonHero');
  assert.equal(loaded.gold, 777);
  assert.equal(loaded.stall.items.length, 1);
  assert.equal(loaded.stall.items[0].price, 250);

  // La compra atómica debe sobrevivir al siguiente reinicio.
  const sold = await second.buyStallItem({ sellerId: 'json-hero', itemUid: 'listing_1', buyerId: 'buyer' });
  assert.equal(sold.ok, true);
  await second.close();

  const third = new FirestoreStore({ db });
  await third.init();
  const after = await third.loadCharacter('json-hero');
  assert.equal(after.gold, 777 + 250, 'el vendedor offline recibe el oro');
  assert.equal(after.stall, null, 'la tienda vacía se elimina');
  await third.close();
});

test('FirestoreStore guarda sólo en flush (el tick no escribe a Firestore)', async () => {
  const db = createFakeFirestore();
  const store = new FirestoreStore({ db, autosaveMs: 60_000 });
  await store.init();

  const account = await store.createAccount({ email: 'tick@test.com', username: 'tick@test.com', uid: 'uid-1' });
  await store.createCharacter(account.id, createCharacterState('Ticker', 'char-1'));

  // Simula varios ciclos de guardado del bucle de juego (RAM únicamente).
  const character = await store.loadCharacter('char-1');
  character.gold = 500;
  await store.saveCharacter(character);
  let doc = db._docs.get('players/uid-1');
  assert.equal(doc.character.gold !== 500, true, 'saveCharacter no escribe a Firestore');
  assert.equal(store.dirty.has(account.id), true, 'la cuenta queda marcada dirty');

  // Flush (equivalente al autosave de 5 min o al SIGTERM).
  await store.flush();
  doc = db._docs.get('players/uid-1');
  assert.equal(doc.character.gold, 500, 'flush vuelca la RAM a Firestore');
  assert.equal(store.dirty.size, 0);

  // Login por uid: otro proceso recupera todo desde Firestore.
  const fresh = new FirestoreStore({ db, autosaveMs: 60_000 });
  await fresh.init();
  const byUid = await fresh.getAccountByEmail('tick@test.com', { uid: 'uid-1' });
  assert.equal(byUid.id, account.id);
  const loadedChar = await fresh.getCharacterByAccount(account.id);
  assert.equal(loadedChar.gold, 500);
  await fresh.close();
  await store.close();
});

function playerWithStall(name, id, items) {
  const player = new PlayerState(createCharacterState(name, id));
  const bowIndex = player.inventory.findIndex((slot) => slot?.itemId === 'bow_wood');
  const bow = player.inventory[bowIndex];
  player.inventory[bowIndex] = null;
  player.x = 40;
  player.y = 42;
  player.stall = { items, createdAt: new Date().toISOString() };
  return { player, bow };
}

test('restoreStallOnLogin devuelve los ítems y cierra el puesto', async () => {
  const store = new MemoryStore();
  await store.init();
  const server = new GameServer({ store, config: { ...baseConfig, port: 0 } });
  const listing = { uid: 'bow_uid', itemId: 'bow_wood', qty: 1, price: 100 };
  const { player } = playerWithStall('Vendedor', 'stall_a', [listing]);
  server.world.addStall({
    id: 'stall_stall_a', characterId: 'stall_a', ownerName: 'Vendedor',
    x: 40, y: 42, items: [listing], online: false,
  });

  const restored = await server.restoreStallOnLogin(player);

  assert.deepEqual(restored, { leftovers: [] });
  assert.equal(player.stall, null);
  assert.equal(player.countItem('bow_wood'), 1, 'el ítem vuelve a la mochila');
  assert.equal(player.dirty, true, 'el cambio se persiste en el siguiente guardado');
  assert.equal(server.world.stalls.has('stall_stall_a'), false);
});

test('restoreStallOnLogin deja en la bolsa lo que no cabe en la mochila', async () => {
  const store = new MemoryStore();
  await store.init();
  const server = new GameServer({ store, config: { ...baseConfig, port: 0 } });
  const listing = { uid: 'bow_uid_2', itemId: 'bow_wood', qty: 1, price: 100 };
  const { player } = playerWithStall('Vendedor', 'stall_b', [listing]);
  for (let i = 0; i < player.inventory.length; i += 1) {
    if (!player.inventory[i]) {
      player.inventory[i] = { uid: `filler_${i}`, itemId: 'sword_wood', qty: 1 };
    }
  }

  const restored = await server.restoreStallOnLogin(player);

  assert.equal(restored.leftovers.length, 1);
  assert.equal(restored.leftovers[0].itemId, 'bow_wood');
  assert.equal(restored.leftovers[0].qty, 1);
  assert.equal(player.countItem('bow_wood'), 0, 'la mochila sigue llena');
});
