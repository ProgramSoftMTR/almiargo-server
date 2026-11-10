import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { CONSTANTS, decodeSelf } from '@almiargo/shared';
import { MemoryStore } from '../src/db/memory.js';
import { GameServer } from '../src/net/gameServer.js';
import { config as baseConfig } from '../src/config.js';

/**
 * Prueba de integración end-to-end sin base de datos externa:
 * auth -> movimiento -> cambio de clase -> ataque -> chat -> reconexión por token.
 * Uso: node server/tools/smoke-test.js
 */

const config = {
  ...baseConfig,
  port: 0,
  host: '127.0.0.1',
  storeDriver: 'memory',
  jwtSecret: 'smoke-test-secret',
  tickRate: 20,
  tickMs: 50,
  snapshotRate: 10,
  snapshotEveryTicks: 2,
  aoiRadius: 20,
  maxPlayers: 20,
  clientDist: 'C:/nonexistent',
};

class TestClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.queue = [];
    this.waiters = [];
    this.all = [];
    this.closed = false;
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      this.all.push(msg);
      if (this.all.length > 200) this.all.shift();
      const idx = this.waiters.findIndex((w) => w.predicate(msg));
      if (idx >= 0) {
        const [w] = this.waiters.splice(idx, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
    this.ws.on('close', () => { this.closed = true; });
    this.ready = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
  }

  send(obj) { this.ws.send(JSON.stringify(obj)); }

  waitFor(predicate, timeout = 4000, label = 'mensaje') {
    const idx = this.queue.findIndex(predicate);
    if (idx >= 0) return Promise.resolve(this.queue.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        console.error('[smoke] últimos mensajes:', JSON.stringify(this.all.slice(-12)));
        reject(new Error(`Timeout esperando ${label}`));
      }, timeout);
      this.waiters.push({ predicate, resolve, timer });
    });
  }

  waitType(type, timeout) {
    return this.waitFor((m) => m.type === type, timeout, type);
  }

  waitEvent(event, timeout) {
    return this.waitFor((m) => m.type === 'event' && m.event === event, timeout, `event:${event}`);
  }

  close() { this.ws.close(); }
}

const store = new MemoryStore();
await store.init();
const email = `smoke-${Date.now()}@example.com`;
const googleAuth = {
  configured: true,
  async verify(token) {
    if (token !== 'smoke-google-jwt') {
      const err = new Error('Token de Google inválido o expirado');
      err.public = true;
      throw err;
    }
    return { provider: 'google', subject: 'smoke-subject', email, name: 'Smoke' };
  },
};
const server = new GameServer({ store, config, googleAuth });
await server.start();
const url = `ws://127.0.0.1:${server.port}/ws`;
console.log('[smoke] servidor en', url);

try {
  // Un JWT inválido se rechaza dentro del WebSocket, sin peticiones HTTP.
  const rejected = new TestClient(url);
  await rejected.ready;
  await rejected.waitType('hello');
  rejected.send({ type: 'auth', provider: 'google', token: 'invalid-google-jwt' });
  const rejectedAuth = await rejected.waitType('auth_error');
  assert.match(rejectedAuth.message, /Google/i);
  rejected.close();
  console.log('[smoke] token OAuth inválido rechazado ok');

  const c1 = new TestClient(url);
  await c1.ready;
  await c1.waitType('hello');
  c1.send({ type: 'auth', provider: 'google', token: 'smoke-google-jwt' });
  const accountAuth = await c1.waitType('auth_ok');
  assert.equal(accountAuth.needsCharacter, true, 'cuenta nueva debe pedir personaje');
  assert.equal(accountAuth.provider, 'google');
  c1.send({ type: 'create_character', name: 'SmokeHero' });
  const auth = await c1.waitType('auth_ok');
  assert.equal(auth.player.name, 'SmokeHero');
  assert.equal(auth.needsCharacter, false);
  console.log('[smoke] login OAuth + creación de personaje ok');
  const token = auth.token;
  const playerId = auth.player.id;
  console.log('[smoke] auth ok, nivel', auth.player.level, 'hp', auth.player.maxHp);

  // Movimiento validado en servidor
  const before = server.world.getPlayer(playerId);
  const startY = before.y;
  c1.send({ type: 'move', dir: [0, 1], seq: 1 });
  await c1.waitFor((m) => m.type === 'snapshot' && decodeSelf(m.self).y === startY + 1, 3000, 'movimiento');
  console.log('[smoke] movimiento autoritativo ok');

  // Cambio de clase por equipamiento: equipar el arco cambia el rol a Arquero
  const player = server.world.getPlayer(playerId);
  const bow = player.inventory.find((slot) => slot?.itemId === 'bow_wood');
  assert.ok(bow, 'debe tener un arco en el inventario inicial');
  c1.send({ type: 'equip', uid: bow.uid });
  const switched = await c1.waitEvent('profile');
  assert.equal(switched.player.classId, 'archer');
  console.log('[smoke] cambio de clase ok (arquero)');

  // Coloca al jugador junto a un slime y ataca (solo el server calcula daño)
  const slime = [...server.world.monsters.values()].find((m) => m.defId === 'slime' && m.alive);
  assert.ok(slime, 'debe existir un slime');
  const spot = server.world.findFreeAdjacent(slime.x, slime.y);
  server.world.moveEntity(player, spot.x, spot.y);
  player.nextAttackAt = 0;
  player.targetId = null;
  const hpBefore = slime.hp;
  console.log('[smoke] atacando', slime.id, 'desde', player.x, player.y, 'slime', slime.x, slime.y, 'clase', player.classId, 'flechas', player.countItem('arrow'), 'cd', player.nextAttackAt - Date.now());
  c1.send({ type: 'attack', id: slime.id });
  const dmg = await c1.waitFor(
    (m) => m.type === 'event' && m.event === 'damage' && m.tid === slime.id,
    3000,
    'daño al slime',
  );
  assert.equal(dmg.tid, slime.id);
  assert.ok(dmg.amount >= 1);
  assert.ok(slime.hp < hpBefore);
  console.log('[smoke] combate ok, daño', dmg.amount, 'slime hp', slime.hp);

  // El perfil posterior al disparo debe reflejar la flecha consumida.
  const countArrows = (profile) => (profile.inventory ?? [])
    .reduce((acc, slot) => acc + (slot?.itemId === 'arrow' ? slot.qty : 0), 0);
  const arrowProfile = await c1.waitFor(
    (m) => m.type === 'event' && m.event === 'profile' && countArrows(m.player) === 49,
    3000,
    'perfil con 49 flechas',
  );
  assert.equal(arrowProfile.player.classId, 'archer');

  // Habilidad especial del arquero (disparo triple) por el protocolo real.
  const mpBefore = player.mp;
  const arrowsBeforeSpecial = player.countItem('arrow');
  c1.send({ type: 'special' });
  const special = await c1.waitEvent('special');
  assert.equal(special.classId, 'archer');
  assert.ok(Array.isArray(special.hits));
  assert.equal(player.mp, mpBefore - CONSTANTS.SPECIAL_MANA_COST);
  assert.equal(player.countItem('arrow'), arrowsBeforeSpecial - 3);
  console.log('[smoke] especial ok, impactos', special.hits.length);
  c1.send({ type: 'stop' });

  // Tienda AFK: abrir y cerrar en la ciudad.
  server.world.moveEntity(player, 40, 42);
  const potion = player.inventory.find((slot) => slot?.itemId === 'potion_hp');
  assert.ok(potion, 'debe tener una poción para vender');
  c1.queue.length = 0;
  c1.send({ type: 'stall_open', items: [{ uid: potion.uid, price: 10 }] });
  await c1.waitFor(
    (m) => m.type === 'event' && m.event === 'profile' && m.player?.inStall === true,
    3000,
    'tienda abierta',
  );
  assert.ok(server.world.stalls.has(`stall_${playerId}`), 'el puesto existe en el mundo');
  c1.queue.length = 0;
  c1.send({ type: 'stall_close' });
  const countPotions = (p) => (p.inventory ?? [])
    .reduce((acc, slot) => acc + (slot?.itemId === 'potion_hp' ? slot.qty : 0), 0);
  await c1.waitFor(
    (m) => m.type === 'event' && m.event === 'profile'
      && m.player?.inStall === false && countPotions(m.player) === 5,
    3000,
    'tienda cerrada',
  );
  assert.equal(player.countItem('potion_hp'), 5, 'los ítems vuelven a la mochila');
  console.log('[smoke] tienda AFK ok');

  // Chat global
  c1.send({ type: 'chat', channel: 'global', text: 'hola mundo desde smoke' });
  const chat = await c1.waitFor((m) => m.type === 'chat' && m.text.includes('hola mundo'), 3000, 'chat');
  assert.equal(chat.from, 'SmokeHero');
  console.log('[smoke] chat ok');

  // Persistencia en store
  await server.saveAll(true);
  const saved = await store.loadCharacter(playerId);
  assert.equal(saved.name, 'SmokeHero');

  // Reconexión con token
  c1.close();
  await new Promise((r) => setTimeout(r, 300));
  const c2 = new TestClient(url);
  await c2.ready;
  await c2.waitType('hello');
  c2.send({ type: 'auth', token });
  const auth2 = await c2.waitType('auth_ok');
  assert.equal(auth2.player.id, playerId);
  console.log('[smoke] reconexión por token ok');

  // Sesión única: la tercera conexión expulsa a la segunda por correo/cuenta.
  const c3 = new TestClient(url);
  await c3.ready;
  await c3.waitType('hello');
  c3.send({ type: 'auth', token });
  const replaced = await c2.waitEvent('session_replaced', 3000);
  assert.match(replaced.message, /nueva sesión/i);
  const auth3 = await c3.waitType('auth_ok');
  assert.equal(auth3.player.id, playerId);
  console.log('[smoke] sesión única ok');

  c3.close();
  console.log('\n✅ SMOKE TEST OK');
} finally {
  await server.stop();
  await new Promise((r) => setTimeout(r, 200));
}
