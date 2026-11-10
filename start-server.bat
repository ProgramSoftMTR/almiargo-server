@echo off
title Almiargo Online - Servidor
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1"
echo.
pause
