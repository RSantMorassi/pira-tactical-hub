@echo off
chcp 65001 >nul
title Pira-Tactical Hub - Servidor e Tunel
color 0A

echo ================================================================
echo    INICIANDO PIRA-TACTICAL HUB (PIRACICABA)
echo ================================================================
echo.

echo 1. Liberando porta 8000 de processos anteriores...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1

echo 2. Iniciando Servidor Python...
start "Pira-Server" python run.py

timeout /t 3 /nobreak >nul

echo 3. Iniciando Tunel Seguro Cloudflare (Acesso 4G)...
start "Pira-Tunel-4G" .\cloudflared.exe tunnel --url http://localhost:8000

echo.
echo ================================================================
echo TUDO PRONTO E ONLINE!
echo - No PC: Acesse http://localhost:8000
echo - No Celular (Wi-Fi): Acesse http://192.168.0.154:8000/mobile
echo - No Celular (4G): Verifique o link HTTPS na janela do tunel.
echo ================================================================
pause
