@echo off
cd /d "%~dp0"
copy /Y release.yml.fixed .github\workflows\release.yml >nul
git add -A
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "v0.2.3: release workflow builds then publishes in one job"
git push origin main
git tag v0.2.3
git push origin v0.2.3
echo.
echo Done. Watch https://github.com/dwcjee12/revenue-rescue/actions
pause
