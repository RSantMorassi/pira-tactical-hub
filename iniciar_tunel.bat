@echo off
title Cloudflare Tunnel - Pira-Tactical Hub
echo ========================================================
echo Iniciando Tunel Seguro Cloudflare (Acesso 4G no Celular)
echo ========================================================
echo.
.\cloudflared.exe tunnel --url http://localhost:8000
pause
