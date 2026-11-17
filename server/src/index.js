import { config } from './config.js';
import { createStore } from './db/index.js';
import { GameServer } from './net/gameServer.js';
// deploy trigger: slot mano unificado
// deploy trigger: master fix slot mano completo
// deploy trigger: validacion servidor slot mano final
// deploy trigger: habilitar slot mano en servidor, UI y render de sprite
// deploy trigger: 2026-11-11 06:30:00 auto-deploy render rucoy compact inventory silhouettes
// deploy trigger: 2026-11-11 12:29:12 build actualizacion servidor render y nuevo cliente apk
// deploy trigger: 2026-11-17 14:00:00 feat expansion mapa gigante y sistema spawners por zonas
// deploy trigger: 2026-11-17 16:00:00 perf AoI biomas y optimizacion red
// deploy trigger: 2026-11-17 18:00:00 feat lerp biomas organicos y follaje denso
// deploy trigger: 2026-11-17 20:00:00 fix ocean playa sprites ui tala segura
// deploy trigger: 2026-11-17 22:00:00 fix colision troncos y respawn seguro arboles
// deploy trigger: 2026-11-17 23:30:00 feat expansion mapa mobs playa leashing troncos
// deploy trigger: 2026-11-18 01:00:00 fix renderizado mapa negro y toasts loot
// deploy trigger: 2026-11-18 02:30:00 fix autoscale minimapa spawns playa y IA mobs

const store = await createStore();
const game = new GameServer({ store, config });
await game.start();

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} recibido, guardando y cerrando…`);
  try {
    await game.stop();
  } catch (err) {
    console.error('[server] error al cerrar:', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
process.on('uncaughtException', (err) => console.error('[uncaught]', err));
