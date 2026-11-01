@echo off
title Solora + Cloudflare Tunnel
echo ==========================================
echo       Starting Solora Web + Tunnel
echo ==========================================

start "Solora Backend" cmd /c "node main.js"

timeout /t 2 /nobreak >nul

if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" (
    "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000
) else if exist "%ProgramFiles%\cloudflared\cloudflared.exe" (
    "%ProgramFiles%\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000
) else (
    cloudflared tunnel --url http://localhost:3000
)

pause
