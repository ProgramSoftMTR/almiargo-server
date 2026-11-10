# Guía Android (Capacitor 7 → APK)

Esta guía cubre el empaquetado del cliente Phaser como APK instalable. El servidor Node.js se despliega aparte (VPS, Render, Fly.io, etc.).

---

## 1. Requisitos exactos

| Herramienta | Versión | Nota |
| --- | --- | --- |
| Node.js | 20 o 22 LTS | `node -v` |
| npm | 10+ | viene con Node |
| JDK | **21** | Capacitor 7 / AGP 8.x |
| Android SDK Platform | **35** | Android 15 |
| Build-Tools | **35.0.0** | |
| platform-tools | reciente | `adb` |
| NDK | **No requerido** | No hay código nativo propio |
| Gradle | wrapper incluido | `client/android/gradlew` |

Variables:

```powershell
# Windows (PowerShell, persistente para el usuario)
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-21..."
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```

```bash
# macOS / Linux (~/.zshrc o ~/.bashrc)
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

Comprueba:

```bash
java -version
echo $ANDROID_HOME       # Windows: echo %ANDROID_HOME%
adb version
```

Instala en Android Studio → **SDK Manager**:
- Android SDK Platform 35
- Android SDK Build-Tools 35.0.0
- Android SDK Platform-Tools

---

## 2. Configuración del proyecto

`client/capacitor.config.json`:

```json
{
  "appId": "com.rucoylike.game",
  "appName": "Almiargo Online",
  "webDir": "dist",
  "server": { "androidScheme": "https" },
  "android": {
    "allowMixedContent": true,
    "captureInput": true,
    "backgroundColor": "#10131a"
  }
}
```

- `appId` es el identificador técnico histórico `com.rucoylike.game`; se conserva
  para no invalidar el client ID Android ya registrado ni la firma del release.
  El nombre visible de la app es **Almiargo Online**.
- `webDir: dist` debe coincidir con `vite.config.js`.
- `androidScheme: https` da a la WebView un origen seguro (necesario para wake lock y almacenamiento).
- `allowMixedContent: true` permite `ws://` en pruebas; en producción usa `wss://`.

Después de `npx cap add android` se crea:

```
client/android/
├─ app/
│  ├─ build.gradle
│  └─ src/main/
│     ├─ AndroidManifest.xml
│     ├─ java/com/rucoylike/game/MainActivity.java
│     ├─ res/                     # iconos, splash, strings
│     └─ assets/public/           # build web copiado por `cap sync`
├─ build.gradle
├─ gradle.properties
├─ gradlew / gradlew.bat
├─ settings.gradle
└─ variables.gradle               # minSdk/targetSdk de Capacitor
```

`client/android/app/src/main/assets/public/` se regenera en cada `npx cap sync`; no lo edites a mano.

---

## 3. Permisos y manifest

`node scripts/android-setup.mjs` crea el proyecto si falta y aplica:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

Y en `<application>`:

```xml
android:usesCleartextTraffic="true"
android:hardwareAccelerated="true"
```

`WAKE_LOCK` se usa junto con la Screen Wake Lock API del cliente para evitar que se apague la pantalla durante la partida. No se piden permisos de ubicación, cámara, contactos ni almacenamiento externo.

Plantilla de referencia: `scripts/templates/AndroidManifest.xml`.

### Orientación y modo inmersivo

La actividad principal fuerza **solo landscape** (`sensorLandscape`) y desactiva el multi-ventana:

```xml
<activity
    android:name=".MainActivity"
    android:screenOrientation="sensorLandscape"
    android:resizeableActivity="false"
    ... />
```

`MainActivity.java` oculta las barras de sistema de forma permanente (sticky immersive), dibuja bajo el notch y vuelve a aplicar el modo al recuperar el foco:

```java
WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
controller.hide(WindowInsetsCompat.Type.systemBars());
controller.setSystemBarsBehavior(
    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
);
```

`scripts/android-setup.mjs` vuelve a asegurar `screenOrientation` y `resizeableActivity` en cada build y restaura `MainActivity.java` desde `scripts/templates/MainActivity.java` si detecta que perdió el modo inmersivo.

> Si publicas en Google Play y sólo usas `wss://`, puedes poner `usesCleartextTraffic="false"`.

---

## 4. Build debug (recomendado para probar)

Desde la raíz:

```bash
npm run build
node scripts/android-setup.mjs
cd client
npx cap sync android
cd android
./gradlew assembleDebug        # Windows: gradlew.bat assembleDebug
```

Salida:

```
client/android/app/build/outputs/apk/debug/app-debug.apk
```

Instalar:

```bash
adb devices
adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk
```

O copia el APK al teléfono y actívalo con "Instalar desde origen desconocido".

También puedes servirlo por LAN:

```bash
node scripts/serve-apk.mjs
# en el teléfono: http://<IP_DE_TU_PC>:8081/
```

### Scripts automáticos

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 `
  -ServerUrl "wss://juego.midominio.com/ws"
```

Linux/macOS/CI:

```bash
./scripts/build-apk.sh --server-url wss://juego.midominio.com/ws
```

Por defecto copian el resultado a `artifacts/almiargo-online-debug.apk`; con `-Release`/`--release`, a `artifacts/almiargo-online-release.apk`.

### Build verificado

- Release firmado: `artifacts/almiargo-online-release.apk` — **4.428.752 bytes**, SHA-256 `5D4AD68F417CC2C7274918B06ED74357E407D0ED551FB7AD6A71D1EEDE9098AF`, firma v2.
- Endpoint embebido en el release actual: `ws://192.168.1.59:8080/ws`. Recompila con `-ServerUrl`/`VITE_SERVER_URL` para tu red o producción.
- El login sólo muestra **Continuar con Google**; no hay campos de servidor, correo ni código.
- El release actual embebe el Client ID oficial `196590783383-3796k1hnlns2dkmjiq5rt634hbmm6k8b.apps.googleusercontent.com` en el bundle y en `strings.xml`; el servidor debe usar el mismo `GOOGLE_CLIENT_ID`.
- Contiene `assets/public/assets/index-BdT-yppq.css` y `assets/public/assets/index-D3Taeb4T.js`.
- `apksigner verify` pasa; etiqueta visible `Almiargo Online`; actividad lanzable `com.rucoylike.game.MainActivity` con `screenOrientation=6` (sensorLandscape) y `resizeableActivity=false`.
- SHA-1 del certificado de release (para el client ID Android): `D2:CA:76:E3:FF:09:A6:B7:2C:66:E8:C9:CF:3D:51:76:43:35:E7:CE`.
- Validado: el inicio de sesión nativo de Google funcionó en un dispositivo físico; el login nativo ya no incluye el panel de diagnóstico.

### Configurar Google Sign-In

1. En Google Cloud Console crea un **OAuth client ID** de tipo **Web application**.
   Ese valor va en `GOOGLE_CLIENT_ID` del servidor y `VITE_GOOGLE_CLIENT_ID`
   del build. El servidor lo usa como `audience` del ID token.
2. Crea otro **OAuth client ID** de tipo **Android** con:
   - Package name: `com.rucoylike.game`
   - SHA-1: `D2:CA:76:E3:FF:09:A6:B7:2C:66:E8:C9:CF:3D:51:76:43:35:E7:CE`
3. El cliente abre el selector nativo con Credential Manager y envía el ID
   token en el primer mensaje `auth` del WebSocket. No hay petición HTTP previa.
   El flujo nativo no abre el navegador ni usa redirect URI; por eso Google no
   necesita intent-filters ni un Custom URL Scheme. Un deep link sólo haría falta
   para un flujo web con `@capacitor/browser`, que no es el implementado.
4. La pantalla de inicio sólo ofrece **Continuar con Google**; no hay botón de
   Apple ni campos de correo, servidor o código.

### Error `SIGN_IN_CANCELLED` / “activity is cancelled by the user”

El plugin agrega siempre la frase “Verify you have created a OAuth 2.0 Client
ID of type 'Android'…” a **cualquier** cancelación (`addClientIdInfo`). No es una
respuesta literal de Google ni una prueba de que el SHA-1 sea inválido: la línea
útil es la que aparece después del salto de línea, normalmente
`activity is cancelled by the user`. Si el selector se cierra solo o al elegir
la cuenta, el síntoma suele ser un cliente Android faltante o mal configurado.

La inicialización del plugin es correcta: `InitializeOptions` sólo acepta
`clientId` (el Client ID **Web**) y `nonce`; el código nativo usa ese `clientId`
como `serverClientId` en `GetGoogleIdOption` y en
`GetSignInWithGoogleOption.Builder(webClientId)`. El Client ID de tipo Android
**no se pasa en JavaScript**: Google lo vincula por package name + SHA-1.

Checklist para el APK release actual:

1. El Client ID `196590783383-3796k1hnlns2dkmjiq5rt634hbmm6k8b.apps.googleusercontent.com`
   debe ser de tipo **Web application** y pertenecer al proyecto que vas a usar.
2. En **el mismo proyecto** de Google Cloud, crea o verifica un OAuth client ID
   de tipo **Android**:
   - Package name: `com.rucoylike.game`
   - SHA-1: `D2:CA:76:E3:FF:09:A6:B7:2C:66:E8:C9:CF:3D:51:76:43:35:E7:CE`
   - Nombre sugerido: `Almiargo Online Android release`.
   Si ya existe uno con otro SHA-1 (por ejemplo, el debug `8E:89:B8:BD:44:86:4C:C7:F5:29:FC:0A:31:5B:C4:BC:0C:AF:68:07`),
   agrega el release o elimina y recrea el cliente si hay conflictos. No cambies
   el Web Client ID del APK ni del servidor.
3. Verifica la pantalla **OAuth consent screen**: si el estado es **Testing**,
   agrega como test user la cuenta de Google que usás en el teléfono.
4. Actualiza **Google Play Services** desde Play Store.
5. Los cambios de OAuth pueden tardar varios minutos en propagarse. Fuerza la
   detención de la app, borra caché o reinstala el APK; si sigue igual, reinicia
   el teléfono.
6. Opcional, pero reportado como solución en el issue del plugin: en el cliente
   **Web**, agrega `http://localhost` como “Authorized JavaScript origin”. No
   agregues redirect URI para el flujo nativo.
7. Si después de esto sigue apareciendo `SIGN_IN_CANCELLED`, captura el log
   nativo por USB (el plugin escribe el `Throwable` completo):
   ```powershell
   adb logcat -c
   adb logcat | Select-String "GoogleOneTapAuth|Credential"
   ```
   El tag del plugin es `GoogleOneTapAuth Plugin`.

> El fallo ocurre antes de que el plugin devuelva el `idToken`; el servidor y el
> WebSocket no participan todavía. Cuando el plugin devuelva el token, el flujo
> `auth` del socket ya está listo.

---

## 5. URL del servidor

El APK se ejecuta en el teléfono: `localhost` es el propio teléfono, no tu PC.

| Escenario | URL |
| --- | --- |
| Emulador Android | `ws://10.0.2.2:8080/ws` |
| Teléfono + PC en la misma Wi-Fi | `ws://192.168.1.59:8080/ws` |
| Producción | `wss://juego.midominio.com/ws` |

La URL se configura **solo en tiempo de compilación**; no existe campo “Servidor”
en el login. El WebSocket es el único canal de autenticación: el primer mensaje
`auth` incluye el ID token de Google.

Prioridad del script de build:

1. `-ServerUrl "https://juego.midominio.com"` / `--server-url ...`
2. Variable de entorno `VITE_SERVER_URL`
3. `client/.env.production` (`VITE_SERVER_URL=...`)

El Client ID de OAuth se resuelve igual:

1. `-GoogleClientId "..."` / `--google-client-id ...`
2. Variable de entorno `VITE_GOOGLE_CLIENT_ID`
3. `client/.env.production` (`VITE_GOOGLE_CLIENT_ID=...`)

Ejemplos:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Release `
  -ServerUrl "https://juego.midominio.com" `
  -GoogleClientId "123-abc.apps.googleusercontent.com"
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Release `
  -ServerUrl "http://192.168.1.59:8080" `
  -GoogleClientId "123-abc.apps.googleusercontent.com"
```

Sin `VITE_GOOGLE_CLIENT_ID` el APK compila pero el botón de Google muestra un
error de configuración. Sin `GOOGLE_CLIENT_ID` el servidor rechaza los tokens.
El client ID de Google Cloud debe ser de tipo **Web application** y debe existir
otro de tipo **Android** con package `com.rucoylike.game` y el SHA-1 del keystore.

El fallback nativo `ws://10.0.2.2:8080/ws` solo aplica al emulador Android y a
builds sin endpoint; un build `-Release` sin URL configurada falla a propósito.

El servidor debe escuchar en `0.0.0.0` (`HOST=0.0.0.0`) y el firewall debe permitir el puerto.

### Probar desde el teléfono en la misma Wi-Fi

En Windows, doble clic en `start-server.bat` (o ejecutar
`powershell -ExecutionPolicy Bypass -File scripts/start-server.ps1`). El script
arranca el servidor en segundo plano, comprueba `/health` y muestra la URL LAN
que debe estar embebida en el APK, por ejemplo `ws://192.168.1.59:8080/ws`.

Si el login no avanza, revisa `logs/server.log`: el servidor registra
`[net] conexión desde <IP>` y
`[auth] intento Google desde <IP>` en `logs/server.log`; un rechazo incluye el
motivo interno (por ejemplo, audience incorrecta) sólo en ese log.

---

## 6. Firma release

El APK debug sirve para probar, pero no para Play Store. El proyecto ya lee `client/android/keystore.properties` desde `client/android/app/build.gradle`, así que no necesitas editar Gradle.

### Prueba interna automática (keystore temporal)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 `
  -Release -AutoKeystore `
  -ServerUrl "ws://192.168.1.59:8080/ws"
```

Si falta `keystore.properties`, el script genera `client/android/rucoy-test-release.jks`, crea las credenciales y compila `assembleRelease`. Guarda una copia de ambos archivos: sin ese keystore no podrás firmar actualizaciones con la misma identidad.

> Este keystore es solo para pruebas internas. Para Play Store genera uno propio y protégelo.

### Keystore propio

```bash
keytool -genkeypair -v \
  -keystore client/android/rucoy-release.jks \
  -alias rucoy \
  -keyalg RSA -keysize 2048 -validity 10000
```

Crea `client/android/keystore.properties` (nunca lo subas al repo):

```properties
storeFile=../rucoy-release.jks
storePassword=TU_PASSWORD
keyAlias=rucoy
keyPassword=TU_PASSWORD
```

`client/android/app/build.gradle` aplica esa configuración automáticamente:

```gradle
signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
}
buildTypes {
    release {
        if (keystorePropertiesFile.exists()) {
            signingConfig signingConfigs.release
        }
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

Luego:

```bash
cd client/android
./gradlew assembleRelease
```

Salida: `app/build/outputs/apk/release/app-release.apk`.

Verifica la firma:

```bash
"$ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs \
  app/build/outputs/apk/release/app-release.apk
```

Alternativa sin editar Gradle: Android Studio → **Build → Generate Signed Bundle / APK**.

> `.gitignore` ya excluye `*.jks` y `client/android/keystore.properties`; no subas credenciales al repositorio.

### Release verificado en este proyecto

- Firma: v2 (APK Signature Scheme), RSA 2048, alias `rucoy`.
- Certificado SHA-256: `8c25e2d24427affd666b83b39958764619950c967876b4e3ff0b40f3a2b5bdb1`.
- `zipalign`: verificado (`zipalign -c -v 4` → `Verification successful`).
- Tamaño: **4.430.096 bytes**; SHA-256 del APK: `F0F4235E77E64265A1F65CC76D94F8E637BDDAEB6DCC29ABE46E6772971680B7`.
- Client ID de Google embebido: `196590783383-3796k1hnlns2dkmjiq5rt634hbmm6k8b.apps.googleusercontent.com` (bundle web + `strings.xml`).
- Etiqueta visible: **Almiargo Online**.
- Manifest: package técnico `com.rucoylike.game`, minSdk 24, targetSdk 35, `screenOrientation="sensorLandscape"`, `resizeableActivity=false`, `usesCleartextTraffic=true`, `hardwareAccelerated=true`, actividad lanzable `MainActivity`.
- Endpoint embebido: `ws://192.168.1.59:8080/ws`.

---

## 7. Iconos, splash y versión

- Iconos/splash: `client/android/app/src/main/res/`. Puedes usar Android Studio → **Image Asset** o `@capacitor/assets`.
- `appId` y `appName` viven en `client/capacitor.config.json`; tras cambiarlos ejecuta `npx cap sync`.
- Versión: `client/android/app/build.gradle` (`versionCode`, `versionName`). Incrementa `versionCode` en cada subida a Play Store.
- Orientación: la actividad fuerza `sensorLandscape` y desactiva multi-ventana. El HUD está optimizado para landscape; no se permite retrato.

---

## 8. CI (GitHub Actions)

`.github/workflows/android.yml`:
1. `npm ci`
2. `npm test`
3. `npm run build`
4. `node scripts/android-setup.mjs`
5. `npx cap sync android`
6. `./gradlew assembleDebug`
7. sube `app-debug.apk` como artifact.

Configura en **Settings → Variables → Actions**:
- `VITE_SERVER_URL = wss://tu-servidor/ws`

También puedes lanzarlo manualmente con **Run workflow** e indicar otra URL.

---

## 9. Errores comunes y solución

| Síntoma | Causa / solución |
| --- | --- |
| `SDK location not found` | `ANDROID_HOME` mal definido o falta `local.properties`. Ejecuta `node scripts/android-setup.mjs`. |
| `Unsupported class file major version 65` | JDK incorrecto. Usa 21 y borra cachés: `cd client/android && ./gradlew clean`. |
| `Could not find com.android.tools.build:gradle` | Sin conexión o repositorio bloqueado; revisa proxy/VPN. |
| `gradlew: Permission denied` | `chmod +x client/android/gradlew`. |
| `npx cap add android` falla | Falta `@capacitor/android` o Node < 20. `npm install` en la raíz. |
| APK abre pero no conecta | Recompila con `-ServerUrl` apuntando a IP LAN o `https://`; el login ya no permite cambiarla. |
| `ERR_CLEARTEXT_NOT_PERMITTED` | Usa `wss://` o `android:usesCleartextTraffic="true"`. |
| `ERR_CONNECTION_REFUSED` desde emulador | Usa `10.0.2.2`, no `localhost`. |
| WebSocket falla sólo en producción | El proxy debe permitir Upgrade/Connection y `/ws`; usa Nginx `proxy_set_header Upgrade $http_upgrade`. |
| Pantalla negra tras splash | `webDir` incorrecto o build no sincronizado: `npm run build && npx cap sync android`. |
| Pantalla se apaga | Faltan `WAKE_LOCK` o el wake lock del cliente. Revisa el manifest generado. |
| `OutOfMemoryError` en Gradle | `client/android/gradle.properties`: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8`. |
| APK enorme | `dist` incluye sourcemaps? `sourcemap: false` ya está. Phaser pesa ~1.2 MB minificado. |
| La app reinstala y pierde sesión | Normal si cambia el `appId`, se borran datos o expira el token (30 días). |
| Dos dispositivos con la misma cuenta | El servidor expulsa la sesión anterior (un dispositivo por personaje). |

---

## 10. Nginx de referencia (WSS)

```nginx
server {
    listen 443 ssl http2;
    server_name juego.midominio.com;

    ssl_certificate     /etc/letsencrypt/live/juego.midominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/juego.midominio.com/privkey.pem;

    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

Con TLS, compila el APK con `-ServerUrl "https://juego.midominio.com"` o
`VITE_SERVER_URL=https://juego.midominio.com`.
