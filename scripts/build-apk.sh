#!/usr/bin/env bash
# Construye el APK de Almiargo Online en macOS/Linux/CI.
#
# El endpoint se incrusta en tiempo de compilación; nunca se pide en la UI.
# Prioridad: --server-url > VITE_SERVER_URL > client/.env.production
#
# Uso:
#   ./scripts/build-apk.sh
#   ./scripts/build-apk.sh --server-url http://192.168.1.59:8080
#   ./scripts/build-apk.sh --server-url https://juego.midominio.com --google-client-id 123-abc.apps.googleusercontent.com
#   ./scripts/build-apk.sh --server-url https://juego.midominio.com --release --google-client-id 123-abc.apps.googleusercontent.com
#
# Requisitos: Node 20+, JDK 21, Android SDK (ANDROID_HOME) con Platform 35.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT="$ROOT/client"
ANDROID="$CLIENT/android"
ENV_PRODUCTION="$CLIENT/.env.production"
RELEASE=0
SERVER_URL=""
GOOGLE_CLIENT_ID_ARG=""

env_value() {
  [[ -f "$ENV_PRODUCTION" ]] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_PRODUCTION" \
    | head -n 1 | sed -e "s/^[\"']//" -e "s/[\"']$//"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url) SERVER_URL="${2:-}"; shift 2 ;;
    --google-client-id) GOOGLE_CLIENT_ID_ARG="${2:-}"; shift 2 ;;
    --release) RELEASE=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

command -v node >/dev/null || { echo "Falta Node.js 20+" >&2; exit 1; }
command -v npm >/dev/null || { echo "Falta npm" >&2; exit 1; }
command -v java >/dev/null || { echo "Falta JDK 21 (JAVA_HOME)" >&2; exit 1; }
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-}}"
if [[ -z "${ANDROID_HOME}" ]]; then
  echo "Define ANDROID_HOME con la ruta del Android SDK." >&2
  exit 1
fi
export ANDROID_HOME

if [[ -z "$SERVER_URL" && -n "${VITE_SERVER_URL:-}" ]]; then
  SERVER_URL="$VITE_SERVER_URL"
elif [[ -z "$SERVER_URL" && -f "$CLIENT/.env.production" ]]; then
  SERVER_URL="$(sed -n 's/^[[:space:]]*VITE_SERVER_URL[[:space:]]*=[[:space:]]*//p' "$CLIENT/.env.production" | head -n 1 | sed -e "s/^[\"']//" -e "s/[\"']$//")"
fi

if [[ -n "$SERVER_URL" ]]; then
  export VITE_SERVER_URL="$SERVER_URL"
  echo "Servidor embebido en el APK: $SERVER_URL"
elif [[ "$RELEASE" == "1" ]]; then
  echo "Falta el endpoint de producción: usa --server-url, VITE_SERVER_URL o client/.env.production" >&2
  exit 1
else
  echo "Aviso: sin VITE_SERVER_URL. Se usará el fallback de desarrollo."
fi

# OAuth: prioridad argumento > variable de entorno > client/.env.production.
if [[ -z "$GOOGLE_CLIENT_ID_ARG" ]]; then
  GOOGLE_CLIENT_ID_ARG="${VITE_GOOGLE_CLIENT_ID:-$(env_value VITE_GOOGLE_CLIENT_ID)}"
fi
if [[ -n "$GOOGLE_CLIENT_ID_ARG" ]]; then
  export VITE_GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID_ARG"
  echo "Google Client ID embebido: $GOOGLE_CLIENT_ID_ARG"
else
  echo "Aviso: sin VITE_GOOGLE_CLIENT_ID. El botón de Google mostrará un error de configuración hasta recompilar." >&2
fi

if [[ "${SKIP_INSTALL:-0}" != "1" && ! -d "$ROOT/node_modules" ]]; then
  (cd "$ROOT" && npm install)
fi

(cd "$ROOT" && npm run build)
(cd "$ROOT" && node scripts/android-setup.mjs)
(cd "$CLIENT" && npx cap sync android)

if [[ "$RELEASE" == "1" && ! -f "$ANDROID/keystore.properties" ]]; then
  echo "Para release crea client/android/keystore.properties y configura la firma en app/build.gradle." >&2
  exit 1
fi

TASK="assembleDebug"
VARIANT="debug"
if [[ "$RELEASE" == "1" ]]; then
  TASK="assembleRelease"
  VARIANT="release"
fi

(cd "$ANDROID" && chmod +x gradlew && ./gradlew "$TASK" --no-daemon)

mkdir -p "$ROOT/artifacts"
APK="$(find "$ANDROID/app/build/outputs/apk/$VARIANT" -name '*.apk' -print -quit)"
if [[ -z "$APK" ]]; then
  echo "No se generó ningún APK." >&2
  exit 1
fi
cp "$APK" "$ROOT/artifacts/almiargo-online-$VARIANT.apk"
echo ""
echo "✅ APK generado: $ROOT/artifacts/almiargo-online-$VARIANT.apk"
echo "   Instala con: adb install -r \"$ROOT/artifacts/almiargo-online-$VARIANT.apk\""
