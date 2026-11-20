@echo off
cd /d "%~dp0"
findstr /C:"\"version\": \"0.2.4\"" package.json >nul || (echo package.json is not 0.2.4 - stopping & pause & exit /b 1)
git add -A
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "v0.2.4"
git push origin main
git tag v0.2.4
git push origin v0.2.4
echo.
echo Done.
pause
