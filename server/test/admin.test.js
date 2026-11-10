import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/db/memory.js';
import { GameServer } from '../src/net/gameServer.js';
import { config as baseConfig } from '../src/config.js';
import { PlayerState, createCharacterState } from '../src/game/player.js';
import {
  ADMIN_CHARACTER_NAME,
  ADMIN_NAME_COLOR,
  isAdminEmail,
  normalizeAdminEmails,
} from '../src/admin.js';

const ADMIN_EMAIL = 'alejoargumedo.edu@gmail.com';

function fakeSession(account) {
  const sent = [];
  return {
    id: `sess_${account.id}`,
    authed: true,
    accountId: account.id,
    email: account.email,
    player: null,
    ip: '127.0.0.1',
    sent,
    socket: {
      readyState: 1,
      send: (data) => sent.push(JSON.parse(data)),
      close() {},
    },
  };
}

async function setup() {
  const store = new MemoryStore();
  await store.init();
  const server = new GameServer({
    store,
    config: { ...baseConfig, port: 0, adminEmails: [ADMIN_EMAIL] },
  });
  return { store, server };
}

test('normalizeAdminEmails/isAdminEmail comparan el correo normalizado', () => {
  assert.deepEqual(
    normalizeAdminEmails(' Admin@Example.com , OTRO@example.com ,admin@example.com'),
    ['admin@example.com', 'otro@example.com'],
  );
  assert.equal(isAdminEmail('ALEJOARGUMEDO.EDU@gmail.com', [ADMIN_EMAIL]), true);
  assert.equal(isAdminEmail('otro@example.com', [ADMIN_EMAIL]), false);
  assert.equal(isAdminEmail('', [ADMIN_EMAIL]), false);
});

test('el personaje admin se crea como ChiwiADMIN con isAdmin y nombre morado', async () => {
  const { store, server } = await setup();
  const account = await store.createAccount({ email: ADMIN_EMAIL, username: ADMIN_EMAIL });
  const session = fakeSession(account);

  // El nombre que escriba el cliente se ignora por completo.
  await server.handleCreateCharacter(session, { name: 'NombreCualquiera' });

  const character = await store.getCharacterByAccount(account.id);
  assert.equal(character.name, ADMIN_CHARACTER_NAME);
  assert.equal(character.isAdmin, true);
  assert.equal(character.nameColor, ADMIN_NAME_COLOR);

  const authOk = session.sent.find((m) => m.type === 'auth_ok' && m.needsCharacter === false);
  assert.ok(authOk, 'se envía auth_ok con el perfil');
  assert.equal(authOk.player.name, ADMIN_CHARACTER_NAME);
  assert.equal(authOk.player.isAdmin, true);
  assert.equal(authOk.player.nameColor, ADMIN_NAME_COLOR);
  assert.equal(session.player.isAdmin, true);
});

test('un jugador normal mantiene su nombre y no obtiene privilegios', async () => {
  const { store, server } = await setup();
  const account = await store.createAccount({ email: 'player@example.com', username: 'player@example.com' });
  const session = fakeSession(account);

  // Intento de auto-promoción en el payload: se ignora.
  await server.handleCreateCharacter(session, {
    name: 'NormalGuy',
    isAdmin: true,
    nameColor: '#ff0000',
  });

  const character = await store.getCharacterByAccount(account.id);
  assert.equal(character.name, 'NormalGuy');
  assert.equal(character.isAdmin, false);
  assert.equal(character.nameColor, null);
  assert.equal(session.player.isAdmin, false);
});

test('el nombre ChiwiADMIN está reservado para cuentas que no son admin', async () => {
  const { store, server } = await setup();
  const account = await store.createAccount({ email: 'player@example.com', username: 'player@example.com' });
  const session = fakeSession(account);

  await server.handleCreateCharacter(session, { name: ADMIN_CHARACTER_NAME });

  assert.ok(session.sent.some((m) => m.type === 'character_error' && /reservado/i.test(m.message)));
  assert.equal(await store.getCharacterByAccount(account.id), null);
  assert.equal(session.player, null);
});

test('el login re-aplica los privilegios a un personaje admin ya guardado', async () => {
  const { store, server } = await setup();
  const account = await store.createAccount({ email: ADMIN_EMAIL, username: ADMIN_EMAIL });
  await store.createCharacter(
    account.id,
    createCharacterState('ViejoAdmin', 'legacy-admin'),
  );
  const session = fakeSession(account);

  await server.attachPlayer(session, account, await store.loadCharacter('legacy-admin'));

  assert.equal(session.player.isAdmin, true);
  assert.equal(session.player.nameColor, ADMIN_NAME_COLOR);
  assert.equal(session.player.dirty, true, 'el cambio se persiste en el siguiente guardado');
});

test('isAdmin y nameColor sobreviven a la serialización del guardado', () => {
  const state = createCharacterState('ChiwiADMIN', 'admin-1');
  state.isAdmin = true;
  state.nameColor = ADMIN_NAME_COLOR;

  const reloaded = new PlayerState(JSON.parse(JSON.stringify(state)));
  assert.equal(reloaded.isAdmin, true);
  assert.equal(reloaded.nameColor, ADMIN_NAME_COLOR);
  assert.equal(reloaded.toProfile().isAdmin, true);
  assert.equal(reloaded.toProfile().nameColor, ADMIN_NAME_COLOR);
  assert.equal(reloaded.toState().isAdmin, true);
});
