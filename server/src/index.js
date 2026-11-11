import { config } from './config.js';
import { createStore } from './db/index.js';
import { GameServer } from './net/gameServer.js';
// deploy trigger: slot mano unificado
// deploy trigger: master fix slot mano completo
// deploy trigger: validacion servidor slot mano final
// deploy trigger: habilitar slot mano en servidor, UI y render de sprite
// deploy trigger: 2026-11-11 01:30:00 auto-deploy render inventario rucoy

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
