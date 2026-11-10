import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  AOI_RADIUS,
  SNAPSHOT_RATE,
  TICK_RATE,
} from '../shared/index.js';
import { DEFAULT_ADMIN_EMAILS } from './admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');

// Carga .env de la raíz del monorepo (sin sobreescribir variables ya definidas).
dotenv.config({ path: path.join(ROOT_DIR, '.env'), override: false });

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const list = (value) => String(value ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export const config = {
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-please',
  // Persistencia: Firestore en producción (Render borra el disco en cada deploy).
  // Sin FIREBASE_SERVICE_ACCOUNT se usa memoria (desarrollo local / tests).
  storeDriver: process.env.STORE_DRIVER
    || (process.env.FIREBASE_SERVICE_ACCOUNT ? 'firestore' : 'memory'),
  databaseUrl: process.env.DATABASE_URL || '',
  pgSsl: process.env.PGSSL === 'true',
  tickRate: Math.min(60, Math.max(5, int(process.env.TICK_RATE, TICK_RATE))),
  snapshotRate: Math.min(30, Math.max(2, int(process.env.SNAPSHOT_RATE, SNAPSHOT_RATE))),
  aoiRadius: Math.max(8, Math.min(35, int(process.env.AOI_RADIUS, AOI_RADIUS))),
  // Semiancho/semialto del viewport landscape usado para culling de snapshots.
  viewHalfW: Math.max(10, Math.min(40, int(process.env.VIEW_HALF_W, 18))),
  viewHalfH: Math.max(7, Math.min(24, int(process.env.VIEW_HALF_H, 11))),
  maxPlayers: int(process.env.MAX_PLAYERS, 500),
  clientDist: path.resolve(ROOT_DIR, 'client/dist'),
  tokenTtlMs: 1000 * 60 * 60 * 24 * 30,
  // Audience(s) válidas para los ID tokens de Google. Normalmente el client ID
  // de tipo "Web application" configurado también en la app Android.
  googleClientIds: list(
    [
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_WEB_CLIENT_ID,
      process.env.GOOGLE_ANDROID_CLIENT_ID,
      process.env.GOOGLE_CLIENT_IDS,
    ].filter(Boolean).join(','),
  ),
  // Service ID de Apple para el flujo iOS/web (no se usa en Android).
  appleClientIds: list(process.env.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_IDS),
  // Correos con permisos de administrador (ver server/src/admin.js).
  adminEmails: list(process.env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS.join(',')),
};

config.tickMs = Math.floor(1000 / config.tickRate);
config.snapshotEveryTicks = Math.max(1, Math.round(config.tickRate / config.snapshotRate));
