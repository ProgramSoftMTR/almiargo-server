# Inicia Almiargo Online en segundo plano y verifica /health.
# Pensado para pruebas desde el telefono en la misma Wi-Fi.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$port = 8080

$serverPid = $null
$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  $serverPid = ($existing | Select-Object -First 1).OwningProcess
  Write-Host "El servidor ya esta escuchando en el puerto $port (PID $serverPid)." -ForegroundColor Green
} else {
  $node = (Get-Command node -ErrorAction Stop).Source
  $out = Join-Path $logDir 'server.log'
  $err = Join-Path $logDir 'server.err.log'
  $proc = Start-Process -FilePath $node `
    -ArgumentList 'server/src/index.js' `
    -WorkingDirectory $root `
    -RedirectStandardOutput $out `
    -RedirectStandardError $err `
    -WindowStyle Hidden `
    -PassThru
  $serverPid = $proc.Id
  Write-Host "Iniciando servidor (PID $serverPid)..." -ForegroundColor Yellow

  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
      if ($health.ok) { $ok = $true; break }
    } catch { /* todavia arrancando */ }
  }

  if (-not $ok) {
    Write-Host "El servidor no respondio. Revisa estos logs:" -ForegroundColor Red
    Write-Host "  $out"
    Write-Host "  $err"
    exit 1
  }
}

$ips = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address } |
  ForEach-Object { $_.IPv4Address.IPAddress } |
  Select-Object -Unique

if (-not $ips) {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress -Unique
}

Write-Host ''
Write-Host 'Almiargo Online - servidor activo' -ForegroundColor Green
Write-Host "  Health local: http://127.0.0.1:$port/health"
foreach ($ip in $ips) {
  Write-Host "  WebSocket LAN: ws://${ip}:${port}/ws"
  Write-Host "  Health LAN:    http://${ip}:${port}/health"
}
Write-Host ''
Write-Host 'El telefono debe estar en la misma Wi-Fi que esta PC.' -ForegroundColor Cyan
Write-Host 'Si el login falla, abre "Diagnostico de login" en la pantalla de inicio:'
Write-Host 'muestra la URL, el estado del WebSocket y el error exacto del servidor.'
Write-Host ''
Write-Host "Logs: $logDir"
if ($serverPid) {
  Write-Host "Para detener el servidor: Stop-Process -Id $serverPid"
}
