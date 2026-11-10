import { normalizeEmail } from './auth.js';

/**
 * Cuentas con permisos de administrador ("modo creativo").
 *
 * La identidad se resuelve SIEMPRE con el correo verificado que devuelve el
 * proveedor OAuth (Google/Apple), nunca con un campo enviado por el cliente,
 * así que un jugador no puede auto-promoverse editando el payload del WebSocket.
 */

/** Correo con privilegios por defecto si no se define ADMIN_EMAILS. */
export const DEFAULT_ADMIN_EMAILS = ['alejoargumedo.edu@gmail.com'];

/** Nombre reservado del personaje administrador. */
export const ADMIN_CHARACTER_NAME = 'ChiwiADMIN';

/** Color con el que el cliente pinta el nombre del administrador. */
export const ADMIN_NAME_COLOR = '#800080';

/** Normaliza una lista (array o "a@b.com,c@d.com") a correos en minúsculas. */
export function normalizeAdminEmails(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(
    items
      .map((item) => normalizeEmail(item))
      .filter(Boolean),
  )];
}

/** ¿El correo pertenece a la lista de administradores? */
export function isAdminEmail(email, adminEmails = DEFAULT_ADMIN_EMAILS) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return normalizeAdminEmails(adminEmails).includes(normalized);
}

/** Propiedades extra que se guardan en la base de datos del personaje admin. */
export function adminCharacterFlags() {
  return { isAdmin: true, nameColor: ADMIN_NAME_COLOR };
}
