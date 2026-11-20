@echo off
setlocal
cd /d "%~dp0"
title Revenue Rescue - build Windows installer
set NODE_OPTIONS=--use-system-ca
set CSC_IDENTITY_AUTO_DISCOVERY=false
where node >nul 2>nul || (echo Node.js 22.13+ required. & goto end)
echo Installing build tools (first run downloads Electron, a few minutes)...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
call npx electron-builder --win nsis --x64 --publish never -c.publish.provider=github -c.publish.owner=dwcjee12 -c.publish.repo=revenue-rescue
if errorlevel 1 goto fail
echo.
echo Done. The installer is in the dist folder.
start "" "%~dp0dist"
goto end
:fail
echo.
echo Build did not finish.
:end
pause
