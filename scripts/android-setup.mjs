/**
 * Prepara el proyecto Android de Capacitor:
 *   1. Crea client/android si no existe (`npx cap add android`).
 *   2. Añade permisos INTERNET, ACCESS_NETWORK_STATE y WAKE_LOCK.
 *   3. Permite tráfico ws:// en desarrollo (usesCleartextTraffic).
 *   4. Configura local.properties con el SDK si está disponible.
 *
 * Uso:
 *   node scripts/android-setup.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'client');
const androidDir = path.join(clientDir, 'android');
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  // Node no puede ejecutar .cmd directamente sin shell en Windows.
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensurePermission(xml, permission) {
  const name = `android.permission.${permission}`;
  if (xml.includes(`android:name="${name}"`)) return xml;
  return xml.replace(
    /(<application\b)/,
    `    <uses-permission android:name="${name}" />\n$1`,
  );
}

function ensureApplicationAttribute(xml, attribute, value) {
  const appTag = xml.match(/<application\b[^>]*>/);
  if (!appTag) throw new Error('AndroidManifest.xml no contiene <application>');
  let tag = appTag[0];
  const attrRe = new RegExp(`\\s${attribute}\\s*=`);
  if (attrRe.test(tag)) return xml;
  tag = tag.replace(/>$/, ` ${attribute}="${value}">`);
  return xml.replace(appTag[0], tag);
}

function ensureActivityAttribute(xml, attribute, value) {
  const activityTag = xml.match(/<activity\b[^>]*>/);
  if (!activityTag) throw new Error('AndroidManifest.xml no contiene <activity>');
  let tag = activityTag[0];
  const attrRe = new RegExp(`\\s${attribute}\\s*=`);
  if (attrRe.test(tag)) return xml;
  tag = tag.replace(/>$/, ` ${attribute}="${value}">`);
  return xml.replace(activityTag[0], tag);
}

if (!fs.existsSync(androidDir)) {
  console.log('[android] creando proyecto nativo (npx cap add android)…');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npx, ['cap', 'add', 'android'], clientDir);
}

if (!fs.existsSync(manifestPath)) {
  console.error(`[android] no se encontró ${manifestPath}`);
  process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
for (const permission of ['INTERNET', 'ACCESS_NETWORK_STATE', 'WAKE_LOCK']) {
  manifest = ensurePermission(manifest, permission);
}
manifest = ensureApplicationAttribute(manifest, 'android:usesCleartextTraffic', 'true');
manifest = ensureApplicationAttribute(manifest, 'android:hardwareAccelerated', 'true');
manifest = ensureActivityAttribute(manifest, 'android:screenOrientation', 'sensorLandscape');
manifest = ensureActivityAttribute(manifest, 'android:resizeableActivity', 'false');
fs.writeFileSync(manifestPath, manifest);
console.log('[android] permisos, cleartext, orientación landscape e inmersión configurados');

// Mantiene el modo inmersivo incluso si se regenera el proyecto nativo.
const mainActivityPath = path.join(
  androidDir, 'app', 'src', 'main', 'java', 'com', 'rucoylike', 'game', 'MainActivity.java',
);
const mainTemplate = path.join(root, 'scripts', 'templates', 'MainActivity.java');
if (fs.existsSync(mainActivityPath) && fs.existsSync(mainTemplate)) {
  const current = fs.readFileSync(mainActivityPath, 'utf8');
  if (!current.includes('enterImmersiveMode')) {
    fs.copyFileSync(mainTemplate, mainActivityPath);
    console.log('[android] MainActivity actualizado con modo inmersivo');
  }
}

// local.properties evita "SDK location not found" en Windows/macOS/Linux.
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
if (sdk) {
  const localProps = path.join(androidDir, 'local.properties');
  const escaped = sdk.replace(/\\/g, '\\\\');
  fs.writeFileSync(localProps, `sdk.dir=${escaped}\n`);
  console.log(`[android] local.properties -> ${sdk}`);
} else {
  console.warn('[android] ANDROID_HOME/ANDROID_SDK_ROOT no definido; Android Studio lo generará.');
}

console.log(`
✅ Proyecto Android preparado.

Siguientes pasos:
  npm run build
  npx cap sync android
  cd client/android
  gradlew.bat assembleDebug     (Windows)
  ./gradlew assembleDebug       (macOS/Linux)

APK: client/android/app/build/outputs/apk/debug/app-debug.apk
`);
