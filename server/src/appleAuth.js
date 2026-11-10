import { createRemoteJWKSet, jwtVerify } from 'jose';
import { EMAIL_RE, normalizeEmail } from './auth.js';
import { OAuthError } from './googleAuth.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

/**
 * Verifica un identityToken de Sign in with Apple contra las claves públicas
 * de Apple. En Android no se usa: Apple sólo ofrece el flujo nativo en iOS.
 */
export class AppleTokenVerifier {
  constructor({ clientIds = [] } = {}) {
    this.clientIds = [...new Set(
      (Array.isArray(clientIds) ? clientIds : [clientIds])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    )];
  }

  get configured() {
    return this.clientIds.length > 0;
  }

  async verify(idToken) {
    const token = String(idToken ?? '').trim();
    if (!token || token.length > 8192) {
      throw new OAuthError('Token de Apple requerido');
    }
    if (!this.configured) {
      throw new OAuthError('Apple Sign-In no está configurado en el servidor');
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, APPLE_JWKS, {
        issuer: APPLE_ISSUER,
        audience: this.clientIds,
      }));
    } catch (err) {
      throw new OAuthError('Token de Apple inválido o expirado', { cause: err });
    }

    const email = normalizeEmail(payload?.email);
    if (!email || !EMAIL_RE.test(email)) {
      throw new OAuthError('Apple no compartió un correo válido. Autoriza de nuevo la cuenta.');
    }

    return {
      provider: 'apple',
      subject: String(payload.sub ?? ''),
      email,
      name: '',
      picture: '',
    };
  }
}
