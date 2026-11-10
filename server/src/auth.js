import crypto from 'node:crypto';

/** Tokens HMAC stateless para la sesión del juego. */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signToken(payload, secret, ttlMs = 1000 * 60 * 60 * 24 * 30) {
  const body = { ...payload, exp: Date.now() + ttlMs };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,14}$/;
export const CHARACTER_NAME_RE = /^[A-Za-z0-9_ ]{3,16}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}
