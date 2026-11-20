@echo off
cd /d "%~dp0"
echo Applying release workflow...
if not exist .github\workflows mkdir .github\workflows
copy /Y release.yml.fixed .github\workflows\release.yml >nul
git add -A
git -c user.name="Revenue Rescue" -c user.email="support@example.com" commit -m "v0.2.2: help menu, about, metadata, release workflow"
git push origin main
echo Tagging v0.2.2...
git tag v0.2.2
git push origin v0.2.2
echo.
echo Done. Watch https://github.com/dwcjee12/revenue-rescue/actions
pause
