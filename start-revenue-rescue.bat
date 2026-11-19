@echo off
setlocal
cd /d "%~dp0"
title Revenue Rescue
rem Trust the Windows certificate store (antivirus HTTPS scanning installs its own root certificate there).
set NODE_OPTIONS=--use-system-ca
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "const[a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto nonode
if not exist node_modules\express (
  echo Installing dependencies...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 goto fail
)
if not exist .env (
  node -e "require('fs').writeFileSync('.env','BASE_URL=http://localhost:3000\nPORT=3000\nENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex')+'\n')"
  echo Created .env with a new encryption key. Back that file up.
)
echo Starting Revenue Rescue at http://localhost:3000  (close this window to stop it)
start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"
call npm start
goto end
:nonode
echo.
echo Node.js 22.13 or newer is required. Install the LTS from https://nodejs.org and run this file again.
:fail
echo.
echo Setup did not finish.
:end
pause
