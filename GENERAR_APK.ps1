# =============================================================================
# SCRIPT AUTOMÁTICO: Generar APK de Almiargo Online con diseño clásico
# =============================================================================
# Doble clic en este archivo para compilar el APK automáticamente
# =============================================================================

$ErrorActionPreference = "Stop"
$host.UI.RawUI.WindowTitle = "Generando APK - Almiargo Online"

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  ALMIARGO ONLINE - Generador de APK Automático" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# Ruta base del proyecto (donde está este script)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$clientDir = Join-Path $scriptDir "client"
$androidDir = Join-Path $clientDir "android"

Write-Host "[1/5] Entrando a la carpeta del cliente..." -ForegroundColor Yellow
Set-Location $clientDir

Write-Host "[2/5] Instalando dependencias (npm install)..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: falló npm install" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "[3/5] Compilando código web (npm run build)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: falló npm run build" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "[4/5] Sincronizando con Android (npx cap sync android)..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: falló npx cap sync android" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host "[5/5] Compilando APK (gradlew assembleDebug)..." -ForegroundColor Yellow
Set-Location $androidDir
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: falló la compilación de Gradle" -ForegroundColor Red
    Read-Host "Presiona Enter para salir"
    exit 1
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "  ¡APK GENERADO CON ÉXITO!" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
Write-Host ""

$apkPath = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    Write-Host "Ubicación del APK:" -ForegroundColor White
    Write-Host "  $apkPath" -ForegroundColor White
    $size = (Get-Item $apkPath).Length / 1KB
    Write-Host "Tamaño: $([math]::Round($size, 2)) KB" -ForegroundColor White
    Write-Host "Fecha: $(Get-Date)" -ForegroundColor White
    Write-Host ""
    Write-Host "Diseño incluido:" -ForegroundColor Cyan
    Write-Host "  - Barras de vida/mana arriba a la izquierda" -ForegroundColor Cyan
    Write-Host "  - Minimapa circular arriba a la derecha" -ForegroundColor Cyan
    Write-Host "  - Botones CAB / ARQ / MAG abajo a la derecha" -ForegroundColor Cyan
    Write-Host "  - Joystick abajo a la izquierda con MOVER" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Instala este APK en tu celular para probar." -ForegroundColor Green
} else {
    Write-Host "ADVERTENCIA: No se encontró el APK en la ruta esperada." -ForegroundColor Red
    Write-Host "Ruta buscada: $apkPath" -ForegroundColor Red
}

Write-Host ""
Read-Host "Presiona Enter para cerrar"
