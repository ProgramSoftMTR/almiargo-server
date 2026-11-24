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
// deploy trigger: 2026-11-18 03:00:00 perf optimizacion IA, sleep mode mobs y reduccion carga servidor
// deploy trigger: 2026-11-18 11:00:00 feat mayor densidad mobs playa y ocultar joystick tocar pantalla
// deploy trigger: 2026-11-18 12:00:00 feat pantalla carga previa y mundo persistente 24/7
// deploy trigger: 2026-11-18 13:00:00 feat aumento densidad 180 mobs y 28 spawners playa
// deploy trigger: 2026-11-18 14:00:00 feat spawners mixtos playa distribucion equitativa espaciado
// deploy trigger: 2026-11-18 15:00:00 fix sincronizacion silenciosa loot bags y eliminacion alerta bolsa no encontrada
// deploy trigger: 2026-11-18 16:00:00 feat indicador dinamico bioma minimapa
// deploy trigger: 2026-11-18 17:00:00 feat ataque a distancia y proyectil de arena en sandcastle
// deploy trigger: 2026-11-18 18:00:00 feat rango 4 tiles y persecucion dinamica sandcastle
// deploy trigger: 2026-11-18 19:00:00 feat animacion respiracion idle personaje
// deploy trigger: 2026-11-18 20:00:00 feat mesa de trabajo 3x3 estilo minecraft y tirar cualquier item
// deploy trigger: 2026-11-18 20:00:00 perf migracion Ohio prediccion cliente interpolacion suave
// deploy trigger: 2026-11-18 21:00:00 art manglares palmeras preservacion pradera
// deploy trigger: 2026-11-18 22:00:00 perf hibernacion mobs cache sprites cliente
// deploy trigger: 2026-11-18 23:00:00 ui contador FPS HUD
// deploy trigger: 2026-11-19 00:00:00 fix palmeras borde playa time-slicing mobs
// deploy trigger: 2026-11-19 01:00:00 fix tocon transparente hojas palmeras densidad
// deploy trigger: 2026-11-19 02:00:00 feat manglar drops exclusivos
// deploy trigger: 2026-11-19 03:00:00 feat mesa de trabajo crafteo 3x3
// deploy trigger: 2026-11-24 12:00:00 feat soltar items en el suelo al talar arboles y sistema mochilas
// deploy trigger: 2026-11-24 14:00:00 feat drops directos con sprite de item sin banner de tala y pathfinding universal
// deploy trigger: 2026-11-24 16:00:00 fix renderizar sprite real del item en suelo en lugar de bolsa
// deploy trigger: 2026-11-24 18:00:00 fix quitar avisos y mejorar mesa de trabajo
// deploy trigger: 2026-11-24 20:00:00 fix crafteo, icono de trabajo, sprite de casco y proteccion inventario lleno
// deploy trigger: 2026-11-24 22:00:00 fix icono martillo y llave al craftear y bloqueo compra con inventario lleno
// deploy trigger: 2026-11-24 23:30:00 fix icono cruzado martillo llave y bloqueo compra antes de cobrar oro
// deploy trigger: 2026-11-25 01:00:00 fix bloquear crafteo si el inventario esta lleno
// deploy trigger: 2026-11-25 03:00:00 feat drops de mobs sin bolsa con sprite pixel art de monedas e items
// deploy trigger: 2026-11-25 05:00:00 feat boton de oro y selector de mob en panel admin
// deploy trigger: 2026-11-25 07:00:00 fix separar drops de monedas e items en tiles distintos al morir mobs
// deploy trigger: 2026-11-25 09:00:00 fix mobs invocados desde panel admin no reaparecen al morir
// deploy trigger: 2026-11-25 11:00:00 fix capacidad de mochila equipada y ventana de inventario mas amplia

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
