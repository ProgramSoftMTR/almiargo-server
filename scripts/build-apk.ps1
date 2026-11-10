#Requires -Version 5.1
<#
  Construye el APK de Almiargo Online (Windows).

  El endpoint se incrusta en tiempo de compilación; el jugador nunca escribe
  una IP o URL en el login. Orden de prioridad:
    1. -ServerUrl "..."
    2. variable de entorno VITE_SERVER_URL
    3. client/.env.production (VITE_SERVER_URL=...)

  Ejemplos:
    powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1
    powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -ServerUrl "http://192.168.1.59:8080"
    powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -ServerUrl "https://juego.midominio.com" -GoogleClientId "123-abc.apps.googleusercontent.com"
    powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Release -ServerUrl "https://juego.midominio.com" -GoogleClientId "123-abc.apps.googleusercontent.com"
    powershell -ExecutionPolicy Bypass -File scripts/build-apk.ps1 -Release -AutoKeystore -ServerUrl "https://juego.midominio.com" -GoogleClientId "123-abc.apps.googleusercontent.com"

  Requisitos:
    - Node 20+ y npm
    - JDK 21 (JAVA_HOME)
    - Android SDK con platform-tools, build-tools y platform 35 (ANDROID_HOME)
#>
param(
  [string]$ServerUrl = '',
  [string]$GoogleClientId = '',
  [switch]$Release,
  [switch]$AutoKeystore,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$client = Join-Path $root 'client'
$android = Join-Path $client 'android'
$artifactDir = Join-Path $root 'artifacts'

function Require-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "No se encontró '$Name'. $Hint"
  }
}

function Invoke-Step([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
  Write-Host "`n> $Command $($Arguments -join ' ')" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "El comando '$Command' falló con código $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

function Read-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { return '' }
  $line = Select-String -Path $Path -Pattern "^\s*$Name\s*=\s*(.+?)\s*$" |
    Select-Object -First 1
  if (-not $line) { return '' }
  return $line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

Require-Command 'node' 'Instala Node.js 20+ desde https://nodejs.org'
Require-Command 'npm' 'npm debe venir con Node.js.'
Require-Command 'java' 'Instala JDK 21 y define JAVA_HOME.'

$sdk = $env:ANDROID_SDK_ROOT
if (-not $sdk) { $sdk = $env:ANDROID_HOME }
if (-not $sdk) {
  throw @'
Android SDK no encontrado. Define ANDROID_HOME (o ANDROID_SDK_ROOT).
Windows típico: C:\Users\<usuario>\AppData\Local\Android\Sdk
Instala Android Studio -> SDK Manager -> Android SDK Platform 35 + Build-Tools 35.0.0.
'@
}

# Resuelve el endpoint compilado sin pedirlo nunca al jugador.
$resolvedServerUrl = ''
if ($ServerUrl) {
  $resolvedServerUrl = $ServerUrl.Trim()
} elseif ($env:VITE_SERVER_URL) {
  $resolvedServerUrl = $env:VITE_SERVER_URL.Trim()
} else {
  $envFile = Join-Path $client '.env.production'
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^\s*VITE_SERVER_URL\s*=\s*(.+?)\s*$' |
      Select-Object -First 1
    if ($line) {
      $resolvedServerUrl = $line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
    }
  }
}

if ($resolvedServerUrl) {
  $env:VITE_SERVER_URL = $resolvedServerUrl
  Write-Host "Servidor embebido en el APK: $resolvedServerUrl" -ForegroundColor Yellow
} elseif ($Release) {
  throw @'
Falta el endpoint de producción. Define uno de estos antes del build release:
  -ServerUrl "https://juego.midominio.com"
  VITE_SERVER_URL=https://juego.midominio.com
  client/.env.production -> VITE_SERVER_URL=https://juego.midominio.com
'@
} else {
  Write-Host 'Aviso: sin VITE_SERVER_URL. Se usará el fallback de desarrollo (10.0.2.2 en Android).' -ForegroundColor Yellow
}

# OAuth: prioridad argumento > variable de entorno > client/.env.production.
$clientEnvFile = Join-Path $client '.env.production'
$resolvedGoogleClientId = if ($GoogleClientId) {
  $GoogleClientId.Trim()
} elseif ($env:VITE_GOOGLE_CLIENT_ID) {
  $env:VITE_GOOGLE_CLIENT_ID.Trim()
} else {
  Read-EnvValue $clientEnvFile 'VITE_GOOGLE_CLIENT_ID'
}
if ($resolvedGoogleClientId) {
  $env:VITE_GOOGLE_CLIENT_ID = $resolvedGoogleClientId
  Write-Host "Google Client ID embebido: $resolvedGoogleClientId" -ForegroundColor Yellow
} else {
  Write-Host 'Aviso: sin VITE_GOOGLE_CLIENT_ID. El botón de Google mostrará un error de configuración hasta recompilar.' -ForegroundColor Red
}

if (-not $SkipInstall -and -not (Test-Path (Join-Path $root 'node_modules'))) {
  Invoke-Step 'npm' @('install') $root
}

Invoke-Step 'npm' @('run', 'build') $root
Invoke-Step 'node' @('scripts/android-setup.mjs') $root

if (-not (Test-Path (Join-Path $android 'gradlew.bat'))) {
  throw 'No se generó client/android. Ejecuta: node scripts/android-setup.mjs'
}

Invoke-Step 'npx' @('cap', 'sync', 'android') $client

$keystoreProps = Join-Path $android 'keystore.properties'
# Se conserva el nombre del keystore y el alias para no romper la firma
# existente ni el cliente OAuth Android ya registrado.
$testKeystore = Join-Path $android 'rucoy-test-release.jks'
if ($Release -and -not (Test-Path $keystoreProps)) {
  if (-not $AutoKeystore) {
    throw @'
Para firmar un APK release crea client/android/keystore.properties:
  storeFile=../rucoy-release.jks
  storePassword=...
  keyAlias=rucoy
  keyPassword=...
(client/android/app/build.gradle ya lee ese archivo para signingConfigs.release).

Para una prueba interna puedes generar un keystore automático:
  -Release -AutoKeystore -ServerUrl "https://juego.midominio.com"
No uses ese keystore para publicar en Play Store.
'@
  }
  Require-Command 'keytool' 'keytool viene con el JDK; define JAVA_HOME y añade %JAVA_HOME%\bin al PATH.'
  if (Test-Path $testKeystore) {
    throw "Existe $testKeystore pero falta keystore.properties. Restaura las credenciales o borra el .jks para regenerarlo."
  }
  $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $storePass = -join (1..24 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
  Write-Host 'Generando keystore de prueba (válido 10000 días)...' -ForegroundColor Yellow
  & keytool -genkeypair -v -keystore $testKeystore -alias rucoy -keyalg RSA -keysize 2048 `
    -validity 10000 -storepass $storePass -keypass $storePass `
    -dname 'CN=Almiargo Online Test, OU=QA, O=Almiargo Online, L=Test, ST=Test, C=AR'
  if ($LASTEXITCODE -ne 0) { throw "keytool falló con código $LASTEXITCODE" }
  @"
storeFile=../rucoy-test-release.jks
storePassword=$storePass
keyAlias=rucoy
keyPassword=$storePass
"@ | Set-Content -Path $keystoreProps -Encoding ASCII
  Write-Host "Keystore: $testKeystore" -ForegroundColor Yellow
  Write-Host "Credenciales: $keystoreProps (password: $storePass)" -ForegroundColor Yellow
}

$task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
Invoke-Step (Join-Path $android 'gradlew.bat') @($task, '--no-daemon') $android

$variant = if ($Release) { 'release' } else { 'debug' }
$apk = Get-ChildItem (Join-Path $android "app\build\outputs\apk\$variant") -Filter '*.apk' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw "No se encontró ningún APK en app/build/outputs/apk/$variant" }

New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$target = Join-Path $artifactDir "almiargo-online-$variant.apk"
Copy-Item $apk.FullName $target -Force

Write-Host "`n✅ APK generado: $target" -ForegroundColor Green
Write-Host "   Instala con: adb install -r `"$target`"" -ForegroundColor Green
if ($Release) {
  Write-Host "   Verifica la firma con: apksigner verify --verbose `"$target`"" -ForegroundColor Green
}
exit 0
