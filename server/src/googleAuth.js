import { OAuth2Client } from 'google-auth-library';
import { EMAIL_RE, normalizeEmail } from './auth.js';

/**
 * Error de autenticaciÃ³n seguro para enviar al cliente. No incluye detalles
 * internos de Google (firmas, audiences, etc.).
 */
export class OAuthError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'OAuthError';
    this.public = true;
  }
}

/**
 * Verifica un ID token (JWT) emitido por Google Identity Services.
 *
 * El cliente Android obtiene el token con Credential Manager usando el
 * client ID de tipo "Web application"; ese mismo ID debe configurarse aquÃ­
 * en GOOGLE_CLIENT_ID (o una lista separada por comas para varios entornos).
 * google-auth-library comprueba firma, emisor, expiraciÃ³n y audience.
 */
export class GoogleTokenVerifier {
  constructor({ clientIds = [], client = null } = {}) {
    this.clientIds = [...new Set(
      (Array.isArray(clientIds) ? clientIds : [clientIds])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    )];
    this.client = client ?? new OAuth2Client();
  }

  get configured() {
    return this.clientIds.length > 0;
  }

  async verify(idToken) {
    const token = String(idToken ?? '').trim();
    if (!token || token.length > 8192) {
      throw new OAuthError('Token de Google requerido');
    }
    if (!this.configured) {
      throw new OAuthError('Google Sign-In no está configurado en el servidor');
    }

    let ticket;
    try {
      const sanitizeId = (id) => {
        if (!id) return '';
        return String(id)
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .replace(/[^\x20-\x7E]/g, '')
          .trim();
      };

      const cleanAudiences = [
        sanitizeId(process.env.GOOGLE_CLIENT_ID),
        sanitizeId(process.env.GOOGLE_ANDROID_CLIENT_ID),
        ...(Array.isArray(this.clientIds) ? this.clientIds.map(sanitizeId) : []),
      ].filter(Boolean);

let decodedPayload = null;
try {
  const payloadB64 = idToken.split('.')[1];
  decodedPayload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
  console.log("=== DEBUG PROFUNDO DE AUDIENCE ===");
  console.log("1. Token AUD crudo:", decodedPayload.aud, "| Largo:", decodedPayload.aud?.length);
  console.log("2. Env WEB ID:", process.env.GOOGLE_CLIENT_ID, "| Largo:", process.env.GOOGLE_CLIENT_ID?.length);
  console.log("3. Env ANDROID ID:", process.env.GOOGLE_ANDROID_CLIENT_ID, "| Largo:", process.env.GOOGLE_ANDROID_CLIENT_ID?.length);
  console.log("4. Coincidencia estricta WEB? (aud === env):", decodedPayload.aud === process.env.GOOGLE_CLIENT_ID);
  console.log("5. Coincidencia estricta ANDROID?:", decodedPayload.aud === process.env.GOOGLE_ANDROID_CLIENT_ID);
  if (decodedPayload.aud && process.env.GOOGLE_CLIENT_ID) {
    const envClean = process.env.GOOGLE_CLIENT_ID.trim();
    for (let i = 0; i < Math.max(decodedPayload.aud.length, envClean.length); i++) {
      if (decodedPayload.aud[i] !== envClean[i]) {
        console.log(`Mismatch pos ${i}: Token='${decodedPayload.aud[i]}' vs Env='${envClean[i]}'`);
      }
    }
  }
  console.log("==================================");
} catch (error) {
  console.log("Error en debug manual:", error.message);
}

      const audiences = Array.from(new Set([
        decodedPayload?.aud,
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID
      ].filter(Boolean).map((id) => String(id).trim())));

      ticket = await this.client.verifyIdToken({
        idToken,
        audience: cleanAudiences,
      });
    } catch (err) {
      let receivedAudience = null;
      let receivedAzp = null;
      try {
        const parts = token.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8'),
          );
          receivedAudience = payload?.aud ?? null;
          receivedAzp = payload?.azp ?? null;
        }
      } catch {
        // El token no es un JWT decodificable; se conserva el error original.
      }
      console.log(
        '[auth] fallo Google: payload.aud =',
        receivedAudience,
        'payload.azp =',
        receivedAzp,
        'clientIds =',
        this.clientIds,
      );
      throw new OAuthError('Token de Google inválido o expirado', { cause: err });
    }

    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email);
    const emailVerified = payload?.email_verified === true || payload?.email_verified === 'true';
    if (!email || !EMAIL_RE.test(email) || !emailVerified) {
      throw new OAuthError('La cuenta de Google no tiene un correo verificado');
    }

    return {
      provider: 'google',
      subject: String(payload.sub ?? ''),
      email,
      name: String(payload.name ?? ''),
      picture: String(payload.picture ?? ''),
    };
  }
}

