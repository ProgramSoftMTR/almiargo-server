# Almiargo Online — MMORPG 2D mobile-first

MMORPG 2D mobile-first: servidor **Node.js autoritativo**, cliente **Phaser 3**, UI táctil y empaquetado **Capacitor 7 → Android APK**.

El servidor manda el estado (posiciones, daño, loot, oro); el cliente sólo envía intenciones. No hay assets externos: mapas, sprites e iconos se generan en runtime a partir de una semilla compartida.

---

## 1. Stack

| Capa | Tecnología |
| --- | --- |
| Servidor | Node.js 20+, `ws` (JSON), tick autoritativo 20 Hz, snapshots 10 Hz |
| Persistencia | PostgreSQL (producción), JSON cero-config, memoria (tests) |
| Cliente | Phaser 3 + Vite 7, DOM/CSS HUD, Canvas |
| Auth | Google Sign-In nativo/web → ID token en el primer payload WS; sesión HMAC stateless |
| Móvil | Capacitor 7, Android SDK 35, JDK 21 |
| Tests | `node:test` (74 tests + smoke E2E) |

---

## 2. Estructura

```
Almiargo Online/
├─ packages/shared/            # código compartido server+cliente
│  ├─ src/config.js            # balance, ítems, monstruos, clases, zonas, curvas
│  ├─ src/formulas.js          # daño, XP, stats, loot, calaveras
│  ├─ src/inventory.js         # stacks, equipamiento, espacio
│  ├─ src/worldgen.js          # mapa determinista 80×80 por semilla
│  ├─ src/pathfinding.js       # A* para tap-to-move
│  ├─ src/protocol.js          # mensajes y wire compacto
│  └─ test/                    # tests de fórmulas, inventario, mapa, A*
│
├─ server/
│  ├─ src/net/gameServer.js    # WS, auth, sesiones, mensajes, tick, snapshots
│  ├─ src/game/                # world, player, monster, combat, ai, economy, chat
│  ├─ src/db/                  # schema.sql + memory/json/postgres
│  ├─ src/auth.js              # scrypt + token HMAC
│  ├─ tools/smoke-test.js      # E2E auth→movimiento→combate→especial→tienda→chat→reconexión
│  └─ test/                    # combate/PvP, tiendas, personaje
│
├─ client/
│  ├─ index.html               # HUD, login, paneles, overlays
│  ├─ src/main.js              # arranque, login, routing de eventos
│  ├─ src/core/                # store, emitter, bus de UI
│  ├─ src/net/socket.js        # reconexión por token, ping, mensajes
│  ├─ src/game/WorldScene.js   # cámara, interpolación, predicción, input
│  ├─ src/game/textures.js     # sprites/mapa procedurales
│  ├─ src/input/Joystick.js    # joystick virtual 8 direcciones
│  ├─ src/ui/                  # Hud, Minimap, Chat, Inventario, Shop, Stall
│  ├─ capacitor.config.json    # appId, webDir, Android
│  └─ vite.config.js
│
├─ scripts/
│  ├─ android-setup.mjs        # cap add android + permisos + SDK
│  ├─ build-apk.ps1            # build APK Windows
│  ├─ build-apk.sh             # build APK Linux/macOS/CI
│  ├─ check-dom.mjs            # valida que los IDs del HUD existan
│  ├─ start-server.ps1         # arranque LAN + health + URLs
│  ├─ serve-apk.mjs            # descarga del APK por LAN
│  └─ templates/AndroidManifest.xml
│
├─ docs/ANDROID.md             # guía APK, firma y errores comunes
├─ .github/workflows/android.yml
├─ docker-compose.yml          # PostgreSQL opcional
├─ .env.example
├─ start-server.bat            # arranque rápido para probar en LAN
└─ package.json                # npm workspaces
```

---

## 3. Inicio rápido (desarrollo)

Requisitos: **Node.js 20+**, npm 10+.

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env
npm run dev
```

- Servidor: `http://localhost:8080` · WebSocket `ws://localhost:8080/ws`
- Cliente Vite: `http://localhost:5173`
- Sin configurar nada, la persistencia usa `data/game-state.json`.

El servidor también sirve el build web si existe `client/dist`:

```bash
npm run build
npm start                     # http://localhost:8080
```

### Inicio de sesión

El login es **Google Sign-In**: el jugador pulsa **Continuar con Google**.
El cliente obtiene el ID token y lo envía en el **primer payload del WebSocket**;
no hay petición HTTP previa ni formulario de correo/IP. El servidor valida el JWT
con `google-auth-library`, extrae el correo y crea la cuenta la primera vez.
Después pide el nombre del personaje en un modal dentro del juego.

En Android el ID token lo entrega el plugin nativo
`capacitor-native-google-one-tap-signin` (Credential Manager), sin abrir el
navegador ni usar redirect URI, deep links o intent-filters. En web de escritorio
se usa Google Identity Services con popup.

Requisitos de configuración:

- `GOOGLE_CLIENT_ID` en el servidor: client ID de tipo **Web application**.
- `VITE_GOOGLE_CLIENT_ID` en el build: el mismo client ID.
- En Google Cloud, un client ID de tipo **Android** con el package técnico
  `com.rucoylike.game` y la huella SHA-1 del keystore de release.

El package Android, el keystore/alias y las claves internas de `localStorage`
conservan identificadores históricos para no invalidar el cliente OAuth ni la
firma de las actualizaciones. El nombre visible del juego es **Almiargo Online**.

Para pruebas LAN, inicia el servidor con `start-server.bat` o
`scripts/start-server.ps1`. El servidor registra conexiones y fallos de
autenticación en `logs/server.log`.

El token de sesión interno se guarda 30 días para reconectar tras un corte. Una
cuenta sólo admite una sesión: al entrar desde otro dispositivo, la anterior se
cierra con el aviso “Desconectado por nueva sesión”.

### Controles

| Acción | Gesto |
| --- | --- |
| Mover | Toca el suelo (A*) o usa el joystick |
| Atacar | Toca un monstruo/jugador; se acerca y auto-ataca |
| Loot | Toca una bolsa cercana |
| NPC | Toca al mercader |
| Tienda AFK | Toca un puesto o `🏪` |
| Clase | Botones ⚔ ➶ ✦ (cooldown 1 s) |
| Poción | ✚ / ✧ |
| Especial | ★ |
| Chat | 💬 (Global/Local/Clan/Privado) |
| Inventario | 🎒 |

Teclado (desktop): `1/2/3` clase, `Q/W` pociones, `Espacio` especial, `I` inventario, `Enter` chat.

---

## 4. Sistemas implementados

### Mundo y movimiento
- Mapa determinista 80×80 por semilla; cliente y servidor generan lo mismo.
- Culling por viewport landscape (36×22 tiles) con **spatial hashing**; no se recorre el mapa entero por jugador.
- Snapshots compactos: `self` como array de 21 campos y claves cortas `e/b/s/o` (entidades, bolsas, puestos, online).
- Movimiento server-authoritative con validación de tile, NPCs/puestos y diagonales.
- Predicción local + reconciliación + interpolación remota (120 ms) usando hora de recepción del cliente, resistente a desfase de relojes.

### Interfaz móvil
- Android forzado a **landscape** (`sensorLandscape`) y modo inmersivo total (status/navigation bars ocultas, dibujo bajo el notch).
- Panel de estadísticas compacto (~18 % menor), anclado a la esquina superior izquierda y con fondo `rgba(0,0,0,0.7)`.
- HUD responsive, joystick virtual, tap-to-move, inventario/equipo, tiendas y chat táctil.

### Combate y progresión
- Clases fluidas por arma equipada: Caballero (Melee), Arquero (Distance + flechas), Mago (Magic + maná).
- Cambio de clase/arma con **1 s** de cooldown.
- Nivel base + habilidades independientes: Melee, Distance, Magic, Defense.
- Auto-ataque con rango, cooldown, crítico, defensa y XP por golpe.
- Muerte sin HP negativo: al llegar a 0 se programa el respawn; al reaparecer se restaura HP/MP al máximo, se vuelve al spawn seguro, se limpian bloqueos y se fuerza un snapshot para cámara/sprite.
- Especiales por clase con alto coste de maná y cooldown de 5 s:
  - Caballero: giro AOE 1.9 tiles.
  - Arquero: disparo triple (3 flechas) a los 3 enemigos más cercanos.
  - Mago: explosión arcana AOE 2.4 tiles.
- IA de monstruos: patrol → aggro → chase → attack → respawn.

### PvP y karma
- PvP sólo en Arena. Atacar a un inocente = calavera amarilla 60 s.
- Matar a un inocente = calavera roja 5 min + pérdida de 20 % XP / 30 % oro y drop de una pieza equipada.
- Morir inocente = 8 % XP / 10 % oro. Las bolsas pertenecen al máximo dañador durante 45 s.

### Economía y social
- Inventario de 30 slots, 8 slots de equipo, NPCs con stock/precio del servidor.
- Bolsas de loot con dueño y expiración.
- Tiendas AFK/offline persistidas: los ítems salen de la mochila; el oro se acredita al vendedor aunque esté desconectado (transacción atómica).
- Chat Global/Local/Clan/Privado con rate-limit y feed en HUD.

---

## 5. Persistencia

### JSON (por defecto)
```env
STORE_DRIVER=json
DATA_DIR=./data
```

### PostgreSQL (recomendado en producción)
```bash
docker compose up -d postgres
# .env
STORE_DRIVER=postgres
DATABASE_URL=postgres://rucoy:rucoy@localhost:5432/rucoy
npm run db:init
npm start
```

Tablas: `accounts`, `characters` (+ `state JSONB`), `character_snapshots`, `shop_stalls`, `market_transactions`, `login_events`, `leaderboard_cache`. Ver `server/src/db/schema.sql`.

> Cambia `JWT_SECRET` y configura `GOOGLE_CLIENT_ID` en producción. Usa HTTPS/WSS: los ID tokens OAuth viajan por el WebSocket.

---

## 6. Tests

```bash
npm test          # unitarios + integración (incluye smoke)
npm run smoke     # sólo el E2E de red
npm run check:dom # verifica que todos los IDs usados por la UI existan en index.html
```

El smoke levanta un servidor en memoria y verifica auth, movimiento, cambio de clase, daño con flechas (y su sincronización de perfil), especial, apertura/cierre de tienda AFK, chat, persistencia y reconexión por token.

---

## 7. APK Android

Guía completa: **[docs/ANDROID.md](docs/ANDROID.md)**.

### Requisitos
- JDK **21** (`JAVA_HOME`)
- Android SDK Platform **35**, Build-Tools **35.0.0**, platform-tools
- `ANDROID_HOME` (o `ANDROID_SDK_ROOT`)
- NDK **no es necesario** (Phaser es WebView; no hay código nativo propio)

### Build automático (Windows)

Debug:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -ServerUrl "wss://juego.midominio.com/ws"
```

Release firmado (genera un keystore temporal si falta):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 `
  -Release -AutoKeystore `
  -ServerUrl "ws://192.168.1.59:8080/ws"
```

Genera `artifacts/almiargo-online-release.apk` (o `almiargo-online-debug.apk` en el build debug).

### Build verificado (QA)

| Build | Tamaño | SHA-256 | Firma |
| --- | --- | --- | --- |
| Release | 4.428.752 bytes | `5D4AD68F417CC2C7274918B06ED74357E407D0ED551FB7AD6A71D1EEDE9098AF` | v2, RSA 2048 |

Endpoint embebido en el release actual: `ws://192.168.1.59:8080/ws`. El login
sólo muestra **Continuar con Google**; no hay campos de servidor, correo ni código. El release
usa el package técnico `com.rucoylike.game`, minSdk 24, targetSdk 35,
`screenOrientation="sensorLandscape"`, `resizeableActivity=false`,
`usesCleartextTraffic=true` y `hardwareAccelerated=true`; `apksigner verify`
pasa correctamente. Certificado de prueba SHA-256:
`8c25e2d24427affd666b83b39958764619950c967876b4e3ff0b40f3a2b5bdb1`; SHA-1
(necesario para el client ID Android de Google):
`D2:CA:76:E3:FF:09:A6:B7:2C:66:E8:C9:CF:3D:51:76:43:35:E7:CE`.

> El release actual embebe el Client ID oficial `196590783383-3796k1hnlns2dkmjiq5rt634hbmm6k8b.apps.googleusercontent.com` en el bundle web y en `strings.xml` (`server_client_id` y `default_web_client_id`). El servidor debe usar el mismo valor en `GOOGLE_CLIENT_ID`.

El APK incluye el CSS del HUD (`assets/public/assets/index-Cs6laCKO.css`), el
bundle principal `index-CQCOa7w0.js` y el chunk del plugin nativo
`index-B-BUl71w.js`. `npm test` (74 pruebas), `npm run build` y `check:dom`
pasan. El APK también está copiado en el Escritorio como
`almiargo-online-release.apk`. Pendiente la prueba en dispositivo físico/emulador
(no hay dispositivo ADB en este entorno) y la validación del modal nativo de
Google con una cuenta real.

### Descargar el APK en el teléfono

```bash
node scripts/serve-apk.mjs
```

Abre en el teléfono `http://<IP_LAN_DE_TU_PC>:8081/` y descarga el `.apk`. El servidor sirve `artifacts/` con soporte de rangos HTTP y se detiene con `Ctrl+C`.

### Build manual
```bash
npm run build
node scripts/android-setup.mjs
cd client
npx cap sync android
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
```
APK: `client/android/app/build/outputs/apk/debug/app-debug.apk`.

### URL del servidor en el APK
El endpoint se inyecta en tiempo de compilación y el jugador no lo escribe nunca.
El WebSocket es el único canal de autenticación; el primer mensaje `auth` lleva
el ID token de Google.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Release `
  -ServerUrl "https://juego.midominio.com" `
  -GoogleClientId "123-abc.apps.googleusercontent.com"
```

Para pruebas LAN:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Release `
  -ServerUrl "http://192.168.1.59:8080" `
  -GoogleClientId "123-abc.apps.googleusercontent.com"
```

También puedes definir `VITE_SERVER_URL` y `VITE_GOOGLE_CLIENT_ID` en el entorno
o crear `client/.env.production` a partir de `client/.env.production.example`.
En producción usa **https/wss** detrás de Nginx/Caddy. Para pruebas LAN con
`http/ws`, el manifest ya incluye `usesCleartextTraffic="true"`.

Sin `VITE_GOOGLE_CLIENT_ID` el APK compila, pero el botón de Google muestra un
error de configuración. Sin `GOOGLE_CLIENT_ID` el servidor rechaza los tokens.

El fallback `ws://10.0.2.2:8080/ws` solo sirve para el emulador Android y se usa
si compilas sin endpoint; los builds `-Release` exigen configurarlo.

### Permisos incluidos
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```
La app además solicita Screen Wake Lock mientras juega, para no apagar la pantalla.

### CI
`.github/workflows/android.yml` instala Node/JDK/SDK, ejecuta tests, compila el APK debug y lo sube como artifact. Configura las variables de repositorio `VITE_SERVER_URL` y `VITE_GOOGLE_CLIENT_ID` para el endpoint y OAuth reales.

---

## 8. Problemas comunes

| Error | Solución |
| --- | --- |
| `SDK location not found` | Define `ANDROID_HOME`; `android-setup.mjs` escribe `local.properties`. |
| `Unsupported class file major version` | Usa JDK 21 (Capacitor 7). |
| `gradlew: Permission denied` | `chmod +x client/android/gradlew`. |
| `cap: command not found` | `npm install` en la raíz; usa `npx cap ...`. |
| APK conecta a localhost | Recompila con `-ServerUrl` o `VITE_SERVER_URL`; la URL ya no se edita en el login. |
| `ERR_CLEARTEXT_NOT_PERMITTED` | Usa `wss://` o mantén `usesCleartextTraffic="true"`. |
| Pantalla se apaga | Permiso `WAKE_LOCK` + wake lock del cliente (incluidos). |
| El servidor no acepta conexiones LAN | `HOST=0.0.0.0`, firewall abierto en el puerto 8080. |
| El login queda en la pantalla de inicio | Inicia el servidor con `start-server.bat`; revisa `logs/server.log` (conexión y error de auth) y que el teléfono esté en la misma Wi-Fi. |
| Gradle se queda sin memoria | `org.gradle.jvmargs=-Xmx2048m` en `client/android/gradle.properties`. |
| `npm test` encuentra `smoke-test.js` | Es intencional: el smoke también corre en la suite. |

---

## 9. Notas de seguridad / producción

- Cambia `JWT_SECRET`, usa HTTPS/WSS y PostgreSQL.
- El servidor limita mensajes/s, tamaño de mensaje, chat y valida cada acción.
- El cliente nunca calcula daño, XP, oro ni drops.
- Para escalar a varias instancias necesitarás un bus de estado o sharding por zona; la versión actual es una sola instancia autoritativa.
- Antes de publicar: revisa `appId`, iconos, splash, política de privacidad y firma release.
