import assert from 'node:assert/strict';
import test from 'node:test';
import { GoogleTokenVerifier } from '../src/googleAuth.js';

const payload = (overrides = {}) => ({
  sub: 'google-sub',
  email: 'Player@Example.com',
  email_verified: true,
  name: 'Player',
  picture: 'https://example.com/p.png',
  ...overrides,
});

test('GoogleTokenVerifier exige un client ID configurado', async () => {
  const verifier = new GoogleTokenVerifier({ clientIds: [] });
  await assert.rejects(() => verifier.verify('token'), /no está configurado/i);
});

test('GoogleTokenVerifier valida audience y normaliza el correo', async () => {
  let seen = null;
  const client = {
    async verifyIdToken(options) {
      seen = options;
      return { getPayload: () => payload() };
    },
  };
  const verifier = new GoogleTokenVerifier({ clientIds: ['web-client'], client });
  const identity = await verifier.verify('valid-token');

  assert.deepEqual(seen, { idToken: 'valid-token', audience: ['web-client'] });
  assert.equal(identity.email, 'player@example.com');
  assert.equal(identity.provider, 'google');
  assert.equal(identity.subject, 'google-sub');
});

test('GoogleTokenVerifier rechaza correos no verificados', async () => {
  const client = {
    async verifyIdToken() {
      return { getPayload: () => payload({ email_verified: false }) };
    },
  };
  const verifier = new GoogleTokenVerifier({ clientIds: ['web-client'], client });
  await assert.rejects(() => verifier.verify('valid-token'), /correo verificado/i);
});

test('GoogleTokenVerifier oculta los detalles del error del proveedor', async () => {
  const client = {
    async verifyIdToken() {
      throw new Error('signature mismatch at internal key');
    },
  };
  const verifier = new GoogleTokenVerifier({ clientIds: ['web-client'], client });
  await assert.rejects(
    () => verifier.verify('bad-token'),
    (err) => err.public === true && /inválido o expirado/i.test(err.message),
  );
});
