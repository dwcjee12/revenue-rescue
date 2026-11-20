@echo off
cd /d "%~dp0"
echo Cleaning up the oversized commit...
git tag -d v0.2.2 >nul 2>&1
git reset --soft origin/main
git rm -r -q --cached dist-mac dist-mac-0.2.2 dist-linux-0.2.2 >nul 2>&1
copy /Y gitignore.txt .gitignore >nul
git rm -r -q --cached dist-mac dist-mac-0.2.2 dist-linux-0.2.2 >nul 2>&1
git add -A
git reset -q gitignore.txt >nul 2>&1
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "v0.2.2: help menu, about, metadata, release workflow publishes releases"
git push origin main
git tag v0.2.2
git push origin v0.2.2
echo.
echo Done. Watch https://github.com/dwcjee12/revenue-rescue/actions
pause
